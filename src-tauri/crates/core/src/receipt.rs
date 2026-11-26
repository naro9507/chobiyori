//! レシートの読み取り結果の扱い（読み直し・自己検算・税率ごとの分け方）。
//!
//! 読み取りは外の AI（Gemini）に頼むが、返ってきた値はそのまま信じない。
//! ここで日付・金額を読み直し、「合計 = 税率ごとの対象額の合計」「税額が税率と合う」
//! 「日付が暦にあり、未来でない」を確かめ、合わないところを `Check` として返す。
//! 合わないところがあっても候補は作るが、画面でその項目を必ず見てもらう。

use super::master::TaxCategory;
use super::statement::{parse_amount, parse_date};
use super::string_enum;
use serde::{Deserialize, Serialize};
use serde_json::Value;

/// 読み取りに使うモデルの決まりごと。モデル名は設定で変えられる（提供側の改廃に備える）。
/// 設定がないときのモデル。
///
/// 2026-11-20 に試験用レシート 12 種類で比べて決めた（`scripts/receipt-dogfood`）。
/// - gemini-2.5-flash: 新しく作った API キーでは 404（「新しい利用者には提供しない」）
/// - gemini-3.8-flash / gemini-3.5-flash: 読めたものは全問正解。ただし 1 枚 5〜110 秒かかり、
///   無料枠は 1 日 20 回まで
/// - gemini-3.5-flash-lite: 12 枚すべて全問正解（75 項目）、1 枚およそ 1 秒
pub const DEFAULT_MODEL: &str = "gemini-3.5-flash-lite";

/// モデル名に使える文字だけか（URL に入れるため）。
pub fn valid_model(model: &str) -> bool {
    !model.is_empty()
        && model.len() <= 80
        && model
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '.' | '_'))
}

string_enum! {
    /// 支払方法。貸方の口座を決めるのに使う。
    pub enum PaymentMethod {
        Cash => "cash",
        Card => "card",
        EMoney => "eMoney",
        Unknown => "unknown",
    }
}

/// 税率ごとの対象額（税込）と税額。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaxPart {
    /// 税率（8 か 10）
    pub rate: i64,
    /// 対象額（税込）
    pub amount: i64,
    /// 税額（書いてなければ None）
    pub tax: Option<i64>,
}

/// 読み取った内容。読めなかった項目は空。
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReceiptReading {
    /// `YYYY-MM-DD`
    pub date: Option<String>,
    /// 合計（税込）
    pub total: Option<i64>,
    pub merchant: String,
    pub phone: String,
    /// 適格請求書発行事業者の登録番号（T + 13 桁）
    pub invoice_no: Option<String>,
    pub tax_parts: Vec<TaxPart>,
    pub payment: Option<PaymentMethod>,
    /// 画像に写っている、ほかのレシートの枚数（読んでいない）
    #[serde(default)]
    pub other_receipts: i64,
    /// ポイント・商品券などで払った額（合計からは引かれている）
    #[serde(default)]
    pub points: i64,
    /// 買った物から推した経費の科目（決算書の行のキー。`pl.supplies` など）。
    /// 印字を読んだ値ではなく推測。ルールも前回の仕訳もないとき、確認の画面の科目に入れておく（確定は利用者）
    #[serde(default)]
    pub category: Option<String>,
}

/// AI に選ばせる経費の科目。（返事の値, 決算書の行）。返事の値は英語の短い語にする
/// （利用者の科目名は送らないため、標準の科目に対応する決算書の行で受け取る）。
pub const CATEGORIES: &[(&str, &str)] = &[
    ("supplies", "pl.supplies"),
    ("travel", "pl.travel"),
    ("communication", "pl.communication"),
    ("entertainment", "pl.entertainment"),
    ("utilities", "pl.utilities"),
    ("freight", "pl.freight"),
    ("advertising", "pl.advertising"),
    ("repairs", "pl.repairs"),
    ("welfare", "pl.welfare"),
    ("taxesDues", "pl.taxes_dues"),
    ("rent", "pl.rent"),
    ("purchases", "pl.purchases"),
    ("misc", "pl.misc_expenses"),
];

