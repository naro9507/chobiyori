//! CSV の出力。文字コードは UTF-8（BOM 付き。Excel でそのまま開ける）か Shift_JIS。
//!
//! 仕訳の CSV は、取込で読み戻せる形（1 行 = 1 明細行）にする。他のソフトへの移行にも使う。
//! 帳簿と試算表の CSV は `report::Report` から作る。金額は区切りを入れない整数で書く。

use super::labels::{self as l, Locale};
use super::report::{Cell, Names, Report};
use chobiyori_core::error::{AppError, AppResult, ErrorCode};
use chobiyori_core::journal::Side;
use chobiyori_storage::accounts::Account;
use chobiyori_storage::books::JournalBook;
use chobiyori_storage::partners::Partner;
use serde::Deserialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Encoding {
    /// UTF-8（BOM 付き）
    #[default]
    Utf8,
    /// Shift_JIS（Windows の日本語。古い会計ソフトや Excel 向け）
    ShiftJis,
}

/// 文字列をファイルの中身にする。Shift_JIS で書けない文字（絵文字など）があれば、
/// 黙って置き換えずにエラーにする。
pub fn encode(text: &str, encoding: Encoding) -> AppResult<Vec<u8>> {
    match encoding {
        Encoding::Utf8 => {
            let mut bytes = Vec::with_capacity(text.len() + 3);
            bytes.extend_from_slice(b"\xEF\xBB\xBF");
            bytes.extend_from_slice(text.as_bytes());
            Ok(bytes)
        }
        Encoding::ShiftJis => {
            let (bytes, _, had_errors) = encoding_rs::SHIFT_JIS.encode(text);
            if had_errors {
                return Err(AppError::field(ErrorCode::Unencodable, "encoding"));
            }
            Ok(bytes.into_owned())
        }
    }
}

/// Excel などが数式として読む先頭の文字。
const FORMULA_STARTS: [char; 6] = ['=', '+', '-', '@', '\t', '\r'];

/// 表計算ソフトで開いたときに数式として動かないよう、先頭が `=` などの文字列に `'` を付ける。
/// 明細の店名など、外から来た文字列も書き出すため。整数（マイナスの金額）はそのまま。
fn neutralize(field: &str) -> String {
    if field.starts_with('\'')
        || (field.starts_with(FORMULA_STARTS) && field.parse::<i64>().is_err())
    {
        format!("'{field}")
    } else {
        field.to_string()
    }
}

/// `neutralize` で付けた `'` を外す。取込で、書き出したときの文字列に戻すために使う。
pub fn unneutralize(field: &str) -> &str {
    match field.strip_prefix('\'') {
        Some(rest) if rest.starts_with('\'') || rest.starts_with(FORMULA_STARTS) => rest,
        _ => field,
    }
}

fn write(records: impl IntoIterator<Item = Vec<String>>) -> AppResult<String> {
    let mut writer = csv::WriterBuilder::new()
        .terminator(csv::Terminator::CRLF)
        .flexible(true)
        .from_writer(Vec::new());
    for record in records {
        let record: Vec<String> = record.iter().map(|f| neutralize(f)).collect();
        writer
            .write_record(&record)
            .map_err(|_| AppError::new(ErrorCode::FileWrite))?;
    }
    let bytes = writer
        .into_inner()
        .map_err(|_| AppError::new(ErrorCode::FileWrite))?;
    String::from_utf8(bytes).map_err(|_| AppError::new(ErrorCode::FileWrite))
}

/// 仕訳の CSV の列。取込でも同じ並びを使う（見出しは日本語・英語のどちらでも読む）。
pub const JOURNAL_COLUMNS: [&l::Text; 13] = [
    &l::TRANSACTION_NO,
    &l::DATE,
    &l::SIDE,
    &l::ACCOUNT_CODE,
    &l::ACCOUNT_NAME,
    &l::AMOUNT,
    &l::PARTNER_CODE,
    &l::PARTNER_NAME,
    &l::LINE_MEMO,
    &l::TRANSACTION_MEMO,
    &l::SUB_ACCOUNT_CODE,
    &l::TAX_CATEGORY,
    &l::QUALIFIED_INVOICE,
];

/// 仕訳の CSV。取引番号は、ファイルの中で取引をまとめるための通し番号（1 から）。
pub fn journal(book: &JournalBook, names: &Names, locale: Locale) -> AppResult<String> {
    let header = JOURNAL_COLUMNS
        .iter()
        .map(|c| c.get(locale).to_string())
        .collect();
    let mut records = vec![header];
    for (index, t) in book.transactions.iter().enumerate() {
        for line in &t.lines {
            let side = match line.side {
                Side::Debit => l::DEBIT.get(locale),
                Side::Credit => l::CREDIT.get(locale),
            };
            let partner = line.partner_id.and_then(|id| names.partner(id));
            records.push(vec![
                (index + 1).to_string(),
                t.date.clone(),
                side.to_string(),
                names
                    .account(line.account_id)
                    .map(|a| a.code.clone())
                    .unwrap_or_default(),
                names.account_name(line.account_id),
                line.amount.to_string(),
                partner.map(|p| p.code.clone()).unwrap_or_default(),
                names.partner_name(line.partner_id),
                line.memo.clone(),
                t.memo.clone(),
                line.sub_account_id
                    .and_then(|id| names.sub_account(id))
                    .map(|s| s.code.clone())
                    .unwrap_or_default(),
                line.tax_category
                    .map(|c| l::tax_category(c, locale).to_string())
                    .unwrap_or_default(),
                if line.is_qualified_invoice {
                    l::YES.get(locale).to_string()
                } else {
                    String::new()
                },
            ]);
        }
    }
    write(records)
}

