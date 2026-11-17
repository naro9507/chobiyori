//! 業種テンプレート。初期設定で選ぶと、標準の科目に業種でよく使う科目と家事按分のルールを足す。
//!
//! 足す経費の科目は、決算書に専用の行がない（`statement_line` が None）ので、決算書の空欄の行
//! （6 行）に載る。そのため 1 つの業種で足す経費の科目は 5 つまでにする。
//! 科目と按分の割合は出発点の例で、税理士の監修は後で受ける（SPEC §9 の 5）。

use super::master::{AccountCategory, TaxCategory};
use serde::{Deserialize, Serialize};

/// 業種テンプレート。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum IndustryTemplate {
    /// 汎用（標準の科目だけ）
    General,
    /// 教室・スクール（第 1 章の帳簿が原型）
    School,
    /// サービス業・フリーランス
    Service,
    /// 小売・物販と飲食
    RetailFood,
}

impl IndustryTemplate {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::General => "general",
            Self::School => "school",
            Self::Service => "service",
            Self::RetailFood => "retailFood",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ExtraAccount {
    pub code: &'static str,
    pub name_ja: &'static str,
    pub name_en: &'static str,
    pub kana: &'static str,
    pub category: AccountCategory,
    pub tax: TaxCategory,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ExtraRule {
    pub code: &'static str,
    pub name_ja: &'static str,
    pub name_en: &'static str,
    pub business_percent: i64,
}

const fn expense(
    code: &'static str,
    name_ja: &'static str,
    name_en: &'static str,
    kana: &'static str,
    tax: TaxCategory,
) -> ExtraAccount {
    ExtraAccount {
        code,
        name_ja,
        name_en,
        kana,
        category: AccountCategory::Expense,
        tax,
    }
}

const fn rule(
    code: &'static str,
    name_ja: &'static str,
    name_en: &'static str,
    business_percent: i64,
) -> ExtraRule {
    ExtraRule {
        code,
        name_ja,
        name_en,
        business_percent,
    }
}

use TaxCategory::{OutOfScope, TaxablePurchase10};

#[rustfmt::skip]
const SCHOOL_ACCOUNTS: &[ExtraAccount] = &[
    expense("620", "教材費", "Teaching materials", "きょうざいひ", TaxablePurchase10),
    expense("621", "支払手数料", "Fees", "しはらいてすうりょう", TaxablePurchase10),
    expense("622", "新聞図書費", "Books and subscriptions", "しんぶんとしょひ", TaxablePurchase10),
    expense("623", "研修費", "Training", "けんしゅうひ", TaxablePurchase10),
];

#[rustfmt::skip]
const SCHOOL_RULES: &[ExtraRule] = &[
    rule("HOME", "自宅兼教室（家賃・光熱費）", "Home and classroom (rent, utilities)", 50),
    rule("PHONE", "電話・インターネット", "Phone and internet", 50),
];

#[rustfmt::skip]
const SERVICE_ACCOUNTS: &[ExtraAccount] = &[
    expense("620", "支払手数料", "Fees", "しはらいてすうりょう", TaxablePurchase10),
    expense("621", "新聞図書費", "Books and subscriptions", "しんぶんとしょひ", TaxablePurchase10),
    expense("622", "会議費", "Meetings", "かいぎひ", TaxablePurchase10),
    expense("623", "研修費", "Training", "けんしゅうひ", TaxablePurchase10),
    expense("624", "車両費", "Vehicle expenses", "しゃりょうひ", TaxablePurchase10),
];

#[rustfmt::skip]
const SERVICE_RULES: &[ExtraRule] = &[
    rule("HOME", "自宅兼事務所（家賃・光熱費）", "Home office (rent, utilities)", 30),
    rule("PHONE", "電話・インターネット", "Phone and internet", 50),
    rule("CAR", "車（ガソリン・保険など）", "Car (fuel, insurance, etc.)", 50),
];

#[rustfmt::skip]
const RETAIL_FOOD_ACCOUNTS: &[ExtraAccount] = &[
    expense("620", "支払手数料", "Fees", "しはらいてすうりょう", TaxablePurchase10),
    expense("621", "販売促進費", "Sales promotion", "はんばいそくしんひ", TaxablePurchase10),
    expense("622", "包装資材費", "Packaging", "ほうそうしざいひ", TaxablePurchase10),
    expense("623", "車両費", "Vehicle expenses", "しゃりょうひ", TaxablePurchase10),
    expense("624", "諸会費", "Membership dues", "しょかいひ", OutOfScope),
];

#[rustfmt::skip]
const RETAIL_FOOD_RULES: &[ExtraRule] = &[
    rule("HOME", "店舗兼住宅（家賃・光熱費）", "Shop and home (rent, utilities)", 50),
    rule("CAR", "車（ガソリン・保険など）", "Car (fuel, insurance, etc.)", 70),
];

impl IndustryTemplate {
    pub const ALL: [Self; 4] = [Self::General, Self::School, Self::Service, Self::RetailFood];

    /// 標準の科目に足す科目。
    pub fn accounts(self) -> &'static [ExtraAccount] {
        match self {
            Self::General => &[],
            Self::School => SCHOOL_ACCOUNTS,
            Self::Service => SERVICE_ACCOUNTS,
            Self::RetailFood => RETAIL_FOOD_ACCOUNTS,
        }
    }

    /// 家事按分のルール。
    pub fn allocation_rules(self) -> &'static [ExtraRule] {
        match self {
            Self::General => &[],
            Self::School => SCHOOL_RULES,
            Self::Service => SERVICE_RULES,
            Self::RetailFood => RETAIL_FOOD_RULES,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::standard_accounts::GENERAL;

    #[test]
    fn templates_fit_the_blank_rows_and_do_not_reuse_codes() {
        for t in IndustryTemplate::ALL {
            let accounts = t.accounts();
            // 決算書の空欄の行は 6 行。足す経費の科目は 5 つまで
            assert!(accounts.len() <= 5, "{t:?}");
            for a in accounts {
                assert!(
                    GENERAL
                        .iter()
                        .all(|g| g.code != a.code && g.name_ja != a.name_ja),
                    "{}",
                    a.code
                );
                assert!(crate::domain::master::code(a.code).is_ok());
            }
            let mut codes: Vec<&str> = accounts.iter().map(|a| a.code).collect();
            codes.dedup();
            assert_eq!(codes.len(), accounts.len());
            for r in t.allocation_rules() {
                assert!((1..=99).contains(&r.business_percent));
                assert!(crate::domain::master::code(r.code).is_ok());
            }
        }
    }
}
