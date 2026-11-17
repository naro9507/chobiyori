//! 残高と試算表の計算。集計値は保存せず、仕訳の合計から毎回計算する。
//!
//! SPEC「計算ルール」に従う。
//!
//! | 値 | 定義 |
//! |---|---|
//! | 資産（と売上原価・経費）の残高 | 期首 + 借方計 − 貸方計 |
//! | 負債・資本（と収益）の残高 | 期首 + 貸方計 − 借方計 |
//! | 青色控除前所得 | 収益計 − 売上原価 − 経費計 |
//!
//! 期首は、決算の画面で入れた期首残高（`opening_balances`）。

use super::master::AccountCategory;
use serde::Serialize;

/// 1 つの科目の借方計・貸方計。SQL で科目ごとに合計したもの。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct Totals {
    pub debit: i64,
    pub credit: i64,
}

/// 試算表の材料。科目ごとに、期間より前（年度の初めから）と期間中の合計。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Movement {
    pub account_id: i64,
    pub category: AccountCategory,
    /// 期首残高（区分の向きで正）
    pub opening: i64,
    pub before: Totals,
    pub period: Totals,
}

/// 区分の向きで見た残高の増減。資産・売上原価・経費は借方 − 貸方、それ以外は貸方 − 借方。
pub fn signed(category: AccountCategory, totals: Totals) -> i64 {
    if category.is_debit_normal() {
        totals.debit - totals.credit
    } else {
        totals.credit - totals.debit
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrialBalanceRow {
    pub account_id: i64,
    pub category: AccountCategory,
    /// 前期（月）からの繰越。期首 + 期間より前の増減
    pub brought_forward: i64,
    pub debit: i64,
    pub credit: i64,
    /// 期間の終わりの残高（区分の向きで正）
    pub balance: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CategoryTotal {
    pub category: AccountCategory,
    pub brought_forward: i64,
    pub debit: i64,
    pub credit: i64,
    pub balance: i64,
}

/// 合計残高試算表。
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrialBalance {
    /// 動きか残高のある科目だけ。並びは渡した順（区分の順）
    pub rows: Vec<TrialBalanceRow>,
    /// 区分ごとの小計。どの区分も必ず 1 行ある
    pub categories: Vec<CategoryTotal>,
    /// 期間中の借方合計・貸方合計
    pub total_debit: i64,
    pub total_credit: i64,
    /// 借方残高の合計（資産・売上原価・経費）と貸方残高の合計（負債・資本・収益）
    pub debit_balance: i64,
    pub credit_balance: i64,
    /// 借方合計 = 貸方合計、かつ借方残高 = 貸方残高
    pub balanced: bool,
    /// 青色申告特別控除前の所得（年度の初めから期間の終わりまで）
    pub pre_tax_income: i64,
}

/// 試算表を作る。`movements` は科目の並び順で渡す。
pub fn trial_balance(movements: &[Movement]) -> TrialBalance {
    let rows: Vec<TrialBalanceRow> = movements
        .iter()
        .map(|m| {
            let brought_forward = m.opening + signed(m.category, m.before);
            TrialBalanceRow {
                account_id: m.account_id,
                category: m.category,
                brought_forward,
                debit: m.period.debit,
                credit: m.period.credit,
                balance: brought_forward + signed(m.category, m.period),
            }
        })
        .filter(|r| r.brought_forward != 0 || r.debit != 0 || r.credit != 0 || r.balance != 0)
        .collect();

    let categories: Vec<CategoryTotal> = AccountCategory::ALL
        .iter()
        .map(|&category| {
            let mut total = CategoryTotal {
                category,
                brought_forward: 0,
                debit: 0,
                credit: 0,
                balance: 0,
            };
            for r in rows.iter().filter(|r| r.category == category) {
                total.brought_forward += r.brought_forward;
                total.debit += r.debit;
                total.credit += r.credit;
                total.balance += r.balance;
            }
            total
        })
        .collect();

    let total_debit = rows.iter().map(|r| r.debit).sum();
    let total_credit = rows.iter().map(|r| r.credit).sum();
    let (debit_balance, credit_balance) = categories.iter().fold((0, 0), |(debit, credit), c| {
        if c.category.is_debit_normal() {
            (debit + c.balance, credit)
        } else {
            (debit, credit + c.balance)
        }
    });
    let balance_of = |category: AccountCategory| {
        categories
            .iter()
            .find(|c| c.category == category)
            .map_or(0, |c| c.balance)
    };
    let pre_tax_income = balance_of(AccountCategory::Revenue)
        - balance_of(AccountCategory::Cogs)
        - balance_of(AccountCategory::Expense);

    TrialBalance {
        rows,
        categories,
        total_debit,
        total_credit,
        debit_balance,
        credit_balance,
        balanced: total_debit == total_credit && debit_balance == credit_balance,
        pre_tax_income,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use AccountCategory::*;

    fn m(
        account_id: i64,
        category: AccountCategory,
        before: (i64, i64),
        period: (i64, i64),
    ) -> Movement {
        Movement {
            account_id,
            category,
            opening: 0,
            before: Totals {
                debit: before.0,
                credit: before.1,
            },
            period: Totals {
                debit: period.0,
                credit: period.1,
            },
        }
    }

    #[test]
    fn balances_follow_the_side_of_each_category() {
        assert_eq!(
            signed(
                Asset,
                Totals {
                    debit: 10,
                    credit: 3
                }
            ),
            7
        );
        assert_eq!(
            signed(
                Expense,
                Totals {
                    debit: 10,
                    credit: 3
                }
            ),
            7
        );
        assert_eq!(
            signed(
                Cogs,
                Totals {
                    debit: 10,
                    credit: 3
                }
            ),
            7
        );
        assert_eq!(
            signed(
                Liability,
                Totals {
                    debit: 3,
                    credit: 10
                }
            ),
            7
        );
        assert_eq!(
            signed(
                Equity,
                Totals {
                    debit: 3,
                    credit: 10
                }
            ),
            7
        );
        assert_eq!(
            signed(
                Revenue,
                Totals {
                    debit: 3,
                    credit: 10
                }
            ),
            7
        );
    }

    /// 2 月までに: 現金 / 売上 50,000、3 月に: 消耗品費 / 現金 1,200、普通預金 / 売上 30,000、
    /// 仕入 / 現金 5,000
    fn march() -> Vec<Movement> {
        vec![
            m(1, Asset, (50_000, 0), (0, 6_200)),    // 現金
            m(2, Asset, (0, 0), (30_000, 0)),        // 普通預金
            m(3, Liability, (0, 0), (0, 0)),         // 動きのない科目
            m(4, Revenue, (0, 50_000), (0, 30_000)), // 売上
            m(5, Cogs, (0, 0), (5_000, 0)),          // 仕入
            m(6, Expense, (0, 0), (1_200, 0)),       // 消耗品費
        ]
    }

    #[test]
    fn trial_balance_carries_forward_and_balances() {
        let tb = trial_balance(&march());
        // 動きのない科目は出さない
        assert_eq!(
            tb.rows.iter().map(|r| r.account_id).collect::<Vec<_>>(),
            [1, 2, 4, 5, 6]
        );
        let cash = &tb.rows[0];
        assert_eq!(
            (cash.brought_forward, cash.debit, cash.credit, cash.balance),
            (50_000, 0, 6_200, 43_800)
        );
        let sales = &tb.rows[2];
        assert_eq!((sales.brought_forward, sales.balance), (50_000, 80_000));

        assert_eq!(tb.total_debit, 36_200);
        assert_eq!(tb.total_credit, 36_200);
        // 借方残高: 43,800 + 30,000 + 5,000 + 1,200 = 80,000 / 貸方残高: 80,000
        assert_eq!(tb.debit_balance, 80_000);
        assert_eq!(tb.credit_balance, 80_000);
        assert!(tb.balanced);
        assert_eq!(tb.pre_tax_income, 80_000 - 5_000 - 1_200);
    }

    #[test]
    fn category_totals_cover_every_category() {
        let tb = trial_balance(&march());
        assert_eq!(tb.categories.len(), AccountCategory::ALL.len());
        let asset = tb.categories.iter().find(|c| c.category == Asset).unwrap();
        assert_eq!(
            (asset.debit, asset.credit, asset.balance),
            (30_000, 6_200, 73_800)
        );
        let liability = tb
            .categories
            .iter()
            .find(|c| c.category == Liability)
            .unwrap();
        assert_eq!(liability.balance, 0);
    }

    #[test]
    fn unbalanced_movements_are_detected() {
        let tb = trial_balance(&[
            m(1, Asset, (0, 0), (100, 0)),
            m(4, Revenue, (0, 0), (0, 90)),
        ]);
        assert!(!tb.balanced);
    }

    #[test]
    fn opening_balance_is_part_of_the_carried_balance() {
        let mut cash = m(1, Asset, (0, 0), (0, 300));
        cash.opening = 1_000;
        let mut capital = m(7, Equity, (0, 0), (0, 0));
        capital.opening = 1_000;
        let tb = trial_balance(&[cash, capital, m(6, Expense, (0, 0), (300, 0))]);
        assert_eq!(tb.rows[0].brought_forward, 1_000);
        assert_eq!(tb.rows[0].balance, 700);
        assert_eq!(tb.rows[1].balance, 1_000);
        assert!(tb.balanced);
        assert_eq!(tb.pre_tax_income, -300);
    }

    #[test]
    fn empty_books_are_balanced() {
        let tb = trial_balance(&[]);
        assert!(tb.rows.is_empty());
        assert!(tb.balanced);
        assert_eq!(tb.pre_tax_income, 0);
    }
}