/// 帳簿・試算表の CSV。科目ごとの節がある帳簿は、先頭に科目の列を足す。
pub fn report(report: &Report) -> AppResult<String> {
    let labels = |s: &super::report::Section| {
        s.columns
            .iter()
            .map(|c| c.label.clone())
            .collect::<Vec<_>>()
    };
    // 節ごとに列が違う帳票（決算書の金額一覧など）は、節ごとに見出しと列名を書く
    if let Some(first) = report.sections.first() {
        if report.sections.iter().any(|s| labels(s) != labels(first)) {
            let mut records = Vec::new();
            for (i, section) in report.sections.iter().enumerate() {
                if i > 0 {
                    records.push(Vec::new());
                }
                if let Some(heading) = &section.heading {
                    records.push(vec![heading.clone()]);
                }
                records.push(labels(section));
                for row in &section.rows {
                    records.push(row.cells.iter().map(cell_text).collect());
                }
            }
            return write(records);
        }
    }
    let with_heading = report.sections.iter().any(|s| s.heading.is_some());
    let mut records = Vec::new();
    if let Some(first) = report.sections.first() {
        let mut header: Vec<String> = Vec::new();
        if with_heading {
            header.push(l::ACCOUNT.get(report.locale).to_string());
        }
        header.extend(first.columns.iter().map(|c| c.label.clone()));
        records.push(header);
    }
    for section in &report.sections {
        for row in &section.rows {
            let mut record: Vec<String> = Vec::new();
            if with_heading {
                record.push(section.heading.clone().unwrap_or_default());
            }
            record.extend(row.cells.iter().map(cell_text));
            records.push(record);
        }
    }
    write(records)
}

fn cell_text(cell: &Cell) -> String {
    match cell {
        Cell::Empty => String::new(),
        Cell::Text(text) | Cell::Date(text) => text.clone(),
        Cell::Amount(value) => value.to_string(),
    }
}

fn yes_no(value: bool, locale: Locale) -> String {
    if value { l::YES } else { l::NO }.get(locale).to_string()
}

pub fn accounts(accounts: &[Account], locale: Locale) -> AppResult<String> {
    let header = [
        &l::CODE,
        &l::NAME_JA,
        &l::NAME_EN,
        &l::KANA,
        &l::CATEGORY,
        &l::PAYMENT_ACCOUNT,
        &l::ACTIVE,
    ]
    .iter()
    .map(|t| t.get(locale).to_string())
    .collect();
    let rows = accounts.iter().map(|a| {
        vec![
            a.code.clone(),
            a.name_ja.clone(),
            a.name_en.clone(),
            a.kana.clone(),
            l::category(a.category, locale).to_string(),
            yes_no(a.is_payment_account, locale),
            yes_no(a.is_active, locale),
        ]
    });
    write(std::iter::once(header).chain(rows))
}

pub fn partners(partners: &[Partner], locale: Locale) -> AppResult<String> {
    let header = [
        &l::CODE,
        &l::NAME_JA,
        &l::NAME_EN,
        &l::KANA,
        &l::CUSTOMER,
        &l::VENDOR,
        &l::INVOICE_NO,
        &l::NOTE,
        &l::ACTIVE,
    ]
    .iter()
    .map(|t| t.get(locale).to_string())
    .collect();
    let rows = partners.iter().map(|p| {
        vec![
            p.code.clone(),
            p.name_ja.clone(),
            p.name_en.clone(),
            p.kana.clone(),
            yes_no(p.is_customer, locale),
            yes_no(p.is_vendor, locale),
            p.invoice_registration_no.clone().unwrap_or_default(),
            p.memo.clone(),
            yes_no(p.is_active, locale),
        ]
    });
    write(std::iter::once(header).chain(rows))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn utf8_starts_with_a_bom_so_excel_reads_japanese() {
        assert_eq!(
            encode("現金", Encoding::Utf8).unwrap()[..3],
            [0xEF, 0xBB, 0xBF]
        );
    }

    #[test]
    fn shift_jis_round_trips_japanese_and_rejects_emoji() {
        let bytes = encode("現金,消耗品費\r\n", Encoding::ShiftJis).unwrap();
        let (text, _, errors) = encoding_rs::SHIFT_JIS.decode(&bytes);
        assert!(!errors);
        assert_eq!(text, "現金,消耗品費\r\n");
        assert_eq!(
            encode("お茶🍵", Encoding::ShiftJis).unwrap_err(),
            AppError::field(ErrorCode::Unencodable, "encoding")
        );
    }

    #[test]
    fn fields_with_commas_and_quotes_are_quoted() {
        let text = write([vec![
            "a,b".to_string(),
            "\"x\"".to_string(),
            "c".to_string(),
        ]])
        .unwrap();
        assert_eq!(text, "\"a,b\",\"\"\"x\"\"\",c\r\n");
    }

    #[test]
    fn formulas_are_neutralized_but_negative_amounts_are_not() {
        let fields = [
            "=HYPERLINK(\"x\")",
            "+1+1",
            "-x",
            "@SUM(A1)",
            "-500",
            "0",
            "店",
        ];
        let text = write([fields.iter().map(|f| f.to_string()).collect()]).unwrap();
        assert_eq!(
            text,
            "\"'=HYPERLINK(\"\"x\"\")\",'+1+1,'-x,'@SUM(A1),-500,0,店\r\n"
        );
        for field in fields {
            assert_eq!(unneutralize(&neutralize(field)), field);
        }
        // 利用者が自分で ' を付けた文字列はそのまま
        assert_eq!(unneutralize("'abc"), "'abc");
    }
}
