//! DCS 会計のバックエンド。
//!
//! 画面（React）からは Tauri コマンドとして呼び出される。
//! DB アクセス・会計の計算・取込や出力はすべてこちら側に置く。

mod commands;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![commands::app::app_info])
        .run(tauri::generate_context!())
        .expect("アプリの起動に失敗しました");
}
