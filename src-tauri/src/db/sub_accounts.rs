//! 補助科目（普通預金 → 口座別、借入金 → 借入先別 など）。

use super::flag;
use crate::domain::master::{self, NAME_MAX};
use crate::error::{AppError, AppResult, ErrorCode};
use rusqlite::{params, Connection, Row};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SubAccount {
    pub id: i64,
    pub account_id: i64,
    pub code: String,
    pub name_ja: String,
    pub name_en: String,
    pub kana: String,
    pub is_active: bool,
    pub in_use: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubAccountInput {
    pub account_id: i64,
    pub code: String,
    pub name_ja: String,
    #[serde(default)]
    pub name_en: String,
    #[serde(default)]
    pub kana: String,
}

const SELECT: &str = "
    SELECT s.id, s.account_id, s.code, s.name_ja, s.name_en, s.kana, s.is_active,
           EXISTS (SELECT 1 FROM journal_lines WHERE sub_account_id = s.id)
    FROM sub_accounts s";

fn from_row(row: &Row<'_>) -> rusqlite::Result<SubAccount> {
    Ok(SubAccount {
        id: row.get(0)?,
        account_id: row.get(1)?,
        code: row.get(2)?,
        name_ja: row.get(3)?,
        name_en: row.get(4)?,
        kana: row.get(5)?,
        is_active: row.get(6)?,
        in_use: row.get(7)?,
    })
}

/// すべての補助科目。科目ごと・並び順に並べる。
pub fn list(conn: &Connection) -> AppResult<Vec<SubAccount>> {
    let mut stmt = conn.prepare(&format!("{SELECT} ORDER BY s.account_id, s.sort, s.code"))?;
    let rows = stmt.query_map([], from_row)?;
    Ok(rows.collect::<Result<_, _>>()?)
}

pub fn get(conn: &Connection, id: i64) -> AppResult<SubAccount> {
    Ok(conn.query_row(&format!("{SELECT} WHERE s.id = ?1"), [id], from_row)?)
}

fn ensure_account_exists(conn: &Connection, account_id: i64) -> AppResult<()> {
    let exists: bool = conn.query_row(
        "SELECT EXISTS (SELECT 1 FROM accounts WHERE id = ?1)",
        [account_id],
        |row| row.get(0),
    )?;
    if exists {
        Ok(())
    } else {
        Err(AppError::field(ErrorCode::NotFound, "accountId"))
    }
}

pub fn create(conn: &Connection, input: &SubAccountInput) -> AppResult<SubAccount> {
    let code = master::code(&input.code)?;
    let name_ja = master::required(&input.name_ja, NAME_MAX, "nameJa")?;
    let name_en = master::optional(&input.name_en, NAME_MAX, "nameEn")?;
    let kana = master::optional(&input.kana, NAME_MAX, "kana")?;
    ensure_account_exists(conn, input.account_id)?;
    conn.execute(
        "INSERT INTO sub_accounts (account_id, code, name_ja, name_en, kana, sort)
         VALUES (?1, ?2, ?3, ?4, ?5, (SELECT coalesce(max(sort), 0) + 10 FROM sub_accounts WHERE account_id = ?1))",
        params![input.account_id, code, name_ja, name_en, kana],
    )?;
    get(conn, conn.last_insert_rowid())
}

/// 名前とコードを変える。親の科目は変えられない（過去の仕訳の意味が変わるため）。
pub fn update(conn: &Connection, id: i64, input: &SubAccountInput) -> AppResult<SubAccount> {
    let current = get(conn, id)?;
    if current.account_id != input.account_id {
        return Err(AppError::field(ErrorCode::InvalidFormat, "accountId"));
    }
    let code = master::code(&input.code)?;
    let name_ja = master::required(&input.name_ja, NAME_MAX, "nameJa")?;
    let name_en = master::optional(&input.name_en, NAME_MAX, "nameEn")?;
    let kana = master::optional(&input.kana, NAME_MAX, "kana")?;
    conn.execute(
        "UPDATE sub_accounts SET code = ?2, name_ja = ?3, name_en = ?4, kana = ?5 WHERE id = ?1",
        params![id, code, name_ja, name_en, kana],
    )?;
    get(conn, id)
}

pub fn set_active(conn: &Connection, id: i64, active: bool) -> AppResult<SubAccount> {
    let changed = conn.execute(
        "UPDATE sub_accounts SET is_active = ?2 WHERE id = ?1",
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
    conn.execute("DELETE FROM sub_accounts WHERE id = ?1", [id])?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::setup::tests::set_up_db;

    fn deposits_id(conn: &Connection) -> i64 {
        conn.query_row("SELECT id FROM accounts WHERE code = '104'", [], |r| {
            r.get(0)
        })
        .unwrap()
    }

    fn input(account_id: i64, code: &str, name: &str) -> SubAccountInput {
        SubAccountInput {
            account_id,
            code: code.into(),
            name_ja: name.into(),
            name_en: "".into(),
            kana: "".into(),
        }
    }

    #[test]
    fn codes_are_unique_per_account_only() {
        let db = set_up_db();
        let conn = db.conn();
        let deposits = deposits_id(&conn);
        create(&conn, &input(deposits, "1", "A銀行")).unwrap();
        assert_eq!(
            create(&conn, &input(deposits, "1", "B銀行"))
                .unwrap_err()
                .code,
            ErrorCode::DuplicateCode
        );
        let loans: i64 = conn
            .query_row("SELECT id FROM accounts WHERE code = '203'", [], |r| {
                r.get(0)
            })
            .unwrap();
        create(&conn, &input(loans, "1", "A銀行")).unwrap();
        assert_eq!(list(&conn).unwrap().len(), 2);
    }

    #[test]
    fn parent_account_must_exist_and_cannot_change() {
        let db = set_up_db();
        let conn = db.conn();
        assert_eq!(
            create(&conn, &input(999, "1", "A")).unwrap_err(),
            AppError::field(ErrorCode::NotFound, "accountId")
        );
        let deposits = deposits_id(&conn);
        let s = create(&conn, &input(deposits, "1", "A銀行")).unwrap();
        assert!(update(&conn, s.id, &input(deposits + 1, "1", "A銀行")).is_err());
        assert_eq!(
            update(&conn, s.id, &input(deposits, "2", "A信金"))
                .unwrap()
                .name_ja,
            "A信金"
        );
    }

    #[test]
    fn deactivate_and_delete() {
        let db = set_up_db();
        let conn = db.conn();
        let s = create(&conn, &input(deposits_id(&conn), "1", "A銀行")).unwrap();
        assert!(!set_active(&conn, s.id, false).unwrap().is_active);
        delete(&conn, s.id).unwrap();
        assert!(list(&conn).unwrap().is_empty());
    }
}
