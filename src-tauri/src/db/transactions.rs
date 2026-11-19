//! 取引（ヘッダ）と明細行の読み書き。
//!
//! 書き込みはすべて 1 つの DB トランザクションで行い、検証（`domain::journal::validate`）を
//! 通らない取引は保存しない。これで「取引ごとに借方合計 = 貸方合計」が常に成り立つ。

use super::locks::ensure_date_open;
use super::{audit, Database};
use crate::domain::allocation;
use crate::domain::journal::{
    self, AllowedInactive, EntryMode, MasterLookup, OwnerAccounts, Side, SimpleInput, SimpleKind,
    TransactionInput, TransactionKind, ValidTransaction,
};
use crate::domain::master::{Rounding, TaxCategory};
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
    pub sub_account_id: Option<i64>,
    /// 税区分。フェーズ 3 までに入れた行は空
    pub tax_category: Option<TaxCategory>,
    pub is_qualified_invoice: bool,
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
pub(crate) fn ensure_year_open(conn: &Connection, year: i64) -> AppResult<()> {
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

/// その日の取引を免税として扱うか。
pub(crate) fn date_is_exempt(conn: &Connection, date: &str) -> AppResult<bool> {
    let date = date.trim();
    let year = journal::parse_date(date)
        .map(|(y, _, _)| y)
        .ok_or(AppError::field(ErrorCode::InvalidFormat, "date"))?;
    Ok(tax_start(conn, year)?.is_none_or(|start| date < start.as_str()))
}

fn tax_start(conn: &Connection, year: i64) -> AppResult<Option<String>> {
    match super::filing::taxable_from(conn, year) {
        Err(error) if error.code == ErrorCode::NotFound => Ok(None),
        other => other,
    }
}

/// 科目・取引先・補助科目の有効・無効と、科目の既定の税区分。件数は多くても数百なので、まとめて読む。
pub(crate) struct DbMasters {
    accounts: HashMap<i64, (bool, Option<TaxCategory>)>,
    partners: HashMap<i64, bool>,
    sub_accounts: HashMap<i64, (i64, bool)>,
    taxable_from: Option<String>,
}

impl DbMasters {
    pub(crate) fn load(conn: &Connection, year: i64) -> AppResult<Self> {
        let mut stmt = conn.prepare("SELECT id, is_active, default_tax_category FROM accounts")?;
        let accounts = stmt
            .query_map([], |row| Ok((row.get(0)?, (row.get(1)?, row.get(2)?))))?
            .collect::<Result<_, _>>()?;
        let mut stmt = conn.prepare("SELECT id, is_active FROM partners")?;
        let partners = stmt
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))?
            .collect::<Result<_, _>>()?;
        let mut stmt = conn.prepare("SELECT id, account_id, is_active FROM sub_accounts")?;
        let sub_accounts = stmt
            .query_map([], |row| Ok((row.get(0)?, (row.get(1)?, row.get(2)?))))?
            .collect::<Result<_, _>>()?;
        Ok(Self {
            accounts,
            partners,
            sub_accounts,
            taxable_from: tax_start(conn, year)?,
        })
    }
}

impl MasterLookup for DbMasters {
    fn account_active(&self, id: i64) -> Option<bool> {
        self.accounts.get(&id).map(|a| a.0)
    }
    fn partner_active(&self, id: i64) -> Option<bool> {
        self.partners.get(&id).copied()
    }
    fn sub_account(&self, id: i64) -> Option<(i64, bool)> {
        self.sub_accounts.get(&id).copied()
    }
    fn account_tax(&self, id: i64) -> Option<TaxCategory> {
        self.accounts.get(&id).and_then(|a| a.1)
    }
    fn tax_exempt(&self, date: &str) -> bool {
        self.taxable_from
            .as_deref()
            .is_none_or(|start| date < start)
    }
}

fn insert_lines(conn: &Connection, transaction_id: i64, valid: &ValidTransaction) -> AppResult<()> {
    let mut insert = conn.prepare_cached(
        "INSERT INTO journal_lines (transaction_id, line_no, side, account_id, amount, partner_id, memo,
                                    sub_account_id, tax_category, is_qualified_invoice)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
    )?;
    for (index, line) in valid.lines.iter().enumerate() {
        insert.execute(params![
            transaction_id,
            index as i64 + 1,
            line.side,
            line.account_id,
            line.amount,
            line.partner_id,
            line.memo,
            line.sub_account_id,
            line.tax_category,
            line.is_qualified_invoice
        ])?;
    }
    Ok(())
}