/// AI の返事の科目を、決算書の行のキーにする。知らない値・`unknown` は None。
fn category_of(text: &str) -> Option<String> {
    CATEGORIES
        .iter()
        .find(|(key, _)| *key == text)
        .map(|(_, line)| (*line).to_string())
}

string_enum! {
    /// ポイントで払った分の貸方。ポイントの出どころで決まる。
    pub enum PointsAs {
        /// 個人の買い物で貯めたポイント（事業主が出した）→ 事業主借
        Owner => "owner",
        /// 仕事の買い物で貯めたポイント（事業で得た）→ 雑収入（不課税）
        Income => "income",
    }
}

string_enum! {
    /// 自己検算で引っかかったところ。画面はこれを見て、その項目を目立たせる。
    pub enum Check {
        /// 日付が読めない
        MissingDate => "missingDate",
        /// 日付が未来か、古すぎる
        UnlikelyDate => "unlikelyDate",
        /// 合計が読めない
        MissingTotal => "missingTotal",
        /// 合計と、税率ごとの対象額の合計が合わない
        TotalMismatch => "totalMismatch",
        /// 税額が税率と合わない
        TaxMismatch => "taxMismatch",
        /// 登録番号の形が違う（T + 13 桁でない）
        InvalidInvoiceNo => "invalidInvoiceNo",
        /// 店名が読めない
        MissingMerchant => "missingMerchant",
        /// 1 枚の画像にレシートが 2 枚以上写っている（1 枚分しか読んでいない）
        MultipleReceipts => "multipleReceipts",
    }
}

/// AI に頼む返事の形（JSON Schema）。読み取りの方式を差し替えても、この形にそろえる。
pub fn response_schema() -> Value {
    serde_json::json!({
        "type": "object",
        "properties": {
            "date": { "type": "string", "description": "利用日。印字のまま（和暦でもよい）" },
            "total": { "type": "string", "description": "支払った合計（税込）" },
            "merchant": { "type": "string", "description": "店名" },
            "phone": { "type": "string" },
            "invoiceNo": { "type": "string", "description": "登録番号（T で始まる 13 桁の数字）" },
            "taxParts": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "rate": { "type": "integer", "description": "税率（8 か 10）" },
                        "amount": { "type": "string", "description": "その税率の対象額（税込）" },
                        "tax": { "type": "string", "description": "その税率の消費税額" }
                    },
                    "required": ["rate", "amount"]
                }
            },
            "payment": { "type": "string", "enum": ["cash", "card", "eMoney", "unknown"] },
            "points": { "type": "string", "description": "ポイント・商品券・ギフト券など、お金の代わりに使って合計から引かれた額（なければ空）" },
            "otherReceipts": { "type": "integer", "description": "読んだ 1 枚のほかに、画像に写っているレシート・領収書の枚数（なければ 0）" },
            "category": {
                "type": "string",
                "enum": category_enum(),
                "description": "買った物・サービスから考えた、個人事業の経費の科目（推測）"
            }
        },
        "required": ["date", "total", "merchant", "payment"]
    })
}

fn category_enum() -> Vec<&'static str> {
    CATEGORIES
        .iter()
        .map(|(key, _)| *key)
        .chain(["unknown"])
        .collect()
}

/// AI に送る指示。帳簿や取引先の情報は送らない（画像とこの文だけ）。
pub const PROMPT: &str = "これは日本のレシートまたは領収書の画像です。印字されている内容だけを読み取り、指定の JSON で返してください。\
読めない項目は空の文字列にしてください。推測で値を作らないでください。\
taxParts には「10%対象」「8%対象（軽減税率）」などの税率ごとの対象額（税込）と消費税額を入れてください。\
payment は現金なら cash、クレジットカードなら card、電子マネーや QR コード決済なら eMoney、分からなければ unknown にしてください。\
「ポイント利用」「商品券」など、お金の代わりに使って合計から引かれた額は points に入れてください（合計は引いた後の、実際に払った額）。\
画像にレシートが 2 枚以上写っているときは、いちばん大きく写っている 1 枚だけを読み、ほかの枚数を otherReceipts に入れてください。\
category だけは推測でかまいません。品目と店の種類から、個人事業の経費ならどれに当たりそうかを選んでください\
（supplies: 消耗品・事務用品・10 万円未満の機器、travel: 電車・バス・タクシー・駐車場・宿泊・ガソリン、communication: 切手・電話・インターネット、\
entertainment: 取引先との飲食・贈答、utilities: 電気・ガス・水道、freight: 宅配便・梱包材、advertising: 広告・チラシ・印刷、repairs: 修理、\
welfare: 従業員のための飲食・慰労、taxesDues: 収入印紙・証明書の手数料、rent: 家賃・レンタルスペース、purchases: 売るための商品・材料、misc: そのほか）。\
決められなければ unknown にしてください。";

