//! 定型仕訳（毎月の取引のひな形）の決まりごと。
//!
//! 毎月の定型仕訳は、候補を出しはじめる月から、年度のうち「いま」までの各月について、
//! まだ記録も見送りもしていない月を候補にする。確認なしに記録はしない（SPEC F2-5）。

use super::journal::days_in_month;
use super::string_enum;
use crate::error::{AppError, AppResult, ErrorCode};
use std::collections::HashSet;

string_enum! {
    /// 繰り返し。
    pub enum Recurrence {
        /// 繰り返さない。必要なときに呼び出して使う
        None => "none",
        /// 毎月
        Monthly => "monthly",
    }
}

/// `YYYY-MM` を読む。
pub fn parse_month(text: &str) -> AppResult<(i64, u32)> {
    let invalid = || AppError::field(ErrorCode::InvalidFormat, "startMonth");
    let (year, month) = text.trim().split_once('-').ok_or_else(invalid)?;
    let year: i64 = year.parse().map_err(|_| invalid())?;
    let month: u32 = month.parse().map_err(|_| invalid())?;
    if !(2000..=2100).contains(&year) || !(1..=12).contains(&month) {
        return Err(invalid());
    }
    Ok((year, month))
}

/// 決まった日（31 日など）が月にないときは、その月の末日にする。
pub fn date_in_month(year: i64, month: u32, day_of_month: u32) -> String {
    let day = day_of_month.clamp(1, days_in_month(year, month));
    format!("{year:04}-{month:02}-{day:02}")
}

/// 年度 `year` のうち、候補にする月（と、その月の日付）。
///
/// - `start` の月より前は出さない
/// - `upto_month` 月まで（今年なら今月、過去の年度なら 12 月）
/// - `done`（記録した月・見送った月）は出さない
pub fn due_months(
    start: (i64, u32),
    day_of_month: u32,
    year: i64,
    upto_month: u32,
    done: &HashSet<u32>,
) -> Vec<(u32, String)> {
    (1..=upto_month.min(12))
        .filter(|&m| (year, m) >= start)
        .filter(|m| !done.contains(m))
        .map(|m| (m, date_in_month(year, m, day_of_month)))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn months_from_the_start_up_to_now_that_are_not_done() {
        let done: HashSet<u32> = [4].into_iter().collect();
        let due = due_months((2026, 3), 25, 2026, 6, &done);
        assert_eq!(
            due,
            [
                (3, "2026-03-25".to_string()),
                (5, "2026-05-25".to_string()),
                (6, "2026-06-25".to_string())
            ]
        );
        // 前の年から始めた定型仕訳は、1 月から出す
        assert_eq!(due_months((2025, 11), 1, 2026, 2, &HashSet::new()).len(), 2);
        // まだ始まっていない年度には出さない
        assert!(due_months((2027, 1), 1, 2026, 12, &HashSet::new()).is_empty());
    }

    #[test]
    fn day_31_becomes_the_end_of_short_months() {
        assert_eq!(date_in_month(2026, 2, 31), "2026-02-28");
        assert_eq!(date_in_month(2028, 2, 30), "2028-02-29");
        assert_eq!(date_in_month(2026, 4, 31), "2026-04-30");
        assert_eq!(date_in_month(2026, 1, 31), "2026-01-31");
    }

    #[test]
    fn reads_start_months() {
        assert_eq!(parse_month("2026-04").unwrap(), (2026, 4));
        assert!(parse_month("2026-13").is_err());
        assert!(parse_month("2026/04").is_err());
    }
}