fn insert(conn: &Connection, year: i64, input: &TransactionInput) -> AppResult<Transaction> {
    insert_kind(conn, year, input, TransactionKind::Normal)
}

/// 取引を検証して保存する。定型仕訳から作るときは `kind` を `Template` にする。
pub(crate) fn insert_kind(
    conn: &Connection,
    year: i64,
    input: &TransactionInput,
    kind: TransactionKind,
) -> AppResult<Transaction> {
    ensure_year_open(conn, year)?;
    let valid = journal::validate(
        input,
        year,
        &DbMasters::load(conn, year)?,
        &AllowedInactive::default(),
    )?;
    ensure_date_open(conn, year, &valid.date)?;
    conn.execute(
        "INSERT INTO transactions (fiscal_year, date, kind, entry_mode, memo) VALUES (?1, ?2, ?3, ?4, ?5)",
        params![year, valid.date, kind, input.entry_mode, valid.memo],
    )?;
    let id = conn.last_insert_rowid();
    insert_lines(conn, id, &valid)?;
    let saved = get(conn, id)?;
    audit::transaction(conn, "create", None, Some(&saved))?;
    Ok(saved)
}

/// 取引を消す。締めた月なら消さない。変更履歴に消す前の内容を残す。
/// 決算の仕訳を作り直すときなど、ほかのモジュールからもこれを使う。
pub(crate) fn remove(conn: &Connection, id: i64) -> AppResult<()> {
    let current = get(conn, id)?;
    ensure_date_open(conn, current.fiscal_year, &current.date)?;
    let has_payments: bool = conn.query_row(
        "SELECT EXISTS (SELECT 1 FROM documents d JOIN document_payments p ON p.document_id = d.id
                        WHERE d.transaction_id = ?1)",
        [id],
        |row| row.get(0),
    )?;
    if has_payments {
        return Err(AppError::new(ErrorCode::HasPayments));
    }
    // 明細行は ON DELETE CASCADE で一緒に消える
    conn.execute("DELETE FROM transactions WHERE id = ?1", [id])?;
    audit::transaction(conn, "delete", Some(&current), None)
}

/// 取込で、たくさんの取引をまとめて保存する。呼び出し側の DB トランザクションの中で使う。
/// マスタは 1 回だけ読む。1 件でも検証を通らなければエラーにする（呼び出し側で全部取り消す）。
pub(crate) fn insert_many(
    conn: &Connection,
    year: i64,
    inputs: &[TransactionInput],
) -> AppResult<usize> {
    ensure_year_open(conn, year)?;
    let masters = DbMasters::load(conn, year)?;
    let mut insert = conn.prepare(
        "INSERT INTO transactions (fiscal_year, date, kind, entry_mode, memo) VALUES (?1, ?2, ?3, ?4, ?5)",
    )?;
    for input in inputs {
        let valid = journal::validate(input, year, &masters, &AllowedInactive::default())?;
        ensure_date_open(conn, year, &valid.date)?;
        insert.execute(params![
            year,
            valid.date,
            TransactionKind::Normal,
            input.entry_mode,
            valid.memo
        ])?;
        let id = conn.last_insert_rowid();
        insert_lines(conn, id, &valid)?;
        audit::transaction(conn, "import", None, Some(&get(conn, id)?))?;
    }
    Ok(inputs.len())
}

/// 仕訳グリッド・複合仕訳の取引を保存する。
pub fn create(db: &Database, year: i64, input: &TransactionInput) -> AppResult<Transaction> {
    db.transaction(|tx| insert(tx, year, input))
}

