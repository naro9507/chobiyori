//! 取引（ヘッダ）と明細行の読み書き。
//!
//! 書き込みはすべて 1 つの DB トランザクションで行い、検証（`domain::journal::validate`）を
//! 通らない取引は保存しない。これで「取引ごとに借方合計 = 貸方合計」が常に成り立つ。

use super::Database;
use crate::domain::journal::{
    self, AllowedInactive, EntryMode, MasterLookup, OwnerAccounts, Side, SimpleInput,
    TransactionInput, TransactionKind, ValidTransaction,
};
use crate::domain::standard_accounts::{OWNER_CONTRIBUTIONS_LINE, OWNER_DRAWINGS_LINE};
use crate::error::{AppError, AppResult, ErrorCode};
use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use std::collections::HashMap;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Line {
    pub id: i64,
    pub line_no: i64,
    pub side: Side,
    pub account_id: i64,
    pub amount: i64,
    pub partner_id: Option<i64>,
    pub memo: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Transaction {
    pub id: i64,
    pub fiscal_year: i64,
    pub date: String,
    pub kind: TransactionKind,
    pub entry_mode: EntryMode,
    pub memo: String,
    pub lines: Vec<Line>,
}

/// 年度があり、締めていないことを確かめる。
fn ensure_year_open(conn: &Connection, year: i64) -> AppResult<()> {
    let closed: Option<bool> = conn
        .query_row(
            "SELECT status = 'closed' FROM fiscal_years WHERE year = ?1",
            [year],
            |row| row.get(0),
        )
        .optional()?;
    match closed {
        None => Err(AppError::field(ErrorCode::NotFound, "fiscalYear")),
        Some(true) => Err(AppError::new(ErrorCode::YearClosed)),
        Some(false) => Ok(()),
    }
}

/// 科目と取引先の有効・無効。件数は多くても数百なので、まとめて読む。
struct DbMasters {
    accounts: HashMap<i64, bool>,
    partners: HashMap<i64, bool>,
}

impl DbMasters {
    fn load(conn: &Connection) -> AppResult<Self> {
        let read = |sql: &str| -> AppResult<HashMap<i64, bool>> {
            let mut stmt = conn.prepare(sql)?;
            let rows = stmt.query_map([], |row| Ok((row.get(0)?, row.get(1)?)))?;
            Ok(rows.collect::<Result<_, _>>()?)
        };
        Ok(Self {
            accounts: read("SELECT id, is_active FROM accounts")?,
            partners: read("SELECT id, is_active FROM partners")?,
        })
    }
}

impl MasterLookup for DbMasters {
    fn account_active(&self, id: i64) -> Option<bool> {
        self.accounts.get(&id).copied()
    }
    fn partner_active(&self, id: i64) -> Option<bool> {
        self.partners.get(&id).copied()
    }
}

fn insert_lines(conn: &Connection, transaction_id: i64, valid: &ValidTransaction) -> AppResult<()> {
    let mut insert = conn.prepare_cached(
        "INSERT INTO journal_lines (transaction_id, line_no, side, account_id, amount, partner_id, memo)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
    )?;
    for (index, line) in valid.lines.iter().enumerate() {
        insert.execute(params![
            transaction_id,
            index as i64 + 1,
            line.side,
            line.account_id,
            line.amount,
            line.partner_id,
            line.memo
        ])?;
    }
    Ok(())
}

fn insert(conn: &Connection, year: i64, input: &TransactionInput) -> AppResult<Transaction> {
    ensure_year_open(conn, year)?;
    let valid = journal::validate(
        input,
        year,
        &DbMasters::load(conn)?,
        &AllowedInactive::default(),
    )?;
    conn.execute(
        "INSERT INTO transactions (fiscal_year, date, kind, entry_mode, memo) VALUES (?1, ?2, ?3, ?4, ?5)",
        params![year, valid.date, TransactionKind::Normal, input.entry_mode, valid.memo],
    )?;
    let id = conn.last_insert_rowid();
    insert_lines(conn, id, &valid)?;
    get(conn, id)
}

/// 仕訳グリッド・複合仕訳の取引を保存する。
pub fn create(db: &Database, year: i64, input: &TransactionInput) -> AppResult<Transaction> {
    db.transaction(|tx| insert(tx, year, input))
}

/// 口座の印が付いた、ある科目か。
fn ensure_payment_account(conn: &Connection, id: i64, field: &'static str) -> AppResult<()> {
    let is_payment: Option<bool> = conn
        .query_row(
            "SELECT is_payment_account FROM accounts WHERE id = ?1",
            [id],
            |row| row.get(0),
        )
        .optional()?;
    match is_payment {
        None => Err(AppError::field(ErrorCode::NotFound, field)),
        Some(false) => Err(AppError::field(ErrorCode::InvalidFormat, field)),
        Some(true) => Ok(()),
    }
}

fn owner_accounts(conn: &Connection) -> AppResult<OwnerAccounts> {
    let find = |line: &str| -> AppResult<i64> {
        conn.query_row(
            "SELECT id FROM accounts WHERE statement_line = ?1",
            [line],
            |row| row.get(0),
        )
        .optional()?
        .ok_or(AppError::field(ErrorCode::NotFound, "kind"))
    };
    Ok(OwnerAccounts {
        drawings: find(OWNER_DRAWINGS_LINE)?,
        contributions: find(OWNER_CONTRIBUTIONS_LINE)?,
    })
}

/// かんたん入力の取引を保存する。仕訳（借方 1 行 + 貸方 1 行）に直してから、同じ検証を通す。
pub fn create_simple(db: &Database, year: i64, input: &SimpleInput) -> AppResult<Transaction> {
    db.transaction(|tx| {
        ensure_payment_account(tx, input.payment_account_id, "paymentAccountId")?;
        if input.kind == journal::SimpleKind::Transfer {
            if let Some(to) = input.account_id {
                ensure_payment_account(tx, to, "accountId")?;
            }
        }
        let transaction = journal::simple_to_transaction(input, owner_accounts(tx)?)?;
        insert(tx, year, &transaction).map_err(|e| journal::simple_error(input.kind, e))
    })
}

/// 取引を変更する。年度は変えられない（日付は同じ年度の中で動かせる）。
/// 入力方法（`entry_mode`）は作ったときのままにする。
pub fn update(db: &Database, id: i64, input: &TransactionInput) -> AppResult<Transaction> {
    db.transaction(|tx| {
        let current = get(tx, id)?;
        ensure_year_open(tx, current.fiscal_year)?;
        let allowed = AllowedInactive {
            accounts: current.lines.iter().map(|l| l.account_id).collect(),
            partners: current.lines.iter().filter_map(|l| l.partner_id).collect(),
        };
        let valid = journal::validate(input, current.fiscal_year, &DbMasters::load(tx)?, &allowed)?;
        tx.execute(
            "UPDATE transactions SET date = ?2, memo = ?3, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
             WHERE id = ?1",
            params![id, valid.date, valid.memo],
        )?;
        tx.execute("DELETE FROM journal_lines WHERE transaction_id = ?1", [id])?;
        insert_lines(tx, id, &valid)?;
        get(tx, id)
    })
}

pub fn delete(db: &Database, id: i64) -> AppResult<()> {
    db.transaction(|tx| {
        let current = get(tx, id)?;
        ensure_year_open(tx, current.fiscal_year)?;
        // 明細行は ON DELETE CASCADE で一緒に消える
        tx.execute("DELETE FROM transactions WHERE id = ?1", [id])?;
        Ok(())
    })
}

const SELECT: &str = "
    SELECT t.id, t.fiscal_year, t.date, t.kind, t.entry_mode, t.memo,
           l.id, l.line_no, l.side, l.account_id, l.amount, l.partner_id, l.memo
    FROM transactions t
    JOIN journal_lines l ON l.transaction_id = t.id";

/// 明細行ごとの行を、取引ごとにまとめる。行は取引の順・明細の順に並んでいること。
fn collect(
    stmt: &mut rusqlite::Statement<'_>,
    params: impl rusqlite::Params,
) -> AppResult<Vec<Transaction>> {
    let mut rows = stmt.query(params)?;
    let mut result: Vec<Transaction> = Vec::new();
    while let Some(row) = rows.next()? {
        let id: i64 = row.get(0)?;
        if result.last().map(|t| t.id) != Some(id) {
            result.push(Transaction {
                id,
                fiscal_year: row.get(1)?,
                date: row.get(2)?,
                kind: row.get(3)?,
                entry_mode: row.get(4)?,
                memo: row.get(5)?,
                lines: Vec::new(),
            });
        }
        if let Some(t) = result.last_mut() {
            t.lines.push(Line {
                id: row.get(6)?,
                line_no: row.get(7)?,
                side: row.get(8)?,
                account_id: row.get(9)?,
                amount: row.get(10)?,
                partner_id: row.get(11)?,
                memo: row.get(12)?,
            });
        }
    }
    Ok(result)
}

pub fn get(conn: &Connection, id: i64) -> AppResult<Transaction> {
    let mut stmt = conn.prepare(&format!("{SELECT} WHERE t.id = ?1 ORDER BY l.line_no"))?;
    collect(&mut stmt, [id])?
        .pop()
        .ok_or(AppError::new(ErrorCode::NotFound))
}

/// 年度の取引。`month` を渡すとその月だけ。日付の順、同じ日は入力した順。
pub fn list(conn: &Connection, year: i64, month: Option<u32>) -> AppResult<Vec<Transaction>> {
    let (from, to) = match month {
        Some(month) => journal::month_range(year, month)?,
        None => (format!("{year:04}-01-01"), format!("{year:04}-12-31")),
    };
    list_between(conn, year, &from, &to)
}

/// 年度の取引のうち、日付が `from` から `to` まで（両端を含む）のもの。日付の順、同じ日は入力した順。
pub fn list_between(
    conn: &Connection,
    year: i64,
    from: &str,
    to: &str,
) -> AppResult<Vec<Transaction>> {
    let mut stmt = conn.prepare(&format!(
        "{SELECT} WHERE t.fiscal_year = ?1 AND t.date BETWEEN ?2 AND ?3 ORDER BY t.date, t.id, l.line_no"
    ))?;
    collect(&mut stmt, params![year, from, to])
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use crate::db::setup::tests::set_up_db;
    use crate::domain::journal::{LineInput, SimpleKind};

    /// コードから科目の id を引く。
    pub(crate) fn account(conn: &Connection, code: &str) -> i64 {
        conn.query_row("SELECT id FROM accounts WHERE code = ?1", [code], |r| {
            r.get(0)
        })
        .unwrap()
    }

    pub(crate) fn entry(date: &str, debit: i64, credit: i64, amount: i64) -> TransactionInput {
        TransactionInput {
            date: date.into(),
            entry_mode: EntryMode::Grid,
            memo: String::new(),
            lines: vec![
                LineInput {
                    side: Side::Debit,
                    account_id: debit,
                    amount,
                    partner_id: None,
                    memo: String::new(),
                },
                LineInput {
                    side: Side::Credit,
                    account_id: credit,
                    amount,
                    partner_id: None,
                    memo: String::new(),
                },
            ],
        }
    }

    #[test]
    fn creates_and_lists_transactions_by_month_in_date_order() {
        let db = set_up_db();
        let (cash, supplies, sales) = {
            let conn = db.conn();
            (
                account(&conn, "101"),
                account(&conn, "610"),
                account(&conn, "401"),
            )
        };
        create(&db, 2026, &entry("2026-03-20", supplies, cash, 1200)).unwrap();
        create(&db, 2026, &entry("2026-03-05", cash, sales, 30000)).unwrap();
        create(&db, 2026, &entry("2026-04-01", supplies, cash, 500)).unwrap();

        let conn = db.conn();
        let march = list(&conn, 2026, Some(3)).unwrap();
        assert_eq!(
            march.iter().map(|t| t.date.as_str()).collect::<Vec<_>>(),
            ["2026-03-05", "2026-03-20"]
        );
        let t = &march[1];
        assert_eq!(t.kind, TransactionKind::Normal);
        assert_eq!(t.entry_mode, EntryMode::Grid);
        assert_eq!(t.lines.len(), 2);
        assert_eq!(
            (t.lines[0].side, t.lines[0].account_id),
            (Side::Debit, supplies)
        );
        assert_eq!((t.lines[1].line_no, t.lines[1].amount), (2, 1200));
        assert_eq!(list(&conn, 2026, None).unwrap().len(), 3);
        // 使われた科目は削除できなくなる
        assert!(crate::db::accounts::get(&conn, supplies).unwrap().in_use);
    }

    #[test]
    fn invalid_transactions_are_not_saved() {
        let db = set_up_db();
        let (cash, supplies) = {
            let conn = db.conn();
            (account(&conn, "101"), account(&conn, "610"))
        };
        let mut unbalanced = entry("2026-03-20", supplies, cash, 1200);
        unbalanced.lines[1].amount = 1000;
        assert_eq!(
            create(&db, 2026, &unbalanced).unwrap_err().code,
            ErrorCode::Unbalanced
        );
        assert_eq!(
            create(&db, 2026, &entry("2025-12-31", supplies, cash, 1)).unwrap_err(),
            AppError::field(ErrorCode::OutOfRange, "date")
        );
        assert_eq!(
            create(&db, 2027, &entry("2027-01-01", supplies, cash, 1)).unwrap_err(),
            AppError::field(ErrorCode::NotFound, "fiscalYear")
        );
        let count: i64 = db
            .conn()
            .query_row("SELECT count(*) FROM journal_lines", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 0);
    }

    #[test]
    fn inactive_accounts_cannot_be_used_for_new_entries_but_stay_on_old_ones() {
        let db = set_up_db();
        let (cash, supplies, misc) = {
            let conn = db.conn();
            (
                account(&conn, "101"),
                account(&conn, "610"),
                account(&conn, "699"),
            )
        };
        let saved = create(&db, 2026, &entry("2026-03-20", supplies, cash, 1200)).unwrap();
        crate::db::accounts::set_active(&db.conn(), supplies, false).unwrap();

        assert_eq!(
            create(&db, 2026, &entry("2026-03-21", supplies, cash, 1)).unwrap_err(),
            AppError::line(ErrorCode::Inactive, 0, "accountId")
        );
        // 変更前から使っていた科目なら、金額を直せる
        let fixed = update(&db, saved.id, &entry("2026-03-20", supplies, cash, 1300)).unwrap();
        assert_eq!(fixed.lines[0].amount, 1300);
        // 別の科目に変えたうえで、無効の科目に戻すことはできない
        update(&db, saved.id, &entry("2026-03-20", misc, cash, 1300)).unwrap();
        assert_eq!(
            update(&db, saved.id, &entry("2026-03-20", supplies, cash, 1300))
                .unwrap_err()
                .code,
            ErrorCode::Inactive
        );
    }

    #[test]
    fn update_replaces_lines_and_keeps_the_entry_mode() {
        let db = set_up_db();
        let (cash, bank, wages, withheld) = {
            let conn = db.conn();
            (
                account(&conn, "101"),
                account(&conn, "104"),
                account(&conn, "613"),
                account(&conn, "206"),
            )
        };
        let saved = create(&db, 2026, &entry("2026-03-25", wages, cash, 200_000)).unwrap();
        let mut compound = entry("2026-03-26", wages, bank, 200_000);
        compound.entry_mode = EntryMode::Compound;
        compound.memo = "3 月分の給料".into();
        compound.lines[1].amount = 179_580;
        compound.lines.push(LineInput {
            side: Side::Credit,
            account_id: withheld,
            amount: 20_420,
            partner_id: None,
            memo: "源泉所得税".into(),
        });
        let updated = update(&db, saved.id, &compound).unwrap();
        assert_eq!(updated.date, "2026-03-26");
        assert_eq!(updated.memo, "3 月分の給料");
        assert_eq!(updated.entry_mode, EntryMode::Grid);
        assert_eq!(updated.lines.len(), 3);
        assert_eq!(updated.lines[2].memo, "源泉所得税");

        // 年度をまたぐ変更はできない
        assert_eq!(
            update(&db, saved.id, &entry("2027-01-01", wages, cash, 1)).unwrap_err(),
            AppError::field(ErrorCode::OutOfRange, "date")
        );
        assert_eq!(
            update(&db, 999, &compound).unwrap_err().code,
            ErrorCode::NotFound
        );
    }

    #[test]
    fn delete_removes_the_lines_too() {
        let db = set_up_db();
        let (cash, supplies) = {
            let conn = db.conn();
            (account(&conn, "101"), account(&conn, "610"))
        };
        let saved = create(&db, 2026, &entry("2026-03-20", supplies, cash, 1200)).unwrap();
        delete(&db, saved.id).unwrap();
        let conn = db.conn();
        assert_eq!(get(&conn, saved.id).unwrap_err().code, ErrorCode::NotFound);
        let count: i64 = conn
            .query_row("SELECT count(*) FROM journal_lines", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 0);
        drop(conn);
        assert_eq!(delete(&db, saved.id).unwrap_err().code, ErrorCode::NotFound);
    }

    #[test]
    fn closed_year_cannot_be_changed() {
        let db = set_up_db();
        let (cash, supplies) = {
            let conn = db.conn();
            (account(&conn, "101"), account(&conn, "610"))
        };
        let saved = create(&db, 2026, &entry("2026-03-20", supplies, cash, 1200)).unwrap();
        db.conn()
            .execute("UPDATE fiscal_years SET status = 'closed'", [])
            .unwrap();
        assert_eq!(
            create(&db, 2026, &entry("2026-03-21", supplies, cash, 1))
                .unwrap_err()
                .code,
            ErrorCode::YearClosed
        );
        assert_eq!(
            delete(&db, saved.id).unwrap_err().code,
            ErrorCode::YearClosed
        );
    }

    fn simple(kind: SimpleKind, account_id: Option<i64>, payment: i64, amount: i64) -> SimpleInput {
        SimpleInput {
            kind,
            date: "2026-03-15".into(),
            amount,
            account_id,
            payment_account_id: payment,
            partner_id: None,
            memo: String::new(),
        }
    }

    #[test]
    fn simple_entries_are_saved_as_journal_lines() {
        let db = set_up_db();
        let (cash, bank, supplies, drawings, contributions) = {
            let conn = db.conn();
            (
                account(&conn, "101"),
                account(&conn, "104"),
                account(&conn, "610"),
                account(&conn, "199"),
                account(&conn, "301"),
            )
        };
        let t = create_simple(
            &db,
            2026,
            &simple(SimpleKind::Expense, Some(supplies), cash, 1200),
        )
        .unwrap();
        assert_eq!(t.entry_mode, EntryMode::Simple);
        assert_eq!(
            t.lines
                .iter()
                .map(|l| (l.side, l.account_id, l.amount))
                .collect::<Vec<_>>(),
            [(Side::Debit, supplies, 1200), (Side::Credit, cash, 1200)]
        );

        let t = create_simple(
            &db,
            2026,
            &simple(SimpleKind::OwnerDraw, None, bank, 50_000),
        )
        .unwrap();
        assert_eq!(
            (t.lines[0].account_id, t.lines[1].account_id),
            (drawings, bank)
        );
        let t = create_simple(
            &db,
            2026,
            &simple(SimpleKind::OwnerContribution, None, cash, 10_000),
        )
        .unwrap();
        assert_eq!(
            (t.lines[0].account_id, t.lines[1].account_id),
            (cash, contributions)
        );
    }

    #[test]
    fn simple_entry_errors_point_to_its_own_fields() {
        let db = set_up_db();
        let (cash, supplies) = {
            let conn = db.conn();
            (account(&conn, "101"), account(&conn, "610"))
        };
        // 経費の科目は口座ではない
        assert_eq!(
            create_simple(
                &db,
                2026,
                &simple(SimpleKind::Expense, Some(cash), supplies, 1)
            )
            .unwrap_err(),
            AppError::field(ErrorCode::InvalidFormat, "paymentAccountId")
        );
        // 振替の入れ先も口座にする
        assert_eq!(
            create_simple(
                &db,
                2026,
                &simple(SimpleKind::Transfer, Some(supplies), cash, 1)
            )
            .unwrap_err(),
            AppError::field(ErrorCode::InvalidFormat, "accountId")
        );
        assert_eq!(
            create_simple(
                &db,
                2026,
                &simple(SimpleKind::Expense, Some(supplies), cash, 0)
            )
            .unwrap_err(),
            AppError::field(ErrorCode::OutOfRange, "amount")
        );
        crate::db::accounts::set_active(&db.conn(), supplies, false).unwrap();
        assert_eq!(
            create_simple(
                &db,
                2026,
                &simple(SimpleKind::Expense, Some(supplies), cash, 1)
            )
            .unwrap_err(),
            AppError::field(ErrorCode::Inactive, "accountId")
        );
    }
}
