//! 帳簿の取込（仕訳の CSV・Excel 帳簿）のコマンド。
//!
//! 取り込むファイルは Rust 側で選んでもらい、その場所は画面に渡さずここで覚えておく。
//! 画面からは「選んだファイル」に対して、プレビューと取込だけを頼める。

use super::files;
use crate::db::Database;
use crate::error::{AppError, AppResult, ErrorCode};
use crate::import::{
    self, excel_book, journal_csv, AccountMapping, ImportPreview, ImportResult, Parsed,
};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, State};

/// 読むファイルの大きさの上限。帳簿 1 年分なら数 MB に収まる
const FILE_MAX: u64 = 50 * 1024 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ImportKind {
    /// このアプリの仕訳の CSV（他のソフトから移すときもこの形にする）
    JournalCsv,
    /// SPEC 第 1 章の様式の Excel 帳簿
    ExcelBook,
}

struct Chosen {
    path: PathBuf,
    kind: ImportKind,
    /// 読んだ結果（Excel 帳簿は年度ごと）。対応を変えてプレビューし直すたびに読まないため
    parsed: Option<(Option<i64>, Parsed)>,
}

#[derive(Default)]
pub struct ImportState(Mutex<Option<Chosen>>);

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChosenFile {
    pub name: String,
    pub kind: ImportKind,
    /// ファイル名から読んだ年（Excel 帳簿の年度の初期値）
    pub suggested_year: Option<i64>,
}

#[tauri::command]
pub async fn choose_import_file(
    app: AppHandle,
    state: State<'_, ImportState>,
    kind: ImportKind,
) -> AppResult<Option<ChosenFile>> {
    let filter: (&str, &[&str]) = match kind {
        ImportKind::JournalCsv => ("CSV", &["csv", "txt"]),
        ImportKind::ExcelBook => ("Excel", &["xlsx", "xlsm", "xls"]),
    };
    let Some(path) = files::open_path(app, filter).await else {
        return Ok(None);
    };
    let name = files::file_name(&path);
    let chosen = ChosenFile {
        suggested_year: excel_book::year_in_file_name(&name),
        name,
        kind,
    };
    *state.0.lock().unwrap_or_else(|p| p.into_inner()) = Some(Chosen {
        path,
        kind,
        parsed: None,
    });
    Ok(Some(chosen))
}

fn parse(chosen: &Chosen, year: Option<i64>) -> AppResult<Parsed> {
    let size = std::fs::metadata(&chosen.path)
        .map_err(|_| AppError::new(ErrorCode::FileRead))?
        .len();
    if size > FILE_MAX {
        return Err(AppError::new(ErrorCode::FileRead));
    }
    let bytes = std::fs::read(&chosen.path).map_err(|_| AppError::new(ErrorCode::FileRead))?;
    match chosen.kind {
        ImportKind::JournalCsv => journal_csv::parse(&bytes),
        ImportKind::ExcelBook => {
            let year = year.ok_or(AppError::field(ErrorCode::Required, "fiscalYear"))?;
            excel_book::parse(&bytes, year)
        }
    }
}

/// 選んだファイルを読む（読んだことがあれば覚えている結果を使う）。
fn with_parsed<T>(
    state: &ImportState,
    year: Option<i64>,
    f: impl FnOnce(&Parsed) -> AppResult<T>,
) -> AppResult<T> {
    let mut guard = state.0.lock().unwrap_or_else(|p| p.into_inner());
    let chosen = guard
        .as_mut()
        .ok_or(AppError::field(ErrorCode::Required, "file"))?;
    // CSV は年度をファイルの日付から決めるので、年度で読み分けない
    let key = if chosen.kind == ImportKind::ExcelBook {
        year
    } else {
        None
    };
    if chosen.parsed.as_ref().is_none_or(|(k, _)| *k != key) {
        let parsed = parse(chosen, year)?;
        chosen.parsed = Some((key, parsed));
    }
    let (_, parsed) = chosen
        .parsed
        .as_ref()
        .ok_or(AppError::new(ErrorCode::FileRead))?;
    f(parsed)
}

#[tauri::command]
pub async fn preview_import(
    db: State<'_, Database>,
    state: State<'_, ImportState>,
    fiscal_year: Option<i64>,
    mapping: Vec<AccountMapping>,
) -> AppResult<ImportPreview> {
    with_parsed(&state, fiscal_year, |parsed| {
        import::preview(&db.conn(), parsed, fiscal_year, &mapping)
    })
}

#[tauri::command]
pub async fn run_import(
    db: State<'_, Database>,
    state: State<'_, ImportState>,
    fiscal_year: Option<i64>,
    mapping: Vec<AccountMapping>,
) -> AppResult<ImportResult> {
    let result = with_parsed(&state, fiscal_year, |parsed| {
        import::commit(&db, parsed, fiscal_year, &mapping)
    })?;
    *state.0.lock().unwrap_or_else(|p| p.into_inner()) = None;
    Ok(result)
}
