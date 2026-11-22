//! 帳簿の出力（CSV・PDF）のコマンド。中身を作ってから保存先を選んでもらう。

use super::files;
use crate::export::{self, filing_calendar, labels::Locale, ExportFormat, ExportRequest};
use chobiyori_core::error::{AppError, AppResult, ErrorCode};
use chobiyori_storage::Database;
use tauri::{AppHandle, State};

#[derive(Default)]
pub struct SavedExports(std::sync::Mutex<std::collections::VecDeque<(String, std::path::PathBuf)>>);

#[tauri::command]
pub fn reveal_export(exports: State<'_, SavedExports>, receipt: String) -> AppResult<()> {
    let path = exports
        .0
        .lock()
        .map_err(|_| AppError::new(ErrorCode::FileRead))?
        .iter()
        .find(|(key, _)| key == &receipt)
        .map(|(_, p)| p.clone())
        .ok_or(AppError::new(ErrorCode::NotFound))?;
    tauri_plugin_opener::reveal_item_in_dir(path).map_err(|_| AppError::new(ErrorCode::FileRead))
}

/// 帳簿を出力する。保存したファイルの名前を返す。保存先を選ばずにやめたら `None`。
#[tauri::command]
pub async fn export_report(
    app: AppHandle,
    db: State<'_, Database>,
    request: ExportRequest,
    exports: State<'_, SavedExports>,
    receipt: Option<String>,
) -> AppResult<Option<String>> {
    // フォントが見つからない・Shift_JIS で書けないなどは、保存先を選ぶ前に知らせる
    let file = export::build(&db.conn(), &request)?;
    let filter = match request.format {
        ExportFormat::Csv => ("CSV", "csv"),
        ExportFormat::Pdf => ("PDF", "pdf"),
    };
    let Some(path) = files::save_path(app, file.name, filter).await else {
        return Ok(None);
    };
    std::fs::write(&path, &file.bytes).map_err(|_| AppError::new(ErrorCode::FileWrite))?;
    if let Some(receipt) = receipt {
        let mut recent = exports
            .0
            .lock()
            .map_err(|_| AppError::new(ErrorCode::FileWrite))?;
        recent.push_front((receipt, path.clone()));
        recent.truncate(32);
    }
    Ok(Some(files::file_name(&path)))
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub enum FilingCalendarExport {
    Saved,
    Cancelled,
    NoDeadlines,
}

/// 未提出の申告期限だけをカレンダーに書き出す。
#[tauri::command]
pub async fn export_filing_calendar(
    app: AppHandle,
    db: State<'_, Database>,
    today: String,
    locale: Locale,
) -> AppResult<FilingCalendarExport> {
    let file = {
        let conn = db.conn();
        let deadlines = chobiyori_storage::filing::upcoming_deadlines(&conn, &today)?;
        let stamp: String =
            conn.query_row("SELECT strftime('%Y%m%dT%H%M%SZ', 'now')", [], |row| {
                row.get(0)
            })?;
        filing_calendar::build(&deadlines, locale, &stamp)
    };
    let Some(file) = file else {
        return Ok(FilingCalendarExport::NoDeadlines);
    };
    let Some(path) = files::save_path(
        app,
        "chobiyori-filing-deadlines.ics".into(),
        ("iCalendar", "ics"),
    )
    .await
    else {
        return Ok(FilingCalendarExport::Cancelled);
    };
    std::fs::write(path, file).map_err(|_| AppError::new(ErrorCode::FileWrite))?;
    Ok(FilingCalendarExport::Saved)
}