fn text_of(value: Option<&Value>) -> String {
    match value {
        Some(Value::String(s)) => s.trim().to_string(),
        Some(Value::Number(n)) => n.to_string(),
        _ => String::new(),
    }
}

fn amount_of(value: Option<&Value>) -> Option<i64> {
    let text = text_of(value);
    if text.is_empty() {
        return None;
    }
    // 領収書の書き方（「金33,000円也」「¥33,000-」「¥33,000－」）。
    // 後ろの「-」は、明細の CSV では負の数のことがあるので、レシートのときだけここで外す
    let text = text.trim_start_matches('金');
    let text = text.trim_end_matches(['也', '-', '－', '―', '‐', ' ', '　']);
    parse_amount(text).map(i64::abs).filter(|a| *a > 0)
}

/// レシートの日付を読む。明細と同じ読み方に加えて、レシートに多い西暦の下 2 桁
/// （「26/11/02」「26.11.02」）を 2000 年代として読む。
fn receipt_date(text: &str) -> Option<String> {
    if let Some(date) = parse_date(text) {
        return Some(date);
    }
    let text: String = text.chars().map(super::statement::to_half_width).collect();
    let first = text.split_whitespace().next()?;
    let parts: Vec<&str> = first.split(['/', '.', '-']).collect();
    match parts[..] {
        [y, m, d]
            if y.len() == 2
                && [y, m, d]
                    .iter()
                    .all(|p| !p.is_empty() && p.bytes().all(|b| b.is_ascii_digit())) =>
        {
            parse_date(&format!("20{y}/{m}/{d}"))
        }
        _ => None,
    }
}

/// 登録番号を「T + 13 桁」にそろえる。形が違えば None。
pub fn normalize_invoice_no(text: &str) -> Option<String> {
    let cleaned: String = text
        .chars()
        .map(super::statement::to_half_width)
        .filter(|c| !matches!(c, ' ' | '-' | '　'))
        .collect();
    let digits = cleaned
        .strip_prefix('T')
        .or_else(|| cleaned.strip_prefix('t'))
        .unwrap_or(&cleaned);
    (digits.len() == 13 && digits.bytes().all(|b| b.is_ascii_digit())).then(|| format!("T{digits}"))
}

/// AI の返事（JSON の文字列）を読む。形が違えば None。
pub fn parse_reading(text: &str) -> Option<(ReceiptReading, bool)> {
    let value: Value = serde_json::from_str(text.trim()).ok()?;
    let object = value.as_object()?;
    let invoice_text = text_of(object.get("invoiceNo"));
    let invoice_no = normalize_invoice_no(&invoice_text);
    let tax_parts = object
        .get("taxParts")
        .and_then(Value::as_array)
        .map(|parts| {
            parts
                .iter()
                .filter_map(|p| {
                    let rate = p.get("rate").and_then(Value::as_i64)?;
                    let amount = amount_of(p.get("amount"))?;
                    Some(TaxPart {
                        rate,
                        amount,
                        tax: amount_of(p.get("tax")),
                    })
                })
                .collect()
        })
        .unwrap_or_default();
    let payment = PaymentMethod::parse(&text_of(object.get("payment")));
    let date_text = text_of(object.get("date"));
    let reading = ReceiptReading {
        date: if date_text.is_empty() {
            None
        } else {
            receipt_date(&date_text)
        },
        total: amount_of(object.get("total")),
        merchant: text_of(object.get("merchant")).chars().take(100).collect(),
        phone: text_of(object.get("phone")).chars().take(30).collect(),
        invoice_no,
        tax_parts,
        payment,
        other_receipts: object
            .get("otherReceipts")
            .and_then(Value::as_i64)
            .unwrap_or(0)
            .clamp(0, 99),
        points: amount_of(object.get("points")).unwrap_or(0),
        category: category_of(&text_of(object.get("category"))),
    };
    // 登録番号らしいものが書いてあるのに形が違う
    let bad_invoice = !invoice_text.is_empty() && reading.invoice_no.is_none();
    Some((reading, bad_invoice))
}

