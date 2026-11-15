//! 取引（仕訳）の決まりごと。入力の検証と、かんたん入力から仕訳への変換。
//!
//! 取引は「ヘッダ + 明細行」で持ち、明細行は借方・貸方を別の行にする。
//! どの入力方法（かんたん入力・仕訳グリッド・複合仕訳）でも、ここで同じ検証を通す。
//! DB には依存しない。マスタが有効かどうかは、呼び出し側が調べて渡す。

use super::master::MEMO_MAX;
use super::string_enum;
use crate::error::{AppError, AppResult, ErrorCode};
use serde::Deserialize;

string_enum! {
    /// 明細行が借方か貸方か。
    pub enum Side {
        Debit => "debit",
        Credit => "credit",
    }
}

string_enum! {
    /// どの入力方法で作った取引か。
    pub enum EntryMode {
        Simple => "simple",
        Grid => "grid",
        Compound => "compound",
        Import => "import",
        Receipt => "receipt",
        Card => "card",
    }
}

string_enum! {
    /// 取引の種類。フェーズ 2 で作るのは通常の取引だけ。
    pub enum TransactionKind {
        Normal => "normal",
        Allocation => "allocation",
        Template => "template",
        Depreciation => "depreciation",
        Opening => "opening",
        Closing => "closing",
    }
}

string_enum! {
    /// かんたん入力の種類。簿記の言葉を使わずに選べるようにする。
    pub enum SimpleKind {
        /// 収入: 口座 / 収益など
        Income => "income",
        /// 支出: 経費など / 口座
        Expense => "expense",
        /// 口座間の振替: 入れた口座 / 出した口座
        Transfer => "transfer",
        /// 事業のお金を私用に使った（引き出した）: 事業主貸 / 口座
        OwnerDraw => "owner_draw",
        /// 私用のお金を事業に入れた: 口座 / 事業主借
        OwnerContribution => "owner_contribution",
    }
}

/// 1 行の金額の上限（1 兆円未満）。合計しても桁あふれしないようにする。
pub const AMOUNT_MAX: i64 = 999_999_999_999;
/// 1 つの取引に置ける明細行の数の上限。
pub const LINES_MAX: usize = 100;

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LineInput {
    pub side: Side,
    pub account_id: i64,
    pub amount: i64,
    #[serde(default)]
    pub partner_id: Option<i64>,
    #[serde(default)]
    pub memo: String,
}

/// 仕訳グリッド・複合仕訳から保存する取引。
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TransactionInput {
    /// `YYYY-MM-DD`
    pub date: String,
    pub entry_mode: EntryMode,
    /// 摘要（取引の内容）
    #[serde(default)]
    pub memo: String,
    pub lines: Vec<LineInput>,
}

/// かんたん入力。
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SimpleInput {
    pub kind: SimpleKind,
    pub date: String,
    pub amount: i64,
    /// 内容の科目（収入・支出のとき）。振替では入れた先の口座
    #[serde(default)]
    pub account_id: Option<i64>,
    /// 払った・受け取った口座。振替では出した口座
    pub payment_account_id: i64,
    #[serde(default)]
    pub partner_id: Option<i64>,
    #[serde(default)]
    pub memo: String,
}

/// 事業主の出し入れに使う科目。呼び出し側が DB から探して渡す。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct OwnerAccounts {
    /// 事業主貸
    pub drawings: i64,
    /// 事業主借
    pub contributions: i64,
}

/// かんたん入力を、借方 1 行 + 貸方 1 行の取引にする。
///
/// 例: 支出・消耗品費・現金 1,200 円 → `消耗品費 / 現金 1,200`
pub fn simple_to_transaction(
    input: &SimpleInput,
    owner: OwnerAccounts,
) -> AppResult<TransactionInput> {
    let account = || {
        input
            .account_id
            .ok_or(AppError::field(ErrorCode::Required, "accountId"))
    };
    let payment = input.payment_account_id;
    let (debit, credit) = match input.kind {
        SimpleKind::Income => (payment, account()?),
        SimpleKind::Expense => (account()?, payment),
        SimpleKind::Transfer => (account()?, payment),
        SimpleKind::OwnerDraw => (owner.drawings, payment),
        SimpleKind::OwnerContribution => (payment, owner.contributions),
    };
    if debit == credit {
        return Err(AppError::field(
            ErrorCode::SameAccount,
            simple_field(input.kind, Side::Debit),
        ));
    }
    let line = |side, account_id| LineInput {
        side,
        account_id,
        amount: input.amount,
        partner_id: input.partner_id,
        memo: String::new(),
    };
    Ok(TransactionInput {
        date: input.date.clone(),
        entry_mode: EntryMode::Simple,
        memo: input.memo.clone(),
        lines: vec![line(Side::Debit, debit), line(Side::Credit, credit)],
    })
}

