//! 集計（試算表・口座残高）のコマンド。

use crate::db::{reports, Database};
use chobiyori_core::balance::TrialBalance;
use chobiyori_core::error::AppResult;
use tauri::State;

/// 合計残高試算表。口座残高もここから出す（`to_month` 月末の残高）。
#[tauri::command]
pub async fn trial_balance(
    db: State<'_, Database>,
    fiscal_year: i64,
    from_month: u32,
    to_month: u32,
) -> AppResult<TrialBalance> {
    reports::trial_balance(&db.conn(), fiscal_year, from_month, to_month)
}
