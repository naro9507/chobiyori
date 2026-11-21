//! 出力するファイル（CSV・PDF）に書く見出しの言葉。
//!
//! 画面の文言は `i18n` に置くが、ファイルの見出しは取込で読み戻す形式でもあるので、
//! ここで日本語と英語を固定して持つ。仕訳の CSV の見出しは取込でどちらの言語でも読める。

use chobiyori_core::master::{AccountCategory, TaxCategory};
use serde::Deserialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Locale {
    #[default]
    Ja,
    En,
}

/// ある言葉の日本語と英語。
pub struct Text {
    pub ja: &'static str,
    pub en: &'static str,
}

impl Text {
    pub fn get(&self, locale: Locale) -> &'static str {
        match locale {
            Locale::Ja => self.ja,
            Locale::En => self.en,
        }
    }
}

macro_rules! texts {
    ($($name:ident = $ja:literal, $en:literal;)+) => {
        $(pub const $name: Text = Text { ja: $ja, en: $en };)+
    };
}

texts! {
    JOURNAL = "仕訳帳", "Journal";
    GENERAL_LEDGER = "総勘定元帳", "General ledger";
    CASH_BOOK = "出納帳", "Cash book";
    EXPENSE_BOOK = "経費帳", "Expense book";
    TRIAL_BALANCE = "合計残高試算表", "Trial balance";
    SALES_BOOK = "売上帳", "Sales book";
    WHITE_STATEMENT = "収支内訳書（一般用）の金額一覧", "White-return income and expense statement";
    WHITE_NOTE = "事業専従者控除は利用者が確認して入力した金額です。対象と金額は税理士か税務署に確認してください。", "The family worker deduction is entered by the user. Confirm eligibility and the amount with a tax professional.";
    STATEMENT = "青色申告決算書の金額一覧", "Blue-return statement amounts";
    PROFIT_AND_LOSS = "損益計算書", "Profit and loss";
    MONTHLY_SALES = "月別の売上（収入）金額と仕入金額", "Sales and purchases by month";
    BREAKDOWNS = "給料賃金・地代家賃・利子割引料の内訳", "Wages, rent and interest by payee";
    DEPRECIATION_CALC = "減価償却費の計算", "Depreciation";
    BALANCE_SHEET = "貸借対照表", "Balance sheet";
    LINE_NO = "番号", "No.";
    ITEM = "項目", "Item";
    MONTH = "月", "Month";
    SALES = "売上（収入）金額", "Sales";
    PURCHASES = "仕入金額", "Purchases";
    PERSONAL_CONSUMPTION = "家事消費等", "Personal consumption";
    MISC_INCOME = "雑収入", "Miscellaneous income";
    PAYEE = "支払先", "Payee";
    NO_PARTNER = "（取引先なし）", "(no partner)";
    WAGES = "給料賃金", "Salaries and wages";
    RENT = "地代家賃", "Rent";
    INTEREST = "利子割引料", "Interest and discounts";
    ASSET_NAME = "資産", "Asset";
    ACQUIRED = "取得年月", "Acquired";
    COST = "取得価額", "Cost";
    METHOD_YEARS = "方法・耐用年数", "Method / life";
    RATE = "償却率", "Rate";
    MONTHS = "月数", "Months";
    DEPRECIATION_AMOUNT = "本年分の償却費", "Depreciation";
    BUSINESS_PERCENT = "事業専用割合", "Business use";
    BUSINESS_AMOUNT = "必要経費算入額", "Expensed";
    BOOK_VALUE = "未償却残高", "Book value";
    OPENING = "期首", "Opening";
    CLOSING = "期末", "Closing";
    ASSET_TOTAL = "資産の合計", "Total assets";
    LIABILITY_TOTAL = "負債・資本の合計", "Total liabilities and capital";
    STRAIGHT_LINE = "定額法", "Straight-line";
    DECLINING_BALANCE = "定率法", "Declining-balance";
    LUMP_SUM = "一括償却", "Lump-sum (3 years)";
    SMALL_ASSET = "少額の特例", "Small-asset special rule";
    STATEMENT_NOTE = "転記の目安です。様式の番号や金額の扱いは、最新の様式と税理士に確認してください", "These figures are a guide for filling in the form. Check the latest form and a tax accountant";
    ACCOUNTS = "勘定科目", "Accounts";
    PARTNERS = "取引先", "Partners";

    DATE = "日付", "Date";
    DEBIT = "借方", "Debit";
    CREDIT = "貸方", "Credit";
    DEBIT_ACCOUNT = "借方科目", "Debit account";
    CREDIT_ACCOUNT = "貸方科目", "Credit account";
    DEBIT_AMOUNT = "借方金額", "Debit amount";
    CREDIT_AMOUNT = "貸方金額", "Credit amount";
    DEPOSIT = "入金", "In";
    WITHDRAWAL = "出金", "Out";
    BALANCE = "残高", "Balance";
    COUNTER_ACCOUNT = "相手科目", "Counter account";
    MEMO = "摘要", "Description";
    ACCOUNT = "科目", "Account";
    BROUGHT_FORWARD = "繰越", "Brought forward";
    SUNDRY = "諸口", "Sundry";
    TOTAL = "合計", "Total";
    OPENING_CARRIED = "前期繰越", "Opening balance";
    MONTH_CARRIED = "前月繰越", "Brought forward";
    CARRY_OUT = "次頁へ繰越", "Carried forward";
    CARRY_IN = "前頁より繰越", "Brought forward";
    CONTINUED = "（続き）", "(continued)";
    EMPTY = "この期間の記録はありません", "No entries in this period";
    PRE_TAX_INCOME = "青色申告特別控除前の所得金額", "Income before the blue-return deduction";

    // 仕訳の CSV（取込で読み戻す形式）の見出し
    TRANSACTION_NO = "取引番号", "Transaction no";
    SIDE = "貸借", "Side";
    ACCOUNT_CODE = "科目コード", "Account code";
    ACCOUNT_NAME = "科目名", "Account name";
    AMOUNT = "金額", "Amount";
    PARTNER_CODE = "取引先コード", "Partner code";
    PARTNER_NAME = "取引先名", "Partner name";
    LINE_MEMO = "明細のメモ", "Line memo";
    TRANSACTION_MEMO = "取引のメモ", "Transaction memo";
    SUB_ACCOUNT_CODE = "補助科目コード", "Sub-account code";
    TAX_CATEGORY = "税区分", "Tax category";
    QUALIFIED_INVOICE = "インボイス", "Qualified invoice";

    // マスタの CSV
    CODE = "コード", "Code";
    NAME_JA = "名前（日本語）", "Name (Japanese)";
    NAME_EN = "名前（英語）", "Name (English)";
    KANA = "よみがな", "Reading";
    CATEGORY = "区分", "Category";
    PAYMENT_ACCOUNT = "口座", "Payment account";
    ACTIVE = "使う", "Active";
    CUSTOMER = "顧客", "Customer";
    VENDOR = "仕入先・支払先", "Vendor";
    INVOICE_NO = "登録番号", "Registration no";
    NOTE = "メモ", "Memo";
    YES = "はい", "yes";
    NO = "いいえ", "no";
}

