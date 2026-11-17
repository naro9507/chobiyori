//! 初期設定と事業者情報のコマンド。

use crate::db::setup::{self, BusinessProfile, FiscalYear, SetupInput, SetupStatus};
use crate::db::Database;
use crate::error::AppResult;
use tauri::State;

/// 初期設定が済んでいるか。済んでいなければ画面は初期設定ウィザードを出す。
#[tauri::command]
pub async fn setup_status(db: State<'_, Database>) -> AppResult<SetupStatus> {
    setup::status(&db.conn())
}

/// 初期設定を行い、標準の勘定科目を入れる。
#[tauri::command]
pub async fn complete_setup(db: State<'_, Database>, input: SetupInput) -> AppResult<SetupStatus> {
    setup::complete(&db, &input)
}

#[tauri::command]
pub async fn get_business_profile(db: State<'_, Database>) -> AppResult<BusinessProfile> {
    setup::profile(&db.conn())
}

#[tauri::command]
pub async fn update_business_profile(
    db: State<'_, Database>,
    input: BusinessProfile,
) -> AppResult<BusinessProfile> {
    setup::update_profile(&db.conn(), &input)
}

#[tauri::command]
pub async fn list_fiscal_years(db: State<'_, Database>) -> AppResult<Vec<FiscalYear>> {
    setup::fiscal_years(&db.conn())
}

#[tauri::command]
pub async fn get_feature_settings(db: State<'_, Database>) -> AppResult<setup::FeatureSettings> {
    setup::features(&db.conn())
}

#[tauri::command]
pub async fn save_feature_settings(
    db: State<'_, Database>,
    input: setup::FeatureSettings,
) -> AppResult<setup::FeatureSettings> {
    setup::save_features(&db.conn(), &input)
}

#[tauri::command]
pub async fn get_industry_template(db: State<'_, Database>) -> AppResult<setup::IndustryTemplate> {
    setup::industry_template(&db.conn())
}
