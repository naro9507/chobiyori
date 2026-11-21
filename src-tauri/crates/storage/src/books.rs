//! 帳簿（仕訳帳・総勘定元帳・現金出納帳 / 預金出納帳・経費帳）の読み出し。
//!
//! どの帳簿も、保存してある仕訳から毎回作る。残高の計算は `chobiyori_core::ledger` で行う。
//! 繰越は、期首残高と、年度の初めから期間の前までの増減。

use crate::accounts::{self, Account};
use crate::transactions::{self, Transaction};
use chobiyori_core::balance::{signed, Totals};
use chobiyori_core::error::{AppError, AppResult, ErrorCode};
use chobiyori_core::journal::{period_range, Side};
use chobiyori_core::ledger::{self, Ledger, LedgerEntry};
use chobiyori_core::master::AccountCategory;
use rusqlite::{params, Connection};
use serde::Serialize;
use std::collections::HashMap;

/// 仕訳帳。期間の取引を日付の順に並べたもの。
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JournalBook {
    pub transactions: Vec<Transaction>,
    pub total_debit: i64,
    pub total_credit: i64,
}

pub fn journal(
    conn: &Connection,
    year: i64,
    from_month: u32,
    to_month: u32,
) -> AppResult<JournalBook> {
    let (from, to) = period_range(year, from_month, to_month)?;
    let transactions = transactions::list_between(conn, year, &from, &to)?;
    let total = |side: Side| -> i64 {
        transactions
            .iter()
            .flat_map(|t| &t.lines)
            .filter(|l| l.side == side)
            .map(|l| l.amount)
            .sum()
    };
    Ok(JournalBook {
        total_debit: total(Side::Debit),
        total_credit: total(Side::Credit),
        transactions,
    })
}

/// 1 つの科目の元帳。現金出納帳・預金出納帳も、口座の科目の元帳として作る。
pub fn ledger(
    conn: &Connection,
    year: i64,
    from_month: u32,
    to_month: u32,
    account_id: i64,
) -> AppResult<Ledger> {
    let account = accounts::get(conn, account_id)
        .map_err(|_| AppError::field(ErrorCode::NotFound, "accountId"))?;
    ledgers_for(conn, year, from_month, to_month, &[account])?
        .pop()
        .ok_or(AppError::new(ErrorCode::NotFound))
}

/// 経費帳。経費の科目ごとの元帳（動きのない科目は除く）。
pub fn expense_book(
    conn: &Connection,
    year: i64,
    from_month: u32,
    to_month: u32,
) -> AppResult<Vec<Ledger>> {
    let expenses: Vec<Account> = accounts::list(conn)?
        .into_iter()
        .filter(|a| a.category == AccountCategory::Expense)
        .collect();
    non_empty(ledgers_for(conn, year, from_month, to_month, &expenses)?)
}

/// 売上帳。売上高の科目ごとの元帳。
pub fn sales_book(
    conn: &Connection,
    year: i64,
    from_month: u32,
    to_month: u32,
) -> AppResult<Vec<Ledger>> {
    let sales: Vec<Account> = accounts::list(conn)?
        .into_iter()
        .filter(|a| a.statement_line.as_deref() == Some("pl.sales"))
        .collect();
    non_empty(ledgers_for(conn, year, from_month, to_month, &sales)?)
}

/// すべての科目の元帳（動きのない科目は除く）。総勘定元帳をまとめて出力するときに使う。
pub fn all_ledgers(
    conn: &Connection,
    year: i64,
    from_month: u32,
    to_month: u32,
) -> AppResult<Vec<Ledger>> {
    non_empty(ledgers_for(
        conn,
        year,
        from_month,
        to_month,
        &accounts::list(conn)?,
    )?)
}

fn non_empty(ledgers: Vec<Ledger>) -> AppResult<Vec<Ledger>> {
    Ok(ledgers.into_iter().filter(|l| !l.is_empty()).collect())
}

/// 取引先ごとの元帳（売掛帳・買掛帳）。
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PartnerLedger {
    /// 取引先。空は取引先を付けていない行と期首残高（取引先ごとの期首残高はまだ持たない）
    pub partner_id: Option<i64>,
    pub ledger: Ledger,
}

