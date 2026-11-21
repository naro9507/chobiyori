//! 定型仕訳（毎月の取引のひな形）と、毎月の候補・記録・見送り。
//!
//! 候補は記録するまで帳簿に入らない。記録するときは金額と日付を確かめて直せる
//! （電気代のように毎月金額が変わるもの）。家事按分の割合があれば、記録するときに
//! 事業分と家事分（事業主貸）の 2 行に分ける。

use super::transactions::{self, Transaction};
use super::Database;
use chobiyori_core::allocation;
use chobiyori_core::error::{AppError, AppResult, ErrorCode};
use chobiyori_core::journal::{
    self, AllowedInactive, EntryMode, LineInput, Side, TransactionInput, TransactionKind,
};
use chobiyori_core::master::{self, MEMO_MAX, NAME_MAX};
use chobiyori_core::template::{self, Recurrence};
use rusqlite::{params, Connection, Row};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Template {
    pub id: i64,
    pub name: String,
    pub memo: String,
    pub debit_account_id: i64,
    pub debit_sub_account_id: Option<i64>,
    pub credit_account_id: i64,
    pub credit_sub_account_id: Option<i64>,
    pub amount: i64,
    pub partner_id: Option<i64>,
    pub allocation_percent: Option<i64>,
    pub recurrence: Recurrence,
    pub day_of_month: u32,
    pub start_month: String,
    pub is_active: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TemplateInput {
    pub name: String,
    #[serde(default)]
    pub memo: String,
    pub debit_account_id: i64,
    #[serde(default)]
    pub debit_sub_account_id: Option<i64>,
    pub credit_account_id: i64,
    #[serde(default)]
    pub credit_sub_account_id: Option<i64>,
    pub amount: i64,
    #[serde(default)]
    pub partner_id: Option<i64>,
    #[serde(default)]
    pub allocation_percent: Option<i64>,
    pub recurrence: Recurrence,
    pub day_of_month: u32,
    /// 候補を出しはじめる月（`YYYY-MM`）
    pub start_month: String,
    #[serde(default = "active")]
    pub is_active: bool,
}

fn active() -> bool {
    true
}

/// 記録を待っている毎月の候補。
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Candidate {
    pub template_id: i64,
    pub month: u32,
    /// 定型仕訳の日（その月にない日は月末）
    pub date: String,
}

const SELECT: &str = "
    SELECT id, name, memo, debit_account_id, debit_sub_account_id, credit_account_id,
           credit_sub_account_id, amount, partner_id, allocation_percent, recurrence,
           day_of_month, start_month, is_active
    FROM templates";

fn from_row(row: &Row<'_>) -> rusqlite::Result<Template> {
    Ok(Template {
        id: row.get(0)?,
        name: row.get(1)?,
        memo: row.get(2)?,
        debit_account_id: row.get(3)?,
        debit_sub_account_id: row.get(4)?,
        credit_account_id: row.get(5)?,
        credit_sub_account_id: row.get(6)?,
        amount: row.get(7)?,
        partner_id: row.get(8)?,
        allocation_percent: row.get(9)?,
        recurrence: row.get(10)?,
        day_of_month: row.get(11)?,
        start_month: row.get(12)?,
        is_active: row.get(13)?,
    })
}

pub fn list(conn: &Connection) -> AppResult<Vec<Template>> {
    let mut stmt = conn.prepare(&format!("{SELECT} ORDER BY sort, id"))?;
    let rows = stmt.query_map([], from_row)?;
    Ok(rows.collect::<Result<_, _>>()?)
}

pub fn get(conn: &Connection, id: i64) -> AppResult<Template> {
    Ok(conn.query_row(&format!("{SELECT} WHERE id = ?1"), [id], from_row)?)
}

/// 定型仕訳の 2 行（借方・貸方）。按分はまだしない。
fn lines(t: &TemplateInput, amount: i64) -> Vec<LineInput> {
    let line = |side, account_id, sub_account_id| LineInput {
        partner_id: t.partner_id,
        sub_account_id,
        ..LineInput::new(side, account_id, amount)
    };
    vec![
        line(Side::Debit, t.debit_account_id, t.debit_sub_account_id),
        line(Side::Credit, t.credit_account_id, t.credit_sub_account_id),
    ]
}

/// 取引の検証で出た明細行のエラーを、定型仕訳の入力欄のエラーにする（0 行目が借方、1 行目が貸方）。
fn field_error(error: AppError) -> AppError {
    let debit = error.line == Some(0);
    let field = match error.field {
        Some("accountId") if debit => "debitAccountId",
        Some("accountId") => "creditAccountId",
        Some("subAccountId") if debit => "debitSubAccountId",
        Some("subAccountId") => "creditSubAccountId",
        Some(field) => field,
        None => return AppError::new(error.code),
    };
    AppError::field(error.code, field)
}

struct Valid {
    name: String,
    memo: String,
    start_month: String,
}

fn validate(
    conn: &Connection,
    input: &TemplateInput,
    allowed: &AllowedInactive,
) -> AppResult<Valid> {
    let name = master::required(&input.name, NAME_MAX, "name")?;
    let memo = master::optional(&input.memo, MEMO_MAX, "memo")?;
    let (year, month) = template::parse_month(&input.start_month)?;
    if !(1..=31).contains(&input.day_of_month) {
        return Err(AppError::field(ErrorCode::OutOfRange, "dayOfMonth"));
    }
    if let Some(percent) = input.allocation_percent {
        master::business_percent(percent)
            .map_err(|e| AppError::field(e.code, "allocationPercent"))?;
    }
    // 取引と同じ検証を通す（科目・補助科目・取引先・金額・借方と貸方が同じ科目でないこと）
    let probe = TransactionInput {
        date: format!("{year:04}-{month:02}-01"),
        entry_mode: EntryMode::Grid,
        memo: String::new(),
        lines: lines(input, input.amount),
    };
    let masters = transactions::DbMasters::load(conn, year)?;
    journal::validate(&probe, year, &masters, allowed).map_err(field_error)?;
    Ok(Valid {
        name,
        memo,
        start_month: format!("{year:04}-{month:02}"),
    })
}

pub fn create(conn: &Connection, input: &TemplateInput) -> AppResult<Template> {
    let v = validate(conn, input, &AllowedInactive::default())?;
    conn.execute(
        "INSERT INTO templates (name, memo, debit_account_id, debit_sub_account_id, credit_account_id,
                                credit_sub_account_id, amount, partner_id, allocation_percent, recurrence,
                                day_of_month, start_month, is_active, sort)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13,
                 (SELECT coalesce(max(sort), 0) + 10 FROM templates))",
        params![
            v.name,
            v.memo,
            input.debit_account_id,
            input.debit_sub_account_id,
            input.credit_account_id,
            input.credit_sub_account_id,
            input.amount,
            input.partner_id,
            input.allocation_percent,
            input.recurrence,
            input.day_of_month,
            v.start_month,
            input.is_active
        ],
    )?;
    get(conn, conn.last_insert_rowid())
}

