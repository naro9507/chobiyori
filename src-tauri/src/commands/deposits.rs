//! 入金を請求書・定期売上に結び付けて記録するコマンド（かんたん入力・受信箱から）。

use crate::db::deposits::{self, DepositInput, DepositSuggestion, OpenTargets};
use crate::db::transactions::Transaction;
use crate::db::{inbox, Database};
use chobiyori_core::error::AppResult;
use tauri::State;

/// 入金を待っている請求書と、年度の定期売上の未入金の月。
#[tauri::command]
pub async fn open_deposit_targets(
    db: State<'_, Database>,
    fiscal_year: i64,
) -> AppResult<OpenTargets> {
    deposits::open_targets(&db.conn(), fiscal_year)
}

/// かんたん入力の「収入」から、入金を請求書か定期売上に記録する。
#[tauri::command]
pub async fn record_deposit(
    db: State<'_, Database>,
    input: DepositInput,
) -> AppResult<Transaction> {
    deposits::record(&db, &input)
}

/// 受信箱の入金の行に合う、請求書・定期売上の候補。
#[tauri::command]
pub async fn deposit_suggestions(
    db: State<'_, Database>,
    item_id: i64,
) -> AppResult<Vec<DepositSuggestion>> {
    let conn = db.conn();
    let item = inbox::get(&conn, item_id)?;
    deposits::suggest(&conn, &item.date, -item.spend, &item.merchant)
}