/// 口座の印が付いた、ある科目か。
pub(crate) fn ensure_payment_account(
    conn: &Connection,
    id: i64,
    field: &'static str,
) -> AppResult<()> {
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

pub(crate) fn owner_accounts(conn: &Connection) -> AppResult<OwnerAccounts> {
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
        if !(1..=journal::AMOUNT_MAX).contains(&input.amount) {
            return Err(AppError::field(ErrorCode::OutOfRange, "amount"));
        }
        let mut input = input.clone();
        match input.kind {
            SimpleKind::UnpaidIncome => {
                let account = input
                    .account_id
                    .ok_or(AppError::field(ErrorCode::Required, "accountId"))?;
                let revenue: bool = tx.query_row(
                    "SELECT EXISTS (SELECT 1 FROM accounts WHERE id = ?1 AND category = 'revenue')",
                    [account],
                    |row| row.get(0),
                )?;
                if !revenue {
                    return Err(AppError::field(ErrorCode::InvalidFormat, "accountId"));
                }
                input.payment_account_id =
                    super::closing::account_by_line(tx, "bs.accounts_receivable")?;
            }
            SimpleKind::PersonalExpense => (),
            _ => {
                if input.payment_account_id == 0 {
                    return Err(AppError::field(ErrorCode::Required, "paymentAccountId"));
                }
                ensure_payment_account(tx, input.payment_account_id, "paymentAccountId")?;
            }
        }
        if input.kind == SimpleKind::Transfer {
            if let Some(to) = input.account_id {
                ensure_payment_account(tx, to, "accountId")?;
            }
        }
        let owner = owner_accounts(tx)?;
        let mut transaction = journal::simple_to_transaction(&input, owner)?;
        if matches!(
            input.kind,
            SimpleKind::Expense | SimpleKind::PersonalExpense
        ) {
            // インボイス: 登録番号のある取引先からの支払いなら、印を付けておく
            let qualified = has_invoice_no(tx, input.partner_id)?;
            for line in transaction.lines.iter_mut() {
                line.is_qualified_invoice = qualified && line.side == Side::Debit;
            }
            if let Some(percent) = input.allocation_percent {
                if !(0..=100).contains(&percent) {
                    return Err(AppError::field(ErrorCode::OutOfRange, "allocationPercent"));
                }
                let rounding = account_rounding(tx, transaction.lines[0].account_id)?;
                if input.kind == SimpleKind::PersonalExpense {
                    // 私用の口座で払った家事分は、事業の帳簿には入れない。
                    let business = allocation::allocate(input.amount, percent, rounding).business;
                    if business == 0 {
                        return Err(AppError::field(ErrorCode::OutOfRange, "allocationPercent"));
                    }
                    for line in &mut transaction.lines {
                        line.amount = business;
                    }
                } else {
                    transaction.lines = allocation::split_line(
                        &transaction.lines,
                        0,
                        owner.drawings,
                        percent,
                        rounding,
                    );
                }
            }
        }
        insert(tx, year, &transaction).map_err(|error| {
            let error = journal::simple_error(input.kind, error);
            if input.kind == SimpleKind::UnpaidIncome && error.field == Some("paymentAccountId") {
                AppError::field(error.code, "kind")
            } else {
                error
            }
        })
    })
}

/// 取引先に適格請求書発行事業者の登録番号があるか。
pub(crate) fn has_invoice_no(conn: &Connection, partner_id: Option<i64>) -> AppResult<bool> {
    let Some(id) = partner_id else {
        return Ok(false);
    };
    Ok(conn
        .query_row(
            "SELECT invoice_registration_no IS NOT NULL FROM partners WHERE id = ?1",
            [id],
            |row| row.get(0),
        )
        .optional()?
        .unwrap_or(false))
}

/// 科目の既定の按分ルールの端数処理。ルールがなければ切り捨て。
pub(crate) fn account_rounding(conn: &Connection, account_id: i64) -> AppResult<Rounding> {
    Ok(conn
        .query_row(
            "SELECT r.rounding FROM accounts a JOIN allocation_rules r ON r.id = a.default_allocation_rule_id
             WHERE a.id = ?1",
            [account_id],
            |row| row.get(0),
        )
        .optional()?
        .unwrap_or(Rounding::Floor))
}

