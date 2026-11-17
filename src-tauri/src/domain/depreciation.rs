//! 固定資産の減価償却の計算。
//!
//! 個人事業主の法定の償却方法（定額法）を既定にし、次に対応する。
//!
//! | 方法 | 計算 |
//! |---|---|
//! | 定額法 | 取得価額 × 定額法の償却率 × 使った月数 / 12 |
//! | 定率法（200%） | 期首の帳簿価額 × 定率法の償却率。償却保証額（取得価額 × 保証率）を下回った年からは、改定取得価額 × 改定償却率 |
//! | 一括償却資産 | 取得価額 / 3 を 3 年。月割しない。帳簿価額は 0 まで |
//! | 少額減価償却資産の特例 | 取得した年に全額。帳簿価額は 0 まで（青色申告・30 万円未満） |
//!
//! - 定額法・定率法は、帳簿価額を 1 円（備忘価額）残す。取得した年と手放した年は月割にする
//!   （1 か月未満は 1 か月）
//! - 計算した償却費のうち、事業に使った割合（事業専用割合）の分を経費にし、残りは事業主貸にする
//! - 円未満は切り捨てる
//! - 償却率は年度ごとのデータ（`data/depreciation_rates.json`）から読む
//!
//! 税法の取り扱い（償却方法の届出、耐用年数、端数の扱いなど）は税理士に確認すること。
//! 平成 19 年 3 月以前に取得した資産（旧定額法・旧定率法）と、平成 24 年 3 月以前の
//! 250% 定率法には対応しない。

use super::string_enum;
use crate::error::{AppError, AppResult, ErrorCode};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::OnceLock;

string_enum! {
    /// 償却方法。
    pub enum Method {
        /// 定額法
        StraightLine => "straight_line",
        /// 定率法（200% 定率法）
        DecliningBalance => "declining_balance",
        /// 一括償却資産（3 年で均等に償却）
        LumpSum => "lump_sum",
        /// 少額減価償却資産の特例（取得した年に全額）
        SmallAsset => "small_asset",
    }
}

/// 少額減価償却資産の特例を使える取得価額の上限（この額未満）。
pub const SMALL_ASSET_LIMIT: i64 = 300_000;
/// 少額減価償却資産の特例を使える、1 年の合計の上限。
pub const SMALL_ASSET_YEARLY_LIMIT: i64 = 3_000_000;
/// 一括償却資産にできる取得価額の上限（この額未満）。
pub const LUMP_SUM_LIMIT: i64 = 200_000;

#[derive(Debug, Clone, Deserialize)]
struct DecliningRate {
    rate: i64,
    revised: Option<i64>,
    guarantee: Option<i64>,
}

#[derive(Debug, Deserialize)]
struct RateTable {
    straight_line: HashMap<String, i64>,
    declining_balance: HashMap<String, DecliningRate>,
}

fn rates() -> &'static RateTable {
    static TABLE: OnceLock<RateTable> = OnceLock::new();
    TABLE.get_or_init(|| {
        serde_json::from_str(include_str!("data/depreciation_rates.json"))
            .expect("同梱の償却率の表が読めない")
    })
}

/// 定額法の償却率（千分率）。
pub fn straight_rate(years: u32) -> Option<i64> {
    rates().straight_line.get(&years.to_string()).copied()
}

/// 定率法の償却率・改定償却率・保証率。
fn declining_rate(years: u32) -> Option<DecliningRate> {
    rates().declining_balance.get(&years.to_string()).cloned()
}

/// よくある資産の耐用年数の例（画面の候補）。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UsefulLife {
    pub ja: String,
    pub en: String,
    pub years: u32,
}

pub fn useful_life_examples() -> Vec<UsefulLife> {
    #[derive(Deserialize)]
    struct File {
        items: Vec<UsefulLife>,
    }
    serde_json::from_str::<File>(include_str!("data/useful_lives.json"))
        .map(|f| f.items)
        .unwrap_or_default()
}

/// 計算に使う資産の情報。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Asset {
    pub cost: i64,
    /// 取得（事業に使い始めた）年と月
    pub acquired: (i64, u32),
    pub method: Method,
    pub useful_life: u32,
    /// 事業に使う割合（1〜100）
    pub business_percent: i64,
    /// この年の初めの帳簿価額を `book_value` として登録した。取得した年以後なら取得価額と同じ
    pub book_value_year: i64,
    pub book_value: i64,
    /// 手放した（売った・捨てた）年と月
    pub disposed: Option<(i64, u32)>,
}

