//! 確定申告・消費税の申告・インボイスの登録の補助（F12）。DB には依存しない。
//!
//! - 申告の期限、2 割特例の期間、みなし仕入率は年度ごとのデータ（`data/filing.json`）で持つ
//! - 消費税は、明細行の税区分（税込経理）から税率ごとに集計し、2 割特例と簡易課税で納める額を出す。
//!   本則課税は計算しない（集計表だけ）
//! - 年の途中でインボイスに登録した年は、登録日の前を免税、登録日からを課税として扱う
//!
//! 計算のしかた・特例の条件・期限が正しいかは、税理士か税務署に確認すること。

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::sync::OnceLock;

#[derive(Debug, Deserialize)]
struct Deadlines {
    income: String,
    consumption: String,
}

#[derive(Debug, Deserialize)]
struct Special20 {
    first_year: i64,
    last_year: i64,
}

#[derive(Debug, Deserialize)]
struct FilingData {
    deadlines: BTreeMap<String, Deadlines>,
    special20: Special20,
    deemed_purchase_rates: BTreeMap<String, i64>,
    paper_deduction_cap: i64,
}

fn data() -> &'static FilingData {
    static DATA: OnceLock<FilingData> = OnceLock::new();
    DATA.get_or_init(|| {
        serde_json::from_str(include_str!("data/filing.json"))
            .expect("filing.json は同梱のデータで、読めることをテストで確かめている")
    })
}

// ---- 日付 ----

/// `YYYY-MM-DD` を年・月・日に。
fn ymd(date: &str) -> Option<(i64, u32, u32)> {
    super::journal::parse_date(date)
}

/// 1970-01-01 からの日数（グレゴリオ暦）。
pub fn days_from_civil(y: i64, m: u32, d: u32) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let m = i64::from(m);
    let mp = (m + 9) % 12;
    let doy = (153 * mp + 2) / 5 + i64::from(d) - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    let y = yoe + era * 400 + i64::from(m <= 2);
    (y, m, d)
}

fn format_date((y, m, d): (i64, u32, u32)) -> String {
    format!("{y:04}-{m:02}-{d:02}")
}

/// 土日なら次の月曜にずらす（祝日は年度ごとのデータで直す）。
fn next_weekday(y: i64, m: u32, d: u32) -> String {
    let days = days_from_civil(y, m, d);
    // 1970-01-01 は木曜。0 = 月曜
    let weekday = (days + 3).rem_euclid(7);
    let shift = match weekday {
        5 => 2,
        6 => 1,
        _ => 0,
    };
    format_date(civil_from_days(days + shift))
}