/// 入金と売上の紐付けを保ったまま編集する。入金額の修正は同じ仕訳内の明細に反映する。
fn update_linked_posting(
    conn: &Connection,
    current: &Transaction,
    valid: &ValidTransaction,
) -> AppResult<()> {
    let (sale, invoice_payment, recurring_payment): (bool, bool, bool) = conn.query_row(
        "SELECT EXISTS (SELECT 1 FROM documents WHERE transaction_id = ?1),
                EXISTS (SELECT 1 FROM document_payments WHERE transaction_id = ?1),
                EXISTS (SELECT 1 FROM recurring_payments WHERE transaction_id = ?1)",
        [current.id],
        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
    )?;
    if !sale && !invoice_payment && !recurring_payment {
        return Ok(());
    }
    let matches = |old: &Line, new: &journal::LineInput| {
        old.side == new.side
            && old.account_id == new.account_id
            && old.partner_id == new.partner_id
            && old.sub_account_id == new.sub_account_id
            && old.tax_category == new.tax_category
            && old.is_qualified_invoice == new.is_qualified_invoice
            && (!sale || old.amount == new.amount)
    };
    if (sale && valid.date != current.date)
        || valid.lines.len() != current.lines.len()
        || !current
            .lines
            .iter()
            .zip(&valid.lines)
            .all(|(old, new)| matches(old, new))
    {
        return Err(AppError::new(ErrorCode::LinkedPosting));
    }
    if invoice_payment || recurring_payment {
        if valid.lines.len() != 2 {
            return Err(AppError::new(ErrorCode::LinkedPosting));
        }
        let amount = valid.lines[0].amount;
        if invoice_payment {
            super::documents::update_payment_amount(conn, current.id, amount)?;
        }
        if recurring_payment {
            conn.execute(
                "UPDATE recurring_payments SET amount = CASE WHEN amount < 0 THEN -?2 ELSE ?2 END
                 WHERE transaction_id = ?1",
                params![current.id, amount],
            )?;
        }
    }
    Ok(())
}

/// 取引を変更する。年度は変えられない（日付は同じ年度の中で動かせる）。
/// 入力方法（`entry_mode`）は作ったときのままにする。
pub fn update(db: &Database, id: i64, input: &TransactionInput) -> AppResult<Transaction> {
    db.transaction(|tx| update_in(tx, id, input, true))
}

/// 取引を変更する（呼び出し側の DB トランザクションの中で）。締めと変更履歴は `update` と同じ。
pub(crate) fn update_in(
    tx: &Connection,
    id: i64,
    input: &TransactionInput,
    sync_linked_posting: bool,
) -> AppResult<Transaction> {
    {
        let current = get(tx, id)?;
        ensure_date_open(tx, current.fiscal_year, &current.date)?;
        let allowed = AllowedInactive {
            accounts: current.lines.iter().map(|l| l.account_id).collect(),
            partners: current.lines.iter().filter_map(|l| l.partner_id).collect(),
            sub_accounts: current
                .lines
                .iter()
                .filter_map(|l| l.sub_account_id)
                .collect(),
        };
        let valid = journal::validate(
            input,
            current.fiscal_year,
            &DbMasters::load(tx, current.fiscal_year)?,
            &allowed,
        )?;
        // 締めた月へ動かすこともできない
        ensure_date_open(tx, current.fiscal_year, &valid.date)?;
        if sync_linked_posting {
            update_linked_posting(tx, &current, &valid)?;
        }
        tx.execute(
            "UPDATE transactions SET date = ?2, memo = ?3, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
             WHERE id = ?1",
            params![id, valid.date, valid.memo],
        )?;
        tx.execute("DELETE FROM journal_lines WHERE transaction_id = ?1", [id])?;
        insert_lines(tx, id, &valid)?;
        let saved = get(tx, id)?;
        audit::transaction(tx, "update", Some(&current), Some(&saved))?;
        Ok(saved)
    }
}

pub fn delete(db: &Database, id: i64) -> AppResult<()> {
    db.transaction(|tx| remove(tx, id))
}

