//! ファイルを選ぶ画面（保存先・取り込むファイル）。Rust 側から開くので、画面には権限を渡さない。

use std::path::PathBuf;
use tauri::AppHandle;
use tauri_plugin_dialog::DialogExt;

/// 保存先を選んでもらう。やめたら `None`。
pub async fn save_path(
    app: AppHandle,
    file_name: String,
    filter: (&'static str, &'static str),
) -> Option<PathBuf> {
    tauri::async_runtime::spawn_blocking(move || {
        app.dialog()
            .file()
            .set_file_name(file_name)
            .add_filter(filter.0, &[filter.1])
            .blocking_save_file()
            .and_then(|p| p.into_path().ok())
    })
    .await
    .ok()
    .flatten()
}

/// 取り込むファイルを選んでもらう。やめたら `None`。
pub async fn open_path(
    app: AppHandle,
    filter: (&'static str, &'static [&'static str]),
) -> Option<PathBuf> {
    tauri::async_runtime::spawn_blocking(move || {
        app.dialog()
            .file()
            .add_filter(filter.0, filter.1)
            .blocking_pick_file()
            .and_then(|p| p.into_path().ok())
    })
    .await
    .ok()
    .flatten()
}

/// 画面に見せるファイル名（フォルダは見せない）。
pub fn file_name(path: &std::path::Path) -> String {
    path.file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default()
}

/// 取り込むファイルをいくつか選んでもらう。やめたら空。
pub async fn open_paths(
    app: AppHandle,
    filter: (&'static str, &'static [&'static str]),
) -> Vec<PathBuf> {
    tauri::async_runtime::spawn_blocking(move || {
        app.dialog()
            .file()
            .add_filter(filter.0, filter.1)
            .blocking_pick_files()
            .unwrap_or_default()
            .into_iter()
            .filter_map(|p| p.into_path().ok())
            .collect()
    })
    .await
    .unwrap_or_default()
}

/// フォルダを選んでもらう。やめたら `None`。
pub async fn pick_folder(app: AppHandle) -> Option<PathBuf> {
    tauri::async_runtime::spawn_blocking(move || {
        app.dialog()
            .file()
            .blocking_pick_folder()
            .and_then(|p| p.into_path().ok())
    })
    .await
    .ok()
    .flatten()
}