/// 1 年分の償却。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct YearDepreciation {
    pub year: i64,
    /// 償却した月数（1〜12）。一括償却資産・少額の特例は 12
    pub months: u32,
    /// 期首の帳簿価額（取得した年は取得価額）
    pub opening_book_value: i64,
    /// 償却の基礎になる金額（定額法は取得価額、定率法は期首の帳簿価額か改定取得価額）
    pub base: i64,
    /// 償却率（千分率）。一括償却資産・少額の特例は 0
    pub rate: i64,
    /// 本年分の償却費の合計
    pub depreciation: i64,
    /// うち経費にする分（事業専用割合の分）
    pub business: i64,
    /// うち事業主貸にする分
    pub private: i64,
    /// 期末の帳簿価額（未償却残高）
    pub closing_book_value: i64,
}

/// 入力を確かめる。登録するときに使う。
pub fn validate(asset: &Asset) -> AppResult<()> {
    let (year, month) = asset.acquired;
    if asset.cost <= 0 {
        return Err(AppError::field(ErrorCode::OutOfRange, "cost"));
    }
    if !(1..=12).contains(&month) {
        return Err(AppError::field(ErrorCode::InvalidFormat, "acquiredOn"));
    }
    if !(1..=100).contains(&asset.business_percent) {
        return Err(AppError::field(ErrorCode::OutOfRange, "businessPercent"));
    }
    if asset.book_value < 0 || asset.book_value > asset.cost {
        return Err(AppError::field(ErrorCode::OutOfRange, "bookValue"));
    }
    if let Some(disposed) = asset.disposed {
        if disposed < asset.acquired {
            return Err(AppError::field(ErrorCode::OutOfRange, "disposedOn"));
        }
    }
    match asset.method {
        Method::StraightLine => {
            // 平成 19 年 4 月 1 日以後に取得したもの（新しい定額法）
            if (year, month) < (2007, 4) {
                return Err(AppError::field(ErrorCode::OutOfRange, "acquiredOn"));
            }
            straight_rate(asset.useful_life)
                .ok_or(AppError::field(ErrorCode::OutOfRange, "usefulLife"))?;
        }
        Method::DecliningBalance => {
            // 平成 24 年 4 月 1 日以後に取得したもの（200% 定率法）
            if (year, month) < (2012, 4) {
                return Err(AppError::field(ErrorCode::OutOfRange, "acquiredOn"));
            }
            declining_rate(asset.useful_life)
                .ok_or(AppError::field(ErrorCode::OutOfRange, "usefulLife"))?;
        }
        Method::LumpSum => {
            if asset.cost >= LUMP_SUM_LIMIT {
                return Err(AppError::field(ErrorCode::OutOfRange, "cost"));
            }
        }
        Method::SmallAsset => {
            if asset.cost >= SMALL_ASSET_LIMIT {
                return Err(AppError::field(ErrorCode::OutOfRange, "cost"));
            }
        }
    }
    Ok(())
}

/// 年 `year` に使った月数。取得した年は取得月から、手放した年は手放した月まで。使っていなければ 0。
fn months_in_use(asset: &Asset, year: i64) -> u32 {
    let (acq_year, acq_month) = asset.acquired;
    if year < acq_year {
        return 0;
    }
    let start = if year == acq_year { acq_month } else { 1 };
    let end = match asset.disposed {
        Some((y, _)) if y < year => return 0,
        Some((y, m)) if y == year => m,
        _ => 12,
    };
    if end < start {
        0
    } else {
        end - start + 1
    }
}

fn split(asset: &Asset, depreciation: i64) -> (i64, i64) {
    let business = depreciation * asset.business_percent / 100;
    (business, depreciation - business)
}

/// 年 `year` の償却。帳簿価額は `book_value_year` の年から順に計算する。
/// 償却の対象でない年（取得の前、登録の前、手放した後、償却し終えた後）は `None`。
pub fn for_year(asset: &Asset, year: i64) -> Option<YearDepreciation> {
    schedule(asset, year).into_iter().find(|d| d.year == year)
}