/// 自己検算。`today` は `YYYY-MM-DD`。
pub fn checks(reading: &ReceiptReading, bad_invoice: bool, today: &str) -> Vec<Check> {
    let mut found = Vec::new();
    match &reading.date {
        None => found.push(Check::MissingDate),
        Some(date) => {
            // 未来の日付か、7 年（帳簿の保存期間）より前
            let year: i64 = today.get(..4).and_then(|y| y.parse().ok()).unwrap_or(0);
            let date_year: i64 = date.get(..4).and_then(|y| y.parse().ok()).unwrap_or(0);
            if date.as_str() > today || date_year < year - 7 {
                found.push(Check::UnlikelyDate);
            }
        }
    }
    if reading.merchant.trim().is_empty() {
        found.push(Check::MissingMerchant);
    }
    match reading.total {
        None => found.push(Check::MissingTotal),
        Some(total) if !reading.tax_parts.is_empty() => {
            let sum: i64 = reading.tax_parts.iter().map(|p| p.amount).sum();
            // ポイントで払った分は、税率ごとの対象額に入っていてもよい（お店が支払いとして扱うとき）
            if sum != total && sum != total + reading.points {
                found.push(Check::TotalMismatch);
            }
        }
        Some(_) => {}
    }
    let tax_ok = |p: &TaxPart| match p.tax {
        None => true,
        Some(tax) if p.rate == 8 || p.rate == 10 => {
            // 内税: 税額 ≒ 対象額 × 税率 ÷ (100 + 税率)。端数の扱いの違いで 1 円ずれてよい
            (tax * (100 + p.rate) - p.amount * p.rate).abs() <= 100 + p.rate
        }
        Some(_) => false,
    };
    if !reading.tax_parts.iter().all(tax_ok) {
        found.push(Check::TaxMismatch);
    }
    if bad_invoice {
        found.push(Check::InvalidInvoiceNo);
    }
    if reading.other_receipts > 0 {
        found.push(Check::MultipleReceipts);
    }
    found
}

/// 軽減税率（8%）の対象額。税率ごとの内訳が合計と合うときだけ使う。
pub fn reduced_amount(reading: &ReceiptReading) -> i64 {
    let Some(total) = reading.total else { return 0 };
    let sum: i64 = reading.tax_parts.iter().map(|p| p.amount).sum();
    if sum != total + booked_points(reading) {
        return 0;
    }
    reading
        .tax_parts
        .iter()
        .filter(|p| p.rate == 8)
        .map(|p| p.amount)
        .sum()
}

/// 記帳するポイントの額。経費は「払った額 + この額」、貸方はポイントの分を別の行にする。
///
/// 税率ごとの対象額がポイントを引いた後の額と合うときは、お店がポイントを値引きとして
/// 扱っている（自社ポイントなど）ので、払った額だけを経費にする（0 を返す）。
pub fn booked_points(reading: &ReceiptReading) -> i64 {
    let (Some(total), true) = (reading.total, reading.points > 0) else {
        return 0;
    };
    let sum: i64 = reading.tax_parts.iter().map(|p| p.amount).sum();
    if !reading.tax_parts.is_empty() && sum == total {
        return 0;
    }
    reading.points
}

