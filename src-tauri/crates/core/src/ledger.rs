//! 帳簿（総勘定元帳・出納帳・経費帳）の計算。
//!
//! 元帳は、科目の明細行を日付の順に並べ、1 行ごとの残高を出したもの。
//! 残高は「繰越 + 借方 − 貸方」（資産・売上原価・経費）か「繰越 + 貸方 − 借方」（それ以外）で、
//! 区分の向きは `balance::signed` と同じ。集計値は保存せず、仕訳から毎回計算する。

use super::balance::{signed, Totals};
use super::journal::Side;
use super::master::AccountCategory;
use serde::Serialize;

/// 元帳に載せる 1 つの明細行。呼び出し側が日付の順・入力の順に並べて渡す。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LedgerEntry {
    pub transaction_id: i64,
    pub date: String,
    pub side: Side,
    pub amount: i64,
    /// 相手の科目。相手が 2 科目以上なら `None`（帳簿では「諸口」と書く）
    pub counter_account_id: Option<i64>,
    pub partner_id: Option<i64>,
    pub partner_ids: Vec<i64>,
    pub memo: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LedgerRow {
    pub transaction_id: i64,
    pub date: String,
    /// 相手の科目。`None` は諸口（相手が 2 科目以上）
    pub counter_account_id: Option<i64>,
    pub partner_id: Option<i64>,
    pub partner_ids: Vec<i64>,
    pub memo: String,
    pub debit: i64,
    pub credit: i64,
    /// この行までの残高（区分の向きで正）
    pub balance: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Ledger {
    pub account_id: i64,
    pub category: AccountCategory,
    /// 期間より前からの繰越（期首 + 年度の初めから期間の前までの増減）
    pub brought_forward: i64,
    pub rows: Vec<LedgerRow>,
    pub total_debit: i64,
    pub total_credit: i64,
    /// 期間の終わりの残高
    pub closing_balance: i64,
}

/// 明細行から、相手の科目を決める。反対側にある科目が 1 つだけならその科目、
/// 2 つ以上なら `None`（諸口）。`lines` は取引のすべての明細行（側と科目）。
pub fn counter_account(lines: &[(Side, i64)], side: Side) -> Option<i64> {
    let mut found: Option<i64> = None;
    for &(other_side, account) in lines {
        if other_side == side {
            continue;
        }
        match found {
            None => found = Some(account),
            Some(existing) if existing == account => {}
            Some(_) => return None,
        }
    }
    found
}

/// 元帳を作る。`entries` は日付の順に並べておく。
pub fn ledger(
    account_id: i64,
    category: AccountCategory,
    brought_forward: i64,
    entries: Vec<LedgerEntry>,
) -> Ledger {
    let mut balance = brought_forward;
    let mut totals = Totals::default();
    let rows = entries
        .into_iter()
        .map(|e| {
            let (debit, credit) = match e.side {
                Side::Debit => (e.amount, 0),
                Side::Credit => (0, e.amount),
            };
            totals.debit += debit;
            totals.credit += credit;
            balance += signed(category, Totals { debit, credit });
            LedgerRow {
                transaction_id: e.transaction_id,
                date: e.date,
                counter_account_id: e.counter_account_id,
                partner_id: e.partner_id,
                partner_ids: e.partner_ids,
                memo: e.memo,
                debit,
                credit,
                balance,
            }
        })
        .collect();
    Ledger {
        account_id,
        category,
        brought_forward,
        rows,
        total_debit: totals.debit,
        total_credit: totals.credit,
        closing_balance: brought_forward + signed(category, totals),
    }
}

impl Ledger {
    /// 繰越も期間中の動きもない（帳簿に載せるものがない）。
    pub fn is_empty(&self) -> bool {
        self.brought_forward == 0 && self.rows.is_empty()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use AccountCategory::*;
    use Side::*;

    fn e(id: i64, date: &str, side: Side, amount: i64, counter: Option<i64>) -> LedgerEntry {
        LedgerEntry {
            transaction_id: id,
            date: date.into(),
            side,
            amount,
            counter_account_id: counter,
            partner_id: None,
            partner_ids: Vec::new(),
            memo: String::new(),
        }
    }

    #[test]
    fn counter_account_is_the_single_account_on_the_other_side() {
        // 消耗品費 / 現金
        assert_eq!(
            counter_account(&[(Debit, 610), (Credit, 101)], Debit),
            Some(101)
        );
        assert_eq!(
            counter_account(&[(Debit, 610), (Credit, 101)], Credit),
            Some(610)
        );
        // 給料 / 普通預金・預り金: 給料から見ると諸口、普通預金から見ると給料
        let wages = [(Debit, 613), (Credit, 104), (Credit, 206)];
        assert_eq!(counter_account(&wages, Debit), None);
        assert_eq!(counter_account(&wages, Credit), Some(613));
        // 反対側に同じ科目が 2 行あっても 1 科目
        assert_eq!(
            counter_account(&[(Debit, 101), (Credit, 401), (Credit, 401)], Debit),
            Some(401)
        );
    }

    #[test]
    fn running_balance_of_an_asset() {
        let cash = ledger(
            101,
            Asset,
            10_000,
            vec![
                e(1, "2026-03-01", Debit, 5_000, Some(401)),
                e(2, "2026-03-02", Credit, 1_200, Some(610)),
                e(3, "2026-03-03", Credit, 20_000, None),
            ],
        );
        assert_eq!(
            cash.rows.iter().map(|r| r.balance).collect::<Vec<_>>(),
            [15_000, 13_800, -6_200]
        );
        assert_eq!((cash.rows[1].debit, cash.rows[1].credit), (0, 1_200));
        assert_eq!((cash.total_debit, cash.total_credit), (5_000, 21_200));
        assert_eq!(cash.closing_balance, -6_200);
    }

    #[test]
    fn running_balance_of_revenue_and_liability_grows_on_the_credit_side() {
        let sales = ledger(
            401,
            Revenue,
            0,
            vec![
                e(1, "2026-03-01", Credit, 30_000, Some(104)),
                // 返金
                e(2, "2026-03-05", Debit, 5_000, Some(104)),
            ],
        );
        assert_eq!(
            sales.rows.iter().map(|r| r.balance).collect::<Vec<_>>(),
            [30_000, 25_000]
        );
        let card = ledger(
            204,
            Liability,
            3_000,
            vec![e(1, "2026-03-01", Credit, 2_000, Some(605))],
        );
        assert_eq!(card.closing_balance, 5_000);
    }

    #[test]
    fn empty_ledger() {
        let l = ledger(610, Expense, 0, vec![]);
        assert!(l.is_empty());
        assert_eq!(l.closing_balance, 0);
        assert!(!ledger(101, Asset, 1, vec![]).is_empty());
    }
}
