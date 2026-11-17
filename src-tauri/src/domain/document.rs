//! 請求書・見積書・納品書・領収書の決まりごと（F11）。DB には依存しない。
//!
//! - 金額は円単位の整数。数量は 100 倍した整数（1.5 個 → 150）で持つ
//! - 単価は税抜き。行の金額 = 数量 × 単価（1 円未満は切り捨て）
//! - 消費税は、1 つの書類で税率ごとに 1 回だけ端数を処理する（切り捨て）。適格請求書の決まり
//! - 免税の年度の書類（`simple`）は消費税を足さない。登録番号も書かない
//!
//! 記載事項が足りているかは税理士に確認する（画面と仕様書に書く）。

use super::master::{MEMO_MAX, NAME_MAX};
use super::string_enum;
use crate::error::{AppError, AppResult, ErrorCode};
use serde::{Deserialize, Serialize};

string_enum! {
    /// 書類の種類。どれも同じ作りで、名前と項目だけが違う。
    pub enum DocumentKind {
        Invoice => "invoice",
        Estimate => "estimate",
        Delivery => "delivery",
        Receipt => "receipt",
    }
}

string_enum! {
    /// 保存する状態。入金済み・期限切れは、入金と日付から計算する（`display_status`）。
    pub enum DocumentStatus {
        Draft => "draft",
        Issued => "issued",
        Sent => "sent",
        Paid => "paid",
        Canceled => "canceled",
    }
}

string_enum! {
    /// 様式。課税の年度は適格請求書、免税の年度は登録番号なし。
    pub enum TaxMode {
        Qualified => "qualified",
        Simple => "simple",
    }
}

impl DocumentKind {
    /// 番号の頭（INV-2026-0001 など）。
    pub fn prefix(self) -> &'static str {
        match self {
            Self::Invoice => "INV",
            Self::Estimate => "EST",
            Self::Delivery => "DEL",
            Self::Receipt => "REC",
        }
    }

    /// 書類から作れる書類。見積書 → 請求書、請求書 → 納品書・領収書。
    pub fn can_convert_to(self, to: DocumentKind) -> bool {
        matches!(
            (self, to),
            (Self::Estimate, Self::Invoice)
                | (Self::Invoice, Self::Delivery)
                | (Self::Invoice, Self::Receipt)
        )
    }
}

/// 書類の番号。種類と年ごとの連番。
pub fn number(kind: DocumentKind, year: i64, seq: i64) -> String {
    format!("{}-{year:04}-{seq:04}", kind.prefix())
}

/// 明細の行の数の上限。
pub const LINES_MAX: usize = 200;
/// 単価の上限（1 億円未満）。合計しても桁あふれしないようにする。
pub const UNIT_PRICE_MAX: i64 = 99_999_999;
/// 数量の上限（100 倍した値。10 万個未満）。
pub const QUANTITY_MAX: i64 = 9_999_999;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LineInput {
    pub name: String,
    /// 100 倍した数量
    pub quantity: i64,
    #[serde(default)]
    pub unit: String,
    /// 税抜きの単価。値引きは負の数
    pub unit_price: i64,
    /// 10・8・0（対象外）
    pub tax_rate: i64,
}

impl LineInput {
    /// 行の金額（税抜き）。1 円未満は 0 に近い方へ切り捨てる。
    pub fn amount(&self) -> i64 {
        let raw = self.quantity * self.unit_price;
        raw / 100
    }
}

