use crate::db::{documents, filing, locks, received_bills, setup};
use crate::export::{
    filing_calendar,
    labels::{Locale, Text},
};
use chobiyori_core::error::{AppError, AppResult, ErrorCode};
use chobiyori_core::{document::DocumentKind, filing::add_days, journal};
use rusqlite::{Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

const OPTIONS_KEY: &str = "filing_calendar_options";

#[derive(Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct CalendarOptions {
    pub invoice_due: bool,
    pub estimate_expiry: bool,
    pub monthly_close: bool,
    pub monthly_close_day: u32,
    pub received_bill_due: bool,
}

impl Default for CalendarOptions {
    fn default() -> Self {
        Self {
            invoice_due: false,
            estimate_expiry: false,
            monthly_close: false,
            monthly_close_day: 10,
            received_bill_due: false,
        }
    }
}

pub fn options(conn: &Connection) -> AppResult<CalendarOptions> {
    let json: Option<String> = conn
        .query_row(
            "SELECT value FROM settings WHERE key = ?1",
            [OPTIONS_KEY],
            |row| row.get(0),
        )
        .optional()?;
    match json {
        Some(json) => serde_json::from_str(&json).map_err(|_| AppError::new(ErrorCode::Database)),
        None => Ok(CalendarOptions::default()),
    }
}

pub fn save_options(conn: &Connection, options: &CalendarOptions) -> AppResult<()> {
    if !(1..=31).contains(&options.monthly_close_day) {
        return Err(AppError::field(ErrorCode::OutOfRange, "monthlyCloseDay"));
    }
    let json = serde_json::to_string(options).map_err(|_| AppError::new(ErrorCode::Database))?;
    conn.execute(
        "INSERT INTO settings (key, value) VALUES (?1, ?2)
         ON CONFLICT (key) DO UPDATE SET value = excluded.value",
        (OPTIONS_KEY, json),
    )?;
    Ok(())
}

#[derive(Serialize)]
pub struct Deadline {
    pub key: String,
    pub title: String,
    pub date: String,
    pub end: String,
}

impl Deadline {
    fn new(key: String, title: String, date: String) -> AppResult<Self> {
        let end = add_days(&date, 1).ok_or_else(super::failed)?;
        Ok(Self {
            key,
            title,
            date,
            end,
        })
    }
}

pub fn build(conn: &Connection, today: &str, locale: Locale) -> AppResult<Vec<Deadline>> {
    let config = options(conn)?;
    let mut deadlines = Vec::new();
    for notice in filing::upcoming_deadlines(conn, today)? {
        if !notice.submitted && notice.days_left >= 0 {
            let (kind, label) = filing_calendar::event_label(&notice, locale);
            deadlines.push(Deadline::new(
                format!("{kind}-{}", notice.fiscal_year),
                format!("{label} ({})", notice.fiscal_year),
                notice.date,
            )?);
        }
    }
    if config.invoice_due {
        let dates = documents::upcoming_dates(conn, DocumentKind::Invoice, today)?;
        append(
            &mut deadlines,
            "invoice",
            dates,
            Text {
                ja: "請求書の入金期限",
                en: "Invoice payment expected",
            }
            .get(locale),
        )?;
    }
    if config.estimate_expiry {
        let dates = documents::upcoming_dates(conn, DocumentKind::Estimate, today)?;
        append(
            &mut deadlines,
            "estimate",
            dates,
            Text {
                ja: "見積書の有効期限",
                en: "Estimate expiration",
            }
            .get(locale),
        )?;
    }
    if config.monthly_close {
        for year in setup::fiscal_years(conn)?
            .into_iter()
            .filter(|year| !year.closed)
        {
            let status = locks::status(conn, year.year)?;
            for month in 1..=12 {
                let date = close_date(year.year, month, config.monthly_close_day);
                if date.as_str() < today || status.locked_months.contains(&month) {
                    continue;
                }
                let title = match locale {
                    Locale::Ja => format!("{}年{month}月分の月締め", year.year),
                    Locale::En => format!("Monthly close ({:04}-{month:02})", year.year),
                };
                deadlines.push(Deadline::new(
                    format!("close-{}-{month:02}", year.year),
                    title,
                    date,
                )?);
            }
        }
    }
    if config.received_bill_due {
        let dates = received_bills::upcoming(conn, today)?;
        append(
            &mut deadlines,
            "bill",
            dates,
            Text {
                ja: "受け取った請求書の支払期限",
                en: "Received bill payment due",
            }
            .get(locale),
        )?;
    }
    Ok(deadlines)
}

fn append(
    deadlines: &mut Vec<Deadline>,
    kind: &str,
    dates: Vec<(i64, String)>,
    label: &str,
) -> AppResult<()> {
    for (id, date) in dates {
        deadlines.push(Deadline::new(
            format!("{kind}-{id}"),
            label.to_owned(),
            date,
        )?);
    }
    Ok(())
}

fn close_date(year: i64, month: u32, day: u32) -> String {
    let (year, month) = if month == 12 {
        (year + 1, 1)
    } else {
        (year, month + 1)
    };
    let day = day.min(journal::days_in_month(year, month));
    format!("{year:04}-{month:02}-{day:02}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn closing_reminders_are_opt_in_and_follow_month_locks() {
        let db = setup::tests::set_up_db();
        let deadline = || {
            build(&db.conn(), "2026-11-15", Locale::Ja)
                .unwrap()
                .into_iter()
                .find(|event| event.key == "close-2026-11")
        };
        assert!(deadline().is_none());
        save_options(
            &db.conn(),
            &CalendarOptions {
                monthly_close: true,
                ..CalendarOptions::default()
            },
        )
        .unwrap();
        assert_eq!(deadline().unwrap().date, "2026-12-10");
        locks::set_month(&db, 2026, 11, true).unwrap();
        assert!(deadline().is_none());
        locks::set_month(&db, 2026, 11, false).unwrap();
        assert!(deadline().is_some());
    }

    #[test]
    fn closing_uses_next_month_and_its_last_day_when_needed() {
        assert_eq!(close_date(2027, 12, 10), "2028-01-10");
        assert_eq!(close_date(2028, 1, 31), "2028-02-29");
        assert_eq!(close_date(2029, 1, 30), "2029-02-28");
    }
}
