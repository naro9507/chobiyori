//! 定型仕訳（毎月の取引のひな形）と、毎月の候補のコマンド。

use crate::db::templates::{self, Candidate, PostInput, Template, TemplateInput};
use crate::db::transactions::Transaction;
use crate::db::Database;
use chobiyori_core::error::AppResult;
use tauri::State;

#[tauri::command]
pub async fn list_templates(db: State<'_, Database>) -> AppResult<Vec<Template>> {
    templates::list(&db.conn())
}

#[tauri::command]
pub async fn create_template(db: State<'_, Database>, input: TemplateInput) -> AppResult<Template> {
    db.transaction(|tx| templates::create(tx, &input))
}

#[tauri::command]
pub async fn update_template(
    db: State<'_, Database>,
    id: i64,
    input: TemplateInput,
) -> AppResult<Template> {
    db.transaction(|tx| templates::update(tx, id, &input))
}

#[tauri::command]
pub async fn delete_template(db: State<'_, Database>, id: i64) -> AppResult<()> {
    db.transaction(|tx| templates::delete(tx, id))
}

/// 記録を待っている毎月の候補。`upto_month` 月まで（今年なら今月、過去の年度なら 12 月）。
#[tauri::command]
pub async fn template_candidates(
    db: State<'_, Database>,
    fiscal_year: i64,
    upto_month: u32,
) -> AppResult<Vec<Candidate>> {
    templates::candidates(&db.conn(), fiscal_year, upto_month)
}

/// 見送った月。
#[tauri::command]
pub async fn skipped_template_months(
    db: State<'_, Database>,
    fiscal_year: i64,
) -> AppResult<Vec<Candidate>> {
    templates::skipped(&db.conn(), fiscal_year)
}

/// 定型仕訳から取引を記録する。金額・日付・按分の割合はこの取引だけ直せる。
#[tauri::command]
pub async fn post_template(
    db: State<'_, Database>,
    id: i64,
    fiscal_year: i64,
    input: PostInput,
) -> AppResult<Transaction> {
    templates::post(&db, id, fiscal_year, &input)
}

#[tauri::command]
pub async fn skip_template_month(
    db: State<'_, Database>,
    id: i64,
    fiscal_year: i64,
    month: u32,
) -> AppResult<()> {
    templates::skip(&db, id, fiscal_year, month)
}

#[tauri::command]
pub async fn unskip_template_month(
    db: State<'_, Database>,
    id: i64,
    fiscal_year: i64,
    month: u32,
) -> AppResult<()> {
    templates::unskip(&db.conn(), id, fiscal_year, month)
}
