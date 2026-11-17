//! 定期売上のプランと入金（SPEC F5-2）。
//!
//! - プラン: 取引先（顧客）ごとに、名前・金額・売上の科目・開始月・終了月。休みの月を持てる
//! - 入金: 「口座 / 売上」の仕訳を記録し、プランと対象月に結び付ける。返金は逆向きの仕訳
//! - 顧客やプランを決めずに入金を記録することもでき、「未割当の入金」として別に出す
//! - 月ごとの一覧と年間の表は、プランと入金から毎回作る（`domain::recurring`）

use super::transactions::{self, Transaction};
use super::Database;
use crate::domain::journal::{
    parse_date, EntryMode, LineInput, Side, TransactionInput, TransactionKind,
};
use crate::domain::master::{self, MEMO_MAX, NAME_MAX};
use crate::domain::recurring::{self, MonthCell, PaymentStatus, PlanSchedule};
use crate::error::{AppError, AppResult, ErrorCode};
use rusqlite::{params, Connection, OptionalExtension, Row};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Plan {
    pub id: i64,
    pub partner_id: i64,
    pub name: String,
    pub amount: i64,
    pub revenue_account_id: i64,
    pub start_month: String,
    pub end_month: Option<String>,
    pub memo: String,
    /// 休みにした月（`YYYY-MM`）
    pub skipped_months: Vec<String>,
    /// 入金を記録したことがある（削除できない。終了月を入れて終える）
    pub in_use: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanInput {
    pub partner_id: i64,
    pub name: String,
    pub amount: i64,
    pub revenue_account_id: i64,
    pub start_month: String,
    #[serde(default)]
    pub end_month: Option<String>,
    #[serde(default)]
    pub memo: String,
}

fn validate(conn: &Connection, input: &PlanInput) -> AppResult<(String, String)> {
    let name = master::required(&input.name, NAME_MAX, "name")?;
    let memo = master::optional(&input.memo, MEMO_MAX, "memo")?;
    if !(1..=crate::domain::journal::AMOUNT_MAX).contains(&input.amount) {
        return Err(AppError::field(ErrorCode::OutOfRange, "amount"));
    }
    if !recurring::valid_month(&input.start_month) {
        return Err(AppError::field(ErrorCode::InvalidFormat, "startMonth"));
    }
    if let Some(end) = &input.end_month {
        if !recurring::valid_month(end) {
            return Err(AppError::field(ErrorCode::InvalidFormat, "endMonth"));
        }
        if end < &input.start_month {
            return Err(AppError::field(ErrorCode::OutOfRange, "endMonth"));
        }
    }
    let partner: Option<bool> = conn
        .query_row(
            "SELECT is_active FROM partners WHERE id = ?1",
            [input.partner_id],
            |r| r.get(0),
        )
        .optional()?;
    if partner.is_none() {
        return Err(AppError::field(ErrorCode::NotFound, "partnerId"));
    }
    let category: Option<String> = conn
        .query_row(
            "SELECT category FROM accounts WHERE id = ?1",
            [input.revenue_account_id],
            |r| r.get(0),
        )
        .optional()?;
    match category.as_deref() {
        None => return Err(AppError::field(ErrorCode::NotFound, "revenueAccountId")),
        Some("revenue") => {}
        Some(_) => {
            return Err(AppError::field(
                ErrorCode::InvalidFormat,
                "revenueAccountId",
            ))
        }
    }
    Ok((name, memo))
}

const SELECT: &str = "
    SELECT p.id, p.partner_id, p.name, p.amount, p.revenue_account_id, p.start_month, p.end_month, p.memo,
           EXISTS (SELECT 1 FROM recurring_payments WHERE plan_id = p.id)
    FROM recurring_plans p";

fn from_row(row: &Row<'_>) -> rusqlite::Result<Plan> {
    Ok(Plan {
        id: row.get(0)?,
        partner_id: row.get(1)?,
        name: row.get(2)?,
        amount: row.get(3)?,
        revenue_account_id: row.get(4)?,
        start_month: row.get(5)?,
        end_month: row.get(6)?,
        memo: row.get(7)?,
        skipped_months: Vec::new(),
        in_use: row.get(8)?,
    })
}

fn skips(conn: &Connection) -> AppResult<HashMap<i64, Vec<String>>> {
    let mut stmt =
        conn.prepare("SELECT plan_id, month FROM recurring_plan_skips ORDER BY month")?;
    let mut map: HashMap<i64, Vec<String>> = HashMap::new();
    for row in stmt.query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?)))? {
        let (plan, month) = row?;
        map.entry(plan).or_default().push(month);
    }
    Ok(map)
}