pub fn update(conn: &Connection, id: i64, input: &TemplateInput) -> AppResult<Template> {
    let current = get(conn, id)?;
    // 使わない設定にした科目などは、変更前から使っていたものだけ残せる
    let allowed = AllowedInactive {
        accounts: vec![current.debit_account_id, current.credit_account_id],
        partners: current.partner_id.into_iter().collect(),
        sub_accounts: [current.debit_sub_account_id, current.credit_sub_account_id]
            .into_iter()
            .flatten()
            .collect(),
    };
    let v = validate(conn, input, &allowed)?;
    conn.execute(
        "UPDATE templates SET name = ?2, memo = ?3, debit_account_id = ?4, debit_sub_account_id = ?5,
                credit_account_id = ?6, credit_sub_account_id = ?7, amount = ?8, partner_id = ?9,
                allocation_percent = ?10, recurrence = ?11, day_of_month = ?12, start_month = ?13,
                is_active = ?14
         WHERE id = ?1",
        params![
            id,
            v.name,
            v.memo,
            input.debit_account_id,
            input.debit_sub_account_id,
            input.credit_account_id,
            input.credit_sub_account_id,
            input.amount,
            input.partner_id,
            input.allocation_percent,
            input.recurrence,
            input.day_of_month,
            v.start_month,
            input.is_active
        ],
    )?;
    get(conn, id)
}

