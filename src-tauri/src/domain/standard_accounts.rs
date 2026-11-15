//! 標準の勘定科目。青色申告決算書（一般用）の科目に合わせる。
//!
//! `statement_line` は決算書のどの行に載せるかを表すキー。行の名前と順番は
//! 年度ごとのデータ（`statement_layouts`、フェーズ 7）で持ち、ここでは対応だけを決める。
//! 決算書に専用の行がない科目は `None` にし、空欄の行に割り当てる。

use super::master::{AccountCategory, TaxCategory};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct StandardAccount {
    pub code: &'static str,
    pub name_ja: &'static str,
    pub name_en: &'static str,
    pub kana: &'static str,
    pub category: AccountCategory,
    pub statement_line: Option<&'static str>,
    pub default_tax_category: Option<TaxCategory>,
}

const fn account(
    code: &'static str,
    name_ja: &'static str,
    name_en: &'static str,
    kana: &'static str,
    category: AccountCategory,
    statement_line: Option<&'static str>,
    default_tax_category: Option<TaxCategory>,
) -> StandardAccount {
    StandardAccount {
        code,
        name_ja,
        name_en,
        kana,
        category,
        statement_line,
        default_tax_category,
    }
}

use AccountCategory::{Asset, Cogs, Equity, Expense, Liability, Revenue};
use TaxCategory::{NonTaxable, OutOfScope, TaxablePurchase10, TaxableSales10};

