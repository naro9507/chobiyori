//! 自動仕訳ルール（明細の店名から、科目などの候補を決める）。
//!
//! 店名は表記ゆれ（全角半角、半角カナ、大文字小文字、空白、決済代行の接頭辞）をそろえてから比べる。
//! カードの明細とレシート（フェーズ 6）で同じルールを使う。

use super::master::TaxCategory;
use super::statement::to_half_width;
use super::string_enum;
use serde::{Deserialize, Serialize};

string_enum! {
    /// 店名の比べ方。
    pub enum MatchKind {
        /// 店名に含まれる
        Contains => "contains",
        /// 店名がそろえたあとで同じ
        Equals => "equals",
    }
}

/// 決済代行などが店名の前に付ける文字。そろえるときに外す。
const PREFIXES: &[&str] = &[
    "PAYPAL*",
    "SQ*",
    "STRIPE*",
    "AP/",
    "KDDI/",
    "楽天ペイ/",
    "PAY.JP*",
];

/// 半角カナを全角カナにする。濁点・半濁点は前の文字と合わせる。
fn widen_kana(text: &str) -> String {
    const BASE: &str = "ヲァィゥェォャュョッーアイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワン";
    let base: Vec<char> = BASE.chars().collect();
    let mut out = String::with_capacity(text.len());
    for c in text.chars() {
        match c {
            // ｦ(U+FF66)〜ﾝ(U+FF9D)
            '\u{FF66}'..='\u{FF9D}' => out.push(base[(c as u32 - 0xFF66) as usize]),
            // ﾞ 濁点
            '\u{FF9E}' => match out.pop() {
                Some('ウ') => out.push('ヴ'),
                Some(p) => out.push(
                    char::from_u32(p as u32 + 1)
                        .filter(|_| "カキクケコサシスセソタチツテトハヒフヘホ".contains(p))
                        .unwrap_or(p),
                ),
                None => {}
            },
            // ﾟ 半濁点
            '\u{FF9F}' => match out.pop() {
                Some(p) if "ハヒフヘホ".contains(p) => {
                    out.push(char::from_u32(p as u32 + 2).unwrap_or(p))
                }
                Some(p) => out.push(p),
                None => {}
            },
            '\u{FF61}' => out.push('。'),
            '\u{FF62}' => out.push('「'),
            '\u{FF63}' => out.push('」'),
            '\u{FF64}' => out.push('、'),
            '\u{FF65}' => out.push('・'),
            _ => out.push(c),
        }
    }
    out
}

/// 店名をそろえる。全角英数字は半角に、半角カナは全角に、英字は大文字に、
/// 空白と「・」は除き、決済代行の接頭辞を外す。
pub fn normalize(name: &str) -> String {
    let half: String = name.chars().map(to_half_width).collect();
    let mut text: String = widen_kana(&half)
        .to_uppercase()
        .chars()
        .filter(|c| !c.is_whitespace() && *c != '・' && *c != '･')
        .collect();
    loop {
        let before = text.len();
        for prefix in PREFIXES {
            if let Some(rest) = text.strip_prefix(prefix) {
                text = rest.to_string();
            }
        }
        if text.len() == before {
            break;
        }
    }
    text
}

/// ルールの結果。科目を決めるか、「対象外」（取り込まない・私用）にする。
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuleResult {
    #[serde(default)]
    pub account_id: Option<i64>,
    #[serde(default)]
    pub sub_account_id: Option<i64>,
    #[serde(default)]
    pub partner_id: Option<i64>,
    #[serde(default)]
    pub memo: String,
    #[serde(default)]
    pub tax_category: Option<TaxCategory>,
    /// 家事按分の事業割合（0〜100）。空なら按分しない
    #[serde(default)]
    pub allocation_percent: Option<i64>,
    /// 対象外にする（私用の支払いなど）
    #[serde(default)]
    pub ignore: bool,
}

/// 自動仕訳ルール。
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Rule {
    pub id: i64,
    /// 店名の条件（そろえたあとの文字列）
    pub pattern: String,
    pub match_kind: MatchKind,
    /// 金額の範囲（利用額の絶対値）。空なら問わない
    pub min_amount: Option<i64>,
    pub max_amount: Option<i64>,
    /// 取込形式を限る。空ならどの明細にも使う
    pub format_id: Option<i64>,
    pub result: RuleResult,
    pub is_active: bool,
    pub sort: i64,
}