/// プランの一覧。取引先の並び順、その中は作った順。
pub fn list(conn: &Connection) -> AppResult<Vec<Plan>> {
    let mut stmt = conn.prepare(&format!(
        "{SELECT} JOIN partners pa ON pa.id = p.partner_id ORDER BY pa.sort, pa.code, p.sort, p.id"
    ))?;
    let mut plans: Vec<Plan> = stmt.query_map([], from_row)?.collect::<Result<_, _>>()?;
    let mut skipped = skips(conn)?;
    for p in &mut plans {
        p.skipped_months = skipped.remove(&p.id).unwrap_or_default();
    }
    Ok(plans)
}

pub fn get(conn: &Connection, id: i64) -> AppResult<Plan> {
    list(conn)?
        .into_iter()
        .find(|p| p.id == id)
        .ok_or(AppError::new(ErrorCode::NotFound))
}

pub fn create(conn: &Connection, input: &PlanInput) -> AppResult<Plan> {
    let (name, memo) = validate(conn, input)?;
    conn.execute(
        "INSERT INTO recurring_plans (partner_id, name, amount, revenue_account_id, start_month, end_month, memo, sort)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, (SELECT coalesce(max(sort), 0) + 10 FROM recurring_plans))",
        params![input.partner_id, name, input.amount, input.revenue_account_id, input.start_month, input.end_month, memo],
    )?;
    get(conn, conn.last_insert_rowid())
}

/// プランを変える。入金を記録したあとでも変えられる（記録済みの仕訳は変わらない）。
pub fn update(conn: &Connection, id: i64, input: &PlanInput) -> AppResult<Plan> {
    let (name, memo) = validate(conn, input)?;
    let changed = conn.execute(
        "UPDATE recurring_plans SET partner_id = ?2, name = ?3, amount = ?4, revenue_account_id = ?5,
                start_month = ?6, end_month = ?7, memo = ?8
         WHERE id = ?1",
        params![id, input.partner_id, name, input.amount, input.revenue_account_id, input.start_month, input.end_month, memo],
    )?;
    if changed == 0 {
        return Err(AppError::new(ErrorCode::NotFound));
    }
    get(conn, id)
}

/// 入金を記録したことのあるプランは消せない（終了月を入れて終える）。
pub fn delete(conn: &Connection, id: i64) -> AppResult<()> {
    if get(conn, id)?.in_use {
        return Err(AppError::new(ErrorCode::InUse));
    }
    conn.execute("DELETE FROM recurring_plans WHERE id = ?1", [id])?;
    Ok(())
}

/// その月を休みにする（予定なし）か、休みを外す。
pub fn set_skipped(conn: &Connection, id: i64, month: &str, skipped: bool) -> AppResult<Plan> {
    if !recurring::valid_month(month) {
        return Err(AppError::field(ErrorCode::InvalidFormat, "month"));
    }
    get(conn, id)?;
    if skipped {
        conn.execute(
            "INSERT OR IGNORE INTO recurring_plan_skips (plan_id, month) VALUES (?1, ?2)",
            params![id, month],
        )?;
    } else {
        conn.execute(
            "DELETE FROM recurring_plan_skips WHERE plan_id = ?1 AND month = ?2",
            params![id, month],
        )?;
    }
    get(conn, id)
}

/// 入金（または返金）の記録。
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PaymentInput {
    /// プラン。空なら未割当の入金
    #[serde(default)]
    pub plan_id: Option<i64>,
    /// 未割当の入金の取引先（わかれば）。プランがあればプランの取引先を使う
    #[serde(default)]
    pub partner_id: Option<i64>,
    /// 対象月（`YYYY-MM`）。プランの入金では必須
    #[serde(default)]
    pub target_month: Option<String>,
    pub date: String,
    pub amount: i64,
    /// 入金した口座（現金・預金）
    pub payment_account_id: i64,
    /// 返金なら true（売上 / 口座 の仕訳になる）
    #[serde(default)]
    pub refund: bool,
    /// 未割当の入金の売上の科目。空なら「売上高」
    #[serde(default)]
    pub revenue_account_id: Option<i64>,
    #[serde(default)]
    pub memo: String,
}

