//! Excel 帳簿（SPEC 第 1 章の様式）を読む。
//!
//! 月ごとのシート（`Jan.`〜`Dec.`、`1月`〜`12月`）の仕訳の部分だけを読む。1 行が 1 仕訳で、
//! 列は「day / No.（借方）/ 英名 / 和名 / No.（貸方）/ 英名 / 和名 / money / No.（摘要）/
//! 英名 / 和名 / No.（相手先）/ 名前」。列の位置は決め打ちにせず、見出しの行（`day` と
//! `money` がある行）から探す。右側の集計パネルや `Total`・`Fee` などのシートは読まない。
//!
//! - 科目は番号で入っているので、画面でこのアプリの科目を当てる（名前から候補を出す）
//! - 摘要の名前は取引のメモにする（摘要のマスタはフェーズ 4）
//! - 相手先（生徒・店・会社）は取引先にする。同じ名前の取引先がなければ作る
//! - 名前は VLOOKUP の結果（保存されている値）から、番号ごとに最も多いものを使う。
//!   `#REF!` などのエラーは名前として使わない
//! - 数式で出した集計値（Total シートなど）は使わない。年次の集計は仕訳から計算し直す

use super::{
    AccountRef, BookAccount, BookPartner, Draft, DraftLine, Issue, IssueCode, Parsed, PartnerRef,
};
use crate::db::accounts::Account;
use crate::domain::journal::{days_in_month, Side};
use crate::error::{AppError, AppResult, ErrorCode};
use calamine::{Data, Range, Reader};
use std::collections::HashMap;
use std::io::Cursor;

const MONTHS_EN: [&str; 12] = [
    "jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec",
];

/// シート名から月を読む。「Jan.」「January」「1月」「１月」。
pub fn sheet_month(name: &str) -> Option<u32> {
    let lower = name.trim().to_lowercase();
    if let Some(i) = MONTHS_EN.iter().position(|m| {
        lower.starts_with(m)
            && lower[m.len()..]
                .trim_end_matches('.')
                .chars()
                .all(|c| c.is_ascii_alphabetic())
    }) {
        return Some(i as u32 + 1);
    }
    let digits: String = lower
        .strip_suffix('月')?
        .chars()
        .map(|c| match c {
            '０'..='９' => char::from_u32(c as u32 - '０' as u32 + '0' as u32).unwrap_or(c),
            _ => c,
        })
        .collect();
    digits.parse().ok().filter(|m| (1..=12).contains(m))
}

/// ファイル名から年を読む（「DCS accounts for 2014.xlsx」→ 2014）。画面の初期値に使う。
pub fn year_in_file_name(name: &str) -> Option<i64> {
    let bytes = name.as_bytes();
    (0..bytes.len().saturating_sub(3)).find_map(|i| {
        let part = &name.get(i..i + 4)?;
        let surrounded = (i == 0 || !bytes[i - 1].is_ascii_digit())
            && bytes.get(i + 4).is_none_or(|b| !b.is_ascii_digit());
        let year: i64 = part
            .parse()
            .ok()
            .filter(|_| part.bytes().all(|b| b.is_ascii_digit()))?;
        (surrounded && (2000..=2100).contains(&year)).then_some(year)
    })
}

fn text(cell: Option<&Data>) -> String {
    match cell {
        Some(Data::String(s)) => s.trim().to_string(),
        _ => String::new(),
    }
}

/// 名前として使える文字列か。エラーや「0」（VLOOKUP が空を引いたとき）は使わない。
fn usable_name(name: &str) -> bool {
    !name.is_empty() && !name.starts_with('#') && name != "0"
}

/// 整数として読む。「12」「12.0」「"12"」を受け付ける。
fn integer(cell: Option<&Data>) -> Option<i64> {
    match cell? {
        Data::Int(v) => Some(*v),
        Data::Float(v) if v.fract() == 0.0 && v.abs() < 1e15 => Some(*v as i64),
        Data::String(s) => s.trim().parse().ok(),
        _ => None,
    }
}