/// 登録した年から `upto` 年までの償却。
pub fn schedule(asset: &Asset, upto: i64) -> Vec<YearDepreciation> {
    let start_year = asset.book_value_year.max(asset.acquired.0);
    // 取得した年以後に登録したなら、帳簿価額は取得価額から始まる
    let mut book = if asset.book_value_year <= asset.acquired.0 {
        asset.cost
    } else {
        asset.book_value
    };
    // 定率法で、償却保証額を下回って改定償却率に切り替えたときの改定取得価額
    let mut revised_base =
        if asset.method == Method::DecliningBalance && start_year > asset.acquired.0 {
            revised_base_before(asset, start_year)
        } else {
            None
        };

    let mut result = Vec::new();
    for year in start_year..=upto {
        let months = months_in_use(asset, year);
        let opening = book;
        let (base, rate, depreciation) = match asset.method {
            Method::StraightLine => {
                let rate = straight_rate(asset.useful_life).unwrap_or(0);
                let full = asset.cost * rate * i64::from(months) / (1000 * 12);
                (asset.cost, rate, full.min((book - 1).max(0)))
            }
            Method::DecliningBalance => {
                let Some(r) = declining_rate(asset.useful_life) else {
                    break;
                };
                let (base, rate) = declining_base(asset, &r, book, &mut revised_base);
                let full = base * rate * i64::from(months) / (1000 * 12);
                (base, rate, full.min((book - 1).max(0)))
            }
            Method::LumpSum => {
                let offset = year - asset.acquired.0;
                // 手放しても 3 年で償却し続ける
                let amount = match offset {
                    0 | 1 => asset.cost / 3,
                    2 => asset.cost - asset.cost / 3 * 2,
                    _ => 0,
                };
                (asset.cost, 0, amount.min(book))
            }
            Method::SmallAsset => {
                let amount = if year == asset.acquired.0 {
                    asset.cost
                } else {
                    0
                };
                (asset.cost, 0, amount.min(book))
            }
        };
        let months = match asset.method {
            Method::LumpSum | Method::SmallAsset => 12,
            _ => months,
        };
        if depreciation <= 0 {
            continue;
        }
        book -= depreciation;
        let (business, private) = split(asset, depreciation);
        result.push(YearDepreciation {
            year,
            months,
            opening_book_value: opening,
            base,
            rate,
            depreciation,
            business,
            private,
            closing_book_value: book,
        });
    }
    result
}

/// 定率法のその年の償却の基礎と償却率。償却保証額を下回ったら、改定取得価額と改定償却率にする。
fn declining_base(
    asset: &Asset,
    r: &DecliningRate,
    book: i64,
    revised_base: &mut Option<i64>,
) -> (i64, i64) {
    if let (Some(base), Some(revised)) = (*revised_base, r.revised) {
        return (base, revised);
    }
    let regular = book * r.rate / 1000;
    let guarantee = asset.cost * r.guarantee.unwrap_or(0) / 100_000;
    match r.revised {
        Some(revised) if regular < guarantee => {
            *revised_base = Some(book);
            (book, revised)
        }
        _ => (book, r.rate),
    }
}

/// 登録した年より前に改定償却率へ切り替えていたなら、そのときの改定取得価額。
/// 取得したときから決まりどおりに償却してきたとして計算する。
fn revised_base_before(asset: &Asset, start_year: i64) -> Option<i64> {
    let theoretical = Asset {
        book_value_year: asset.acquired.0,
        book_value: asset.cost,
        disposed: None,
        ..asset.clone()
    };
    let r = declining_rate(asset.useful_life)?;
    let mut book = asset.cost;
    let mut revised = None;
    for year in asset.acquired.0..start_year {
        let months = months_in_use(&theoretical, year);
        let (base, rate) = declining_base(&theoretical, &r, book, &mut revised);
        book -= (base * rate * i64::from(months) / 12_000).min((book - 1).max(0));
    }
    revised
}

#[cfg(test)]
mod tests {
    use super::*;

    fn asset(cost: i64, acquired: (i64, u32), method: Method, years: u32) -> Asset {
        Asset {
            cost,
            acquired,
            method,
            useful_life: years,
            business_percent: 100,
            book_value_year: acquired.0,
            book_value: cost,
            disposed: None,
        }
    }

    fn amounts(asset: &Asset, upto: i64) -> Vec<(i64, i64, i64)> {
        schedule(asset, upto)
            .iter()
            .map(|d| (d.year, d.depreciation, d.closing_book_value))
            .collect()
    }

    #[test]
    fn rates_come_from_the_bundled_table() {
        assert_eq!(straight_rate(4), Some(250));
        assert_eq!(straight_rate(3), Some(334));
        assert_eq!(straight_rate(6), Some(167));
        assert_eq!(straight_rate(47), Some(22));
        assert_eq!(straight_rate(1), None);
        assert!(!useful_life_examples().is_empty());
    }

    #[test]
    fn straight_line_is_prorated_by_month_and_leaves_one_yen() {
        // パソコン 240,000 円、4 年、4 月に取得
        let pc = asset(240_000, (2026, 4), Method::StraightLine, 4);
        assert_eq!(
            amounts(&pc, 2035),
            [
                // 240,000 × 0.250 × 9 / 12
                (2026, 45_000, 195_000),
                (2027, 60_000, 135_000),
                (2028, 60_000, 75_000),
                (2029, 60_000, 15_000),
                // 残りは 1 円（備忘価額）を残して償却する
                (2030, 14_999, 1),
            ]
        );
        assert_eq!(for_year(&pc, 2026).unwrap().months, 9);
        assert_eq!(for_year(&pc, 2031), None);
    }