/// 明細を確かめる。行ごとのエラーは `line` に行の番号（0 から）を入れる。
pub fn validate_lines(lines: &[LineInput]) -> AppResult<Vec<LineInput>> {
    if lines.is_empty() {
        return Err(AppError::field(ErrorCode::Required, "lines"));
    }
    if lines.len() > LINES_MAX {
        return Err(AppError::field(ErrorCode::OutOfRange, "lines"));
    }
    lines
        .iter()
        .enumerate()
        .map(|(i, l)| {
            let name = l.name.trim();
            if name.is_empty() {
                return Err(AppError::line(ErrorCode::Required, i, "name"));
            }
            if name.chars().count() > MEMO_MAX {
                return Err(AppError::line(ErrorCode::TooLong, i, "name"));
            }
            if !(1..=QUANTITY_MAX).contains(&l.quantity) {
                return Err(AppError::line(ErrorCode::OutOfRange, i, "quantity"));
            }
            if l.unit_price.abs() > UNIT_PRICE_MAX {
                return Err(AppError::line(ErrorCode::OutOfRange, i, "unitPrice"));
            }
            if !matches!(l.tax_rate, 0 | 8 | 10) {
                return Err(AppError::line(ErrorCode::InvalidFormat, i, "taxRate"));
            }
            let unit = l.unit.trim();
            if unit.chars().count() > 10 {
                return Err(AppError::line(ErrorCode::TooLong, i, "unit"));
            }
            Ok(LineInput {
                name: name.to_string(),
                quantity: l.quantity,
                unit: unit.to_string(),
                unit_price: l.unit_price,
                tax_rate: l.tax_rate,
            })
        })
        .collect()
}

/// 税率ごとの対象額と消費税額。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RateTotal {
    pub rate: i64,
    /// 税抜きの対象額
    pub base: i64,
    pub tax: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Totals {
    /// 税抜きの小計
    pub subtotal: i64,
    /// 税率ごと（10% → 8% → 対象外の順。行のない税率は出さない）
    pub by_rate: Vec<RateTotal>,
    pub tax: i64,
    /// 税込みの合計
    pub total: i64,
}

/// 合計を計算する。消費税は税率ごとに 1 回だけ切り捨てる。`simple`（免税）は消費税を足さない。
pub fn totals(lines: &[LineInput], mode: TaxMode) -> Totals {
    let mut by_rate = Vec::new();
    for rate in [10, 8, 0] {
        let in_rate: Vec<&LineInput> = lines.iter().filter(|l| l.tax_rate == rate).collect();
        if in_rate.is_empty() {
            continue;
        }
        let base: i64 = in_rate.iter().map(|l| l.amount()).sum();
        let tax = if mode == TaxMode::Qualified && base > 0 {
            base * rate / 100
        } else {
            0
        };
        by_rate.push(RateTotal { rate, base, tax });
    }
    let subtotal = by_rate.iter().map(|r| r.base).sum();
    let tax = by_rate.iter().map(|r| r.tax).sum();
    Totals {
        subtotal,
        by_rate,
        tax,
        total: subtotal + tax,
    }
}

/// 画面に出す状態。保存する状態に、入金と日付を合わせて決める。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum DisplayStatus {
    Draft,
    Issued,
    Sent,
    /// 一部だけ入金がある
    PartlyPaid,
    Paid,
    /// 支払期限を過ぎて、入金が足りない
    Overdue,
    Canceled,
}

/// 状態を決める。入金が関係するのは請求書だけ。`today` は `YYYY-MM-DD`。
pub fn display_status(
    kind: DocumentKind,
    status: DocumentStatus,
    total: i64,
    paid: i64,
    due_date: Option<&str>,
    today: &str,
) -> DisplayStatus {
    match status {
        DocumentStatus::Draft => DisplayStatus::Draft,
        DocumentStatus::Canceled => DisplayStatus::Canceled,
        _ if kind != DocumentKind::Invoice => match status {
            DocumentStatus::Sent => DisplayStatus::Sent,
            _ => DisplayStatus::Issued,
        },
        _ if total > 0 && paid >= total => DisplayStatus::Paid,
        _ if due_date.is_some_and(|d| d < today) => DisplayStatus::Overdue,
        _ if paid > 0 => DisplayStatus::PartlyPaid,
        DocumentStatus::Sent => DisplayStatus::Sent,
        _ => DisplayStatus::Issued,
    }
}

/// メールの件名・本文のひな形に、書類の値を差し込む。`{番号}` `{宛名}` `{金額}` `{期限}` `{差出人}`。
pub fn fill_template(template: &str, values: &[(&str, String)]) -> String {
    let mut text = template.to_string();
    for (key, value) in values {
        text = text.replace(&format!("{{{key}}}"), value);
    }
    text
}

