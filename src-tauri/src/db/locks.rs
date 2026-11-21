//! 月締めと年締め。
//!
//! 締めた月の取引は、どの入り口（仕訳の入力・受信箱の確定・定型仕訳・取込・決算の仕訳）からも
//! 追加・変更・削除できない。年締めは年度の `status = 'closed'`（それまでの `YearClosed`）。
//! 締めと、締めを外したことは変更履歴に残す。

use super::{audit, Database};
use crate::db::transactions::ensure_year_open;
use chobiyori_core::error::{AppError, AppResult, ErrorCode};
use chobiyori_core::journal::parse_date;
use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;

/// 日付 `date`（`YYYY-MM-DD`）の取引を書き換えてよいか。年度が締めてあれば `YearClosed`、
/// 月が締めてあれば `MonthLocked`。読めない日付は検証に任せる（ここでは通す）。
pub(crate) fn ensure_date_open(conn: &Connection, year: i64, date: &str) -> AppResult<()> {
    ensure_year_open(conn, year)?;
    let Some((_, month, _)) = parse_date(date.trim()) else {
        return Ok(());
    };
    let locked: bool = conn.query_row(
        "SELECT EXISTS (SELECT 1 FROM month_locks WHERE fiscal_year = ?1 AND month = ?2)",
        params![year, month],
        |r| r.get(0),
    )?;
    if locked {
        return Err(AppError::field(ErrorCode::MonthLocked, "date"));
    }
    Ok(())
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LockStatus {
    pub fiscal_year: i64,
    /// 締めた月（1〜12）
    pub locked_months: Vec<u32>,
    pub year_closed: bool,
}

pub fn status(conn: &Connection, year: i64) -> AppResult<LockStatus> {
    let closed: Option<bool> = conn
        .query_row(
            "SELECT status = 'closed' FROM fiscal_years WHERE year = ?1",
            [year],
            |r| r.get(0),
        )
        .optional()?;
    let Some(year_closed) = closed else {
        return Err(AppError::field(ErrorCode::NotFound, "fiscalYear"));
    };
    let mut stmt =
        conn.prepare("SELECT month FROM month_locks WHERE fiscal_year = ?1 ORDER BY month")?;
    let locked_months = stmt
        .query_map([year], |r| r.get(0))?
        .collect::<Result<_, _>>()?;
    Ok(LockStatus {
        fiscal_year: year,
        locked_months,
        year_closed,
    })
}

/// 月を締める・外す。締めるときは、その月までのすべての月をまとめて締める（前の月が開いたままに
/// ならないように）。外すときは、その月から後の月をまとめて外す。
pub fn set_month(db: &Database, year: i64, month: u32, locked: bool) -> AppResult<LockStatus> {
    if !(1..=12).contains(&month) {
        return Err(AppError::field(ErrorCode::OutOfRange, "month"));
    }
    db.transaction(|tx| {
        ensure_year_open(tx, year)?;
        if locked {
            for m in 1..=month {
                tx.execute(
                    "INSERT OR IGNORE INTO month_locks (fiscal_year, month) VALUES (?1, ?2)",
                    params![year, m],
                )?;
            }
        } else {
            tx.execute(
                "DELETE FROM month_locks WHERE fiscal_year = ?1 AND month >= ?2",
                params![year, month],
            )?;
        }
        audit::event(
            tx,
            "month_lock",
            if locked { "lock" } else { "unlock" },
            Some(year),
            Some(serde_json::json!({ "month": month })),
        )?;
        status(tx, year)
    })
}

/// 年度を締める・締めを外す。締めた年度はすべての月が書き換えられない。
pub fn set_year_closed(db: &Database, year: i64, closed: bool) -> AppResult<LockStatus> {
    db.transaction(|tx| {
        status(tx, year)?;
        tx.execute(
            "UPDATE fiscal_years
             SET status = CASE WHEN ?2 THEN 'closed' ELSE 'open' END,
                 closed_at = CASE WHEN ?2 THEN strftime('%Y-%m-%dT%H:%M:%SZ', 'now') END
             WHERE year = ?1",
            params![year, closed],
        )?;
        audit::event(
            tx,
            "fiscal_year",
            if closed { "close" } else { "reopen" },
            Some(year),
            None,
        )?;
        status(tx, year)
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::setup::tests::set_up_db;
    use crate::db::transactions::tests::{account, entry};
    use crate::db::transactions::{create, delete, update};

    #[test]
    fn locked_months_block_new_changed_and_deleted_entries() {
        let db = set_up_db();
        let (cash, supplies) = {
            let conn = db.conn();
            (account(&conn, "101"), account(&conn, "610"))
        };
        let march = create(&db, 2026, &entry("2026-03-10", supplies, cash, 1000)).unwrap();
        let s = set_month(&db, 2026, 3, true).unwrap();
        // 3 月を締めると 1〜3 月が締まる
        assert_eq!(s.locked_months, [1, 2, 3]);

        let locked = AppError::field(ErrorCode::MonthLocked, "date");
        assert_eq!(
            create(&db, 2026, &entry("2026-02-01", supplies, cash, 1)).unwrap_err(),
            locked
        );
        assert_eq!(
            update(&db, march.id, &entry("2026-03-10", supplies, cash, 2)).unwrap_err(),
            locked
        );
        // 開いている月へ動かすのも、締めた月から動かすことになるのでできない
        assert_eq!(
            update(&db, march.id, &entry("2026-04-10", supplies, cash, 2)).unwrap_err(),
            locked
        );
        assert_eq!(delete(&db, march.id).unwrap_err(), locked);
        // 4 月は書ける
        let april = create(&db, 2026, &entry("2026-04-01", supplies, cash, 1)).unwrap();
        // 開いた月から締めた月へは動かせない
        assert_eq!(
            update(&db, april.id, &entry("2026-03-31", supplies, cash, 1)).unwrap_err(),
            locked
        );

        // 2 月を外すと 2 月より後も外れる
        let s = set_month(&db, 2026, 2, false).unwrap();
        assert_eq!(s.locked_months, [1]);
        delete(&db, march.id).unwrap();
    }

    #[test]
    fn closed_years_block_everything_and_lock_changes_are_recorded() {
        let db = set_up_db();
        let (cash, supplies) = {
            let conn = db.conn();
            (account(&conn, "101"), account(&conn, "610"))
        };
        set_year_closed(&db, 2026, true).unwrap();
        assert_eq!(
            create(&db, 2026, &entry("2026-05-01", supplies, cash, 1))
                .unwrap_err()
                .code,
            ErrorCode::YearClosed
        );
        assert_eq!(
            set_month(&db, 2026, 5, true).unwrap_err().code,
            ErrorCode::YearClosed
        );
        let s = set_year_closed(&db, 2026, false).unwrap();
        assert!(!s.year_closed);
        create(&db, 2026, &entry("2026-05-01", supplies, cash, 1)).unwrap();

        let log = audit::list(&db.conn(), Some(2026), 1, audit::AuditFilters::default()).unwrap();
        let actions: Vec<(&str, &str)> = log
            .entries
            .iter()
            .map(|e| (e.entity.as_str(), e.action.as_str()))
            .collect();
        assert_eq!(
            actions,
            [
                ("transaction", "create"),
                ("fiscal_year", "reopen"),
                ("fiscal_year", "close")
            ]
        );
    }
}