/// かんたん入力で、借方・貸方の科目がどの入力欄から来たか。
fn simple_field(kind: SimpleKind, side: Side) -> &'static str {
    match (kind, side) {
        (SimpleKind::Income | SimpleKind::OwnerContribution, Side::Debit)
        | (SimpleKind::Expense | SimpleKind::Transfer | SimpleKind::OwnerDraw, Side::Credit) => {
            "paymentAccountId"
        }
        _ => "accountId",
    }
}

/// 仕訳の検証で出た明細行のエラーを、かんたん入力の入力欄のエラーにする。
/// かんたん入力の仕訳は、0 行目が借方、1 行目が貸方。
pub fn simple_error(kind: SimpleKind, error: AppError) -> AppError {
    let Some(line) = error.line else {
        return error;
    };
    let side = if line == 0 { Side::Debit } else { Side::Credit };
    let field = match error.field {
        Some("accountId") => simple_field(kind, side),
        Some(field) => field,
        None => return AppError::new(error.code),
    };
    AppError::field(error.code, field)
}

/// 日付 `YYYY-MM-DD` を読む。暦にない日（2 月 30 日など）は `None`。
pub fn parse_date(text: &str) -> Option<(i64, u32, u32)> {
    let bytes = text.as_bytes();
    if bytes.len() != 10 || bytes[4] != b'-' || bytes[7] != b'-' {
        return None;
    }
    let number = |range: std::ops::Range<usize>| -> Option<u32> {
        let part = &text[range];
        if part.bytes().all(|b| b.is_ascii_digit()) {
            part.parse().ok()
        } else {
            None
        }
    };
    let year = number(0..4)?;
    let month = number(5..7)?;
    let day = number(8..10)?;
    if !(1..=12).contains(&month) || day == 0 || day > days_in_month(i64::from(year), month) {
        return None;
    }
    Some((i64::from(year), month, day))
}

pub fn days_in_month(year: i64, month: u32) -> u32 {
    match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 if (year % 4 == 0 && year % 100 != 0) || year % 400 == 0 => 29,
        2 => 28,
        _ => 0,
    }
}

/// 月 `month`（1〜12）の初日と末日。
pub fn month_range(year: i64, month: u32) -> AppResult<(String, String)> {
    if !(1..=12).contains(&month) {
        return Err(AppError::field(ErrorCode::OutOfRange, "month"));
    }
    Ok((
        format!("{year:04}-{month:02}-01"),
        format!("{year:04}-{month:02}-{:02}", days_in_month(year, month)),
    ))
}

/// 年度 `year` の `from_month` 月初から `to_month` 月末まで。帳簿や試算表の期間に使う。
pub fn period_range(year: i64, from_month: u32, to_month: u32) -> AppResult<(String, String)> {
    let (from, _) = month_range(year, from_month)?;
    let (_, to) = month_range(year, to_month)?;
    if from_month > to_month {
        return Err(AppError::field(ErrorCode::OutOfRange, "toMonth"));
    }
    Ok((from, to))
}

/// 明細行が使うマスタの状態。呼び出し側が DB から調べて渡す。
pub trait MasterLookup {
    /// 科目が有効なら `Some(true)`、無効なら `Some(false)`、なければ `None`。
    fn account_active(&self, id: i64) -> Option<bool>;
    fn partner_active(&self, id: i64) -> Option<bool>;
}

/// 検証を通った取引。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ValidTransaction {
    pub date: String,
    pub memo: String,
    pub lines: Vec<LineInput>,
}

