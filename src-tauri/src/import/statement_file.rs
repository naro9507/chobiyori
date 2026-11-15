//! 明細のファイル（CSV・TSV・Excel）を「文字列の表」にする。読み方は `domain::statement`。

use crate::db::formats::ImportFormat;
use crate::domain::statement::{
    self, Delimiter, FormatDefinition, HeaderDiff, Statement, TextEncoding,
};
use crate::error::{AppError, AppResult, ErrorCode};
use calamine::{Data, Reader};
use std::io::Cursor;

/// 表に読む行の上限。カードの明細なら 1 年分でも数千行
const ROWS_MAX: usize = 100_000;

/// Excel のファイルか（拡張子で決める）。
pub fn is_excel(file_name: &str) -> bool {
    let lower = file_name.to_lowercase();
    [".xlsx", ".xlsm", ".xls"]
        .iter()
        .any(|ext| lower.ends_with(ext))
}

/// 文字コードを推し量る。BOM があるか、UTF-8 として読めれば UTF-8、それ以外は Shift_JIS。
pub fn guess_encoding(bytes: &[u8]) -> TextEncoding {
    if bytes.starts_with(b"\xEF\xBB\xBF") || std::str::from_utf8(bytes).is_ok() {
        TextEncoding::Utf8
    } else {
        TextEncoding::ShiftJis
    }
}

pub fn decode(bytes: &[u8], encoding: TextEncoding) -> AppResult<String> {
    match encoding {
        TextEncoding::Utf8 => {
            let bytes = bytes.strip_prefix(b"\xEF\xBB\xBF").unwrap_or(bytes);
            std::str::from_utf8(bytes)
                .map(str::to_string)
                .map_err(|_| AppError::field(ErrorCode::FileRead, "encoding"))
        }
        TextEncoding::ShiftJis => {
            let (text, _, had_errors) = encoding_rs::SHIFT_JIS.decode(bytes);
            if had_errors {
                return Err(AppError::field(ErrorCode::FileRead, "encoding"));
            }
            Ok(text.into_owned())
        }
    }
}

fn csv_table(text: &str, delimiter: Delimiter) -> AppResult<Vec<Vec<String>>> {
    let mut reader = csv::ReaderBuilder::new()
        .has_headers(false)
        .flexible(true)
        .delimiter(delimiter.byte())
        .from_reader(text.as_bytes());
    let mut table = Vec::new();
    for record in reader.records().take(ROWS_MAX) {
        let record = record.map_err(|_| AppError::new(ErrorCode::FileRead))?;
        table.push(
            record
                .iter()
                .map(|c| c.trim_start_matches('\u{feff}').to_string())
                .collect(),
        );
    }
    Ok(table)
}

/// Excel の日付（1900 年からの日数）を `YYYY-MM-DD` にする。
fn excel_date(serial: f64) -> String {
    // 1899-12-30 を 0 日とする（Excel の 1900 年のうるう年の誤りを含めた数え方）
    let days = serial.floor() as i64 - 25_569; // 1970-01-01 からの日数
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = yoe + era * 400 + i64::from(month <= 2);
    format!("{year:04}/{month:02}/{day:02}")
}

fn excel_table(bytes: &[u8]) -> AppResult<Vec<Vec<String>>> {
    let mut workbook = calamine::open_workbook_auto_from_rs(Cursor::new(bytes.to_vec()))
        .map_err(|_| AppError::new(ErrorCode::FileRead))?;
    let name = workbook
        .sheet_names()
        .first()
        .cloned()
        .ok_or(AppError::new(ErrorCode::FileRead))?;
    let range = workbook
        .worksheet_range(&name)
        .map_err(|_| AppError::new(ErrorCode::FileRead))?;
    // 表は A1 から始まるようにそろえる（見出しの行の番号がファイルと合うように）
    let (top, left) = range
        .start()
        .map_or((0, 0), |(r, c)| (r as usize, c as usize));
    let mut table: Vec<Vec<String>> = vec![Vec::new(); top];
    for row in range.rows().take(ROWS_MAX) {
        let mut cells = vec![String::new(); left];
        cells.extend(row.iter().map(|cell| match cell {
            Data::Empty => String::new(),
            Data::String(s) => s.clone(),
            Data::Int(v) => v.to_string(),
            Data::Float(v) if v.fract() == 0.0 => format!("{}", *v as i64),
            Data::Float(v) => v.to_string(),
            Data::Bool(v) => v.to_string(),
            Data::DateTime(d) => excel_date(d.as_f64()),
            Data::DateTimeIso(s) | Data::DurationIso(s) => s.clone(),
            Data::Error(_) => String::new(),
        }));
        table.push(cells);
    }
    Ok(table)
}

/// ファイルを、形式の文字コード・区切り文字で表にする。
pub fn table(
    bytes: &[u8],
    file_name: &str,
    encoding: TextEncoding,
    delimiter: Delimiter,
) -> AppResult<Vec<Vec<String>>> {
    if is_excel(file_name) {
        excel_table(bytes)
    } else {
        csv_table(&decode(bytes, encoding)?, delimiter)
    }
}

/// 初めて開くファイルの、形式の見当（文字コード・区切り文字・見出し・列の役割）。
pub fn guess(bytes: &[u8], file_name: &str) -> AppResult<FormatDefinition> {
    let encoding = guess_encoding(bytes);
    let delimiter = if is_excel(file_name) {
        Delimiter::Comma
    } else {
        statement::guess_delimiter(&decode(bytes, encoding)?)
    };
    let rows = table(bytes, file_name, encoding, delimiter)?;
    Ok(statement::guess(&rows, encoding, delimiter))
}

