//! DCS 会計のバックエンド。
//!
//! 画面（React）からは Tauri コマンドとして呼び出される。
//! DB アクセス・会計の計算・取込や出力はすべてこちら側に置く。

mod commands;
pub mod db;
pub mod domain;
pub mod error;

use tauri::Manager;

/// 帳簿のファイル名。アプリのデータフォルダに置く。
const DATABASE_FILE: &str = "books.db";

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // 更新後にアプリを再起動するため
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            // 自動アップデート。更新の確認と適用は画面側から行う
            #[cfg(desktop)]
            app.handle()
                .plugin(tauri_plugin_updater::Builder::new().build())?;

            // 帳簿の DB を開く（初回は作る）。暗号化の鍵の管理はフェーズ 8 で入れる
            let dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&dir)?;
            let database = db::Database::open(&dir.join(DATABASE_FILE), None)?;
            app.manage(database);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::app::app_info,
            commands::setup::setup_status,
            commands::setup::complete_setup,
            commands::setup::get_business_profile,
            commands::setup::update_business_profile,
            commands::setup::list_fiscal_years,
            commands::master::list_accounts,
            commands::master::create_account,
            commands::master::update_account,
            commands::master::set_account_active,
            commands::master::delete_account,
            commands::master::list_sub_accounts,
            commands::master::create_sub_account,
            commands::master::update_sub_account,
            commands::master::set_sub_account_active,
            commands::master::delete_sub_account,
            commands::master::list_partners,
            commands::master::create_partner,
            commands::master::update_partner,
            commands::master::set_partner_active,
            commands::master::delete_partner,
            commands::master::list_allocation_rules,
            commands::master::create_allocation_rule,
            commands::master::update_allocation_rule,
            commands::master::set_allocation_rule_active,
            commands::master::delete_allocation_rule,
            commands::journal::list_transactions,
            commands::journal::create_transaction,
            commands::journal::create_simple_transaction,
            commands::journal::update_transaction,
            commands::journal::delete_transaction,
            commands::reports::trial_balance,
            commands::books::journal_book,
            commands::books::ledger,
            commands::books::expense_book
        ])
        .run(tauri::generate_context!())
        .expect("アプリの起動に失敗しました");
}