impl Rule {
    pub fn matches(&self, normalized_merchant: &str, spend: i64, format_id: Option<i64>) -> bool {
        let amount = spend.abs();
        self.is_active
            && !self.pattern.is_empty()
            && match self.match_kind {
                MatchKind::Contains => normalized_merchant.contains(&self.pattern),
                MatchKind::Equals => normalized_merchant == self.pattern,
            }
            && self.min_amount.is_none_or(|m| amount >= m)
            && self.max_amount.is_none_or(|m| amount <= m)
            && self.format_id.is_none_or(|f| Some(f) == format_id)
    }
}

/// 明細の行に合うルールを選ぶ。並び順の小さいもの、同じなら条件の長い（細かい）もの。
pub fn find<'a>(
    rules: &'a [Rule],
    merchant: &str,
    spend: i64,
    format_id: Option<i64>,
) -> Option<&'a Rule> {
    let normalized = normalize(merchant);
    rules
        .iter()
        .filter(|r| r.matches(&normalized, spend, format_id))
        .min_by_key(|r| (r.sort, std::cmp::Reverse(r.pattern.chars().count()), r.id))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_spelling_differences() {
        assert_eq!(normalize("ｽﾀｰﾊﾞｯｸｽ 新宿店"), "スターバックス新宿店");
        assert_eq!(normalize("スターバックス　新宿店"), "スターバックス新宿店");
        assert_eq!(normalize("ＡＭＡＺＯＮ．ＣＯ．ＪＰ"), "AMAZON.CO.JP");
        assert_eq!(normalize("amazon.co.jp"), "AMAZON.CO.JP");
        assert_eq!(normalize("PAYPAL *NOTE INC"), "NOTEINC");
        assert_eq!(normalize("ﾊﾟﾝ ﾔ"), "パンヤ");
        assert_eq!(normalize("ｳﾞｨﾚｯｼﾞ"), "ヴィレッジ");
    }

    fn rule(id: i64, pattern: &str, kind: MatchKind, sort: i64) -> Rule {
        Rule {
            id,
            pattern: normalize(pattern),
            match_kind: kind,
            min_amount: None,
            max_amount: None,
            format_id: None,
            result: RuleResult {
                account_id: Some(id * 10),
                ..Default::default()
            },
            is_active: true,
            sort,
        }
    }

    #[test]
    fn picks_the_most_specific_rule() {
        let rules = [
            rule(1, "AMAZON", MatchKind::Contains, 0),
            rule(2, "AMAZON.CO.JP", MatchKind::Contains, 0),
            rule(3, "カフェ", MatchKind::Equals, 0),
        ];
        assert_eq!(
            find(&rules, "Amazon.co.jp", 1200, None).map(|r| r.id),
            Some(2)
        );
        assert_eq!(
            find(&rules, "AMAZON WEB SERVICES", 1200, None).map(|r| r.id),
            Some(1)
        );
        assert_eq!(find(&rules, "ｶﾌｪ", 500, None).map(|r| r.id), Some(3));
        assert_eq!(find(&rules, "カフェ渋谷", 500, None), None);
        // 並び順が先のルールを優先する
        let mut first = rule(4, "AMAZON", MatchKind::Contains, -1);
        first.result.ignore = true;
        let rules = [rules[1].clone(), first];
        assert_eq!(
            find(&rules, "AMAZON.CO.JP", 1200, None).map(|r| r.id),
            Some(4)
        );
    }

    #[test]
    fn amount_range_format_and_inactive() {
        let mut r = rule(1, "コンビニ", MatchKind::Contains, 0);
        r.max_amount = Some(1000);
        r.format_id = Some(7);
        assert!(r.matches(&normalize("コンビニ"), 800, Some(7)));
        assert!(r.matches(&normalize("コンビニ"), -800, Some(7)));
        assert!(!r.matches(&normalize("コンビニ"), 1500, Some(7)));
        assert!(!r.matches(&normalize("コンビニ"), 800, Some(8)));
        r.is_active = false;
        assert!(!r.matches(&normalize("コンビニ"), 800, Some(7)));
    }
}
