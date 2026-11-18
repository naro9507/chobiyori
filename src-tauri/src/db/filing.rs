//! 確定申告・消費税の申告・インボイスの登録の補助（F12）。
//!
//! 計算は `domain::filing` で行い、ここでは帳簿から材料を読み、記録を書く。
//! アプリから国税庁などへは何も送らない（登録番号は利用者が公表サイトで確かめる）。

use super::{audit, closing, setup, Database};
use crate::domain::filing::{self, ConsumptionTax, DeadlineKind, Rate, SalesAmount};
use crate::domain::journal;
use crate::domain::master::{self, FilingType, TaxCategory, TaxStatus};
use crate::error::{AppError, AppResult, ErrorCode};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

// ---- インボイスの登録 ----

/// インボイスの登録日。登録していなければ `None`。
pub(crate) fn registered_on(conn: &Connection) -> AppResult<Option<String>> {
    Ok(conn
        .query_row(
            "SELECT invoice_registered_on FROM business_profile WHERE id = 1",
            [],
            |r| r.get::<_, Option<String>>(0),
        )
        .optional()?
        .flatten())
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InvoiceRegistration {
    pub registration_no: Option<String>,
    pub registered_on: Option<String>,
    /// 簡易課税の事業の区分（既定）
    pub simplified_category: Option<i64>,
    /// 登録番号のチェックディジットが合うか（形が違えば `None`）
    pub check_digit_ok: Option<bool>,
}

pub fn registration(conn: &Connection) -> AppResult<InvoiceRegistration> {
    let row: Option<(Option<String>, Option<String>, Option<i64>)> = conn
        .query_row(
            "SELECT invoice_registration_no, invoice_registered_on, simplified_tax_category
             FROM business_profile WHERE id = 1",
            [],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .optional()?;
    let (registration_no, registered_on, simplified_category) =
        row.ok_or(AppError::new(ErrorCode::NotSetUp))?;
    Ok(InvoiceRegistration {
        check_digit_ok: registration_no.as_deref().and_then(filing::check_digit_ok),
        registration_no,
        registered_on,
        simplified_category,
    })
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RegistrationInput {
    pub registration_no: String,
    pub registered_on: String,
    /// 登録日からの消費税の計算のしかた（免税は選べない）
    pub tax_status: TaxStatus,
    #[serde(default)]
    pub simplified_category: Option<i64>,
}

fn valid_category(category: Option<i64>) -> AppResult<Option<i64>> {
    match category {
        Some(c) if !filing::valid_category(c) => {
            Err(AppError::field(ErrorCode::OutOfRange, "simplifiedCategory"))
        }
        other => Ok(other),
    }
}

/// 登録番号と登録日を保存する。登録日の年からの、まだ免税の年度（締めていないもの）を
/// 選んだ計算のしかたの課税事業者にする。登録日の前の取引は免税のまま扱う。
pub fn save_registration(
    db: &Database,
    input: &RegistrationInput,
) -> AppResult<InvoiceRegistration> {
    let no = master::invoice_registration_no(Some(&input.registration_no))?
        .ok_or(AppError::field(ErrorCode::Required, "registrationNo"))?;
    let (year, _, _) = journal::parse_date(input.registered_on.trim())
        .ok_or(AppError::field(ErrorCode::InvalidFormat, "registeredOn"))?;
    if input.tax_status == TaxStatus::Exempt {
        return Err(AppError::field(ErrorCode::OutOfRange, "taxStatus"));
    }
    let category = valid_category(input.simplified_category)?;
    if input.tax_status == TaxStatus::Simplified && category.is_none() {
        return Err(AppError::field(ErrorCode::Required, "simplifiedCategory"));
    }
    db.transaction(|tx| {
        let changed = tx.execute(
            "UPDATE business_profile
             SET invoice_registration_no = ?1, invoice_registered_on = ?2,
                 simplified_tax_category = coalesce(?3, simplified_tax_category),
                 updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
             WHERE id = 1",
            params![no, input.registered_on.trim(), category],
        )?;
        if changed == 0 {
            return Err(AppError::new(ErrorCode::NotSetUp));
        }
        tx.execute(
            "UPDATE fiscal_years SET tax_status = ?1
             WHERE year >= ?2 AND tax_status = 'exempt' AND status = 'open'",
            params![input.tax_status, year],
        )?;
        audit::event(
            tx,
            "invoice_registration",
            "save",
            Some(year),
            Some(serde_json::json!({ "registeredOn": input.registered_on.trim(), "taxStatus": input.tax_status })),
        )?;
        registration(tx)
    })
}

/// 簡易課税の事業の区分（既定）を変える。
pub fn set_simplified_category(
    conn: &Connection,
    category: Option<i64>,
) -> AppResult<InvoiceRegistration> {
    let category = valid_category(category)?;
    conn.execute(
        "UPDATE business_profile SET simplified_tax_category = ?1 WHERE id = 1",
        [category],
    )?;
    registration(conn)
}

/// 売上の科目ごとの事業の区分（`None` なら既定の区分）。
pub fn set_account_category(
    conn: &Connection,
    account_id: i64,
    category: Option<i64>,
) -> AppResult<()> {
    let category = valid_category(category)?;
    let changed = conn.execute(
        "UPDATE accounts SET simplified_tax_category = ?2 WHERE id = ?1",
        params![account_id, category],
    )?;
    if changed == 0 {
        return Err(AppError::field(ErrorCode::NotFound, "accountId"));
    }
    Ok(())
}

// ---- 消費税 ----

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountSales {
    pub account_id: i64,
    pub rate: Rate,
    /// 簡易課税の事業の区分（科目の区分か既定の区分）。決まっていなければ `None`
    pub category: Option<i64>,
    /// 科目に区分を決めてあるか（既定の区分を使っていない）
    pub account_category: Option<i64>,
    pub tax_included: i64,
}

/// 本則課税のための、税区分ごとの集計（計算はしない）。
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaxCategorySummary {
    pub tax_category: TaxCategory,
    pub debit: i64,
    pub credit: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConsumptionReport {
    pub fiscal_year: i64,
    pub tax_status: TaxStatus,
    /// 課税として扱う最初の日。課税の取引がない年度は `None`（消費税の申告の補助は出さない）
    pub taxable_from: Option<String>,
    /// 2 割特例の期間の年か
    pub special20_period: bool,
    /// 簡易課税の事業の区分が決まっていない売上がある
    pub needs_category: bool,
    pub tax: ConsumptionTax,
    /// 本則課税で納める額の目安（仕入れの税区分とインボイスの印から）
    pub standard: filing::StandardEstimate,
    pub accounts: Vec<AccountSales>,
    pub summary: Vec<TaxCategorySummary>,
}

fn year_status(conn: &Connection, year: i64) -> AppResult<TaxStatus> {
    conn.query_row(
        "SELECT tax_status FROM fiscal_years WHERE year = ?1",
        [year],
        |r| r.get(0),
    )
    .optional()?
    .ok_or(AppError::field(ErrorCode::NotFound, "fiscalYear"))
}

/// 年度で課税として扱う最初の日。
pub(crate) fn taxable_from(conn: &Connection, year: i64) -> AppResult<Option<String>> {
    let status = year_status(conn, year)?;
    Ok(filing::taxable_from(
        year,
        status == TaxStatus::Exempt,
        registered_on(conn)?.as_deref(),
    ))
}

/// 消費税の申告の補助。税区分の記録（課税売上 10% / 軽減 8%）から計算する。
pub fn consumption(conn: &Connection, year: i64) -> AppResult<ConsumptionReport> {
    let tax_status = year_status(conn, year)?;
    let from = taxable_from(conn, year)?;
    let start = from.clone().unwrap_or_else(|| format!("{:04}-12-32", year));
    let default_category: Option<i64> = conn
        .query_row(
            "SELECT simplified_tax_category FROM business_profile WHERE id = 1",
            [],
            |r| r.get(0),
        )
        .optional()?
        .flatten();

    let mut stmt = conn.prepare(
        "SELECT l.account_id, l.tax_category, a.simplified_tax_category,
                sum(CASE WHEN l.side = 'credit' THEN l.amount ELSE -l.amount END)
         FROM journal_lines l
         JOIN transactions t ON t.id = l.transaction_id
         JOIN accounts a ON a.id = l.account_id
         WHERE t.fiscal_year = ?1 AND t.date >= ?2
           AND l.tax_category IN ('taxable_sales_10', 'taxable_sales_8')
         GROUP BY l.account_id, l.tax_category
         ORDER BY l.account_id, l.tax_category",
    )?;
    let accounts: Vec<AccountSales> = stmt
        .query_map(params![year, start], |r| {
            let tax: TaxCategory = r.get(1)?;
            let account_category: Option<i64> = r.get(2)?;
            Ok(AccountSales {
                account_id: r.get(0)?,
                rate: if tax == TaxCategory::TaxableSales8 {
                    Rate::Reduced8
                } else {
                    Rate::Standard10
                },
                category: account_category.or(default_category),
                account_category,
                tax_included: r.get(3)?,
            })
        })?
        .collect::<Result<_, _>>()?;
    let needs_category = accounts
        .iter()
        .any(|a| a.category.is_none() && a.tax_included != 0);
    let sales: Vec<SalesAmount> = accounts
        .iter()
        .map(|a| SalesAmount {
            rate: a.rate,
            category: a.category.unwrap_or(0),
            tax_included: a.tax_included,
        })
        .collect();

    let mut stmt = conn.prepare(
        "SELECT l.tax_category,
                coalesce(sum(CASE WHEN l.side = 'debit' THEN l.amount END), 0),
                coalesce(sum(CASE WHEN l.side = 'credit' THEN l.amount END), 0)
         FROM journal_lines l
         JOIN transactions t ON t.id = l.transaction_id
         WHERE t.fiscal_year = ?1 AND t.date >= ?2
           AND l.tax_category IS NOT NULL AND l.tax_category <> 'out_of_scope'
         GROUP BY l.tax_category",
    )?;
    let mut summary: Vec<TaxCategorySummary> = stmt
        .query_map(params![year, start], |r| {
            Ok(TaxCategorySummary {
                tax_category: r.get(0)?,
                debit: r.get(1)?,
                credit: r.get(2)?,
            })
        })?
        .collect::<Result<_, _>>()?;
    summary.sort_by_key(|s| {
        TaxCategory::ALL
            .iter()
            .position(|c| *c == s.tax_category)
            .unwrap_or(usize::MAX)
    });

    // 本則課税の目安: 課税仕入れ（税込。返品は引く）を、税率・インボイスの印・日付ごとに
    let mut stmt = conn.prepare(
        "SELECT l.tax_category, l.is_qualified_invoice, t.date,
                sum(CASE WHEN l.side = 'debit' THEN l.amount ELSE -l.amount END)
         FROM journal_lines l
         JOIN transactions t ON t.id = l.transaction_id
         WHERE t.fiscal_year = ?1 AND t.date >= ?2
           AND l.tax_category IN ('taxable_purchase_10', 'taxable_purchase_8')
         GROUP BY l.tax_category, l.is_qualified_invoice, t.date",
    )?;
    let purchases: Vec<filing::PurchaseAmount> = stmt
        .query_map(params![year, start], |r| {
            let tax: TaxCategory = r.get(0)?;
            Ok(filing::PurchaseAmount {
                rate: if tax == TaxCategory::TaxablePurchase8 {
                    Rate::Reduced8
                } else {
                    Rate::Standard10
                },
                qualified: r.get(1)?,
                date: r.get(2)?,
                tax_included: r.get(3)?,
            })
        })?
        .collect::<Result<_, _>>()?;
    let tax = filing::consumption_tax(year, &sales);

    Ok(ConsumptionReport {
        fiscal_year: year,
        tax_status,
        special20_period: filing::special20_year(year),
        needs_category,
        standard: filing::standard_estimate(tax.national_tax, &purchases),
        tax,
        taxable_from: from,
        accounts,
        summary,
    })
}

// ---- 確定申告 ----

/// 作成コーナーに入れる値。`label_ja` が空のものは、画面が `key` から文言を選ぶ。
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GuideItem {
    pub key: String,
    /// 様式の欄の番号（分かるときだけ）
    pub no: String,
    pub label_ja: String,
    pub label_en: String,
    pub value: i64,
    /// 小計・合計（作成コーナーでは自動で出るので、確かめるだけ）
    pub total: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GuideSection {
    /// pl（損益計算書）・monthly（月別の売上と仕入）・depreciation（減価償却）・bs（貸借対照表）・return（申告書）
    pub key: String,
    pub items: Vec<GuideItem>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IncomeGuide {
    pub fiscal_year: i64,
    pub filing_type: FilingType,
    pub sections: Vec<GuideSection>,
    /// 申告書の事業所得（営業等）の収入金額
    pub business_revenue: i64,
    /// 青色申告特別控除の前の所得
    pub income_before_deduction: i64,
    /// 青色申告特別控除の額（申告区分のとおり）
    pub deduction: i64,
    /// e-Tax でも優良な電子帳簿でもないときの控除の額（65 万円 → 55 万円）
    pub deduction_on_paper: i64,
    /// 申告書の事業所得の所得金額
    pub income: i64,
    /// 決算書の金額に直すところがある（決算の画面で確かめる）
    pub issue_count: usize,
}

fn item(key: &str, no: &str, ja: &str, en: &str, value: i64, total: bool) -> GuideItem {
    GuideItem {
        key: key.to_string(),
        no: no.to_string(),
        label_ja: ja.to_string(),
        label_en: en.to_string(),
        value,
        total,
    }
}

/// 確定申告の補助。決算書の金額（F6-5）を、作成コーナーの入力の順に並べる。
pub fn income_guide(conn: &Connection, year: i64) -> AppResult<IncomeGuide> {
    let amounts = closing::statement(conn, year)?;
    let st = &amounts.statement;
    let pl: Vec<GuideItem> = st
        .pl
        .iter()
        .filter(|l| l.total || l.amount != 0)
        .map(|l| item(&l.key, &l.no, &l.label_ja, &l.label_en, l.amount, l.total))
        .collect();
    let monthly: Vec<GuideItem> = amounts
        .monthly
        .iter()
        .flat_map(|m| {
            [
                item(&format!("sales_{}", m.month), "", "", "", m.sales, false),
                item(
                    &format!("purchases_{}", m.month),
                    "",
                    "",
                    "",
                    m.purchases,
                    false,
                ),
            ]
        })
        .chain([
            item(
                "personal_consumption",
                "",
                "",
                "",
                amounts.personal_consumption,
                false,
            ),
            item("misc_income", "", "", "", amounts.misc_income, false),
        ])
        .collect();
    let depreciation: Vec<GuideItem> = amounts
        .depreciation
        .iter()
        .map(|d| {
            item(
                &format!("asset_{}", d.asset_id),
                "",
                &d.name,
                &d.name,
                d.business,
                false,
            )
        })
        .collect();
    let bs: Vec<GuideItem> = st
        .bs
        .iter()
        .filter(|l| l.closing != 0 || l.opening.is_some_and(|o| o != 0))
        .map(|l| item(&l.key, "", &l.label_ja, &l.label_en, l.closing, false))
        .collect();
    let business_revenue = st
        .pl
        .iter()
        .find(|l| l.key == "sales")
        .map_or(0, |l| l.amount);
    let deduction_on_paper = st.deduction.min(filing::paper_deduction_cap());
    let mut returns = vec![
        item("return_revenue", "ア", "", "", business_revenue, false),
        item("return_income", "①", "", "", st.income, false),
        item("return_deduction", "", "", "", st.deduction, false),
    ];
    if amounts.filing_type == crate::domain::master::FilingType::White {
        returns.retain(|item| item.key != "return_deduction");
    }
    Ok(IncomeGuide {
        fiscal_year: year,
        filing_type: amounts.filing_type,
        sections: vec![
            GuideSection {
                key: "pl".into(),
                items: pl,
            },
            GuideSection {
                key: "monthly".into(),
                items: monthly,
            },
            GuideSection {
                key: "depreciation".into(),
                items: depreciation,
            },
            GuideSection {
                key: "bs".into(),
                items: bs,
            },
            GuideSection {
                key: "return".into(),
                items: returns,
            },
        ],
        business_revenue,
        income_before_deduction: st.income_before_deduction,
        deduction: st.deduction,
        deduction_on_paper,
        income: st.income,
        issue_count: st.issues.len(),
    })
}

// ---- チェックリスト ----

/// 確定申告のチェックリストの項目（並び順）。
pub const INCOME_ITEMS: &[&str] = &[
    "statement_checked",
    "my_number_card",
    "deduction_certificates",
    "corner_business",
    "corner_deductions",
    "submitted",
    "paid",
];

/// 消費税の申告のチェックリストの項目（課税の年度だけ）。
pub const CONSUMPTION_ITEMS: &[&str] = &[
    "consumption_method",
    "consumption_corner",
    "consumption_submitted",
    "consumption_paid",
];

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChecklistItem {
    pub key: String,
    pub group: DeadlineKind,
    pub done_at: Option<String>,
}

fn done_map(conn: &Connection, year: i64) -> AppResult<HashMap<String, String>> {
    let mut stmt =
        conn.prepare("SELECT item, done_at FROM filing_checklists WHERE fiscal_year = ?1")?;
    let rows = stmt.query_map([year], |r| Ok((r.get(0)?, r.get(1)?)))?;
    Ok(rows.collect::<Result<_, _>>()?)
}

pub fn checklist(conn: &Connection, year: i64) -> AppResult<Vec<ChecklistItem>> {
    let done = done_map(conn, year)?;
    let consumption = taxable_from(conn, year)?.is_some();
    let make = |items: &[&str], group| -> Vec<ChecklistItem> {
        items
            .iter()
            .map(|k| ChecklistItem {
                key: k.to_string(),
                group,
                done_at: done.get(*k).cloned(),
            })
            .collect()
    };
    let mut list = make(INCOME_ITEMS, DeadlineKind::Income);
    if consumption {
        list.extend(make(CONSUMPTION_ITEMS, DeadlineKind::Consumption));
    }
    Ok(list)
}

pub fn set_check(
    conn: &Connection,
    year: i64,
    key: &str,
    done: bool,
) -> AppResult<Vec<ChecklistItem>> {
    if !INCOME_ITEMS.contains(&key) && !CONSUMPTION_ITEMS.contains(&key) {
        return Err(AppError::field(ErrorCode::NotFound, "item"));
    }
    year_status(conn, year)?;
    if done {
        conn.execute(
            "INSERT OR IGNORE INTO filing_checklists (fiscal_year, item) VALUES (?1, ?2)",
            params![year, key],
        )?;
    } else {
        conn.execute(
            "DELETE FROM filing_checklists WHERE fiscal_year = ?1 AND item = ?2",
            params![year, key],
        )?;
    }
    checklist(conn, year)
}

// ---- 期限のお知らせ ----

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeadlineNotice {
    pub kind: DeadlineKind,
    pub fiscal_year: i64,
    pub date: String,
    /// 年度のデータになく、土日だけをずらした目安
    pub estimated: bool,
    /// 残りの日数（過ぎていれば負）
    pub days_left: i64,
    pub submitted: bool,
    pub done: usize,
    pub total: usize,
}

/// 期限の何日前から知らせるか。
const NOTICE_FROM_DAYS: i64 = 75;
/// 期限を過ぎて何日まで知らせるか（チェックリストが終わっていないとき）。
const NOTICE_AFTER_DAYS: i64 = 30;

/// ホームに出す申告期限のお知らせ。`today` は画面の日付（`YYYY-MM-DD`）。
pub fn deadlines(conn: &Connection, today: &str) -> AppResult<Vec<DeadlineNotice>> {
    if journal::parse_date(today).is_none() {
        return Err(AppError::field(ErrorCode::InvalidFormat, "today"));
    }
    let mut notices = Vec::new();
    for fy in setup::fiscal_years(conn)? {
        let list = checklist(conn, fy.year)?;
        for kind in [DeadlineKind::Income, DeadlineKind::Consumption] {
            let items: Vec<&ChecklistItem> = list.iter().filter(|i| i.group == kind).collect();
            if items.is_empty() {
                continue;
            }
            let (date, from_data) = filing::deadline(fy.year, kind);
            let Some(days_left) = filing::days_between(today, &date) else {
                continue;
            };
            let done = items.iter().filter(|i| i.done_at.is_some()).count();
            let total = items.len();
            let show = (0..=NOTICE_FROM_DAYS).contains(&days_left)
                || ((-NOTICE_AFTER_DAYS..0).contains(&days_left) && done < total);
            if show {
                let submitted_key = match kind {
                    DeadlineKind::Income => "submitted",
                    DeadlineKind::Consumption => "consumption_submitted",
                };
                let submitted = items
                    .iter()
                    .any(|item| item.key == submitted_key && item.done_at.is_some());
                notices.push(DeadlineNotice {
                    kind,
                    fiscal_year: fy.year,
                    date,
                    estimated: !from_data,
                    days_left,
                    submitted,
                    done,
                    total,
                });
            }
        }
    }
    notices.sort_by_key(|n| n.days_left);
    Ok(notices)
}

// ---- 登録番号の確認 ----

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum CheckResult {
    Confirmed,
    Revoked,
}

impl CheckResult {
    fn as_str(self) -> &'static str {
        match self {
            CheckResult::Confirmed => "confirmed",
            CheckResult::Revoked => "revoked",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NumberStatus {
    pub registration_no: String,
    pub check_digit_ok: Option<bool>,
    pub last_result: Option<CheckResult>,
    /// 最後に確かめた日（`YYYY-MM-DD`）
    pub last_checked_on: Option<String>,
    /// まだ確かめていない・1 年以上たった・取り消されていた
    pub needs_check: bool,
}

/// 何日たったら、また確かめるよう知らせるか。
const RECHECK_DAYS: i64 = 365;

pub fn number_status(
    conn: &Connection,
    registration_no: &str,
    today: &str,
) -> AppResult<NumberStatus> {
    let no = master::invoice_registration_no(Some(registration_no))?
        .ok_or(AppError::field(ErrorCode::Required, "registrationNo"))?;
    let last: Option<(String, String)> = conn
        .query_row(
            "SELECT result, substr(checked_at, 1, 10) FROM invoice_checks
             WHERE registration_no = ?1 ORDER BY checked_at DESC, id DESC LIMIT 1",
            [&no],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()?;
    let last_result = last.as_ref().map(|(r, _)| {
        if r == "revoked" {
            CheckResult::Revoked
        } else {
            CheckResult::Confirmed
        }
    });
    let last_checked_on = last.map(|(_, d)| d);
    let stale = last_checked_on
        .as_deref()
        .and_then(|d| filing::days_between(d, today))
        .is_none_or(|days| days > RECHECK_DAYS);
    Ok(NumberStatus {
        check_digit_ok: filing::check_digit_ok(&no),
        needs_check: stale || last_result == Some(CheckResult::Revoked),
        registration_no: no,
        last_result,
        last_checked_on,
    })
}

/// 利用者が公表サイトで確かめた結果を残す。
pub fn record_check(
    conn: &Connection,
    registration_no: &str,
    result: CheckResult,
    today: &str,
) -> AppResult<NumberStatus> {
    let no = master::invoice_registration_no(Some(registration_no))?
        .ok_or(AppError::field(ErrorCode::Required, "registrationNo"))?;
    conn.execute(
        "INSERT INTO invoice_checks (registration_no, result) VALUES (?1, ?2)",
        params![no, result.as_str()],
    )?;
    number_status(conn, &no, today)
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PartnerCheck {
    pub partner_id: i64,
    pub status: NumberStatus,
}

/// 登録番号のある、使っている取引先の確認の状況。
pub fn partner_checks(conn: &Connection, today: &str) -> AppResult<Vec<PartnerCheck>> {
    let mut stmt = conn.prepare(
        "SELECT id, invoice_registration_no FROM partners
         WHERE is_active = 1 AND invoice_registration_no IS NOT NULL ORDER BY sort, code",
    )?;
    let rows: Vec<(i64, String)> = stmt
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?
        .collect::<Result<_, _>>()?;
    rows.into_iter()
        .map(|(partner_id, no)| {
            Ok(PartnerCheck {
                partner_id,
                status: number_status(conn, &no, today)?,
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::setup::tests::set_up_db;
    use crate::db::transactions::tests::account;
    use crate::db::transactions::{create, get};
    use crate::domain::journal::{EntryMode, LineInput, Side, TransactionInput};

    fn line(side: Side, account_id: i64, amount: i64, tax: Option<TaxCategory>) -> LineInput {
        LineInput {
            tax_category: tax,
            ..LineInput::new(side, account_id, amount)
        }
    }

    fn sale(db: &Database, date: &str, amount: i64, tax: TaxCategory) -> i64 {
        let (bank, sales) = {
            let conn = db.conn();
            (account(&conn, "104"), account(&conn, "401"))
        };
        create(
            db,
            2026,
            &TransactionInput {
                date: date.into(),
                entry_mode: EntryMode::Grid,
                memo: String::new(),
                lines: vec![
                    line(Side::Debit, bank, amount, None),
                    line(Side::Credit, sales, amount, Some(tax)),
                ],
            },
        )
        .unwrap()
        .id
    }

    fn register(
        db: &Database,
        date: &str,
        status: TaxStatus,
        category: Option<i64>,
    ) -> AppResult<InvoiceRegistration> {
        save_registration(
            db,
            &RegistrationInput {
                registration_no: "T7000012050002".into(),
                registered_on: date.into(),
                tax_status: status,
                simplified_category: category,
            },
        )
    }

    #[test]
    fn mid_year_registration_splits_the_year() {
        let db = set_up_db();
        // 免税の年度（2026）。登録前の 3 月の売上は対象外で保存される
        let before = sale(&db, "2026-03-10", 110_000, TaxCategory::TaxableSales10);
        assert!(consumption(&db.conn(), 2026)
            .unwrap()
            .taxable_from
            .is_none());

        let reg = register(&db, "2026-10-01", TaxStatus::Special20, Some(5)).unwrap();
        assert_eq!(reg.registered_on.as_deref(), Some("2026-10-01"));
        assert_eq!(reg.check_digit_ok, Some(true));
        let years = setup::fiscal_years(&db.conn()).unwrap();
        assert_eq!(years[0].tax_status, TaxStatus::Special20);

        // 登録日から課税: 10 月の売上は税区分が残り、9 月の売上は対象外
        let after = sale(&db, "2026-10-05", 220_000, TaxCategory::TaxableSales10);
        let sep = sale(&db, "2026-09-30", 55_000, TaxCategory::TaxableSales10);
        let conn = db.conn();
        let tax_of = |id| get(&conn, id).unwrap().lines[1].tax_category;
        assert_eq!(tax_of(before), Some(TaxCategory::OutOfScope));
        assert_eq!(tax_of(sep), Some(TaxCategory::OutOfScope));
        assert_eq!(tax_of(after), Some(TaxCategory::TaxableSales10));

        // 消費税は登録日からの取引だけ: 220,000 → 200,000、× 7.8% = 15,600
        let report = consumption(&conn, 2026).unwrap();
        assert_eq!(report.taxable_from.as_deref(), Some("2026-10-01"));
        assert_eq!(report.tax.national_tax, 15_600);
        assert!(report.special20_period);
        assert!(!report.needs_category);
        // 2 割特例: 15,600 − 12,480 = 3,120 → 3,100、地方 874 → 800
        assert_eq!(report.tax.special20.as_ref().unwrap().total, 3_900);
    }

    #[test]
    fn registration_needs_a_taxable_method_and_a_category_for_simplified() {
        let db = set_up_db();
        assert_eq!(
            register(&db, "2026-01-01", TaxStatus::Exempt, None).unwrap_err(),
            AppError::field(ErrorCode::OutOfRange, "taxStatus")
        );
        assert_eq!(
            register(&db, "2026-01-01", TaxStatus::Simplified, None).unwrap_err(),
            AppError::field(ErrorCode::Required, "simplifiedCategory")
        );
        assert_eq!(
            register(&db, "2026-01-01", TaxStatus::Simplified, Some(7)).unwrap_err(),
            AppError::field(ErrorCode::OutOfRange, "simplifiedCategory")
        );
        assert_eq!(
            register(&db, "2026-02-30", TaxStatus::Standard, None).unwrap_err(),
            AppError::field(ErrorCode::InvalidFormat, "registeredOn")
        );
    }

    #[test]
    fn simplified_uses_account_categories_over_the_default() {
        let db = set_up_db();
        register(&db, "2026-01-01", TaxStatus::Simplified, Some(5)).unwrap();
        sale(&db, "2026-04-01", 1_100_000, TaxCategory::TaxableSales10);
        let conn = db.conn();
        let report = consumption(&conn, 2026).unwrap();
        assert_eq!(report.accounts[0].category, Some(5));
        assert_eq!(report.tax.simplified.deductible, 39_000);
        // 売上の科目を第 1 種にする: 78,000 × 90% = 70,200 を引ける
        set_account_category(&conn, account(&conn, "401"), Some(1)).unwrap();
        let report = consumption(&conn, 2026).unwrap();
        assert_eq!(report.tax.simplified.deductible, 70_200);
        assert_eq!(report.tax.simplified.national, 7_800);
        // 区分が決まっていなければ知らせる
        set_account_category(&conn, account(&conn, "401"), None).unwrap();
        set_simplified_category(&conn, None).unwrap();
        conn.execute(
            "UPDATE business_profile SET simplified_tax_category = NULL",
            [],
        )
        .unwrap();
        assert!(consumption(&conn, 2026).unwrap().needs_category);
    }

    #[test]
    fn checklist_and_deadline_notices() {
        let db = set_up_db();
        let conn = db.conn();
        // 免税の年度は確定申告の項目だけ
        let list = checklist(&conn, 2026).unwrap();
        assert_eq!(list.len(), INCOME_ITEMS.len());
        set_check(&conn, 2026, "submitted", true).unwrap();
        assert_eq!(
            set_check(&conn, 2026, "unknown", true).unwrap_err(),
            AppError::field(ErrorCode::NotFound, "item")
        );
        // 2026 年分の確定申告の期限は 2027-03-15。75 日前（2026-12-30）から知らせる
        assert!(deadlines(&conn, "2026-12-29").unwrap().is_empty());
        let n = deadlines(&conn, "2027-02-13").unwrap();
        assert_eq!(n.len(), 1);
        assert_eq!(
            (n[0].kind, n[0].date.as_str(), n[0].days_left),
            (DeadlineKind::Income, "2027-03-15", 30)
        );
        assert_eq!((n[0].done, n[0].total), (1, INCOME_ITEMS.len()));
        assert!(n[0].submitted);
        // 期限を過ぎても終わっていなければ 30 日まで知らせる
        assert_eq!(deadlines(&conn, "2027-04-10").unwrap()[0].days_left, -26);
        drop(conn);
        // 課税の年度は消費税の期限も
        register(&db, "2026-01-01", TaxStatus::Special20, None).unwrap();
        let n = deadlines(&db.conn(), "2027-03-01").unwrap();
        assert_eq!(
            n.iter().map(|n| n.kind).collect::<Vec<_>>(),
            [DeadlineKind::Income, DeadlineKind::Consumption]
        );
    }

    #[test]
    fn registration_numbers_are_checked_by_the_user() {
        let db = set_up_db();
        let conn = db.conn();
        conn.execute(
            "INSERT INTO partners (code, name_ja, is_vendor, invoice_registration_no) VALUES ('V1', '文具店', 1, 'T7000012050002')",
            [],
        )
        .unwrap();
        let list = partner_checks(&conn, "2026-05-01").unwrap();
        assert!(list[0].status.needs_check);
        assert_eq!(list[0].status.check_digit_ok, Some(true));
        let s = record_check(
            &conn,
            "t7000012050002",
            CheckResult::Confirmed,
            "2026-05-01",
        )
        .unwrap();
        assert!(!s.needs_check);
        assert_eq!(s.last_result, Some(CheckResult::Confirmed));
        // 1 年以上たつと、また確かめるよう知らせる（記録した日は今日の日付なので、2 年後で確かめる）
        let checked = s.last_checked_on.unwrap();
        let (y, m, d) = journal::parse_date(&checked).unwrap();
        let later = format!("{:04}-{m:02}-{:02}", y + 2, d.min(28));
        assert!(
            number_status(&conn, "T7000012050002", &later)
                .unwrap()
                .needs_check
        );
        assert!(
            !number_status(&conn, "T7000012050002", &checked)
                .unwrap()
                .needs_check
        );
        // 取り消されていたら知らせる
        let s = record_check(&conn, "T7000012050002", CheckResult::Revoked, &checked).unwrap();
        assert!(s.needs_check);
    }

    #[test]
    fn income_guide_lists_the_statement_in_order() {
        let db = set_up_db();
        sale(&db, "2026-03-10", 300_000, TaxCategory::TaxableSales10);
        let guide = income_guide(&db.conn(), 2026).unwrap();
        assert_eq!(
            guide
                .sections
                .iter()
                .map(|s| s.key.as_str())
                .collect::<Vec<_>>(),
            ["pl", "monthly", "depreciation", "bs", "return"]
        );
        assert_eq!(guide.business_revenue, 300_000);
        assert_eq!(guide.sections[0].items[0].key, "sales");
        let march = guide.sections[1]
            .items
            .iter()
            .find(|i| i.key == "sales_3")
            .unwrap();
        assert_eq!(march.value, 300_000);
        // 65 万円の控除は、紙で出すなら 55 万円まで
        assert_eq!(guide.deduction_on_paper, guide.deduction.min(550_000));
        let ret = &guide.sections[4].items;
        assert_eq!(ret[0].value, 300_000);
        assert_eq!(ret[1].value, guide.income);
    }
}
