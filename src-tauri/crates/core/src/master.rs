//! マスタ（勘定科目・取引先・按分ルールなど）と事業者の区分、入力の検証。

use super::string_enum;
use crate::error::{AppError, AppResult, ErrorCode};

string_enum! {
    /// 勘定科目の区分。残高の向き（借方 / 貸方）もここから決まる。
    pub enum AccountCategory {
        Asset => "asset",
        Liability => "liability",
        Equity => "equity",
        Revenue => "revenue",
        Cogs => "cogs",
        Expense => "expense",
    }
}

impl AccountCategory {
    /// 借方に増える区分（資産・売上原価・経費）なら true。
    pub fn is_debit_normal(self) -> bool {
        matches!(self, Self::Asset | Self::Cogs | Self::Expense)
    }
}

string_enum! {
    /// 申告区分。
    pub enum FilingType {
        /// 青色申告（複式簿記・65 万円控除）
        Blue65 => "blue65",
        /// 青色申告（複式簿記・55 万円控除）
        Blue55 => "blue55",
        /// 青色申告（簡易簿記・10 万円控除）
        Blue10 => "blue10",
        /// 白色申告
        White => "white",
    }
}

string_enum! {
    /// 消費税の扱い。
    pub enum TaxStatus {
        /// 免税事業者
        Exempt => "exempt",
        /// 課税事業者（本則課税）
        Standard => "standard",
        /// 課税事業者（簡易課税）
        Simplified => "simplified",
        /// 課税事業者（2 割特例）
        Special20 => "special20",
    }
}

string_enum! {
    /// 明細行の税区分。
    pub enum TaxCategory {
        TaxableSales10 => "taxable_sales_10",
        TaxableSales8 => "taxable_sales_8",
        ExemptSales => "exempt_sales",
        NonTaxable => "non_taxable",
        TaxablePurchase10 => "taxable_purchase_10",
        TaxablePurchase8 => "taxable_purchase_8",
        ExemptPurchase => "exempt_purchase",
        OutOfScope => "out_of_scope",
    }
}

string_enum! {
    /// 按分したときの端数の扱い。事業分に対して適用する。
    pub enum Rounding {
        Floor => "floor",
        Round => "round",
        Ceil => "ceil",
    }
}

/// コードの最大文字数。番号でも英字でもよい。
pub const CODE_MAX: usize = 10;
pub const NAME_MAX: usize = 60;
pub const MEMO_MAX: usize = 500;

/// 前後の空白を取り、空なら `Required`、長すぎれば `TooLong` にする。
pub fn required(value: &str, max: usize, field: &'static str) -> AppResult<String> {
    let value = value.trim();
    if value.is_empty() {
        return Err(AppError::field(ErrorCode::Required, field));
    }
    optional(value, max, field)
}

/// 前後の空白を取り、長すぎれば `TooLong` にする。空でもよい。
pub fn optional(value: &str, max: usize, field: &'static str) -> AppResult<String> {
    let value = value.trim();
    if value.chars().count() > max {
        return Err(AppError::field(ErrorCode::TooLong, field));
    }
    Ok(value.to_string())
}

/// マスタのコード。半角の英数字と `-` `_` だけを使える。全角の数字は半角にそろえる。
pub fn code(value: &str) -> AppResult<String> {
    let value: String = value.trim().chars().map(to_half_width_digit).collect();
    let value = required(&value, CODE_MAX, "code")?;
    if !value
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        return Err(AppError::field(ErrorCode::InvalidFormat, "code"));
    }
    Ok(value)
}

fn to_half_width_digit(c: char) -> char {
    match c {
        '０'..='９' => char::from_u32(c as u32 - '０' as u32 + '0' as u32).unwrap_or(c),
        _ => c,
    }
}

