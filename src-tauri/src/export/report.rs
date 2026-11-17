//! 帳票の形（見出し・列・行）。PDF と CSV の両方を、この形から作る。
//!
//! 帳簿のデータ（`db::books`）に科目名などを当てはめて表にする。ページ割りもここで決める。

use super::labels::{self as l, Locale};
use crate::db::accounts::Account;
use crate::db::books::JournalBook;
use crate::db::closing::StatementAmounts;
use crate::db::partners::Partner;
use crate::db::sub_accounts::SubAccount;
use crate::domain::balance::TrialBalance;
use crate::domain::closing::Side as BsSide;
use crate::domain::depreciation::Method;
use crate::domain::journal::Side;
use crate::domain::ledger::Ledger;
use crate::domain::master::AccountCategory;
use std::collections::HashMap;
use std::ops::Range;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Cell {
    Empty,
    Text(String),
    /// 日付（`YYYY-MM-DD`）。PDF では月日だけ、CSV ではそのまま書く
    Date(String),
    Amount(i64),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ColumnKind {
    Text,
    /// 金額。繰越の行では、ページまでの合計を書く
    Sum,
    /// 残高。繰越の行では、その時点の残高を書く
    Balance,
    /// 金額だが、繰越の行には書かない
    Amount,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Column {
    pub label: String,
    /// 列の幅の比。PDF で使う
    pub width: f32,
    pub kind: ColumnKind,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RowStyle {
    Normal,
    /// 繰越・小計・合計
    Emphasis,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Row {
    pub cells: Vec<Cell>,
    /// 同じページに置きたい行のまとまり（1 つの取引など）
    pub group: usize,
    pub style: RowStyle,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Section {
    /// 科目ごとの帳簿なら科目名
    pub heading: Option<String>,
    pub columns: Vec<Column>,
    pub rows: Vec<Row>,
    /// ページの境目に繰越の行を入れる。文言を書く列の番号
    pub carry_label_column: Option<usize>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Report {
    pub title: String,
    /// 屋号（なければ氏名）
    pub business: String,
    pub period: String,
    pub sections: Vec<Section>,
    /// 最後に書く注記（試算表の所得など）
    pub footnote: Option<String>,
    pub locale: Locale,
}

/// 帳票に共通の情報。
#[derive(Debug, Clone)]
pub struct Context {
    pub locale: Locale,
    pub business: String,
    pub from: String,
    pub to: String,
    /// 期間が年度の初めから始まる（繰越の行を「前期繰越」と書く）
    pub from_year_start: bool,
}

/// id から科目名・取引先名を引く。
pub struct Names {
    accounts: HashMap<i64, Account>,
    partners: HashMap<i64, Partner>,
    sub_accounts: HashMap<i64, SubAccount>,
    locale: Locale,
}

impl Names {
    pub fn new(accounts: Vec<Account>, partners: Vec<Partner>, locale: Locale) -> Self {
        Self {
            accounts: accounts.into_iter().map(|a| (a.id, a)).collect(),
            partners: partners.into_iter().map(|p| (p.id, p)).collect(),
            sub_accounts: HashMap::new(),
            locale,
        }
    }

    /// 補助科目も引けるようにする。
    pub fn with_sub_accounts(mut self, sub_accounts: Vec<SubAccount>) -> Self {
        self.sub_accounts = sub_accounts.into_iter().map(|s| (s.id, s)).collect();
        self
    }

    pub fn sub_account(&self, id: i64) -> Option<&SubAccount> {
        self.sub_accounts.get(&id)
    }

    pub fn account(&self, id: i64) -> Option<&Account> {
        self.accounts.get(&id)
    }

    pub fn partner(&self, id: i64) -> Option<&Partner> {
        self.partners.get(&id)
    }

    fn pick<'a>(&self, ja: &'a str, en: &'a str) -> &'a str {
        if self.locale == Locale::En && !en.is_empty() {
            en
        } else {
            ja
        }
    }

    pub fn account_name(&self, id: i64) -> String {
        self.account(id)
            .map(|a| self.pick(&a.name_ja, &a.name_en).to_string())
            .unwrap_or_default()
    }

    /// 「コード 名前」
    pub fn account_label(&self, id: i64) -> String {
        self.account(id)
            .map(|a| format!("{} {}", a.code, self.pick(&a.name_ja, &a.name_en)))
            .unwrap_or_default()
    }

    pub fn partner_name(&self, id: Option<i64>) -> String {
        id.and_then(|id| self.partner(id))
            .map(|p| self.pick(&p.name_ja, &p.name_en).to_string())
            .unwrap_or_default()
    }

    /// 相手科目。2 科目以上なら「諸口」。
    pub fn counter(&self, id: Option<i64>) -> String {
        match id {
            Some(id) => self.account_name(id),
            None => l::SUNDRY.get(self.locale).to_string(),
        }
    }
}

fn column(label: &l::Text, locale: Locale, width: f32, kind: ColumnKind) -> Column {
    Column {
        label: label.get(locale).to_string(),
        width,
        kind,
    }
}

fn text(value: impl Into<String>) -> Cell {
    let value = value.into();
    if value.is_empty() {
        Cell::Empty
    } else {
        Cell::Text(value)
    }
}

/// 0 は空欄にする（借方・貸方の片側など）。
fn nonzero(value: i64) -> Cell {
    if value == 0 {
        Cell::Empty
    } else {
        Cell::Amount(value)
    }
}

/// 摘要の欄。メモと取引先を「 / 」でつなぐ。同じものは 1 回だけ書く。
fn describe(parts: impl IntoIterator<Item = String>) -> Cell {
    let mut unique: Vec<String> = Vec::new();
    for part in parts {
        if !part.is_empty() && !unique.contains(&part) {
            unique.push(part);
        }
    }
    let parts = unique;
    text(parts.join(" / "))
}

fn report(title: &l::Text, ctx: &Context, sections: Vec<Section>) -> Report {
    Report {
        title: title.get(ctx.locale).to_string(),
        business: ctx.business.clone(),
        period: l::period(&ctx.from, &ctx.to, ctx.locale),
        sections,
        footnote: None,
        locale: ctx.locale,
    }
}

/// 仕訳帳。1 つの取引を、借方と貸方を左右に並べた行で書く。
pub fn journal(book: &JournalBook, names: &Names, ctx: &Context) -> Report {
    let locale = ctx.locale;
    let mut rows = Vec::new();
    for (group, t) in book.transactions.iter().enumerate() {
        let debits: Vec<_> = t.lines.iter().filter(|x| x.side == Side::Debit).collect();
        let credits: Vec<_> = t.lines.iter().filter(|x| x.side == Side::Credit).collect();
        for i in 0..debits.len().max(credits.len()) {
            let (d, c) = (debits.get(i), credits.get(i));
            let mut memo = Vec::new();
            if i == 0 {
                memo.push(t.memo.clone());
            }
            for line in [d, c].into_iter().flatten() {
                memo.push(names.partner_name(line.partner_id));
                memo.push(line.memo.clone());
            }
            rows.push(Row {
                cells: vec![
                    if i == 0 {
                        Cell::Date(t.date.clone())
                    } else {
                        Cell::Empty
                    },
                    d.map_or(Cell::Empty, |x| text(names.account_label(x.account_id))),
                    d.map_or(Cell::Empty, |x| Cell::Amount(x.amount)),
                    c.map_or(Cell::Empty, |x| text(names.account_label(x.account_id))),
                    c.map_or(Cell::Empty, |x| Cell::Amount(x.amount)),
                    describe(memo),
                ],
                group,
                style: RowStyle::Normal,
            });
        }
    }
    rows.push(Row {
        cells: vec![
            text(l::TOTAL.get(locale)),
            Cell::Empty,
            Cell::Amount(book.total_debit),
            Cell::Empty,
            Cell::Amount(book.total_credit),
            Cell::Empty,
        ],
        group: usize::MAX,
        style: RowStyle::Emphasis,
    });
    report(
        &l::JOURNAL,
        ctx,
        vec![Section {
            heading: None,
            columns: vec![
                column(&l::DATE, locale, 7.0, ColumnKind::Text),
                column(&l::DEBIT_ACCOUNT, locale, 17.0, ColumnKind::Text),
                column(&l::DEBIT_AMOUNT, locale, 12.0, ColumnKind::Sum),
                column(&l::CREDIT_ACCOUNT, locale, 17.0, ColumnKind::Text),
                column(&l::CREDIT_AMOUNT, locale, 12.0, ColumnKind::Sum),
                column(&l::MEMO, locale, 35.0, ColumnKind::Text),
            ],
            rows,
            carry_label_column: Some(1),
        }],
    )
}

/// 元帳の種類。列の見出しが変わる。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LedgerKind {
    General,
    /// 現金出納帳・預金出納帳。借方・貸方を入金・出金と書く
    Cash,
    Expense,
}

/// 総勘定元帳・出納帳・経費帳。科目ごとに節を分ける。
pub fn ledgers(kind: LedgerKind, ledgers: &[Ledger], names: &Names, ctx: &Context) -> Report {
    let locale = ctx.locale;
    let (title, debit, credit) = match kind {
        LedgerKind::General => (&l::GENERAL_LEDGER, &l::DEBIT, &l::CREDIT),
        LedgerKind::Cash => (&l::CASH_BOOK, &l::DEPOSIT, &l::WITHDRAWAL),
        LedgerKind::Expense => (&l::EXPENSE_BOOK, &l::DEBIT, &l::CREDIT),
    };
    let carried = if ctx.from_year_start {
        &l::OPENING_CARRIED
    } else {
        &l::MONTH_CARRIED
    };
    let sections = ledgers
        .iter()
        .map(|ledger| {
            let mut rows = vec![Row {
                cells: vec![
                    Cell::Date(ctx.from.clone()),
                    Cell::Empty,
                    text(carried.get(locale)),
                    Cell::Empty,
                    Cell::Empty,
                    Cell::Amount(ledger.brought_forward),
                ],
                group: 0,
                style: RowStyle::Normal,
            }];
            rows.extend(ledger.rows.iter().enumerate().map(|(i, r)| Row {
                cells: vec![
                    Cell::Date(r.date.clone()),
                    text(names.counter(r.counter_account_id)),
                    describe([r.memo.clone(), names.partner_name(r.partner_id)]),
                    nonzero(r.debit),
                    nonzero(r.credit),
                    Cell::Amount(r.balance),
                ],
                group: i + 1,
                style: RowStyle::Normal,
            }));
            rows.push(Row {
                cells: vec![
                    text(l::TOTAL.get(locale)),
                    Cell::Empty,
                    Cell::Empty,
                    Cell::Amount(ledger.total_debit),
                    Cell::Amount(ledger.total_credit),
                    Cell::Amount(ledger.closing_balance),
                ],
                group: usize::MAX,
                style: RowStyle::Emphasis,
            });
            Section {
                heading: Some(names.account_label(ledger.account_id)),
                columns: vec![
                    column(&l::DATE, locale, 7.0, ColumnKind::Text),
                    column(&l::COUNTER_ACCOUNT, locale, 15.0, ColumnKind::Text),
                    column(&l::MEMO, locale, 36.0, ColumnKind::Text),
                    column(debit, locale, 13.0, ColumnKind::Sum),
                    column(credit, locale, 13.0, ColumnKind::Sum),
                    column(&l::BALANCE, locale, 14.0, ColumnKind::Balance),
                ],
                rows,
                carry_label_column: Some(2),
            }
        })
        .collect();
    report(title, ctx, sections)
}

/// 合計残高試算表。区分ごとに小計を入れる。
pub fn trial_balance(tb: &TrialBalance, names: &Names, ctx: &Context) -> Report {
    let locale = ctx.locale;
    let mut rows = Vec::new();
    for category in AccountCategory::ALL {
        let accounts: Vec<_> = tb.rows.iter().filter(|r| r.category == *category).collect();
        let Some(total) = tb.categories.iter().find(|c| c.category == *category) else {
            continue;
        };
        if accounts.is_empty() {
            continue;
        }
        let group = rows.len();
        for r in accounts {
            rows.push(Row {
                cells: vec![
                    text(names.account_label(r.account_id)),
                    Cell::Amount(r.brought_forward),
                    Cell::Amount(r.debit),
                    Cell::Amount(r.credit),
                    Cell::Amount(r.balance),
                ],
                group,
                style: RowStyle::Normal,
            });
        }
        rows.push(Row {
            cells: vec![
                text(format!(
                    "{} {}",
                    l::category(*category, locale),
                    l::TOTAL.get(locale)
                )),
                Cell::Amount(total.brought_forward),
                Cell::Amount(total.debit),
                Cell::Amount(total.credit),
                Cell::Amount(total.balance),
            ],
            group,
            style: RowStyle::Emphasis,
        });
    }
    rows.push(Row {
        cells: vec![
            text(l::TOTAL.get(locale)),
            Cell::Empty,
            Cell::Amount(tb.total_debit),
            Cell::Amount(tb.total_credit),
            Cell::Empty,
        ],
        group: usize::MAX,
        style: RowStyle::Emphasis,
    });
    let mut r = report(
        &l::TRIAL_BALANCE,
        ctx,
        vec![Section {
            heading: None,
            columns: vec![
                column(&l::ACCOUNT, locale, 32.0, ColumnKind::Text),
                column(&l::BROUGHT_FORWARD, locale, 17.0, ColumnKind::Amount),
                column(&l::DEBIT, locale, 17.0, ColumnKind::Amount),
                column(&l::CREDIT, locale, 17.0, ColumnKind::Amount),
                column(&l::BALANCE, locale, 17.0, ColumnKind::Amount),
            ],
            rows,
            carry_label_column: None,
        }],
    );
    r.footnote = Some(format!(
        "{}: {}",
        l::PRE_TAX_INCOME.get(locale),
        l::amount(tb.pre_tax_income)
    ));
    r
}

fn simple_section(
    heading: &l::Text,
    locale: Locale,
    columns: Vec<Column>,
    rows: Vec<Row>,
) -> Section {
    Section {
        heading: Some(heading.get(locale).to_string()),
        columns,
        rows,
        carry_label_column: None,
    }
}

fn plain(cells: Vec<Cell>, group: usize, emphasis: bool) -> Row {
    Row {
        cells,
        group,
        style: if emphasis {
            RowStyle::Emphasis
        } else {
            RowStyle::Normal
        },
    }
}

/// 青色申告決算書（一般用）に転記する金額の一覧。損益計算書・月別売上・内訳・減価償却費の計算・貸借対照表。
pub fn statement(amounts: &StatementAmounts, names: &Names, ctx: &Context) -> Report {
    let locale = ctx.locale;
    let pick = |ja: &str, en: &str| {
        if locale == Locale::En && !en.is_empty() {
            en.to_string()
        } else {
            ja.to_string()
        }
    };
    let s = &amounts.statement;
    let mut sections = Vec::new();

    let pl_rows =
        s.pl.iter()
            .enumerate()
            .map(|(i, line)| {
                plain(
                    vec![
                        text(line.no.clone()),
                        text(pick(&line.label_ja, &line.label_en)),
                        Cell::Amount(line.amount),
                    ],
                    i,
                    line.total,
                )
            })
            .collect();
    sections.push(simple_section(
        &l::PROFIT_AND_LOSS,
        locale,
        vec![
            column(&l::LINE_NO, locale, 8.0, ColumnKind::Text),
            column(&l::ITEM, locale, 62.0, ColumnKind::Text),
            column(&l::AMOUNT, locale, 30.0, ColumnKind::Amount),
        ],
        pl_rows,
    ));

    let mut monthly: Vec<Row> = amounts
        .monthly
        .iter()
        .map(|m| {
            plain(
                vec![
                    text(format!("{}", m.month)),
                    Cell::Amount(m.sales),
                    Cell::Amount(m.purchases),
                ],
                m.month as usize,
                false,
            )
        })
        .collect();
    let (sales, purchases): (i64, i64) = amounts
        .monthly
        .iter()
        .fold((0, 0), |(s, p), m| (s + m.sales, p + m.purchases));
    monthly.push(plain(
        vec![
            text(l::PERSONAL_CONSUMPTION.get(locale)),
            Cell::Amount(amounts.personal_consumption),
            Cell::Empty,
        ],
        13,
        false,
    ));
    monthly.push(plain(
        vec![
            text(l::MISC_INCOME.get(locale)),
            Cell::Amount(amounts.misc_income),
            Cell::Empty,
        ],
        14,
        false,
    ));
    monthly.push(plain(
        vec![
            text(l::TOTAL.get(locale)),
            Cell::Amount(sales + amounts.personal_consumption + amounts.misc_income),
            Cell::Amount(purchases),
        ],
        15,
        true,
    ));
    sections.push(simple_section(
        &l::MONTHLY_SALES,
        locale,
        vec![
            column(&l::MONTH, locale, 30.0, ColumnKind::Text),
            column(&l::SALES, locale, 35.0, ColumnKind::Amount),
            column(&l::PURCHASES, locale, 35.0, ColumnKind::Amount),
        ],
        monthly,
    ));

    let mut breakdown = Vec::new();
    for b in &amounts.breakdowns {
        let label = match b.key.as_str() {
            "wages" => &l::WAGES,
            "rent" => &l::RENT,
            _ => &l::INTEREST,
        };
        for r in &b.rows {
            let payee = match r.partner_id {
                Some(_) => names.partner_name(r.partner_id),
                None => l::NO_PARTNER.get(locale).to_string(),
            };
            breakdown.push(plain(
                vec![text(label.get(locale)), text(payee), Cell::Amount(r.amount)],
                breakdown.len(),
                false,
            ));
        }
    }
    sections.push(simple_section(
        &l::BREAKDOWNS,
        locale,
        vec![
            column(&l::ACCOUNT, locale, 30.0, ColumnKind::Text),
            column(&l::PAYEE, locale, 40.0, ColumnKind::Text),
            column(&l::AMOUNT, locale, 30.0, ColumnKind::Amount),
        ],
        breakdown,
    ));

    let method = |m: Method| match m {
        Method::StraightLine => l::STRAIGHT_LINE.get(locale),
        Method::DecliningBalance => l::DECLINING_BALANCE.get(locale),
        Method::LumpSum => l::LUMP_SUM.get(locale),
        Method::SmallAsset => l::SMALL_ASSET.get(locale),
    };
    let rate = |r: i64| {
        if r == 0 {
            Cell::Empty
        } else {
            text(format!("{}.{:03}", r / 1000, r % 1000))
        }
    };
    let mut dep: Vec<Row> = amounts
        .depreciation
        .iter()
        .enumerate()
        .map(|(i, d)| {
            let years = if d.useful_life > 0 {
                format!(" {}", d.useful_life)
            } else {
                String::new()
            };
            plain(
                vec![
                    text(d.name.clone()),
                    text(d.acquired_on.get(..7).unwrap_or(&d.acquired_on).to_string()),
                    Cell::Amount(d.cost),
                    text(format!("{}{years}", method(d.method))),
                    rate(d.rate),
                    text(format!("{}/12", d.months)),
                    Cell::Amount(d.depreciation),
                    text(format!("{}%", d.business_percent)),
                    Cell::Amount(d.business),
                    Cell::Amount(d.closing_book_value),
                ],
                i,
                false,
            )
        })
        .collect();
    let (dep_total, business_total) = amounts
        .depreciation
        .iter()
        .fold((0, 0), |(a, b), d| (a + d.depreciation, b + d.business));
    dep.push(plain(
        vec![
            text(l::TOTAL.get(locale)),
            Cell::Empty,
            Cell::Empty,
            Cell::Empty,
            Cell::Empty,
            Cell::Empty,
            Cell::Amount(dep_total),
            Cell::Empty,
            Cell::Amount(business_total),
            Cell::Empty,
        ],
        usize::MAX,
        true,
    ));
    sections.push(simple_section(
        &l::DEPRECIATION_CALC,
        locale,
        vec![
            column(&l::ASSET_NAME, locale, 16.0, ColumnKind::Text),
            column(&l::ACQUIRED, locale, 9.0, ColumnKind::Text),
            column(&l::COST, locale, 11.0, ColumnKind::Amount),
            column(&l::METHOD_YEARS, locale, 11.0, ColumnKind::Text),
            column(&l::RATE, locale, 7.0, ColumnKind::Text),
            column(&l::MONTHS, locale, 6.0, ColumnKind::Text),
            column(&l::DEPRECIATION_AMOUNT, locale, 11.0, ColumnKind::Amount),
            column(&l::BUSINESS_PERCENT, locale, 7.0, ColumnKind::Text),
            column(&l::BUSINESS_AMOUNT, locale, 11.0, ColumnKind::Amount),
            column(&l::BOOK_VALUE, locale, 11.0, ColumnKind::Amount),
        ],
        dep,
    ));

    let amount_or_blank = |v: Option<i64>| v.map_or(Cell::Empty, Cell::Amount);
    let mut bs: Vec<Row> = Vec::new();
    for side in [BsSide::Asset, BsSide::Liability] {
        for line in s.bs.iter().filter(|l| l.side == side) {
            if line.opening.unwrap_or(0) == 0 && line.closing == 0 {
                continue;
            }
            bs.push(plain(
                vec![
                    text(pick(&line.label_ja, &line.label_en)),
                    amount_or_blank(line.opening),
                    Cell::Amount(line.closing),
                ],
                bs.len(),
                false,
            ));
        }
        let (label, total) = match side {
            BsSide::Asset => (&l::ASSET_TOTAL, s.asset_total),
            BsSide::Liability => (&l::LIABILITY_TOTAL, s.liability_total),
        };
        bs.push(plain(
            vec![
                text(label.get(locale)),
                Cell::Amount(total.opening),
                Cell::Amount(total.closing),
            ],
            bs.len(),
            true,
        ));
    }
    sections.push(simple_section(
        &l::BALANCE_SHEET,
        locale,
        vec![
            column(&l::ITEM, locale, 50.0, ColumnKind::Text),
            column(&l::OPENING, locale, 25.0, ColumnKind::Amount),
            column(&l::CLOSING, locale, 25.0, ColumnKind::Amount),
        ],
        bs,
    ));

    let mut r = report(&l::STATEMENT, ctx, sections);
    r.footnote = Some(l::STATEMENT_NOTE.get(locale).to_string());
    r
}

/// 節の行をページに割る。`capacity` は 1 ページに置ける行の数（繰越の行を含む）。
///
/// - `carry` なら、続きのあるページの最後に「次頁へ繰越」、続きのページの最初に
///   「前頁より繰越」の行を置く分を空ける
/// - 同じまとまり（`group`）の行は、1 ページに収まるならページをまたがせない
/// - 行がなくても 1 ページは作る
pub fn paginate(groups: &[usize], capacity: usize, carry: bool) -> Vec<Range<usize>> {
    // 繰越の 2 行を置いても 1 行は入るようにする
    let capacity = capacity.max(if carry { 3 } else { 1 });
    let mut pages = Vec::new();
    let mut start = 0;
    loop {
        let carry_in = usize::from(carry && start > 0);
        let available = capacity - carry_in;
        if groups.len() - start <= available {
            pages.push(start..groups.len());
            return pages;
        }
        let available = available - usize::from(carry);
        let mut end = start + available;
        // まとまりの途中で切れるなら、まとまりの初めまで戻す（そのまとまりが 1 ページに収まるとき）
        let group = groups[end];
        if groups[end - 1] == group {
            let group_start = (start..end)
                .rev()
                .find(|&i| groups[i] != group)
                .map_or(start, |i| i + 1);
            let group_len = groups[group_start..]
                .iter()
                .take_while(|&&g| g == group)
                .count();
            if group_start > start && group_len <= capacity - usize::from(carry) * 2 {
                end = group_start;
            }
        }
        pages.push(start..end);
        start = end;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rows_fit_on_one_page() {
        let pages = paginate(&[0, 1, 2], 10, true);
        assert_eq!((pages.len(), &pages[0]), (1, &(0..3)));
        let pages = paginate(&[], 10, true);
        assert_eq!((pages.len(), &pages[0]), (1, &(0..0)));
    }

    #[test]
    fn pages_leave_room_for_carry_rows() {
        let groups: Vec<usize> = (0..20).collect();
        // 1 ページ目: 9 行 + 次頁へ、2 ページ目: 前頁より + 8 行 + 次頁へ、3 ページ目: 前頁より + 3 行
        assert_eq!(paginate(&groups, 10, true), [0..9, 9..17, 17..20]);
        // 繰越なし
        assert_eq!(paginate(&groups, 10, false), [0..10, 10..20]);
    }

    #[test]
    fn the_last_page_needs_no_carry_out_row() {
        let groups: Vec<usize> = (0..19).collect();
        // 2 ページ目は 前頁より + 10 行 で埋まる
        assert_eq!(paginate(&groups, 11, true), [0..10, 10..19]);
    }

    #[test]
    fn groups_are_kept_on_one_page() {
        // 取引 0〜3 は 2 行ずつ。1 ページに 6 行（繰越を含む）
        let groups = [0, 0, 1, 1, 2, 2, 3, 3];
        // 1 ページ目に入るのは 5 行だが、取引 2 の途中で切らずに 4 行で改ページ
        assert_eq!(paginate(&groups, 6, true), [0..4, 4..8]);
    }

    #[test]
    fn groups_larger_than_a_page_are_split() {
        let groups = [0, 1, 1, 1, 1, 1, 1, 1, 1];
        let pages = paginate(&groups, 5, true);
        assert_eq!(pages[0], 0..4);
        assert_eq!(pages.last().unwrap().end, groups.len());
        // どのページも、繰越の行を足して 5 行以内
        for (i, p) in pages.iter().enumerate() {
            let carry = usize::from(i > 0) + usize::from(i + 1 < pages.len());
            assert!(p.len() + carry <= 5, "{p:?}");
            assert!(!p.is_empty());
        }
    }
}
