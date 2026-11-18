//! 未提出の申告期限を終日の iCalendar 予定にする。

use super::labels::{Locale, Text};
use crate::db::filing::DeadlineNotice;
use crate::domain::filing::DeadlineKind;

const INCOME: Text = Text {
    ja: "確定申告の期限",
    en: "Income tax filing deadline",
};
const CONSUMPTION: Text = Text {
    ja: "消費税の申告期限",
    en: "Consumption tax filing deadline",
};
const ESTIMATED: Text = Text {
    ja: "（目安）",
    en: " (estimated)",
};

/// 固定の見出しと申告期限だけを書く。予定は現地の日付に従う終日予定。
pub fn build(deadlines: &[DeadlineNotice], locale: Locale, stamp: &str) -> Option<String> {
    let mut entries = deadlines
        .iter()
        .filter(|notice| !notice.submitted && notice.days_left >= 0)
        .peekable();
    entries.peek()?;

    let mut calendar = String::from(
        "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Chobiyori//Filing deadlines//EN\r\n",
    );
    for notice in entries {
        let (kind, label) = match notice.kind {
            DeadlineKind::Income => ("income", INCOME),
            DeadlineKind::Consumption => ("consumption", CONSUMPTION),
        };
        let date = notice.date.replace('-', "");
        let estimated = if notice.estimated {
            ESTIMATED.get(locale)
        } else {
            ""
        };
        // 固定の見出しなのでエスケープすべき文字を含まず、UTF-8 で 75 バイト以内。
        calendar.push_str(&format!(
            "BEGIN:VEVENT\r\nUID:{kind}-{}@chobiyori.jp.dcs.accounting\r\nDTSTAMP:{stamp}\r\nDTSTART;VALUE=DATE:{date}\r\nSUMMARY:{}{estimated}\r\nEND:VEVENT\r\n",
            notice.fiscal_year,
            label.get(locale),
        ));
    }
    calendar.push_str("END:VCALENDAR\r\n");
    Some(calendar)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn calendar_contains_only_upcoming_unsubmitted_all_day_events() {
        let notice = |kind, date: &str, days_left, submitted, estimated| DeadlineNotice {
            kind,
            fiscal_year: 2026,
            date: date.into(),
            estimated,
            days_left,
            submitted,
            done: 0,
            total: 1,
        };
        let deadlines = [
            notice(DeadlineKind::Income, "2027-03-15", 0, false, false),
            notice(DeadlineKind::Consumption, "2027-03-31", 16, false, true),
            notice(DeadlineKind::Income, "2027-03-14", -1, false, false),
            notice(DeadlineKind::Consumption, "2027-04-01", 17, true, false),
        ];
        let stamp = "20270315T010203Z";
        let calendar = build(&deadlines, Locale::Ja, stamp).unwrap();
        let lines: Vec<_> = calendar.split_terminator("\r\n").collect();
        assert!(lines.iter().all(|line| line.len() <= 75));
        assert_eq!(lines.first(), Some(&"BEGIN:VCALENDAR"));
        assert_eq!(lines.last(), Some(&"END:VCALENDAR"));
        assert_eq!(
            lines.iter().filter(|line| **line == "BEGIN:VEVENT").count(),
            2
        );
        assert!(lines.contains(&"DTSTAMP:20270315T010203Z"));
        assert!(lines.contains(&"DTSTART;VALUE=DATE:20270315"));
        assert!(lines.contains(&"DTSTART;VALUE=DATE:20270331"));
        assert!(lines.contains(&"SUMMARY:確定申告の期限"));
        assert!(lines.contains(&"SUMMARY:消費税の申告期限（目安）"));
        assert!(lines.contains(&"UID:income-2026@chobiyori.jp.dcs.accounting"));
        assert!(!calendar.contains("VALARM"));
        assert!(build(&deadlines[2..], Locale::En, stamp).is_none());
    }
}