/// 売掛帳・買掛帳。科目 `account_id` の明細行を取引先ごとに分け、それぞれの残高を出す。
/// 取引先の並び順で、取引先のない分は最後。動きのない取引先は出さない。
pub fn partner_ledgers(
    conn: &Connection,
    year: i64,
    from_month: u32,
    to_month: u32,
    account_id: i64,
) -> AppResult<Vec<PartnerLedger>> {
    let account = accounts::get(conn, account_id)
        .map_err(|_| AppError::field(ErrorCode::NotFound, "accountId"))?;
    let (from, to) = period_range(year, from_month, to_month)?;
    let opening = crate::closing::opening_map(conn, year)?
        .get(&account_id)
        .copied()
        .unwrap_or(0);

    let mut stmt = conn.prepare(
        "SELECT l.partner_id,
                coalesce(sum(CASE WHEN l.side = 'debit' THEN l.amount END), 0),
                coalesce(sum(CASE WHEN l.side = 'credit' THEN l.amount END), 0)
         FROM journal_lines l
         JOIN transactions t ON t.id = l.transaction_id
         WHERE t.fiscal_year = ?1 AND t.date < ?2 AND l.account_id = ?3
         GROUP BY l.partner_id",
    )?;
    let before: HashMap<Option<i64>, Totals> = stmt
        .query_map(params![year, from, account_id], |row| {
            Ok((
                row.get(0)?,
                Totals {
                    debit: row.get(1)?,
                    credit: row.get(2)?,
                },
            ))
        })?
        .collect::<Result<_, _>>()?;

    let mut entries: HashMap<Option<i64>, Vec<LedgerEntry>> = HashMap::new();
    for t in transactions::list_between(conn, year, &from, &to)? {
        let sides: Vec<(Side, i64)> = t.lines.iter().map(|l| (l.side, l.account_id)).collect();
        for line in t.lines.iter().filter(|l| l.account_id == account_id) {
            entries
                .entry(line.partner_id)
                .or_default()
                .push(LedgerEntry {
                    transaction_id: t.id,
                    date: t.date.clone(),
                    side: line.side,
                    amount: line.amount,
                    counter_account_id: ledger::counter_account(&sides, line.side),
                    partner_id: line.partner_id,
                    memo: if line.memo.is_empty() {
                        t.memo.clone()
                    } else {
                        line.memo.clone()
                    },
                });
        }
    }

    let mut keys: Vec<Option<i64>> = crate::partners::list(conn)?
        .into_iter()
        .map(|p| Some(p.id))
        .collect();
    keys.push(None);
    Ok(keys
        .into_iter()
        .map(|partner_id| {
            let start = if partner_id.is_none() { opening } else { 0 };
            let brought_forward = start
                + signed(
                    account.category,
                    before.get(&partner_id).copied().unwrap_or_default(),
                );
            PartnerLedger {
                partner_id,
                ledger: ledger::ledger(
                    account_id,
                    account.category,
                    brought_forward,
                    entries.remove(&partner_id).unwrap_or_default(),
                ),
            }
        })
        .filter(|p| !p.ledger.is_empty())
        .collect())
}

