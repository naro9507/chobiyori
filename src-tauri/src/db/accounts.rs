//! 勘定科目マスタ。

use super::flag;
use crate::domain::master::{self, AccountCategory, TaxCategory, NAME_MAX};
use crate::error::{AppError, AppResult, ErrorCode};
use rusqlite::{params, Connection, Row};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Account {
    pub id: i64,
    pub code: String,
    pub name_ja: String,
    pub name_en: String,
    pub kana: String,
    pub category: AccountCategory,
    pub statement_line: Option<String>,
    pub default_tax_category: Option<TaxCategory>,
    pub default_allocation_rule_id: Option<i64>,
    pub is_system: bool,
    pub is_active: bool,
    /// 仕訳・補助科目・摘要のどれかで使われている（削除できない）
    pub in_use: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountInput {
    pub code: String,
    pub name_ja: String,
    #[serde(default)]
    pub name_en: String,
    #[serde(default)]
    pub kana: String,
    pub category: AccountCategory,
    #[serde(default)]
    pub default_tax_category: Option<TaxCategory>,
    #[serde(default)]
    pub default_allocation_rule_id: Option<i64>,
}

struct Valid {
    code: String,
    name_ja: String,
    name_en: String,
    kana: String,
}

fn validate(input: &AccountInput) -> AppResult<Valid> {
    Ok(Valid {
        code: master::code(&input.code)?,
        name_ja: master::required(&input.name_ja, NAME_MAX, "nameJa")?,
        name_en: master::optional(&input.name_en, NAME_MAX, "nameEn")?,
        kana: master::optional(&input.kana, NAME_MAX, "kana")?,
    })
}

const SELECT: &str = "
    SELECT a.id, a.code, a.name_ja, a.name_en, a.kana, a.category, a.statement_line,
           a.default_tax_category, a.default_allocation_rule_id, a.is_system, a.is_active,
           EXISTS (SELECT 1 FROM journal_lines WHERE account_id = a.id)
           OR EXISTS (SELECT 1 FROM sub_accounts WHERE account_id = a.id)
           OR EXISTS (SELECT 1 FROM purposes WHERE default_debit_account_id = a.id OR default_credit_account_id = a.id)
    FROM accounts a";

/// 区分の順（資産 → 負債 → 資本 → 収益 → 売上原価 → 経費）、その中は並び順。
const ORDER: &str = "
    ORDER BY CASE a.category
        WHEN 'asset' THEN 1 WHEN 'liability' THEN 2 WHEN 'equity' THEN 3
        WHEN 'revenue' THEN 4 WHEN 'cogs' THEN 5 ELSE 6 END,
        a.sort, a.code";

fn from_row(row: &Row<'_>) -> rusqlite::Result<Account> {
    Ok(Account {
        id: row.get(0)?,
        code: row.get(1)?,
        name_ja: row.get(2)?,
        name_en: row.get(3)?,
        kana: row.get(4)?,
        category: row.get(5)?,
        statement_line: row.get(6)?,
        default_tax_category: row.get(7)?,
        default_allocation_rule_id: row.get(8)?,
        is_system: row.get(9)?,
        is_active: row.get(10)?,
        in_use: row.get(11)?,
    })
}

pub fn list(conn: &Connection) -> AppResult<Vec<Account>> {
    let mut stmt = conn.prepare(&format!("{SELECT} {ORDER}"))?;
    let rows = stmt.query_map([], from_row)?;
    Ok(rows.collect::<Result<_, _>>()?)
}

pub fn get(conn: &Connection, id: i64) -> AppResult<Account> {
    Ok(conn.query_row(&format!("{SELECT} WHERE a.id = ?1"), [id], from_row)?)
}

fn ensure_rule_exists(conn: &Connection, rule_id: Option<i64>) -> AppResult<()> {
    if let Some(id) = rule_id {
        let exists: bool = conn.query_row(
            "SELECT EXISTS (SELECT 1 FROM allocation_rules WHERE id = ?1)",
            [id],
            |row| row.get(0),
        )?;
        if !exists {
            return Err(AppError::field(
                ErrorCode::NotFound,
                "defaultAllocationRuleId",
            ));
        }
    }
    Ok(())
}

pub fn create(conn: &Connection, input: &AccountInput) -> AppResult<Account> {
    let v = validate(input)?;
    ensure_rule_exists(conn, input.default_allocation_rule_id)?;
    conn.execute(
        "INSERT INTO accounts (code, name_ja, name_en, kana, category, default_tax_category, default_allocation_rule_id, sort)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, (SELECT coalesce(max(sort), 0) + 10 FROM accounts WHERE category = ?5))",
        params![
            v.code,
            v.name_ja,
            v.name_en,
            v.kana,
            input.category,
            input.default_tax_category,
            input.default_allocation_rule_id
        ],
    )?;
    get(conn, conn.last_insert_rowid())
}

pub fn update(conn: &Connection, id: i64, input: &AccountInput) -> AppResult<Account> {
    let v = validate(input)?;
    let current = get(conn, id)?;
    if current.category != input.category {
        // 区分を変えると、過去の集計や決算書の行が変わってしまう
        if current.is_system {
            return Err(AppError::field(ErrorCode::SystemAccount, "category"));
        }
        if current.in_use {
            return Err(AppError::field(ErrorCode::InUse, "category"));
        }
    }
    ensure_rule_exists(conn, input.default_allocation_rule_id)?;
    conn.execute(
        "UPDATE accounts SET code = ?2, name_ja = ?3, name_en = ?4, kana = ?5, category = ?6,
                default_tax_category = ?7, default_allocation_rule_id = ?8
         WHERE id = ?1",
        params![
            id,
            v.code,
            v.name_ja,
            v.name_en,
            v.kana,
            input.category,
            input.default_tax_category,
            input.default_allocation_rule_id
        ],
    )?;
    get(conn, id)
}

/// 有効・無効を切り替える。無効にした科目は入力の候補に出さない。
pub fn set_active(conn: &Connection, id: i64, active: bool) -> AppResult<Account> {
    let changed = conn.execute(
        "UPDATE accounts SET is_active = ?2 WHERE id = ?1",
        params![id, flag(active)],
    )?;
    if changed == 0 {
        return Err(AppError::new(ErrorCode::NotFound));
    }
    get(conn, id)
}

/// 使われていない、自分で足した科目だけを削除できる。
pub fn delete(conn: &Connection, id: i64) -> AppResult<()> {
    let current = get(conn, id)?;
    if current.is_system {
        return Err(AppError::new(ErrorCode::SystemAccount));
    }
    if current.in_use {
        return Err(AppError::new(ErrorCode::InUse));
    }
    conn.execute("DELETE FROM accounts WHERE id = ?1", [id])?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::setup::tests::set_up_db;
    use crate::domain::standard_accounts::GENERAL;

    fn input(code: &str, name: &str) -> AccountInput {
        AccountInput {
            code: code.into(),
            name_ja: name.into(),
            name_en: "".into(),
            kana: "".into(),
            category: AccountCategory::Expense,
            default_tax_category: Some(TaxCategory::TaxablePurchase10),
            default_allocation_rule_id: None,
        }
    }

    fn find(conn: &Connection, code: &str) -> Account {
        list(conn)
            .unwrap()
            .into_iter()
            .find(|a| a.code == code)
            .unwrap()
    }

    #[test]
    fn lists_standard_accounts_in_category_order() {
        let db = set_up_db();
        let accounts = list(&db.conn()).unwrap();
        assert_eq!(accounts.len(), GENERAL.len());
        assert_eq!(accounts[0].name_ja, "現金");
        assert!(accounts
            .iter()
            .all(|a| a.is_system && a.is_active && !a.in_use));
        let ranks: Vec<_> = accounts.iter().map(|a| a.category as u8).collect();
        assert!(ranks.windows(2).all(|w| w[0] <= w[1]));
    }

    #[test]
    fn creates_an_account_after_others_of_the_same_category() {
        let db = set_up_db();
        let conn = db.conn();
        let created = create(&conn, &input("620", " 新聞図書費 ")).unwrap();
        assert_eq!(created.name_ja, "新聞図書費");
        assert!(!created.is_system);
        assert_eq!(created.statement_line, None);
        let accounts = list(&conn).unwrap();
        assert_eq!(accounts.last().unwrap().code, "620");
    }

    #[test]
    fn rejects_duplicate_codes() {
        let db = set_up_db();
        let conn = db.conn();
        assert_eq!(
            create(&conn, &input("101", "重複")).unwrap_err(),
            AppError::field(ErrorCode::DuplicateCode, "code")
        );
    }

    #[test]
    fn system_account_can_be_renamed_but_not_recategorized_or_deleted() {
        let db = set_up_db();
        let conn = db.conn();
        let cash = find(&conn, "101");

        let mut rename = input("101", "手元現金");
        rename.category = AccountCategory::Asset;
        assert_eq!(update(&conn, cash.id, &rename).unwrap().name_ja, "手元現金");

        assert_eq!(
            update(&conn, cash.id, &input("101", "現金")).unwrap_err(),
            AppError::field(ErrorCode::SystemAccount, "category")
        );
        assert_eq!(
            delete(&conn, cash.id).unwrap_err().code,
            ErrorCode::SystemAccount
        );
    }

    #[test]
    fn used_account_cannot_be_deleted_but_can_be_deactivated() {
        let db = set_up_db();
        let conn = db.conn();
        let books = create(&conn, &input("620", "新聞図書費")).unwrap();
        conn.execute(
            "INSERT INTO sub_accounts (account_id, code, name_ja) VALUES (?1, '1', '雑誌')",
            [books.id],
        )
        .unwrap();

        assert!(get(&conn, books.id).unwrap().in_use);
        assert_eq!(delete(&conn, books.id).unwrap_err().code, ErrorCode::InUse);
        let mut moved = input("620", "新聞図書費");
        moved.category = AccountCategory::Asset;
        assert_eq!(
            update(&conn, books.id, &moved).unwrap_err(),
            AppError::field(ErrorCode::InUse, "category")
        );

        assert!(!set_active(&conn, books.id, false).unwrap().is_active);
        assert!(set_active(&conn, books.id, true).unwrap().is_active);
    }

    #[test]
    fn unused_custom_account_can_be_deleted() {
        let db = set_up_db();
        let conn = db.conn();
        let a = create(&conn, &input("620", "新聞図書費")).unwrap();
        delete(&conn, a.id).unwrap();
        assert_eq!(get(&conn, a.id).unwrap_err().code, ErrorCode::NotFound);
    }

    #[test]
    fn unknown_allocation_rule_is_rejected() {
        let db = set_up_db();
        let conn = db.conn();
        let mut bad = input("620", "新聞図書費");
        bad.default_allocation_rule_id = Some(999);
        assert_eq!(
            create(&conn, &bad).unwrap_err(),
            AppError::field(ErrorCode::NotFound, "defaultAllocationRuleId")
        );
    }

    #[test]
    fn missing_account_is_not_found() {
        let db = set_up_db();
        let conn = db.conn();
        assert_eq!(
            set_active(&conn, 999, false).unwrap_err().code,
            ErrorCode::NotFound
        );
        assert_eq!(
            update(&conn, 999, &input("1", "a")).unwrap_err().code,
            ErrorCode::NotFound
        );
    }
}
