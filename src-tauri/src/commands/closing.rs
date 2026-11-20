//! 決算（期首残高・固定資産と減価償却・棚卸・チェックリスト・決算書の金額・年度繰越）のコマンド。

use crate::db::closing::{
    self, CarryForward, CheckItem, InventoryStatus, OpeningBalances, OpeningRow, StatementAmounts,
};
use crate::db::fixed_assets::{self, DepreciationYear, FixedAsset, FixedAssetInput};
use crate::db::Database;
use crate::domain::depreciation::{self, UsefulLife};
use crate::error::AppResult;
use tauri::State;

#[tauri::command]
pub async fn opening_balances(
    db: State<'_, Database>,
    fiscal_year: i64,
) -> AppResult<OpeningBalances> {
    closing::opening(&db.conn(), fiscal_year)
}

#[tauri::command]
pub async fn save_opening_balances(
    db: State<'_, Database>,
    fiscal_year: i64,
    rows: Vec<OpeningRow>,
) -> AppResult<OpeningBalances> {
    closing::save_opening(&db, fiscal_year, &rows)
}

/// 期首残高を確定する（`confirmed = false` で取り消す）。
#[tauri::command]
pub async fn confirm_opening_balances(
    db: State<'_, Database>,
    fiscal_year: i64,
    confirmed: bool,
) -> AppResult<OpeningBalances> {
    closing::confirm_opening(&db, fiscal_year, confirmed)
}

#[tauri::command]
pub async fn depreciation_year(
    db: State<'_, Database>,
    fiscal_year: i64,
) -> AppResult<DepreciationYear> {
    fixed_assets::for_year(&db.conn(), fiscal_year)
}

#[tauri::command]
pub async fn useful_life_examples() -> AppResult<Vec<UsefulLife>> {
    Ok(depreciation::useful_life_examples())
}

#[tauri::command]
pub async fn create_fixed_asset(
    db: State<'_, Database>,
    input: FixedAssetInput,
    payment_account_id: Option<i64>,
) -> AppResult<FixedAsset> {
    fixed_assets::create_with_purchase(&db, &input, payment_account_id)
}

#[tauri::command]
pub async fn update_fixed_asset(
    db: State<'_, Database>,
    id: i64,
    input: FixedAssetInput,
) -> AppResult<FixedAsset> {
    fixed_assets::update(&db.conn(), id, &input)
}

#[tauri::command]
pub async fn delete_fixed_asset(db: State<'_, Database>, id: i64) -> AppResult<()> {
    fixed_assets::delete(&db.conn(), id)
}

/// 選んだ資産の償却を仕訳にする。記録した件数を返す。
#[tauri::command]
pub async fn record_depreciation(
    db: State<'_, Database>,
    fiscal_year: i64,
    asset_ids: Vec<i64>,
) -> AppResult<usize> {
    fixed_assets::record(&db, fiscal_year, &asset_ids)
}

#[tauri::command]
pub async fn inventory_status(
    db: State<'_, Database>,
    fiscal_year: i64,
) -> AppResult<InventoryStatus> {
    closing::inventory(&db.conn(), fiscal_year)
}

#[tauri::command]
pub async fn record_inventory(
    db: State<'_, Database>,
    fiscal_year: i64,
    closing_amount: i64,
) -> AppResult<InventoryStatus> {
    closing::record_inventory(&db, fiscal_year, closing_amount)
}

#[tauri::command]
pub async fn closing_checklist(
    db: State<'_, Database>,
    fiscal_year: i64,
) -> AppResult<Vec<CheckItem>> {
    closing::checklist(&db.conn(), fiscal_year)
}

#[tauri::command]
pub async fn set_closing_check(
    db: State<'_, Database>,
    fiscal_year: i64,
    item: String,
    done: bool,
) -> AppResult<Vec<CheckItem>> {
    closing::set_check(&db.conn(), fiscal_year, &item, done)
}

#[tauri::command]
pub async fn statement_amounts(
    db: State<'_, Database>,
    fiscal_year: i64,
) -> AppResult<StatementAmounts> {
    closing::statement(&db.conn(), fiscal_year)
}

/// 期末残高を翌年の期首残高にする。
#[tauri::command]
pub async fn carry_forward(
    db: State<'_, Database>,
    fiscal_year: i64,
    overwrite: bool,
) -> AppResult<CarryForward> {
    closing::carry_forward(&db, fiscal_year, overwrite)
}

#[tauri::command]
pub async fn save_white_deduction(
    db: State<'_, Database>,
    fiscal_year: i64,
    amount: i64,
) -> AppResult<StatementAmounts> {
    closing::save_white_deduction(&db, fiscal_year, amount)
}