/// `accounts` の元帳を、渡した順に作る。取引は 1 回だけ読む。
fn ledgers_for(
    conn: &Connection,
    year: i64,
    from_month: u32,
    to_month: u32,
    accounts: &[Account],
) -> AppResult<Vec<Ledger>> {
    let (from, to) = period_range(year, from_month, to_month)?;

    // 繰越 = 期首残高 + 年度の初めから期間の前までの増減
    let opening = crate::closing::opening_map(conn, year)?;
    let mut stmt = conn.prepare(
        "SELECT l.account_id,
                coalesce(sum(CASE WHEN l.side = 'debit' THEN l.amount END), 0),
                coalesce(sum(CASE WHEN l.side = 'credit' THEN l.amount END), 0)
         FROM journal_lines l
         JOIN transactions t ON t.id = l.transaction_id
         WHERE t.fiscal_year = ?1 AND t.date < ?2
         GROUP BY l.account_id",
    )?;
    let before: HashMap<i64, Totals> = stmt
        .query_map(params![year, from], |row| {
            Ok((
                row.get(0)?,
                Totals {
                    debit: row.get(1)?,
                    credit: row.get(2)?,
                },
            ))
        })?
        .collect::<Result<_, _>>()?;

    let mut entries: HashMap<i64, Vec<LedgerEntry>> =
        accounts.iter().map(|a| (a.id, Vec::new())).collect();
    for t in transactions::list_between(conn, year, &from, &to)? {
        let sides: Vec<(Side, i64)> = t.lines.iter().map(|l| (l.side, l.account_id)).collect();
        for line in &t.lines {
            if let Some(list) = entries.get_mut(&line.account_id) {
                list.push(LedgerEntry {
                    transaction_id: t.id,
                    date: t.date.clone(),
                    side: line.side,
                    amount: line.amount,
                    counter_account_id: ledger::counter_account(&sides, line.side),
                    partner_id: line.partner_id,
                    // 明細のメモがなければ、取引のメモ（摘要）を載せる
                    memo: if line.memo.is_empty() {
                        t.memo.clone()
                    } else {
                        line.memo.clone()
                    },
                });
            }
        }
    }

    Ok(accounts
        .iter()
        .map(|a| {
            let brought_forward = opening.get(&a.id).copied().unwrap_or(0)
                + signed(a.category, before.get(&a.id).copied().unwrap_or_default());
            ledger::ledger(
                a.id,
                a.category,
                brought_forward,
                entries.remove(&a.id).unwrap_or_default(),
            )
        })
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::reports::trial_balance;
    use crate::test_support::account;
    use crate::test_support::books;

    #[test]
    fn journal_lists_the_period_with_totals() {
        let db = books();
        let conn = db.conn();
        let march = journal(&conn, 2026, 3, 3).unwrap();
        assert_eq!(march.transactions.len(), 7);
        assert!(march
            .transactions
            .windows(2)
            .all(|w| w[0].date <= w[1].date));
        assert_eq!(march.total_debit, march.total_credit);
        assert_eq!(
            march.total_debit,
            300_000 + 1_200 + 50_000 + 8_800 + 3_300 + 20_000 + 100_000
        );
        let year = journal(&conn, 2026, 1, 12).unwrap();
        assert_eq!(year.transactions.len(), 8);
        assert_eq!(
            journal(&conn, 2026, 4, 3).unwrap_err(),
            AppError::field(ErrorCode::OutOfRange, "toMonth")
        );
    }

    #[test]
    fn cash_book_carries_february_into_march() {
        let db = books();
        let conn = db.conn();
        let cash = account(&conn, "101");
        let l = ledger(&conn, 2026, 3, 3, cash).unwrap();
        assert_eq!(l.brought_forward, 100_000);
        // 消耗品 −1,200（6 日）、振替 +50,000（10 日）、通信費 −3,300（21 日）
        assert_eq!(
            l.rows
                .iter()
                .map(|r| (r.debit, r.credit, r.balance))
                .collect::<Vec<_>>(),
            [
                (0, 1_200, 98_800),
                (50_000, 0, 148_800),
                (0, 3_300, 145_500)
            ]
        );
        assert_eq!(l.rows[0].counter_account_id, Some(account(&conn, "610")));
        assert_eq!(l.closing_balance, 145_500);
    }

    #[test]
    fn compound_entries_show_sundry_as_the_counter_account() {
        let db = books();
        let conn = db.conn();
        let wages = ledger(&conn, 2026, 1, 12, account(&conn, "613")).unwrap();
        // 給料 / 普通預金・預り金 → 相手は諸口
        assert_eq!(wages.rows.len(), 1);
        assert_eq!(wages.rows[0].counter_account_id, None);
        assert_eq!(wages.rows[0].memo, "給料");
        let withheld = ledger(&conn, 2026, 1, 12, account(&conn, "206")).unwrap();
        assert_eq!(
            withheld.rows[0].counter_account_id,
            Some(account(&conn, "613"))
        );
    }

    #[test]
    fn ledgers_agree_with_the_trial_balance() {
        let db = books();
        let conn = db.conn();
        let tb = trial_balance(&conn, 2026, 3, 3).unwrap();
        let ledgers = all_ledgers(&conn, 2026, 3, 3).unwrap();
        assert_eq!(ledgers.len(), tb.rows.len());
        for row in &tb.rows {
            let l = ledgers
                .iter()
                .find(|l| l.account_id == row.account_id)
                .unwrap();
            assert_eq!(
                (
                    l.brought_forward,
                    l.total_debit,
                    l.total_credit,
                    l.closing_balance
                ),
                (row.brought_forward, row.debit, row.credit, row.balance)
            );
        }
    }

    #[test]
    fn expense_book_has_only_expense_accounts_with_movement() {
        let db = books();
        let conn = db.conn();
        let book = expense_book(&conn, 2026, 1, 12).unwrap();
        let codes: Vec<String> = book
            .iter()
            .map(|l| accounts::get(&conn, l.account_id).unwrap().code)
            .collect();
        assert_eq!(codes, ["603", "605", "610", "613"]);
        assert!(book.iter().all(|l| l.category == AccountCategory::Expense));
        // 2 月だけなら経費はない
        assert!(expense_book(&conn, 2026, 2, 2).unwrap().is_empty());
    }

    #[test]
    fn unknown_account() {
        let db = books();
        assert_eq!(
            ledger(&db.conn(), 2026, 1, 12, 9_999).unwrap_err(),
            AppError::field(ErrorCode::NotFound, "accountId")
        );
    }

    #[test]
    fn receivables_are_split_by_partner() {
        let db = crate::test_support::set_up_db();
        let (bank, sales, ar) = {
            let conn = db.conn();
            (
                account(&conn, "104"),
                account(&conn, "401"),
                account(&conn, "106"),
            )
        };
        let (a, b) = {
            let conn = db.conn();
            conn.execute_batch(
                "INSERT INTO partners (code, name_ja, is_customer) VALUES ('1', 'A社', 1), ('2', 'B社', 1);",
            )
            .unwrap();
            (
                conn.query_row("SELECT id FROM partners WHERE code = '1'", [], |r| {
                    r.get::<_, i64>(0)
                })
                .unwrap(),
                conn.query_row("SELECT id FROM partners WHERE code = '2'", [], |r| {
                    r.get::<_, i64>(0)
                })
                .unwrap(),
            )
        };
        let with_partner = |date: &str, debit, credit, amount, partner| {
            let mut e = crate::test_support::entry(date, debit, credit, amount);
            for l in &mut e.lines {
                l.partner_id = Some(partner);
            }
            e
        };
        transactions::create(&db, 2026, &with_partner("2026-02-28", ar, sales, 50_000, a)).unwrap();
        transactions::create(&db, 2026, &with_partner("2026-03-31", ar, sales, 30_000, b)).unwrap();
        transactions::create(&db, 2026, &with_partner("2026-03-31", ar, sales, 20_000, a)).unwrap();
        transactions::create(&db, 2026, &with_partner("2026-04-10", bank, ar, 45_000, a)).unwrap();

        let conn = db.conn();
        let book = partner_ledgers(&conn, 2026, 3, 4, ar).unwrap();
        assert_eq!(
            book.iter().map(|p| p.partner_id).collect::<Vec<_>>(),
            [Some(a), Some(b)]
        );
        let la = &book[0].ledger;
        // A: 2 月の 50,000 が繰越、3 月 +20,000、4 月 −45,000 → 25,000 が未回収
        assert_eq!(
            (
                la.brought_forward,
                la.total_debit,
                la.total_credit,
                la.closing_balance
            ),
            (50_000, 20_000, 45_000, 25_000)
        );
        assert_eq!(book[1].ledger.closing_balance, 30_000);
        // 取引先ごとの残高の合計は、売掛金の残高と一致する
        let total: i64 = book.iter().map(|p| p.ledger.closing_balance).sum();
        assert_eq!(
            total,
            ledger(&conn, 2026, 3, 4, ar).unwrap().closing_balance
        );
    }
}