fn is_blank(cell: Option<&Data>) -> bool {
    match cell {
        None | Some(Data::Empty) => true,
        Some(Data::String(s)) => s.trim().is_empty(),
        _ => false,
    }
}

/// 見出しの行で見つけた列の位置。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct Columns {
    day: usize,
    debit: usize,
    credit: usize,
    money: usize,
    purpose: Option<usize>,
    partner: Option<usize>,
}

fn find_columns(range: &Range<Data>) -> Option<(usize, Columns)> {
    for (r, row) in range.rows().enumerate() {
        let headers: Vec<String> = row.iter().map(|c| text(Some(c)).to_lowercase()).collect();
        let Some(day) = headers
            .iter()
            .position(|h| h == "day" || h == "日" || h == "日付")
        else {
            continue;
        };
        let Some(money) = headers
            .iter()
            .position(|h| h.starts_with("money") || h == "金額")
        else {
            continue;
        };
        let numbers: Vec<usize> = headers
            .iter()
            .enumerate()
            .skip(day + 1)
            .filter(|(_, h)| h.trim_end_matches('.') == "no" || h.as_str() == "番号")
            .map(|(i, _)| i)
            .collect();
        let before: Vec<usize> = numbers.iter().copied().filter(|&i| i < money).collect();
        let after: Vec<usize> = numbers.iter().copied().filter(|&i| i > money).collect();
        if let [debit, credit, ..] = before[..] {
            return Some((
                r,
                Columns {
                    day,
                    debit,
                    credit,
                    money,
                    purpose: after.first().copied(),
                    partner: after.get(1).copied(),
                },
            ));
        }
    }
    None
}

/// 番号ごとに見かけた名前を数え、最も多いものを選ぶ。
#[derive(Default)]
struct Votes(HashMap<i64, HashMap<(String, String), usize>>);

impl Votes {
    fn add(&mut self, number: i64, ja: String, en: String) {
        if usable_name(&ja) || usable_name(&en) {
            let ja = if usable_name(&ja) { ja } else { String::new() };
            let en = if usable_name(&en) { en } else { String::new() };
            *self
                .0
                .entry(number)
                .or_default()
                .entry((ja, en))
                .or_insert(0) += 1;
        } else {
            self.0.entry(number).or_default();
        }
    }

    fn best(&self, number: i64) -> (String, String) {
        self.0
            .get(&number)
            .and_then(|names| {
                names
                    .iter()
                    .max_by(|a, b| a.1.cmp(b.1).then_with(|| b.0.cmp(a.0)))
            })
            .map(|(names, _)| names.clone())
            .unwrap_or_default()
    }

    fn numbers(&self) -> Vec<i64> {
        let mut numbers: Vec<i64> = self.0.keys().copied().collect();
        numbers.sort_unstable();
        numbers
    }
}

/// 番号の列の右にある名前（英名・和名）。次の番号の列までのうち、最初を英名、最後を和名とみる。
fn names_after(row: &[Data], column: usize, next: usize) -> (String, String) {
    let cells: Vec<String> = (column + 1..next.min(row.len()))
        .map(|i| text(row.get(i)))
        .collect();
    match cells.len() {
        0 => (String::new(), String::new()),
        1 => {
            // 1 列だけなら、日本語を含むかで決める
            let only = cells[0].clone();
            if only.is_ascii() {
                (String::new(), only)
            } else {
                (only, String::new())
            }
        }
        n => (cells[n - 1].clone(), cells[0].clone()),
    }
}

/// 1 行の仕訳。
struct BookRow {
    sheet: String,
    row: usize,
    month: u32,
    day: Option<i64>,
    debit: i64,
    credit: i64,
    amount: Option<i64>,
    purpose: Option<i64>,
    partner: Option<i64>,
}

