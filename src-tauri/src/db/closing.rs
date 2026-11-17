//! 決算: 期首残高、棚卸、決算整理のチェックリスト、決算書の金額一覧、年度の繰越。
//!
//! 計算は `domain::closing`・`domain::depreciation` で行い、ここは DB の読み書きをする。
//! 期末の棚卸などの仕訳は、利用者が「記録する」を押したときだけ作る。

use super::Database;
use crate::db::accounts::{self, Account};
use crate::db::fixed_assets;
use crate::db::reports;
use crate::db::transactions::{self, ensure_year_open};
use crate::domain::closing::{self, AccountFigure, OpeningTotals, Statement};
use crate::domain::depreciation::Method;
use crate::domain::journal::{
    EntryMode, LineInput, Side, TransactionInput, TransactionKind, AMOUNT_MAX,
};
use crate::domain::master::{AccountCategory, FilingType, TaxStatus};
use crate::error::{AppError, AppResult, ErrorCode};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// 決算書の行（`statement_line`）で科目を探す。標準の科目を優先する。
pub(crate) fn account_by_line(conn: &Connection, line: &str) -> AppResult<i64> {
    conn.query_row(
        "SELECT id FROM accounts WHERE statement_line = ?1 ORDER BY is_system DESC, sort, id LIMIT 1",
        [line],
        |row| row.get(0),
    )
    .optional()?
    .ok_or(AppError::field(ErrorCode::NotFound, "accountId"))
}

struct YearInfo {
    filing_type: FilingType,
    tax_status: TaxStatus,
    opening_confirmed: bool,
}

fn year_info(conn: &Connection, year: i64) -> AppResult<YearInfo> {
    conn.query_row(
        "SELECT filing_type, tax_status, opening_confirmed_at IS NOT NULL FROM fiscal_years WHERE year = ?1",
        [year],
        |r| {
            Ok(YearInfo {
                filing_type: r.get(0)?,
                tax_status: r.get(1)?,
                opening_confirmed: r.get(2)?,
            })
        },
    )
    .optional()?
    .ok_or(AppError::field(ErrorCode::NotFound, "fiscalYear"))
}