/// 汎用（標準）テンプレートの科目。並び順は決算書の順。
#[rustfmt::skip]
pub const GENERAL: &[StandardAccount] = &[
    // 資産
    account("101", "現金", "Cash", "げんきん", Asset, Some("bs.cash"), None),
    account("102", "当座預金", "Checking account", "とうざよきん", Asset, Some("bs.checking"), None),
    account("103", "定期預金", "Time deposits", "ていきよきん", Asset, Some("bs.time_deposits"), None),
    account("104", "普通預金", "Ordinary deposits", "ふつうよきん", Asset, Some("bs.other_deposits"), None),
    account("105", "受取手形", "Notes receivable", "うけとりてがた", Asset, Some("bs.notes_receivable"), None),
    account("106", "売掛金", "Accounts receivable", "うりかけきん", Asset, Some("bs.accounts_receivable"), None),
    account("107", "有価証券", "Securities", "ゆうかしょうけん", Asset, Some("bs.securities"), None),
    account("108", "棚卸資産", "Inventory", "たなおろししさん", Asset, Some("bs.inventory"), None),
    account("109", "前払金", "Prepayments", "まえばらいきん", Asset, Some("bs.prepayments"), None),
    account("110", "貸付金", "Loans receivable", "かしつけきん", Asset, Some("bs.loans_receivable"), None),
    account("111", "建物", "Buildings", "たてもの", Asset, Some("bs.buildings"), None),
    account("112", "建物附属設備", "Building fixtures", "たてものふぞくせつび", Asset, Some("bs.building_fixtures"), None),
    account("113", "機械装置", "Machinery", "きかいそうち", Asset, Some("bs.machinery"), None),
    account("114", "車両運搬具", "Vehicles", "しゃりょううんぱんぐ", Asset, Some("bs.vehicles"), None),
    account("115", "工具器具備品", "Tools and equipment", "こうぐきぐびひん", Asset, Some("bs.tools_equipment"), None),
    account("116", "土地", "Land", "とち", Asset, Some("bs.land"), None),
    account("117", "構築物", "Structures", "こうちくぶつ", Asset, None, None),
    account("199", "事業主貸", "Owner's drawings", "じぎょうぬしかし", Asset, Some("bs.owner_drawings"), Some(OutOfScope)),
    // 負債
    account("201", "支払手形", "Notes payable", "しはらいてがた", Liability, Some("bs.notes_payable"), None),
    account("202", "買掛金", "Accounts payable", "かいかけきん", Liability, Some("bs.accounts_payable"), None),
    account("203", "借入金", "Loans payable", "かりいれきん", Liability, Some("bs.loans_payable"), None),
    account("204", "未払金", "Accrued payables", "みばらいきん", Liability, Some("bs.accrued_payables"), None),
    account("205", "前受金", "Advances received", "まえうけきん", Liability, Some("bs.advances_received"), None),
    account("206", "預り金", "Deposits received", "あずかりきん", Liability, Some("bs.deposits_received"), None),
    account("207", "貸倒引当金", "Allowance for bad debts", "かしだおれひきあてきん", Liability, Some("bs.bad_debt_allowance"), None),
    // 資本
    account("301", "事業主借", "Owner's contributions", "じぎょうぬしかり", Equity, Some("bs.owner_contributions"), Some(OutOfScope)),
    account("302", "元入金", "Owner's capital", "もといれきん", Equity, Some("bs.capital"), Some(OutOfScope)),
    // 収益
    account("401", "売上高", "Sales", "うりあげだか", Revenue, Some("pl.sales"), Some(TaxableSales10)),
    account("402", "家事消費等", "Personal consumption", "かじしょうひとう", Revenue, Some("pl.personal_consumption"), Some(TaxableSales10)),
    account("403", "雑収入", "Miscellaneous income", "ざっしゅうにゅう", Revenue, Some("pl.misc_income"), Some(TaxableSales10)),
    // 売上原価
    account("501", "期首商品棚卸高", "Opening inventory", "きしゅしょうひんたなおろしだか", Cogs, Some("pl.opening_inventory"), Some(OutOfScope)),
    account("502", "仕入高", "Purchases", "しいれだか", Cogs, Some("pl.purchases"), Some(TaxablePurchase10)),
    account("503", "期末商品棚卸高", "Closing inventory", "きまつしょうひんたなおろしだか", Cogs, Some("pl.closing_inventory"), Some(OutOfScope)),
    // 経費
    account("601", "租税公課", "Taxes and dues", "そぜいこうか", Expense, Some("pl.taxes_dues"), Some(OutOfScope)),
    account("602", "荷造運賃", "Packing and freight", "にづくりうんちん", Expense, Some("pl.freight"), Some(TaxablePurchase10)),
    account("603", "水道光熱費", "Utilities", "すいどうこうねつひ", Expense, Some("pl.utilities"), Some(TaxablePurchase10)),
    account("604", "旅費交通費", "Travel and transportation", "りょひこうつうひ", Expense, Some("pl.travel"), Some(TaxablePurchase10)),
    account("605", "通信費", "Communication", "つうしんひ", Expense, Some("pl.communication"), Some(TaxablePurchase10)),
    account("606", "広告宣伝費", "Advertising", "こうこくせんでんひ", Expense, Some("pl.advertising"), Some(TaxablePurchase10)),
    account("607", "接待交際費", "Entertainment", "せったいこうさいひ", Expense, Some("pl.entertainment"), Some(TaxablePurchase10)),
    account("608", "損害保険料", "Insurance", "そんがいほけんりょう", Expense, Some("pl.insurance"), Some(NonTaxable)),
    account("609", "修繕費", "Repairs", "しゅうぜんひ", Expense, Some("pl.repairs"), Some(TaxablePurchase10)),
    account("610", "消耗品費", "Supplies", "しょうもうひんひ", Expense, Some("pl.supplies"), Some(TaxablePurchase10)),
    account("611", "減価償却費", "Depreciation", "げんかしょうきゃくひ", Expense, Some("pl.depreciation"), Some(OutOfScope)),
    account("612", "福利厚生費", "Employee benefits", "ふくりこうせいひ", Expense, Some("pl.welfare"), Some(TaxablePurchase10)),
    account("613", "給料賃金", "Salaries and wages", "きゅうりょうちんぎん", Expense, Some("pl.wages"), Some(OutOfScope)),
    account("614", "外注工賃", "Outsourcing", "がいちゅうこうちん", Expense, Some("pl.outsourcing"), Some(TaxablePurchase10)),
    account("615", "利子割引料", "Interest and discounts", "りしわりびきりょう", Expense, Some("pl.interest"), Some(NonTaxable)),
    account("616", "地代家賃", "Rent", "ちだいやちん", Expense, Some("pl.rent"), Some(TaxablePurchase10)),
    account("617", "貸倒金", "Bad debts", "かしだおれきん", Expense, Some("pl.bad_debts"), Some(OutOfScope)),
    account("699", "雑費", "Miscellaneous expenses", "ざっぴ", Expense, Some("pl.misc_expenses"), Some(TaxablePurchase10)),
    // 専従者給与は経費の合計とは別の行（繰戻額等の欄）に載る
    account("701", "専従者給与", "Family employee salaries", "せんじゅうしゃきゅうよ", Expense, Some("pl.family_employee_salaries"), Some(OutOfScope)),
];

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::master;
    use std::collections::HashSet;

    #[test]
    fn codes_and_names_are_unique_and_valid() {
        let mut codes = HashSet::new();
        let mut names = HashSet::new();
        for a in GENERAL {
            assert_eq!(master::code(a.code).unwrap(), a.code);
            assert!(codes.insert(a.code), "コードが重複: {}", a.code);
            assert!(names.insert(a.name_ja), "名前が重複: {}", a.name_ja);
            assert!(!a.name_en.is_empty() && !a.kana.is_empty());
        }
    }

    #[test]
    fn statement_lines_are_unique() {
        let mut lines = HashSet::new();
        for line in GENERAL.iter().filter_map(|a| a.statement_line) {
            assert!(lines.insert(line), "決算書の行が重複: {line}");
        }
    }

    #[test]
    fn statement_line_prefix_matches_category() {
        for a in GENERAL {
            if let Some(line) = a.statement_line {
                let is_pl = matches!(a.category, Revenue | Cogs | Expense);
                assert_eq!(line.starts_with("pl."), is_pl, "{}", a.name_ja);
            }
        }
    }

    #[test]
    fn contains_accounts_needed_for_closing() {
        for name in ["現金", "事業主貸", "事業主借", "元入金", "売上高", "雑費"] {
            assert!(GENERAL.iter().any(|a| a.name_ja == name), "{name}");
        }
    }
}