fn sales_account(conn: &Connection) -> AppResult<i64> {
    conn.query_row(
        "SELECT id FROM accounts WHERE statement_line = 'pl.sales'",
        [],
        |r| r.get(0),
    )
    .optional()?
    .ok_or(AppError::field(ErrorCode::NotFound, "revenueAccountId"))
}

fn record_one(conn: &Connection, year: i64, input: &PaymentInput) -> AppResult<Transaction> {
    if !(1..=crate::domain::journal::AMOUNT_MAX).contains(&input.amount) {
        return Err(AppError::field(ErrorCode::OutOfRange, "amount"));
    }
    transactions::ensure_payment_account(conn, input.payment_account_id, "paymentAccountId")?;
    if let Some(month) = &input.target_month {
        if !recurring::valid_month(month) {
            return Err(AppError::field(ErrorCode::InvalidFormat, "targetMonth"));
        }
    }
    let (plan, partner_id, revenue) = match input.plan_id {
        Some(id) => {
            let plan = get(conn, id)?;
            if input.target_month.is_none() {
                return Err(AppError::field(ErrorCode::Required, "targetMonth"));
            }
            let (partner, revenue) = (plan.partner_id, plan.revenue_account_id);
            (Some(plan), Some(partner), revenue)
        }
        None => {
            let revenue = match input.revenue_account_id {
                Some(id) => id,
                None => sales_account(conn)?,
            };
            (None, input.partner_id, revenue)
        }
    };
    let memo = master::optional(&input.memo, MEMO_MAX, "memo")?;
    let memo = if memo.is_empty() {
        match (&plan, &input.target_month) {
            (Some(p), Some(m)) => format!("{} {}", p.name, m),
            (Some(p), None) => p.name.clone(),
            (None, _) => String::new(),
        }
    } else {
        memo
    };
    let (money, sales) = if input.refund {
        (Side::Credit, Side::Debit)
    } else {
        (Side::Debit, Side::Credit)
    };
    let mut money_line = LineInput::new(money, input.payment_account_id, input.amount);
    money_line.partner_id = partner_id;
    let mut sales_line = LineInput::new(sales, revenue, input.amount);
    sales_line.partner_id = partner_id;
    let transaction = transactions::insert_kind(
        conn,
        year,
        &TransactionInput {
            date: input.date.trim().to_string(),
            entry_mode: EntryMode::Simple,
            memo,
            lines: vec![money_line, sales_line],
        },
        TransactionKind::Normal,
    )?;
    conn.execute(
        "INSERT INTO recurring_payments (transaction_id, plan_id, partner_id, target_month, amount)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        params![
            transaction.id,
            input.plan_id,
            partner_id,
            input.target_month,
            if input.refund {
                -input.amount
            } else {
                input.amount
            }
        ],
    )?;
    Ok(transaction)
}

/// 入金（返金）を 1 件記録する。
pub fn record(db: &Database, year: i64, input: &PaymentInput) -> AppResult<Transaction> {
    db.transaction(|tx| record_one(tx, year, input))
}

/// まとめて記録する。1 件でも記録できなければ、どれも記録しない。
pub fn record_many(db: &Database, year: i64, inputs: &[PaymentInput]) -> AppResult<usize> {
    db.transaction(|tx| {
        for input in inputs {
            record_one(tx, year, input)?;
        }
        Ok(inputs.len())
    })
}

/// プランごと・対象月ごとの入金と返金。
fn payments_by_month(conn: &Connection) -> AppResult<HashMap<(i64, String), (i64, i64)>> {
    let mut stmt = conn.prepare(
        "SELECT plan_id, target_month,
                coalesce(sum(CASE WHEN amount > 0 THEN amount END), 0),
                coalesce(sum(CASE WHEN amount < 0 THEN -amount END), 0)
         FROM recurring_payments
         WHERE plan_id IS NOT NULL AND target_month IS NOT NULL
         GROUP BY plan_id, target_month",
    )?;
    let rows = stmt.query_map([], |r| Ok(((r.get(0)?, r.get(1)?), (r.get(2)?, r.get(3)?))))?;
    Ok(rows.collect::<Result<_, _>>()?)
}

