//! 定期売上（月謝・会費など）のプラン・入金・月ごとの一覧・年間の表のコマンド。

use crate::db::recurring::{self, MonthlyList, PaymentInput, Plan, PlanInput, YearMatrix};
use crate::db::transactions::Transaction;
use crate::db::Database;
use chobiyori_core::error::AppResult;
use tauri::State;

#[tauri::command]
pub async fn list_recurring_plans(db: State<'_, Database>) -> AppResult<Vec<Plan>> {
    recurring::list(&db.conn())
}

#[tauri::command]
pub async fn create_recurring_plan(db: State<'_, Database>, input: PlanInput) -> AppResult<Plan> {
    db.transaction(|tx| recurring::create(tx, &input))
}

#[tauri::command]
pub async fn update_recurring_plan(
    db: State<'_, Database>,
    id: i64,
    input: PlanInput,
) -> AppResult<Plan> {
    db.transaction(|tx| recurring::update(tx, id, &input))
}

#[tauri::command]
pub async fn delete_recurring_plan(db: State<'_, Database>, id: i64) -> AppResult<()> {
    db.transaction(|tx| recurring::delete(tx, id))
}

/// その月を休みにする（予定なし）か、休みを外す。`month` は `YYYY-MM`。
#[tauri::command]
pub async fn set_recurring_plan_skipped(
    db: State<'_, Database>,
    id: i64,
    month: String,
    skipped: bool,
) -> AppResult<Plan> {
    db.transaction(|tx| recurring::set_skipped(tx, id, &month, skipped))
}

/// 入金（返金）を記録する。年度は入金の日付から決める。
#[tauri::command]
pub async fn record_recurring_payment(
    db: State<'_, Database>,
    input: PaymentInput,
) -> AppResult<Transaction> {
    let year = recurring::year_of(&input.date)?;
    recurring::record(&db, year, &input)
}

/// まとめて記録する（同じ年度の入金だけ）。
#[tauri::command]
pub async fn record_recurring_payments(
    db: State<'_, Database>,
    fiscal_year: i64,
    inputs: Vec<PaymentInput>,
) -> AppResult<usize> {
    recurring::record_many(&db, fiscal_year, &inputs)
}

#[tauri::command]
pub async fn recurring_monthly(
    db: State<'_, Database>,
    fiscal_year: i64,
    month: u32,
) -> AppResult<MonthlyList> {
    recurring::monthly(&db.conn(), fiscal_year, month)
}

#[tauri::command]
pub async fn recurring_year(db: State<'_, Database>, fiscal_year: i64) -> AppResult<YearMatrix> {
    recurring::year_matrix(&db.conn(), fiscal_year)
}

/// 未割当の入金を、あとからプランと対象月に割り当てる。
#[tauri::command]
pub async fn assign_recurring_payment(
    db: State<'_, Database>,
    transaction_id: i64,
    plan_id: i64,
    month: String,
) -> AppResult<Transaction> {
    recurring::assign(&db, transaction_id, plan_id, &month)
}

/// その月に予定のあるプランから、取引先ごとに請求書の下書きを作る。
#[tauri::command]
pub async fn draft_recurring_invoices(
    db: State<'_, Database>,
    fiscal_year: i64,
    month: u32,
) -> AppResult<recurring::DraftInvoices> {
    recurring::draft_invoices(&db, fiscal_year, month)
}
