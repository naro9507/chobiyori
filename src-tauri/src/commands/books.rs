//! 帳簿（仕訳帳・総勘定元帳・出納帳・経費帳）のコマンド。どれも仕訳から計算する。

use crate::db::books::{self, JournalBook};
use crate::db::Database;
use crate::domain::ledger::Ledger;
use crate::error::AppResult;
use tauri::State;

#[tauri::command]
pub async fn journal_book(
    db: State<'_, Database>,
    fiscal_year: i64,
    from_month: u32,
    to_month: u32,
) -> AppResult<JournalBook> {
    books::journal(&db.conn(), fiscal_year, from_month, to_month)
}

/// 1 つの科目の元帳。現金出納帳・預金出納帳もこれで読む。
#[tauri::command]
pub async fn ledger(
    db: State<'_, Database>,
    fiscal_year: i64,
    from_month: u32,
    to_month: u32,
    account_id: i64,
) -> AppResult<Ledger> {
    books::ledger(&db.conn(), fiscal_year, from_month, to_month, account_id)
}

#[tauri::command]
pub async fn expense_book(
    db: State<'_, Database>,
    fiscal_year: i64,
    from_month: u32,
    to_month: u32,
) -> AppResult<Vec<Ledger>> {
    books::expense_book(&db.conn(), fiscal_year, from_month, to_month)
}

/// 売掛帳・買掛帳。科目（売掛金・買掛金）の動きを取引先ごとに分ける。
#[tauri::command]
pub async fn partner_ledgers(
    db: State<'_, Database>,
    fiscal_year: i64,
    from_month: u32,
    to_month: u32,
    account_id: i64,
) -> AppResult<Vec<books::PartnerLedger>> {
    books::partner_ledgers(&db.conn(), fiscal_year, from_month, to_month, account_id)
}

#[tauri::command]
pub async fn sales_book(
    db: State<'_, Database>,
    fiscal_year: i64,
    from_month: u32,
    to_month: u32,
) -> AppResult<Vec<Ledger>> {
    books::sales_book(&db.conn(), fiscal_year, from_month, to_month)
}