fn schedule(plan: &Plan) -> PlanSchedule {
    PlanSchedule {
        amount: plan.amount,
        start_month: plan.start_month.clone(),
        end_month: plan.end_month.clone(),
        skipped: plan.skipped_months.clone(),
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanMonthRow {
    pub plan_id: i64,
    pub partner_id: i64,
    pub name: String,
    pub cell: MonthCell,
}

/// 未割当の入金。
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UnassignedPayment {
    pub transaction_id: i64,
    pub date: String,
    pub partner_id: Option<i64>,
    pub target_month: Option<String>,
    /// 入金なら正、返金なら負
    pub amount: i64,
    pub memo: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MonthlyList {
    pub month: String,
    pub rows: Vec<PlanMonthRow>,
    pub total_scheduled: i64,
    pub total_net: i64,
    /// 予定があるのに入金がない・足りないプランの数
    pub unpaid_count: usize,
    pub unassigned: Vec<UnassignedPayment>,
}

fn unassigned(conn: &Connection, month: &str) -> AppResult<Vec<UnassignedPayment>> {
    let mut stmt = conn.prepare(
        "SELECT r.transaction_id, t.date, r.partner_id, r.target_month, r.amount, t.memo
         FROM recurring_payments r JOIN transactions t ON t.id = r.transaction_id
         WHERE r.plan_id IS NULL
           AND (r.target_month = ?1 OR (r.target_month IS NULL AND substr(t.date, 1, 7) = ?1))
         ORDER BY t.date, t.id",
    )?;
    let rows = stmt.query_map([month], |r| {
        Ok(UnassignedPayment {
            transaction_id: r.get(0)?,
            date: r.get(1)?,
            partner_id: r.get(2)?,
            target_month: r.get(3)?,
            amount: r.get(4)?,
            memo: r.get(5)?,
        })
    })?;
    Ok(rows.collect::<Result<_, _>>()?)
}

/// 月ごとの一覧。予定のあるプランと、予定はないが入金のあったプランを出す。
pub fn monthly(conn: &Connection, year: i64, month: u32) -> AppResult<MonthlyList> {
    if !(1..=12).contains(&month) {
        return Err(AppError::field(ErrorCode::OutOfRange, "month"));
    }
    let key = recurring::month_key(year, month);
    let payments = payments_by_month(conn)?;
    let rows: Vec<PlanMonthRow> = list(conn)?
        .iter()
        .filter_map(|p| {
            let (received, refunded) = payments
                .get(&(p.id, key.clone()))
                .copied()
                .unwrap_or_default();
            let cell = recurring::cell(&schedule(p), &key, received, refunded);
            (cell.status != PaymentStatus::OutOfPlan).then(|| PlanMonthRow {
                plan_id: p.id,
                partner_id: p.partner_id,
                name: p.name.clone(),
                cell,
            })
        })
        .collect();
    Ok(MonthlyList {
        total_scheduled: rows.iter().map(|r| r.cell.scheduled).sum(),
        total_net: rows.iter().map(|r| r.cell.net).sum(),
        unpaid_count: rows
            .iter()
            .filter(|r| {
                matches!(
                    r.cell.status,
                    PaymentStatus::Unpaid | PaymentStatus::Partial
                )
            })
            .count(),
        unassigned: unassigned(conn, &key)?,
        rows,
        month: key,
    })
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanYear {
    pub plan_id: i64,
    pub partner_id: i64,
    pub name: String,
    /// 1 月から 12 月
    pub cells: Vec<MonthCell>,
    pub total_scheduled: i64,
    pub total_net: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct YearMatrix {
    pub year: i64,
    pub plans: Vec<PlanYear>,
    /// 月ごとの未割当の入金の合計（返金を引いた額）
    pub unassigned_by_month: Vec<i64>,
}

/// 年間の表。その年に予定か入金のあるプランだけ。
pub fn year_matrix(conn: &Connection, year: i64) -> AppResult<YearMatrix> {
    let payments = payments_by_month(conn)?;
    let plans = list(conn)?
        .iter()
        .filter_map(|p| {
            let s = schedule(p);
            let cells: Vec<MonthCell> = (1..=12)
                .map(|m| {
                    let key = recurring::month_key(year, m);
                    let (received, refunded) = payments
                        .get(&(p.id, key.clone()))
                        .copied()
                        .unwrap_or_default();
                    recurring::cell(&s, &key, received, refunded)
                })
                .collect();
            cells
                .iter()
                .any(|c| c.status != PaymentStatus::OutOfPlan)
                .then(|| PlanYear {
                    plan_id: p.id,
                    partner_id: p.partner_id,
                    name: p.name.clone(),
                    total_scheduled: cells.iter().map(|c| c.scheduled).sum(),
                    total_net: cells.iter().map(|c| c.net).sum(),
                    cells,
                })
        })
        .collect();
    let unassigned_by_month = (1..=12)
        .map(|m| -> AppResult<i64> {
            Ok(unassigned(conn, &recurring::month_key(year, m))?
                .iter()
                .map(|u| u.amount)
                .sum())
        })
        .collect::<AppResult<Vec<i64>>>()?;
    Ok(YearMatrix {
        year,
        plans,
        unassigned_by_month,
    })
}

/// 日付の年から、その取引を記録する年度を決める（入金の日の年）。
pub fn year_of(date: &str) -> AppResult<i64> {
    parse_date(date.trim())
        .map(|(y, _, _)| y)
        .ok_or(AppError::field(ErrorCode::InvalidFormat, "date"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::setup::tests::set_up_db;
    use crate::db::transactions::tests::account;

    fn partner(conn: &Connection, code: &str, name: &str) -> i64 {
        conn.execute(
            "INSERT INTO partners (code, name_ja, is_customer) VALUES (?1, ?2, 1)",
            params![code, name],
        )
        .unwrap();
        conn.last_insert_rowid()
    }

    fn plan_input(partner_id: i64, revenue: i64) -> PlanInput {
        PlanInput {
            partner_id,
            name: "月謝".into(),
            amount: 8_000,
            revenue_account_id: revenue,
            start_month: "2026-04".into(),
            end_month: None,
            memo: String::new(),
        }
    }

    fn pay(
        plan: Option<i64>,
        month: Option<&str>,
        date: &str,
        amount: i64,
        bank: i64,
    ) -> PaymentInput {
        PaymentInput {
            plan_id: plan,
            partner_id: None,
            target_month: month.map(str::to_string),
            date: date.into(),
            amount,
            payment_account_id: bank,
            refund: false,
            revenue_account_id: None,
            memo: String::new(),
        }
    }

    #[test]
    fn payments_post_sales_and_feed_the_monthly_list() {
        let db = set_up_db();
        let (bank, sales, a, b) = {
            let conn = db.conn();
            (
                account(&conn, "104"),
                account(&conn, "401"),
                partner(&conn, "1", "生徒A"),
                partner(&conn, "2", "生徒B"),
            )
        };
        let (pa, pb) = {
            let conn = db.conn();
            let pa = create(&conn, &plan_input(a, sales)).unwrap().id;
            let mut ib = plan_input(b, sales);
            ib.amount = 10_000;
            let pb = create(&conn, &ib).unwrap().id;
            set_skipped(&conn, pb, "2026-05", true).unwrap();
            (pa, pb)
        };
        // 4 月: A は全額、B は一部
        record(
            &db,
            2026,
            &pay(Some(pa), Some("2026-04"), "2026-04-05", 8_000, bank),
        )
        .unwrap();
        record(
            &db,
            2026,
            &pay(Some(pb), Some("2026-04"), "2026-04-06", 6_000, bank),
        )
        .unwrap();
        // 5 月: A は返金つき、B は休み
        record(
            &db,
            2026,
            &pay(Some(pa), Some("2026-05"), "2026-05-05", 8_000, bank),
        )
        .unwrap();
        let mut refund = pay(Some(pa), Some("2026-05"), "2026-05-20", 3_000, bank);
        refund.refund = true;
        record(&db, 2026, &refund).unwrap();
        // 未割当の入金
        record(&db, 2026, &pay(None, None, "2026-04-30", 2_500, bank)).unwrap();

        let conn = db.conn();
        let april = monthly(&conn, 2026, 4).unwrap();
        let status: Vec<_> = april
            .rows
            .iter()
            .map(|r| (r.plan_id, r.cell.status, r.cell.shortfall))
            .collect();
        assert_eq!(
            status,
            [
                (pa, PaymentStatus::Paid, 0),
                (pb, PaymentStatus::Partial, 4_000)
            ]
        );
        assert_eq!(
            (april.total_scheduled, april.total_net, april.unpaid_count),
            (18_000, 14_000, 1)
        );
        assert_eq!(april.unassigned.len(), 1);
        assert_eq!(april.unassigned[0].amount, 2_500);

        let may = monthly(&conn, 2026, 5).unwrap();
        let a_may = may.rows.iter().find(|r| r.plan_id == pa).unwrap();
        assert_eq!(
            (a_may.cell.net, a_may.cell.status),
            (5_000, PaymentStatus::Partial)
        );
        assert_eq!(
            may.rows
                .iter()
                .find(|r| r.plan_id == pb)
                .unwrap()
                .cell
                .status,
            PaymentStatus::Skipped
        );

        // 売上は入金 − 返金（8,000 + 6,000 + 8,000 − 3,000 + 2,500）
        let tb = crate::db::reports::trial_balance(&conn, 2026, 1, 12).unwrap();
        let sales_row = tb.rows.iter().find(|r| r.account_id == sales).unwrap();
        assert_eq!(sales_row.balance, 21_500);

        // 年間の表
        let matrix = year_matrix(&conn, 2026).unwrap();
        let ya = matrix.plans.iter().find(|p| p.plan_id == pa).unwrap();
        assert_eq!(ya.cells[0].status, PaymentStatus::OutOfPlan);
        assert_eq!(ya.cells[5].status, PaymentStatus::Unpaid);
        assert_eq!((ya.total_scheduled, ya.total_net), (8_000 * 9, 13_000));
        assert_eq!(matrix.unassigned_by_month[3], 2_500);

        // 入金のあったプランは消せない
        assert_eq!(
            delete(&conn, pa).unwrap_err(),
            AppError::new(ErrorCode::InUse)
        );
    }

    #[test]
    fn deleting_the_transaction_puts_the_month_back_to_unpaid() {
        let db = set_up_db();
        let (bank, sales, a) = {
            let conn = db.conn();
            (
                account(&conn, "104"),
                account(&conn, "401"),
                partner(&conn, "1", "生徒A"),
            )
        };
        let pa = create(&db.conn(), &plan_input(a, sales)).unwrap().id;
        let t = record(
            &db,
            2026,
            &pay(Some(pa), Some("2026-04"), "2026-04-05", 8_000, bank),
        )
        .unwrap();
        crate::db::transactions::delete(&db, t.id).unwrap();
        let april = monthly(&db.conn(), 2026, 4).unwrap();
        assert_eq!(april.rows[0].cell.status, PaymentStatus::Unpaid);
        // 入金がなくなったので、プランを消せる
        delete(&db.conn(), pa).unwrap();
    }

    #[test]
    fn bad_input_is_rejected_and_nothing_is_saved() {
        let db = set_up_db();
        let (bank, sales, cash_expense, a) = {
            let conn = db.conn();
            (
                account(&conn, "104"),
                account(&conn, "401"),
                account(&conn, "610"),
                partner(&conn, "1", "生徒A"),
            )
        };
        let conn = db.conn();
        let mut bad = plan_input(a, sales);
        bad.start_month = "2026-4".into();
        assert_eq!(
            create(&conn, &bad).unwrap_err(),
            AppError::field(ErrorCode::InvalidFormat, "startMonth")
        );
        let mut bad = plan_input(a, cash_expense);
        bad.name = "x".into();
        assert_eq!(
            create(&conn, &bad).unwrap_err(),
            AppError::field(ErrorCode::InvalidFormat, "revenueAccountId")
        );
        let mut bad = plan_input(a, sales);
        bad.end_month = Some("2026-01".into());
        assert_eq!(
            create(&conn, &bad).unwrap_err(),
            AppError::field(ErrorCode::OutOfRange, "endMonth")
        );
        let pa = create(&conn, &plan_input(a, sales)).unwrap().id;
        drop(conn);
        // プランの入金には対象月が要る
        assert_eq!(
            record(&db, 2026, &pay(Some(pa), None, "2026-04-05", 8_000, bank)).unwrap_err(),
            AppError::field(ErrorCode::Required, "targetMonth")
        );
        // 口座でない科目には入金できない
        assert_eq!(
            record(
                &db,
                2026,
                &pay(Some(pa), Some("2026-04"), "2026-04-05", 8_000, sales)
            )
            .unwrap_err(),
            AppError::field(ErrorCode::InvalidFormat, "paymentAccountId")
        );
        // まとめての記録は 1 件でもだめなら何も残さない
        let inputs = [
            pay(Some(pa), Some("2026-04"), "2026-04-05", 8_000, bank),
            pay(Some(pa), Some("2026-05"), "2026-13-05", 8_000, bank),
        ];
        assert!(record_many(&db, 2026, &inputs).is_err());
        assert_eq!(
            monthly(&db.conn(), 2026, 4).unwrap().rows[0].cell.status,
            PaymentStatus::Unpaid
        );
    }
}