pub fn category(category: AccountCategory, locale: Locale) -> &'static str {
    let text = match category {
        AccountCategory::Asset => Text {
            ja: "資産",
            en: "Assets",
        },
        AccountCategory::Liability => Text {
            ja: "負債",
            en: "Liabilities",
        },
        AccountCategory::Equity => Text {
            ja: "資本",
            en: "Equity",
        },
        AccountCategory::Revenue => Text {
            ja: "収益",
            en: "Revenue",
        },
        AccountCategory::Cogs => Text {
            ja: "売上原価",
            en: "Cost of sales",
        },
        AccountCategory::Expense => Text {
            ja: "経費",
            en: "Expenses",
        },
    };
    text.get(locale)
}

/// 税区分の名前。CSV に書き、取込ではどちらの言語でも（内部の文字列でも）読む。
pub fn tax_category(category: TaxCategory, locale: Locale) -> &'static str {
    tax_text(category).get(locale)
}

fn tax_text(category: TaxCategory) -> Text {
    match category {
        TaxCategory::TaxableSales10 => Text {
            ja: "課税売上 10%",
            en: "Taxable sales 10%",
        },
        TaxCategory::TaxableSales8 => Text {
            ja: "課税売上 軽減 8%",
            en: "Taxable sales reduced 8%",
        },
        TaxCategory::ExemptSales => Text {
            ja: "非課税売上",
            en: "Exempt sales",
        },
        TaxCategory::NonTaxable => Text {
            ja: "不課税",
            en: "Not taxable",
        },
        TaxCategory::TaxablePurchase10 => Text {
            ja: "課税仕入 10%",
            en: "Taxable purchases 10%",
        },
        TaxCategory::TaxablePurchase8 => Text {
            ja: "課税仕入 軽減 8%",
            en: "Taxable purchases reduced 8%",
        },
        TaxCategory::ExemptPurchase => Text {
            ja: "非課税仕入",
            en: "Exempt purchases",
        },
        TaxCategory::OutOfScope => Text {
            ja: "対象外",
            en: "Out of scope",
        },
    }
}

