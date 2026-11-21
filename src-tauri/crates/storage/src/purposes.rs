//! よく使う摘要と、そこから作る仕訳。
use super::{flag, transactions, Database};
use chobiyori_core::error::{AppError, AppResult, ErrorCode};
use chobiyori_core::{
    allocation,
    journal::{EntryMode, LineInput, Side, TransactionInput, TransactionKind, AMOUNT_MAX},
    master::{self, TaxCategory, NAME_MAX},
};
use rusqlite::{params, Connection, Row};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Purpose {
    pub id: i64,
    pub code: String,
    pub name_ja: String,
    pub name_en: String,
    pub kana: String,
    pub default_debit_account_id: Option<i64>,
    pub default_credit_account_id: Option<i64>,
    pub default_tax_category: Option<TaxCategory>,
    pub allocation_rule_id: Option<i64>,
    pub default_partner_id: Option<i64>,
    pub is_active: bool,
    pub in_use: bool,
}
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PurposeInput {
    pub code: String,
    pub name_ja: String,
    #[serde(default)]
    pub name_en: String,
    #[serde(default)]
    pub kana: String,
    pub default_debit_account_id: Option<i64>,
    pub default_credit_account_id: Option<i64>,
    pub default_tax_category: Option<TaxCategory>,
    pub allocation_rule_id: Option<i64>,
    pub default_partner_id: Option<i64>,
}
const SELECT: &str = "SELECT p.id, p.code, p.name_ja, p.name_en, p.kana, p.default_debit_account_id, p.default_credit_account_id, p.default_tax_category, p.allocation_rule_id, p.default_partner_id, p.is_active, EXISTS (SELECT 1 FROM journal_lines WHERE purpose_id = p.id) FROM purposes p";
fn from_row(r: &Row<'_>) -> rusqlite::Result<Purpose> {
    Ok(Purpose {
        id: r.get(0)?,
        code: r.get(1)?,
        name_ja: r.get(2)?,
        name_en: r.get(3)?,
        kana: r.get(4)?,
        default_debit_account_id: r.get(5)?,
        default_credit_account_id: r.get(6)?,
        default_tax_category: r.get(7)?,
        allocation_rule_id: r.get(8)?,
        default_partner_id: r.get(9)?,
        is_active: r.get(10)?,
        in_use: r.get(11)?,
    })
}
pub fn list(conn: &Connection) -> AppResult<Vec<Purpose>> {
    Ok(conn
        .prepare(&format!("{SELECT} ORDER BY p.sort, p.code"))?
        .query_map([], from_row)?
        .collect::<Result<_, _>>()?)
}
pub fn get(conn: &Connection, id: i64) -> AppResult<Purpose> {
    Ok(conn.query_row(&format!("{SELECT} WHERE p.id = ?1"), [id], from_row)?)
}
fn validate(
    conn: &Connection,
    input: &PurposeInput,
) -> AppResult<(String, String, String, String)> {
    if input.default_debit_account_id.is_some()
        && input.default_debit_account_id == input.default_credit_account_id
    {
        return Err(AppError::field(
            ErrorCode::InvalidFormat,
            "defaultCreditAccountId",
        ));
    }
    for (table, id, field) in [
        (
            "accounts",
            input.default_debit_account_id,
            "defaultDebitAccountId",
        ),
        (
            "accounts",
            input.default_credit_account_id,
            "defaultCreditAccountId",
        ),
        (
            "allocation_rules",
            input.allocation_rule_id,
            "allocationRuleId",
        ),
        ("partners", input.default_partner_id, "defaultPartnerId"),
    ] {
        if let Some(id) = id {
            let exists: bool = conn.query_row(
                &format!("SELECT EXISTS (SELECT 1 FROM {table} WHERE id = ?1 AND is_active = 1)"),
                [id],
                |r| r.get(0),
            )?;
            if !exists {
                return Err(AppError::field(ErrorCode::NotFound, field));
            }
        }
    }
    if input.allocation_rule_id.is_some() {
        let debit = input.default_debit_account_id.ok_or(AppError::field(
            ErrorCode::Required,
            "defaultDebitAccountId",
        ))?;
        if super::accounts::get(conn, debit)?.category != master::AccountCategory::Expense {
            return Err(AppError::field(
                ErrorCode::InvalidFormat,
                "defaultDebitAccountId",
            ));
        }
    }
    Ok((
        master::code(&input.code)?,
        master::required(&input.name_ja, NAME_MAX, "nameJa")?,
        master::optional(&input.name_en, NAME_MAX, "nameEn")?,
        master::optional(&input.kana, NAME_MAX, "kana")?,
    ))
}
pub fn create(conn: &Connection, input: &PurposeInput) -> AppResult<Purpose> {
    let (code, ja, en, kana) = validate(conn, input)?;
    conn.execute("INSERT INTO purposes (code,name_ja,name_en,kana,default_debit_account_id,default_credit_account_id,default_tax_category,allocation_rule_id,default_partner_id,sort) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,(SELECT coalesce(max(sort),0)+10 FROM purposes))", params![code,ja,en,kana,input.default_debit_account_id,input.default_credit_account_id,input.default_tax_category,input.allocation_rule_id,input.default_partner_id])?;
    get(conn, conn.last_insert_rowid())
}
pub fn update(conn: &Connection, id: i64, input: &PurposeInput) -> AppResult<Purpose> {
    get(conn, id)?;
    let (code, ja, en, kana) = validate(conn, input)?;
    conn.execute("UPDATE purposes SET code=?2,name_ja=?3,name_en=?4,kana=?5,default_debit_account_id=?6,default_credit_account_id=?7,default_tax_category=?8,allocation_rule_id=?9,default_partner_id=?10 WHERE id=?1",params![id,code,ja,en,kana,input.default_debit_account_id,input.default_credit_account_id,input.default_tax_category,input.allocation_rule_id,input.default_partner_id])?;
    get(conn, id)
}
pub fn set_active(conn: &Connection, id: i64, active: bool) -> AppResult<Purpose> {
    get(conn, id)?;
    conn.execute(
        "UPDATE purposes SET is_active=?2 WHERE id=?1",
        params![id, flag(active)],
    )?;
    get(conn, id)
}
pub fn delete(conn: &Connection, id: i64) -> AppResult<()> {
    if get(conn, id)?.in_use {
        return Err(AppError::new(ErrorCode::InUse));
    }
    conn.execute("DELETE FROM purposes WHERE id=?1", [id])?;
    Ok(())
}

