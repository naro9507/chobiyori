//! 受け取った請求書の支払期限と確認状況を記録する。

use chobiyori_core::error::{AppError, AppResult, ErrorCode};
use chobiyori_core::{journal, master};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReceivedBill {
    id: i64,
    payee: String,
    due_date: String,
    amount: Option<i64>,
    paid: bool,
    transaction_id: Option<i64>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReceivedBillInput {
    id: Option<i64>,
    payee: String,
    due_date: String,
    amount: Option<i64>,
}

pub fn list(conn: &Connection) -> AppResult<Vec<ReceivedBill>> {
    let mut stmt = conn.prepare(
        "SELECT id, payee, due_date, amount, paid, transaction_id FROM received_bills ORDER BY paid, due_date, id",
    )?;
    let bills = stmt.query_map([], |row| {
        Ok(ReceivedBill {
            id: row.get(0)?,
            payee: row.get(1)?,
            due_date: row.get(2)?,
            amount: row.get(3)?,
            paid: row.get(4)?,
            transaction_id: row.get(5)?,
        })
    })?;
    Ok(bills.collect::<Result<_, _>>()?)
}

pub fn upcoming(conn: &Connection, today: &str) -> AppResult<Vec<(i64, String)>> {
    let mut stmt = conn.prepare(
        "SELECT id, due_date FROM received_bills WHERE paid = 0 AND due_date >= ?1 ORDER BY id",
    )?;
    let dates = stmt.query_map([today], |row| Ok((row.get(0)?, row.get(1)?)))?;
    Ok(dates.collect::<Result<_, _>>()?)
}

pub fn save(conn: &Connection, input: &ReceivedBillInput) -> AppResult<()> {
    let payee = master::required(&input.payee, master::NAME_MAX, "payee")?;
    let due_date = input.due_date.trim();
    if due_date.is_empty() {
        return Err(AppError::field(ErrorCode::Required, "dueDate"));
    }
    if !journal::parse_date(due_date).is_some_and(|(year, _, _)| year > 0) {
        return Err(AppError::field(ErrorCode::InvalidFormat, "dueDate"));
    }
    if input
        .amount
        .is_some_and(|amount| !(1..=journal::AMOUNT_MAX).contains(&amount))
    {
        return Err(AppError::field(ErrorCode::OutOfRange, "amount"));
    }
    let changed = match input.id {
        Some(id) => conn.execute(
            "UPDATE received_bills SET payee = ?1, due_date = ?2, amount = ?3 WHERE id = ?4",
            params![payee, due_date, input.amount, id],
        )?,
        None => conn.execute(
            "INSERT INTO received_bills (payee, due_date, amount) VALUES (?1, ?2, ?3)",
            params![payee, due_date, input.amount],
        )?,
    };
    found(changed)
}

pub fn link_payment(conn: &Connection, id: i64, transaction_id: i64) -> AppResult<()> {
    let changed = conn.execute(
        "UPDATE received_bills SET transaction_id = ?2
         WHERE id = ?1 AND paid = 1 AND transaction_id IS NULL
           AND EXISTS (SELECT 1 FROM transactions WHERE id = ?2)",
        params![id, transaction_id],
    )?;
    if changed == 0 {
        return Err(AppError::new(ErrorCode::InvalidFormat));
    }
    Ok(())
}

pub fn set_paid(conn: &Connection, id: i64, paid: bool) -> AppResult<()> {
    found(conn.execute(
        "UPDATE received_bills SET paid = ?2 WHERE id = ?1",
        params![id, paid],
    )?)
}

pub fn delete(conn: &Connection, id: i64) -> AppResult<()> {
    found(conn.execute("DELETE FROM received_bills WHERE id = ?1", [id])?)
}

fn found(changed: usize) -> AppResult<()> {
    if changed == 0 {
        return Err(AppError::new(ErrorCode::NotFound));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_future_unpaid_bills_appear_and_edits_preserve_paid_state() {
        let db = crate::Database::open_in_memory().unwrap();
        let conn = db.conn();
        let mut bill = ReceivedBillInput {
            id: None,
            payee: "取引先".into(),
            due_date: "2028-02-29".into(),
            amount: Some(1500),
        };
        save(&conn, &bill).unwrap();
        let id = list(&conn).unwrap()[0].id;
        assert_eq!(
            upcoming(&conn, &bill.due_date).unwrap(),
            [(id, bill.due_date.clone())]
        );
        assert!(upcoming(&conn, "2028-03-01").unwrap().is_empty());
        set_paid(&conn, id, true).unwrap();
        bill.id = Some(id);
        bill.due_date = "2028-03-02".into();
        save(&conn, &bill).unwrap();
        assert!(upcoming(&conn, "2028-03-01").unwrap().is_empty());
        set_paid(&conn, id, false).unwrap();
        assert_eq!(
            upcoming(&conn, "2028-03-01").unwrap(),
            [(id, bill.due_date.clone())]
        );
        delete(&conn, id).unwrap();
        assert!(list(&conn).unwrap().is_empty());
    }
}
