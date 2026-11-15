//! 帳簿の出力（CSV・PDF）のコマンド。中身を作ってから保存先を選んでもらう。

use super::files;
use crate::db::Database;
use crate::error::{AppError, AppResult, ErrorCode};
use crate::export::{self, ExportFormat, ExportRequest};
use tauri::{AppHandle, State};

/// 帳簿を出力する。保存したファイルの名前を返す。保存先を選ばずにやめたら `None`。
#[tauri::command]
pub async fn export_report(
    app: AppHandle,
    db: State<'_, Database>,
    request: ExportRequest,
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
    Ok(Some(files::file_name(&path)))
}
