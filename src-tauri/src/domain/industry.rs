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
    /// 旧版の小売・物販と飲食（保存済みの帳簿用）
    RetailFood,
    /// 小売・物販
    Retail,
    /// 飲食店
    Restaurant,
    /// 建設・一人親方
    Construction,
    /// 美容・理容
    Beauty,
    /// IT・Web 制作
    ItWeb,
    /// 運送・配達
    Delivery,
}

impl IndustryTemplate {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::General => "general",
            Self::School => "school",
            Self::Service => "service",
            Self::RetailFood => "retailFood",
            Self::Retail => "retail",
            Self::Restaurant => "restaurant",
            Self::Construction => "construction",
            Self::Beauty => "beauty",
            Self::ItWeb => "itWeb",
            Self::Delivery => "delivery",
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
    /// 既定の按分ルールとして紐付ける科目のコード
    pub accounts: &'static [&'static str],
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
    accounts: &'static [&'static str],
) -> ExtraRule {
    ExtraRule {
        code,
        name_ja,
        name_en,
        business_percent,
        accounts,
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
    rule("HOME", "自宅兼教室（家賃・光熱費）", "Home and classroom (rent, utilities)", 50, &["616", "603"]),
    rule("PHONE", "電話・インターネット", "Phone and internet", 50, &["605"]),
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
    rule("HOME", "自宅兼事務所（家賃・光熱費）", "Home office (rent, utilities)", 30, &["616", "603"]),
    rule("PHONE", "電話・インターネット", "Phone and internet", 50, &["605"]),
    rule("CAR", "車（ガソリン・保険など）", "Car (fuel, insurance, etc.)", 50, &["624"]),
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
    rule("HOME", "店舗兼住宅（家賃・光熱費）", "Shop and home (rent, utilities)", 50, &["616", "603"]),
    rule("CAR", "車（ガソリン・保険など）", "Car (fuel, insurance, etc.)", 70, &["623"]),
];

#[rustfmt::skip]
const RETAIL_ACCOUNTS: &[ExtraAccount] = &[
    expense("620", "支払手数料", "Fees", "しはらいてすうりょう", TaxablePurchase10),
    expense("621", "販売促進費", "Sales promotion", "はんばいそくしんひ", TaxablePurchase10),
    expense("622", "包装資材費", "Packaging", "ほうそうしざいひ", TaxablePurchase10),
];

#[rustfmt::skip]
const RESTAURANT_ACCOUNTS: &[ExtraAccount] = &[
    expense("620", "支払手数料", "Fees", "しはらいてすうりょう", TaxablePurchase10),
    expense("621", "衛生管理費", "Sanitation", "えいせいかんりひ", TaxablePurchase10),
    expense("622", "包装資材費", "Packaging", "ほうそうしざいひ", TaxablePurchase10),
    expense("623", "クリーニング代", "Laundry and dry cleaning", "くりーにんぐだい", TaxablePurchase10),
];

#[rustfmt::skip]
const CONSTRUCTION_ACCOUNTS: &[ExtraAccount] = &[
    expense("620", "工具レンタル料", "Tool rental", "こうぐれんたるりょう", TaxablePurchase10),
    expense("621", "廃材処分費", "Construction waste disposal", "はいざいしょぶんひ", TaxablePurchase10),
    expense("622", "車両費", "Vehicle expenses", "しゃりょうひ", TaxablePurchase10),
    expense("623", "作業用品費", "Work supplies", "さぎょうようひんひ", TaxablePurchase10),
];

#[rustfmt::skip]
const BEAUTY_ACCOUNTS: &[ExtraAccount] = &[
    expense("620", "施術材料費", "Treatment supplies", "せじゅつざいりょうひ", TaxablePurchase10),
    expense("621", "クリーニング代", "Laundry and dry cleaning", "くりーにんぐだい", TaxablePurchase10),
    expense("622", "支払手数料", "Fees", "しはらいてすうりょう", TaxablePurchase10),
    expense("623", "研修費", "Training", "けんしゅうひ", TaxablePurchase10),
];

#[rustfmt::skip]
const IT_WEB_ACCOUNTS: &[ExtraAccount] = &[
    expense("620", "ソフトウェア利用料", "Software subscriptions", "そふとうぇありようりょう", TaxablePurchase10),
    expense("621", "サーバー・ドメイン費", "Hosting and domain fees", "さーばーどめいんひ", TaxablePurchase10),
    expense("622", "素材購入費", "Digital assets", "そざいこうにゅうひ", TaxablePurchase10),
    expense("623", "新聞図書費", "Books and subscriptions", "しんぶんとしょひ", TaxablePurchase10),
];

#[rustfmt::skip]
const DELIVERY_ACCOUNTS: &[ExtraAccount] = &[
    expense("620", "燃料費", "Fuel", "ねんりょうひ", TaxablePurchase10),
    expense("621", "有料道路料金", "Road tolls", "ゆうりょうどうろりょうきん", TaxablePurchase10),
    expense("622", "駐車場代", "Parking fees", "ちゅうしゃじょうだい", TaxablePurchase10),
    expense("623", "支払手数料", "Fees", "しはらいてすうりょう", TaxablePurchase10),
];

#[rustfmt::skip]
const SHOP_RULES: &[ExtraRule] = &[
    rule("HOME", "店舗兼住宅（家賃・光熱費）", "Shop and home (rent, utilities)", 50, &["616", "603"]),
];

#[rustfmt::skip]
const CONSTRUCTION_RULES: &[ExtraRule] = &[
    rule("CAR", "車（ガソリン・保険など）", "Car (fuel, insurance, etc.)", 70, &["622"]),
    rule("PHONE", "電話・インターネット", "Phone and internet", 50, &["605"]),
];

#[rustfmt::skip]
const DELIVERY_RULES: &[ExtraRule] = &[
    rule("CAR", "車（ガソリン・保険など）", "Car (fuel, insurance, etc.)", 70, &["620"]),
    rule("PHONE", "電話・インターネット", "Phone and internet", 50, &["605"]),
];

#[rustfmt::skip]
const HOME_OFFICE_RULES: &[ExtraRule] = &[
    rule("HOME", "自宅兼事務所（家賃・光熱費）", "Home office (rent, utilities)", 30, &["616", "603"]),
    rule("PHONE", "電話・インターネット", "Phone and internet", 50, &["605"]),
];

impl IndustryTemplate {
    pub const ALL: [Self; 10] = [
        Self::General,
        Self::School,
        Self::Service,
        Self::RetailFood,
        Self::Retail,
        Self::Restaurant,
        Self::Construction,
        Self::Beauty,
        Self::ItWeb,
        Self::Delivery,
    ];

    /// 標準の科目に足す科目。
    pub fn accounts(self) -> &'static [ExtraAccount] {
        match self {
            Self::General => &[],
            Self::School => SCHOOL_ACCOUNTS,
            Self::Service => SERVICE_ACCOUNTS,
            Self::RetailFood => RETAIL_FOOD_ACCOUNTS,
            Self::Retail => RETAIL_ACCOUNTS,
            Self::Restaurant => RESTAURANT_ACCOUNTS,
            Self::Construction => CONSTRUCTION_ACCOUNTS,
            Self::Beauty => BEAUTY_ACCOUNTS,
            Self::ItWeb => IT_WEB_ACCOUNTS,
            Self::Delivery => DELIVERY_ACCOUNTS,
        }
    }

    /// 家事按分のルール。
    pub fn allocation_rules(self) -> &'static [ExtraRule] {
        match self {
            Self::General => &[],
            Self::School => SCHOOL_RULES,
            Self::Service => SERVICE_RULES,
            Self::RetailFood => RETAIL_FOOD_RULES,
            Self::Retail | Self::Restaurant | Self::Beauty => SHOP_RULES,
            Self::Construction => CONSTRUCTION_RULES,
            Self::Delivery => DELIVERY_RULES,
            Self::ItWeb => HOME_OFFICE_RULES,
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
                // 紐付ける科目は、標準か業種の経費の科目
                for code in r.accounts {
                    assert!(
                        GENERAL
                            .iter()
                            .any(|g| g.code == *code && g.category == AccountCategory::Expense)
                            || accounts.iter().any(|a| a.code == *code),
                        "{code}"
                    );
                }
                assert!(crate::domain::master::code(r.code).is_ok());
            }
        }
    }
}
