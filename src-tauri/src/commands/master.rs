//! マスタ（勘定科目・補助科目・取引先・家事按分ルール）のコマンド。
//! どのマスタも「一覧・追加・変更・有効/無効・削除」の 5 つをそろえる。

use chobiyori_core::error::AppResult;
use chobiyori_storage::{accounts, allocation_rules, partners, sub_accounts, Database};
use tauri::State;

// 勘定科目

#[tauri::command]
pub async fn list_accounts(db: State<'_, Database>) -> AppResult<Vec<accounts::Account>> {
    accounts::list(&db.conn())
}

#[tauri::command]
pub async fn create_account(
    db: State<'_, Database>,
    input: accounts::AccountInput,
) -> AppResult<accounts::Account> {
    accounts::create(&db.conn(), &input)
}

#[tauri::command]
pub async fn update_account(
    db: State<'_, Database>,
    id: i64,
    input: accounts::AccountInput,
) -> AppResult<accounts::Account> {
    accounts::update(&db.conn(), id, &input)
}

#[tauri::command]
pub async fn set_account_active(
    db: State<'_, Database>,
    id: i64,
    active: bool,
) -> AppResult<accounts::Account> {
    accounts::set_active(&db.conn(), id, active)
}

#[tauri::command]
pub async fn delete_account(db: State<'_, Database>, id: i64) -> AppResult<()> {
    accounts::delete(&db.conn(), id)
}

// 補助科目

#[tauri::command]
pub async fn list_sub_accounts(
    db: State<'_, Database>,
) -> AppResult<Vec<sub_accounts::SubAccount>> {
    sub_accounts::list(&db.conn())
}

#[tauri::command]
pub async fn create_sub_account(
    db: State<'_, Database>,
    input: sub_accounts::SubAccountInput,
) -> AppResult<sub_accounts::SubAccount> {
    sub_accounts::create(&db.conn(), &input)
}

#[tauri::command]
pub async fn update_sub_account(
    db: State<'_, Database>,
    id: i64,
    input: sub_accounts::SubAccountInput,
) -> AppResult<sub_accounts::SubAccount> {
    sub_accounts::update(&db.conn(), id, &input)
}

#[tauri::command]
pub async fn set_sub_account_active(
    db: State<'_, Database>,
    id: i64,
    active: bool,
) -> AppResult<sub_accounts::SubAccount> {
    sub_accounts::set_active(&db.conn(), id, active)
}

#[tauri::command]
pub async fn delete_sub_account(db: State<'_, Database>, id: i64) -> AppResult<()> {
    sub_accounts::delete(&db.conn(), id)
}

// 取引先

#[tauri::command]
pub async fn list_partners(db: State<'_, Database>) -> AppResult<Vec<partners::Partner>> {
    partners::list(&db.conn())
}

#[tauri::command]
pub async fn create_partner(
    db: State<'_, Database>,
    input: partners::PartnerInput,
) -> AppResult<partners::Partner> {
    partners::create(&db.conn(), &input)
}

#[tauri::command]
pub async fn update_partner(
    db: State<'_, Database>,
    id: i64,
    input: partners::PartnerInput,
) -> AppResult<partners::Partner> {
    partners::update(&db.conn(), id, &input)
}

#[tauri::command]
pub async fn set_partner_active(
    db: State<'_, Database>,
    id: i64,
    active: bool,
) -> AppResult<partners::Partner> {
    partners::set_active(&db.conn(), id, active)
}

#[tauri::command]
pub async fn delete_partner(db: State<'_, Database>, id: i64) -> AppResult<()> {
    partners::delete(&db.conn(), id)
}

// 家事按分ルール

#[tauri::command]
pub async fn list_allocation_rules(
    db: State<'_, Database>,
) -> AppResult<Vec<allocation_rules::AllocationRule>> {
    allocation_rules::list(&db.conn())
}

#[tauri::command]
pub async fn create_allocation_rule(
    db: State<'_, Database>,
    input: allocation_rules::AllocationRuleInput,
) -> AppResult<allocation_rules::AllocationRule> {
    allocation_rules::create(&db.conn(), &input)
}

#[tauri::command]
pub async fn update_allocation_rule(
    db: State<'_, Database>,
    id: i64,
    input: allocation_rules::AllocationRuleInput,
) -> AppResult<allocation_rules::AllocationRule> {
    allocation_rules::update(&db.conn(), id, &input)
}

#[tauri::command]
pub async fn set_allocation_rule_active(
    db: State<'_, Database>,
    id: i64,
    active: bool,
) -> AppResult<allocation_rules::AllocationRule> {
    allocation_rules::set_active(&db.conn(), id, active)
}

#[tauri::command]
pub async fn delete_allocation_rule(db: State<'_, Database>, id: i64) -> AppResult<()> {
    allocation_rules::delete(&db.conn(), id)
}

#[tauri::command]
pub async fn list_purposes(
    db: State<'_, Database>,
) -> AppResult<Vec<chobiyori_storage::purposes::Purpose>> {
    chobiyori_storage::purposes::list(&db.conn())
}
#[tauri::command]
pub async fn create_purpose(
    db: State<'_, Database>,
    input: chobiyori_storage::purposes::PurposeInput,
) -> AppResult<chobiyori_storage::purposes::Purpose> {
    chobiyori_storage::purposes::create(&db.conn(), &input)
}
#[tauri::command]
pub async fn update_purpose(
    db: State<'_, Database>,
    id: i64,
    input: chobiyori_storage::purposes::PurposeInput,
) -> AppResult<chobiyori_storage::purposes::Purpose> {
    chobiyori_storage::purposes::update(&db.conn(), id, &input)
}
#[tauri::command]
pub async fn set_purpose_active(
    db: State<'_, Database>,
    id: i64,
    active: bool,
) -> AppResult<chobiyori_storage::purposes::Purpose> {
    chobiyori_storage::purposes::set_active(&db.conn(), id, active)
}
#[tauri::command]
pub async fn delete_purpose(db: State<'_, Database>, id: i64) -> AppResult<()> {
    chobiyori_storage::purposes::delete(&db.conn(), id)
}
#[tauri::command]
pub async fn post_purpose(
    db: State<'_, Database>,
    fiscal_year: i64,
    id: i64,
    date: String,
    amount: i64,
) -> AppResult<chobiyori_storage::transactions::Transaction> {
    chobiyori_storage::purposes::post(&db, fiscal_year, id, &date, amount)
}
