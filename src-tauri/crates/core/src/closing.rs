//! 決算の計算: 期首残高の貸借、決算書（青色申告決算書・一般用）の金額、年度の繰越。
//!
//! 決算書の行の並びと、どの科目をどの行に足すかは、年度ごとのデータ
//! （`data/blue_general.json`）で持つ。ここは、そのデータに従って足し引きするだけにする。
//! 国税庁の様式・公開資料との照合記録は `docs/TAX_VALIDATION.md`。

use super::master::{AccountCategory, FilingType};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::OnceLock;

/// 期首残高の貸借。資産の合計と、負債・資本の合計。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpeningTotals {
    pub assets: i64,
    pub liabilities_and_capital: i64,
    pub balanced: bool,
}

/// 期首残高（区分の向きで正）の合計。資産・負債・資本の科目だけを数える。
pub fn opening_totals(rows: &[(AccountCategory, i64)]) -> OpeningTotals {
    let (mut assets, mut other) = (0, 0);
    for (category, amount) in rows {
        match category {
            AccountCategory::Asset => assets += amount,
            AccountCategory::Liability | AccountCategory::Equity => other += amount,
            _ => {}
        }
    }
    OpeningTotals {
        assets,
        liabilities_and_capital: other,
        balanced: assets == other,
    }
}

/// 翌年の期首の元入金。`翌期首元入金 = 期末元入金 + 青色控除前所得 + 事業主借 − 事業主貸`
pub fn next_capital(
    capital: i64,
    income_before_deduction: i64,
    contributions: i64,
    drawings: i64,
) -> i64 {
    capital + income_before_deduction + contributions - drawings
}

#[derive(Debug, Clone, Deserialize)]
struct PlLineDef {
    key: String,
    no: String,
    ja: String,
    en: String,
    #[serde(default)]
    sum: Vec<String>,
    #[serde(default)]
    formula: Vec<String>,
    #[serde(default)]
    negate: bool,
    #[serde(default)]
    total: bool,
    #[serde(default)]
    expense: bool,
    #[serde(default)]
    blank: bool,
    #[serde(default)]
    overflow: bool,
    #[serde(default)]
    sum_of_expenses: bool,
    #[serde(default)]
    deduction: bool,
}

#[derive(Debug, Clone, Deserialize)]
struct BsLineDef {
    key: String,
    side: Side,
    ja: String,
    en: String,
    #[serde(default)]
    sum: Vec<String>,
    #[serde(default)]
    unassigned: bool,
    #[serde(default)]
    income: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Side {
    Asset,
    Liability,
}

#[derive(Debug, Clone, Deserialize)]
struct Layout {
    from_year: i64,
    deduction: HashMap<String, i64>,
    fallback: HashMap<String, String>,
    pl: Vec<PlLineDef>,
    bs: Vec<BsLineDef>,
}

fn layouts() -> &'static [Layout] {
    static LAYOUTS: OnceLock<Vec<Layout>> = OnceLock::new();
    LAYOUTS.get_or_init(|| {
        vec![serde_json::from_str(include_str!("data/blue_general.json"))
            .expect("同梱の決算書の様式が読めない")]
    })
}

/// 年度 `year` に使う様式。その年より前に始まった様式のうち最も新しいもの。
fn layout_for(year: i64) -> &'static Layout {
    let all = layouts();
    all.iter()
        .filter(|l| l.from_year <= year)
        .max_by_key(|l| l.from_year)
        .unwrap_or(&all[0])
}

