//! 入金の記録先（請求書・定期売上）。
//!
//! かんたん入力の「収入」と、受信箱の銀行・電子マネーの入金の行から、入金を請求書か定期売上の
//! プランと月に結び付けて記録する。記帳のしかたは請求書の画面・売上管理の画面と同じ
//! （`documents::record_payment_in`・`recurring::record_one`）。
//!
//! 受信箱の入金の行には、金額・名前・日付から結び付け先の候補を出す。候補は確定するまで記帳しない。

use super::transactions::Transaction;
use super::{documents, recurring, Database};
use crate::domain::document::{DisplayStatus, DocumentKind};
use crate::domain::journal::{parse_date, EntryMode};
use crate::domain::recurring::{month_key, PaymentStatus};
use crate::domain::rules;
use crate::error::{AppError, AppResult, ErrorCode};
use rusqlite::Connection;
use serde::{Deserialize, Serialize};

/// 入金の記録先。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum DepositTarget {
    /// 請求書（「口座 / 売掛金」）
    Invoice { document_id: i64 },
    /// 定期売上のプランと対象月（「口座 / 売上」）
    Plan { plan_id: i64, month: String },
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DepositInput {
    pub target: DepositTarget,
    pub date: String,
    pub amount: i64,
    /// 入金した口座（現金・預金）
    pub account_id: i64,
    #[serde(default)]
    pub sub_account_id: Option<i64>,
    #[serde(default)]
    pub memo: String,
}

/// 入金を記録先に記帳する（呼び出し側の DB トランザクションの中で）。
pub(crate) fn post_in(
    conn: &Connection,
    input: &DepositInput,
    entry_mode: EntryMode,
) -> AppResult<Transaction> {
    let Some((year, _, _)) = parse_date(input.date.trim()) else {
        return Err(AppError::field(ErrorCode::InvalidFormat, "date"));
    };
    match &input.target {
        DepositTarget::Invoice { document_id } => documents::record_payment_in(
            conn,
            *document_id,
            &documents::PaymentInput {
                date: input.date.clone(),
                amount: input.amount,
                account_id: input.account_id,
                sub_account_id: input.sub_account_id,
            },
            entry_mode,
        ),
        DepositTarget::Plan { plan_id, month } => recurring::record_one(
            conn,
            year,
            &recurring::PaymentInput {
                plan_id: Some(*plan_id),
                partner_id: None,
                target_month: Some(month.clone()),
                date: input.date.clone(),
                amount: input.amount,
                payment_account_id: input.account_id,
                refund: false,
                revenue_account_id: None,
                sub_account_id: input.sub_account_id,
                memo: input.memo.clone(),
            },
            entry_mode,
        ),
    }
}

/// かんたん入力の「収入」から、入金を請求書か定期売上に記録する。
pub fn record(db: &Database, input: &DepositInput) -> AppResult<Transaction> {
    db.transaction(|tx| post_in(tx, input, EntryMode::Simple))
}

/// 入金を待っている請求書。
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenInvoice {
    pub document_id: i64,
    pub number: Option<String>,
    pub partner_id: Option<i64>,
    pub recipient_name: String,
    pub issue_date: String,
    pub due_date: Option<String>,
    pub total: i64,
    /// 残りの額
    pub remaining: i64,
    /// 売上をまだ記帳していない（先に請求書の画面で記帳してもらう）
    pub sale_recorded: bool,
}