/// 取引を検証する。
///
/// - 日付は年度 `fiscal_year` の中
/// - 金額は 1 円以上の整数
/// - 借方と貸方がそれぞれ 1 行以上あり、同じ科目が借方と貸方の両方にない
/// - 有効なマスタだけ（`allowed_inactive` にある科目・取引先は、無効でも使ってよい。
///   変更前の取引がすでに使っていたもの）
/// - 借方合計 = 貸方合計
pub fn validate(
    input: &TransactionInput,
    fiscal_year: i64,
    masters: &impl MasterLookup,
    allowed_inactive: &AllowedInactive,
) -> AppResult<ValidTransaction> {
    match parse_date(input.date.trim()) {
        None => return Err(AppError::field(ErrorCode::InvalidFormat, "date")),
        Some((year, _, _)) if year != fiscal_year => {
            return Err(AppError::field(ErrorCode::OutOfRange, "date"))
        }
        Some(_) => {}
    }
    let memo = super::master::optional(&input.memo, MEMO_MAX, "memo")?;

    if input.lines.len() > LINES_MAX {
        return Err(AppError::field(ErrorCode::OutOfRange, "lines"));
    }
    let mut lines = Vec::with_capacity(input.lines.len());
    for (index, line) in input.lines.iter().enumerate() {
        if !(1..=AMOUNT_MAX).contains(&line.amount) {
            return Err(AppError::line(ErrorCode::OutOfRange, index, "amount"));
        }
        match masters.account_active(line.account_id) {
            None => return Err(AppError::line(ErrorCode::NotFound, index, "accountId")),
            Some(false) if !allowed_inactive.accounts.contains(&line.account_id) => {
                return Err(AppError::line(ErrorCode::Inactive, index, "accountId"))
            }
            Some(_) => {}
        }
        if let Some(partner) = line.partner_id {
            match masters.partner_active(partner) {
                None => return Err(AppError::line(ErrorCode::NotFound, index, "partnerId")),
                Some(false) if !allowed_inactive.partners.contains(&partner) => {
                    return Err(AppError::line(ErrorCode::Inactive, index, "partnerId"))
                }
                Some(_) => {}
            }
        }
        let line_memo = super::master::optional(&line.memo, MEMO_MAX, "memo")
            .map_err(|e| AppError::line(e.code, index, "memo"))?;
        lines.push(LineInput {
            memo: line_memo,
            ..line.clone()
        });
    }

    let has = |side: Side| lines.iter().any(|l| l.side == side);
    if !has(Side::Debit) || !has(Side::Credit) {
        return Err(AppError::field(ErrorCode::Required, "lines"));
    }
    for (index, line) in lines.iter().enumerate() {
        let opposite = lines
            .iter()
            .any(|other| other.side != line.side && other.account_id == line.account_id);
        if opposite && line.side == Side::Credit {
            return Err(AppError::line(ErrorCode::SameAccount, index, "accountId"));
        }
    }
    if total(&lines, Side::Debit) != total(&lines, Side::Credit) {
        return Err(AppError::new(ErrorCode::Unbalanced));
    }

    Ok(ValidTransaction {
        date: input.date.trim().to_string(),
        memo,
        lines,
    })
}

/// 片側の合計。金額には上限があり、行数にも上限があるので桁あふれしない。
pub fn total(lines: &[LineInput], side: Side) -> i64 {
    lines
        .iter()
        .filter(|l| l.side == side)
        .map(|l| l.amount)
        .sum()
}