/// 見出しが合う形式を探す（利用者の形式を先に、次にプリセット）。
pub fn matching_format(
    bytes: &[u8],
    file_name: &str,
    formats: &[ImportFormat],
) -> Option<ImportFormat> {
    formats
        .iter()
        .filter(|f| f.definition.header_row > 0)
        .find(|f| {
            table(
                bytes,
                file_name,
                f.definition.encoding,
                f.definition.delimiter,
            )
            .is_ok_and(|t| statement::check_header(&t, &f.definition).is_ok())
        })
        .cloned()
}

/// 保存した形式でファイルを読む。見出しが合わなければ、違いを返す（黙って読まない）。
pub fn read_with(
    bytes: &[u8],
    file_name: &str,
    def: &FormatDefinition,
) -> AppResult<Result<Statement, HeaderDiff>> {
    let rows = table(bytes, file_name, def.encoding, def.delimiter)?;
    Ok(statement::check_header(&rows, def).map(|()| statement::read(&rows, def)))
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    /// 匿名化したアメックスの明細（Shift_JIS）。様式は推測で、実物での確認が要る。
    pub(crate) fn amex_fixture(rows: &[(&str, &str, &str, &str)]) -> Vec<u8> {
        let mut text =
            String::from("ご利用日,データ処理日,ご利用内容,ご利用者,金額,現地通貨額\r\n");
        for (date, merchant, amount, foreign) in rows {
            text.push_str(&format!(
                "{date},{date},{merchant},テスト　タロウ,\"{amount}\",{foreign}\r\n"
            ));
        }
        text.push_str(",,ご利用金額合計,,,\r\n");
        encoding_rs::SHIFT_JIS.encode(&text).0.into_owned()
    }

    #[test]
    fn the_amex_preset_reads_an_anonymized_statement() {
        let bytes = amex_fixture(&[
            ("2026/10/01", "ｱｽｸﾙ", "1,080", ""),
            ("2026/10/03", "AMAZON.CO.JP", "2,200", ""),
            ("2026/10/05", "ｱｽｸﾙ", "-1,080", ""),
            ("2026/10/07", "HOTEL PARIS", "15,000", "EUR 90.00"),
        ]);
        let presets = crate::db::formats::presets();
        let amex = matching_format(&bytes, "activity.csv", &presets).unwrap();
        assert_eq!(amex.preset.as_deref(), Some("amex"));
        let s = read_with(&bytes, "activity.csv", &amex.definition)
            .unwrap()
            .unwrap();
        assert!(s.errors.is_empty());
        assert_eq!(
            s.rows.iter().map(|r| r.spend).collect::<Vec<_>>(),
            [1080, 2200, -1080, 15000]
        );
        assert_eq!(s.rows[3].memo, "EUR 90.00 / テスト　タロウ");
        // 見出しが変わったファイルは読まずに違いを返す
        let changed = encoding_rs::SHIFT_JIS
            .encode("ご利用日,ご利用内容,金額,ポイント\r\n2026/10/01,店,100,1\r\n")
            .0
            .into_owned();
        assert!(matching_format(&changed, "activity.csv", &presets).is_none());
        let diff = read_with(&changed, "activity.csv", &amex.definition)
            .unwrap()
            .unwrap_err();
        assert_eq!(diff.added, ["ポイント"]);
    }

    #[test]
    fn excel_serial_dates() {
        assert_eq!(excel_date(45_000.0), "2023/03/15");
        assert_eq!(excel_date(41_640.0), "2014/01/01");
    }

    #[test]
    fn shift_jis_tab_separated_files_are_read() {
        let (bytes, _, _) =
            encoding_rs::SHIFT_JIS.encode("日付\t内容\t金額\n2026/10/01\t文具店\t1,080\n");
        assert_eq!(guess_encoding(&bytes), TextEncoding::ShiftJis);
        let def = guess(&bytes, "明細.txt").unwrap();
        assert_eq!(
            (def.encoding, def.delimiter, def.header_row),
            (TextEncoding::ShiftJis, Delimiter::Tab, 1)
        );
        let rows = table(&bytes, "明細.txt", def.encoding, def.delimiter).unwrap();
        assert_eq!(rows[1], ["2026/10/01", "文具店", "1,080"]);
        // 違う文字コードで読もうとすると、読めないと知らせる
        assert_eq!(
            table(&bytes, "明細.txt", TextEncoding::Utf8, Delimiter::Tab).unwrap_err(),
            AppError::field(ErrorCode::FileRead, "encoding")
        );
    }

    #[test]
    fn excel_statements_are_read() {
        let mut workbook = rust_xlsxwriter::Workbook::new();
        let sheet = workbook.add_worksheet();
        sheet.write(0, 0, "ご利用日").unwrap();
        sheet.write(0, 1, "ご利用内容").unwrap();
        sheet.write(0, 2, "ご利用金額").unwrap();
        sheet.write(1, 0, "2026/10/01").unwrap();
        sheet.write(1, 1, "文具店").unwrap();
        sheet.write(1, 2, 1080.0).unwrap();
        let bytes = workbook.save_to_buffer().unwrap();
        let def = guess(&bytes, "明細.xlsx").unwrap();
        let rows = table(&bytes, "明細.xlsx", def.encoding, def.delimiter).unwrap();
        let s = statement::read(&rows, &def);
        assert_eq!(s.rows.len(), 1);
        assert_eq!(
            (s.rows[0].date.as_str(), s.rows[0].spend),
            ("2026-10-01", 1080)
        );
    }
}