/// 経費の行を税率で分ける。`reduced` は 8% の対象額（0〜total）。
/// 返すのは（税区分, 金額）の組。8% と 10% が混ざっていなければ 1 つ。
pub fn split_by_rate(total: i64, reduced: i64) -> Vec<(TaxCategory, i64)> {
    let reduced = reduced.clamp(0, total);
    match (reduced, total - reduced) {
        (0, standard) => vec![(TaxCategory::TaxablePurchase10, standard)],
        (reduced, 0) => vec![(TaxCategory::TaxablePurchase8, reduced)],
        (reduced, standard) => vec![
            (TaxCategory::TaxablePurchase10, standard),
            (TaxCategory::TaxablePurchase8, reduced),
        ],
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn categories_are_expense_lines_of_the_standard_accounts() {
        for (_, line) in CATEGORIES {
            assert!(
                crate::standard_accounts::GENERAL
                    .iter()
                    .any(|a| a.statement_line == Some(*line)),
                "{line}"
            );
        }
    }

    #[test]
    fn model_names_are_safe_for_the_url() {
        assert!(valid_model("gemini-2.5-flash"));
        assert!(!valid_model("../x"));
        assert!(!valid_model(""));
    }

    const GOOD: &str = r#"{
        "date": "令和8年3月5日", "total": "¥3,240", "merchant": "テスト商店",
        "phone": "03-0000-0000", "invoiceNo": "T 1234567890123",
        "taxParts": [
            {"rate": 10, "amount": "2,160", "tax": "196"},
            {"rate": 8, "amount": "1,080", "tax": "80"}
        ],
        "payment": "card"
    }"#;

    #[test]
    fn reads_japanese_dates_amounts_and_invoice_numbers() {
        let (r, bad) = parse_reading(GOOD).unwrap();
        assert!(!bad);
        assert_eq!(r.date.as_deref(), Some("2026-03-05"));
        assert_eq!(r.total, Some(3240));
        assert_eq!(r.invoice_no.as_deref(), Some("T1234567890123"));
        assert_eq!(r.payment, Some(PaymentMethod::Card));
        assert_eq!(r.tax_parts.len(), 2);
        assert!(checks(&r, bad, "2026-11-16").is_empty());
        assert_eq!(reduced_amount(&r), 1080);
    }

    #[test]
    fn self_checks_catch_inconsistent_readings() {
        let (mut r, _) = parse_reading(GOOD).unwrap();
        r.total = Some(3000);
        assert_eq!(checks(&r, false, "2026-11-16"), [Check::TotalMismatch]);
        // 合わないときは、軽減税率で分けない
        assert_eq!(reduced_amount(&r), 0);

        let (mut r, _) = parse_reading(GOOD).unwrap();
        r.tax_parts[0].tax = Some(500);
        assert_eq!(checks(&r, false, "2026-11-16"), [Check::TaxMismatch]);

        let (r, _) = parse_reading(GOOD).unwrap();
        // 未来の日付
        assert_eq!(checks(&r, false, "2026-01-01"), [Check::UnlikelyDate]);
    }

    #[test]
    fn missing_or_broken_values_are_reported_not_invented() {
        let (r, bad) = parse_reading(
            r#"{"date": "", "total": "", "merchant": "", "payment": "", "invoiceNo": "T12"}"#,
        )
        .unwrap();
        assert!(bad);
        assert_eq!(r.payment, None);
        assert_eq!(
            checks(&r, bad, "2026-11-16"),
            [
                Check::MissingDate,
                Check::MissingMerchant,
                Check::MissingTotal,
                Check::InvalidInvoiceNo
            ]
        );
        // 1 枚の画像に 2 枚写っていたら、読まなかった分があることを知らせる
        let (r, _) = parse_reading(&GOOD.replace(
            r#""payment": "card""#,
            r#""payment": "card", "otherReceipts": 1"#,
        ))
        .unwrap();
        assert_eq!(checks(&r, false, "2026-11-16"), [Check::MultipleReceipts]);
        assert!(parse_reading("こんにちは").is_none());
        // 科目の推測は、知っている値だけを決算書の行にする
        let (r, _) = parse_reading(&GOOD.replace(
            r#""payment": "card""#,
            r#""payment": "card", "category": "travel""#,
        ))
        .unwrap();
        assert_eq!(r.category.as_deref(), Some("pl.travel"));
        for unknown in ["unknown", "food", ""] {
            let (r, _) = parse_reading(&GOOD.replace(
                r#""payment": "card""#,
                &format!(r#""payment": "card", "category": "{unknown}""#),
            ))
            .unwrap();
            assert_eq!(r.category, None);
        }
        assert!(parse_reading("[1, 2]").is_none());
    }

    #[test]
    fn reads_receipt_style_dates_and_amounts() {
        let read = |date: &str, total: &str| {
            let text = serde_json::json!({
                "date": date, "total": total, "merchant": "店", "payment": "cash"
            });
            let (r, _) = parse_reading(&text.to_string()).unwrap();
            (r.date, r.total)
        };
        // 桁をそろえる空白・曜日・時刻
        assert_eq!(
            read("2026年11月 3日(火) 12:34", "¥1,512"),
            (Some("2026-11-03".into()), Some(1512))
        );
        // 西暦の下 2 桁
        assert_eq!(
            read("26/11/02 07:41", "450"),
            (Some("2026-11-02".into()), Some(450))
        );
        assert_eq!(
            read("２６．１１．０２", "450").0.as_deref(),
            Some("2026-11-02")
        );
        // 領収書の金額の書き方
        assert_eq!(read("2026/9/1", "¥33,000-").1, Some(33000));
        assert_eq!(read("2026/9/1", "金33,000円也").1, Some(33000));
        assert_eq!(read("2026/9/1", "￥３３，０００－").1, Some(33000));
        // 読めないものは読めないまま
        assert_eq!(read("26/13/02", "").0, None);
        assert_eq!(read("11/02", "-").1, None);
    }

    #[test]
    fn points_paid_count_toward_the_breakdown() {
        // ポイント 300 円で払った。税率ごとの対象額はポイントを引く前（1,100 + 216 = 1,316）
        let text = r#"{"date": "2026-11-10", "total": "1,016", "merchant": "ドラッグストア",
            "payment": "eMoney", "points": "300",
            "taxParts": [
                {"rate": 10, "amount": "1,100", "tax": "100"},
                {"rate": 8, "amount": "216", "tax": "16"}
            ]}"#;
        let (r, bad) = parse_reading(text).unwrap();
        assert_eq!(r.points, 300);
        assert!(checks(&r, bad, "2026-11-19").is_empty());
        assert_eq!(booked_points(&r), 300);
        // 軽減税率の分は、ポイントを引く前の額で分ける
        assert_eq!(reduced_amount(&r), 216);

        // 自社ポイントの値引き: 対象額がポイントを引いた後の額と合う → 払った額だけを経費にする
        let (r, _) =
            parse_reading(&text.replace(r#""1,100", "tax": "100""#, r#""800", "tax": "72""#))
                .unwrap();
        assert!(checks(&r, false, "2026-11-19").is_empty());
        assert_eq!(booked_points(&r), 0);
        assert_eq!(reduced_amount(&r), 216);

        // 内訳がなければ、ポイントの分を足して記帳する
        let (r, _) = parse_reading(
            r#"{"date": "2026-11-10", "total": "700", "merchant": "店", "payment": "cash", "points": "300"}"#,
        )
        .unwrap();
        assert_eq!(booked_points(&r), 300);

        // どちらとも合わなければ、これまでどおり見てもらう
        let (r, _) =
            parse_reading(&text.replace(r#""1,100", "tax": "100""#, r#""1,000", "tax": "90""#))
                .unwrap();
        assert_eq!(checks(&r, false, "2026-11-19"), [Check::TotalMismatch]);
        assert_eq!(reduced_amount(&r), 0);
    }

    #[test]
    fn splits_expense_by_tax_rate() {
        assert_eq!(
            split_by_rate(3240, 1080),
            [
                (TaxCategory::TaxablePurchase10, 2160),
                (TaxCategory::TaxablePurchase8, 1080)
            ]
        );
        assert_eq!(
            split_by_rate(500, 0),
            [(TaxCategory::TaxablePurchase10, 500)]
        );
        assert_eq!(
            split_by_rate(500, 500),
            [(TaxCategory::TaxablePurchase8, 500)]
        );
        assert_eq!(
            split_by_rate(500, 900),
            [(TaxCategory::TaxablePurchase8, 500)]
        );
    }

    #[test]
    fn invoice_numbers_are_normalized() {
        assert_eq!(
            normalize_invoice_no("Ｔ１２３４５６７８９０１２３").as_deref(),
            Some("T1234567890123")
        );
        assert_eq!(
            normalize_invoice_no("1234567890123").as_deref(),
            Some("T1234567890123")
        );
        assert_eq!(normalize_invoice_no("T123"), None);
    }
}
