//! 自動仕訳ルールの読み書き。照合は `chobiyori_core::rules`。

use chobiyori_core::error::{AppError, AppResult, ErrorCode};
use chobiyori_core::master::{self, MEMO_MAX};
use chobiyori_core::rules::{normalize, MatchKind, Rule, RuleResult};
use rusqlite::{params, Connection, OptionalExtension, Row};
use serde::Deserialize;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuleInput {
    /// 店名の条件。保存するときにそろえる（全角半角・カナ・大文字小文字）
    pub pattern: String,
    pub match_kind: MatchKind,
    #[serde(default)]
    pub min_amount: Option<i64>,
    #[serde(default)]
    pub max_amount: Option<i64>,
    #[serde(default)]
    pub format_id: Option<i64>,
    pub result: RuleResult,
    #[serde(default = "active")]
    pub is_active: bool,
}

fn active() -> bool {
    true
}

const SELECT: &str =
    "SELECT id, pattern, match_kind, min_amount, max_amount, format_id, account_id, sub_account_id,
    partner_id, memo, tax_category, allocation_percent, ignore, is_active, sort FROM journal_rules";

fn from_row(row: &Row<'_>) -> rusqlite::Result<Rule> {
    Ok(Rule {
        id: row.get(0)?,
        pattern: row.get(1)?,
        match_kind: row.get(2)?,
        min_amount: row.get(3)?,
        max_amount: row.get(4)?,
        format_id: row.get(5)?,
        result: RuleResult {
            account_id: row.get(6)?,
            sub_account_id: row.get(7)?,
            partner_id: row.get(8)?,
            memo: row.get(9)?,
            tax_category: row.get(10)?,
            allocation_percent: row.get(11)?,
            ignore: row.get(12)?,
        },
        is_active: row.get(13)?,
        sort: row.get(14)?,
    })
}

pub fn list(conn: &Connection) -> AppResult<Vec<Rule>> {
    let mut stmt = conn.prepare(&format!("{SELECT} ORDER BY sort, id"))?;
    let rows = stmt.query_map([], from_row)?;
    Ok(rows.collect::<Result<_, _>>()?)
}

pub fn get(conn: &Connection, id: i64) -> AppResult<Rule> {
    conn.query_row(&format!("{SELECT} WHERE id = ?1"), [id], from_row)
        .optional()?
        .ok_or(AppError::new(ErrorCode::NotFound))
}

fn exists(conn: &Connection, table: &str, id: Option<i64>, field: &'static str) -> AppResult<()> {
    if let Some(id) = id {
        let found: bool = conn.query_row(
            &format!("SELECT EXISTS (SELECT 1 FROM {table} WHERE id = ?1)"),
            [id],
            |r| r.get(0),
        )?;
        if !found {
            return Err(AppError::field(ErrorCode::NotFound, field));
        }
    }
    Ok(())
}

/// 結果を確かめる。対象外でなければ科目が要る。補助科目はその科目のもの。
pub(crate) fn validate_result(conn: &Connection, result: &RuleResult) -> AppResult<RuleResult> {
    if !result.ignore && result.account_id.is_none() {
        return Err(AppError::field(ErrorCode::Required, "accountId"));
    }
    exists(conn, "accounts", result.account_id, "accountId")?;
    exists(conn, "partners", result.partner_id, "partnerId")?;
    if let Some(sub) = result.sub_account_id {
        let owner: Option<i64> = conn
            .query_row(
                "SELECT account_id FROM sub_accounts WHERE id = ?1",
                [sub],
                |r| r.get(0),
            )
            .optional()?;
        if owner.is_none() || owner != result.account_id {
            return Err(AppError::field(ErrorCode::InvalidFormat, "subAccountId"));
        }
    }
    if result
        .allocation_percent
        .is_some_and(|p| !(0..=100).contains(&p))
    {
        return Err(AppError::field(ErrorCode::OutOfRange, "allocationPercent"));
    }
    Ok(RuleResult {
        memo: master::optional(&result.memo, MEMO_MAX, "memo")?,
        ..result.clone()
    })
}

fn validate(conn: &Connection, input: &RuleInput) -> AppResult<(String, RuleResult)> {
    let pattern = normalize(&input.pattern);
    if pattern.is_empty() {
        return Err(AppError::field(ErrorCode::Required, "pattern"));
    }
    if pattern.chars().count() > 100 {
        return Err(AppError::field(ErrorCode::TooLong, "pattern"));
    }
    for amount in [input.min_amount, input.max_amount].into_iter().flatten() {
        if amount < 0 {
            return Err(AppError::field(ErrorCode::OutOfRange, "minAmount"));
        }
    }
    if let (Some(min), Some(max)) = (input.min_amount, input.max_amount) {
        if min > max {
            return Err(AppError::field(ErrorCode::OutOfRange, "maxAmount"));
        }
    }
    exists(conn, "import_formats", input.format_id, "formatId")?;
    Ok((pattern, validate_result(conn, &input.result)?))
}

