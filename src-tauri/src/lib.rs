//! 帳日和のバックエンド。
//!
//! 画面（React）からは Tauri コマンドとして呼び出される。
//! DB アクセス・会計の計算・取込や出力はすべてこちら側に置く。

mod commands;
pub mod db;
pub mod domain;
pub mod error;
pub mod export;
pub mod import;
pub mod mail;
pub mod receipt;

use tauri::Manager;

/// 帳簿のファイル名。アプリのデータフォルダに置く。
const DATABASE_FILE: &str = "books.db";
/// バックアップの既定の保存先（アプリのデータフォルダの中）。
const BACKUP_DIR: &str = "backups";

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // 更新後にアプリを再起動するため
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_notification::init())
        // 保存先と取り込むファイルを選ぶ画面。Rust 側からだけ開く
        .plugin(tauri_plugin_dialog::init())
        .manage(commands::import::ImportState::default())
        .manage(commands::inbox::StatementState::default())
        .setup(|app| {
            // 自動アップデート。更新の確認と適用は画面側から行う
            #[cfg(desktop)]
            app.handle()
                .plugin(tauri_plugin_updater::Builder::new().build())?;

            // 帳簿のファイルの場所だけを決める。帳簿は暗号化してあり、起動時のパスワードで
            // 開けたときに登録する（commands::security）
            let dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&dir)?;
            app.manage(commands::security::BookFiles {
                path: dir.join(DATABASE_FILE),
                default_backup_dir: dir.join(BACKUP_DIR),
                access: Default::default(),
            });
            Ok(())
        })
        .manage(commands::security::RestoreState::default())
        .invoke_handler(tauri::generate_handler![
            commands::app::app_info,
            commands::security::book_status,
            commands::security::create_books,
            commands::security::unlock_books,
            commands::security::encrypt_books,
            commands::security::change_password,
            commands::security::issue_recovery_code,
            commands::security::reset_books_password,
            commands::security::backup_settings,
            commands::security::backup_now,
            commands::security::choose_backup_dir,
            commands::security::reset_backup_dir,
            commands::security::choose_restore_file,
            commands::security::select_backup,
            commands::security::inspect_backup,
            commands::security::restore_backup,
            commands::security::lock_status,
            commands::security::set_month_lock,
            commands::security::set_year_closed,
            commands::security::list_history,
            commands::setup::get_industry_template,
            commands::setup::get_feature_settings,
            commands::setup::save_feature_settings,
            commands::setup::setup_status,
            commands::setup::complete_setup,
            commands::setup::get_business_profile,
            commands::setup::update_business_profile,
            commands::setup::list_fiscal_years,
            commands::setup::set_filing_type,
            commands::master::list_purposes,
            commands::master::create_purpose,
            commands::master::update_purpose,
            commands::master::set_purpose_active,
            commands::master::delete_purpose,
            commands::master::post_purpose,
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
            commands::books::sales_book,
            commands::export::export_report,
            commands::export::export_filing_calendar,
            commands::import::choose_import_file,
            commands::import::preview_import,
            commands::import::run_import,
            commands::recurring::list_recurring_plans,
            commands::recurring::create_recurring_plan,
            commands::recurring::update_recurring_plan,
            commands::recurring::delete_recurring_plan,
            commands::recurring::set_recurring_plan_skipped,
            commands::recurring::record_recurring_payment,
            commands::recurring::record_recurring_payments,
            commands::recurring::recurring_monthly,
            commands::recurring::recurring_year,
            commands::recurring::assign_recurring_payment,
            commands::recurring::draft_recurring_invoices,
            commands::deposits::open_deposit_targets,
            commands::deposits::record_deposit,
            commands::deposits::deposit_suggestions,
            commands::books::partner_ledgers,
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
            commands::closing::save_white_deduction,
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
            commands::closing::carry_forward,
            commands::documents::list_documents,
            commands::documents::get_document,
            commands::documents::create_document,
            commands::documents::update_document,
            commands::documents::delete_document,
            commands::documents::new_document_defaults,
            commands::documents::document_tax_mode,
            commands::documents::preview_document,
            commands::documents::issue_document,
            commands::documents::cancel_document,
            commands::documents::copy_document,
            commands::documents::save_document_pdf,
            commands::documents::document_sale_proposal,
            commands::documents::post_document_sale,
            commands::documents::record_document_payment,
            commands::documents::document_settings,
            commands::documents::save_document_settings,
            commands::documents::choose_document_image,
            commands::documents::remove_document_image,
            commands::documents::mail_settings,
            commands::documents::save_mail_settings,
            commands::documents::set_mail_password,
            commands::documents::delete_mail_password,
            commands::documents::document_mail_draft,
            commands::documents::send_document_mail,
            commands::documents::open_document_in_mail_app,
            commands::documents::mark_document_sent,
            commands::filing::invoice_registration,
            commands::filing::save_invoice_registration,
            commands::filing::set_tax_status,
            commands::filing::set_simplified_category,
            commands::filing::set_account_simplified_category,
            commands::filing::consumption_tax_report,
            commands::filing::income_tax_guide,
            commands::filing::filing_checklist,
            commands::filing::set_filing_check,
            commands::filing::filing_deadlines,
            commands::filing_notifications::sync_filing_notifications,
            commands::filing::partner_invoice_checks,
            commands::filing::invoice_number_status,
            commands::filing::record_invoice_check,
            commands::filing::open_invoice_site
        ])
        .build(tauri::generate_context!())
        .expect("アプリの起動に失敗しました")
        .run(|app, event| {
            // 終了するときに、変更があればバックアップを作る（帳簿は PC の外に送らない）
            if let tauri::RunEvent::Exit = event {
                commands::security::backup_on_exit(app);
            }
        });
}
