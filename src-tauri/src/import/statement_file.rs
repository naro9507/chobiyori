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
    for record in reader.records() {
        if table.len() == ROWS_MAX {
            return Err(AppError::new(ErrorCode::TooManyStatementRows));
        }
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
    if top + range.height() > ROWS_MAX {
        return Err(AppError::new(ErrorCode::TooManyStatementRows));
    }
    let mut table: Vec<Vec<String>> = vec![Vec::new(); top];
    for row in range.rows() {
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
    use crate::domain::statement::ColumnRole;

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
    fn rakuten_card_presets_read_purchase_amounts_and_match_next_month() {
        // 公開されているヘッダーから作った合成データ。元の明細は使用しない。
        let prefix =
            "\u{feff}利用日,利用店名・商品名,利用者,支払方法,利用金額,手数料/利息,支払総額,";
        let cases = [
            (
                "rakuten-card-10",
                "12月支払金額,1月繰越残高,新規サイン",
                "620,580,*",
            ),
            (
                "rakuten-card-11",
                "12月支払金額,当月請求額,1月繰越残高,新規サイン",
                "620,620,580,*",
            ),
            (
                "rakuten-card",
                "支払月,12月支払金額,当月請求額,1月繰越残高,1月以降請求額",
                "12月,620,620,580,580",
            ),
        ];
        let presets = crate::db::formats::presets();
        for (key, suffix, tail) in cases {
            let csv = format!(
                "{prefix}{suffix}\r\n2026/10/03,文具店（テスト）,本人,2回払い,\"1,180\",20,1200,{tail}\r\n2026/10/04,返品（テスト）,本人,1回払い,-300,0,-300,{tail}\r\n,合計\r\n",
            );
            let name = "enavi.csv";
            let found = matching_format(csv.as_bytes(), name, &presets).unwrap();
            assert_eq!(found.preset.as_deref(), Some(key));
            assert_eq!(
                found.source_kind,
                crate::domain::statement::SourceKind::Card
            );
            let original = read_with(csv.as_bytes(), name, &found.definition)
                .unwrap()
                .unwrap();
            assert!(original.errors.is_empty());
            assert_eq!(original.ignored.len(), 1);
            assert_eq!(original.totals(), (1180, 300));
            assert_eq!(original.rows[0].date, "2026-10-03");
            assert_eq!(original.rows[0].merchant, "文具店（テスト）");

            let mut saved = found.definition.clone();
            let table = self::table(csv.as_bytes(), name, saved.encoding, saved.delimiter).unwrap();
            saved.header = statement::header_for_save(&table, &saved);
            let next_month = csv
                .replace("12月支払金額", "1月支払金額")
                .replace("1月繰越残高", "2月繰越残高")
                .replace("1月以降請求額", "2月以降請求額");
            assert_eq!(
                read_with(next_month.as_bytes(), name, &saved)
                    .unwrap()
                    .unwrap(),
                original
            );

            // 月の範囲と取引に使う列の名前・順序は厳密に確かめる。
            let bad_month = csv.replace("12月支払金額", "13月支払金額");
            assert!(matching_format(bad_month.as_bytes(), name, &presets).is_none());
            let renamed = csv.replace("利用金額,手数料/利息", "手数料/利息,利用金額");
            assert!(matching_format(renamed.as_bytes(), name, &presets).is_none());
            let changed = read_with(renamed.as_bytes(), name, &saved).unwrap();
            assert!(changed.is_err());
        }
    }

    /// 匿名化した銀行の明細（Shift_JIS）。見出しはプリセットのまま、行は役割から作る。
    /// 様式は公開情報からの推測で、実物の明細での確認が要る。
    fn bank_fixture(def: &FormatDefinition) -> Vec<u8> {
        let mut text = def.header.join(",");
        text.push_str("\r\n");
        // 出金 1,080（文具店）と、入金 8,000（振込 ﾔﾏﾀﾞ ﾀﾛｳ）
        for (date, merchant, out, inn) in [
            ("2026/10/01", "ﾌﾞﾝｸﾞﾃﾝ", "1,080", ""),
            ("2026/10/05", "ﾌﾘｺﾐ ﾔﾏﾀﾞ ﾀﾛｳ", "", "8,000"),
        ] {
            let cells: Vec<String> = def
                .columns
                .iter()
                .map(|role| match role {
                    ColumnRole::Date => date.to_string(),
                    ColumnRole::Merchant => merchant.to_string(),
                    ColumnRole::Withdrawal => format!("\"{out}\""),
                    ColumnRole::Deposit => format!("\"{inn}\""),
                    ColumnRole::Amount if out.is_empty() => format!("\"{inn}\""),
                    ColumnRole::Amount => format!("\"-{out}\""),
                    _ => String::new(),
                })
                .collect();
            text.push_str(&cells.join(","));
            text.push_str("\r\n");
        }
        encoding_rs::SHIFT_JIS.encode(&text).0.into_owned()
    }

    #[test]
    fn each_bank_preset_reads_its_own_anonymized_statement() {
        let presets = crate::db::formats::presets();
        let banks: Vec<_> = presets
            .iter()
            .filter(|p| p.preset.as_deref().is_some_and(|k| k.starts_with("bank-")))
            .collect();
        assert_eq!(banks.len(), 6);
        for bank in banks {
            let bytes = bank_fixture(&bank.definition);
            let found = matching_format(&bytes, "meisai.csv", &presets).unwrap();
            assert_eq!(found.preset, bank.preset, "{}", bank.name);
            let s = read_with(&bytes, "meisai.csv", &bank.definition)
                .unwrap()
                .unwrap();
            assert!(s.errors.is_empty(), "{}: {:?}", bank.name, s.errors);
            // 出金は出ていったお金（プラス）、入金はマイナス
            assert_eq!(
                s.rows.iter().map(|r| r.spend).collect::<Vec<_>>(),
                [1080, -8000],
                "{}",
                bank.name
            );
            assert_eq!(s.rows[1].merchant, "ﾌﾘｺﾐ ﾔﾏﾀﾞ ﾀﾛｳ");
        }
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