/// メールソフトを開く `mailto:` の URL。件名・本文は URL の決まりで符号化する（RFC 6068）。
pub fn mailto(to: &str, subject: &str, body: &str) -> String {
    fn encode(text: &str) -> String {
        let mut out = String::new();
        for b in text.replace('\n', "\r\n").bytes() {
            if b.is_ascii_alphanumeric() || b"-._~".contains(&b) {
                out.push(b as char);
            } else {
                out.push_str(&format!("%{b:02X}"));
            }
        }
        out
    }
    // 宛先のアドレスはそのまま（@ は残す）。区切りに使われる文字は除く
    let to: String = to
        .chars()
        .filter(|c| !matches!(c, '?' | '&' | '#' | ' ' | '\r' | '\n'))
        .collect();
    format!(
        "mailto:{to}?subject={}&body={}",
        encode(subject),
        encode(body)
    )
}

/// メールアドレスの形を確かめる（空はよい）。送れるかどうかは送るときに分かる。
pub fn email(value: &str, field: &'static str) -> AppResult<String> {
    let value = value.trim();
    if value.is_empty() {
        return Ok(String::new());
    }
    let valid = value.len() <= 254
        && value.matches('@').count() == 1
        && value
            .split_once('@')
            .is_some_and(|(l, d)| !l.is_empty() && d.contains('.') && !d.starts_with('.'))
        && !value.chars().any(|c| c.is_whitespace() || c.is_control());
    if valid {
        Ok(value.to_string())
    } else {
        Err(AppError::field(ErrorCode::InvalidFormat, field))
    }
}

/// 宛名・題名・備考など、短い文の長さを確かめる。
pub fn text(value: &str, max: usize, field: &'static str) -> AppResult<String> {
    let value = value.trim();
    if value.chars().count() > max {
        return Err(AppError::field(ErrorCode::TooLong, field));
    }
    Ok(value.to_string())
}

pub const RECIPIENT_MAX: usize = NAME_MAX * 2;

#[cfg(test)]
mod tests {
    use super::*;

    fn line(quantity: i64, unit_price: i64, tax_rate: i64) -> LineInput {
        LineInput {
            name: "作業".into(),
            quantity,
            unit: String::new(),
            unit_price,
            tax_rate,
        }
    }

    #[test]
    fn tax_is_rounded_once_per_rate() {
        // 10%: 333 + 333 + 333 = 999 → 消費税 99（行ごとに切り捨てると 33×3 = 99 で同じだが、
        // 8%: 125 + 125 = 250 → 20。行ごとなら 10 + 10 = 20）
        let lines = [
            line(100, 333, 10),
            line(100, 333, 10),
            line(100, 333, 10),
            line(100, 125, 8),
            line(100, 125, 8),
            line(100, 500, 0),
        ];
        let t = totals(&lines, TaxMode::Qualified);
        assert_eq!(
            t.by_rate,
            [
                RateTotal {
                    rate: 10,
                    base: 999,
                    tax: 99
                },
                RateTotal {
                    rate: 8,
                    base: 250,
                    tax: 20
                },
                RateTotal {
                    rate: 0,
                    base: 500,
                    tax: 0
                },
            ]
        );
        assert_eq!((t.subtotal, t.tax, t.total), (1_749, 119, 1_868));
        // 端数が出る例: 10% で 1,999 円 → 199.9 → 199
        let t = totals(&[line(100, 1_999, 10)], TaxMode::Qualified);
        assert_eq!((t.tax, t.total), (199, 2_198));
    }

    #[test]
    fn exempt_documents_add_no_tax() {
        let t = totals(&[line(200, 8_000, 10)], TaxMode::Simple);
        assert_eq!((t.subtotal, t.tax, t.total), (16_000, 0, 16_000));
    }

    #[test]
    fn quantities_can_have_decimals_and_discounts_are_negative() {
        // 1.5 時間 × 3,333 円 = 4,999.5 → 4,999
        assert_eq!(line(150, 3_333, 10).amount(), 4_999);
        let t = totals(
            &[line(100, 10_000, 10), line(100, -1_000, 10)],
            TaxMode::Qualified,
        );
        assert_eq!((t.subtotal, t.tax, t.total), (9_000, 900, 9_900));
    }

