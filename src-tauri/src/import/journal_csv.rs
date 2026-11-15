//! 仕訳の CSV を読む。形式は出力（`export::csv::journal`）と同じで、1 行 = 1 明細行。
//!
//! - 文字コードは UTF-8（BOM の有無を問わない）か Shift_JIS。自動で見分ける
//! - 見出しの行で列を探す。列の並びは問わない。見出しは日本語・英語のどちらでもよい
//! - 「取引番号」が同じ行を 1 つの取引にまとめる
//!
//! 列の対応を利用者が決められる汎用の取込（形式エディタ）は、フェーズ 5 で取込受信箱と一緒に作る。

use super::{parse_amount, AccountRef, Draft, DraftLine, Issue, IssueCode, Parsed, PartnerRef};
use crate::domain::journal::Side;
use crate::error::{AppError, AppResult, ErrorCode};
use crate::export::csv::JOURNAL_COLUMNS;
use crate::export::labels as l;
use std::collections::HashMap;

/// ファイルの中身を文字列にする。UTF-8 として読めなければ Shift_JIS として読む。
pub fn decode(bytes: &[u8]) -> AppResult<String> {
    let bytes = bytes.strip_prefix(b"\xEF\xBB\xBF").unwrap_or(bytes);
    if let Ok(text) = std::str::from_utf8(bytes) {
        return Ok(text.to_string());
    }
    let (text, _, had_errors) = encoding_rs::SHIFT_JIS.decode(bytes);
    if had_errors {
        return Err(AppError::new(ErrorCode::FileRead));
    }
    Ok(text.into_owned())
}

/// 列の役割。`JOURNAL_COLUMNS` と同じ並び。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
enum Role {
    TransactionNo,
    Date,
    Side,
    AccountCode,
    AccountName,
    Amount,
    PartnerCode,
    PartnerName,
    LineMemo,
    TransactionMemo,
}

const ROLES: [Role; 10] = [
    Role::TransactionNo,
    Role::Date,
    Role::Side,
    Role::AccountCode,
    Role::AccountName,
    Role::Amount,
    Role::PartnerCode,
    Role::PartnerName,
    Role::LineMemo,
    Role::TransactionMemo,
];

const REQUIRED: [Role; 5] = [
    Role::TransactionNo,
    Role::Date,
    Role::Side,
    Role::AccountCode,
    Role::Amount,
];

fn normalize(text: &str) -> String {
    text.trim().trim_start_matches('\u{feff}').to_lowercase()
}

fn role_of(header: &str) -> Option<Role> {
    let header = normalize(header);
    JOURNAL_COLUMNS
        .iter()
        .position(|c| normalize(c.ja) == header || normalize(c.en) == header)
        .map(|i| ROLES[i])
}

fn parse_side(text: &str) -> Option<Side> {
    let text = normalize(text);
    if text == normalize(l::DEBIT.ja) || text == normalize(l::DEBIT.en) || text == "d" {
        Some(Side::Debit)
    } else if text == normalize(l::CREDIT.ja) || text == normalize(l::CREDIT.en) || text == "c" {
        Some(Side::Credit)
    } else {
        None
    }
}

/// 日付を `YYYY-MM-DD` にそろえる。「2026/3/5」「2026-03-05」を受け付ける。
fn normalize_date(text: &str) -> String {
    let parts: Vec<&str> = text.trim().split(['/', '-', '.']).collect();
    if let [y, m, d] = parts[..] {
        if let (Ok(y), Ok(m), Ok(d)) = (y.parse::<u32>(), m.parse::<u32>(), d.parse::<u32>()) {
            return format!("{y:04}-{m:02}-{d:02}");
        }
    }
    text.trim().to_string()
}