const SELECT: &str = "
    SELECT t.id, t.fiscal_year, t.date, t.kind, t.entry_mode, t.memo,
           l.id, l.line_no, l.side, l.account_id, l.amount, l.partner_id, l.memo,
           l.sub_account_id, l.tax_category, l.is_qualified_invoice
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
                sub_account_id: row.get(13)?,
                tax_category: row.get(14)?,
                is_qualified_invoice: row.get(15)?,
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
                    sub_account_id: None,
                    tax_category: None,
                    is_qualified_invoice: false,
                    side: Side::Debit,
                    account_id: debit,
                    amount,
                    partner_id: None,
                    memo: String::new(),
                },
                LineInput {
                    sub_account_id: None,
                    tax_category: None,
                    is_qualified_invoice: false,
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
            sub_account_id: None,
            tax_category: None,
            is_qualified_invoice: false,
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
            allocation_percent: None,
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
    fn simple_expense_can_be_split_for_home_use_and_marks_invoices() {
        let db = set_up_db();
        let (bank, utilities, drawings) = {
            let conn = db.conn();
            // 課税事業者の年度にする（税区分とインボイスの印を残すため）
            conn.execute("UPDATE fiscal_years SET tax_status = 'standard'", [])
                .unwrap();
            conn.execute(
                "INSERT INTO partners (code, name_ja, is_vendor, invoice_registration_no) VALUES ('E1', '電力会社', 1, 'T1234567890123')",
                [],
            )
            .unwrap();
            (
                account(&conn, "104"),
                account(&conn, "603"),
                account(&conn, "199"),
            )
        };
        let partner = db.conn().last_insert_rowid();
        let mut input = simple(SimpleKind::Expense, Some(utilities), bank, 10_001);
        input.allocation_percent = Some(50);
        input.partner_id = Some(partner);
        let t = create_simple(&db, 2026, &input).unwrap();
        assert_eq!(
            t.lines
                .iter()
                .map(|l| (l.side, l.account_id, l.amount))
                .collect::<Vec<_>>(),
            [
                (Side::Debit, utilities, 5_000),
                (Side::Debit, drawings, 5_001),
                (Side::Credit, bank, 10_001)
            ]
        );
        // 経費の行は科目の既定の税区分とインボイスの印、家事分は対象外
        assert_eq!(
            t.lines[0].tax_category,
            Some(TaxCategory::TaxablePurchase10)
        );
        assert!(t.lines[0].is_qualified_invoice);
        assert_eq!(t.lines[1].tax_category, Some(TaxCategory::OutOfScope));
        assert!(!t.lines[1].is_qualified_invoice);

        input.allocation_percent = Some(101);
        assert_eq!(
            create_simple(&db, 2026, &input).unwrap_err(),
            AppError::field(ErrorCode::OutOfRange, "allocationPercent")
        );
    }

    #[test]
    fn exempt_years_store_out_of_scope() {
        let db = set_up_db();
        let (cash, supplies) = {
            let conn = db.conn();
            (account(&conn, "101"), account(&conn, "610"))
        };
        let mut input = entry("2026-03-01", supplies, cash, 100);
        input.lines[0].tax_category = Some(TaxCategory::TaxablePurchase8);
        input.lines[0].is_qualified_invoice = true;
        let t = create(&db, 2026, &input).unwrap();
        assert_eq!(t.lines[0].tax_category, Some(TaxCategory::OutOfScope));
        assert!(!t.lines[0].is_qualified_invoice);
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
    fn simple_personal_expense_and_unpaid_sale_use_non_payment_accounts() {
        let db = set_up_db();
        let (utilities, contributions, receivable, sales) = {
            let conn = db.conn();
            (
                account(&conn, "603"),
                account(&conn, "301"),
                account(&conn, "106"),
                account(&conn, "401"),
            )
        };
        let mut expense = simple(SimpleKind::PersonalExpense, Some(utilities), 0, 10_001);
        let full = create_simple(&db, 2026, &expense).unwrap();
        assert_eq!(full.lines[0].amount, 10_001);
        assert_eq!(full.lines[1].account_id, contributions);
        expense.allocation_percent = Some(50);
        let split = create_simple(&db, 2026, &expense).unwrap();
        assert_eq!(
            split
                .lines
                .iter()
                .map(|l| (l.side, l.account_id, l.amount))
                .collect::<Vec<_>>(),
            [
                (Side::Debit, utilities, 5_000),
                (Side::Credit, contributions, 5_000)
            ]
        );

        let unpaid = simple(SimpleKind::UnpaidIncome, Some(sales), 0, 11_000);
        let sale = create_simple(&db, 2026, &unpaid).unwrap();
        assert_eq!(
            sale.lines
                .iter()
                .map(|l| (l.side, l.account_id, l.amount))
                .collect::<Vec<_>>(),
            [
                (Side::Debit, receivable, 11_000),
                (Side::Credit, sales, 11_000)
            ]
        );
        assert_eq!(
            create_simple(
                &db,
                2026,
                &SimpleInput {
                    account_id: Some(utilities),
                    ..unpaid
                }
            )
            .unwrap_err(),
            AppError::field(ErrorCode::InvalidFormat, "accountId")
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
