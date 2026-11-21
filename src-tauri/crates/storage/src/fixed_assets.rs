//! 固定資産台帳と、年ごとの減価償却の記録。
//!
//! 償却費は保存せず、資産の情報から `chobiyori_core::depreciation` で毎年計算する。
//! 計算した償却は候補として見せ、利用者が「記録する」を押したときだけ仕訳にする。

use super::Database;
use crate::closing::account_by_line;
use crate::transactions::{self, ensure_year_open};
use chobiyori_core::depreciation::{self, Asset, Method, YearDepreciation};
use chobiyori_core::error::{AppError, AppResult, ErrorCode};
use chobiyori_core::journal::{
    self, EntryMode, LineInput, Side, TransactionInput, TransactionKind,
};
use chobiyori_core::master::{self, AccountCategory, FilingType, MEMO_MAX, NAME_MAX};
use rusqlite::{params, Connection, OptionalExtension, Row};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FixedAsset {
    pub id: i64,
    pub name: String,
    pub account_id: i64,
    pub acquired_on: String,
    pub cost: i64,
    pub useful_life: u32,
    pub method: Method,
    pub business_percent: i64,
    pub book_value_year: i64,
    pub book_value: i64,
    pub disposed_on: Option<String>,
    pub memo: String,
    /// 償却を記録したことがある（削除できない）
    pub in_use: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FixedAssetInput {
    pub name: String,
    pub account_id: i64,
    /// `YYYY-MM-DD`（事業に使い始めた日）
    pub acquired_on: String,
    pub cost: i64,
    #[serde(default)]
    pub useful_life: u32,
    pub method: Method,
    pub business_percent: i64,
    /// 取得した年より後から帳簿をつけ始めた資産は、その年と、年の初めの帳簿価額を入れる
    #[serde(default)]
    pub book_value_year: Option<i64>,
    #[serde(default)]
    pub book_value: Option<i64>,
    #[serde(default)]
    pub disposed_on: Option<String>,
    #[serde(default)]
    pub memo: String,
}

const SELECT: &str = "
    SELECT f.id, f.name, f.account_id, f.acquired_on, f.cost, f.useful_life, f.method,
           f.business_percent, f.book_value_year, f.book_value, f.disposed_on, f.memo,
           EXISTS (SELECT 1 FROM depreciation_postings p WHERE p.asset_id = f.id)
    FROM fixed_assets f";

fn from_row(row: &Row<'_>) -> rusqlite::Result<FixedAsset> {
    Ok(FixedAsset {
        id: row.get(0)?,
        name: row.get(1)?,
        account_id: row.get(2)?,
        acquired_on: row.get(3)?,
        cost: row.get(4)?,
        useful_life: row.get(5)?,
        method: row.get(6)?,
        business_percent: row.get(7)?,
        book_value_year: row.get(8)?,
        book_value: row.get(9)?,
        disposed_on: row.get(10)?,
        memo: row.get(11)?,
        in_use: row.get(12)?,
    })
}

fn year_month(date: &str, field: &'static str) -> AppResult<(i64, u32)> {
    journal::parse_date(date.trim())
        .map(|(y, m, _)| (y, m))
        .ok_or(AppError::field(ErrorCode::InvalidFormat, field))
}

impl FixedAsset {
    /// 計算に使う形。
    pub fn to_asset(&self) -> Option<Asset> {
        Some(Asset {
            cost: self.cost,
            acquired: year_month(&self.acquired_on, "acquiredOn").ok()?,
            method: self.method,
            useful_life: self.useful_life,
            business_percent: self.business_percent,
            book_value_year: self.book_value_year,
            book_value: self.book_value,
            disposed: match &self.disposed_on {
                Some(d) => Some(year_month(d, "disposedOn").ok()?),
                None => None,
            },
        })
    }
}

fn filing_type(conn: &Connection, year: i64) -> AppResult<Option<FilingType>> {
    Ok(conn
        .query_row(
            "SELECT filing_type FROM fiscal_years WHERE year = ?1",
            [year],
            |r| r.get(0),
        )
        .optional()?)
}

/// 償却しない資産の決算書の行。固定資産の科目にはしない。
const NON_DEPRECIABLE_LINES: &[&str] = &[
    "bs.cash",
    "bs.checking",
    "bs.time_deposits",
    "bs.other_deposits",
    "bs.notes_receivable",
    "bs.accounts_receivable",
    "bs.securities",
    "bs.inventory",
    "bs.prepayments",
    "bs.loans_receivable",
    "bs.land",
    "bs.owner_drawings",
];

/// 入力を確かめて、保存する値にする。
fn validate(conn: &Connection, input: &FixedAssetInput) -> AppResult<(FixedAssetInput, Asset)> {
    let name = master::required(&input.name, NAME_MAX, "name")?;
    let memo = master::optional(&input.memo, MEMO_MAX, "memo")?;
    let account: Option<(AccountCategory, bool, Option<String>)> = conn
        .query_row(
            "SELECT category, is_payment_account, statement_line FROM accounts WHERE id = ?1",
            [input.account_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .optional()?;
    match account {
        None => return Err(AppError::field(ErrorCode::NotFound, "accountId")),
        // 口座や、現金・債権・土地など償却しない資産の科目には登録しない
        Some((AccountCategory::Asset, false, line))
            if !line
                .as_deref()
                .is_some_and(|l| NON_DEPRECIABLE_LINES.contains(&l)) => {}
        Some(_) => return Err(AppError::field(ErrorCode::InvalidFormat, "accountId")),
    }
    let acquired = year_month(&input.acquired_on, "acquiredOn")?;
    let disposed = match input
        .disposed_on
        .as_deref()
        .map(str::trim)
        .filter(|d| !d.is_empty())
    {
        Some(d) => Some(year_month(d, "disposedOn")?),
        None => None,
    };
    // 帳簿価額の年が取得した年以前（ふつうの登録）なら、帳簿価額は取得価額
    let (book_value_year, book_value) = match (input.book_value_year, input.book_value) {
        (Some(y), Some(v)) if y > acquired.0 => (y, v),
        (Some(y), None) if y > acquired.0 => {
            return Err(AppError::field(ErrorCode::Required, "bookValue"))
        }
        _ => (acquired.0, input.cost),
    };
    let useful_life = match input.method {
        // 一括償却資産は耐用年数を使わない
        Method::LumpSum => 0,
        _ => input.useful_life,
    };
    let asset = Asset {
        cost: input.cost,
        acquired,
        method: input.method,
        useful_life,
        business_percent: input.business_percent,
        book_value_year,
        book_value,
        disposed,
    };
    depreciation::validate(&asset)?;
    if asset.method == Method::SmallAsset
        && filing_type(conn, acquired.0)? == Some(FilingType::White)
    {
        return Err(AppError::field(ErrorCode::SmallAssetIneligible, "method"));
    }
    Ok((
        FixedAssetInput {
            name,
            memo,
            useful_life,
            book_value_year: Some(book_value_year),
            book_value: Some(book_value),
            acquired_on: input.acquired_on.trim().to_string(),
            disposed_on: input
                .disposed_on
                .as_deref()
                .map(str::trim)
                .filter(|d| !d.is_empty())
                .map(str::to_string),
            ..input.clone()
        },
        asset,
    ))
}

pub fn get(conn: &Connection, id: i64) -> AppResult<FixedAsset> {
    Ok(conn.query_row(&format!("{SELECT} WHERE f.id = ?1"), [id], from_row)?)
}

pub fn list_all(conn: &Connection) -> AppResult<Vec<FixedAsset>> {
    let mut stmt = conn.prepare(&format!("{SELECT} ORDER BY f.acquired_on, f.id"))?;
    let rows = stmt.query_map([], from_row)?;
    Ok(rows.collect::<Result<_, _>>()?)
}

pub fn create(conn: &Connection, input: &FixedAssetInput) -> AppResult<FixedAsset> {
    let (v, _) = validate(conn, input)?;
    conn.execute(
        "INSERT INTO fixed_assets (name, account_id, acquired_on, cost, useful_life, method, business_percent,
                                   book_value_year, book_value, disposed_on, memo)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
        params![
            v.name,
            v.account_id,
            v.acquired_on,
            v.cost,
            v.useful_life,
            v.method,
            v.business_percent,
            v.book_value_year,
            v.book_value,
            v.disposed_on,
            v.memo
        ],
    )?;
    get(conn, conn.last_insert_rowid())
}

/// 固定資産を登録し、`payment_account_id` があれば、買ったときの支払い（資産 / 支払った口座）も
/// 取引として記録する。取得した年の帳簿があるときだけ使える。
pub fn create_with_purchase(
    db: &Database,
    input: &FixedAssetInput,
    payment_account_id: Option<i64>,
) -> AppResult<FixedAsset> {
    db.transaction(|tx| {
        let asset = create(tx, input)?;
        let Some(payment) = payment_account_id else {
            return Ok(asset);
        };
        let (year, _) = year_month(&asset.acquired_on, "acquiredOn")?;
        if asset.book_value_year != year {
            // 帳簿をつけ始める前に買った資産は、期首残高に入れる
            return Err(AppError::field(ErrorCode::OutOfRange, "paymentAccountId"));
        }
        transactions::insert_kind(
            tx,
            year,
            &TransactionInput {
                date: asset.acquired_on.clone(),
                entry_mode: EntryMode::Compound,
                memo: format!("固定資産の取得（{}）", asset.name),
                lines: vec![
                    LineInput::new(Side::Debit, asset.account_id, asset.cost),
                    LineInput::new(Side::Credit, payment, asset.cost),
                ],
            },
            TransactionKind::Normal,
        )
        .map_err(|e| match e.field {
            Some("date") => AppError::field(e.code, "acquiredOn"),
            Some(_) if e.line == Some(1) => AppError::field(e.code, "paymentAccountId"),
            _ => e,
        })?;
        Ok(asset)
    })
}

pub fn update(conn: &Connection, id: i64, input: &FixedAssetInput) -> AppResult<FixedAsset> {
    let current = get(conn, id)?;
    let (v, next) = validate(conn, input)?;
    if current.in_use {
        let old = current
            .to_asset()
            .ok_or(AppError::new(ErrorCode::Database))?;
        let mut stmt =
            conn.prepare("SELECT fiscal_year FROM depreciation_postings WHERE asset_id = ?1")?;
        for year in stmt.query_map([id], |row| row.get::<_, i64>(0))? {
            let year = year?;
            if current.account_id != v.account_id
                || depreciation::for_year(&old, year) != depreciation::for_year(&next, year)
                || old.disposed.filter(|(y, _)| *y == year)
                    != next.disposed.filter(|(y, _)| *y == year)
            {
                return Err(AppError::new(ErrorCode::InUse));
            }
        }
    }
    conn.execute(
        "UPDATE fixed_assets SET name = ?2, account_id = ?3, acquired_on = ?4, cost = ?5, useful_life = ?6,
             method = ?7, business_percent = ?8, book_value_year = ?9, book_value = ?10, disposed_on = ?11, memo = ?12
         WHERE id = ?1",
        params![
            id,
            v.name,
            v.account_id,
            v.acquired_on,
            v.cost,
            v.useful_life,
            v.method,
            v.business_percent,
            v.book_value_year,
            v.book_value,
            v.disposed_on,
            v.memo
        ],
    )?;
    get(conn, id)
}

/// 削除する。償却を記録したことがあれば削除できない（`InUse`）。
pub fn delete(conn: &Connection, id: i64) -> AppResult<()> {
    if get(conn, id)?.in_use {
        return Err(AppError::new(ErrorCode::InUse));
    }
    conn.execute("DELETE FROM fixed_assets WHERE id = ?1", [id])?;
    Ok(())
}

/// ある年の、資産ごとの償却。
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AssetYear {
    pub asset: FixedAsset,
    /// この年の償却。償却するものがなければ `None`
    pub depreciation: Option<YearDepreciation>,
    /// 記録した取引
    pub transaction_id: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DepreciationYear {
    pub fiscal_year: i64,
    pub assets: Vec<AssetYear>,
    /// この年に取得した、少額減価償却資産の特例の合計（年 300 万円まで）
    pub small_asset_total: i64,
    pub small_asset_limit: i64,
    /// 白色申告の年度（少額減価償却資産の特例は青色申告だけ）
    pub white_filing: bool,
}

fn postings(conn: &Connection, year: i64) -> AppResult<HashMap<i64, i64>> {
    let mut stmt = conn.prepare(
        "SELECT asset_id, transaction_id FROM depreciation_postings WHERE fiscal_year = ?1",
    )?;
    let rows = stmt.query_map([year], |r| Ok((r.get(0)?, r.get(1)?)))?;
    Ok(rows.collect::<Result<_, _>>()?)
}

/// 年 `year` の償却の一覧。その年に持っていた資産（記録した資産も）を出す。
pub fn for_year(conn: &Connection, year: i64) -> AppResult<DepreciationYear> {
    let filing =
        filing_type(conn, year)?.ok_or(AppError::field(ErrorCode::NotFound, "fiscalYear"))?;
    let posted = postings(conn, year)?;
    let mut assets = Vec::new();
    let mut small_asset_total = 0;
    for asset in list_all(conn)? {
        let Some(calc) = asset.to_asset() else {
            continue;
        };
        let held = calc.acquired.0 <= year && calc.disposed.is_none_or(|(y, _)| y >= year);
        let transaction_id = posted.get(&asset.id).copied();
        if !held && transaction_id.is_none() {
            continue;
        }
        if calc.method == Method::SmallAsset && calc.acquired.0 == year {
            small_asset_total += calc.cost;
        }
        assets.push(AssetYear {
            depreciation: depreciation::for_year(&calc, year),
            transaction_id,
            asset,
        });
    }
    Ok(DepreciationYear {
        fiscal_year: year,
        assets,
        small_asset_total,
        small_asset_limit: depreciation::SMALL_ASSET_YEARLY_LIMIT,
        white_filing: filing == FilingType::White,
    })
}

/// 選んだ資産の、年 `year` の償却を仕訳にする。記録済み・償却のない資産は飛ばす。
/// 経費（減価償却費）と事業主貸 / 資産の科目。日付は年末（年の途中で手放したら手放した月の末日）。
pub fn record(db: &Database, year: i64, asset_ids: &[i64]) -> AppResult<usize> {
    db.transaction(|tx| {
        ensure_year_open(tx, year)?;
        let expense = account_by_line(tx, "pl.depreciation")?;
        let drawings = account_by_line(tx, "bs.owner_drawings")?;
        let filing = filing_type(tx, year)?;
        let posted = postings(tx, year)?;
        let mut small_asset_total: i64 = tx.query_row(
            "SELECT coalesce(sum(f.cost), 0) FROM depreciation_postings p
             JOIN fixed_assets f ON f.id = p.asset_id
             WHERE p.fiscal_year = ?1 AND f.method = 'small_asset'",
            [year], |row| row.get(0),
        )?;
        let mut seen = std::collections::HashSet::new();
        let mut count = 0;
        for &id in asset_ids {
            let asset = get(tx, id).map_err(|_| AppError::field(ErrorCode::NotFound, "assetId"))?;
            if posted.contains_key(&id) || !seen.insert(id) {
                continue;
            }
            let Some(calc) = asset.to_asset() else { continue };
            let Some(d) = depreciation::for_year(&calc, year) else { continue };
            if calc.method == Method::SmallAsset {
                if filing == Some(FilingType::White) {
                    return Err(AppError::new(ErrorCode::SmallAssetIneligible));
                }
                depreciation::validate(&calc)?;
                small_asset_total += calc.cost;
                if small_asset_total > depreciation::SMALL_ASSET_YEARLY_LIMIT {
                    return Err(AppError::new(ErrorCode::SmallAssetLimit));
                }
            }
            let date = match calc.disposed {
                Some((y, m)) if y == year => format!("{y:04}-{m:02}-{:02}", journal::days_in_month(y, m)),
                _ => format!("{year:04}-12-31"),
            };
            let mut lines = Vec::new();
            if d.business > 0 {
                lines.push(LineInput::new(Side::Debit, expense, d.business));
            }
            if d.private > 0 {
                lines.push(LineInput::new(Side::Debit, drawings, d.private));
            }
            lines.push(LineInput::new(Side::Credit, asset.account_id, d.depreciation));
            let t = transactions::insert_kind(
                tx,
                year,
                &TransactionInput {
                    date,
                    entry_mode: EntryMode::Compound,
                    memo: format!("減価償却（{}）", asset.name),
                    lines,
                },
                TransactionKind::Depreciation,
            )?;
            tx.execute(
                "INSERT INTO depreciation_postings (asset_id, fiscal_year, transaction_id) VALUES (?1, ?2, ?3)",
                params![id, year, t.id],
            )?;
            count += 1;
        }
        Ok(count)
    })
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use crate::test_support::{account, pc, set_up_db};

    #[test]
    fn records_the_purchase_with_the_asset() {
        let db = set_up_db();
        let (tools, cash) = {
            let conn = db.conn();
            (account(&conn, "115"), account(&conn, "101"))
        };
        let asset = create_with_purchase(&db, &pc(tools), Some(cash)).unwrap();
        let conn = db.conn();
        let t = transactions::list(&conn, 2026, Some(4)).unwrap();
        assert_eq!(t.len(), 1);
        assert_eq!(t[0].date, asset.acquired_on);
        assert_eq!(
            t[0].lines
                .iter()
                .map(|l| (l.side, l.account_id, l.amount))
                .collect::<Vec<_>>(),
            [(Side::Debit, tools, 240_000), (Side::Credit, cash, 240_000)]
        );
        drop(conn);
        // 支払いを記録できなければ、資産も登録しない
        let mut later = pc(tools);
        later.acquired_on = "2025-04-10".into();
        later.book_value_year = Some(2026);
        later.book_value = Some(180_000);
        let err = create_with_purchase(&db, &later, Some(cash)).unwrap_err();
        assert_eq!(err.field, Some("paymentAccountId"));
        assert_eq!(for_year(&db.conn(), 2026).unwrap().assets.len(), 1);
    }

    #[test]
    fn rejects_accounts_that_are_not_depreciated() {
        let db = set_up_db();
        let conn = db.conn();
        for code in ["101", "106", "116", "199"] {
            let err = create(&conn, &pc(account(&conn, code))).unwrap_err();
            assert_eq!(err.code, ErrorCode::InvalidFormat, "{code}");
        }
        assert!(create(&conn, &pc(account(&conn, "113"))).is_ok());
    }

    #[test]
    fn registers_assets_and_records_depreciation_once() {
        let db = set_up_db();
        let tools = account(&db.conn(), "115");
        let asset = create(&db.conn(), &pc(tools)).unwrap();
        assert_eq!((asset.book_value_year, asset.book_value), (2026, 240_000));

        let year = for_year(&db.conn(), 2026).unwrap();
        let d = year.assets[0].depreciation.unwrap();
        assert_eq!(
            (d.depreciation, d.business, d.private),
            (45_000, 27_000, 18_000)
        );
        assert_eq!(year.assets[0].transaction_id, None);

        assert_eq!(record(&db, 2026, &[asset.id]).unwrap(), 1);
        // 2 回押しても 2 重にならない
        assert_eq!(record(&db, 2026, &[asset.id]).unwrap(), 0);
        let conn = db.conn();
        let year = for_year(&conn, 2026).unwrap();
        let tid = year.assets[0].transaction_id.unwrap();
        let t = transactions::get(&conn, tid).unwrap();
        assert_eq!(t.kind, TransactionKind::Depreciation);
        assert_eq!(t.date, "2026-12-31");
        let amounts: Vec<(Side, i64, i64)> = t
            .lines
            .iter()
            .map(|l| (l.side, l.account_id, l.amount))
            .collect();
        assert_eq!(
            amounts,
            [
                (Side::Debit, account(&conn, "611"), 27_000),
                (Side::Debit, account(&conn, "199"), 18_000),
                (Side::Credit, tools, 45_000),
            ]
        );
        // 記録した資産は削除できない
        assert_eq!(delete(&conn, asset.id).unwrap_err().code, ErrorCode::InUse);
        drop(conn);
        // 取引を消すと、また候補に戻る
        transactions::delete(&db, tid).unwrap();
        assert_eq!(
            for_year(&db.conn(), 2026).unwrap().assets[0].transaction_id,
            None
        );
        delete(&db.conn(), asset.id).unwrap();
    }

    #[test]
    fn assets_carried_over_from_another_book() {
        let db = set_up_db();
        let conn = db.conn();
        let vehicles = account(&conn, "114");
        let mut car = pc(vehicles);
        car.name = "車".into();
        car.acquired_on = "2022-01-05".into();
        car.cost = 2_000_000;
        car.useful_life = 6;
        car.business_percent = 100;
        // 2026 年の初めの帳簿価額を入れずに、取得より後の年を選ぶと入力を求める
        car.book_value_year = Some(2026);
        assert_eq!(
            create(&conn, &car).unwrap_err(),
            AppError::field(ErrorCode::Required, "bookValue")
        );
        car.book_value = Some(333_336);
        let asset = create(&conn, &car).unwrap();
        // 定額法 2,000,000 × 0.167 = 334,000 だが、1 円を残す
        let d = for_year(&conn, 2026).unwrap().assets[0]
            .depreciation
            .unwrap();
        assert_eq!(
            (d.opening_book_value, d.depreciation, d.closing_book_value),
            (333_336, 333_335, 1)
        );
        assert_eq!(asset.book_value_year, 2026);
    }

    #[test]
    fn rejects_bad_input() {
        let db = set_up_db();
        let conn = db.conn();
        let sales = account(&conn, "401");
        assert_eq!(
            create(&conn, &pc(sales)).unwrap_err(),
            AppError::field(ErrorCode::InvalidFormat, "accountId")
        );
        let tools = account(&conn, "115");
        let mut bad = pc(tools);
        bad.name = " ".into();
        assert_eq!(create(&conn, &bad).unwrap_err().field, Some("name"));
        let mut bad = pc(tools);
        bad.acquired_on = "2026-13-01".into();
        assert_eq!(create(&conn, &bad).unwrap_err().field, Some("acquiredOn"));
        let mut small = pc(tools);
        small.method = Method::SmallAsset;
        small.cost = 250_000;
        create(&conn, &small).unwrap();
        let year = for_year(&conn, 2026).unwrap();
        assert_eq!(year.small_asset_total, 250_000);
        assert!(!year.white_filing);
    }
}