/// 入金を待っている定期売上の月。
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenPlanMonth {
    pub plan_id: i64,
    pub partner_id: i64,
    pub name: String,
    pub month: String,
    pub remaining: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenTargets {
    pub invoices: Vec<OpenInvoice>,
    pub plan_months: Vec<OpenPlanMonth>,
}

/// 入金を待っている請求書と、年度の定期売上の未入金の月（請求書で請求した月を除く）。
pub fn open_targets(conn: &Connection, year: i64) -> AppResult<OpenTargets> {
    let invoices = documents::list(conn, Some(DocumentKind::Invoice))?
        .into_iter()
        .filter(|d| {
            matches!(
                d.display_status,
                DisplayStatus::Issued
                    | DisplayStatus::Sent
                    | DisplayStatus::PartlyPaid
                    | DisplayStatus::Overdue
            ) && d.totals.total > d.paid
        })
        .map(|d| OpenInvoice {
            document_id: d.id,
            remaining: d.totals.total - d.paid,
            total: d.totals.total,
            sale_recorded: d.transaction_id.is_some(),
            number: d.number,
            partner_id: d.partner_id,
            recipient_name: d.recipient_name,
            issue_date: d.issue_date,
            due_date: d.due_date,
        })
        .collect();
    let mut plan_months = Vec::new();
    for month in 1..=12 {
        for row in recurring::monthly(conn, year, month)?.rows {
            if row.invoice_id.is_none()
                && matches!(
                    row.cell.status,
                    PaymentStatus::Unpaid | PaymentStatus::Partial
                )
            {
                plan_months.push(OpenPlanMonth {
                    plan_id: row.plan_id,
                    partner_id: row.partner_id,
                    name: row.name,
                    month: month_key(year, month),
                    remaining: row.cell.shortfall,
                });
            }
        }
    }
    Ok(OpenTargets {
        invoices,
        plan_months,
    })
}

/// 結び付け先の候補。
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DepositSuggestion {
    pub target: DepositTarget,
    /// 画面に出す名前（請求書の番号と宛名、プランの名前と月）
    pub label: String,
    pub partner_id: Option<i64>,
    pub remaining: i64,
    /// 金額が残りの額とちょうど同じ
    pub exact_amount: bool,
    /// 振込の名前が取引先の名前と合う
    pub name_matches: bool,
    /// 大きいほど有力
    pub score: i64,
}

/// ひらがなをカタカナにする（取引先のよみがなを、銀行の振込名義と比べるため）。
fn katakana(text: &str) -> String {
    text.chars()
        .map(|c| match c {
            'ぁ'..='ゖ' => char::from_u32(c as u32 + 0x60).unwrap_or(c),
            _ => c,
        })
        .collect()
}

/// 振込の名前（明細の内容）と取引先の名前が合うか。どちらかがもう一方を含めば合うとみる。
/// 名前は全角・半角カナ・空白などをそろえてから比べる。短すぎる名前（1 文字）は比べない。
pub(crate) fn names_match(payer: &str, names: &[String]) -> bool {
    let payer = rules::normalize(&katakana(payer));
    if payer.chars().count() < 2 {
        return false;
    }
    names.iter().any(|name| {
        let name = rules::normalize(&katakana(name));
        name.chars().count() >= 2 && (payer.contains(&name) || name.contains(&payer))
    })
}

fn partner_names(conn: &Connection, partner_id: Option<i64>) -> AppResult<Vec<String>> {
    let Some(id) = partner_id else {
        return Ok(Vec::new());
    };
    let (ja, kana, billing): (String, String, String) = conn.query_row(
        "SELECT name_ja, kana, billing_name FROM partners WHERE id = ?1",
        [id],
        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
    )?;
    Ok([ja, kana, billing]
        .into_iter()
        .filter(|n| !n.trim().is_empty())
        .collect())
}

/// 月 `YYYY-MM` の差（`to` − `from`）。
fn month_diff(from: &str, to: &str) -> Option<i64> {
    let parse = |m: &str| -> Option<i64> {
        let (y, mm) = m.split_once('-')?;
        Some(y.parse::<i64>().ok()? * 12 + mm.parse::<i64>().ok()?)
    };
    Some(parse(to)? - parse(from)?)
}

/// 入金の行（日付・金額・振込の名前）に合う、結び付け先の候補を出す。
///
/// - 残りの額より多い入金には出さない
/// - 金額がちょうど同じ: +50、名前が合う: +40、日付が近い（請求書の期限の前後 15 日・
///   定期売上の対象月）: +10、定期売上の対象月の次の月: +5
/// - 金額か名前のどちらかが合うものだけ（50 点以上）を、有力な順に 5 件まで
pub fn suggest(
    conn: &Connection,
    date: &str,
    amount: i64,
    payer: &str,
) -> AppResult<Vec<DepositSuggestion>> {
    let Some((year, month, _)) = parse_date(date.trim()) else {
        return Err(AppError::field(ErrorCode::InvalidFormat, "date"));
    };
    if amount <= 0 {
        return Ok(Vec::new());
    }
    let mut suggestions = Vec::new();
    // 前の年度の 12 月分の入金が年明けに来ることもあるので、前の年度も見る
    let mut targets = open_targets(conn, year)?;
    if let Ok(previous) = open_targets(conn, year - 1) {
        targets.plan_months.extend(previous.plan_months);
    }
    for invoice in targets.invoices.iter().filter(|i| i.sale_recorded) {
        if amount > invoice.remaining {
            continue;
        }
        let mut names = partner_names(conn, invoice.partner_id)?;
        names.push(invoice.recipient_name.clone());
        let exact_amount = amount == invoice.remaining;
        let name_matches = names_match(payer, &names);
        let near = invoice
            .due_date
            .as_deref()
            .and_then(|due| crate::domain::filing::days_between(date, due))
            .is_some_and(|d| d.abs() <= 15);
        let score =
            50 * i64::from(exact_amount) + 40 * i64::from(name_matches) + 10 * i64::from(near);
        if score >= 50 {
            suggestions.push(DepositSuggestion {
                target: DepositTarget::Invoice {
                    document_id: invoice.document_id,
                },
                label: format!(
                    "{} {}",
                    invoice.number.clone().unwrap_or_default(),
                    invoice.recipient_name
                ),
                partner_id: invoice.partner_id,
                remaining: invoice.remaining,
                exact_amount,
                name_matches,
                score,
            });
        }
    }
    let this_month = month_key(year, month);
    for plan in &targets.plan_months {
        if amount > plan.remaining {
            continue;
        }
        let exact_amount = amount == plan.remaining;
        let name_matches = names_match(payer, &partner_names(conn, Some(plan.partner_id))?);
        // 対象月と同じ月の入金が最も有力、次の月の入金（後払い）が次に有力
        let near = match month_diff(&plan.month, &this_month) {
            Some(0) => 10,
            Some(1) => 5,
            _ => 0,
        };
        let score = 50 * i64::from(exact_amount) + 40 * i64::from(name_matches) + near;
        if score >= 50 {
            suggestions.push(DepositSuggestion {
                target: DepositTarget::Plan {
                    plan_id: plan.plan_id,
                    month: plan.month.clone(),
                },
                label: format!("{} {}", plan.name, plan.month),
                partner_id: Some(plan.partner_id),
                remaining: plan.remaining,
                exact_amount,
                name_matches,
                score,
            });
        }
    }
    suggestions.sort_by(|a, b| b.score.cmp(&a.score).then_with(|| a.label.cmp(&b.label)));
    suggestions.truncate(5);
    Ok(suggestions)
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use crate::db::setup::tests::set_up_db;
    use crate::db::transactions::tests::account;

    pub(crate) fn partner(conn: &Connection, code: &str, name: &str, kana: &str) -> i64 {
        conn.execute(
            "INSERT INTO partners (code, name_ja, kana, is_customer) VALUES (?1, ?2, ?3, 1)",
            rusqlite::params![code, name, kana],
        )
        .unwrap();
        conn.last_insert_rowid()
    }

    fn plan(db: &Database, partner_id: i64, amount: i64) -> i64 {
        let sales = account(&db.conn(), "401");
        recurring::create(
            &db.conn(),
            &recurring::PlanInput {
                partner_id,
                name: "月謝".into(),
                amount,
                revenue_account_id: sales,
                start_month: "2026-01".into(),
                end_month: None,
                memo: String::new(),
            },
        )
        .unwrap()
        .id
    }

    #[test]
    fn bank_names_match_partner_kana() {
        let names = vec!["山田 太郎".to_string(), "やまだ たろう".to_string()];
        assert!(names_match("ﾔﾏﾀﾞ ﾀﾛｳ", &names));
        assert!(names_match("フリコミ ヤマダタロウ", &names));
        assert!(!names_match("ｽｽﾞｷ ﾊﾅｺ", &names));
        assert!(!names_match("ﾔ", &names));
    }

    #[test]
    fn suggests_the_plan_month_for_a_matching_deposit_and_records_it() {
        let db = set_up_db();
        let (yamada, suzuki) = {
            let conn = db.conn();
            (
                partner(&conn, "1", "山田 太郎", "やまだ たろう"),
                partner(&conn, "2", "鈴木 花子", "すずき はなこ"),
            )
        };
        let p1 = plan(&db, yamada, 8_000);
        plan(&db, suzuki, 8_000);
        let conn = db.conn();
        let s = suggest(&conn, "2026-03-05", 8_000, "ﾔﾏﾀﾞ ﾀﾛｳ").unwrap();
        // 3 月分（金額・名前・月が合う）が先頭、次が 2 月分（後払い）
        assert_eq!(
            s[0].target,
            DepositTarget::Plan {
                plan_id: p1,
                month: "2026-03".into()
            }
        );
        assert_eq!(s[0].score, 100);
        assert_eq!((s[1].score, s[1].label.as_str()), (95, "月謝 2026-02"));
        // 名前が分からない入金は、金額と月で両方の 3 月分を出す
        let unknown = suggest(&conn, "2026-03-05", 8_000, "ｼﾗﾅｲ ﾋﾄ").unwrap();
        let top: Vec<(Option<i64>, i64)> = unknown[..2]
            .iter()
            .map(|x| (x.partner_id, x.score))
            .collect();
        assert!(top.contains(&(Some(yamada), 60)) && top.contains(&(Some(suzuki), 60)));
        // 残りより多い入金には出さない
        assert!(suggest(&conn, "2026-03-05", 9_000, "ﾔﾏﾀﾞ ﾀﾛｳ")
            .unwrap()
            .is_empty());
        drop(conn);

        let bank = account(&db.conn(), "104");
        record(
            &db,
            &DepositInput {
                target: s[0].target.clone(),
                date: "2026-03-05".into(),
                amount: 8_000,
                account_id: bank,
                sub_account_id: None,
                memo: String::new(),
            },
        )
        .unwrap();
        let conn = db.conn();
        let march = recurring::monthly(&conn, 2026, 3).unwrap();
        let row = march.rows.iter().find(|r| r.plan_id == p1).unwrap();
        assert_eq!(row.cell.status, PaymentStatus::Paid);
        // 入金済みの月はもう候補に出ない
        let again = suggest(&conn, "2026-03-06", 8_000, "ﾔﾏﾀﾞ ﾀﾛｳ").unwrap();
        assert!(again.iter().all(|x| x.target
            != DepositTarget::Plan {
                plan_id: p1,
                month: "2026-03".into()
            }));
    }
}