/// 適格請求書発行事業者の登録番号。`T` + 13 桁の数字。空なら `None`。
pub fn invoice_registration_no(value: Option<&str>) -> AppResult<Option<String>> {
    let Some(value) = value.map(str::trim).filter(|v| !v.is_empty()) else {
        return Ok(None);
    };
    let normalized: String = value
        .chars()
        .map(to_half_width_digit)
        .map(|c| if c == 'ｔ' || c == 'Ｔ' { 'T' } else { c })
        .filter(|c| *c != '-' && !c.is_whitespace())
        .collect::<String>()
        .to_ascii_uppercase();
    let digits = normalized.strip_prefix('T').unwrap_or(&normalized);
    if digits.len() != 13 || !digits.chars().all(|c| c.is_ascii_digit()) {
        return Err(AppError::field(
            ErrorCode::InvalidFormat,
            "invoiceRegistrationNo",
        ));
    }
    Ok(Some(format!("T{digits}")))
}

/// 事業割合（%）。0〜100 の整数。
pub fn business_percent(value: i64) -> AppResult<i64> {
    if (0..=100).contains(&value) {
        Ok(value)
    } else {
        Err(AppError::field(ErrorCode::OutOfRange, "businessPercent"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn code_accepts_ascii_and_full_width_digits() {
        assert_eq!(code(" 101 ").unwrap(), "101");
        assert_eq!(code("６０１").unwrap(), "601");
        assert_eq!(code("CARD-1").unwrap(), "CARD-1");
    }

    #[test]
    fn code_rejects_empty_long_and_symbols() {
        assert_eq!(code("  ").unwrap_err().code, ErrorCode::Required);
        assert_eq!(code("12345678901").unwrap_err().code, ErrorCode::TooLong);
        assert_eq!(code("現金").unwrap_err().code, ErrorCode::InvalidFormat);
        assert_eq!(code("1 2").unwrap_err().code, ErrorCode::InvalidFormat);
    }

    #[test]
    fn required_trims_and_counts_characters_not_bytes() {
        assert_eq!(required(" 現金 ", 2, "nameJa").unwrap(), "現金");
        let err = required("普通預金", 3, "nameJa").unwrap_err();
        assert_eq!(err, AppError::field(ErrorCode::TooLong, "nameJa"));
    }

    #[test]
    fn invoice_registration_no_is_normalized() {
        assert_eq!(invoice_registration_no(None).unwrap(), None);
        assert_eq!(invoice_registration_no(Some(" ")).unwrap(), None);
        assert_eq!(
            invoice_registration_no(Some("t1234567890123")).unwrap(),
            Some("T1234567890123".into())
        );
        assert_eq!(
            invoice_registration_no(Some("Ｔ１２３４-５６７８-９０１２３")).unwrap(),
            Some("T1234567890123".into())
        );
        assert_eq!(
            invoice_registration_no(Some("1234567890123")).unwrap(),
            Some("T1234567890123".into())
        );
        assert!(invoice_registration_no(Some("T123")).is_err());
    }

    #[test]
    fn business_percent_must_be_between_0_and_100() {
        assert!(business_percent(0).is_ok());
        assert!(business_percent(100).is_ok());
        assert!(business_percent(-1).is_err());
        assert!(business_percent(101).is_err());
    }

    #[test]
    fn debit_normal_categories() {
        assert!(AccountCategory::Asset.is_debit_normal());
        assert!(AccountCategory::Expense.is_debit_normal());
        assert!(AccountCategory::Cogs.is_debit_normal());
        assert!(!AccountCategory::Liability.is_debit_normal());
        assert!(!AccountCategory::Equity.is_debit_normal());
        assert!(!AccountCategory::Revenue.is_debit_normal());
    }

    #[test]
    fn enums_round_trip_through_strings() {
        for c in TaxCategory::ALL {
            assert_eq!(TaxCategory::parse(c.as_str()), Some(*c));
        }
        assert_eq!(
            serde_json::to_value(FilingType::Blue65).unwrap(),
            serde_json::json!("blue65")
        );
    }
}
