//! 取引入力（かんたん入力・仕訳グリッド・複合仕訳）のコマンド。

use crate::db::{transactions, Database};
use chobiyori_core::error::AppResult;
use chobiyori_core::journal::{SimpleInput, TransactionInput};
use tauri::State;

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
) -> AppResult<transactions::Transaction> {
    transactions::create_simple(&db, fiscal_year, &input)
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