/// 決算書に使う科目の数字。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AccountFigure {
    pub account_id: i64,
    pub category: AccountCategory,
    pub statement_line: Option<String>,
    pub name_ja: String,
    pub name_en: String,
    /// 期首残高（資産・負債・資本だけ。区分の向きで正）
    pub opening: i64,
    /// 期末残高（損益の科目は年間の額）
    pub closing: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlLine {
    pub key: String,
    /// 様式の欄の番号（①など）。分からない欄は空
    pub no: String,
    pub label_ja: String,
    pub label_en: String,
    pub amount: i64,
    /// 小計・合計の行
    pub total: bool,
    /// この行に足した科目
    pub account_ids: Vec<i64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BsLine {
    pub key: String,
    pub side: Side,
    pub label_ja: String,
    pub label_en: String,
    /// 期首。事業主貸・事業主借・所得の行は期首を書かない（`None`）
    pub opening: Option<i64>,
    pub closing: i64,
    pub account_ids: Vec<i64>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Pair {
    pub opening: i64,
    pub closing: i64,
}

/// 決算書の金額を確かめた結果、直すところ。
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StatementIssue {
    pub code: StatementIssueCode,
    /// 件数や科目名など
    #[serde(skip_serializing_if = "Option::is_none")]
    pub value: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum StatementIssueCode {
    /// 期首残高の資産の合計と、負債・資本の合計が合わない
    OpeningUnbalanced,
    /// 期末の資産の合計と、負債・資本の合計が合わない
    ClosingUnbalanced,
    /// 損益計算書の所得と、帳簿の所得が合わない
    IncomeMismatch,
    /// 決算書にない経費の科目が多く、空欄に収まらない分を雑費に足した
    ExpensesMerged,
    /// 期首に事業主貸・事業主借の残高がある（年度の初めは 0 にする）
    OwnerOpening,
    /// 白色で専従者給与を経費から除外した
    WhiteFiling,
    /// 保存後の取引変更などで専従者控除が控除前所得を超えた
    WhiteDeductionExceedsIncome,
    /// 年末の残高がマイナスの資産・負債の行がある（固定資産の購入の記録漏れなど）。
    /// `value` は行のキーをカンマでつないだもの
    NegativeBalance,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Statement {
    pub pl: Vec<PlLine>,
    pub bs: Vec<BsLine>,
    pub asset_total: Pair,
    pub liability_total: Pair,
    pub income_before_deduction: i64,
    pub deduction: i64,
    pub income: i64,
    pub issues: Vec<StatementIssue>,
}

fn issue(code: StatementIssueCode, value: Option<String>) -> StatementIssue {
    StatementIssue { code, value }
}

/// 決算書の金額を作る。`pre_tax_income` は試算表の所得（突き合わせに使う）。
pub fn statement(
    year: i64,
    filing_type: FilingType,
    figures: &[AccountFigure],
    pre_tax_income: i64,
) -> Statement {
    let layout = if filing_type == FilingType::White {
        static WHITE: OnceLock<Layout> = OnceLock::new();
        WHITE.get_or_init(|| {
            serde_json::from_str(include_str!("data/white_general.json"))
                .expect("同梱の収支内訳書の様式が読めない")
        })
    } else {
        layout_for(year)
    };
    let mut issues = Vec::new();

    // 科目を行に割り当てる。決算書の行のキーが様式にない科目は、区分ごとの受け皿へ
    let pl_keys: HashMap<&str, &str> = layout
        .pl
        .iter()
        .flat_map(|l| l.sum.iter().map(move |s| (s.as_str(), l.key.as_str())))
        .collect();
    let mut pl_accounts: HashMap<String, Vec<&AccountFigure>> = HashMap::new();
    let mut custom_expenses: Vec<&AccountFigure> = Vec::new();
    for f in figures.iter().filter(|f| {
        matches!(
            f.category,
            AccountCategory::Revenue | AccountCategory::Cogs | AccountCategory::Expense
        ) && !(filing_type == FilingType::White
            && f.statement_line.as_deref() == Some("pl.family_employee_salaries"))
    }) {
        let line = f
            .statement_line
            .as_deref()
            .and_then(|s| pl_keys.get(s))
            .map(|s| s.to_string());
        match (line, f.category) {
            (Some(key), _) => pl_accounts.entry(key).or_default().push(f),
            (None, AccountCategory::Expense) => custom_expenses.push(f),
            (None, category) => {
                let key = layout
                    .fallback
                    .get(category.as_str())
                    .cloned()
                    .unwrap_or_default();
                pl_accounts.entry(key).or_default().push(f);
            }
        }
    }
    // 決算書にない経費の科目は、動きのあるものを空欄の行に書く。収まらない分は雑費へ
    custom_expenses.retain(|f| f.closing != 0);
    let blanks: Vec<&PlLineDef> = layout.pl.iter().filter(|l| l.blank).collect();
    let overflow_key = layout.pl.iter().find(|l| l.overflow).map(|l| l.key.clone());
    let mut blank_names: HashMap<String, (String, String)> = HashMap::new();
    for (i, f) in custom_expenses.iter().enumerate() {
        match blanks.get(i) {
            Some(slot) => {
                blank_names.insert(slot.key.clone(), (f.name_ja.clone(), f.name_en.clone()));
                pl_accounts.entry(slot.key.clone()).or_default().push(f);
            }
            None => {
                if let Some(key) = &overflow_key {
                    pl_accounts.entry(key.clone()).or_default().push(f);
                }
            }
        }
    }
    if custom_expenses.len() > blanks.len() {
        issues.push(issue(
            StatementIssueCode::ExpensesMerged,
            Some((custom_expenses.len() - blanks.len()).to_string()),
        ));
    }

    let mut values: HashMap<String, i64> = HashMap::new();
    let mut pl = Vec::new();
    for def in &layout.pl {
        let accounts = pl_accounts.get(&def.key).cloned().unwrap_or_default();
        let amount = if def.sum_of_expenses {
            layout
                .pl
                .iter()
                .filter(|l| l.expense)
                .map(|l| values.get(&l.key).copied().unwrap_or(0))
                .sum()
        } else if def.deduction {
            let limit = layout
                .deduction
                .get(filing_type.as_str())
                .copied()
                .unwrap_or(0);
            let before = values.get("income_before_deduction").copied().unwrap_or(0);
            limit.min(before.max(0))
        } else if !def.formula.is_empty() {
            def.formula
                .iter()
                .map(|term| {
                    let (sign, key) = term.split_at(1);
                    let v = values.get(key).copied().unwrap_or(0);
                    if sign == "-" {
                        -v
                    } else {
                        v
                    }
                })
                .sum()
        } else {
            let sum: i64 = accounts.iter().map(|f| f.closing).sum();
            if def.negate {
                -sum
            } else {
                sum
            }
        };
        values.insert(def.key.clone(), amount);
        let (label_ja, label_en) = blank_names
            .get(&def.key)
            .cloned()
            .unwrap_or_else(|| (def.ja.clone(), def.en.clone()));
        pl.push(PlLine {
            key: def.key.clone(),
            no: def.no.clone(),
            label_ja,
            label_en,
            amount,
            total: def.total,
            account_ids: accounts.iter().map(|f| f.account_id).collect(),
        });
    }
    let income_before_deduction = values.get("income_before_deduction").copied().unwrap_or(0);
    let deduction = values.get("deduction").copied().unwrap_or(0);
    let income = values.get("income").copied().unwrap_or(0);
    let family_salaries: i64 = figures
        .iter()
        .filter(|f| f.statement_line.as_deref() == Some("pl.family_employee_salaries"))
        .map(|f| f.closing)
        .sum();
    let expected_income = pre_tax_income
        + if filing_type == FilingType::White {
            family_salaries
        } else {
            0
        };
    if income_before_deduction != expected_income {
        issues.push(issue(StatementIssueCode::IncomeMismatch, None));
    }
    if filing_type == FilingType::White && family_salaries != 0 {
        issues.push(issue(StatementIssueCode::WhiteFiling, None));
    }

    // 貸借対照表
    let bs_keys: HashMap<&str, &str> = layout
        .bs
        .iter()
        .flat_map(|l| l.sum.iter().map(move |s| (s.as_str(), l.key.as_str())))
        .collect();
    let unassigned = |side: Side| {
        layout
            .bs
            .iter()
            .find(|l| l.unassigned && l.side == side)
            .map(|l| l.key.as_str())
    };
    let mut bs_accounts: HashMap<&str, Vec<&AccountFigure>> = HashMap::new();
    for f in figures.iter().filter(|f| {
        matches!(
            f.category,
            AccountCategory::Asset | AccountCategory::Liability | AccountCategory::Equity
        )
    }) {
        let side = if f.category == AccountCategory::Asset {
            Side::Asset
        } else {
            Side::Liability
        };
        let key = f
            .statement_line
            .as_deref()
            .and_then(|s| bs_keys.get(s).copied())
            .or_else(|| unassigned(side));
        if let Some(key) = key {
            bs_accounts.entry(key).or_default().push(f);
        }
    }
    let owner_keys = ["owner_drawings", "owner_contributions"];
    let mut bs = Vec::new();
    let mut asset_total = Pair {
        opening: 0,
        closing: 0,
    };
    let mut liability_total = Pair {
        opening: 0,
        closing: 0,
    };
    for def in &layout.bs {
        let accounts = bs_accounts
            .get(def.key.as_str())
            .cloned()
            .unwrap_or_default();
        let (opening, closing) = if def.income {
            (
                None,
                if filing_type == FilingType::White {
                    pre_tax_income
                } else {
                    income_before_deduction
                },
            )
        } else {
            let opening: i64 = accounts.iter().map(|f| f.opening).sum();
            let closing: i64 = accounts.iter().map(|f| f.closing).sum();
            if owner_keys.contains(&def.key.as_str()) {
                if opening != 0 {
                    issues.push(issue(StatementIssueCode::OwnerOpening, None));
                }
                (None, closing)
            } else {
                (Some(opening), closing)
            }
        };
        let total = match def.side {
            Side::Asset => &mut asset_total,
            Side::Liability => &mut liability_total,
        };
        total.opening += opening.unwrap_or(0);
        total.closing += closing;
        bs.push(BsLine {
            key: def.key.clone(),
            side: def.side,
            label_ja: def.ja.clone(),
            label_en: def.en.clone(),
            opening,
            closing,
            account_ids: accounts.iter().map(|f| f.account_id).collect(),
        });
    }
    let negative: Vec<&str> = bs
        .iter()
        .filter(|l| {
            l.closing < 0
                && l.opening.is_some()
                && !owner_keys.contains(&l.key.as_str())
                && !l.account_ids.is_empty()
        })
        .map(|l| l.key.as_str())
        .collect();
    if !negative.is_empty() {
        issues.push(issue(
            StatementIssueCode::NegativeBalance,
            Some(negative.join(",")),
        ));
    }
    if asset_total.opening != liability_total.opening {
        issues.push(issue(StatementIssueCode::OpeningUnbalanced, None));
    }
    if asset_total.closing != liability_total.closing {
        issues.push(issue(StatementIssueCode::ClosingUnbalanced, None));
    }

    Statement {
        pl,
        bs,
        asset_total,
        liability_total,
        income_before_deduction,
        deduction,
        income,
        issues,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use AccountCategory::*;

    fn f(
        id: i64,
        category: AccountCategory,
        line: Option<&str>,
        opening: i64,
        closing: i64,
    ) -> AccountFigure {
        AccountFigure {
            account_id: id,
            category,
            statement_line: line.map(str::to_string),
            name_ja: format!("科目{id}"),
            name_en: String::new(),
            opening,
            closing,
        }
    }

    fn amount(s: &Statement, key: &str) -> i64 {
        s.pl.iter().find(|l| l.key == key).unwrap().amount
    }

    fn bs(s: &Statement, key: &str) -> (Option<i64>, i64) {
        let l = s.bs.iter().find(|l| l.key == key).unwrap();
        (l.opening, l.closing)
    }

    /// 期首: 現金 100,000 / 元入金 100,000。
    /// 年間: 売上 1,000,000（普通預金）、仕入 300,000（期首棚卸 50,000・期末棚卸 80,000）、
    /// 消耗品 20,000、減価償却 45,000、自分で足した経費「新聞図書費」12,000、専従者給与 100,000、
    /// 事業主貸 200,000・事業主借 30,000。
    fn figures() -> Vec<AccountFigure> {
        vec![
            f(1, Asset, Some("bs.cash"), 100_000, 100_000),
            f(2, Asset, Some("bs.other_deposits"), 0, 337_000),
            f(3, Asset, Some("bs.inventory"), 50_000, 80_000),
            f(4, Asset, Some("bs.tools_equipment"), 0, 195_000),
            f(5, Asset, Some("bs.owner_drawings"), 0, 200_000),
            f(6, Equity, Some("bs.owner_contributions"), 0, 30_000),
            f(7, Equity, Some("bs.capital"), 150_000, 150_000),
            f(8, Revenue, Some("pl.sales"), 0, 1_000_000),
            f(9, Cogs, Some("pl.opening_inventory"), 0, 50_000),
            f(10, Cogs, Some("pl.purchases"), 0, 300_000),
            // 期末棚卸は貸方に立つので、売上原価の区分では負の残高
            f(11, Cogs, Some("pl.closing_inventory"), 0, -80_000),
            f(12, Expense, Some("pl.supplies"), 0, 20_000),
            f(13, Expense, Some("pl.depreciation"), 0, 45_000),
            f(14, Expense, None, 0, 12_000),
            f(15, Expense, Some("pl.family_employee_salaries"), 0, 100_000),
        ]
    }

    #[test]
    fn profit_and_loss_follows_the_form() {
        let figures = figures();
        // 1,000,000 − (50,000 + 300,000 − 80,000) − (20,000 + 45,000 + 12,000) − 100,000
        let income = 553_000;
        let s = statement(2026, FilingType::Blue65, &figures, income);
        assert_eq!(amount(&s, "sales"), 1_000_000);
        assert_eq!(amount(&s, "cogs_subtotal"), 350_000);
        assert_eq!(amount(&s, "closing_inventory"), 80_000);
        assert_eq!(amount(&s, "cogs"), 270_000);
        assert_eq!(amount(&s, "gross_profit"), 730_000);
        assert_eq!(amount(&s, "expenses"), 77_000);
        assert_eq!(amount(&s, "net"), 653_000);
        assert_eq!(s.income_before_deduction, income);
        // 65 万円控除
        assert_eq!((s.deduction, s.income), (553_000, 0));
        // 決算書にない経費は空欄の行に、科目名で書く
        let blank = s.pl.iter().find(|l| l.key == "blank1").unwrap();
        assert_eq!((blank.label_ja.as_str(), blank.amount), ("科目14", 12_000));
        assert_eq!(s.pl.iter().find(|l| l.key == "sales").unwrap().no, "①");
    }

    #[test]
    fn deduction_is_capped_by_filing_type() {
        let figures = figures();
        let s = statement(2026, FilingType::Blue10, &figures, 553_000);
        assert_eq!((s.deduction, s.income), (100_000, 453_000));
        let white = statement(2026, FilingType::White, &figures, 553_000);
        assert_eq!(white.deduction, 0);
        assert_eq!(white.income, 653_000);
        assert_eq!(white.liability_total, s.liability_total);
        assert!(!white
            .issues
            .iter()
            .any(|i| matches!(i.code, StatementIssueCode::IncomeMismatch)));
        assert!(white
            .issues
            .iter()
            .any(|i| i.code == StatementIssueCode::WhiteFiling));
    }

    #[test]
    fn balance_sheet_balances_with_income() {
        let s = statement(2026, FilingType::Blue65, &figures(), 553_000);
        // 期首: 100,000 + 50,000 = 150,000 / 元入金 150,000
        assert_eq!(s.asset_total.opening, 150_000);
        assert_eq!(s.liability_total.opening, 150_000);
        // 期末: 資産 100,000 + 337,000 + 80,000 + 195,000 + 200,000 = 912,000
        // 負債・資本: 30,000 + 150,000 + 所得 553,000 = 733,000 → 合わない（数字は作り物）
        assert_eq!(s.asset_total.closing, 912_000);
        assert_eq!(s.liability_total.closing, 733_000);
        assert!(s
            .issues
            .iter()
            .any(|i| i.code == StatementIssueCode::ClosingUnbalanced));
        // 事業主貸・事業主借と所得は期首を書かない
        assert_eq!(bs(&s, "owner_drawings"), (None, 200_000));
        assert_eq!(bs(&s, "income_before_deduction"), (None, 553_000));
        assert_eq!(bs(&s, "cash"), (Some(100_000), 100_000));
    }

    #[test]
    fn consistent_books_have_no_issues() {
        // 期首 現金 100,000 / 元入金 100,000、売上 50,000 を現金で、消耗品 10,000 を現金で
        let figures = vec![
            f(1, Asset, Some("bs.cash"), 100_000, 140_000),
            f(7, Equity, Some("bs.capital"), 100_000, 100_000),
            f(8, Revenue, Some("pl.sales"), 0, 50_000),
            f(12, Expense, Some("pl.supplies"), 0, 10_000),
        ];
        let s = statement(2026, FilingType::Blue65, &figures, 40_000);
        assert!(s.issues.is_empty(), "{:?}", s.issues);
        assert_eq!(s.asset_total.closing, 140_000);
        assert_eq!(s.liability_total.closing, 140_000);
        // 帳簿の所得と違えば知らせる
        let s = statement(2026, FilingType::Blue65, &figures, 39_999);
        assert!(s
            .issues
            .iter()
            .any(|i| i.code == StatementIssueCode::IncomeMismatch));
    }

    #[test]
    fn negative_asset_balance_is_reported() {
        // 固定資産の購入を記録しないまま減価償却した: 工具器具備品がマイナスになる
        let figures = vec![
            f(1, Asset, Some("bs.cash"), 100_000, 100_000),
            f(2, Asset, Some("bs.tools_equipment"), 0, -30_000),
            f(7, Equity, Some("bs.capital"), 100_000, 100_000),
            f(12, Expense, Some("pl.depreciation"), 0, 30_000),
        ];
        let s = statement(2026, FilingType::Blue65, &figures, -30_000);
        let negative: Vec<_> = s
            .issues
            .iter()
            .filter(|i| i.code == StatementIssueCode::NegativeBalance)
            .collect();
        assert_eq!(negative.len(), 1, "{:?}", s.issues);
        assert_eq!(negative[0].value.as_deref(), Some("tools_equipment"));
        // 所得のマイナスは知らせない
        assert!(!negative[0].value.as_deref().unwrap().contains("income"));
    }

    #[test]
    fn too_many_custom_expenses_are_merged_into_misc() {
        let mut figures: Vec<AccountFigure> = (0..8)
            .map(|i| f(100 + i, Expense, None, 0, 1_000))
            .collect();
        figures.push(f(12, Expense, Some("pl.misc_expenses"), 0, 500));
        let s = statement(2026, FilingType::Blue65, &figures, -8_500);
        assert_eq!(amount(&s, "misc_expenses"), 2_500);
        assert_eq!(amount(&s, "expenses"), 8_500);
        assert!(s.issues.iter().any(
            |i| i.code == StatementIssueCode::ExpensesMerged && i.value.as_deref() == Some("2")
        ));
    }

    #[test]
    fn opening_totals_and_capital_carry_forward() {
        let t = opening_totals(&[
            (Asset, 300_000),
            (Liability, 100_000),
            (Equity, 200_000),
            (Revenue, 5),
        ]);
        assert!(t.balanced);
        assert!(!opening_totals(&[(Asset, 1)]).balanced);
        // 期末元入金 150,000 + 所得 553,000 + 事業主借 30,000 − 事業主貸 200,000
        assert_eq!(next_capital(150_000, 553_000, 30_000, 200_000), 533_000);
    }
}

#[cfg(test)]
mod white_tests {
    use super::*;
    // 独自の数値例。欄と計算式の根拠: 国税庁・収支内訳書（一般用）
    // 令和5年分以降用、令和7年分手引き（docs/TAX_VALIDATION.md）。
    #[test]
    fn nta_white_form_subtotals_and_field_numbers() {
        use AccountCategory::*;
        let rows = [
            (Revenue, "pl.sales", 1_000_000),
            (Cogs, "pl.opening_inventory", 100_000),
            (Cogs, "pl.purchases", 300_000),
            (Cogs, "pl.closing_inventory", -80_000),
            (Expense, "pl.wages", 100_000),
            (Expense, "pl.rent", 50_000),
            (Expense, "pl.utilities", 36_000),
            (Expense, "pl.misc_expenses", 4_000),
            // 白色では専従者給与を必要経費にせず、別に専従者控除を使う。
            (Expense, "pl.family_employee_salaries", 200_000),
        ];
        let figures: Vec<_> = rows
            .iter()
            .enumerate()
            .map(|(i, (category, line, value))| AccountFigure {
                account_id: i as i64,
                category: *category,
                statement_line: Some((*line).into()),
                name_ja: (*line).into(),
                name_en: String::new(),
                opening: 0,
                closing: *value,
            })
            .collect();
        let s = statement(2026, FilingType::White, &figures, 290_000);
        for (key, no, expected) in [
            ("cogs", "⑨", 320_000),
            ("gross_profit", "⑩", 680_000),
            ("utilities", "ハ", 36_000),
            ("misc_expenses", "レ", 4_000),
            ("other_expenses", "⑰", 40_000),
            ("expenses", "⑱", 190_000),
            ("income_before_deduction", "⑲", 490_000),
            ("family_deduction", "⑳", 0),
            ("income", "㉑", 490_000),
        ] {
            let line = s.pl.iter().find(|l| l.key == key).unwrap();
            assert_eq!((line.no.as_str(), line.amount), (no, expected), "{key}");
        }
        assert!(!s
            .issues
            .iter()
            .any(|i| i.code == StatementIssueCode::IncomeMismatch));
        assert!(s
            .issues
            .iter()
            .any(|i| i.code == StatementIssueCode::WhiteFiling));
    }

    #[test]
    fn manual_startup_amortization_keeps_the_unamortized_asset() {
        use AccountCategory::*;
        // 任意償却の記帳例: 開業費120,000のうち30,000だけ償却。
        // 対象費用の適否や償却額の選択を自動判定するテストではない。
        let figures: Vec<_> = [
            (Asset, None, 120_000, 90_000),
            (Asset, Some("bs.cash"), 100_000, 100_000),
            (Liability, Some("bs.loans_payable"), 50_000, 50_000),
            (Equity, Some("bs.capital"), 170_000, 170_000),
            (Expense, Some("pl.depreciation"), 0, 30_000),
        ]
        .into_iter()
        .enumerate()
        .map(|(i, (category, line, opening, closing))| AccountFigure {
            account_id: i as i64,
            category,
            statement_line: line.map(str::to_string),
            name_ja: "Startup example".into(),
            name_en: String::new(),
            opening,
            closing,
        })
        .collect();
        let s = statement(2026, FilingType::White, &figures, -30_000);
        assert!(s.issues.is_empty());
        assert_eq!(s.income_before_deduction, -30_000);
        let amortization = s.pl.iter().find(|l| l.key == "depreciation").unwrap();
        assert_eq!(
            (amortization.no.as_str(), amortization.amount),
            ("⑬", 30_000)
        );
        assert_eq!(
            s.bs.iter()
                .find(|l| l.key == "other_assets")
                .unwrap()
                .closing,
            90_000
        );
        assert_eq!(next_capital(170_000, -30_000, 0, 0), 140_000);
    }

    #[test]
    fn white_statement_uses_white_lines_without_a_blue_deduction() {
        let figures = vec![
            AccountFigure {
                account_id: 1,
                category: AccountCategory::Revenue,
                statement_line: Some("pl.sales".into()),
                name_ja: "Sales".into(),
                name_en: "Sales".into(),
                opening: 0,
                closing: 1_000_000,
            },
            AccountFigure {
                account_id: 2,
                category: AccountCategory::Expense,
                statement_line: Some("pl.supplies".into()),
                name_ja: "Supplies".into(),
                name_en: "Supplies".into(),
                opening: 0,
                closing: 10_000,
            },
        ];
        let s = statement(2026, FilingType::White, &figures, 990_000);
        assert_eq!((s.deduction, s.income), (0, 990_000));
        assert!(!s.issues.iter().any(|issue| matches!(
            issue.code,
            StatementIssueCode::IncomeMismatch | StatementIssueCode::WhiteFiling
        )));
        assert!(s
            .pl
            .iter()
            .any(|l| l.key == "sales_only" && l.no == "①" && l.amount == 1_000_000));
        assert!(s
            .pl
            .iter()
            .any(|l| l.key == "family_deduction" && l.no == "⑳"));
        assert!(!s.pl.iter().any(|l| l.key == "deduction"));
    }
}