pub fn parse(bytes: &[u8], year: i64) -> AppResult<Parsed> {
    let mut workbook = calamine::open_workbook_auto_from_rs(Cursor::new(bytes.to_vec()))
        .map_err(|_| AppError::new(ErrorCode::FileRead))?;
    let mut parsed = Parsed::default();
    let mut accounts = Votes::default();
    let mut purposes = Votes::default();
    let mut partners = Votes::default();
    let mut rows: Vec<BookRow> = Vec::new();
    let mut month_sheets = 0;

    let mut sheets: Vec<(u32, String)> = workbook
        .sheet_names()
        .into_iter()
        .filter_map(|name| sheet_month(&name).map(|m| (m, name)))
        .collect();
    sheets.sort_by_key(|(m, _)| *m);

    for (month, sheet) in sheets {
        month_sheets += 1;
        let range = workbook
            .worksheet_range(&sheet)
            .map_err(|_| AppError::new(ErrorCode::FileRead))?;
        let first_row = range.start().map_or(0, |(r, _)| r as usize);
        let Some((header, cols)) = find_columns(&range) else {
            if !range.is_empty() {
                parsed.issues.push(Issue::new(
                    Some(&sheet),
                    first_row + 1,
                    IssueCode::MissingColumns,
                ));
            }
            continue;
        };
        for (r, row) in range.rows().enumerate().skip(header + 1) {
            let row_no = first_row + r + 1;
            let cell = |i: usize| row.get(i);
            let (debit, credit) = (integer(cell(cols.debit)), integer(cell(cols.credit)));
            let day = integer(cell(cols.day));
            let amount = integer(cell(cols.money));
            if debit.is_none() && credit.is_none() {
                // 科目のない行: 集計の行や空の行は飛ばす。日付と金額だけある行は書きかけとして知らせる
                if day.is_some() && amount.is_some_and(|a| a != 0) {
                    parsed
                        .issues
                        .push(Issue::new(Some(&sheet), row_no, IssueCode::UnknownAccount));
                }
                continue;
            }
            let (Some(debit), Some(credit)) = (debit, credit) else {
                let value = if debit.is_none() {
                    cell(cols.debit)
                } else {
                    cell(cols.credit)
                };
                parsed.issues.push(
                    Issue::new(Some(&sheet), row_no, IssueCode::UnmappedAccount).with(text(value)),
                );
                continue;
            };
            let next_after = |column: usize| -> usize {
                [
                    cols.credit,
                    cols.money,
                    cols.purpose.unwrap_or(usize::MAX),
                    cols.partner.unwrap_or(usize::MAX),
                ]
                .into_iter()
                .filter(|&c| c > column)
                .min()
                .unwrap_or(column + 3)
            };
            let (ja, en) = names_after(row, cols.debit, next_after(cols.debit));
            accounts.add(debit, ja, en);
            let (ja, en) = names_after(row, cols.credit, next_after(cols.credit));
            accounts.add(credit, ja, en);
            let purpose = cols.purpose.and_then(|c| integer(cell(c)));
            if let (Some(c), Some(n)) = (cols.purpose, purpose) {
                let (ja, en) = names_after(row, c, next_after(c));
                purposes.add(n, ja, en);
            }
            let partner = cols.partner.and_then(|c| integer(cell(c)));
            if let (Some(c), Some(n)) = (cols.partner, partner) {
                // 相手先の名前は番号の右の 1〜2 列
                let (ja, en) = names_after(row, c, c + 3);
                partners.add(n, ja, en);
            }
            rows.push(BookRow {
                sheet: sheet.clone(),
                row: row_no,
                month,
                day: day.filter(|_| !is_blank(cell(cols.day))),
                debit,
                credit,
                amount: amount.filter(|_| !is_blank(cell(cols.money))),
                purpose,
                partner,
            });
        }
    }
    if month_sheets == 0 {
        parsed
            .issues
            .push(Issue::new(None, 1, IssueCode::MissingColumns));
        return Ok(parsed);
    }

    // 科目ごとの借方・貸方の合計（帳簿の Total シートと見比べられるように）
    let mut totals: HashMap<i64, (i64, i64)> = HashMap::new();
    for r in &rows {
        let Some(amount) = r.amount.filter(|a| *a > 0) else {
            continue;
        };
        totals.entry(r.debit).or_default().0 += amount;
        totals.entry(r.credit).or_default().1 += amount;
    }
    parsed.book_accounts = accounts
        .numbers()
        .into_iter()
        .map(|number| {
            let (name_ja, name_en) = accounts.best(number);
            let (debit, credit) = totals.get(&number).copied().unwrap_or_default();
            BookAccount {
                number,
                name_ja,
                name_en,
                suggested_account_id: None,
                debit,
                credit,
            }
        })
        .collect();
    parsed.book_partners = partners
        .numbers()
        .into_iter()
        .map(|number| {
            let (ja, en) = partners.best(number);
            BookPartner {
                number,
                name: if ja.is_empty() { en } else { ja },
            }
        })
        .collect();

    for r in rows {
        let issue = |code| Issue::new(Some(&r.sheet), r.row, code);
        let Some(day) = r
            .day
            .filter(|d| (1..=i64::from(days_in_month(year, r.month))).contains(d))
        else {
            parsed.issues.push(issue(IssueCode::InvalidDate));
            continue;
        };
        let Some(amount) = r
            .amount
            .filter(|a| (1..=crate::domain::journal::AMOUNT_MAX).contains(a))
        else {
            parsed.issues.push(issue(IssueCode::InvalidAmount));
            continue;
        };
        let memo = r
            .purpose
            .map(|n| {
                let (ja, en) = purposes.best(n);
                if ja.is_empty() {
                    en
                } else {
                    ja
                }
            })
            .unwrap_or_default();
        let partner = r.partner.map(PartnerRef::BookNumber);
        let line = |side, number| DraftLine {
            side,
            account: AccountRef::BookNumber(number),
            amount,
            partner: partner.clone(),
            memo: String::new(),
        };
        parsed.drafts.push(Draft {
            sheet: Some(r.sheet.clone()),
            row: r.row,
            date: format!("{year:04}-{:02}-{day:02}", r.month),
            memo,
            lines: vec![line(Side::Debit, r.debit), line(Side::Credit, r.credit)],
        });
    }
    Ok(parsed)
}

