//! 取込受信箱・取込形式・自動仕訳ルールのコマンド。
//!
//! 明細のファイルは Rust 側で選んでもらい、中身はここで覚えておく（場所は画面に渡さない）。
//! 画面からは「開いた明細」に対して、形式の試し読みと受信箱への取込だけを頼める。

use super::files;
use crate::db::formats::{self, FormatFile, FormatInput, ImportFormat};
use crate::db::inbox::{self, AddResult, BulkResult, ConfirmInput, InboxItem, InboxStatus};
use crate::db::rules::{self, RuleInput};
use crate::db::transactions::Transaction;
use crate::db::Database;
use crate::domain::rules::Rule;
use crate::domain::statement::{
    self, ColumnRole, FormatDefinition, HeaderDiff, RowNote, StatementRow,
};
use crate::error::{AppError, AppResult, ErrorCode};
use crate::import::statement_file;
use serde::Serialize;
use std::sync::Mutex;
use tauri::{AppHandle, State};

/// 読むファイルの大きさの上限
const FILE_MAX: u64 = 20 * 1024 * 1024;
/// 画面に返す行の数の上限（プレビュー・読めなかった行の一覧）
const PREVIEW_ROWS: usize = 30;
const NOTES_MAX: usize = 200;

struct Opened {
    file_name: String,
    bytes: Vec<u8>,
}

#[derive(Default)]
pub struct StatementState(Mutex<Option<Opened>>);

fn with_opened<T>(state: &StatementState, f: impl FnOnce(&Opened) -> AppResult<T>) -> AppResult<T> {
    let guard = state.0.lock().unwrap_or_else(|p| p.into_inner());
    let opened = guard
        .as_ref()
        .ok_or(AppError::field(ErrorCode::Required, "file"))?;
    f(opened)
}

/// 利用者の形式とプリセット（利用者の形式が先）。
fn all_formats(db: &Database) -> AppResult<Vec<ImportFormat>> {
    let mut list = formats::list(&db.conn())?;
    list.extend(formats::presets());
    Ok(list)
}

#[tauri::command]
pub async fn list_import_formats(db: State<'_, Database>) -> AppResult<Vec<ImportFormat>> {
    all_formats(&db)
}

#[tauri::command]
pub async fn save_import_format(
    db: State<'_, Database>,
    id: Option<i64>,
    input: FormatInput,
) -> AppResult<ImportFormat> {
    let conn = db.conn();
    match id {
        Some(id) => formats::update(&conn, id, &input),
        None => formats::create(&conn, &input),
    }
}

#[tauri::command]
pub async fn delete_import_format(db: State<'_, Database>, id: i64) -> AppResult<()> {
    formats::delete(&db.conn(), id)
}

/// 形式をファイル（JSON）に書き出す。取込先の口座は書かない。
#[tauri::command]
pub async fn export_import_format(
    app: AppHandle,
    db: State<'_, Database>,
    id: Option<i64>,
    preset: Option<String>,
) -> AppResult<Option<String>> {
    let format = all_formats(&db)?
        .into_iter()
        .find(|f| (id.is_some() && f.id == id) || (preset.is_some() && f.preset == preset))
        .ok_or(AppError::field(ErrorCode::NotFound, "formatId"))?;
    let text = serde_json::to_string_pretty(&FormatFile::of(&format))
        .map_err(|_| AppError::new(ErrorCode::FileWrite))?;
    let name = format!(
        "{}.json",
        format
            .name
            .replace(['/', '\\', ':', '*', '?', '"', '<', '>', '|'], "_")
    );
    let Some(path) = files::save_path(app, name, ("JSON", "json")).await else {
        return Ok(None);
    };
    std::fs::write(&path, text).map_err(|_| AppError::new(ErrorCode::FileWrite))?;
    Ok(Some(files::file_name(&path)))
}

/// 形式のファイル（JSON）を読む。保存は画面で取込先を選んでから。
#[tauri::command]
pub async fn open_import_format_file(app: AppHandle) -> AppResult<Option<FormatFile>> {
    let Some(path) = files::open_path(app, ("JSON", &["json"])).await else {
        return Ok(None);
    };
    let text = std::fs::read_to_string(&path).map_err(|_| AppError::new(ErrorCode::FileRead))?;
    FormatFile::parse(&text).map(Some)
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenedStatement {
    pub file_name: String,
    /// 見出しが合った形式（利用者の形式かプリセット）
    pub matched: Option<ImportFormat>,
    /// 合う形式がないときの見当
    pub guess: FormatDefinition,
}

/// 明細のファイルを選んで開く。やめたら `None`。
#[tauri::command]
pub async fn open_statement(
    app: AppHandle,
    db: State<'_, Database>,
    state: State<'_, StatementState>,
) -> AppResult<Option<OpenedStatement>> {
    let Some(path) = files::open_path(
        app,
        ("CSV / Excel", &["csv", "txt", "tsv", "xlsx", "xlsm", "xls"]),
    )
    .await
    else {
        return Ok(None);
    };
    let size = std::fs::metadata(&path)
        .map_err(|_| AppError::new(ErrorCode::FileRead))?
        .len();
    if size > FILE_MAX {
        return Err(AppError::new(ErrorCode::FileRead));
    }
    let bytes = std::fs::read(&path).map_err(|_| AppError::new(ErrorCode::FileRead))?;
    let file_name = files::file_name(&path);
    let guess = statement_file::guess(&bytes, &file_name)?;
    let matched = statement_file::matching_format(&bytes, &file_name, &all_formats(&db)?);
    *state.0.lock().unwrap_or_else(|p| p.into_inner()) = Some(Opened {
        file_name: file_name.clone(),
        bytes,
    });
    Ok(Some(OpenedStatement {
        file_name,
        matched,
        guess,
    }))
}

/// 形式で読んだ結果のまとめ（形式エディタの試し読み）。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StatementPreview {
    /// ファイルの先頭の行（そのままの文字列）
    pub rows: Vec<Vec<String>>,
    pub row_count: usize,
    /// 見出しの行の中身（保存するとき、この形式の目印にする）
    pub header: Vec<String>,
    pub missing_roles: Vec<ColumnRole>,
    pub valid_count: usize,
    pub ignored: Vec<RowNote>,
    pub ignored_count: usize,
    pub errors: Vec<RowNote>,
    pub error_count: usize,
    pub first_date: Option<String>,
    pub last_date: Option<String>,
    pub total_spend: i64,
    pub total_back: i64,
    pub sample: Vec<StatementRow>,
}

