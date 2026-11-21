//! 定期売上のプランと入金（SPEC F5-2）。
//!
//! - プラン: 取引先（顧客）ごとに、名前・金額・売上の科目・開始月・終了月。休みの月を持てる
//! - 入金: 「口座 / 売上」の仕訳を記録し、プランと対象月に結び付ける。返金は逆向きの仕訳
//! - 顧客やプランを決めずに入金を記録することもでき、「未割当の入金」として別に出す
//! - 月ごとの一覧と年間の表は、プランと入金から毎回作る（`chobiyori_core::recurring`）

use super::transactions::{self, Transaction};
use super::Database;
use chobiyori_core::error::{AppError, AppResult, ErrorCode};
use chobiyori_core::journal::{
    parse_date, EntryMode, LineInput, Side, TransactionInput, TransactionKind,
};
use chobiyori_core::master::{self, MEMO_MAX, NAME_MAX};
use chobiyori_core::recurring::{self, MonthCell, PaymentStatus, PlanSchedule};
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
    if !(1..=chobiyori_core::journal::AMOUNT_MAX).contains(&input.amount) {
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
           (EXISTS (SELECT 1 FROM recurring_payments WHERE plan_id = p.id)
            OR EXISTS (SELECT 1 FROM recurring_invoices i JOIN document_payments d ON d.document_id = i.document_id
                       WHERE i.plan_id = p.id))
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
    /// 口座の補助科目（明細の取込先が補助科目を持つとき）
    #[serde(default)]
    pub sub_account_id: Option<i64>,
    #[serde(default)]
    pub memo: String,
}

