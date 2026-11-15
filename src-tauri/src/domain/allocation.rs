//! 家事按分の計算。
//!
//! 事業分 = 端数処理(支払額 × 事業割合)、家事分 = 支払額 − 事業分。
//! 2 つを足すと必ず支払額に戻る。

use super::master::Rounding;

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

#[cfg(test)]
mod tests {
    use super::*;

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
