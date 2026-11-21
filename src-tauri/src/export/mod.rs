//! 帳簿の出力（CSV・PDF）。
//!
//! 帳簿のデータを `report` で表の形にし、`csv` と `pdf` で書き出す。
//! 帳簿のデータは `db::books`・`db::reports` から読み、ここでは計算しない。

pub mod csv;
pub mod document;
pub mod filing_calendar;
pub mod labels;
pub mod pdf;
pub mod report;

use crate::db::{accounts, books, partners, reports, setup, sub_accounts};
use chobiyori_core::error::{AppError, AppResult, ErrorCode};
use chobiyori_core::journal::period_range;
use labels::Locale;
use report::{Context, LedgerKind, Names, Report};
use rusqlite::Connection;
use serde::Deserialize;

/// 出力する帳簿。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum ExportTarget {
    Journal,
    Ledger {
        account_id: i64,
    },
    /// 動きのあるすべての科目の元帳
    AllLedgers,
    CashBook {
        account_id: i64,
    },
    ExpenseBook,
    SalesBook,
    TrialBalance,
    /// 青色申告決算書の金額一覧（いつも 1 年分）
    Statement,
    /// マスタ（CSV だけ）
    Accounts,
    Partners,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ExportFormat {
    Csv,
    Pdf,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportRequest {
    pub target: ExportTarget,
    pub format: ExportFormat,
    #[serde(default)]
    pub encoding: csv::Encoding,
    #[serde(default)]
    pub locale: Locale,
    pub fiscal_year: i64,
    pub from_month: u32,
    pub to_month: u32,
}

/// 出力するファイル。名前は保存先を選ぶ画面の初期値。
#[derive(Debug, Clone)]
pub struct ExportFile {
    pub name: String,
    pub bytes: Vec<u8>,
}

/// ファイル名に使えない文字を除く。
fn safe_file_name(name: &str) -> String {
    name.chars()
        .map(|c| {
            if matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|') {
                '_'
            } else {
                c
            }
        })
        .collect()
}

