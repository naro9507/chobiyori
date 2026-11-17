//! DCS 会計のバックエンド。
//!
//! 画面（React）からは Tauri コマンドとして呼び出される。
//! DB アクセス・会計の計算・取込や出力はすべてこちら側に置く。

mod commands;
pub mod db;
pub mod domain;
pub mod error;
pub mod export;
pub mod import;
pub mod receipt;

use tauri::Manager;

/// 帳簿のファイル名。アプリのデータフォルダに置く。
const DATABASE_FILE: &str = "books.db";

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // 更新後にアプリを再起動するため
        .plugin(tauri_plugin_process::init())
        // 保存先と取り込むファイルを選ぶ画面。Rust 側からだけ開く
        .plugin(tauri_plugin_dialog::init())
        .manage(commands::import::ImportState::default())
        .manage(commands::inbox::StatementState::default())
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
            commands::books::expense_book,
            commands::export::export_report,
            commands::import::choose_import_file,
            commands::import::preview_import,
            commands::import::run_import,
            commands::templates::list_templates,
            commands::templates::create_template,
            commands::templates::update_template,
            commands::templates::delete_template,
            commands::templates::template_candidates,
            commands::templates::skipped_template_months,
            commands::templates::post_template,
            commands::templates::skip_template_month,
            commands::templates::unskip_template_month,
            commands::inbox::list_import_formats,
            commands::inbox::save_import_format,
            commands::inbox::delete_import_format,
            commands::inbox::export_import_format,
            commands::inbox::open_import_format_file,
            commands::inbox::open_statement,
            commands::inbox::preview_statement,
            commands::inbox::import_statement,
            commands::inbox::list_inbox,
            commands::inbox::inbox_pending_count,
            commands::inbox::confirm_inbox_item,
            commands::inbox::confirm_inbox_items,
            commands::inbox::set_inbox_ignored,
            commands::inbox::delete_inbox_items,
            commands::inbox::list_rules,
            commands::inbox::save_rule,
            commands::inbox::delete_rule,
            commands::receipts::receipt_settings,
            commands::receipts::save_receipt_settings,
            commands::receipts::set_gemini_key,
            commands::receipts::delete_gemini_key,
            commands::receipts::choose_receipt_files,
            commands::receipts::choose_receipt_folder,
            commands::receipts::list_receipts,
            commands::receipts::read_next_receipt,
            commands::receipts::save_receipt_fields,
            commands::receipts::set_receipt_send_allowed,
            commands::receipts::retry_receipt,
            commands::receipts::delete_receipt,
            commands::receipts::attachment_content,
            commands::receipts::save_attachment_copy,
            commands::receipts::list_attachments,
            commands::receipts::attachment_counts,
            commands::receipts::attach_files,
            commands::receipts::delete_attachment,
            commands::receipts::link_inbox_item,
            commands::receipts::unlink_inbox_item,
            commands::receipts::reconciliation,
            commands::closing::opening_balances,
            commands::closing::save_opening_balances,
            commands::closing::confirm_opening_balances,
            commands::closing::depreciation_year,
            commands::closing::useful_life_examples,
            commands::closing::create_fixed_asset,
            commands::closing::update_fixed_asset,
            commands::closing::delete_fixed_asset,
            commands::closing::record_depreciation,
            commands::closing::inventory_status,
            commands::closing::record_inventory,
            commands::closing::closing_checklist,
            commands::closing::set_closing_check,
            commands::closing::statement_amounts,
            commands::closing::carry_forward
        ])
        .run(tauri::generate_context!())
        .expect("アプリの起動に失敗しました");
}
