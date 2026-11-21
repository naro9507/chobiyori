//! 確定申告・消費税の申告・インボイスの登録の補助（F12）のコマンド。
//! アプリから国税庁などへは何も送らない。公表サイトは OS のブラウザで開くだけ。

use crate::db::filing::{
    self, CheckResult, ChecklistItem, ConsumptionReport, DeadlineNotice, IncomeGuide,
    InvoiceRegistration, NumberStatus, PartnerCheck, RegistrationInput,
};
use crate::db::Database;
use chobiyori_core::error::{AppError, AppResult, ErrorCode};
use tauri::State;

/// 国税庁の適格請求書発行事業者公表サイト（登録番号の検索はここから）。
const INVOICE_SITE: &str = "https://www.invoice-kohyo.nta.go.jp/";

#[tauri::command]
pub async fn invoice_registration(db: State<'_, Database>) -> AppResult<InvoiceRegistration> {
    filing::registration(&db.conn())
}

#[tauri::command]
pub async fn save_invoice_registration(
    db: State<'_, Database>,
    input: RegistrationInput,
) -> AppResult<InvoiceRegistration> {
    filing::save_registration(&db, &input)
}

/// 年度の消費税の区分を変える。課税にしたときは付け直した行の数を返す。
#[tauri::command]
pub async fn set_tax_status(
    db: State<'_, Database>,
    fiscal_year: i64,
    tax_status: chobiyori_core::master::TaxStatus,
) -> AppResult<usize> {
    filing::set_tax_status(&db, fiscal_year, tax_status)
}

#[tauri::command]
pub async fn set_simplified_category(
    db: State<'_, Database>,
    category: Option<i64>,
) -> AppResult<InvoiceRegistration> {
    filing::set_simplified_category(&db.conn(), category)
}

#[tauri::command]
pub async fn set_account_simplified_category(
    db: State<'_, Database>,
    account_id: i64,
    category: Option<i64>,
) -> AppResult<()> {
    filing::set_account_category(&db.conn(), account_id, category)
}

#[tauri::command]
pub async fn consumption_tax_report(
    db: State<'_, Database>,
    fiscal_year: i64,
) -> AppResult<ConsumptionReport> {
    filing::consumption(&db.conn(), fiscal_year)
}

#[tauri::command]
pub async fn income_tax_guide(db: State<'_, Database>, fiscal_year: i64) -> AppResult<IncomeGuide> {
    filing::income_guide(&db.conn(), fiscal_year)
}

#[tauri::command]
pub async fn filing_checklist(
    db: State<'_, Database>,
    fiscal_year: i64,
) -> AppResult<Vec<ChecklistItem>> {
    filing::checklist(&db.conn(), fiscal_year)
}

#[tauri::command]
pub async fn set_filing_check(
    db: State<'_, Database>,
    fiscal_year: i64,
    item: String,
    done: bool,
) -> AppResult<Vec<ChecklistItem>> {
    filing::set_check(&db.conn(), fiscal_year, &item, done)
}

/// ホームに出す申告期限のお知らせ。`today` は画面の日付。
#[tauri::command]
pub async fn filing_deadlines(
    db: State<'_, Database>,
    today: String,
    include_future: Option<bool>,
) -> AppResult<Vec<DeadlineNotice>> {
    if include_future.unwrap_or_default() {
        filing::upcoming_deadlines(&db.conn(), &today)
    } else {
        filing::deadlines(&db.conn(), &today)
    }
}

#[tauri::command]
pub async fn partner_invoice_checks(
    db: State<'_, Database>,
    today: String,
) -> AppResult<Vec<PartnerCheck>> {
    filing::partner_checks(&db.conn(), &today)
}

#[tauri::command]
pub async fn invoice_number_status(
    db: State<'_, Database>,
    registration_no: String,
    today: String,
) -> AppResult<NumberStatus> {
    filing::number_status(&db.conn(), &registration_no, &today)
}

#[tauri::command]
pub async fn record_invoice_check(
    db: State<'_, Database>,
    registration_no: String,
    result: CheckResult,
    today: String,
) -> AppResult<NumberStatus> {
    filing::record_check(&db.conn(), &registration_no, result, &today)
}

/// 公表サイトを OS のブラウザで開く。開く先はこのサイトだけ（画面から URL は受け取らない）。
#[tauri::command]
pub async fn open_invoice_site() -> AppResult<()> {
    tauri_plugin_opener::open_url(INVOICE_SITE, None::<&str>)
        .map_err(|_| AppError::new(ErrorCode::FileWrite))
}