pub fn parse(bytes: &[u8]) -> AppResult<Parsed> {
    let text = decode(bytes)?;
    let mut reader = csv::ReaderBuilder::new()
        .has_headers(false)
        .flexible(true)
        .from_reader(text.as_bytes());
    let mut parsed = Parsed::default();
    let mut columns: Option<HashMap<Role, usize>> = None;
    // 取引番号ごとに、下書きの番号
    let mut groups: HashMap<String, usize> = HashMap::new();
    let mut invalid: Vec<bool> = Vec::new();

    for record in reader.records() {
        let record = record.map_err(|_| AppError::new(ErrorCode::FileRead))?;
        let row = record.position().map_or(0, |p| p.line() as usize);
        if record.iter().all(|f| f.trim().is_empty()) {
            continue;
        }
        let Some(columns) = &columns else {
            // 最初の行は見出し
            let found: HashMap<Role, usize> = record
                .iter()
                .enumerate()
                .filter_map(|(i, h)| role_of(h).map(|r| (r, i)))
                .collect();
            let missing: Vec<&str> = REQUIRED
                .iter()
                .filter(|r| !found.contains_key(r))
                .map(|r| JOURNAL_COLUMNS[ROLES.iter().position(|x| x == r).unwrap_or(0)].ja)
                .collect();
            if !missing.is_empty() {
                parsed.issues.push(
                    Issue::new(None, row, IssueCode::MissingColumns).with(missing.join("、")),
                );
                return Ok(parsed);
            }
            columns = Some(found);
            continue;
        };
        let get = |role: Role| -> &str {
            columns
                .get(&role)
                .and_then(|&i| record.get(i))
                .unwrap_or("")
                .trim()
        };

        let key = get(Role::TransactionNo).to_string();
        let index = *groups.entry(key).or_insert_with(|| {
            parsed.drafts.push(Draft {
                sheet: None,
                row,
                date: normalize_date(get(Role::Date)),
                memo: get(Role::TransactionMemo).to_string(),
                lines: Vec::new(),
            });
            invalid.push(false);
            parsed.drafts.len() - 1
        });
        if invalid[index] {
            continue;
        }
        let issue = |code| Issue::new(None, row, code);
        let Some(side) = parse_side(get(Role::Side)) else {
            parsed.issues.push(issue(IssueCode::InvalidSide));
            invalid[index] = true;
            continue;
        };
        let Some(amount) = parse_amount(get(Role::Amount)) else {
            parsed.issues.push(issue(IssueCode::InvalidAmount));
            invalid[index] = true;
            continue;
        };
        let code = get(Role::AccountCode);
        if code.is_empty() {
            parsed.issues.push(issue(IssueCode::UnknownAccount));
            invalid[index] = true;
            continue;
        }
        let partner = get(Role::PartnerCode);
        parsed.drafts[index].lines.push(DraftLine {
            side,
            account: AccountRef::Code(code.to_string()),
            amount,
            partner: (!partner.is_empty()).then(|| PartnerRef::Code(partner.to_string())),
            memo: get(Role::LineMemo).to_string(),
        });
    }
    if columns.is_none() {
        parsed
            .issues
            .push(Issue::new(None, 1, IssueCode::MissingColumns));
    }
    // 読めなかった行を含む取引は取り込まない（直すところとして出してある）
    let mut keep = invalid.iter().map(|bad| !bad);
    parsed.drafts.retain(|_| keep.next().unwrap_or(true));
    Ok(parsed)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::books::journal;
    use crate::db::reports::tests::books;
    use crate::db::reports::trial_balance;
    use crate::db::setup::tests::set_up_db;
    use crate::db::{accounts, partners};
    use crate::export::csv::{self as csv_out, Encoding};
    use crate::export::labels::Locale;
    use crate::export::report::Names;
    use crate::import::{commit, preview};

    fn exported(db: &crate::db::Database, locale: Locale, encoding: Encoding) -> Vec<u8> {
        let conn = db.conn();
        let names = Names::new(
            accounts::list(&conn).unwrap(),
            partners::list(&conn).unwrap(),
            locale,
        );
        let text = csv_out::journal(&journal(&conn, 2026, 1, 12).unwrap(), &names, locale).unwrap();
        csv_out::encode(&text, encoding).unwrap()
    }

    #[test]
    fn exported_journal_imports_into_an_empty_book_with_the_same_totals() {
        let source = books();
        for (locale, encoding) in [
            (Locale::Ja, Encoding::Utf8),
            (Locale::En, Encoding::ShiftJis),
        ] {
            let bytes = exported(&source, locale, encoding);
            let parsed = parse(&bytes).unwrap();
            assert!(parsed.issues.is_empty(), "{:?}", parsed.issues);
            assert_eq!(parsed.drafts.len(), 8);

            let target = set_up_db();
            let p = preview(&target.conn(), &parsed, None, &[]).unwrap();
            assert_eq!(
                (p.fiscal_year, p.ready, p.issue_count, p.duplicates),
                (Some(2026), 8, 0, 0)
            );
            assert!(!p.creates_fiscal_year);
            let result = commit(&target, &parsed, None, &[]).unwrap();
            assert_eq!(result.imported, 8);

            let before = trial_balance(&source.conn(), 2026, 1, 12).unwrap();
            let after = trial_balance(&target.conn(), 2026, 1, 12).unwrap();
            assert_eq!(before, after);
            // もう一度取り込んでも二重にならない
            let again = commit(&target, &parsed, None, &[]).unwrap();
            assert_eq!((again.imported, again.duplicates), (0, 8));
        }
    }

    #[test]
    fn problems_are_listed_with_the_row_and_nothing_is_imported() {
        let csv = "取引番号,日付,貸借,科目コード,金額,取引のメモ\n\
                   1,2026-03-01,借方,610,1200,文具\n\
                   1,2026-03-01,貸方,101,1200,\n\
                   2,2026-03-02,借方,999,500,\n\
                   2,2026-03-02,貸方,101,500,\n\
                   3,2026/3/3,借方,610,800,\n\
                   3,2026/3/3,貸方,101,700,\n\
                   4,2026-03-04,左,610,100,\n\
                   5,2025-12-31,借方,610,100,\n\
                   5,2025-12-31,貸方,101,100,\n";
        let parsed = parse(csv.as_bytes()).unwrap();
        let db = set_up_db();
        let p = preview(&db.conn(), &parsed, None, &[]).unwrap();
        let found: Vec<(usize, IssueCode)> = p.issues.iter().map(|i| (i.row, i.code)).collect();
        assert_eq!(
            found,
            [
                (8, IssueCode::InvalidSide),
                (4, IssueCode::UnknownAccount),
                (6, IssueCode::Unbalanced),
                (9, IssueCode::OutsideYear),
            ]
        );
        assert_eq!(p.issues[1].value.as_deref(), Some("999"));
        assert_eq!(p.ready, 1);
        assert_eq!(
            commit(&db, &parsed, None, &[]).unwrap_err(),
            AppError::new(ErrorCode::ImportBlocked)
        );
        assert_eq!(
            crate::db::transactions::list(&db.conn(), 2026, None)
                .unwrap()
                .len(),
            0
        );
    }

    #[test]
    fn missing_columns_are_reported() {
        let parsed = parse("日付,金額\n2026-01-01,100\n".as_bytes()).unwrap();
        assert_eq!(parsed.issues.len(), 1);
        assert_eq!(parsed.issues[0].code, IssueCode::MissingColumns);
        assert!(parsed.issues[0]
            .value
            .as_deref()
            .unwrap()
            .contains("取引番号"));
    }

    #[test]
    fn shift_jis_files_are_detected() {
        let (bytes, _, _) = encoding_rs::SHIFT_JIS.encode("取引番号,日付,貸借,科目コード,金額\n1,2026-01-05,借方,610,100\n1,2026-01-05,貸方,101,100\n");
        let parsed = parse(&bytes).unwrap();
        assert!(parsed.issues.is_empty());
        assert_eq!(parsed.drafts[0].lines.len(), 2);
    }

    #[test]
    fn a_year_that_does_not_exist_yet_is_created() {
        let db = set_up_db();
        let csv = "取引番号,日付,貸借,科目コード,金額\n1,2014-01-05,借方,610,100\n1,2014-01-05,貸方,101,100\n";
        let parsed = parse(csv.as_bytes()).unwrap();
        let p = preview(&db.conn(), &parsed, None, &[]).unwrap();
        assert!(p.creates_fiscal_year);
        assert_eq!(p.fiscal_year, Some(2014));
        commit(&db, &parsed, None, &[]).unwrap();
        let years = crate::db::setup::fiscal_years(&db.conn()).unwrap();
        assert_eq!(
            years.iter().map(|y| y.year).collect::<Vec<_>>(),
            [2026, 2014]
        );
        assert_eq!(years[1].filing_type, years[0].filing_type);
    }
}
