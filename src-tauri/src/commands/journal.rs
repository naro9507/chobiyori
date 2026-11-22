//! 取引入力（かんたん入力・仕訳グリッド・複合仕訳）のコマンド。

use chobiyori_core::error::AppResult;
use chobiyori_core::journal::{SimpleInput, TransactionInput};
use chobiyori_storage::{transactions, Database};
use tauri::State;

#[tauri::command]
pub fn preview_business_share(
    amount: i64,
    percent: i64,
    rounding: chobiyori_core::master::Rounding,
) -> AppResult<(i64, i64)> {
    if !(1..=chobiyori_core::journal::AMOUNT_MAX).contains(&amount) || !(0..=100).contains(&percent)
    {
        return Err(chobiyori_core::error::AppError::new(
            chobiyori_core::error::ErrorCode::OutOfRange,
        ));
    }
    let split = chobiyori_core::allocation::allocate(amount, percent, rounding);
    Ok((split.business, split.private))
}

/// 年度の取引。`month`（1〜12）を渡すとその月だけ。
#[tauri::command]
pub async fn list_transactions(
    db: State<'_, Database>,
    fiscal_year: i64,
    month: Option<u32>,
) -> AppResult<Vec<transactions::Transaction>> {
    transactions::list(&db.conn(), fiscal_year, month)
}

/// 仕訳グリッド・複合仕訳の取引を保存する。
#[tauri::command]
pub async fn create_transaction(
    db: State<'_, Database>,
    fiscal_year: i64,
    input: TransactionInput,
) -> AppResult<transactions::Transaction> {
    transactions::create(&db, fiscal_year, &input)
}

/// かんたん入力の取引を保存する。
#[tauri::command]
pub async fn create_simple_transaction(
    db: State<'_, Database>,
    fiscal_year: i64,
    input: SimpleInput,
    bill_id: Option<i64>,
) -> AppResult<transactions::Transaction> {
    transactions::create_simple_for_bill(&db, fiscal_year, &input, bill_id)
}

#[tauri::command]
pub async fn update_transaction(
    db: State<'_, Database>,
    id: i64,
    input: TransactionInput,
) -> AppResult<transactions::Transaction> {
    transactions::update(&db, id, &input)
}

#[tauri::command]
pub async fn delete_transaction(db: State<'_, Database>, id: i64) -> AppResult<()> {
    transactions::delete(&db, id)
}
