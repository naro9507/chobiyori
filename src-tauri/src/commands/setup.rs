//! 初期設定と事業者情報のコマンド。

use chobiyori_core::error::AppResult;
use chobiyori_core::master::FilingType;
use chobiyori_storage::setup::{self, BusinessProfile, FiscalYear, SetupInput, SetupStatus};
use chobiyori_storage::Database;
use tauri::State;

/// 年が明けていたら、今年の年度を用意する（前の年の申告の前でも、1 月から記録できるように）。
fn start_this_year(db: &Database) -> AppResult<()> {
    let conn = db.conn();
    let year: i64 = conn.query_row(
        "SELECT CAST(strftime('%Y', 'now', 'localtime') AS INTEGER)",
        [],
        |r| r.get(0),
    )?;
    setup::start_calendar_year(&conn, year)?;
    Ok(())
}

/// 初期設定が済んでいるか。済んでいなければ画面は初期設定ウィザードを出す。
#[tauri::command]
pub async fn setup_status(db: State<'_, Database>) -> AppResult<SetupStatus> {
    start_this_year(&db)?;
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
    start_this_year(&db)?;
    setup::fiscal_years(&db.conn())
}

/// 年度の申告区分（青色・白色）を変える。
#[tauri::command]
pub async fn set_filing_type(
    db: State<'_, Database>,
    fiscal_year: i64,
    filing_type: FilingType,
) -> AppResult<Vec<FiscalYear>> {
    setup::set_filing_type(&db, fiscal_year, filing_type)
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