pub fn create(conn: &Connection, input: &RuleInput) -> AppResult<Rule> {
    let (pattern, r) = validate(conn, input)?;
    conn.execute(
        "INSERT INTO journal_rules (pattern, match_kind, min_amount, max_amount, format_id, account_id, sub_account_id,
             partner_id, memo, tax_category, allocation_percent, ignore, is_active, sort)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13,
             (SELECT coalesce(max(sort), 0) + 10 FROM journal_rules))",
        params![
            pattern,
            input.match_kind,
            input.min_amount,
            input.max_amount,
            input.format_id,
            r.account_id,
            r.sub_account_id,
            r.partner_id,
            r.memo,
            r.tax_category,
            r.allocation_percent,
            r.ignore,
            input.is_active
        ],
    )?;
    get(conn, conn.last_insert_rowid())
}

pub fn update(conn: &Connection, id: i64, input: &RuleInput) -> AppResult<Rule> {
    let (pattern, r) = validate(conn, input)?;
    let changed = conn.execute(
        "UPDATE journal_rules SET pattern = ?2, match_kind = ?3, min_amount = ?4, max_amount = ?5, format_id = ?6,
             account_id = ?7, sub_account_id = ?8, partner_id = ?9, memo = ?10, tax_category = ?11,
             allocation_percent = ?12, ignore = ?13, is_active = ?14
         WHERE id = ?1",
        params![
            id,
            pattern,
            input.match_kind,
            input.min_amount,
            input.max_amount,
            input.format_id,
            r.account_id,
            r.sub_account_id,
            r.partner_id,
            r.memo,
            r.tax_category,
            r.allocation_percent,
            r.ignore,
            input.is_active
        ],
    )?;
    if changed == 0 {
        return Err(AppError::new(ErrorCode::NotFound));
    }
    get(conn, id)
}

pub fn delete(conn: &Connection, id: i64) -> AppResult<()> {
    conn.execute("DELETE FROM journal_rules WHERE id = ?1", [id])?;
    Ok(())
}

/// 確定したときに「次回から同じ店はこの科目にする」を選んだら、店名が同じルールを作る
/// （同じ条件のルールがあれば結果を書き換える）。
pub fn learn(conn: &Connection, merchant: &str, result: &RuleResult) -> AppResult<Rule> {
    let pattern = normalize(merchant);
    let existing: Option<i64> = conn
        .query_row(
            "SELECT id FROM journal_rules WHERE pattern = ?1 AND match_kind = 'equals'
                 AND min_amount IS NULL AND max_amount IS NULL AND format_id IS NULL",
            [&pattern],
            |r| r.get(0),
        )
        .optional()?;
    let input = RuleInput {
        pattern,
        match_kind: MatchKind::Equals,
        min_amount: None,
        max_amount: None,
        format_id: None,
        result: result.clone(),
        is_active: true,
    };
    match existing {
        Some(id) => update(conn, id, &input),
        None => create(conn, &input),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::setup::tests::set_up_db;
    use crate::db::transactions::tests::account;

    #[test]
    fn rules_are_saved_with_normalized_patterns_and_validated() {
        let db = set_up_db();
        let conn = db.conn();
        let supplies = account(&conn, "610");
        let input = RuleInput {
            pattern: "ｱｽｸﾙ".into(),
            match_kind: MatchKind::Contains,
            min_amount: None,
            max_amount: Some(10_000),
            format_id: None,
            result: RuleResult {
                account_id: Some(supplies),
                ..Default::default()
            },
            is_active: true,
        };
        let rule = create(&conn, &input).unwrap();
        assert_eq!(rule.pattern, "アスクル");
        assert_eq!(list(&conn).unwrap(), std::slice::from_ref(&rule));

        let no_account = RuleInput {
            result: RuleResult::default(),
            ..input.clone()
        };
        assert_eq!(
            create(&conn, &no_account).unwrap_err(),
            AppError::field(ErrorCode::Required, "accountId")
        );
        let ignore = RuleInput {
            result: RuleResult {
                ignore: true,
                ..Default::default()
            },
            ..input.clone()
        };
        assert!(create(&conn, &ignore).unwrap().result.ignore);
        let bad_range = RuleInput {
            min_amount: Some(20_000),
            ..input.clone()
        };
        assert_eq!(
            create(&conn, &bad_range).unwrap_err(),
            AppError::field(ErrorCode::OutOfRange, "maxAmount")
        );
        let blank = RuleInput {
            pattern: "  ".into(),
            ..input
        };
        assert_eq!(
            create(&conn, &blank).unwrap_err(),
            AppError::field(ErrorCode::Required, "pattern")
        );
    }

    #[test]
    fn learning_the_same_shop_twice_updates_one_rule() {
        let db = set_up_db();
        let conn = db.conn();
        let first = learn(
            &conn,
            "ｶﾌｪ ABC",
            &RuleResult {
                account_id: Some(account(&conn, "607")),
                ..Default::default()
            },
        )
        .unwrap();
        let second = learn(
            &conn,
            "カフェ　ＡＢＣ",
            &RuleResult {
                account_id: Some(account(&conn, "612")),
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(first.id, second.id);
        assert_eq!(list(&conn).unwrap().len(), 1);
        assert_eq!(second.result.account_id, Some(account(&conn, "612")));
    }
}