    #[test]
    fn declining_balance_switches_to_the_revised_rate() {
        // 普通自動車 2,000,000 円、6 年、1 月に取得。償却率 0.333、改定償却率 0.334、保証率 0.09911
        let car = asset(2_000_000, (2026, 1), Method::DecliningBalance, 6);
        assert_eq!(
            amounts(&car, 2040),
            [
                (2026, 666_000, 1_334_000),
                (2027, 444_222, 889_778),
                (2028, 296_296, 593_482),
                // 593,482 × 0.333 = 197,629 は償却保証額 198,220 を下回るので、
                // 改定取得価額 593,482 × 改定償却率 0.334 = 198,222 にする
                (2029, 198_222, 395_260),
                (2030, 198_222, 197_038),
                (2031, 197_037, 1),
            ]
        );
        let d = for_year(&car, 2029).unwrap();
        assert_eq!((d.base, d.rate), (593_482, 334));
    }

    #[test]
    fn declining_balance_registered_mid_life_continues_with_the_revised_base() {
        // 2029 年の初めに、帳簿価額 593,482 円で登録した（それまでは別の帳簿でつけていた）
        let mut car = asset(2_000_000, (2026, 1), Method::DecliningBalance, 6);
        car.book_value_year = 2029;
        car.book_value = 593_482;
        assert_eq!(
            amounts(&car, 2031),
            [
                (2029, 198_222, 395_260),
                (2030, 198_222, 197_038),
                (2031, 197_037, 1)
            ]
        );
        // 改定に切り替えた後の年から登録しても、改定取得価額は取得からの計算で決まる
        car.book_value_year = 2030;
        car.book_value = 395_260;
        assert_eq!(amounts(&car, 2030), [(2030, 198_222, 197_038)]);
    }

    #[test]
    fn lump_sum_assets_are_written_off_over_three_years_without_proration() {
        let desk = asset(150_001, (2026, 11), Method::LumpSum, 0);
        assert_eq!(
            amounts(&desk, 2030),
            [
                (2026, 50_000, 100_001),
                (2027, 50_000, 50_001),
                (2028, 50_001, 0)
            ]
        );
    }

    #[test]
    fn small_assets_are_written_off_in_the_year_bought() {
        let pc = asset(250_000, (2026, 10), Method::SmallAsset, 4);
        assert_eq!(amounts(&pc, 2028), [(2026, 250_000, 0)]);
    }

    #[test]
    fn private_use_goes_to_owner_drawings() {
        let mut pc = asset(240_000, (2026, 4), Method::StraightLine, 4);
        pc.business_percent = 60;
        let d = for_year(&pc, 2026).unwrap();
        // 45,000 × 60% = 27,000 を経費、18,000 を事業主貸
        assert_eq!(
            (d.depreciation, d.business, d.private),
            (45_000, 27_000, 18_000)
        );
        // 帳簿価額は全額で減る
        assert_eq!(d.closing_book_value, 195_000);
    }

    #[test]
    fn disposal_year_is_prorated_and_later_years_stop() {
        let mut pc = asset(240_000, (2026, 4), Method::StraightLine, 4);
        pc.disposed = Some((2027, 6));
        // 60,000 × 6 / 12
        assert_eq!(
            amounts(&pc, 2030),
            [(2026, 45_000, 195_000), (2027, 30_000, 165_000)]
        );
    }

    #[test]
    fn validation() {
        let ok = asset(240_000, (2026, 4), Method::StraightLine, 4);
        assert!(validate(&ok).is_ok());
        let old = asset(240_000, (2006, 4), Method::StraightLine, 4);
        assert_eq!(validate(&old).unwrap_err().field, Some("acquiredOn"));
        let no_rate = asset(240_000, (2026, 4), Method::DecliningBalance, 30);
        assert_eq!(validate(&no_rate).unwrap_err().field, Some("usefulLife"));
        let too_big = asset(300_000, (2026, 4), Method::SmallAsset, 4);
        assert_eq!(validate(&too_big).unwrap_err().field, Some("cost"));
        let lump = asset(200_000, (2026, 4), Method::LumpSum, 0);
        assert_eq!(validate(&lump).unwrap_err().field, Some("cost"));
        let mut pct = ok.clone();
        pct.business_percent = 0;
        assert_eq!(validate(&pct).unwrap_err().field, Some("businessPercent"));
    }
}
