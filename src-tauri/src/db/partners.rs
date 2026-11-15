//! 取引先マスタ。顧客・仕入先・支払先・金融機関を 1 つにまとめる。

use super::flag;
use crate::domain::master::{self, MEMO_MAX, NAME_MAX};
use crate::error::{AppError, AppResult, ErrorCode};
use rusqlite::{params, Connection, Row};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Partner {
    pub id: i64,
    pub code: String,
    pub name_ja: String,
    pub name_en: String,
    pub kana: String,
    pub is_customer: bool,
    pub is_vendor: bool,
    pub invoice_registration_no: Option<String>,
    pub memo: String,
    pub is_active: bool,
    pub in_use: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PartnerInput {
    pub code: String,
    pub name_ja: String,
    #[serde(default)]
    pub name_en: String,
    #[serde(default)]
    pub kana: String,
    #[serde(default)]
    pub is_customer: bool,
    #[serde(default)]
    pub is_vendor: bool,
    #[serde(default)]
    pub invoice_registration_no: Option<String>,
    #[serde(default)]
    pub memo: String,
}

struct Valid {
    code: String,
    name_ja: String,
    name_en: String,
    kana: String,
    invoice_registration_no: Option<String>,
    memo: String,
}

fn validate(input: &PartnerInput) -> AppResult<Valid> {
    Ok(Valid {
        code: master::code(&input.code)?,
        name_ja: master::required(&input.name_ja, NAME_MAX, "nameJa")?,
        name_en: master::optional(&input.name_en, NAME_MAX, "nameEn")?,
        kana: master::optional(&input.kana, NAME_MAX, "kana")?,
        invoice_registration_no: master::invoice_registration_no(
            input.invoice_registration_no.as_deref(),
        )?,
        memo: master::optional(&input.memo, MEMO_MAX, "memo")?,
    })
}

const SELECT: &str = "
    SELECT p.id, p.code, p.name_ja, p.name_en, p.kana, p.is_customer, p.is_vendor,
           p.invoice_registration_no, p.memo, p.is_active,
           EXISTS (SELECT 1 FROM journal_lines WHERE partner_id = p.id)
           OR EXISTS (SELECT 1 FROM purposes WHERE default_partner_id = p.id)
    FROM partners p";

fn from_row(row: &Row<'_>) -> rusqlite::Result<Partner> {
    Ok(Partner {
        id: row.get(0)?,
        code: row.get(1)?,
        name_ja: row.get(2)?,
        name_en: row.get(3)?,
        kana: row.get(4)?,
        is_customer: row.get(5)?,
        is_vendor: row.get(6)?,
        invoice_registration_no: row.get(7)?,
        memo: row.get(8)?,
        is_active: row.get(9)?,
        in_use: row.get(10)?,
    })
}

pub fn list(conn: &Connection) -> AppResult<Vec<Partner>> {
    let mut stmt = conn.prepare(&format!("{SELECT} ORDER BY p.sort, p.code"))?;
    let rows = stmt.query_map([], from_row)?;
    Ok(rows.collect::<Result<_, _>>()?)
}

pub fn get(conn: &Connection, id: i64) -> AppResult<Partner> {
    Ok(conn.query_row(&format!("{SELECT} WHERE p.id = ?1"), [id], from_row)?)
}

pub fn create(conn: &Connection, input: &PartnerInput) -> AppResult<Partner> {
    let v = validate(input)?;
    conn.execute(
        "INSERT INTO partners (code, name_ja, name_en, kana, is_customer, is_vendor, invoice_registration_no, memo, sort)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, (SELECT coalesce(max(sort), 0) + 10 FROM partners))",
        params![
            v.code,
            v.name_ja,
            v.name_en,
            v.kana,
            flag(input.is_customer),
            flag(input.is_vendor),
            v.invoice_registration_no,
            v.memo
        ],
    )?;
    get(conn, conn.last_insert_rowid())
}

pub fn update(conn: &Connection, id: i64, input: &PartnerInput) -> AppResult<Partner> {
    let v = validate(input)?;
    let changed = conn.execute(
        "UPDATE partners SET code = ?2, name_ja = ?3, name_en = ?4, kana = ?5, is_customer = ?6,
                is_vendor = ?7, invoice_registration_no = ?8, memo = ?9
         WHERE id = ?1",
        params![
            id,
            v.code,
            v.name_ja,
            v.name_en,
            v.kana,
            flag(input.is_customer),
            flag(input.is_vendor),
            v.invoice_registration_no,
            v.memo
        ],
    )?;
    if changed == 0 {
        return Err(AppError::new(ErrorCode::NotFound));
    }
    get(conn, id)
}

pub fn set_active(conn: &Connection, id: i64, active: bool) -> AppResult<Partner> {
    let changed = conn.execute(
        "UPDATE partners SET is_active = ?2 WHERE id = ?1",
        params![id, flag(active)],
    )?;
    if changed == 0 {
        return Err(AppError::new(ErrorCode::NotFound));
    }
    get(conn, id)
}

pub fn delete(conn: &Connection, id: i64) -> AppResult<()> {
    if get(conn, id)?.in_use {
        return Err(AppError::new(ErrorCode::InUse));
    }
    conn.execute("DELETE FROM partners WHERE id = ?1", [id])?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::setup::tests::set_up_db;

    fn input(code: &str, name: &str) -> PartnerInput {
        PartnerInput {
            code: code.into(),
            name_ja: name.into(),
            name_en: "".into(),
            kana: "".into(),
            is_customer: true,
            is_vendor: false,
            invoice_registration_no: None,
            memo: "".into(),
        }
    }

    #[test]
    fn create_update_and_list() {
        let db = set_up_db();
        let conn = db.conn();
        let p = create(&conn, &input("501", "文具店")).unwrap();
        assert!(p.is_customer && !p.is_vendor && p.is_active && !p.in_use);

        let mut changed = input("501", "文具店");
        changed.is_customer = false;
        changed.is_vendor = true;
        changed.invoice_registration_no = Some("1234567890123".into());
        let p = update(&conn, p.id, &changed).unwrap();
        assert!(p.is_vendor && !p.is_customer);
        assert_eq!(p.invoice_registration_no.as_deref(), Some("T1234567890123"));
        assert_eq!(list(&conn).unwrap(), vec![p]);
    }

    #[test]
    fn rejects_bad_input() {
        let db = set_up_db();
        let conn = db.conn();
        create(&conn, &input("1", "A")).unwrap();
        assert_eq!(
            create(&conn, &input("1", "B")).unwrap_err().code,
            ErrorCode::DuplicateCode
        );
        assert_eq!(
            create(&conn, &input("2", "")).unwrap_err(),
            AppError::field(ErrorCode::Required, "nameJa")
        );
        let mut bad = input("3", "C");
        bad.invoice_registration_no = Some("T12".into());
        assert_eq!(
            create(&conn, &bad).unwrap_err(),
            AppError::field(ErrorCode::InvalidFormat, "invoiceRegistrationNo")
        );
    }

    #[test]
    fn used_partner_cannot_be_deleted() {
        let db = set_up_db();
        let conn = db.conn();
        let p = create(&conn, &input("1", "A")).unwrap();
        let cash: i64 = conn
            .query_row("SELECT id FROM accounts WHERE code = '101'", [], |r| {
                r.get(0)
            })
            .unwrap();
        conn.execute(
            "INSERT INTO transactions (id, fiscal_year, date) VALUES (1, 2026, '2026-01-05')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO journal_lines (transaction_id, line_no, side, account_id, amount, partner_id)
             VALUES (1, 1, 'debit', ?1, 1000, ?2)",
            [cash, p.id],
        )
        .unwrap();
        assert_eq!(delete(&conn, p.id).unwrap_err().code, ErrorCode::InUse);
        assert!(!set_active(&conn, p.id, false).unwrap().is_active);
    }

    #[test]
    fn unused_partner_can_be_deleted() {
        let db = set_up_db();
        let conn = db.conn();
        let p = create(&conn, &input("1", "A")).unwrap();
        delete(&conn, p.id).unwrap();
        assert_eq!(delete(&conn, p.id).unwrap_err().code, ErrorCode::NotFound);
    }
}