// ---- 期首残高 ----

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpeningRow {
    pub account_id: i64,
    /// 区分の向きで正（資産は借方、負債・資本は貸方）
    pub amount: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpeningBalances {
    pub fiscal_year: i64,
    pub rows: Vec<OpeningRow>,
    pub totals: OpeningTotals,
    pub confirmed: bool,
}

/// 年度の期首残高（科目 → 金額）。試算表・元帳の繰越に足す。
pub(crate) fn opening_map(conn: &Connection, year: i64) -> AppResult<HashMap<i64, i64>> {
    let mut stmt =
        conn.prepare("SELECT account_id, amount FROM opening_balances WHERE fiscal_year = ?1")?;
    let rows = stmt.query_map([year], |r| Ok((r.get(0)?, r.get(1)?)))?;
    Ok(rows.collect::<Result<_, _>>()?)
}

fn totals_of(conn: &Connection, rows: &[OpeningRow]) -> AppResult<OpeningTotals> {
    let categories: HashMap<i64, AccountCategory> = accounts::list(conn)?
        .into_iter()
        .map(|a| (a.id, a.category))
        .collect();
    let pairs: Vec<(AccountCategory, i64)> = rows
        .iter()
        .filter_map(|r| categories.get(&r.account_id).map(|c| (*c, r.amount)))
        .collect();
    Ok(closing::opening_totals(&pairs))
}

pub fn opening(conn: &Connection, year: i64) -> AppResult<OpeningBalances> {
    let info = year_info(conn, year)?;
    let mut rows: Vec<OpeningRow> = opening_map(conn, year)?
        .into_iter()
        .map(|(account_id, amount)| OpeningRow { account_id, amount })
        .collect();
    rows.sort_by_key(|r| r.account_id);
    Ok(OpeningBalances {
        fiscal_year: year,
        totals: totals_of(conn, &rows)?,
        rows,
        confirmed: info.opening_confirmed,
    })
}

fn write_opening(conn: &Connection, year: i64, rows: &[OpeningRow]) -> AppResult<()> {
    let categories: HashMap<i64, AccountCategory> = accounts::list(conn)?
        .into_iter()
        .map(|a| (a.id, a.category))
        .collect();
    conn.execute(
        "DELETE FROM opening_balances WHERE fiscal_year = ?1",
        [year],
    )?;
    let mut insert = conn.prepare(
        "INSERT INTO opening_balances (fiscal_year, account_id, amount) VALUES (?1, ?2, ?3)",
    )?;
    let mut seen = std::collections::HashSet::new();
    for (index, row) in rows.iter().enumerate() {
        match categories.get(&row.account_id) {
            None => return Err(AppError::line(ErrorCode::NotFound, index, "accountId")),
            Some(AccountCategory::Asset | AccountCategory::Liability | AccountCategory::Equity) => {
            }
            // 期首残高があるのは、資産・負債・資本の科目だけ
            Some(_) => return Err(AppError::line(ErrorCode::InvalidFormat, index, "accountId")),
        }
        if row.amount.abs() > AMOUNT_MAX {
            return Err(AppError::line(ErrorCode::OutOfRange, index, "amount"));
        }
        if !seen.insert(row.account_id) {
            return Err(AppError::line(ErrorCode::DuplicateCode, index, "accountId"));
        }
        if row.amount != 0 {
            insert.execute(params![year, row.account_id, row.amount])?;
        }
    }
    Ok(())
}

/// 期首残高を保存する（入力の途中でも保存できる）。確定した後は、確定を取り消してから直す。
pub fn save_opening(db: &Database, year: i64, rows: &[OpeningRow]) -> AppResult<OpeningBalances> {
    db.transaction(|tx| {
        ensure_year_open(tx, year)?;
        if year_info(tx, year)?.opening_confirmed {
            return Err(AppError::new(ErrorCode::OpeningConfirmed));
        }
        write_opening(tx, year, rows)?;
        opening(tx, year)
    })
}

/// 期首残高を確定する（`confirmed = false` で取り消す）。資産の合計と負債・資本の合計が合わないと確定できない。
pub fn confirm_opening(db: &Database, year: i64, confirmed: bool) -> AppResult<OpeningBalances> {
    db.transaction(|tx| {
        ensure_year_open(tx, year)?;
        let current = opening(tx, year)?;
        if confirmed && !current.totals.balanced {
            return Err(AppError::new(ErrorCode::Unbalanced));
        }
        tx.execute(
            "UPDATE fiscal_years SET opening_confirmed_at = CASE WHEN ?2 THEN strftime('%Y-%m-%dT%H:%M:%SZ', 'now') END
             WHERE year = ?1",
            params![year, confirmed],
        )?;
        opening(tx, year)
    })
}

// ---- 棚卸 ----

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InventoryStatus {
    pub fiscal_year: i64,
    /// 期首の商品の棚卸高（期首残高の棚卸資産）
    pub opening: i64,
    /// 年間の仕入
    pub purchases: i64,
    /// 入力した期末の棚卸高
    pub closing: Option<i64>,
    /// 売上原価（期首 + 仕入 − 期末）。期末を入れるまでは空
    pub cost_of_sales: Option<i64>,
    /// 期末の棚卸を仕訳にした
    pub recorded: bool,
    /// 期首の棚卸を振り替えた（期首の棚卸高があるときだけ要る）
    pub opening_recorded: bool,
}

fn line_total(conn: &Connection, year: i64, line: &str, debit_normal: bool) -> AppResult<i64> {
    let (debit, credit): (i64, i64) = conn.query_row(
        "SELECT coalesce(sum(CASE WHEN l.side = 'debit' THEN l.amount END), 0),
                coalesce(sum(CASE WHEN l.side = 'credit' THEN l.amount END), 0)
         FROM journal_lines l
         JOIN transactions t ON t.id = l.transaction_id
         JOIN accounts a ON a.id = l.account_id
         WHERE t.fiscal_year = ?1 AND a.statement_line = ?2",
        params![year, line],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )?;
    Ok(if debit_normal {
        debit - credit
    } else {
        credit - debit
    })
}

pub fn inventory(conn: &Connection, year: i64) -> AppResult<InventoryStatus> {
    year_info(conn, year)?;
    let inventory_account = account_by_line(conn, "bs.inventory")?;
    let opening = opening_map(conn, year)?
        .get(&inventory_account)
        .copied()
        .unwrap_or(0);
    let purchases = line_total(conn, year, "pl.purchases", true)?;
    let saved: Option<(i64, Option<i64>, Option<i64>)> = conn
        .query_row(
            "SELECT closing_amount, closing_transaction_id, opening_transaction_id FROM inventories WHERE fiscal_year = ?1",
            [year],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .optional()?;
    let closing = saved.map(|s| s.0);
    Ok(InventoryStatus {
        fiscal_year: year,
        opening,
        purchases,
        closing,
        cost_of_sales: closing.map(|c| opening + purchases - c),
        recorded: saved.is_some_and(|s| s.1.is_some() || s.0 == 0),
        opening_recorded: opening == 0 || saved.is_some_and(|s| s.2.is_some()),
    })
}

/// 期末の棚卸高を記録する。
/// - 期末: 棚卸資産 / 期末商品棚卸高（12 月 31 日）。前に記録した分は消して作り直す
/// - 期首: 期首商品棚卸高 / 棚卸資産（1 月 1 日）。期首の棚卸高があり、まだ振り替えていなければ
pub fn record_inventory(
    db: &Database,
    year: i64,
    closing_amount: i64,
) -> AppResult<InventoryStatus> {
    if !(0..=AMOUNT_MAX).contains(&closing_amount) {
        return Err(AppError::field(ErrorCode::OutOfRange, "closingAmount"));
    }
    db.transaction(|tx| {
        ensure_year_open(tx, year)?;
        let status = inventory(tx, year)?;
        let inventory_account = account_by_line(tx, "bs.inventory")?;
        let previous: Option<(Option<i64>, Option<i64>)> = tx
            .query_row(
                "SELECT closing_transaction_id, opening_transaction_id FROM inventories WHERE fiscal_year = ?1",
                [year],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()?;
        if let Some((Some(id), _)) = previous {
            transactions::remove(tx, id)?;
        }
        let entry = |date: String, memo: &str, debit: i64, credit: i64, amount: i64, kind| {
            transactions::insert_kind(
                tx,
                year,
                &TransactionInput {
                    date,
                    entry_mode: EntryMode::Grid,
                    memo: memo.to_string(),
                    lines: vec![
                        LineInput::new(Side::Debit, debit, amount),
                        LineInput::new(Side::Credit, credit, amount),
                    ],
                },
                kind,
            )
            .map(|t| t.id)
        };
        let closing_id = if closing_amount > 0 {
            Some(entry(
                format!("{year:04}-12-31"),
                "期末の棚卸",
                inventory_account,
                account_by_line(tx, "pl.closing_inventory")?,
                closing_amount,
                TransactionKind::Closing,
            )?)
        } else {
            None
        };
        let mut opening_id = previous.and_then(|p| p.1);
        if status.opening > 0 && opening_id.is_none() {
            opening_id = Some(entry(
                format!("{year:04}-01-01"),
                "期首の棚卸",
                account_by_line(tx, "pl.opening_inventory")?,
                inventory_account,
                status.opening,
                TransactionKind::Opening,
            )?);
        }
        tx.execute(
            "INSERT INTO inventories (fiscal_year, closing_amount, closing_transaction_id, opening_transaction_id)
             VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT (fiscal_year) DO UPDATE SET closing_amount = ?2, closing_transaction_id = ?3, opening_transaction_id = ?4",
            params![year, closing_amount, closing_id, opening_id],
        )?;
        inventory(tx, year)
    })
}

// ---- 決算整理のチェックリスト ----

/// チェックリストの項目。`auto` は帳簿の状態から済んだかを決める項目。
const ITEMS: &[(&str, bool)] = &[
    ("opening", true),
    ("accruals", false),
    ("allocation", false),
    ("depreciation", true),
    ("inventory", true),
    ("badDebt", false),
    ("cashCount", false),
    ("owner", false),
];

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckItem {
    pub item: String,
    pub done: bool,
    /// 帳簿から自動で決まる項目（手で印を付けられない）
    pub auto: bool,
}

pub fn checklist(conn: &Connection, year: i64) -> AppResult<Vec<CheckItem>> {
    let info = year_info(conn, year)?;
    let mut stmt = conn.prepare("SELECT item FROM closing_checks WHERE fiscal_year = ?1")?;
    let manual: Vec<String> = stmt
        .query_map([year], |r| r.get(0))?
        .collect::<Result<_, _>>()?;
    let assets = fixed_assets::for_year(conn, year)?;
    let inventory = inventory(conn, year)?;
    let mut list = Vec::new();
    for &(item, auto) in ITEMS {
        let done = match item {
            "opening" => info.opening_confirmed,
            "depreciation" => {
                if assets.assets.is_empty() {
                    continue;
                }
                assets
                    .assets
                    .iter()
                    .all(|a| a.depreciation.is_none() || a.transaction_id.is_some())
            }
            "inventory" => {
                if inventory.opening == 0 && inventory.purchases == 0 && inventory.closing.is_none()
                {
                    continue;
                }
                inventory.recorded && inventory.opening_recorded
            }
            // 貸倒引当金は青色申告だけ
            "badDebt" if info.filing_type == FilingType::White => continue,
            _ => manual.iter().any(|m| m == item),
        };
        list.push(CheckItem {
            item: item.to_string(),
            done,
            auto,
        });
    }
    Ok(list)
}

pub fn set_check(
    conn: &Connection,
    year: i64,
    item: &str,
    done: bool,
) -> AppResult<Vec<CheckItem>> {
    year_info(conn, year)?;
    if !ITEMS.iter().any(|(i, auto)| *i == item && !auto) {
        return Err(AppError::field(ErrorCode::NotFound, "item"));
    }
    if done {
        conn.execute(
            "INSERT OR IGNORE INTO closing_checks (fiscal_year, item) VALUES (?1, ?2)",
            params![year, item],
        )?;
    } else {
        conn.execute(
            "DELETE FROM closing_checks WHERE fiscal_year = ?1 AND item = ?2",
            params![year, item],
        )?;
    }
    checklist(conn, year)
}

// ---- 決算書の金額一覧 ----

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MonthRow {
    pub month: u32,
    pub sales: i64,
    pub purchases: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BreakdownRow {
    /// 取引先がない明細は `None`
    pub partner_id: Option<i64>,
    pub amount: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Breakdown {
    /// wages（給料賃金）・rent（地代家賃）・interest（利子割引料）
    pub key: String,
    pub rows: Vec<BreakdownRow>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DepreciationRow {
    pub asset_id: i64,
    pub name: String,
    pub acquired_on: String,
    pub cost: i64,
    pub method: Method,
    pub useful_life: u32,
    pub base: i64,
    pub rate: i64,
    pub months: u32,
    pub depreciation: i64,
    pub business_percent: i64,
    pub business: i64,
    pub closing_book_value: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StatementAmounts {
    pub fiscal_year: i64,
    pub filing_type: FilingType,
    pub statement: Statement,
    pub monthly: Vec<MonthRow>,
    pub personal_consumption: i64,
    pub misc_income: i64,
    pub breakdowns: Vec<Breakdown>,
    pub depreciation: Vec<DepreciationRow>,
}

fn monthly(conn: &Connection, year: i64) -> AppResult<Vec<MonthRow>> {
    let mut stmt = conn.prepare(
        "SELECT CAST(substr(t.date, 6, 2) AS INTEGER),
                coalesce(sum(CASE WHEN a.statement_line = 'pl.sales' THEN
                    CASE WHEN l.side = 'credit' THEN l.amount ELSE -l.amount END END), 0),
                coalesce(sum(CASE WHEN a.statement_line = 'pl.purchases' THEN
                    CASE WHEN l.side = 'debit' THEN l.amount ELSE -l.amount END END), 0)
         FROM journal_lines l
         JOIN transactions t ON t.id = l.transaction_id
         JOIN accounts a ON a.id = l.account_id
         WHERE t.fiscal_year = ?1 AND a.statement_line IN ('pl.sales', 'pl.purchases')
         GROUP BY 1",
    )?;
    let found: HashMap<u32, (i64, i64)> = stmt
        .query_map([year], |r| Ok((r.get(0)?, (r.get(1)?, r.get(2)?))))?
        .collect::<Result<_, _>>()?;
    Ok((1..=12)
        .map(|month| {
            let (sales, purchases) = found.get(&month).copied().unwrap_or_default();
            MonthRow {
                month,
                sales,
                purchases,
            }
        })
        .collect())
}

fn breakdowns(conn: &Connection, year: i64) -> AppResult<Vec<Breakdown>> {
    let mut stmt = conn.prepare(
        "SELECT l.partner_id,
                sum(CASE WHEN l.side = 'debit' THEN l.amount ELSE -l.amount END)
         FROM journal_lines l
         JOIN transactions t ON t.id = l.transaction_id
         JOIN accounts a ON a.id = l.account_id
         WHERE t.fiscal_year = ?1 AND a.statement_line = ?2
         GROUP BY l.partner_id
         ORDER BY 2 DESC",
    )?;
    [
        ("wages", "pl.wages"),
        ("rent", "pl.rent"),
        ("interest", "pl.interest"),
    ]
    .into_iter()
    .map(|(key, line)| {
        let rows = stmt
            .query_map(params![year, line], |r| {
                Ok(BreakdownRow {
                    partner_id: r.get(0)?,
                    amount: r.get(1)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?
            .into_iter()
            .filter(|r| r.amount != 0)
            .collect();
        Ok(Breakdown {
            key: key.to_string(),
            rows,
        })
    })
    .collect()
}

/// 青色申告決算書（一般用）に転記する金額。
pub fn statement(conn: &Connection, year: i64) -> AppResult<StatementAmounts> {
    let info = year_info(conn, year)?;
    let tb = reports::trial_balance(conn, year, 1, 12)?;
    let accounts: HashMap<i64, Account> = accounts::list(conn)?
        .into_iter()
        .map(|a| (a.id, a))
        .collect();
    let figures: Vec<AccountFigure> = tb
        .rows
        .iter()
        .filter_map(|r| {
            let a = accounts.get(&r.account_id)?;
            Some(AccountFigure {
                account_id: r.account_id,
                category: r.category,
                statement_line: a.statement_line.clone(),
                name_ja: a.name_ja.clone(),
                name_en: a.name_en.clone(),
                opening: r.brought_forward,
                closing: r.balance,
            })
        })
        .collect();
    let mut statement = closing::statement(year, info.filing_type, &figures, tb.pre_tax_income);
    if info.filing_type == FilingType::White {
        let stored: Option<String> = conn
            .query_row(
                "SELECT value FROM settings WHERE key = ?1",
                [format!("white_deduction_{year}")],
                |r| r.get(0),
            )
            .optional()?;
        let deduction = stored
            .as_deref()
            .unwrap_or("0")
            .parse::<i64>()
            .map_err(|_| AppError::new(ErrorCode::InvalidFormat))?;
        statement.deduction = deduction;
        statement.income = statement.income_before_deduction - deduction;
        for line in &mut statement.pl {
            match line.key.as_str() {
                "family_deduction" => line.amount = deduction,
                "income" => line.amount = statement.income,
                _ => {}
            }
        }
    }
    let depreciation = fixed_assets::for_year(conn, year)?
        .assets
        .into_iter()
        .filter_map(|a| {
            let d = a.depreciation?;
            Some(DepreciationRow {
                asset_id: a.asset.id,
                name: a.asset.name,
                acquired_on: a.asset.acquired_on,
                cost: a.asset.cost,
                method: a.asset.method,
                useful_life: a.asset.useful_life,
                base: d.base,
                rate: d.rate,
                months: d.months,
                depreciation: d.depreciation,
                business_percent: a.asset.business_percent,
                business: d.business,
                closing_book_value: d.closing_book_value,
            })
        })
        .collect();
    Ok(StatementAmounts {
        fiscal_year: year,
        filing_type: info.filing_type,
        statement,
        monthly: monthly(conn, year)?,
        personal_consumption: line_total(conn, year, "pl.personal_consumption", false)?,
        misc_income: line_total(conn, year, "pl.misc_income", false)?,
        breakdowns: breakdowns(conn, year)?,
        depreciation,
    })
}

// ---- 年度の繰越 ----

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CarryForward {
    pub next_year: i64,
    /// 翌年の期首の元入金
    pub capital: i64,
    /// 翌年度を新しく作った
    pub created: bool,
}

/// 年 `year` の期末残高を、翌年の期首残高にする。翌年度がなければ作る（申告区分と消費税の扱いは同じ）。
/// 資産・負債は期末残高のまま、事業主貸・事業主借は 0、元入金は
/// `期末元入金 + 青色控除前所得 + 事業主借 − 事業主貸`。翌年の期首残高は確定した状態にする。
/// 翌年の期首残高をもう確定していたら、`overwrite` のときだけ上書きする。
pub fn carry_forward(db: &Database, year: i64, overwrite: bool) -> AppResult<CarryForward> {
    db.transaction(|tx| {
        let info = year_info(tx, year)?;
        let next_year = year + 1;
        if next_year > 2100 {
            return Err(AppError::field(ErrorCode::OutOfRange, "fiscalYear"));
        }
        let tb = reports::trial_balance(tx, year, 1, 12)?;
        if !tb.balanced {
            return Err(AppError::new(ErrorCode::Unbalanced));
        }
        let next = year_info(tx, next_year).ok();
        let created = next.is_none();
        match next {
            None => {
                tx.execute(
                    "INSERT INTO fiscal_years (year, filing_type, tax_status) VALUES (?1, ?2, ?3)",
                    params![next_year, info.filing_type, info.tax_status],
                )?;
            }
            Some(n) if n.opening_confirmed && !overwrite => {
                return Err(AppError::new(ErrorCode::OpeningConfirmed));
            }
            Some(_) => ensure_year_open(tx, next_year)?,
        }

        let accounts: HashMap<i64, Account> = accounts::list(tx)?.into_iter().map(|a| (a.id, a)).collect();
        let line_of = |id: i64| accounts.get(&id).and_then(|a| a.statement_line.as_deref());
        let capital_account = account_by_line(tx, "bs.capital")?;
        let (mut drawings, mut contributions, mut capital) = (0, 0, 0);
        let mut rows = Vec::new();
        for r in &tb.rows {
            if !matches!(
                r.category,
                AccountCategory::Asset | AccountCategory::Liability | AccountCategory::Equity
            ) {
                continue;
            }
            match line_of(r.account_id) {
                Some("bs.owner_drawings") => drawings += r.balance,
                Some("bs.owner_contributions") => contributions += r.balance,
                _ if r.account_id == capital_account => capital += r.balance,
                _ => rows.push(OpeningRow {
                    account_id: r.account_id,
                    amount: r.balance,
                }),
            }
        }
        let capital = closing::next_capital(capital, tb.pre_tax_income, contributions, drawings);
        rows.push(OpeningRow {
            account_id: capital_account,
            amount: capital,
        });
        write_opening(tx, next_year, &rows)?;
        tx.execute(
            "UPDATE fiscal_years SET opening_confirmed_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE year = ?1",
            [next_year],
        )?;
        Ok(CarryForward {
            next_year,
            capital,
            created,
        })
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::fixed_assets::tests::pc;
    use crate::db::setup::tests::set_up_db;
    use crate::db::transactions::create;
    use crate::db::transactions::tests::{account, entry};

    fn row(account_id: i64, amount: i64) -> OpeningRow {
        OpeningRow { account_id, amount }
    }

    #[test]
    fn opening_balances_must_balance_to_be_confirmed_and_carry_into_reports() {
        let db = set_up_db();
        let (cash, bank, loan, capital, sales) = {
            let c = db.conn();
            (
                account(&c, "101"),
                account(&c, "104"),
                account(&c, "203"),
                account(&c, "302"),
                account(&c, "401"),
            )
        };
        // 損益の科目には期首残高がない
        assert_eq!(
            save_opening(&db, 2026, &[row(sales, 1)]).unwrap_err(),
            AppError::line(ErrorCode::InvalidFormat, 0, "accountId")
        );
        let saved = save_opening(
            &db,
            2026,
            &[row(cash, 50_000), row(bank, 300_000), row(loan, 100_000)],
        )
        .unwrap();
        assert!(!saved.totals.balanced);
        assert_eq!(
            confirm_opening(&db, 2026, true).unwrap_err().code,
            ErrorCode::Unbalanced
        );
        let saved = save_opening(
            &db,
            2026,
            &[
                row(cash, 50_000),
                row(bank, 300_000),
                row(loan, 100_000),
                row(capital, 250_000),
            ],
        )
        .unwrap();
        assert_eq!(
            (saved.totals.assets, saved.totals.liabilities_and_capital),
            (350_000, 350_000)
        );
        assert!(confirm_opening(&db, 2026, true).unwrap().confirmed);
        // 確定した後は、取り消してから直す
        assert_eq!(
            save_opening(&db, 2026, &[]).unwrap_err().code,
            ErrorCode::OpeningConfirmed
        );

        // 試算表と元帳の繰越に入る
        create(&db, 2026, &entry("2026-03-01", cash, sales, 10_000)).unwrap();
        let conn = db.conn();
        let tb = reports::trial_balance(&conn, 2026, 1, 12).unwrap();
        assert!(tb.balanced);
        let cash_row = tb.rows.iter().find(|r| r.account_id == cash).unwrap();
        assert_eq!(
            (cash_row.brought_forward, cash_row.balance),
            (50_000, 60_000)
        );
        let march = reports::trial_balance(&conn, 2026, 3, 3).unwrap();
        assert_eq!(
            march
                .rows
                .iter()
                .find(|r| r.account_id == cash)
                .unwrap()
                .brought_forward,
            50_000
        );
        let ledger = crate::db::books::ledger(&conn, 2026, 1, 12, cash).unwrap();
        assert_eq!(
            (ledger.brought_forward, ledger.closing_balance),
            (50_000, 60_000)
        );
    }

    #[test]
    fn inventory_moves_cost_of_sales_and_can_be_redone() {
        let db = set_up_db();
        let (bank, inventory_account, capital, purchases) = {
            let c = db.conn();
            (
                account(&c, "104"),
                account(&c, "108"),
                account(&c, "302"),
                account(&c, "502"),
            )
        };
        save_opening(
            &db,
            2026,
            &[row(inventory_account, 50_000), row(capital, 50_000)],
        )
        .unwrap();
        create(&db, 2026, &entry("2026-05-01", purchases, bank, 300_000)).unwrap();
        let before = inventory(&db.conn(), 2026).unwrap();
        assert_eq!(
            (before.opening, before.purchases, before.closing),
            (50_000, 300_000, None)
        );
        assert!(!before.recorded);

        let s = record_inventory(&db, 2026, 80_000).unwrap();
        assert_eq!(s.cost_of_sales, Some(270_000));
        assert!(s.recorded && s.opening_recorded);
        // 入れ直すと、期末の仕訳だけ作り直す（期首の振替は 1 回だけ）
        let s = record_inventory(&db, 2026, 70_000).unwrap();
        assert_eq!(s.cost_of_sales, Some(280_000));
        let conn = db.conn();
        let kinds: Vec<TransactionKind> = transactions::list(&conn, 2026, None)
            .unwrap()
            .iter()
            .map(|t| t.kind)
            .collect();
        assert_eq!(
            kinds
                .iter()
                .filter(|k| **k == TransactionKind::Closing)
                .count(),
            1
        );
        assert_eq!(
            kinds
                .iter()
                .filter(|k| **k == TransactionKind::Opening)
                .count(),
            1
        );
        // 試算表の売上原価: 期首 50,000 + 仕入 300,000 − 期末 70,000
        let tb = reports::trial_balance(&conn, 2026, 1, 12).unwrap();
        let cogs = tb
            .categories
            .iter()
            .find(|c| c.category == AccountCategory::Cogs)
            .unwrap();
        assert_eq!(cogs.balance, 280_000);
        // 棚卸資産の期末残高は期末の棚卸高
        assert_eq!(
            tb.rows
                .iter()
                .find(|r| r.account_id == inventory_account)
                .unwrap()
                .balance,
            70_000
        );
    }

    #[test]
    fn checklist_mixes_automatic_and_manual_items() {
        let db = set_up_db();
        let conn = db.conn();
        let items: Vec<String> = checklist(&conn, 2026)
            .unwrap()
            .into_iter()
            .map(|i| i.item)
            .collect();
        // 固定資産も棚卸もなければ、その項目は出さない
        assert_eq!(
            items,
            [
                "opening",
                "accruals",
                "allocation",
                "badDebt",
                "cashCount",
                "owner"
            ]
        );
        let list = set_check(&conn, 2026, "cashCount", true).unwrap();
        assert!(list.iter().find(|i| i.item == "cashCount").unwrap().done);
        // 自動の項目は手で付けられない
        assert_eq!(
            set_check(&conn, 2026, "opening", true).unwrap_err().field,
            Some("item")
        );
        let list = set_check(&conn, 2026, "cashCount", false).unwrap();
        assert!(!list.iter().find(|i| i.item == "cashCount").unwrap().done);
        drop(conn);
        let tools = account(&db.conn(), "115");
        fixed_assets::create(&db.conn(), &pc(tools)).unwrap();
        let list = checklist(&db.conn(), 2026).unwrap();
        assert!(!list.iter().find(|i| i.item == "depreciation").unwrap().done);
    }

    /// 1 年分の帳簿をつけ、決算書の金額と翌年への繰越を確かめる。
    #[test]
    fn year_end_statement_and_carry_forward() {
        let db = set_up_db();
        let ids = {
            let c = db.conn();
            [
                "101", "104", "115", "199", "301", "302", "401", "610", "616", "203", "615",
            ]
            .map(|code| account(&c, code))
        };
        let [cash, bank, tools, drawings, contributions, capital, sales, supplies, rent, loan, interest] =
            ids;
        save_opening(
            &db,
            2026,
            &[
                row(cash, 100_000),
                row(bank, 400_000),
                row(loan, 200_000),
                row(capital, 300_000),
            ],
        )
        .unwrap();
        confirm_opening(&db, 2026, true).unwrap();
        create(&db, 2026, &entry("2026-01-10", bank, sales, 600_000)).unwrap();
        create(&db, 2026, &entry("2026-07-10", bank, sales, 400_000)).unwrap();
        create(&db, 2026, &entry("2026-02-01", supplies, cash, 30_000)).unwrap();
        create(&db, 2026, &entry("2026-03-31", rent, bank, 120_000)).unwrap();
        create(&db, 2026, &entry("2026-04-10", tools, bank, 240_000)).unwrap();
        create(&db, 2026, &entry("2026-06-30", interest, bank, 5_000)).unwrap();
        create(&db, 2026, &entry("2026-08-01", drawings, bank, 200_000)).unwrap();
        create(&db, 2026, &entry("2026-09-01", cash, contributions, 50_000)).unwrap();
        // パソコン（定額法・事業 60%）: 償却 45,000 のうち経費 27,000、事業主貸 18,000
        let asset = fixed_assets::create(&db.conn(), &pc(tools)).unwrap();
        fixed_assets::record(&db, 2026, &[asset.id]).unwrap();

        let amounts = statement(&db.conn(), 2026).unwrap();
        let s = &amounts.statement;
        assert!(s.issues.is_empty(), "{:?}", s.issues);
        let pl = |key: &str| s.pl.iter().find(|l| l.key == key).unwrap().amount;
        assert_eq!(pl("sales"), 1_000_000);
        assert_eq!(pl("expenses"), 30_000 + 120_000 + 5_000 + 27_000);
        // 所得: 1,000,000 − 182,000
        assert_eq!(s.income_before_deduction, 818_000);
        assert_eq!((s.deduction, s.income), (650_000, 168_000));
        assert_eq!(s.asset_total.opening, 500_000);
        assert_eq!(s.asset_total.closing, s.liability_total.closing);
        assert_eq!(amounts.monthly[0].sales, 600_000);
        assert_eq!(amounts.monthly[6].sales, 400_000);
        let rent_rows = &amounts
            .breakdowns
            .iter()
            .find(|b| b.key == "rent")
            .unwrap()
            .rows;
        assert_eq!(rent_rows[0].amount, 120_000);
        assert_eq!(amounts.depreciation[0].business, 27_000);

        let result = carry_forward(&db, 2026, false).unwrap();
        assert!(result.created);
        // 元入金: 300,000 + 818,000 + 50,000 − (200,000 + 18,000)
        assert_eq!(result.capital, 950_000);
        let next = opening(&db.conn(), 2027).unwrap();
        assert!(next.confirmed && next.totals.balanced);
        let amount_of = |id| {
            next.rows
                .iter()
                .find(|r| r.account_id == id)
                .map(|r| r.amount)
        };
        assert_eq!(amount_of(drawings), None);
        assert_eq!(amount_of(contributions), None);
        assert_eq!(amount_of(tools), Some(195_000));
        assert_eq!(amount_of(loan), Some(200_000));
        // もう確定しているので、上書きを選ばないと繰り越さない
        assert_eq!(
            carry_forward(&db, 2026, false).unwrap_err().code,
            ErrorCode::OpeningConfirmed
        );
        assert!(!carry_forward(&db, 2026, true).unwrap().created);
        // 翌年の償却は、繰り越した帳簿価額から続く
        let next_year = fixed_assets::for_year(&db.conn(), 2027).unwrap();
        assert_eq!(
            next_year.assets[0].depreciation.unwrap().opening_book_value,
            195_000
        );
    }
}

/// 白色の事業専従者控除。対象と金額を利用者が確認した値だけを保存する。
pub fn save_white_deduction(db: &Database, year: i64, amount: i64) -> AppResult<StatementAmounts> {
    if !(0..=AMOUNT_MAX).contains(&amount) {
        return Err(AppError::field(ErrorCode::OutOfRange, "amount"));
    }
    db.transaction(|tx| {
        ensure_year_open(tx, year)?;
        if year_info(tx, year)?.filing_type != FilingType::White {return Err(AppError::field(ErrorCode::InvalidFormat, "filingType"));}
        tx.execute("INSERT INTO settings (key,value) VALUES (?1,?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value", params![format!("white_deduction_{year}"),amount.to_string()])?;
        crate::db::audit::event(tx,"whiteDeduction","update",Some(year),Some(serde_json::json!({"amount":amount})))?;
        statement(tx, year)
    })
}

#[cfg(test)]
mod white_integration_tests {
    use super::*;
    use crate::db::setup;
    use crate::domain::journal::{SimpleInput, SimpleKind};
    use crate::export::{self, labels::Locale, ExportFormat, ExportRequest, ExportTarget};

    #[test]
    fn white_deduction_flows_to_statement_guide_and_export() {
        let db = Database::open_in_memory().unwrap();
        let mut initial = setup::tests::input();
        initial.filing_type = FilingType::White;
        setup::complete(&db, &initial).unwrap();
        let (cash, sales) = {
            let conn = db.conn();
            (
                account_by_line(&conn, "bs.cash").unwrap(),
                account_by_line(&conn, "pl.sales").unwrap(),
            )
        };
        transactions::create_simple(
            &db,
            2026,
            &SimpleInput {
                kind: SimpleKind::Income,
                date: "2026-01-10".into(),
                amount: 1_000_000,
                account_id: Some(sales),
                payment_account_id: cash,
                partner_id: None,
                memo: "Sale".into(),
                allocation_percent: None,
            },
        )
        .unwrap();
        let result = save_white_deduction(&db, 2026, 100_000).unwrap();
        assert_eq!(result.statement.income, 900_000);
        assert!(result
            .statement
            .pl
            .iter()
            .any(|l| l.key == "family_deduction" && l.amount == 100_000));
        let guide = crate::db::filing::income_guide(&db.conn(), 2026).unwrap();
        assert_eq!(guide.income, 900_000);
        assert_eq!(guide.business_revenue, 1_000_000);
        assert!(guide
            .sections
            .iter()
            .find(|s| s.key == "return")
            .unwrap()
            .items
            .iter()
            .any(|i| i.key == "return_income" && i.value == 900_000));
        let file = export::build(
            &db.conn(),
            &ExportRequest {
                target: ExportTarget::Statement,
                format: ExportFormat::Csv,
                encoding: export::csv::Encoding::Utf8,
                locale: Locale::Ja,
                fiscal_year: 2026,
                from_month: 1,
                to_month: 12,
            },
        )
        .unwrap();
        assert!(file.name.contains("収支内訳書"));
        let csv = String::from_utf8(file.bytes).unwrap();
        assert!(csv.contains("事業専従者控除額"));
        assert!(!csv.contains("青色申告特別控除"));
        assert!(!csv.contains("貸借対照表"));
        let sales_book = crate::db::books::sales_book(&db.conn(), 2026, 1, 12).unwrap();
        assert_eq!(sales_book.len(), 1);
        assert_eq!(sales_book[0].total_credit, 1_000_000);
        assert!(save_white_deduction(&db, 2026, -1).is_err());
        crate::db::locks::set_year_closed(&db, 2026, true).unwrap();
        assert_eq!(
            save_white_deduction(&db, 2026, 50_000).unwrap_err().code,
            ErrorCode::YearClosed
        );
    }
}