/// 出力するファイルを作る。DB からは読むだけ。
pub fn build(conn: &Connection, request: &ExportRequest) -> AppResult<ExportFile> {
    let locale = request.locale;
    let (year, from_month, to_month) = (request.fiscal_year, request.from_month, request.to_month);
    let (from, to) = period_range(year, from_month, to_month)?;
    let names = || -> AppResult<Names> {
        Ok(
            Names::new(accounts::list(conn)?, partners::list(conn)?, locale)
                .with_sub_accounts(sub_accounts::list(conn)?),
        )
    };
    let profile = setup::profile(conn)?;
    let ctx = Context {
        locale,
        business: if profile.trade_name.is_empty() {
            profile.owner_name
        } else {
            profile.trade_name
        },
        from,
        to,
        from_year_start: from_month == 1,
    };
    let period = format!("{year}_{from_month:02}-{to_month:02}");
    let ext = match request.format {
        ExportFormat::Csv => "csv",
        ExportFormat::Pdf => "pdf",
    };

    // マスタと仕訳の CSV は、帳票の形を通さずに書く
    let csv_only = |title: &labels::Text, text: AppResult<String>| -> AppResult<ExportFile> {
        if request.format != ExportFormat::Csv {
            return Err(AppError::field(ErrorCode::InvalidFormat, "format"));
        }
        Ok(ExportFile {
            name: format!("{}.{ext}", title.get(locale)),
            bytes: csv::encode(&text?, request.encoding)?,
        })
    };
    let report: Report = match request.target {
        ExportTarget::Accounts => {
            return csv_only(
                &labels::ACCOUNTS,
                csv::accounts(&accounts::list(conn)?, locale),
            )
        }
        ExportTarget::Partners => {
            return csv_only(
                &labels::PARTNERS,
                csv::partners(&partners::list(conn)?, locale),
            )
        }
        ExportTarget::Journal => {
            let book = books::journal(conn, year, from_month, to_month)?;
            if request.format == ExportFormat::Csv {
                return Ok(ExportFile {
                    name: format!("{}_{period}.{ext}", labels::JOURNAL.get(locale)),
                    bytes: csv::encode(&csv::journal(&book, &names()?, locale)?, request.encoding)?,
                });
            }
            report::journal(&book, &names()?, &ctx)
        }
        ExportTarget::Ledger { account_id } => {
            let ledger = books::ledger(conn, year, from_month, to_month, account_id)?;
            report::ledgers(LedgerKind::General, &[ledger], &names()?, &ctx)
        }
        ExportTarget::AllLedgers => report::ledgers(
            LedgerKind::General,
            &books::all_ledgers(conn, year, from_month, to_month)?,
            &names()?,
            &ctx,
        ),
        ExportTarget::CashBook { account_id } => {
            let ledger = books::ledger(conn, year, from_month, to_month, account_id)?;
            report::ledgers(LedgerKind::Cash, &[ledger], &names()?, &ctx)
        }
        ExportTarget::ExpenseBook => report::ledgers(
            LedgerKind::Expense,
            &books::expense_book(conn, year, from_month, to_month)?,
            &names()?,
            &ctx,
        ),
        ExportTarget::SalesBook => {
            let mut r = report::ledgers(
                LedgerKind::Expense,
                &books::sales_book(conn, year, from_month, to_month)?,
                &names()?,
                &ctx,
            );
            r.title = labels::SALES_BOOK.get(locale).to_string();
            r
        }
        ExportTarget::TrialBalance => report::trial_balance(
            &reports::trial_balance(conn, year, from_month, to_month)?,
            &names()?,
            &ctx,
        ),
        ExportTarget::Statement => report::statement(
            &crate::db::closing::statement(conn, year)?,
            &names()?,
            &Context {
                from: format!("{year:04}-01-01"),
                to: format!("{year:04}-12-31"),
                ..ctx.clone()
            },
        ),
    };

    // 1 つの科目の帳簿は、ファイル名に科目を入れる
    let subject = match request.target {
        ExportTarget::Ledger { .. } | ExportTarget::CashBook { .. } => report
            .sections
            .first()
            .and_then(|s| s.heading.clone())
            .map(|h| format!("_{h}"))
            .unwrap_or_default(),
        _ => String::new(),
    };
    let name = safe_file_name(&format!("{}{subject}_{period}.{ext}", report.title));
    let bytes = match request.format {
        ExportFormat::Csv => csv::encode(&csv::report(&report)?, request.encoding)?,
        ExportFormat::Pdf => pdf::render(&report, &pdf::find_font()?)?,
    };
    Ok(ExportFile { name, bytes })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::reports::tests::books as sample_books;
    use crate::db::transactions::tests::account;

    fn request(target: ExportTarget, format: ExportFormat) -> ExportRequest {
        ExportRequest {
            target,
            format,
            encoding: csv::Encoding::Utf8,
            locale: Locale::Ja,
            fiscal_year: 2026,
            from_month: 3,
            to_month: 3,
        }
    }

    fn text(file: &ExportFile) -> String {
        String::from_utf8(file.bytes[3..].to_vec()).unwrap()
    }

    #[test]
    fn request_reads_the_shape_sent_by_the_screen() {
        let r: ExportRequest = serde_json::from_value(serde_json::json!({
            "target": { "kind": "cashBook", "accountId": 3 },
            "format": "pdf",
            "encoding": "shiftJis",
            "locale": "en",
            "fiscalYear": 2026, "fromMonth": 1, "toMonth": 12
        }))
        .unwrap();
        assert_eq!(r.target, ExportTarget::CashBook { account_id: 3 });
        assert_eq!(
            (r.format, r.encoding, r.locale),
            (ExportFormat::Pdf, csv::Encoding::ShiftJis, Locale::En)
        );
    }

    #[test]
    fn cash_book_csv_has_carried_balance_running_balance_and_totals() {
        let db = sample_books();
        let conn = db.conn();
        let cash = account(&conn, "101");
        let file = build(
            &conn,
            &request(
                ExportTarget::CashBook { account_id: cash },
                ExportFormat::Csv,
            ),
        )
        .unwrap();
        assert_eq!(file.name, "出納帳_101 現金_2026_03-03.csv");
        let content = text(&file);
        let lines: Vec<&str> = content.lines().collect();
        assert_eq!(lines[0], "科目,日付,相手科目,摘要,入金,出金,残高");
        assert_eq!(lines[1], "101 現金,2026-03-01,,前月繰越,,,100000");
        assert_eq!(lines[2], "101 現金,2026-03-06,消耗品費,,,1200,98800");
        assert_eq!(*lines.last().unwrap(), "101 現金,合計,,,50000,4500,145500");
    }

    #[test]
    fn statement_csv_writes_each_section_with_its_own_columns() {
        let db = sample_books();
        let conn = db.conn();
        let file = build(&conn, &request(ExportTarget::Statement, ExportFormat::Csv)).unwrap();
        assert_eq!(file.name, "青色申告決算書の金額一覧_2026_03-03.csv");
        let content = text(&file);
        assert!(content.starts_with(
            "損益計算書\r\n番号,項目,金額\r\n①,売上（収入）金額（雑収入を含む）,300000\r\n"
        ));
        assert!(content.contains("\r\n貸借対照表\r\n項目,期首,期末\r\n"));
        assert!(content
            .contains("\r\n月別の売上（収入）金額と仕入金額\r\n月,売上（収入）金額,仕入金額\r\n"));
    }

    #[test]
    fn trial_balance_and_expense_book_csv() {
        let db = sample_books();
        let conn = db.conn();
        let tb = text(
            &build(
                &conn,
                &request(ExportTarget::TrialBalance, ExportFormat::Csv),
            )
            .unwrap(),
        );
        assert!(tb.starts_with("科目,繰越,借方,貸方,残高\r\n101 現金,100000,50000,4500,145500\r\n"));
        assert!(tb.contains("資産 合計,"));
        let expenses = text(
            &build(
                &conn,
                &request(ExportTarget::ExpenseBook, ExportFormat::Csv),
            )
            .unwrap(),
        );
        assert!(expenses.contains("603 水道光熱費,2026-03-20,普通預金,,8800,,8800"));
        assert!(expenses.contains("613 給料賃金,2026-03-31,諸口,給料,100000,,100000"));
    }

    #[test]
    fn masters_are_csv_only() {
        let db = sample_books();
        let conn = db.conn();
        let accounts =
            text(&build(&conn, &request(ExportTarget::Accounts, ExportFormat::Csv)).unwrap());
        assert!(accounts.contains("101,現金,Cash,げんきん,資産,はい,はい"));
        assert_eq!(
            build(&conn, &request(ExportTarget::Partners, ExportFormat::Pdf)).unwrap_err(),
            AppError::field(ErrorCode::InvalidFormat, "format")
        );
    }

    #[test]
    fn every_book_renders_as_pdf() {
        if pdf::tests::test_font().is_none() {
            return;
        }
        let db = sample_books();
        let conn = db.conn();
        let cash = account(&conn, "101");
        for target in [
            ExportTarget::Journal,
            ExportTarget::Ledger { account_id: cash },
            ExportTarget::AllLedgers,
            ExportTarget::CashBook { account_id: cash },
            ExportTarget::ExpenseBook,
            ExportTarget::TrialBalance,
            ExportTarget::Statement,
        ] {
            let file = build(&conn, &request(target, ExportFormat::Pdf)).unwrap();
            assert!(file.bytes.starts_with(b"%PDF-"), "{target:?}");
            assert!(file.name.ends_with(".pdf"));
        }
    }
}
