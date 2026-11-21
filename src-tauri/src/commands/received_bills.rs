use crate::db::{received_bills, Database};
use crate::error::AppResult;
use received_bills::{ReceivedBill, ReceivedBillInput};
use tauri::State;

#[tauri::command]
pub fn list_received_bills(db: State<'_, Database>) -> AppResult<Vec<ReceivedBill>> {
    received_bills::list(&db.conn())
}

#[tauri::command]
pub fn save_received_bill(db: State<'_, Database>, input: ReceivedBillInput) -> AppResult<()> {
    received_bills::save(&db.conn(), &input)
}

#[tauri::command]
pub fn set_received_bill_paid(db: State<'_, Database>, id: i64, paid: bool) -> AppResult<()> {
    received_bills::set_paid(&db.conn(), id, paid)
}

#[tauri::command]
pub fn delete_received_bill(db: State<'_, Database>, id: i64) -> AppResult<()> {
    received_bills::delete(&db.conn(), id)
}
