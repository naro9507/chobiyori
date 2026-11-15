//! 集計（試算表・口座残高）。合計は SQL で科目ごとに出し、残高の計算は
//! `domain::balance` で行う。集計値は保存しない。

use crate::db::accounts;
use crate::domain::balance::{self, Movement, Totals, TrialBalance};
use crate::domain::journal::period_range;
use crate::error::AppResult;
use rusqlite::{params, Connection};
use std::collections::HashMap;

/// 年度 `year` の `from_month` 月から `to_month` 月までの合計残高試算表。
/// 繰越は年度の初めから `from_month` 月の前までの増減（フェーズ 7 で期首残高を足す）。
pub fn trial_balance(
    conn: &Connection,
    year: i64,
    from_month: u32,
    to_month: u32,
) -> AppResult<TrialBalance> {
    let (from, to) = period_range(year, from_month, to_month)?;

    let mut stmt = conn.prepare(
        "SELECT l.account_id,
                coalesce(sum(CASE WHEN t.date < ?2 AND l.side = 'debit' THEN l.amount END), 0),
                coalesce(sum(CASE WHEN t.date < ?2 AND l.side = 'credit' THEN l.amount END), 0),
                coalesce(sum(CASE WHEN t.date >= ?2 AND l.side = 'debit' THEN l.amount END), 0),
                coalesce(sum(CASE WHEN t.date >= ?2 AND l.side = 'credit' THEN l.amount END), 0)
         FROM journal_lines l
         JOIN transactions t ON t.id = l.transaction_id
         WHERE t.fiscal_year = ?1 AND t.date <= ?3
         GROUP BY l.account_id",
    )?;
    let sums: HashMap<i64, (Totals, Totals)> = stmt
        .query_map(params![year, from, to], |row| {
            Ok((
                row.get(0)?,
                (
                    Totals {
                        debit: row.get(1)?,
                        credit: row.get(2)?,
                    },
                    Totals {
                        debit: row.get(3)?,
                        credit: row.get(4)?,
                    },
                ),
            ))
        })?
        .collect::<Result<_, _>>()?;

    // 科目の並び順（区分の順・並び順）で並べる。無効にした科目も残高があれば出す
    let movements: Vec<Movement> = accounts::list(conn)?
        .into_iter()
        .map(|a| {
            let (before, period) = sums.get(&a.id).copied().unwrap_or_default();
            Movement {
                account_id: a.id,
                category: a.category,
                opening: 0,
                before,
                period,
            }
        })
        .collect();
    Ok(balance::trial_balance(&movements))
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use crate::db::setup::tests::set_up_db;
    use crate::db::transactions::tests::{account, entry};
    use crate::db::transactions::{create, create_simple};
    use crate::domain::journal::{
        EntryMode, LineInput, Side, SimpleInput, SimpleKind, TransactionInput,
    };
    use crate::error::{AppError, ErrorCode};

    /// 1 か月分（3 月）の帳簿をつける。2 月にも 1 件ある。
    pub(crate) fn books() -> crate::db::Database {
        let db = set_up_db();
        let conn = db.conn();
        let id = |code| account(&conn, code);
        let (cash, bank, sales, supplies, utilities, wages, withheld, communication) = (
            id("101"),
            id("104"),
            id("401"),
            id("610"),
            id("603"),
            id("613"),
            id("206"),
            id("605"),
        );
        drop(conn);
        let simple = |kind, date: &str, amount, account_id, payment| SimpleInput {
            allocation_percent: None,
            kind,
            date: date.into(),
            amount,
            account_id,
            payment_account_id: payment,
            partner_id: None,
            memo: String::new(),
        };
        // 2 月: 元手として私用のお金を入れる
        create_simple(
            &db,
            2026,
            &simple(
                SimpleKind::OwnerContribution,
                "2026-02-01",
                100_000,
                None,
                cash,
            ),
        )
        .unwrap();
        // 3 月
        create_simple(
            &db,
            2026,
            &simple(SimpleKind::Income, "2026-03-05", 300_000, Some(sales), bank),
        )
        .unwrap();
        create_simple(
            &db,
            2026,
            &simple(
                SimpleKind::Expense,
                "2026-03-06",
                1_200,
                Some(supplies),
                cash,
            ),
        )
        .unwrap();
        create_simple(
            &db,
            2026,
            &simple(SimpleKind::Transfer, "2026-03-10", 50_000, Some(cash), bank),
        )
        .unwrap();
        create(&db, 2026, &entry("2026-03-20", utilities, bank, 8_800)).unwrap();
        create(&db, 2026, &entry("2026-03-21", communication, cash, 3_300)).unwrap();
        create_simple(
            &db,
            2026,
            &simple(SimpleKind::OwnerDraw, "2026-03-25", 20_000, None, bank),
        )
        .unwrap();
        let line = |side, account_id, amount| LineInput {
            sub_account_id: None,
            tax_category: None,
            is_qualified_invoice: false,
            side,
            account_id,
            amount,
            partner_id: None,
            memo: String::new(),
        };
        create(
            &db,
            2026,
            &TransactionInput {
                date: "2026-03-31".into(),
                entry_mode: EntryMode::Compound,
                memo: "給料".into(),
                lines: vec![
                    line(Side::Debit, wages, 100_000),
                    line(Side::Credit, bank, 95_000),
                    line(Side::Credit, withheld, 5_000),
                ],
            },
        )
        .unwrap();
        db
    }

    fn row(tb: &TrialBalance, conn: &Connection, code: &str) -> (i64, i64, i64, i64) {
        let id = account(conn, code);
        let r = tb.rows.iter().find(|r| r.account_id == id).unwrap();
        (r.brought_forward, r.debit, r.credit, r.balance)
    }

    #[test]
    fn one_month_of_books_balances() {
        let db = books();
        let conn = db.conn();
        let tb = trial_balance(&conn, 2026, 3, 3).unwrap();
        assert!(tb.balanced);
        assert_eq!(tb.total_debit, tb.total_credit);
        assert_eq!(
            tb.total_debit,
            300_000 + 1_200 + 50_000 + 8_800 + 3_300 + 20_000 + 100_000
        );

        // 現金: 繰越 100,000 + 振替 50,000 − 消耗品 1,200 − 通信費 3,300
        assert_eq!(row(&tb, &conn, "101"), (100_000, 50_000, 4_500, 145_500));
        // 普通預金: 300,000 − 50,000 − 8,800 − 20,000 − 95,000
        assert_eq!(row(&tb, &conn, "104"), (0, 300_000, 173_800, 126_200));
        // 事業主借は 2 月の分が繰越になる
        assert_eq!(row(&tb, &conn, "301"), (100_000, 0, 0, 100_000));
        assert_eq!(row(&tb, &conn, "199"), (0, 20_000, 0, 20_000));
        assert_eq!(row(&tb, &conn, "206"), (0, 0, 5_000, 5_000));
        assert_eq!(tb.pre_tax_income, 300_000 - 1_200 - 8_800 - 3_300 - 100_000);
        // 動きのない科目は出さない
        assert!(tb
            .rows
            .iter()
            .all(|r| r.debit + r.credit + r.balance.abs() > 0));
    }

    #[test]
    fn period_covering_the_year_has_no_brought_forward() {
        let db = books();
        let conn = db.conn();
        let tb = trial_balance(&conn, 2026, 1, 12).unwrap();
        assert!(tb.balanced);
        assert!(tb.rows.iter().all(|r| r.brought_forward == 0));
        assert_eq!(row(&tb, &conn, "101"), (0, 150_000, 4_500, 145_500));
        // 2 月だけなら、3 月の取引は入らない
        let feb = trial_balance(&conn, 2026, 2, 2).unwrap();
        assert_eq!(feb.rows.len(), 2);
        assert_eq!(feb.total_debit, 100_000);
    }

    #[test]
    fn rejects_bad_periods() {
        let db = set_up_db();
        let conn = db.conn();
        assert_eq!(
            trial_balance(&conn, 2026, 4, 3).unwrap_err(),
            AppError::field(ErrorCode::OutOfRange, "toMonth")
        );
        assert_eq!(
            trial_balance(&conn, 2026, 0, 3).unwrap_err(),
            AppError::field(ErrorCode::OutOfRange, "month")
        );
        let empty = trial_balance(&conn, 2026, 1, 12).unwrap();
        assert!(empty.balanced && empty.rows.is_empty());
    }
}