/// CSV の税区分を読む。日本語・英語の名前か、内部の文字列（`taxable_purchase_10` など）。
pub fn parse_tax_category(text: &str) -> Option<TaxCategory> {
    let text = text.trim();
    TaxCategory::parse(text).or_else(|| {
        TaxCategory::ALL.iter().copied().find(|c| {
            let t = tax_text(*c);
            t.ja == text || t.en.eq_ignore_ascii_case(text)
        })
    })
}

/// 期間の表示。日本語は「2026年1月1日〜2026年3月31日」。
pub fn period(from: &str, to: &str, locale: Locale) -> String {
    match locale {
        Locale::Ja => format!("{}〜{}", japanese_date(from), japanese_date(to)),
        Locale::En => format!("{from} – {to}"),
    }
}

fn japanese_date(date: &str) -> String {
    match chobiyori_core::journal::parse_date(date) {
        Some((y, m, d)) => format!("{y}年{m}月{d}日"),
        None => date.to_string(),
    }
}

/// 帳簿の行の日付。年は見出しにあるので月と日だけにする。
pub fn short_date(date: &str) -> String {
    match chobiyori_core::journal::parse_date(date) {
        Some((_, m, d)) => format!("{m:>2}/{d:02}"),
        None => date.to_string(),
    }
}

/// 金額を 3 桁区切りで書く。負の数は先頭に「-」。
pub fn amount(value: i64) -> String {
    let digits = value.unsigned_abs().to_string();
    let mut out = String::with_capacity(digits.len() + digits.len() / 3 + 1);
    if value < 0 {
        out.push('-');
    }
    for (i, c) in digits.chars().enumerate() {
        if i > 0 && (digits.len() - i).is_multiple_of(3) {
            out.push(',');
        }
        out.push(c);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn formats_amounts_with_separators() {
        assert_eq!(amount(0), "0");
        assert_eq!(amount(999), "999");
        assert_eq!(amount(1_000), "1,000");
        assert_eq!(amount(-1_234_567), "-1,234,567");
    }

    #[test]
    fn reads_tax_categories_in_either_language() {
        for c in TaxCategory::ALL {
            assert_eq!(parse_tax_category(tax_category(*c, Locale::Ja)), Some(*c));
            assert_eq!(parse_tax_category(tax_category(*c, Locale::En)), Some(*c));
            assert_eq!(parse_tax_category(c.as_str()), Some(*c));
        }
        assert_eq!(parse_tax_category("消費税"), None);
    }

    #[test]
    fn formats_dates() {
        assert_eq!(
            period("2026-01-01", "2026-03-31", Locale::Ja),
            "2026年1月1日〜2026年3月31日"
        );
        assert_eq!(short_date("2026-03-05"), " 3/05");
    }
}