/// 無効でも使ってよいマスタ。取引を変更するとき、変更前に使っていたもの。
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct AllowedInactive {
    pub accounts: Vec<i64>,
    pub partners: Vec<i64>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    /// 科目 1〜9 が有効、10 が無効。取引先 1 が有効、2 が無効。
    struct Masters {
        accounts: HashMap<i64, bool>,
        partners: HashMap<i64, bool>,
    }

    impl Masters {
        fn new() -> Self {
            let mut accounts: HashMap<_, _> = (1..=9).map(|id| (id, true)).collect();
            accounts.insert(10, false);
            Self {
                accounts,
                partners: HashMap::from([(1, true), (2, false)]),
            }
        }
    }

    impl MasterLookup for Masters {
        fn account_active(&self, id: i64) -> Option<bool> {
            self.accounts.get(&id).copied()
        }
        fn partner_active(&self, id: i64) -> Option<bool> {
            self.partners.get(&id).copied()
        }
    }

    fn line(side: Side, account_id: i64, amount: i64) -> LineInput {
        LineInput {
            side,
            account_id,
            amount,
            partner_id: None,
            memo: String::new(),
        }
    }

    fn input(lines: Vec<LineInput>) -> TransactionInput {
        TransactionInput {
            date: "2026-03-15".into(),
            entry_mode: EntryMode::Grid,
            memo: " 文具 ".into(),
            lines,
        }
    }

    fn check(input: &TransactionInput) -> AppResult<ValidTransaction> {
        validate(input, 2026, &Masters::new(), &AllowedInactive::default())
    }

    #[test]
    fn accepts_a_simple_balanced_entry() {
        let valid = check(&input(vec![
            line(Side::Debit, 1, 1200),
            line(Side::Credit, 2, 1200),
        ]))
        .unwrap();
        assert_eq!(valid.memo, "文具");
        assert_eq!(valid.lines.len(), 2);
    }

    #[test]
    fn accepts_a_balanced_compound_entry() {
        // 給料 200,000 = 普通預金 179,580 + 預り金 20,420
        check(&input(vec![
            line(Side::Debit, 1, 200_000),
            line(Side::Credit, 2, 179_580),
            line(Side::Credit, 3, 20_420),
        ]))
        .unwrap();
    }

    #[test]
    fn rejects_unbalanced_entries() {
        let err = check(&input(vec![
            line(Side::Debit, 1, 1000),
            line(Side::Credit, 2, 999),
        ]))
        .unwrap_err();
        assert_eq!(err, AppError::new(ErrorCode::Unbalanced));
    }

    #[test]
    fn needs_both_sides() {
        let err = check(&input(vec![line(Side::Debit, 1, 1000)])).unwrap_err();
        assert_eq!(err, AppError::field(ErrorCode::Required, "lines"));
        let err = check(&input(vec![])).unwrap_err();
        assert_eq!(err, AppError::field(ErrorCode::Required, "lines"));
    }

    #[test]
    fn amounts_are_at_least_one_yen_and_bounded() {
        for amount in [0, -1, AMOUNT_MAX + 1] {
            let err = check(&input(vec![
                line(Side::Debit, 1, 1000),
                line(Side::Credit, 2, amount),
            ]))
            .unwrap_err();
            assert_eq!(err, AppError::line(ErrorCode::OutOfRange, 1, "amount"));
        }
    }

    #[test]
    fn same_account_on_both_sides_is_rejected() {
        let err = check(&input(vec![
            line(Side::Debit, 1, 1000),
            line(Side::Credit, 1, 1000),
        ]))
        .unwrap_err();
        assert_eq!(err, AppError::line(ErrorCode::SameAccount, 1, "accountId"));
    }

    #[test]
    fn date_must_be_a_real_day_in_the_fiscal_year() {
        let ok = vec![line(Side::Debit, 1, 1), line(Side::Credit, 2, 1)];
        for (date, code) in [
            ("2025-12-31", ErrorCode::OutOfRange),
            ("2027-01-01", ErrorCode::OutOfRange),
            ("2026-02-29", ErrorCode::InvalidFormat),
            ("2026-13-01", ErrorCode::InvalidFormat),
            ("2026/03/01", ErrorCode::InvalidFormat),
            ("", ErrorCode::InvalidFormat),
        ] {
            let mut i = input(ok.clone());
            i.date = date.into();
            assert_eq!(
                check(&i).unwrap_err(),
                AppError::field(code, "date"),
                "{date}"
            );
        }
        let mut i = input(ok);
        i.date = "2026-12-31".into();
        assert!(check(&i).is_ok());
    }

    #[test]
    fn only_active_masters_unless_already_used() {
        let err = check(&input(vec![
            line(Side::Debit, 10, 1),
            line(Side::Credit, 2, 1),
        ]))
        .unwrap_err();
        assert_eq!(err, AppError::line(ErrorCode::Inactive, 0, "accountId"));

        let err = check(&input(vec![
            line(Side::Debit, 99, 1),
            line(Side::Credit, 2, 1),
        ]))
        .unwrap_err();
        assert_eq!(err, AppError::line(ErrorCode::NotFound, 0, "accountId"));

        let mut with_partner = line(Side::Credit, 2, 1);
        with_partner.partner_id = Some(2);
        let lines = vec![line(Side::Debit, 10, 1), with_partner];
        let err = check(&input(lines.clone())).unwrap_err();
        assert_eq!(err, AppError::line(ErrorCode::Inactive, 0, "accountId"));

        let allowed = AllowedInactive {
            accounts: vec![10],
            partners: vec![2],
        };
        validate(&input(lines), 2026, &Masters::new(), &allowed).unwrap();
    }

    #[test]
    fn leap_years() {
        assert_eq!(parse_date("2028-02-29"), Some((2028, 2, 29)));
        assert_eq!(parse_date("2100-02-29"), None);
        assert_eq!(parse_date("2000-02-29"), Some((2000, 2, 29)));
        assert_eq!(
            month_range(2028, 2).unwrap(),
            ("2028-02-01".into(), "2028-02-29".into())
        );
        assert_eq!(
            month_range(2026, 13).unwrap_err(),
            AppError::field(ErrorCode::OutOfRange, "month")
        );
    }

    fn simple(kind: SimpleKind, account_id: Option<i64>, payment: i64) -> SimpleInput {
        SimpleInput {
            kind,
            date: "2026-03-15".into(),
            amount: 1200,
            account_id,
            payment_account_id: payment,
            partner_id: Some(1),
            memo: "ペン".into(),
        }
    }

    const OWNER: OwnerAccounts = OwnerAccounts {
        drawings: 8,
        contributions: 9,
    };

    fn sides(t: &TransactionInput) -> (i64, i64) {
        assert_eq!(t.lines.len(), 2);
        assert_eq!(t.lines[0].side, Side::Debit);
        assert_eq!(t.lines[1].side, Side::Credit);
        assert!(t.lines.iter().all(|l| l.amount == 1200));
        (t.lines[0].account_id, t.lines[1].account_id)
    }

    #[test]
    fn simple_entries_become_one_debit_and_one_credit() {
        // 支出・消耗品費（5）・現金（1） → 消耗品費 / 現金
        let t = simple_to_transaction(&simple(SimpleKind::Expense, Some(5), 1), OWNER).unwrap();
        assert_eq!(sides(&t), (5, 1));
        assert_eq!(t.entry_mode, EntryMode::Simple);
        assert_eq!(t.memo, "ペン");
        assert!(t.lines.iter().all(|l| l.partner_id == Some(1)));

        // 収入・売上（4）・普通預金（2） → 普通預金 / 売上
        let t = simple_to_transaction(&simple(SimpleKind::Income, Some(4), 2), OWNER).unwrap();
        assert_eq!(sides(&t), (2, 4));

        // 振替: 普通預金（2）から現金（1）へ → 現金 / 普通預金
        let t = simple_to_transaction(&simple(SimpleKind::Transfer, Some(1), 2), OWNER).unwrap();
        assert_eq!(sides(&t), (1, 2));

        // 引き出し → 事業主貸 / 現金
        let t = simple_to_transaction(&simple(SimpleKind::OwnerDraw, None, 1), OWNER).unwrap();
        assert_eq!(sides(&t), (8, 1));

        // 入れる → 現金 / 事業主借
        let t =
            simple_to_transaction(&simple(SimpleKind::OwnerContribution, None, 1), OWNER).unwrap();
        assert_eq!(sides(&t), (1, 9));
    }

    #[test]
    fn simple_entry_needs_the_content_account_and_different_accounts() {
        let err = simple_to_transaction(&simple(SimpleKind::Expense, None, 1), OWNER).unwrap_err();
        assert_eq!(err, AppError::field(ErrorCode::Required, "accountId"));

        let err =
            simple_to_transaction(&simple(SimpleKind::Transfer, Some(1), 1), OWNER).unwrap_err();
        assert_eq!(err, AppError::field(ErrorCode::SameAccount, "accountId"));

        let err =
            simple_to_transaction(&simple(SimpleKind::OwnerDraw, None, 8), OWNER).unwrap_err();
        assert_eq!(err.code, ErrorCode::SameAccount);
    }

    #[test]
    fn line_errors_map_to_simple_entry_fields() {
        let map = |kind, line, field| {
            simple_error(kind, AppError::line(ErrorCode::Inactive, line, field))
        };
        assert_eq!(
            map(SimpleKind::Expense, 0, "accountId"),
            AppError::field(ErrorCode::Inactive, "accountId")
        );
        assert_eq!(
            map(SimpleKind::Expense, 1, "accountId"),
            AppError::field(ErrorCode::Inactive, "paymentAccountId")
        );
        assert_eq!(
            map(SimpleKind::Income, 0, "accountId"),
            AppError::field(ErrorCode::Inactive, "paymentAccountId")
        );
        assert_eq!(
            map(SimpleKind::Income, 1, "amount"),
            AppError::field(ErrorCode::Inactive, "amount")
        );
        let plain = AppError::new(ErrorCode::Unbalanced);
        assert_eq!(simple_error(SimpleKind::Income, plain.clone()), plain);
    }
}