/// 定型仕訳を消す。記録した取引は帳簿に残る。
pub fn delete(conn: &Connection, id: i64) -> AppResult<()> {
    get(conn, id)?;
    conn.execute("DELETE FROM templates WHERE id = ?1", [id])?;
    Ok(())
}

/// 年度 `year` の、記録を待っている毎月の候補。`upto_month` 月まで（今年なら今月）。
pub fn candidates(conn: &Connection, year: i64, upto_month: u32) -> AppResult<Vec<Candidate>> {
    let mut stmt =
        conn.prepare("SELECT template_id, month FROM template_postings WHERE fiscal_year = ?1")?;
    let mut done: HashMap<i64, HashSet<u32>> = HashMap::new();
    for row in stmt.query_map([year], |row| {
        Ok((row.get::<_, i64>(0)?, row.get::<_, u32>(1)?))
    })? {
        let (template_id, month) = row?;
        done.entry(template_id).or_default().insert(month);
    }
    let mut result = Vec::new();
    for t in list(conn)? {
        if !t.is_active || t.recurrence != Recurrence::Monthly {
            continue;
        }
        let start = template::parse_month(&t.start_month)?;
        let empty = HashSet::new();
        let done = done.get(&t.id).unwrap_or(&empty);
        for (month, date) in template::due_months(start, t.day_of_month, year, upto_month, done) {
            result.push(Candidate {
                template_id: t.id,
                month,
                date,
            });
        }
    }
    // 日付の順に並べる
    result.sort_by(|a, b| a.date.cmp(&b.date).then(a.template_id.cmp(&b.template_id)));
    Ok(result)
}

/// 定型仕訳から記録するときに直せるもの。
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PostInput {
    /// 毎月の候補なら、その月。必要なときに使う定型仕訳なら空
    #[serde(default)]
    pub month: Option<u32>,
    pub date: String,
    pub amount: i64,
    /// 家事按分の事業割合。定型仕訳の割合をこの取引だけ変えるとき
    #[serde(default)]
    pub allocation_percent: Option<i64>,
}

fn ensure_not_done(conn: &Connection, template_id: i64, year: i64, month: u32) -> AppResult<()> {
    let done: bool = conn.query_row(
        "SELECT EXISTS (SELECT 1 FROM template_postings WHERE template_id = ?1 AND fiscal_year = ?2 AND month = ?3)",
        params![template_id, year, month],
        |row| row.get(0),
    )?;
    if done {
        return Err(AppError::new(ErrorCode::AlreadyRecorded));
    }
    Ok(())
}

/// 定型仕訳から取引を記録する。毎月の候補なら、その月を記録済みにする。
pub fn post(
    db: &Database,
    template_id: i64,
    year: i64,
    input: &PostInput,
) -> AppResult<Transaction> {
    db.transaction(|tx| {
        let t = get(tx, template_id)?;
        if let Some(month) = input.month {
            if !(1..=12).contains(&month) {
                return Err(AppError::field(ErrorCode::OutOfRange, "month"));
            }
            ensure_not_done(tx, template_id, year, month)?;
        }
        let as_input = TemplateInput {
            name: t.name.clone(),
            memo: t.memo.clone(),
            debit_account_id: t.debit_account_id,
            debit_sub_account_id: t.debit_sub_account_id,
            credit_account_id: t.credit_account_id,
            credit_sub_account_id: t.credit_sub_account_id,
            amount: input.amount,
            partner_id: t.partner_id,
            allocation_percent: t.allocation_percent,
            recurrence: t.recurrence,
            day_of_month: t.day_of_month,
            start_month: t.start_month.clone(),
            is_active: t.is_active,
        };
        let mut lines = lines(&as_input, input.amount);
        // インボイス: 登録番号のある取引先への支払いなら、借方に印を付ける
        lines[0].is_qualified_invoice = transactions::has_invoice_no(tx, t.partner_id)?;
        if let Some(percent) = input.allocation_percent.or(t.allocation_percent) {
            if !(0..=100).contains(&percent) {
                return Err(AppError::field(ErrorCode::OutOfRange, "allocationPercent"));
            }
            let drawings = transactions::owner_accounts(tx)?.drawings;
            let rounding = transactions::account_rounding(tx, t.debit_account_id)?;
            lines = allocation::split_line(&lines, 0, drawings, percent, rounding);
        }
        let transaction = transactions::insert_kind(
            tx,
            year,
            &TransactionInput {
                date: input.date.clone(),
                entry_mode: EntryMode::Grid,
                memo: if t.memo.is_empty() { t.name.clone() } else { t.memo.clone() },
                lines,
            },
            TransactionKind::Template,
        )?;
        if let Some(month) = input.month {
            tx.execute(
                "INSERT INTO template_postings (template_id, fiscal_year, month, transaction_id) VALUES (?1, ?2, ?3, ?4)",
                params![template_id, year, month, transaction.id],
            )?;
        }
        Ok(transaction)
    })
}

