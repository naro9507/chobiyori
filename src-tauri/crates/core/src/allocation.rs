//! 家事按分の計算。
//!
//! 事業分 = 端数処理(支払額 × 事業割合)、家事分 = 支払額 − 事業分。
//! 2 つを足すと必ず支払額に戻る。

use super::journal::{LineInput, Side};
use super::master::{Rounding, TaxCategory};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Allocation {
    /// 経費にする額
    pub business: i64,
    /// 事業主貸にする額
    pub private: i64,
}

/// `amount` 円を事業割合 `business_percent`（0〜100）で分ける。
pub fn allocate(amount: i64, business_percent: i64, rounding: Rounding) -> Allocation {
    let percent = business_percent.clamp(0, 100);
    let numerator = amount * percent;
    let business = match rounding {
        Rounding::Floor => numerator.div_euclid(100),
        Rounding::Ceil => -(-numerator).div_euclid(100),
        // 0.5 円は切り上げる（四捨五入）
        Rounding::Round => (numerator + 50).div_euclid(100),
    };
    Allocation {
        business,
        private: amount - business,
    }
}

/// 明細行 `index`（支出の経費の行）を、事業分（同じ科目）と家事分（事業主貸 `drawings`）の
/// 2 行に分ける。どちらかが 0 円ならその行は作らない。割合が 100 なら何もしない。
///
/// 家事分の行は、補助科目・インボイスの印を付けず、税区分は「対象外」にする。
pub fn split_line(
    lines: &[LineInput],
    index: usize,
    drawings: i64,
    business_percent: i64,
    rounding: Rounding,
) -> Vec<LineInput> {
    let Some(target) = lines.get(index) else {
        return lines.to_vec();
    };
    if business_percent >= 100 || target.side != Side::Debit {
        return lines.to_vec();
    }
    let parts = allocate(target.amount, business_percent, rounding);
    let mut result = Vec::with_capacity(lines.len() + 1);
    for (i, line) in lines.iter().enumerate() {
        if i != index {
            result.push(line.clone());
            continue;
        }
        if parts.business > 0 {
            result.push(LineInput {
                amount: parts.business,
                ..line.clone()
            });
        }
        if parts.private > 0 {
            result.push(LineInput {
                partner_id: line.partner_id,
                memo: line.memo.clone(),
                tax_category: Some(TaxCategory::OutOfScope),
                ..LineInput::new(Side::Debit, drawings, parts.private)
            });
        }
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn splits_an_expense_line_into_business_and_private() {
        // 水道光熱費 / 普通預金 8,801 を事業 50%（切り捨て）
        let lines = [
            LineInput::new(Side::Debit, 603, 8_801),
            LineInput::new(Side::Credit, 104, 8_801),
        ];
        let split = split_line(&lines, 0, 199, 50, Rounding::Floor);
        assert_eq!(
            split
                .iter()
                .map(|l| (l.side, l.account_id, l.amount))
                .collect::<Vec<_>>(),
            [
                (Side::Debit, 603, 4_400),
                (Side::Debit, 199, 4_401),
                (Side::Credit, 104, 8_801)
            ]
        );
        assert_eq!(split[1].tax_category, Some(TaxCategory::OutOfScope));
        // 貸借はそろったまま
        let debit: i64 = split
            .iter()
            .filter(|l| l.side == Side::Debit)
            .map(|l| l.amount)
            .sum();
        assert_eq!(debit, 8_801);
    }

    #[test]
    fn zero_parts_are_not_written() {
        let lines = [
            LineInput::new(Side::Debit, 603, 1_000),
            LineInput::new(Side::Credit, 104, 1_000),
        ];
        assert_eq!(split_line(&lines, 0, 199, 100, Rounding::Floor), lines);
        let all_private = split_line(&lines, 0, 199, 0, Rounding::Floor);
        assert_eq!(all_private[0].account_id, 199);
        assert_eq!(all_private.len(), 2);
        // 貸方の行は分けない
        assert_eq!(split_line(&lines, 1, 199, 50, Rounding::Floor), lines);
    }

    #[test]
    fn splits_by_percent() {
        assert_eq!(
            allocate(10_000, 50, Rounding::Floor),
            Allocation {
                business: 5_000,
                private: 5_000
            }
        );
    }

    #[test]
    fn rounding_is_applied_to_the_business_part() {
        // 3,333 × 30% = 999.9
        assert_eq!(allocate(3_333, 30, Rounding::Floor).business, 999);
        assert_eq!(allocate(3_333, 30, Rounding::Ceil).business, 1_000);
        assert_eq!(allocate(3_333, 30, Rounding::Round).business, 1_000);
        // 1,001 × 50% = 500.5
        assert_eq!(allocate(1_001, 50, Rounding::Round).business, 501);
        assert_eq!(allocate(1_001, 50, Rounding::Floor).business, 500);
    }

    #[test]
    fn parts_always_add_up_to_the_amount() {
        for amount in [1, 7, 999, 12_345, 1_000_001] {
            for percent in [0, 1, 33, 50, 67, 99, 100] {
                for rounding in Rounding::ALL {
                    let a = allocate(amount, percent, *rounding);
                    assert_eq!(a.business + a.private, amount);
                    assert!(a.business >= 0 && a.private >= 0);
                }
            }
        }
    }

    #[test]
    fn zero_and_full_percent() {
        assert_eq!(allocate(1_234, 0, Rounding::Ceil).business, 0);
        assert_eq!(allocate(1_234, 100, Rounding::Floor).private, 0);
    }
}