/// 呼び方の違う科目名。帳簿の名前にこの言葉が入っていれば、標準科目のこのコードを候補にする。
const ALIASES: &[(&str, &str)] = &[
    ("現金", "101"),
    ("cash", "101"),
    ("普通預金", "104"),
    ("預金", "104"),
    ("銀行", "104"),
    ("bank", "104"),
    ("売掛", "106"),
    ("前払", "109"),
    ("事業主貸", "199"),
    ("買掛", "202"),
    ("借入", "203"),
    ("未払", "204"),
    ("前受", "205"),
    ("預り", "206"),
    ("事業主借", "301"),
    ("元入", "302"),
    ("授業料", "401"),
    ("月謝", "401"),
    ("売上", "401"),
    ("fee", "401"),
    ("雑収入", "403"),
    ("仕入", "502"),
    ("租税", "601"),
    ("税", "601"),
    ("水道", "603"),
    ("光熱", "603"),
    ("電気", "603"),
    ("ガス", "603"),
    ("electric", "603"),
    ("交通", "604"),
    ("旅費", "604"),
    ("通信", "605"),
    ("電話", "605"),
    ("広告", "606"),
    ("交際", "607"),
    ("接待", "607"),
    ("保険", "608"),
    ("修繕", "609"),
    ("消耗品", "610"),
    ("減価償却", "611"),
    ("福利", "612"),
    ("給料", "613"),
    ("賃金", "613"),
    ("外注", "614"),
    ("利子", "615"),
    ("利息", "615"),
    ("家賃", "616"),
    ("地代", "616"),
    ("rent", "616"),
    ("雑費", "699"),
];

