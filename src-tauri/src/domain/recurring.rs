//! 定期売上（月謝・会費・顧問料など、毎月決まった売上）の予定と入金の突き合わせ。
//!
//! 予定額はプランから月ごとに決まる（開始月から終了月まで。「休み」にした月は予定なし）。
//! 入金と返金は、対象月を付けて記録した仕訳から集める。集計値は保存しない。

use serde::Serialize;

/// 月を `YYYY-MM` で書く。
pub fn month_key(year: i64, month: u32) -> String {
    format!("{year:04}-{month:02}")
}

/// `YYYY-MM` として正しいか。
pub fn valid_month(text: &str) -> bool {
    let b = text.as_bytes();
    b.len() == 7
        && b[4] == b'-'
        && text[..4].bytes().all(|c| c.is_ascii_digit())
        && text[5..]
            .parse::<u32>()
            .is_ok_and(|m| (1..=12).contains(&m))
}

/// プランの予定の材料。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PlanSchedule {
    pub amount: i64,
    /// 開始月（`YYYY-MM`）
    pub start_month: String,
    /// 終了月（`YYYY-MM`。この月まで予定がある）。空なら続く
    pub end_month: Option<String>,
    /// 休みにした月（`YYYY-MM`）
    pub skipped: Vec<String>,
}

impl PlanSchedule {
    /// その月の予定額。期間の外や休みの月は 0。
    pub fn scheduled(&self, month: &str) -> i64 {
        let started = self.start_month.as_str() <= month;
        let not_ended = self.end_month.as_deref().is_none_or(|end| month <= end);
        if started && not_ended && !self.skipped.iter().any(|m| m == month) {
            self.amount
        } else {
            0
        }
    }

    /// その月の予定の状態（入金を見る前）。
    pub fn month_kind(&self, month: &str) -> Option<PlanMonth> {
        if self.start_month.as_str() > month
            || self.end_month.as_deref().is_some_and(|end| month > end)
        {
            None
        } else if self.skipped.iter().any(|m| m == month) {
            Some(PlanMonth::Skipped)
        } else {
            Some(PlanMonth::Scheduled)
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PlanMonth {
    Scheduled,
    Skipped,
}

/// 月ごとの入金の状態。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum PaymentStatus {
    /// 予定の期間の外（予定も入金もない）
    OutOfPlan,
    /// 休みにした月
    Skipped,
    /// 予定があるのに、入金がない
    Unpaid,
    /// 入金が予定額に足りない
    Partial,
    /// 予定額まで入金した（多くても入金済み）
    Paid,
    /// 予定のない月に入金があった
    Unexpected,
}

/// 予定額・入金・返金から状態を決める。差引 = 入金 − 返金。
pub fn status(
    kind: Option<PlanMonth>,
    scheduled: i64,
    received: i64,
    refunded: i64,
) -> PaymentStatus {
    let net = received - refunded;
    match kind {
        None | Some(PlanMonth::Skipped) if net > 0 => PaymentStatus::Unexpected,
        None => PaymentStatus::OutOfPlan,
        Some(PlanMonth::Skipped) => PaymentStatus::Skipped,
        Some(PlanMonth::Scheduled) if net <= 0 => PaymentStatus::Unpaid,
        Some(PlanMonth::Scheduled) if net < scheduled => PaymentStatus::Partial,
        Some(PlanMonth::Scheduled) => PaymentStatus::Paid,
    }
}

/// 1 つのプランの 1 か月分。
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MonthCell {
    pub month: String,
    pub scheduled: i64,
    pub received: i64,
    pub refunded: i64,
    /// 入金 − 返金
    pub net: i64,
    /// 予定額 − 差引（足りない額。多く入金していればマイナス）
    pub shortfall: i64,
    pub status: PaymentStatus,
}

pub fn cell(schedule: &PlanSchedule, month: &str, received: i64, refunded: i64) -> MonthCell {
    let scheduled = schedule.scheduled(month);
    let net = received - refunded;
    MonthCell {
        month: month.to_string(),
        scheduled,
        received,
        refunded,
        net,
        shortfall: scheduled - net,
        status: status(schedule.month_kind(month), scheduled, received, refunded),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use PaymentStatus::*;

    fn plan() -> PlanSchedule {
        PlanSchedule {
            amount: 8_000,
            start_month: "2026-04".into(),
            end_month: Some("2026-09".into()),
            skipped: vec!["2026-08".into()],
        }
    }

    #[test]
    fn scheduled_amount_follows_the_period_and_skipped_months() {
        let p = plan();
        assert_eq!(p.scheduled("2026-03"), 0);
        assert_eq!(p.scheduled("2026-04"), 8_000);
        assert_eq!(p.scheduled("2026-08"), 0);
        assert_eq!(p.scheduled("2026-09"), 8_000);
        assert_eq!(p.scheduled("2026-10"), 0);
        let open = PlanSchedule {
            end_month: None,
            ..plan()
        };
        assert_eq!(open.scheduled("2030-01"), 8_000);
    }

    #[test]
    fn status_of_each_month() {
        let p = plan();
        assert_eq!(cell(&p, "2026-04", 0, 0).status, Unpaid);
        assert_eq!(cell(&p, "2026-04", 5_000, 0).status, Partial);
        let c = cell(&p, "2026-04", 5_000, 0);
        assert_eq!((c.net, c.shortfall), (5_000, 3_000));
        assert_eq!(cell(&p, "2026-04", 8_000, 0).status, Paid);
        assert_eq!(cell(&p, "2026-04", 9_000, 0).shortfall, -1_000);
        // 入金のあと全額を返金したら未入金に戻る
        assert_eq!(cell(&p, "2026-05", 8_000, 8_000).status, Unpaid);
        assert_eq!(cell(&p, "2026-08", 0, 0).status, Skipped);
        assert_eq!(cell(&p, "2026-08", 8_000, 0).status, Unexpected);
        assert_eq!(cell(&p, "2026-03", 0, 0).status, OutOfPlan);
        assert_eq!(cell(&p, "2026-12", 8_000, 0).status, Unexpected);
    }

    #[test]
    fn month_keys() {
        assert_eq!(month_key(2026, 3), "2026-03");
        assert!(valid_month("2026-12"));
        assert!(!valid_month("2026-13"));
        assert!(!valid_month("2026-3"));
        assert!(!valid_month("abcd-01"));
    }
}