/// プランのその月を、取り消していない請求書で請求しているなら、その請求書。
fn invoice_of(
    conn: &Connection,
    plan_id: i64,
    month: &str,
) -> AppResult<Option<(i64, Option<String>)>> {
    Ok(conn
        .query_row(
            "SELECT d.id, d.number FROM recurring_invoices r JOIN documents d ON d.id = r.document_id
             WHERE r.plan_id = ?1 AND r.month = ?2 AND d.status <> 'canceled'
             ORDER BY d.id DESC LIMIT 1",
            params![plan_id, month],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()?)
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

/// 入金（返金）を記録する（呼び出し側の DB トランザクションの中で）。
/// かんたん入力・受信箱から入金を記録するときも、これを使う。
pub(crate) fn record_one(
    conn: &Connection,
    year: i64,
    input: &PaymentInput,
    entry_mode: EntryMode,
) -> AppResult<Transaction> {
    if !(1..=chobiyori_core::journal::AMOUNT_MAX).contains(&input.amount) {
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
            let Some(month) = &input.target_month else {
                return Err(AppError::field(ErrorCode::Required, "targetMonth"));
            };
            // 請求書で請求した月は、入金を請求書に記録する（売上を二重にしない）
            if invoice_of(conn, id, month)?.is_some() {
                return Err(AppError::field(ErrorCode::MonthInvoiced, "targetMonth"));
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
    money_line.sub_account_id = input.sub_account_id;
    let mut sales_line = LineInput::new(sales, revenue, input.amount);
    sales_line.partner_id = partner_id;
    let transaction = transactions::insert_kind(
        conn,
        year,
        &TransactionInput {
            date: input.date.trim().to_string(),
            entry_mode,
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
    db.transaction(|tx| record_one(tx, year, input, EntryMode::Simple))
}

/// まとめて記録する。1 件でも記録できなければ、どれも記録しない。
pub fn record_many(db: &Database, year: i64, inputs: &[PaymentInput]) -> AppResult<usize> {
    db.transaction(|tx| {
        for input in inputs {
            record_one(tx, year, input, EntryMode::Simple)?;
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
    let mut map: HashMap<(i64, String), (i64, i64)> = rows.collect::<Result<_, _>>()?;
    // 請求書で請求した月は、請求書への入金を、その請求書に入れたプランの予定額の割合で分けて数える
    for (plan_month, received) in invoice_payments(conn)? {
        map.entry(plan_month).or_default().0 += received;
    }
    Ok(map)
}

/// 請求書への実入金を、請求書作成時の割合でプランごとに配分する。
fn invoice_payments(conn: &Connection) -> AppResult<Vec<((i64, String), i64)>> {
    let mut stmt = conn.prepare(
        "SELECT r.plan_id, r.month, r.document_id, r.allocation_weight FROM recurring_invoices r
         JOIN documents d ON d.id = r.document_id
         WHERE d.status NOT IN ('draft', 'canceled')
         ORDER BY r.document_id, r.plan_id, r.month",
    )?;
    let links = stmt
        .query_map([], |r| {
            Ok((
                r.get::<_, i64>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, i64>(2)?,
                r.get::<_, i64>(3)?,
            ))
        })?
        .collect::<Result<Vec<_>, _>>()?;

    let mut result = Vec::new();
    for items in links.chunk_by(|a, b| a.2 == b.2) {
        let d = super::documents::get(conn, items[0].2)?;
        let total_weight: i128 = items.iter().map(|i| i128::from(i.3)).sum();
        if d.paid <= 0 || total_weight == 0 {
            continue;
        }
        let mut cumulative = 0;
        let mut allocated = 0;
        for (plan_id, month, _, weight) in items {
            cumulative += i128::from(*weight);
            let through = (i128::from(d.paid) * cumulative / total_weight) as i64;
            let received = through - allocated;
            allocated = through;
            if received > 0 {
                result.push(((*plan_id, month.clone()), received));
            }
        }
    }
    Ok(result)
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
    /// この月を請求した請求書（取り消したものを除く）。入金は請求書に記録する
    pub invoice_id: Option<i64>,
    pub invoice_number: Option<String>,
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
    let mut rows: Vec<PlanMonthRow> = Vec::new();
    for p in list(conn)? {
        let (received, refunded) = payments
            .get(&(p.id, key.clone()))
            .copied()
            .unwrap_or_default();
        let cell = recurring::cell(&schedule(&p), &key, received, refunded);
        if cell.status == PaymentStatus::OutOfPlan {
            continue;
        }
        let invoice = invoice_of(conn, p.id, &key)?;
        rows.push(PlanMonthRow {
            plan_id: p.id,
            partner_id: p.partner_id,
            name: p.name.clone(),
            cell,
            invoice_id: invoice.as_ref().map(|i| i.0),
            invoice_number: invoice.and_then(|i| i.1),
        });
    }
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

/// 未割当の入金を、あとからプランと対象月に割り当てる。仕訳の取引先と売上の科目もプランに合わせる。
/// 締めた月の取引は変えない（`transactions::update_in` が止める）。
pub fn assign(
    db: &Database,
    transaction_id: i64,
    plan_id: i64,
    month: &str,
) -> AppResult<Transaction> {
    db.transaction(|tx| {
        let assigned: Option<Option<i64>> = tx
            .query_row(
                "SELECT plan_id FROM recurring_payments WHERE transaction_id = ?1",
                [transaction_id],
                |r| r.get(0),
            )
            .optional()?;
        match assigned {
            None => return Err(AppError::field(ErrorCode::NotFound, "transactionId")),
            Some(Some(_)) => return Err(AppError::new(ErrorCode::AlreadyRecorded)),
            Some(None) => {}
        }
        if !recurring::valid_month(month) {
            return Err(AppError::field(ErrorCode::InvalidFormat, "targetMonth"));
        }
        let plan = get(tx, plan_id)?;
        if invoice_of(tx, plan_id, month)?.is_some() {
            return Err(AppError::field(ErrorCode::MonthInvoiced, "targetMonth"));
        }
        let current = transactions::get(tx, transaction_id)?;
        let revenue: Vec<i64> = {
            let mut stmt = tx.prepare("SELECT id FROM accounts WHERE category = 'revenue'")?;
            let ids = stmt.query_map([], |r| r.get(0))?;
            ids.collect::<Result<_, _>>()?
        };
        let lines = current
            .lines
            .iter()
            .map(|l| LineInput {
                side: l.side,
                account_id: if revenue.contains(&l.account_id) {
                    plan.revenue_account_id
                } else {
                    l.account_id
                },
                amount: l.amount,
                partner_id: Some(plan.partner_id),
                memo: l.memo.clone(),
                sub_account_id: l.sub_account_id,
                tax_category: l.tax_category,
                is_qualified_invoice: l.is_qualified_invoice,
            })
            .collect();
        let updated = transactions::update_in(
            tx,
            transaction_id,
            &TransactionInput {
                date: current.date.clone(),
                entry_mode: current.entry_mode,
                memo: if current.memo.is_empty() {
                    format!("{} {}", plan.name, month)
                } else {
                    current.memo.clone()
                },
                lines,
            },
            false,
        )?;
        tx.execute(
            "UPDATE recurring_payments SET plan_id = ?2, partner_id = ?3, target_month = ?4
             WHERE transaction_id = ?1",
            params![transaction_id, plan_id, plan.partner_id, month],
        )?;
        Ok(updated)
    })
}

/// 定期売上からまとめて作った請求書の下書き。
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DraftInvoices {
    /// 作った下書き（取引先ごとに 1 つ）
    pub documents: Vec<super::documents::Document>,
    /// 請求書がもうあるので作らなかったプランの数
    pub already_invoiced: usize,
    /// もう入金があるので作らなかったプランの数
    pub already_paid: usize,
}

/// 売上の科目の既定の税区分から、請求書の税率を決める。
fn document_rate(conn: &Connection, account_id: i64) -> AppResult<i64> {
    let category: Option<chobiyori_core::master::TaxCategory> = conn
        .query_row(
            "SELECT default_tax_category FROM accounts WHERE id = ?1",
            [account_id],
            |r| r.get(0),
        )
        .optional()?
        .flatten();
    use chobiyori_core::master::TaxCategory::*;
    Ok(match category {
        Some(TaxableSales8) => 8,
        Some(ExemptSales | NonTaxable | OutOfScope) => 0,
        _ => 10,
    })
}

/// 税込の予定額を、請求書の税抜きの単価に直す（円未満四捨五入）。免税なら税を足さないのでそのまま。
pub(crate) fn unit_price(amount: i64, rate: i64, exempt: bool) -> i64 {
    if exempt || rate == 0 {
        return amount;
    }
    (amount * 100 * 2 + (100 + rate)).div_euclid((100 + rate) * 2)
}

/// その月に予定のあるプランから、取引先ごとに請求書の下書きを作る。
/// - 同じプラン・同じ月の請求書（取り消していないもの）があれば作らない
/// - もう入金のある月（一部入金を含む）は作らない
/// - 単価は予定額（税込）を税抜きに直したもの。合計が予定額と数円ずれることがあるので、発行の前に確かめてもらう
pub fn draft_invoices(db: &Database, year: i64, month: u32) -> AppResult<DraftInvoices> {
    if !(1..=12).contains(&month) {
        return Err(AppError::field(ErrorCode::OutOfRange, "month"));
    }
    let key = recurring::month_key(year, month);
    db.transaction(|tx| {
        let payments = payments_by_month(tx)?;
        let settings = super::documents::settings(tx)?;
        let issue_date = format!("{key}-01");
        let exempt = transactions::date_is_exempt(tx, &issue_date)?;
        let mut already_invoiced = 0;
        let mut already_paid = 0;
        let mut by_partner: Vec<(i64, Vec<Plan>)> = Vec::new();
        for p in list(tx)? {
            if schedule(&p).scheduled(&key) <= 0 {
                continue;
            }
            if invoice_of(tx, p.id, &key)?.is_some() {
                already_invoiced += 1;
                continue;
            }
            let (received, refunded) = payments.get(&(p.id, key.clone())).copied().unwrap_or_default();
            if received - refunded > 0 {
                already_paid += 1;
                continue;
            }
            match by_partner.iter_mut().find(|(partner, _)| *partner == p.partner_id) {
                Some((_, plans)) => plans.push(p),
                None => by_partner.push((p.partner_id, vec![p])),
            }
        }
        let mut documents = Vec::new();
        for (partner_id, plans) in by_partner {
            let (name, billing, email, address): (String, String, String, String) = tx.query_row(
                "SELECT name_ja, billing_name, email, address FROM partners WHERE id = ?1",
                [partner_id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
            )?;
            let mut lines = Vec::new();
            for p in &plans {
                let rate = document_rate(tx, p.revenue_account_id)?;
                lines.push(chobiyori_core::document::LineInput {
                    name: format!("{}（{}月分）", p.name, month),
                    quantity: 100,
                    unit: String::new(),
                    unit_price: unit_price(schedule(p).scheduled(&key), rate, exempt),
                    tax_rate: rate,
                });
            }
            let id = super::documents::create_in(
                tx,
                &super::documents::DocumentInput {
                    kind: chobiyori_core::document::DocumentKind::Invoice,
                    partner_id: Some(partner_id),
                    recipient_name: if billing.is_empty() { name } else { billing },
                    recipient_address: address,
                    recipient_email: email,
                    issue_date: issue_date.clone(),
                    due_date: chobiyori_core::filing::add_days(&issue_date, settings.due_days.max(0)),
                    title: format!("{}年{}月分", year, month),
                    notes: settings.default_notes.clone(),
                    lines,
                },
            )?;
            for p in &plans {
                tx.execute(
                    "INSERT INTO recurring_invoices (plan_id, month, document_id, allocation_weight) VALUES (?1, ?2, ?3, ?4)",
                    params![p.id, key, id, schedule(p).scheduled(&key)],
                )?;
            }
            documents.push(super::documents::get(tx, id)?);
        }
        Ok(DraftInvoices {
            documents,
            already_invoiced,
            already_paid,
        })
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
    use crate::test_support::account;
    use crate::test_support::set_up_db;

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
            sub_account_id: None,
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
        let tb = crate::reports::trial_balance(&conn, 2026, 1, 12).unwrap();
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
        crate::transactions::delete(&db, t.id).unwrap();
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

    #[test]
    fn unit_price_turns_the_tax_included_amount_into_tax_excluded() {
        assert_eq!(unit_price(8_000, 10, false), 7_273);
        assert_eq!(unit_price(5_400, 8, false), 5_000);
        assert_eq!(unit_price(8_000, 10, true), 8_000);
        assert_eq!(unit_price(8_000, 0, false), 8_000);
    }

    #[test]
    fn invoices_from_plans_are_made_once_and_their_payments_count_for_the_month() {
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
            (pa, create(&conn, &ib).unwrap().id)
        };
        let drafts = draft_invoices(&db, 2026, 4).unwrap();
        assert_eq!(drafts.documents.len(), 2);
        let doc_a = drafts
            .documents
            .iter()
            .find(|d| d.partner_id == Some(a))
            .unwrap();
        // 免税の年度なので税を足さない。単価は予定額のまま
        assert_eq!(doc_a.totals.total, 8_000);
        assert_eq!(doc_a.lines[0].name, "月謝（4月分）");
        assert_eq!(doc_a.due_date.as_deref(), Some("2026-05-01"));
        // 二度目は作らない
        let again = draft_invoices(&db, 2026, 4).unwrap();
        assert_eq!((again.documents.len(), again.already_invoiced), (0, 2));
        // 請求書で請求した月は、プランの画面から入金を記録できない
        assert_eq!(
            record(
                &db,
                2026,
                &pay(Some(pa), Some("2026-04"), "2026-04-05", 8_000, bank)
            )
            .unwrap_err(),
            AppError::field(ErrorCode::MonthInvoiced, "targetMonth")
        );
        // A の請求書を発行し、売上と入金を記帳すると、A の 4 月は入金済みになる
        let render = |_: &Connection, _: &super::super::documents::Document| Ok(b"%PDF-".to_vec());
        super::super::documents::issue(&db, doc_a.id, &render).unwrap();
        super::super::documents::post_sale(&db, doc_a.id).unwrap();
        super::super::documents::record_payment(
            &db,
            doc_a.id,
            &super::super::documents::PaymentInput {
                date: "2026-04-20".into(),
                amount: 8_000,
                account_id: bank,
                sub_account_id: None,
            },
        )
        .unwrap();
        {
            let conn = db.conn();
            let april = monthly(&conn, 2026, 4).unwrap();
            let row_a = april.rows.iter().find(|r| r.plan_id == pa).unwrap();
            assert_eq!(row_a.cell.status, PaymentStatus::Paid);
            assert_eq!(row_a.invoice_id, Some(doc_a.id));
            let row_b = april.rows.iter().find(|r| r.plan_id == pb).unwrap();
            assert_eq!(row_b.cell.status, PaymentStatus::Unpaid);
            assert!(row_b.invoice_id.is_some());
        }
        // B の下書きを消すと、B の分をまた作れる
        let doc_b = drafts
            .documents
            .iter()
            .find(|d| d.partner_id == Some(b))
            .unwrap();
        super::super::documents::delete(&db, doc_b.id).unwrap();
        let redo = draft_invoices(&db, 2026, 4).unwrap();
        assert_eq!(redo.documents.len(), 1);
        assert_eq!(redo.documents[0].partner_id, Some(b));
    }

    #[test]
    fn unassigned_payments_can_be_assigned_later() {
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
        let t = record(&db, 2026, &pay(None, None, "2026-05-03", 8_000, bank)).unwrap();
        let updated = assign(&db, t.id, pa, "2026-05").unwrap();
        assert!(updated.lines.iter().all(|l| l.partner_id == Some(a)));
        let conn = db.conn();
        let may = monthly(&conn, 2026, 5).unwrap();
        assert!(may.unassigned.is_empty());
        let row = may.rows.iter().find(|r| r.plan_id == pa).unwrap();
        assert_eq!(row.cell.status, PaymentStatus::Paid);
        drop(conn);
        // 割り当て済みのものは、もう割り当てない
        assert_eq!(
            assign(&db, t.id, pa, "2026-06").unwrap_err().code,
            ErrorCode::AlreadyRecorded
        );
    }
}