/// 帳簿の科目名から、このアプリの科目の候補を選ぶ。同じ名前の科目、なければ言い換えの表。
pub fn suggest_account(name_ja: &str, name_en: &str, accounts: &[Account]) -> Option<i64> {
    let ja = name_ja.trim();
    let en = name_en.trim().to_lowercase();
    let active = || accounts.iter().filter(|a| a.is_active);
    if let Some(a) = active().find(|a| {
        (!ja.is_empty() && a.name_ja == ja) || (!en.is_empty() && a.name_en.to_lowercase() == en)
    }) {
        return Some(a.id);
    }
    ALIASES
        .iter()
        .find(|(word, _)| ja.contains(word) || (!en.is_empty() && en.contains(word)))
        .and_then(|(_, code)| active().find(|a| a.is_system && a.code == *code))
        .map(|a| a.id)
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use crate::db::setup::tests::set_up_db;
    use crate::db::transactions::tests::account;
    use crate::db::{accounts, books, reports};
    use crate::import::{commit, preview, AccountMapping};
    use rust_xlsxwriter::{Formula, Workbook, Worksheet};

    /// 匿名化した 2014 年帳簿のフィクスチャ。様式は SPEC 第 1 章（ブック A）に合わせる。
    ///
    /// 科目: 1 現金 / 2 普通預金 / 3 授業料 / 4 水道光熱費 / 5 地代家賃 / 6 消耗品費 / 7 事業主貸 / 8 事業主借
    /// 摘要: 1 月謝 / 2 電気代 / 11 授業料戻し
    /// 相手先: 1 生徒A / 2 生徒B / 501 文具店
    pub(crate) const ACCOUNTS: [(i64, &str, &str); 8] = [
        (1, "cash", "現金"),
        (2, "bank", "普通預金"),
        (3, "tuition", "授業料"),
        (4, "utilities", "水道光熱費"),
        (5, "rent", "地代家賃"),
        (6, "supplies", "消耗品費"),
        (7, "private", "事業主貸"),
        (8, "owner", "事業主借"),
    ];

    fn account_name(number: i64) -> (&'static str, &'static str) {
        ACCOUNTS
            .iter()
            .find(|a| a.0 == number)
            .map(|a| (a.1, a.2))
            .unwrap()
    }

    /// 月ごとの仕訳（日, 借方, 貸方, 金額, 摘要, 相手先）。
    /// 日, 借方, 貸方, 金額, 摘要, 相手先
    type Entry = (i64, i64, i64, i64, Option<i64>, Option<i64>);

    pub(crate) fn month_entries(month: u32) -> Vec<Entry> {
        let mut entries = vec![
            (5, 2, 3, 8_000, Some(1), Some(1)),
            (5, 2, 3, 8_000, Some(1), Some(2)),
            (10, 4, 2, 6_000 + i64::from(month) * 100, Some(2), None),
            (25, 5, 2, 50_000, None, None),
            (12, 6, 1, 1_080, None, Some(501)),
        ];
        if month == 3 {
            // 返金（授業料戻し）と、同じ日に同じ金額の取引が 2 回
            entries.push((20, 3, 2, 8_000, Some(11), Some(2)));
            entries.push((21, 6, 1, 500, None, None));
            entries.push((21, 6, 1, 500, None, None));
        }
        if month == 6 {
            entries.push((1, 1, 8, 30_000, None, None));
            entries.push((30, 7, 2, 20_000, None, None));
        }
        entries
    }

    fn name_formula(sheet: &mut Worksheet, row: u32, col: u16, value: &str) {
        // VLOOKUP の結果として保存された値
        let formula = Formula::new(format!("=VLOOKUP(B{},'No.'!$A$3:$C$40,3,FALSE)", row + 1))
            .set_result(value);
        sheet.write_formula(row, col, formula).unwrap();
    }

    fn write_month(sheet: &mut Worksheet, month: u32) {
        // 1 行目は見出しの年月（古いまま）、3 行目が列の見出し
        sheet.write(0, 0, "Junuary , 2007").unwrap();
        let headers = [
            "day",
            "No.",
            "plus",
            "借方",
            "No.",
            "minus",
            "貸方",
            "money",
            "No.",
            "purpose",
            "摘要",
            "No.",
            "students,shop,company",
        ];
        for (i, h) in headers.iter().enumerate() {
            sheet.write(2, i as u16, *h).unwrap();
        }
        // 右側の集計パネル（読まない）
        sheet.write(2, 15, "No.").unwrap();
        sheet.write(2, 16, "plus").unwrap();
        sheet.write(3, 15, 1).unwrap();
        sheet.write(3, 16, 999_999).unwrap();

        let purposes = [
            (1, "fee", "月謝"),
            (2, "electricity", "電気代"),
            (11, "repay", "授業料戻し"),
        ];
        let partners = [(1, "生徒A"), (2, "生徒B"), (501, "文具店")];
        let mut row = 3;
        for (day, debit, credit, amount, purpose, partner) in month_entries(month) {
            sheet.write(row, 0, day as f64).unwrap();
            sheet.write(row, 1, debit as f64).unwrap();
            let (en, ja) = account_name(debit);
            name_formula(sheet, row, 2, en);
            name_formula(sheet, row, 3, ja);
            sheet.write(row, 4, credit as f64).unwrap();
            let (en, ja) = account_name(credit);
            name_formula(sheet, row, 5, en);
            name_formula(sheet, row, 6, ja);
            sheet.write(row, 7, amount as f64).unwrap();
            if let Some(p) = purpose {
                let (_, en, ja) = purposes.iter().find(|x| x.0 == p).unwrap();
                sheet.write(row, 8, p as f64).unwrap();
                name_formula(sheet, row, 9, en);
                name_formula(sheet, row, 10, ja);
            }
            if let Some(p) = partner {
                let (_, name) = partners.iter().find(|x| x.0 == p).unwrap();
                sheet.write(row, 11, p as f64).unwrap();
                name_formula(sheet, row, 12, name);
            }
            row += 1;
        }
        if month == 9 {
            // 範囲のずれた VLOOKUP（#REF!）。番号は正しいので、名前は他の行から決まる
            let formula = Formula::new("=VLOOKUP(B1,#REF!,3,FALSE)").set_result("#REF!");
            sheet.write_formula(3, 3, formula).unwrap();
        }
        // 集計の行（科目の番号がない）
        sheet.write(row + 1, 6, "total").unwrap();
        sheet
            .write_formula(
                row + 1,
                7,
                Formula::new(format!("=SUM(H4:H{})", row)).set_result("0"),
            )
            .unwrap();
    }

    pub(crate) fn fixture() -> Vec<u8> {
        let mut workbook = Workbook::new();
        let master = workbook.add_worksheet();
        master.set_name("No.").unwrap();
        for (i, (n, en, ja)) in ACCOUNTS.iter().enumerate() {
            master.write(i as u32 + 2, 0, *n as f64).unwrap();
            master.write(i as u32 + 2, 1, *en).unwrap();
            master.write(i as u32 + 2, 2, *ja).unwrap();
        }
        for (month, name) in [
            "Jan.", "Feb.", "Mar.", "Apr.", "May", "Jun.", "Jul.", "Aug.", "Sep.", "Oct.", "Nov.",
            "Dec.",
        ]
        .iter()
        .enumerate()
        {
            let sheet = workbook.add_worksheet();
            sheet.set_name(*name).unwrap();
            write_month(sheet, month as u32 + 1);
        }
        let total = workbook.add_worksheet();
        total.set_name("Total").unwrap();
        total.write(0, 0, "day").unwrap();
        workbook.save_to_buffer().unwrap()
    }

    /// 帳簿の科目の番号 → このアプリの科目のコード。
    const MAPPING: [(i64, &str); 8] = [
        (1, "101"),
        (2, "104"),
        (3, "401"),
        (4, "603"),
        (5, "616"),
        (6, "610"),
        (7, "199"),
        (8, "301"),
    ];

    #[test]
    fn reads_month_names() {
        assert_eq!(sheet_month("Jan."), Some(1));
        assert_eq!(sheet_month("September"), Some(9));
        assert_eq!(sheet_month("May"), Some(5));
        assert_eq!(sheet_month("１２月"), Some(12));
        assert_eq!(sheet_month("Fee 授業料"), None);
        assert_eq!(sheet_month("Total"), None);
        assert_eq!(sheet_month("No."), None);
        assert_eq!(year_in_file_name("DCS accounts for 2014.xlsx"), Some(2014));
        assert_eq!(year_in_file_name("平成26年 DCS仕訳帳(1).xlsx"), None);
    }

    #[test]
    fn suggests_accounts_from_book_names() {
        let db = set_up_db();
        let conn = db.conn();
        let list = accounts::list(&conn).unwrap();
        for (number, code) in MAPPING {
            let (en, ja) = account_name(number);
            assert_eq!(
                suggest_account(ja, en, &list),
                Some(account(&conn, code)),
                "{ja}"
            );
        }
        assert_eq!(
            suggest_account("電話代", "", &list),
            Some(account(&conn, "605"))
        );
        assert_eq!(suggest_account("ふしぎな科目", "mystery", &list), None);
    }

    #[test]
    fn the_2014_book_imports_and_the_yearly_totals_match() {
        let bytes = fixture();
        let parsed = parse(&bytes, 2014).unwrap();
        assert!(parsed.issues.is_empty(), "{:?}", parsed.issues);
        let expected: usize = (1..=12).map(|m| month_entries(m).len()).sum();
        assert_eq!(parsed.drafts.len(), expected);
        // 9 月の #REF! があっても、名前は他の行から決まる
        let bank = parsed.book_accounts.iter().find(|a| a.number == 2).unwrap();
        assert_eq!(
            (bank.name_ja.as_str(), bank.name_en.as_str()),
            ("普通預金", "bank")
        );
        assert_eq!(
            parsed
                .book_partners
                .iter()
                .map(|p| p.name.as_str())
                .collect::<Vec<_>>(),
            ["生徒A", "生徒B", "文具店"]
        );
        let march_refund = parsed
            .drafts
            .iter()
            .find(|d| d.date == "2014-03-20")
            .unwrap();
        assert_eq!(march_refund.memo, "授業料戻し");
        assert_eq!(march_refund.sheet.as_deref(), Some("Mar."));

        let db = set_up_db();
        let mapping: Vec<AccountMapping> = {
            let conn = db.conn();
            MAPPING
                .iter()
                .map(|(number, code)| AccountMapping {
                    number: *number,
                    account_id: account(&conn, code),
                })
                .collect()
        };
        // 対応を決める前は、取り込めない
        let p = preview(&db.conn(), &parsed, Some(2014), &[]).unwrap();
        assert_eq!(p.ready, 0);
        assert!(p
            .issues
            .iter()
            .all(|i| i.code == IssueCode::UnmappedAccount));
        // 候補は対応表と同じ
        for b in &p.book_accounts {
            let m = mapping.iter().find(|m| m.number == b.number).unwrap();
            assert_eq!(b.suggested_account_id, Some(m.account_id));
        }

        let p = preview(&db.conn(), &parsed, Some(2014), &mapping).unwrap();
        assert_eq!((p.ready, p.issue_count, p.duplicates), (expected, 0, 0));
        assert!(p.creates_fiscal_year);
        assert_eq!(p.new_partners.len(), 3);
        assert_eq!(p.total_debit, p.total_credit);

        let result = commit(&db, &parsed, Some(2014), &mapping).unwrap();
        assert_eq!(result.imported, expected);

        // 年次集計: 帳簿の科目ごとの借方・貸方の合計が、試算表と一致する
        let conn = db.conn();
        let tb = reports::trial_balance(&conn, 2014, 1, 12).unwrap();
        assert!(tb.balanced);
        for b in &parsed.book_accounts {
            let id = mapping
                .iter()
                .find(|m| m.number == b.number)
                .unwrap()
                .account_id;
            let row = tb.rows.iter().find(|r| r.account_id == id).unwrap();
            assert_eq!(
                (row.debit, row.credit),
                (b.debit, b.credit),
                "{}",
                b.name_ja
            );
        }
        // 授業料: 月 16,000 × 12 − 返金 8,000
        let sales = tb
            .rows
            .iter()
            .find(|r| r.account_id == account(&conn, "401"))
            .unwrap();
        assert_eq!(sales.balance, 16_000 * 12 - 8_000);
        // 現金: 事業主借 30,000 − 消耗品 1,080 × 12 − 500 × 2
        let cash = books::ledger(&conn, 2014, 1, 12, account(&conn, "101")).unwrap();
        assert_eq!(cash.closing_balance, 30_000 - 1_080 * 12 - 1_000);
        // 光熱費: 6,000 × 12 + 100 × (1 + … + 12)
        let utilities = tb
            .rows
            .iter()
            .find(|r| r.account_id == account(&conn, "603"))
            .unwrap();
        assert_eq!(utilities.balance, 6_000 * 12 + 100 * 78);
        assert_eq!(
            tb.pre_tax_income,
            (16_000 * 12 - 8_000) - (6_000 * 12 + 100 * 78) - 50_000 * 12 - (1_080 * 12 + 1_000)
        );
        // 取引先: 生徒は顧客、501 番からは仕入先
        let partners = crate::db::partners::list(&conn).unwrap();
        let shop = partners.iter().find(|p| p.name_ja == "文具店").unwrap();
        assert!(shop.is_vendor && !shop.is_customer);
        drop(conn);

        // もう一度取り込んでも二重にならない（同じ日・同じ金額の 2 件も 2 件のまま）
        let again = commit(&db, &parsed, Some(2014), &mapping).unwrap();
        assert_eq!((again.imported, again.duplicates), (0, expected));
        assert_eq!(crate::db::partners::list(&db.conn()).unwrap().len(), 3);
    }

    #[test]
    fn broken_rows_are_reported_with_sheet_and_row() {
        let mut workbook = Workbook::new();
        let sheet = workbook.add_worksheet();
        sheet.set_name("Feb.").unwrap();
        for (i, h) in [
            "day", "No.", "plus", "借方", "No.", "minus", "貸方", "money",
        ]
        .iter()
        .enumerate()
        {
            sheet.write(0, i as u16, *h).unwrap();
        }
        // 2 月 30 日
        sheet.write_row(1, 0, [30.0, 6.0]).unwrap();
        sheet.write(1, 4, 1.0).unwrap();
        sheet.write(1, 7, 100.0).unwrap();
        // 金額がない
        sheet.write_row(2, 0, [3.0, 6.0]).unwrap();
        sheet.write(2, 4, 1.0).unwrap();
        // 科目の番号が数でない
        sheet.write_row(3, 0, [4.0]).unwrap();
        sheet.write(3, 1, "?").unwrap();
        sheet.write(3, 4, 1.0).unwrap();
        sheet.write(3, 7, 100.0).unwrap();
        let parsed = parse(&workbook.save_to_buffer().unwrap(), 2014).unwrap();
        let found: Vec<(Option<&str>, usize, IssueCode)> = parsed
            .issues
            .iter()
            .map(|i| (i.sheet.as_deref(), i.row, i.code))
            .collect();
        assert_eq!(
            found,
            [
                (Some("Feb."), 4, IssueCode::UnmappedAccount),
                (Some("Feb."), 2, IssueCode::InvalidDate),
                (Some("Feb."), 3, IssueCode::InvalidAmount),
            ]
        );
    }

    #[test]
    fn files_that_are_not_excel_cannot_be_read() {
        assert_eq!(
            parse(b"not a workbook", 2014).unwrap_err(),
            AppError::new(ErrorCode::FileRead)
        );
    }
}