#[tauri::command]
pub async fn preview_statement(
    state: State<'_, StatementState>,
    definition: FormatDefinition,
) -> AppResult<StatementPreview> {
    with_opened(&state, |opened| {
        let table = statement_file::table(
            &opened.bytes,
            &opened.file_name,
            definition.encoding,
            definition.delimiter,
        )?;
        let s = statement::read(&table, &definition);
        let (total_spend, total_back) = s.totals();
        Ok(StatementPreview {
            rows: table.iter().take(PREVIEW_ROWS).cloned().collect(),
            row_count: table.len(),
            header: statement::header_for_save(&table, &definition),
            missing_roles: definition.missing_roles(),
            valid_count: s.rows.len(),
            ignored_count: s.ignored.len(),
            ignored: s.ignored.iter().take(NOTES_MAX).cloned().collect(),
            error_count: s.errors.len(),
            errors: s.errors.iter().take(NOTES_MAX).cloned().collect(),
            first_date: s.first_date().map(str::to_string),
            last_date: s.last_date().map(str::to_string),
            total_spend,
            total_back,
            sample: s.rows.iter().take(PREVIEW_ROWS).cloned().collect(),
        })
    })
}

/// 受信箱への取込の結果。
#[derive(Debug, Clone, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum StatementImport {
    Imported {
        added: usize,
        duplicates: usize,
    },
    /// 見出しが保存した形式と違う。取り込んでいない
    Mismatch {
        diff: HeaderDiff,
    },
    /// 読めない行がある。取り込んでいない
    Problems {
        errors: Vec<RowNote>,
        error_count: usize,
    },
}

/// 開いた明細を、保存した形式で読んで受信箱に入れる。
#[tauri::command]
pub async fn import_statement(
    db: State<'_, Database>,
    state: State<'_, StatementState>,
    format_id: i64,
) -> AppResult<StatementImport> {
    let format = formats::get(&db.conn(), format_id)?;
    let read = with_opened(&state, |opened| {
        Ok((
            opened.file_name.clone(),
            statement_file::read_with(&opened.bytes, &opened.file_name, &format.definition)?,
        ))
    })?;
    let (file_name, statement) = match read {
        (_, Err(diff)) => return Ok(StatementImport::Mismatch { diff }),
        (name, Ok(s)) => (name, s),
    };
    if !statement.errors.is_empty() {
        return Ok(StatementImport::Problems {
            error_count: statement.errors.len(),
            errors: statement.errors.into_iter().take(NOTES_MAX).collect(),
        });
    }
    let AddResult { added, duplicates } =
        db.transaction(|tx| inbox::add_statement(tx, &format, &file_name, &statement.rows))?;
    Ok(StatementImport::Imported { added, duplicates })
}

#[tauri::command]
pub async fn list_inbox(
    db: State<'_, Database>,
    status: Option<InboxStatus>,
) -> AppResult<Vec<InboxItem>> {
    inbox::list(&db.conn(), status)
}

#[tauri::command]
pub async fn inbox_pending_count(db: State<'_, Database>) -> AppResult<i64> {
    inbox::pending_count(&db.conn())
}

#[tauri::command]
pub async fn confirm_inbox_item(
    db: State<'_, Database>,
    id: i64,
    input: ConfirmInput,
) -> AppResult<Transaction> {
    inbox::confirm(&db, id, &input)
}

/// まとめて確定する。`input` がなければ候補どおり。
#[tauri::command]
pub async fn confirm_inbox_items(
    db: State<'_, Database>,
    ids: Vec<i64>,
    input: Option<ConfirmInput>,
) -> AppResult<BulkResult> {
    inbox::confirm_many(&db, &ids, input.as_ref())
}

#[tauri::command]
pub async fn set_inbox_ignored(
    db: State<'_, Database>,
    ids: Vec<i64>,
    ignored: bool,
) -> AppResult<usize> {
    inbox::set_ignored(&db.conn(), &ids, ignored)
}

#[tauri::command]
pub async fn delete_inbox_items(db: State<'_, Database>, ids: Vec<i64>) -> AppResult<usize> {
    inbox::delete(&db.conn(), &ids)
}

#[tauri::command]
pub async fn list_rules(db: State<'_, Database>) -> AppResult<Vec<Rule>> {
    rules::list(&db.conn())
}

#[tauri::command]
pub async fn save_rule(
    db: State<'_, Database>,
    id: Option<i64>,
    input: RuleInput,
) -> AppResult<Rule> {
    let conn = db.conn();
    match id {
        Some(id) => rules::update(&conn, id, &input),
        None => rules::create(&conn, &input),
    }
}

#[tauri::command]
pub async fn delete_rule(db: State<'_, Database>, id: i64) -> AppResult<()> {
    rules::delete(&db.conn(), id)
}