    #[test]
    fn validates_lines() {
        assert_eq!(
            validate_lines(&[]).unwrap_err(),
            AppError::field(ErrorCode::Required, "lines")
        );
        let mut bad = line(100, 100, 5);
        assert_eq!(
            validate_lines(&[line(100, 1, 10), bad.clone()]).unwrap_err(),
            AppError::line(ErrorCode::InvalidFormat, 1, "taxRate")
        );
        bad.tax_rate = 10;
        bad.quantity = 0;
        assert_eq!(
            validate_lines(&[bad]).unwrap_err(),
            AppError::line(ErrorCode::OutOfRange, 0, "quantity")
        );
        let mut blank = line(100, 1, 10);
        blank.name = "  ".into();
        assert_eq!(
            validate_lines(&[blank]).unwrap_err(),
            AppError::line(ErrorCode::Required, 0, "name")
        );
    }

    #[test]
    fn numbers_and_conversions() {
        assert_eq!(number(DocumentKind::Invoice, 2026, 7), "INV-2026-0007");
        assert!(DocumentKind::Estimate.can_convert_to(DocumentKind::Invoice));
        assert!(DocumentKind::Invoice.can_convert_to(DocumentKind::Receipt));
        assert!(!DocumentKind::Receipt.can_convert_to(DocumentKind::Invoice));
    }

    #[test]
    fn status_follows_payments_and_due_date() {
        use DisplayStatus as D;
        use DocumentKind::*;
        use DocumentStatus as S;
        let today = "2026-03-10";
        assert_eq!(
            display_status(Invoice, S::Draft, 100, 0, None, today),
            D::Draft
        );
        assert_eq!(
            display_status(Invoice, S::Issued, 100, 0, Some("2026-03-31"), today),
            D::Issued
        );
        assert_eq!(
            display_status(Invoice, S::Sent, 100, 0, Some("2026-03-31"), today),
            D::Sent
        );
        assert_eq!(
            display_status(Invoice, S::Sent, 100, 40, Some("2026-03-31"), today),
            D::PartlyPaid
        );
        assert_eq!(
            display_status(Invoice, S::Sent, 100, 40, Some("2026-03-09"), today),
            D::Overdue
        );
        assert_eq!(
            display_status(Invoice, S::Sent, 100, 100, Some("2026-03-09"), today),
            D::Paid
        );
        assert_eq!(
            display_status(Invoice, S::Canceled, 100, 100, None, today),
            D::Canceled
        );
        // 期限の当日はまだ期限切れでない
        assert_eq!(
            display_status(Invoice, S::Issued, 100, 0, Some(today), today),
            D::Issued
        );
        // 見積書に入金や期限切れはない
        assert_eq!(
            display_status(Estimate, S::Issued, 100, 0, Some("2026-01-01"), today),
            D::Issued
        );
    }

    #[test]
    fn mail_templates_and_mailto() {
        let text = fill_template(
            "{番号} のご請求（{金額}円）",
            &[("番号", "INV-2026-0001".into()), ("金額", "11,000".into())],
        );
        assert_eq!(text, "INV-2026-0001 のご請求（11,000円）");
        assert_eq!(
            mailto("a@example.com", "請求書", "よろしく\nお願いします"),
            "mailto:a@example.com?subject=%E8%AB%8B%E6%B1%82%E6%9B%B8&body=%E3%82%88%E3%82%8D%E3%81%97%E3%81%8F%0D%0A%E3%81%8A%E9%A1%98%E3%81%84%E3%81%97%E3%81%BE%E3%81%99"
        );
        // 宛先に紛れた区切りの文字は除く
        assert!(
            mailto("a@example.com?cc=x@y.z", "", "").starts_with("mailto:a@example.comcc=x@y.z?")
        );
    }

    #[test]
    fn emails() {
        assert_eq!(email(" a@example.com ", "email").unwrap(), "a@example.com");
        assert_eq!(email("", "email").unwrap(), "");
        for bad in ["a@b", "a@@b.c", "@b.c", "a b@c.d", "a@.c"] {
            assert!(email(bad, "email").is_err(), "{bad}");
        }
    }
}