/// その月は記録しない（候補から外す）。
pub fn skip(db: &Database, template_id: i64, year: i64, month: u32) -> AppResult<()> {
    db.transaction(|tx| {
        get(tx, template_id)?;
        if !(1..=12).contains(&month) {
            return Err(AppError::field(ErrorCode::OutOfRange, "month"));
        }
        ensure_not_done(tx, template_id, year, month)?;
        tx.execute(
            "INSERT INTO template_postings (template_id, fiscal_year, month) VALUES (?1, ?2, ?3)",
            params![template_id, year, month],
        )?;
        Ok(())
    })
}

/// 見送った月を、また候補に出す。記録した月は、取引を消すと候補に戻る。
pub fn unskip(conn: &Connection, template_id: i64, year: i64, month: u32) -> AppResult<()> {
    conn.execute(
        "DELETE FROM template_postings
         WHERE template_id = ?1 AND fiscal_year = ?2 AND month = ?3 AND transaction_id IS NULL",
        params![template_id, year, month],
    )?;
    Ok(())
}

/// 年度の中で見送った月。
pub fn skipped(conn: &Connection, year: i64) -> AppResult<Vec<Candidate>> {
    let mut stmt = conn.prepare(
        "SELECT p.template_id, p.month, t.day_of_month FROM template_postings p
         JOIN templates t ON t.id = p.template_id
         WHERE p.fiscal_year = ?1 AND p.transaction_id IS NULL ORDER BY p.month, p.template_id",
    )?;
    let rows = stmt.query_map([year], |row| {
        let month: u32 = row.get(1)?;
        Ok(Candidate {
            template_id: row.get(0)?,
            month,
            date: template::date_in_month(year, month, row.get(2)?),
        })
    })?;
    Ok(rows.collect::<Result<_, _>>()?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::setup::tests::set_up_db;
    use crate::db::transactions::tests::account;

    fn rent(conn: &Connection) -> TemplateInput {
        TemplateInput {
            name: "家賃".into(),
            memo: String::new(),
            debit_account_id: account(conn, "616"),
            debit_sub_account_id: None,
            credit_account_id: account(conn, "104"),
            credit_sub_account_id: None,
            amount: 80_001,
            partner_id: None,
            allocation_percent: Some(40),
            recurrence: Recurrence::Monthly,
            day_of_month: 31,
            start_month: "2026-01".into(),
            is_active: true,
        }
    }

    fn post_month(
        db: &Database,
        id: i64,
        month: u32,
        date: &str,
        amount: i64,
    ) -> AppResult<Transaction> {
        post(
            db,
            id,
            2026,
            &PostInput {
                month: Some(month),
                date: date.into(),
                amount,
                allocation_percent: None,
            },
        )
    }

    #[test]
    fn monthly_templates_are_only_proposed_until_recorded_or_skipped() {
        let db = set_up_db();
        let t = {
            let conn = db.conn();
            create(&conn, &rent(&conn)).unwrap()
        };
        let due = candidates(&db.conn(), 2026, 3).unwrap();
        assert_eq!(
            due.iter()
                .map(|c| (c.month, c.date.as_str()))
                .collect::<Vec<_>>(),
            [(1, "2026-01-31"), (2, "2026-02-28"), (3, "2026-03-31")]
        );
        // 候補を出すだけで、帳簿には何も入っていない
        assert!(transactions::list(&db.conn(), 2026, None)
            .unwrap()
            .is_empty());

        let posted = post_month(&db, t.id, 1, "2026-01-31", 80_001).unwrap();
        assert_eq!(posted.kind, TransactionKind::Template);
        assert_eq!(posted.memo, "家賃");
        // 事業 40%（切り捨て）: 地代家賃 32,000 + 事業主貸 48,001 / 普通預金 80,001
        let conn = db.conn();
        assert_eq!(
            posted
                .lines
                .iter()
                .map(|l| (l.side, l.account_id, l.amount))
                .collect::<Vec<_>>(),
            [
                (Side::Debit, account(&conn, "616"), 32_000),
                (Side::Debit, account(&conn, "199"), 48_001),
                (Side::Credit, account(&conn, "104"), 80_001)
            ]
        );
        drop(conn);
        skip(&db, t.id, 2026, 2).unwrap();
        let due = candidates(&db.conn(), 2026, 3).unwrap();
        assert_eq!(due.iter().map(|c| c.month).collect::<Vec<_>>(), [3]);
        assert_eq!(skipped(&db.conn(), 2026).unwrap().len(), 1);

        // 同じ月は 2 回記録できない
        assert_eq!(
            post_month(&db, t.id, 1, "2026-01-31", 1).unwrap_err(),
            AppError::new(ErrorCode::AlreadyRecorded)
        );
        // 記録した取引を消すと、その月はまた候補に出る。見送りは戻せる
        transactions::delete(&db, posted.id).unwrap();
        unskip(&db.conn(), t.id, 2026, 2).unwrap();
        assert_eq!(candidates(&db.conn(), 2026, 3).unwrap().len(), 3);
    }

    #[test]
    fn amount_can_change_each_month_and_inactive_templates_are_not_proposed() {
        let db = set_up_db();
        let mut input = {
            let conn = db.conn();
            rent(&conn)
        };
        input.allocation_percent = None;
        let t = create(&db.conn(), &input).unwrap();
        let posted = post_month(&db, t.id, 1, "2026-01-20", 7_777).unwrap();
        assert_eq!(posted.lines.len(), 2);
        assert_eq!(posted.lines[0].amount, 7_777);
        input.is_active = false;
        update(&db.conn(), t.id, &input).unwrap();
        assert!(candidates(&db.conn(), 2026, 12).unwrap().is_empty());
        // 繰り返さない定型仕訳も候補には出ない
        input.is_active = true;
        input.recurrence = Recurrence::None;
        update(&db.conn(), t.id, &input).unwrap();
        assert!(candidates(&db.conn(), 2026, 12).unwrap().is_empty());
    }

    #[test]
    fn templates_are_checked_like_transactions() {
        let db = set_up_db();
        let conn = db.conn();
        let mut input = rent(&conn);
        input.credit_account_id = input.debit_account_id;
        assert_eq!(
            create(&conn, &input).unwrap_err(),
            AppError::field(ErrorCode::SameAccount, "creditAccountId")
        );
        let mut input = rent(&conn);
        input.debit_sub_account_id = Some(999);
        assert_eq!(
            create(&conn, &input).unwrap_err(),
            AppError::field(ErrorCode::NotFound, "debitSubAccountId")
        );
        let mut input = rent(&conn);
        input.amount = 0;
        assert_eq!(
            create(&conn, &input).unwrap_err(),
            AppError::field(ErrorCode::OutOfRange, "amount")
        );
        let mut input = rent(&conn);
        input.allocation_percent = Some(120);
        assert_eq!(
            create(&conn, &input).unwrap_err().field,
            Some("allocationPercent")
        );
        let mut input = rent(&conn);
        input.name = " ".into();
        assert_eq!(
            create(&conn, &input).unwrap_err(),
            AppError::field(ErrorCode::Required, "name")
        );
        // 定型仕訳で使っている科目は削除できない（使っている印が付く）
        create(&conn, &rent(&conn)).unwrap();
        assert!(
            crate::db::accounts::get(&conn, account(&conn, "616"))
                .unwrap()
                .in_use
        );
    }
}