/// 日付 `to` まで、`from` から何日か（過ぎていれば負）。
pub fn days_between(from: &str, to: &str) -> Option<i64> {
    let (fy, fm, fd) = ymd(from)?;
    let (ty, tm, td) = ymd(to)?;
    Some(days_from_civil(ty, tm, td) - days_from_civil(fy, fm, fd))
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum DeadlineKind {
    /// 所得税の確定申告
    Income,
    /// 消費税の申告
    Consumption,
}

/// 年度 `year` の分の申告の期限と、それが年度のデータにあるか（なければ目安）。
pub fn deadline(year: i64, kind: DeadlineKind) -> (String, bool) {
    if let Some(d) = data().deadlines.get(&year.to_string()) {
        let date = match kind {
            DeadlineKind::Income => &d.income,
            DeadlineKind::Consumption => &d.consumption,
        };
        return (date.clone(), true);
    }
    let day = match kind {
        DeadlineKind::Income => 15,
        DeadlineKind::Consumption => 31,
    };
    (next_weekday(year + 1, 3, day), false)
}

// ---- 登録番号 ----

/// 登録番号（T + 13 桁）のチェックディジットが合うか。法人番号と同じ決まり
/// （先頭の 1 桁 = 9 −（下の桁から数えて奇数桁 ×1・偶数桁 ×2 の和を 9 で割った余り））。
/// 形が違えば `None`。個人の登録番号も同じ決まりかは確かめていないので、合わなくても
/// 保存は止めず、確かめるよう知らせるだけにする。
pub fn check_digit_ok(registration_no: &str) -> Option<bool> {
    let digits = registration_no.strip_prefix('T').unwrap_or(registration_no);
    if digits.len() != 13 || !digits.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    let bytes: Vec<i64> = digits.bytes().map(|b| i64::from(b - b'0')).collect();
    let sum: i64 = bytes[1..]
        .iter()
        .rev()
        .enumerate()
        .map(|(i, &d)| if i % 2 == 0 { d } else { d * 2 })
        .sum();
    Some(bytes[0] == 9 - sum % 9)
}

// ---- 免税と課税の切り替え ----

/// その日の取引を免税として扱うか。登録日のある年は、登録日の前が免税、登録日からが課税。
/// それ以外の年は、年度の消費税の区分に従う。
pub fn exempt_on(year_exempt: bool, registered_on: Option<&str>, date: &str) -> bool {
    if let (Some(reg), Some((year, _, _))) = (registered_on, ymd(date)) {
        if ymd(reg).map(|(y, _, _)| y) == Some(year) {
            return date < reg;
        }
    }
    year_exempt
}

/// 年度の中で課税として扱う最初の日。課税の取引がなければ `None`。
pub fn taxable_from(year: i64, year_exempt: bool, registered_on: Option<&str>) -> Option<String> {
    if let Some(reg) = registered_on {
        if ymd(reg).map(|(y, _, _)| y) == Some(year) {
            return Some(reg.to_string());
        }
    }
    (!year_exempt).then(|| format!("{year:04}-01-01"))
}

// ---- 消費税 ----

/// 税率。
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Rate {
    Standard10,
    Reduced8,
}

impl Rate {
    fn percent(self) -> i64 {
        match self {
            Rate::Standard10 => 10,
            Rate::Reduced8 => 8,
        }
    }

    /// 課税標準額にかける消費税（国税）の率。10% は 7.8%、軽減 8% は 6.24%（1 万分率）。
    fn national_per_10000(self) -> i64 {
        match self {
            Rate::Standard10 => 780,
            Rate::Reduced8 => 624,
        }
    }
}

/// 簡易課税の事業の区分（第 1 種〜第 6 種）。
pub fn valid_category(category: i64) -> bool {
    (1..=6).contains(&category)
}

/// 事業の区分のみなし仕入率（%）。
pub fn deemed_rate(category: i64) -> Option<i64> {
    data()
        .deemed_purchase_rates
        .get(&category.to_string())
        .copied()
}

/// 課税売上の集計の材料。税込の金額（返品は引いたもの）。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SalesAmount {
    pub rate: Rate,
    /// 簡易課税の事業の区分
    pub category: i64,
    pub tax_included: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RateTotal {
    pub rate: Rate,
    /// 税込の課税売上
    pub tax_included: i64,
    /// 税抜にした額（円未満切り捨て）
    pub tax_excluded: i64,
    /// 課税標準額（千円未満切り捨て）
    pub base: i64,
    /// 消費税額（国税）
    pub national_tax: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CategoryTotal {
    pub category: i64,
    pub deemed_rate: i64,
    pub tax_included: i64,
    /// この区分の売上の消費税額（国税）
    pub national_tax: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Payable {
    /// 仕入れの消費税として引ける額（国税）
    pub deductible: i64,
    /// 納める消費税（国税。百円未満切り捨て）
    pub national: i64,
    /// 納める地方消費税（国税の 22/78。百円未満切り捨て）
    pub local: i64,
    pub total: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConsumptionTax {
    pub rates: Vec<RateTotal>,
    /// 課税標準額の合計
    pub base: i64,
    /// 売上の消費税額（国税）の合計
    pub national_tax: i64,
    /// 2 割特例で納める額。使えない年度は `None`
    pub special20: Option<Payable>,
    /// 簡易課税で納める額
    pub simplified: Payable,
    pub categories: Vec<CategoryTotal>,
}

fn round_down(value: i64, unit: i64) -> i64 {
    value.div_euclid(unit) * unit
}

fn payable(national_tax: i64, deductible: i64) -> Payable {
    let national = round_down((national_tax - deductible).max(0), 100);
    let local = round_down(national * 22 / 78, 100);
    Payable {
        deductible,
        national,
        local,
        total: national + local,
    }
}

/// 2 割特例を使える年か（期間だけ。ほかの条件は案内して利用者が確かめる）。
pub fn special20_year(year: i64) -> bool {
    let s = &data().special20;
    (s.first_year..=s.last_year).contains(&year)
}

/// 消費税の額を計算する（割戻し計算）。
///
/// - 税率ごとに、税込の課税売上 × 100/110（100/108）を円未満切り捨て、千円未満を切り捨てて課税標準額
/// - 課税標準額 × 7.8%（6.24%）が売上の消費税額（国税）
/// - 2 割特例: 売上の消費税額の 8 割を引ける
/// - 簡易課税: 事業の区分ごとの売上の消費税額 × みなし仕入率を引ける（75% ルールなどの特例は使わない）
pub fn consumption_tax(year: i64, sales: &[SalesAmount]) -> ConsumptionTax {
    let mut by_rate: BTreeMap<Rate, i64> = BTreeMap::new();
    let mut by_category: BTreeMap<(i64, Rate), i64> = BTreeMap::new();
    for s in sales {
        *by_rate.entry(s.rate).or_default() += s.tax_included;
        *by_category.entry((s.category, s.rate)).or_default() += s.tax_included;
    }
    let tax_of = |rate: Rate, included: i64| -> (i64, i64) {
        let excluded = (included * 100).div_euclid(100 + rate.percent());
        let base = round_down(excluded, 1000);
        (excluded, base * rate.national_per_10000() / 10_000)
    };
    let rates: Vec<RateTotal> = [Rate::Standard10, Rate::Reduced8]
        .into_iter()
        .map(|rate| {
            let included = by_rate.get(&rate).copied().unwrap_or(0).max(0);
            let excluded = (included * 100).div_euclid(100 + rate.percent());
            let base = round_down(excluded, 1000);
            RateTotal {
                rate,
                tax_included: included,
                tax_excluded: excluded,
                base,
                national_tax: base * rate.national_per_10000() / 10_000,
            }
        })
        .collect();
    let base: i64 = rates.iter().map(|r| r.base).sum();
    let national_tax: i64 = rates.iter().map(|r| r.national_tax).sum();

    // 区分ごとの売上の消費税額。区分ごとに計算すると端数で合計とずれるので、
    // 引ける額は区分ごとの額の割合で、全体の消費税額から按分する
    let mut categories: BTreeMap<i64, (i64, i64)> = BTreeMap::new();
    for (&(category, rate), &included) in &by_category {
        let (_, tax) = tax_of(rate, included.max(0));
        let entry = categories.entry(category).or_default();
        entry.0 += included;
        entry.1 += tax;
    }
    let category_tax_sum: i64 = categories.values().map(|c| c.1).sum();
    let categories: Vec<CategoryTotal> = categories
        .into_iter()
        .map(|(category, (included, tax))| CategoryTotal {
            category,
            deemed_rate: deemed_rate(category).unwrap_or(0),
            tax_included: included,
            national_tax: tax,
        })
        .collect();
    let weighted: i64 = categories
        .iter()
        .map(|c| c.national_tax * c.deemed_rate)
        .sum();
    let simplified_deductible = if category_tax_sum > 0 {
        national_tax * weighted / (category_tax_sum * 100)
    } else {
        0
    };

    ConsumptionTax {
        rates,
        base,
        national_tax,
        special20: special20_year(year).then(|| payable(national_tax, national_tax * 8 / 10)),
        simplified: payable(national_tax, simplified_deductible),
        categories,
    }
}

/// 65 万円の控除を、e-Tax でも優良な電子帳簿でもなく出すときの上限（55 万円）。
pub fn paper_deduction_cap() -> i64 {
    data().paper_deduction_cap
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn year_data_reads() {
        assert!(data().deadlines.contains_key("2025"));
        assert_eq!(deemed_rate(1), Some(90));
        assert_eq!(deemed_rate(6), Some(40));
        assert_eq!(deemed_rate(7), None);
        assert_eq!(paper_deduction_cap(), 550_000);
    }

    #[test]
    fn deadlines_come_from_data_or_move_off_weekends() {
        assert_eq!(
            deadline(2025, DeadlineKind::Income),
            ("2026-03-16".into(), true)
        );
        assert_eq!(
            deadline(2025, DeadlineKind::Consumption),
            ("2026-03-31".into(), true)
        );
        // データにない年: 2027 年分の 2028-03-15 は水曜、2028-03-31 は金曜
        assert_eq!(
            deadline(2027, DeadlineKind::Income),
            ("2028-03-15".into(), false)
        );
        assert_eq!(
            deadline(2027, DeadlineKind::Consumption),
            ("2028-03-31".into(), false)
        );
        // 2029 年分: 2030-03-15 は金曜、2030-03-31 は日曜 → 4 月 1 日
        assert_eq!(
            deadline(2029, DeadlineKind::Consumption),
            ("2030-04-01".into(), false)
        );
        // 2030 年分: 2031-03-15 は土曜 → 17 日
        assert_eq!(
            deadline(2030, DeadlineKind::Income),
            ("2031-03-17".into(), false)
        );
    }

    #[test]
    fn data_deadlines_are_not_on_weekends() {
        for d in data().deadlines.values() {
            for date in [&d.income, &d.consumption] {
                let (y, m, day) = ymd(date).unwrap();
                assert_eq!(&next_weekday(y, m, day), date, "{date} は土日");
            }
        }
    }

    #[test]
    fn days_between_counts_days() {
        assert_eq!(days_between("2026-02-14", "2026-03-16"), Some(30));
        assert_eq!(days_between("2026-03-17", "2026-03-16"), Some(-1));
        assert_eq!(days_between("2024-02-28", "2024-03-01"), Some(2));
        assert_eq!(civil_from_days(days_from_civil(2024, 2, 29)), (2024, 2, 29));
    }

    #[test]
    fn check_digit_follows_the_corporate_number_rule() {
        // 国税庁の法人番号（7000012050002）
        assert_eq!(check_digit_ok("T7000012050002"), Some(true));
        assert_eq!(check_digit_ok("T8000012050002"), Some(false));
        assert_eq!(check_digit_ok("T123"), None);
        assert_eq!(check_digit_ok("Tabcdefghijklm"), None);
    }

    #[test]
    fn mid_year_registration_switches_on_the_date() {
        let reg = Some("2025-10-01");
        // 登録の年: 登録日の前は免税、登録日から課税（年度の区分に関係なく）
        assert!(exempt_on(true, reg, "2025-09-30"));
        assert!(!exempt_on(true, reg, "2025-10-01"));
        assert!(exempt_on(false, reg, "2025-01-05"));
        // ほかの年は年度の区分に従う
        assert!(!exempt_on(false, reg, "2026-01-05"));
        assert!(exempt_on(true, reg, "2024-12-31"));
        assert!(exempt_on(true, None, "2025-12-31"));

        assert_eq!(taxable_from(2025, true, reg), Some("2025-10-01".into()));
        assert_eq!(taxable_from(2026, false, reg), Some("2026-01-01".into()));
        assert_eq!(taxable_from(2024, true, reg), None);
    }

    #[test]
    fn special20_and_simplified_for_one_business() {
        // 税込 10% の売上 3,300,000 円、軽減 8% 216,000 円、第 5 種（みなし仕入率 50%）
        let sales = [
            SalesAmount {
                rate: Rate::Standard10,
                category: 5,
                tax_included: 3_300_000,
            },
            SalesAmount {
                rate: Rate::Reduced8,
                category: 5,
                tax_included: 216_000,
            },
        ];
        let t = consumption_tax(2025, &sales);
        // 10%: 3,300,000 × 100/110 = 3,000,000 → 課税標準額 3,000,000、× 7.8% = 234,000
        // 8%: 216,000 × 100/108 = 200,000 → 200,000、× 6.24% = 12,480
        assert_eq!(t.rates[0].base, 3_000_000);
        assert_eq!(t.rates[0].national_tax, 234_000);
        assert_eq!(t.rates[1].base, 200_000);
        assert_eq!(t.rates[1].national_tax, 12_480);
        assert_eq!((t.base, t.national_tax), (3_200_000, 246_480));
        // 2 割特例: 246,480 − 246,480 × 0.8（197,184）= 49,296 → 49,200、地方 49,200 × 22/78 = 13,876 → 13,800
        assert_eq!(
            t.special20,
            Some(Payable {
                deductible: 197_184,
                national: 49_200,
                local: 13_800,
                total: 63_000
            })
        );
        // 簡易課税 第 5 種: 246,480 × 50% = 123,240 を引く → 123,240 → 123,200、地方 34,748 → 34,700
        assert_eq!(
            t.simplified,
            Payable {
                deductible: 123_240,
                national: 123_200,
                local: 34_700,
                total: 157_900
            }
        );
    }

    #[test]
    fn simplified_with_two_categories_and_rounding_of_the_base() {
        // 第 1 種（卸売・90%）税込 1,100,000、第 5 種（サービス・50%）税込 1,100,500
        let sales = [
            SalesAmount {
                rate: Rate::Standard10,
                category: 1,
                tax_included: 1_100_000,
            },
            SalesAmount {
                rate: Rate::Standard10,
                category: 5,
                tax_included: 1_100_500,
            },
        ];
        let t = consumption_tax(2027, &sales);
        // 2,200,500 × 100/110 = 2,000,454 → 課税標準額 2,000,000、× 7.8% = 156,000
        assert_eq!(t.rates[0].tax_excluded, 2_000_454);
        assert_eq!(t.base, 2_000_000);
        assert_eq!(t.national_tax, 156_000);
        // 区分ごと: 第 1 種 1,000,000 → 78,000、第 5 種 1,000,454 → 1,000,000 → 78,000
        // 引ける額 = 156,000 × (78,000×90 + 78,000×50) / (156,000 × 100) = 109,200
        assert_eq!(t.simplified.deductible, 109_200);
        assert_eq!(t.simplified.national, 46_800);
        assert_eq!(t.simplified.local, 13_200);
        // 2027 年分は 2 割特例の期間の外
        assert_eq!(t.special20, None);
    }

    #[test]
    fn no_taxable_sales_means_nothing_to_pay() {
        let t = consumption_tax(2025, &[]);
        assert_eq!(t.national_tax, 0);
        assert_eq!(t.simplified.total, 0);
        assert_eq!(t.special20.unwrap().total, 0);
    }
}
