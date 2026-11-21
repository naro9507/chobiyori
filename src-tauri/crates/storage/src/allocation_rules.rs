//! 家事按分ルール（自宅兼事務所の家賃・光熱費など）。

use super::flag;
use chobiyori_core::error::{AppError, AppResult, ErrorCode};
use chobiyori_core::master::{self, Rounding, NAME_MAX};
use rusqlite::{params, Connection, Row};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AllocationRule {
    pub id: i64,
    pub code: String,
    pub name_ja: String,
    pub name_en: String,
    pub business_percent: i64,
    pub rounding: Rounding,
    pub is_active: bool,
    pub in_use: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AllocationRuleInput {
    pub code: String,
    pub name_ja: String,
    #[serde(default)]
    pub name_en: String,
    pub business_percent: i64,
    pub rounding: Rounding,
}

struct Valid {
    code: String,
    name_ja: String,
    name_en: String,
    business_percent: i64,
}

fn validate(input: &AllocationRuleInput) -> AppResult<Valid> {
    Ok(Valid {
        code: master::code(&input.code)?,
        name_ja: master::required(&input.name_ja, NAME_MAX, "nameJa")?,
        name_en: master::optional(&input.name_en, NAME_MAX, "nameEn")?,
        business_percent: master::business_percent(input.business_percent)?,
    })
}

const SELECT: &str = "
    SELECT r.id, r.code, r.name_ja, r.name_en, r.business_percent, r.rounding, r.is_active,
           EXISTS (SELECT 1 FROM accounts WHERE default_allocation_rule_id = r.id)
           OR EXISTS (SELECT 1 FROM purposes WHERE allocation_rule_id = r.id)
    FROM allocation_rules r";

fn from_row(row: &Row<'_>) -> rusqlite::Result<AllocationRule> {
    Ok(AllocationRule {
        id: row.get(0)?,
        code: row.get(1)?,
        name_ja: row.get(2)?,
        name_en: row.get(3)?,
        business_percent: row.get(4)?,
        rounding: row.get(5)?,
        is_active: row.get(6)?,
        in_use: row.get(7)?,
    })
}

pub fn list(conn: &Connection) -> AppResult<Vec<AllocationRule>> {
    let mut stmt = conn.prepare(&format!("{SELECT} ORDER BY r.sort, r.code"))?;
    let rows = stmt.query_map([], from_row)?;
    Ok(rows.collect::<Result<_, _>>()?)
}

pub fn get(conn: &Connection, id: i64) -> AppResult<AllocationRule> {
    Ok(conn.query_row(&format!("{SELECT} WHERE r.id = ?1"), [id], from_row)?)
}

pub fn create(conn: &Connection, input: &AllocationRuleInput) -> AppResult<AllocationRule> {
    let v = validate(input)?;
    conn.execute(
        "INSERT INTO allocation_rules (code, name_ja, name_en, business_percent, rounding, sort)
         VALUES (?1, ?2, ?3, ?4, ?5, (SELECT coalesce(max(sort), 0) + 10 FROM allocation_rules))",
        params![
            v.code,
            v.name_ja,
            v.name_en,
            v.business_percent,
            input.rounding
        ],
    )?;
    get(conn, conn.last_insert_rowid())
}

/// 割合を変えても、すでに記帳した仕訳の金額は変わらない（按分は記帳のときに確定する）。
pub fn update(
    conn: &Connection,
    id: i64,
    input: &AllocationRuleInput,
) -> AppResult<AllocationRule> {
    let v = validate(input)?;
    let changed = conn.execute(
        "UPDATE allocation_rules SET code = ?2, name_ja = ?3, name_en = ?4, business_percent = ?5, rounding = ?6
         WHERE id = ?1",
        params![id, v.code, v.name_ja, v.name_en, v.business_percent, input.rounding],
    )?;
    if changed == 0 {
        return Err(AppError::new(ErrorCode::NotFound));
    }
    get(conn, id)
}

pub fn set_active(conn: &Connection, id: i64, active: bool) -> AppResult<AllocationRule> {
    let changed = conn.execute(
        "UPDATE allocation_rules SET is_active = ?2 WHERE id = ?1",
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
    conn.execute("DELETE FROM allocation_rules WHERE id = ?1", [id])?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::set_up_db;

    fn input(code: &str, percent: i64) -> AllocationRuleInput {
        AllocationRuleInput {
            code: code.into(),
            name_ja: "自宅兼事務所".into(),
            name_en: "Home office".into(),
            business_percent: percent,
            rounding: Rounding::Floor,
        }
    }

    #[test]
    fn create_update_and_delete() {
        let db = set_up_db();
        let conn = db.conn();
        let r = create(&conn, &input("1", 50)).unwrap();
        assert_eq!(r.business_percent, 50);
        let r = update(&conn, r.id, &input("1", 40)).unwrap();
        assert_eq!(r.business_percent, 40);
        assert_eq!(list(&conn).unwrap().len(), 1);
        delete(&conn, r.id).unwrap();
        assert!(list(&conn).unwrap().is_empty());
    }

    #[test]
    fn percent_out_of_range_is_rejected() {
        let db = set_up_db();
        let conn = db.conn();
        assert_eq!(
            create(&conn, &input("1", 120)).unwrap_err(),
            AppError::field(ErrorCode::OutOfRange, "businessPercent")
        );
    }

    #[test]
    fn rule_used_by_an_account_cannot_be_deleted() {
        let db = set_up_db();
        let conn = db.conn();
        let r = create(&conn, &input("1", 50)).unwrap();
        conn.execute(
            "UPDATE accounts SET default_allocation_rule_id = ?1 WHERE code = '603'",
            [r.id],
        )
        .unwrap();
        assert!(get(&conn, r.id).unwrap().in_use);
        assert_eq!(delete(&conn, r.id).unwrap_err().code, ErrorCode::InUse);
    }
}