pub fn post(
    db: &Database,
    year: i64,
    id: i64,
    date: &str,
    amount: i64,
) -> AppResult<transactions::Transaction> {
    if !(1..=AMOUNT_MAX).contains(&amount) {
        return Err(AppError::field(ErrorCode::OutOfRange, "amount"));
    }
    db.transaction(|tx| {
        let p = get(tx, id)?;
        if !p.is_active {
            return Err(AppError::field(ErrorCode::InvalidFormat, "purposeId"));
        }
        let debit = p.default_debit_account_id.ok_or(AppError::field(
            ErrorCode::Required,
            "defaultDebitAccountId",
        ))?;
        let credit = p.default_credit_account_id.ok_or(AppError::field(
            ErrorCode::Required,
            "defaultCreditAccountId",
        ))?;
        let mut lines = vec![
            LineInput {
                partner_id: p.default_partner_id,
                tax_category: p.default_tax_category,
                is_qualified_invoice: matches!(
                    super::accounts::get(tx, debit)?.category,
                    master::AccountCategory::Expense | master::AccountCategory::Cogs
                ) && transactions::has_invoice_no(tx, p.default_partner_id)?,
                ..LineInput::new(Side::Debit, debit, amount)
            },
            LineInput {
                partner_id: p.default_partner_id,
                ..LineInput::new(Side::Credit, credit, amount)
            },
        ];
        if matches!(
            p.default_tax_category,
            Some(
                TaxCategory::TaxableSales10 | TaxCategory::TaxableSales8 | TaxCategory::ExemptSales
            )
        ) {
            lines[0].tax_category = None;
            lines[0].is_qualified_invoice = false;
            lines[1].tax_category = p.default_tax_category;
        }
        if let Some(rule_id) = p.allocation_rule_id {
            let rule = super::allocation_rules::get(tx, rule_id)?;
            if !rule.is_active {
                return Err(AppError::field(
                    ErrorCode::InvalidFormat,
                    "allocationRuleId",
                ));
            }
            if super::accounts::get(tx, debit)?.category != master::AccountCategory::Expense {
                return Err(AppError::field(
                    ErrorCode::InvalidFormat,
                    "defaultDebitAccountId",
                ));
            }
            lines = allocation::split_line(
                &lines,
                0,
                transactions::owner_accounts(tx)?.drawings,
                rule.business_percent,
                rule.rounding,
            );
        }
        let result = transactions::insert_kind(
            tx,
            year,
            &TransactionInput {
                date: date.into(),
                entry_mode: EntryMode::Simple,
                memo: p.name_ja,
                lines,
            },
            TransactionKind::Normal,
        )?;
        tx.execute(
            "UPDATE journal_lines SET purpose_id=?2 WHERE transaction_id=?1",
            params![result.id, id],
        )?;
        Ok(result)
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::set_up_db;
    fn id(conn: &Connection, code: &str) -> i64 {
        conn.query_row("SELECT id FROM accounts WHERE code=?1", [code], |r| {
            r.get(0)
        })
        .unwrap()
    }
    fn input(conn: &Connection) -> PurposeInput {
        PurposeInput {
            code: "P1".into(),
            name_ja: "Stationery".into(),
            name_en: "".into(),
            kana: "".into(),
            default_debit_account_id: Some(id(conn, "610")),
            default_credit_account_id: Some(id(conn, "101")),
            default_tax_category: Some(TaxCategory::TaxablePurchase10),
            allocation_rule_id: None,
            default_partner_id: None,
        }
    }
    #[test]
    fn crud_and_post_keep_used_purposes_and_balanced_entries() {
        let db = set_up_db();
        let mut i = input(&db.conn());
        let p = create(&db.conn(), &i).unwrap();
        i.name_ja = "Office supplies".into();
        assert_eq!(
            update(&db.conn(), p.id, &i).unwrap().name_ja,
            "Office supplies"
        );
        let posted = post(&db, 2026, p.id, "2026-01-10", 1200).unwrap();
        assert_eq!(
            posted
                .lines
                .iter()
                .filter(|l| l.side == Side::Debit)
                .map(|l| l.amount)
                .sum::<i64>(),
            1200
        );
        assert!(get(&db.conn(), p.id).unwrap().in_use);
        assert_eq!(delete(&db.conn(), p.id).unwrap_err().code, ErrorCode::InUse);
        crate::locks::set_month(&db, 2026, 1, true).unwrap();
        assert_eq!(
            post(&db, 2026, p.id, "2026-01-11", 1200).unwrap_err().code,
            ErrorCode::MonthLocked
        );
        crate::locks::set_month(&db, 2026, 1, false).unwrap();
        set_active(&db.conn(), p.id, false).unwrap();
        assert!(post(&db, 2026, p.id, "2026-01-10", 1200).is_err());
        assert_eq!(
            transactions::list(&db.conn(), 2026, Some(1)).unwrap().len(),
            1
        );
    }
    #[test]
    fn allocation_splits_with_the_selected_rules_rounding() {
        let db = set_up_db();
        let mut i = input(&db.conn());
        let rule = super::super::allocation_rules::create(
            &db.conn(),
            &super::super::allocation_rules::AllocationRuleInput {
                code: "R".into(),
                name_ja: "Home".into(),
                name_en: "".into(),
                business_percent: 50,
                rounding: master::Rounding::Ceil,
            },
        )
        .unwrap();
        i.allocation_rule_id = Some(rule.id);
        let p = create(&db.conn(), &i).unwrap();
        let posted = post(&db, 2026, p.id, "2026-01-10", 101).unwrap();
        assert_eq!(posted.lines.len(), 3);
        assert_eq!(posted.lines[0].amount, 51);
        assert_eq!(posted.lines[1].amount, 50);
        assert_eq!(posted.lines[2].amount, 101);
        assert!(post(&db, 2026, p.id, "2026-01-10", -1).is_err());
    }
    #[test]
    fn inactive_defaults_and_same_accounts_are_rejected() {
        let db = set_up_db();
        let mut i = input(&db.conn());
        i.default_credit_account_id = i.default_debit_account_id;
        assert!(create(&db.conn(), &i).is_err());
        i = input(&db.conn());
        super::super::accounts::set_active(&db.conn(), i.default_debit_account_id.unwrap(), false)
            .unwrap();
        assert!(create(&db.conn(), &i).is_err());
    }
}
