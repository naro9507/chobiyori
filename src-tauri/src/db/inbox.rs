//! 取込受信箱。明細の行（フェーズ 6 ではレシート）を「仕訳の候補」としてためる。
//!
//! 候補は確認して確定したときに初めて取引になる（確認なしに記帳しない）。
//! 状態は保存した値から決める: 取引があれば確定済み、`ignored` なら対象外、どちらでもなければ確認待ち。
//! 確定した取引を消すと、候補は確認待ちに戻る。

use super::formats::ImportFormat;
use super::transactions::{self, Transaction};
use super::{rules, Database};
use crate::domain::allocation;
use crate::domain::journal::{self, EntryMode, LineInput, Side, TransactionInput, TransactionKind};
use crate::domain::master::{self, TaxCategory, MEMO_MAX};
use crate::domain::receipt;
use crate::domain::rules::{normalize, Rule, RuleResult};
use crate::domain::statement::{self, StatementRow};
use crate::domain::string_enum;
use crate::error::{AppError, AppResult, ErrorCode};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

string_enum! {
    /// 候補の状態。
    pub enum InboxStatus {
        /// 確認待ち
        Pending => "pending",
        /// 確定済み（取引になった）
        Posted => "posted",
        /// 対象外（私用など）
        Ignored => "ignored",
    }
}

string_enum! {
    /// 候補のもと。
    pub enum InboxSource {
        /// カード・銀行・電子マネーの明細
        Statement => "statement",
        /// レシート
        Receipt => "receipt",
    }
}

string_enum! {
    /// 候補の出どころ。
    pub enum SuggestionSource {
        /// 自動仕訳ルール
        Rule => "rule",
        /// 前に同じ店で確定した取引
        History => "history",
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Suggestion {
    pub source: SuggestionSource,
    pub rule_id: Option<i64>,
    pub result: RuleResult,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InboxItem {
    pub id: i64,
    pub source: InboxSource,
    /// レシートから作った候補なら、そのレシート
    pub receipt_id: Option<i64>,
    pub format_id: Option<i64>,
    pub file_name: String,
    pub file_row: i64,
    pub payment_account_id: i64,
    pub payment_sub_account_id: Option<i64>,
    pub date: String,
    /// 出ていったお金。プラスは利用、マイナスは返金・入金
    pub spend: i64,
    pub merchant: String,
    pub memo: String,
    pub status: InboxStatus,
    pub transaction_id: Option<i64>,
    /// 推し量った科目など（確認待ちのときだけ）
    pub suggestion: Option<Suggestion>,
    /// 同じ口座・同じ金額・近い日付（前後 3 日）の取引がすでにある（手で入力した分や、
    /// 同じ買い物のレシート・明細から作った取引）。新しく作らず、この取引に紐付けられる
    pub possible_duplicate_id: Option<i64>,
    /// 新しい取引を作らず、既存の取引に紐付けた
    pub linked: bool,
    /// 取引に、レシートと明細の両方がある（突合できている）
    pub paired: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AddResult {
    pub added: usize,
    /// 前に取り込んだ行と同じなので飛ばした数
    pub duplicates: usize,
}

/// 明細を受信箱に入れる。同じ行（鍵が同じ）は入れない。
pub fn add_statement(
    conn: &Connection,
    format: &ImportFormat,
    file_name: &str,
    rows: &[StatementRow],
) -> AppResult<AddResult> {
    let (Some(format_id), Some(account)) = (format.id, format.payment_account_id) else {
        return Err(AppError::field(ErrorCode::Required, "formatId"));
    };
    let account_key = format!("{account}:{}", format.payment_sub_account_id.unwrap_or(0));
    let keys = statement::row_keys(rows, &account_key, normalize);
    let mut insert = conn.prepare(
        "INSERT OR IGNORE INTO inbox_items
             (source, format_id, file_name, file_row, row_key, payment_account_id, payment_sub_account_id, date, spend, merchant, memo)
         VALUES ('statement', ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
    )?;
    let mut added = 0;
    for (row, key) in rows.iter().zip(&keys) {
        added += insert.execute(params![
            format_id,
            file_name,
            row.row as i64,
            key,
            account,
            format.payment_sub_account_id,
            row.date,
            row.spend,
            row.merchant,
            row.memo
        ])?;
    }
    Ok(AddResult {
        added,
        duplicates: rows.len() - added,
    })
}

/// 前に同じ店（そろえた店名）で確定した取引の、口座でない側の明細行。新しいものを優先する。
fn history(conn: &Connection) -> AppResult<HashMap<String, RuleResult>> {
    let mut stmt = conn.prepare(
        "SELECT i.merchant, l.account_id, l.sub_account_id, l.partner_id, l.tax_category, t.memo
         FROM inbox_items i
         JOIN transactions t ON t.id = i.transaction_id
         JOIN journal_lines l ON l.transaction_id = t.id AND l.account_id <> i.payment_account_id
         ORDER BY i.id, l.line_no DESC",
    )?;
    let mut map = HashMap::new();
    let rows = stmt.query_map([], |r| {
        Ok((
            r.get::<_, String>(0)?,
            RuleResult {
                account_id: Some(r.get(1)?),
                sub_account_id: r.get(2)?,
                partner_id: r.get(3)?,
                tax_category: r.get(4)?,
                memo: r.get(5)?,
                allocation_percent: None,
                ignore: false,
            },
        ))
    })?;
    // 後の行（新しい候補、按分なら経費の行）で上書きする
    for row in rows {
        let (merchant, result) = row?;
        map.insert(normalize(&merchant), result);
    }
    Ok(map)
}

/// 候補を推し量る。ルールが先、なければ前に同じ店で確定した取引。
fn suggest(
    rules: &[Rule],
    history: &HashMap<String, RuleResult>,
    item: &InboxItem,
) -> Option<Suggestion> {
    if let Some(rule) =
        crate::domain::rules::find(rules, &item.merchant, item.spend, item.format_id)
    {
        return Some(Suggestion {
            source: SuggestionSource::Rule,
            rule_id: Some(rule.id),
            result: rule.result.clone(),
        });
    }
    history
        .get(&normalize(&item.merchant))
        .map(|result| Suggestion {
            source: SuggestionSource::History,
            rule_id: None,
            result: result.clone(),
        })
}

const SELECT: &str = "
    SELECT i.id, i.format_id, i.file_name, i.file_row, i.payment_account_id, i.payment_sub_account_id, i.date, i.spend,
           i.merchant, i.memo, i.ignored, i.transaction_id,
           CASE WHEN i.transaction_id IS NULL AND i.ignored = 0 THEN (
               SELECT t.id FROM transactions t JOIN journal_lines l ON l.transaction_id = t.id
               WHERE l.account_id = i.payment_account_id AND l.amount = abs(i.spend)
                 AND l.side = CASE WHEN i.spend > 0 THEN 'credit' ELSE 'debit' END
                 AND abs(julianday(t.date) - julianday(i.date)) <= 3
                 AND NOT EXISTS (SELECT 1 FROM inbox_items o WHERE o.transaction_id = t.id AND o.source = i.source)
               ORDER BY abs(julianday(t.date) - julianday(i.date)) LIMIT 1)
           END,
           i.source, (SELECT r.id FROM receipts r WHERE r.inbox_item_id = i.id), i.linked,
           i.transaction_id IS NOT NULL AND EXISTS (
               SELECT 1 FROM inbox_items o WHERE o.transaction_id = i.transaction_id AND o.source <> i.source)
    FROM inbox_items i";

fn read_items(
    conn: &Connection,
    filter: &str,
    params: impl rusqlite::Params,
) -> AppResult<Vec<InboxItem>> {
    let mut stmt = conn.prepare(&format!("{SELECT} {filter}"))?;
    let rows = stmt.query_map(params, |r| {
        let ignored: bool = r.get(10)?;
        let transaction_id: Option<i64> = r.get(11)?;
        Ok(InboxItem {
            id: r.get(0)?,
            source: r.get(13)?,
            receipt_id: r.get(14)?,
            linked: r.get(15)?,
            paired: r.get(16)?,
            format_id: r.get(1)?,
            file_name: r.get(2)?,
            file_row: r.get(3)?,
            payment_account_id: r.get(4)?,
            payment_sub_account_id: r.get(5)?,
            date: r.get(6)?,
            spend: r.get(7)?,
            merchant: r.get(8)?,
            memo: r.get(9)?,
            status: if transaction_id.is_some() {
                InboxStatus::Posted
            } else if ignored {
                InboxStatus::Ignored
            } else {
                InboxStatus::Pending
            },
            transaction_id,
            suggestion: None,
            possible_duplicate_id: r.get(12)?,
        })
    })?;
    Ok(rows.collect::<Result<_, _>>()?)
}

/// 受信箱の候補。`status` を渡すとその状態だけ。日付の順。
pub fn list(conn: &Connection, status: Option<InboxStatus>) -> AppResult<Vec<InboxItem>> {
    let filter = match status {
        None => "",
        Some(InboxStatus::Pending) => "WHERE i.transaction_id IS NULL AND i.ignored = 0",
        Some(InboxStatus::Posted) => "WHERE i.transaction_id IS NOT NULL",
        Some(InboxStatus::Ignored) => "WHERE i.transaction_id IS NULL AND i.ignored = 1",
    };
    let mut items = read_items(conn, &format!("{filter} ORDER BY i.date, i.id"), [])?;
    let rules = rules::list(conn)?;
    let history = history(conn)?;
    for item in items
        .iter_mut()
        .filter(|i| i.status == InboxStatus::Pending)
    {
        item.suggestion = suggest(&rules, &history, item);
    }
    Ok(items)
}

pub fn get(conn: &Connection, id: i64) -> AppResult<InboxItem> {
    read_items(conn, "WHERE i.id = ?1", [id])?
        .pop()
        .ok_or(AppError::new(ErrorCode::NotFound))
}

/// 確認待ちの数（ホームに出す）。
pub fn pending_count(conn: &Connection) -> AppResult<i64> {
    Ok(conn.query_row(
        "SELECT count(*) FROM inbox_items WHERE transaction_id IS NULL AND ignored = 0",
        [],
        |r| r.get(0),
    )?)
}

/// 確定するときの入力。
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfirmInput {
    /// 相手の科目（利用なら経費、返金なら同じ経費、入金なら売上など）
    pub account_id: i64,
    #[serde(default)]
    pub sub_account_id: Option<i64>,
    #[serde(default)]
    pub partner_id: Option<i64>,
    #[serde(default)]
    pub tax_category: Option<TaxCategory>,
    /// 摘要。空なら店名
    #[serde(default)]
    pub memo: String,
    /// 家事按分の事業割合（0〜100）。利用のときだけ使う。空なら按分しない
    #[serde(default)]
    pub allocation_percent: Option<i64>,
    /// 日付を直すとき。空なら明細の利用日
    #[serde(default)]
    pub date: Option<String>,
    /// 「次回から同じ店はこの科目にする」
    #[serde(default)]
    pub save_rule: bool,
}

impl ConfirmInput {
    fn from_result(result: &RuleResult) -> Option<Self> {
        Some(Self {
            account_id: result.account_id?,
            sub_account_id: result.sub_account_id,
            partner_id: result.partner_id,
            tax_category: result.tax_category,
            memo: result.memo.clone(),
            allocation_percent: result.allocation_percent,
            date: None,
            save_rule: false,
        })
    }
}

/// 候補から仕訳を作る。利用は「科目 / 口座」、返金・入金は「口座 / 科目」。
fn to_transaction(
    conn: &Connection,
    item: &InboxItem,
    input: &ConfirmInput,
) -> AppResult<(i64, TransactionInput)> {
    let date = input.date.clone().unwrap_or_else(|| item.date.clone());
    let Some((year, _, _)) = journal::parse_date(date.trim()) else {
        return Err(AppError::field(ErrorCode::InvalidFormat, "date"));
    };
    let amount = item.spend.abs();
    // レシートの税率ごとの内訳と登録番号
    let (reduced, receipt_invoice) = match item.receipt_id {
        Some(id) => conn.query_row(
            "SELECT reduced_amount, invoice_no IS NOT NULL FROM receipts WHERE id = ?1",
            [id],
            |r| Ok((r.get::<_, i64>(0)?, r.get::<_, bool>(1)?)),
        )?,
        None => (0, false),
    };
    let mut counter = LineInput {
        partner_id: input.partner_id,
        sub_account_id: input.sub_account_id,
        tax_category: input.tax_category,
        is_qualified_invoice: receipt_invoice
            || transactions::has_invoice_no(conn, input.partner_id)?,
        ..LineInput::new(Side::Debit, input.account_id, amount)
    };
    let mut payment = LineInput {
        sub_account_id: item.payment_sub_account_id,
        ..LineInput::new(Side::Credit, item.payment_account_id, amount)
    };
    // 軽減税率（8%）と標準税率（10%）が混ざったレシートは、経費の行を税率ごとに分ける
    let split_rates = item.spend > 0
        && reduced > 0
        && matches!(
            input.tax_category,
            None | Some(TaxCategory::TaxablePurchase8 | TaxCategory::TaxablePurchase10)
        );
    let mut lines = if split_rates {
        let mut lines: Vec<LineInput> = receipt::split_by_rate(amount, reduced)
            .into_iter()
            .map(|(category, part)| LineInput {
                tax_category: Some(category),
                amount: part,
                ..counter.clone()
            })
            .collect();
        lines.push(payment);
        lines
    } else if item.spend > 0 {
        vec![counter, payment]
    } else {
        counter.side = Side::Credit;
        payment.side = Side::Debit;
        vec![payment, counter]
    };
    if item.spend > 0 {
        if let Some(percent) = input.allocation_percent {
            if !(0..=100).contains(&percent) {
                return Err(AppError::field(ErrorCode::OutOfRange, "allocationPercent"));
            }
            let drawings = transactions::owner_accounts(conn)?.drawings;
            let rounding = transactions::account_rounding(conn, input.account_id)?;
            // 経費の行（口座の行より前）を後ろから分ける
            let expense_lines = lines.len() - 1;
            for index in (0..expense_lines).rev() {
                lines = allocation::split_line(&lines, index, drawings, percent, rounding);
            }
        }
    }
    let memo = master::optional(&input.memo, MEMO_MAX, "memo")?;
    Ok((
        year,
        TransactionInput {
            date,
            entry_mode: match item.source {
                InboxSource::Statement => EntryMode::Card,
                InboxSource::Receipt => EntryMode::Receipt,
            },
            memo: if memo.is_empty() {
                item.merchant.chars().take(MEMO_MAX).collect()
            } else {
                memo
            },
            lines,
        },
    ))
}

/// 1 件を確定する（呼び出し側の DB トランザクションの中で）。
fn confirm_in(conn: &Connection, id: i64, input: &ConfirmInput) -> AppResult<Transaction> {
    let item = get(conn, id)?;
    if item.status == InboxStatus::Posted {
        return Err(AppError::new(ErrorCode::AlreadyRecorded));
    }
    let (year, transaction) = to_transaction(conn, &item, input)?;
    let saved = transactions::insert_kind(conn, year, &transaction, TransactionKind::Normal)?;
    conn.execute(
        "UPDATE inbox_items SET transaction_id = ?2, ignored = 0, linked = 0 WHERE id = ?1",
        params![id, saved.id],
    )?;
    attach_receipt(conn, &item, saved.id)?;
    if input.save_rule && !item.merchant.trim().is_empty() {
        rules::learn(
            conn,
            &item.merchant,
            &RuleResult {
                account_id: Some(input.account_id),
                sub_account_id: input.sub_account_id,
                partner_id: input.partner_id,
                memo: input.memo.clone(),
                tax_category: input.tax_category,
                allocation_percent: input.allocation_percent,
                ignore: false,
            },
        )?;
    }
    Ok(saved)
}

/// レシートの画像を、証憑として取引に付ける。
fn attach_receipt(conn: &Connection, item: &InboxItem, transaction_id: i64) -> AppResult<()> {
    if let Some(receipt) = item.receipt_id {
        conn.execute(
            "UPDATE attachments SET transaction_id = ?2
             WHERE id = (SELECT attachment_id FROM receipts WHERE id = ?1)",
            params![receipt, transaction_id],
        )?;
    }
    Ok(())
}

/// 新しい取引を作らず、既存の取引に紐付ける（同じ買い物のレシートと明細、手で入力した取引）。
/// 取引には、候補と同じ口座・同じ金額・同じ向きの行がなければならない。日付は前後 7 日まで。
pub fn link(db: &Database, id: i64, transaction_id: i64) -> AppResult<InboxItem> {
    db.transaction(|tx| {
        let item = get(tx, id)?;
        if item.status == InboxStatus::Posted {
            return Err(AppError::new(ErrorCode::AlreadyRecorded));
        }
        let side = if item.spend > 0 {
            Side::Credit
        } else {
            Side::Debit
        };
        let fits: bool = tx.query_row(
            "SELECT EXISTS (
                 SELECT 1 FROM transactions t JOIN journal_lines l ON l.transaction_id = t.id
                 WHERE t.id = ?1 AND l.account_id = ?2 AND l.amount = ?3 AND l.side = ?4
                   AND abs(julianday(t.date) - julianday(?5)) <= 7)",
            params![
                transaction_id,
                item.payment_account_id,
                item.spend.abs(),
                side,
                item.date
            ],
            |r| r.get(0),
        )?;
        if !fits {
            return Err(AppError::field(ErrorCode::OutOfRange, "transactionId"));
        }
        // 同じもと（明細どうし・レシートどうし）は 1 つの取引に 2 つ紐付けない
        let taken: bool = tx.query_row(
            "SELECT EXISTS (SELECT 1 FROM inbox_items WHERE transaction_id = ?1 AND source = ?2)",
            params![transaction_id, item.source],
            |r| r.get(0),
        )?;
        if taken {
            return Err(AppError::new(ErrorCode::AlreadyRecorded));
        }
        tx.execute(
            "UPDATE inbox_items SET transaction_id = ?2, ignored = 0, linked = 1 WHERE id = ?1",
            params![id, transaction_id],
        )?;
        attach_receipt(tx, &item, transaction_id)?;
        get(tx, id)
    })
}

/// 紐付けを外して、確認待ちに戻す（紐付けたものだけ。取引は消さない）。
pub fn unlink(conn: &Connection, id: i64) -> AppResult<InboxItem> {
    let item = get(conn, id)?;
    if !item.linked || item.transaction_id.is_none() {
        return Err(AppError::new(ErrorCode::NotFound));
    }
    if let (Some(receipt), Some(transaction)) = (item.receipt_id, item.transaction_id) {
        // その取引のために作った取引でなければ、証憑も外す
        conn.execute(
            "UPDATE attachments SET transaction_id = NULL
             WHERE id = (SELECT attachment_id FROM receipts WHERE id = ?1) AND transaction_id = ?2",
            params![receipt, transaction],
        )?;
    }
    conn.execute(
        "UPDATE inbox_items SET transaction_id = NULL, linked = 0 WHERE id = ?1",
        [id],
    )?;
    get(conn, id)
}

/// レシートとカード明細の突合の状況（年度の中）。
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Reconciliation {
    /// レシートと明細の両方がある取引の数
    pub paired: usize,
    /// 明細から記帳したが、レシートがない
    pub statement_only: Vec<InboxItem>,
    /// カード・電子マネーで払ったレシートから記帳したが、明細にまだ出ていない
    pub receipt_only: Vec<InboxItem>,
}

/// 突合の状況。現金払いのレシートは対象外（明細に出ないため）。
/// 「カード払い」は、取込形式の取込先になっている口座で払ったもの。
pub fn reconciliation(conn: &Connection, year: i64) -> AppResult<Reconciliation> {
    let filter = "WHERE i.transaction_id IS NOT NULL
          AND i.transaction_id IN (SELECT id FROM transactions WHERE fiscal_year = ?1)
        ORDER BY i.date, i.id";
    let posted = read_items(conn, filter, [year])?;
    let card_accounts: Vec<i64> = {
        let mut stmt = conn.prepare("SELECT DISTINCT payment_account_id FROM import_formats")?;
        let rows = stmt.query_map([], |r| r.get(0))?;
        rows.collect::<Result<_, _>>()?
    };
    let mut result = Reconciliation {
        paired: 0,
        statement_only: Vec::new(),
        receipt_only: Vec::new(),
    };
    for item in posted {
        match (item.source, item.paired) {
            (InboxSource::Statement, true) => result.paired += 1,
            (InboxSource::Statement, false) => result.statement_only.push(item),
            (InboxSource::Receipt, false) if card_accounts.contains(&item.payment_account_id) => {
                result.receipt_only.push(item)
            }
            _ => {}
        }
    }
    Ok(result)
}

/// 候補を確認して確定する。
pub fn confirm(db: &Database, id: i64, input: &ConfirmInput) -> AppResult<Transaction> {
    db.transaction(|tx| confirm_in(tx, id, input))
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BulkResult {
    pub posted: usize,
    pub ignored: usize,
    /// 候補がない・年度がないなどで、そのまま残した数
    pub skipped: usize,
}

/// まとめて確定する。`input` がなければ、それぞれの候補（ルール・前の取引）どおりにする
/// （ルールが「対象外」なら対象外にする）。確定できない候補は残す。
pub fn confirm_many(
    db: &Database,
    ids: &[i64],
    input: Option<&ConfirmInput>,
) -> AppResult<BulkResult> {
    db.transaction(|tx| {
        let pending: HashMap<i64, InboxItem> = list(tx, Some(InboxStatus::Pending))?
            .into_iter()
            .map(|i| (i.id, i))
            .collect();
        let mut result = BulkResult::default();
        for id in ids {
            let Some(item) = pending.get(id) else {
                result.skipped += 1;
                continue;
            };
            let chosen = match (input, &item.suggestion) {
                (Some(input), _) => Some(input.clone()),
                (None, Some(s)) if s.result.ignore => {
                    set_ignored(tx, &[*id], true)?;
                    result.ignored += 1;
                    continue;
                }
                (None, Some(s)) => ConfirmInput::from_result(&s.result),
                (None, None) => None,
            };
            let Some(chosen) = chosen else {
                result.skipped += 1;
                continue;
            };
            // 1 件ずつ区切り、確定できないものは取り消して残す
            tx.execute_batch("SAVEPOINT inbox_item")?;
            match confirm_in(
                tx,
                *id,
                &ConfirmInput {
                    save_rule: false,
                    ..chosen
                },
            ) {
                Ok(_) => {
                    tx.execute_batch("RELEASE inbox_item")?;
                    result.posted += 1;
                }
                Err(_) => {
                    tx.execute_batch("ROLLBACK TO inbox_item; RELEASE inbox_item")?;
                    result.skipped += 1;
                }
            }
        }
        Ok(result)
    })
}

/// 対象外にする（`ignored` が false なら確認待ちに戻す）。確定済みの候補は変えない。
pub fn set_ignored(conn: &Connection, ids: &[i64], ignored: bool) -> AppResult<usize> {
    let mut stmt = conn
        .prepare("UPDATE inbox_items SET ignored = ?2 WHERE id = ?1 AND transaction_id IS NULL")?;
    let mut changed = 0;
    for id in ids {
        changed += stmt.execute(params![id, ignored])?;
    }
    Ok(changed)
}

/// 確認待ち・対象外の候補を消す（取り込み直したいとき）。確定済みは消さない。
pub fn delete(conn: &Connection, ids: &[i64]) -> AppResult<usize> {
    let mut stmt =
        conn.prepare("DELETE FROM inbox_items WHERE id = ?1 AND transaction_id IS NULL")?;
    let mut changed = 0;
    for id in ids {
        changed += stmt.execute([id])?;
    }
    Ok(changed)
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use crate::db::formats::tests::card_format;
    use crate::db::setup::tests::set_up_db;
    use crate::db::transactions::tests::{account, entry};
    use crate::domain::rules::MatchKind;

    pub(crate) fn row(date: &str, spend: i64, merchant: &str) -> StatementRow {
        StatementRow {
            row: 2,
            date: date.into(),
            spend,
            merchant: merchant.into(),
            memo: String::new(),
        }
    }

    pub(crate) fn input(account_id: i64) -> ConfirmInput {
        ConfirmInput {
            account_id,
            sub_account_id: None,
            partner_id: None,
            tax_category: None,
            memo: String::new(),
            allocation_percent: None,
            date: None,
            save_rule: false,
        }
    }

    #[test]
    fn overlapping_statements_do_not_double() {
        let db = set_up_db();
        let conn = db.conn();
        let format = card_format(&conn);
        let first = [
            row("2026-10-01", 500, "カフェ"),
            row("2026-10-01", 500, "カフェ"),
            row("2026-10-02", 800, "書店"),
        ];
        assert_eq!(
            add_statement(&conn, &format, "10月.csv", &first).unwrap(),
            AddResult {
                added: 3,
                duplicates: 0
            }
        );
        let second = [
            row("2026-10-01", 500, "ｶﾌｪ"),
            row("2026-10-01", 500, "カフェ"),
            row("2026-10-02", 800, "書店"),
            row("2026-10-03", 100, "店"),
        ];
        assert_eq!(
            add_statement(&conn, &format, "10-11月.csv", &second).unwrap(),
            AddResult {
                added: 1,
                duplicates: 3
            }
        );
        assert_eq!(list(&conn, None).unwrap().len(), 4);
        assert_eq!(pending_count(&conn).unwrap(), 4);
    }

    #[test]
    fn confirming_makes_the_journal_entry_and_deleting_it_brings_the_item_back() {
        let db = set_up_db();
        let (format, supplies, card) = {
            let conn = db.conn();
            (
                card_format(&conn),
                account(&conn, "610"),
                account(&conn, "204"),
            )
        };
        add_statement(
            &db.conn(),
            &format,
            "a.csv",
            &[
                row("2026-10-01", 1080, "文具店"),
                row("2026-10-05", -1080, "文具店"),
            ],
        )
        .unwrap();
        let items = list(&db.conn(), None).unwrap();
        // 利用: 消耗品費 / 未払金
        let t = confirm(&db, items[0].id, &input(supplies)).unwrap();
        assert_eq!(t.entry_mode, EntryMode::Card);
        assert_eq!(t.memo, "文具店");
        assert_eq!(
            t.lines
                .iter()
                .map(|l| (l.side, l.account_id, l.amount))
                .collect::<Vec<_>>(),
            [(Side::Debit, supplies, 1080), (Side::Credit, card, 1080)]
        );
        // 返金: 未払金 / 消耗品費
        let refund = confirm(&db, items[1].id, &input(supplies)).unwrap();
        assert_eq!(
            (refund.lines[0].side, refund.lines[0].account_id),
            (Side::Debit, card)
        );
        assert_eq!(
            confirm(&db, items[0].id, &input(supplies)).unwrap_err(),
            AppError::new(ErrorCode::AlreadyRecorded)
        );
        assert_eq!(
            get(&db.conn(), items[0].id).unwrap().status,
            InboxStatus::Posted
        );
        transactions::delete(&db, t.id).unwrap();
        assert_eq!(
            get(&db.conn(), items[0].id).unwrap().status,
            InboxStatus::Pending
        );
    }

    #[test]
    fn allocation_and_learning_from_confirmations() {
        let db = set_up_db();
        let (format, communication, drawings) = {
            let conn = db.conn();
            (
                card_format(&conn),
                account(&conn, "605"),
                account(&conn, "199"),
            )
        };
        add_statement(
            &db.conn(),
            &format,
            "a.csv",
            &[
                row("2026-10-01", 9_000, "ケータイ会社"),
                row("2026-11-01", 9_000, "ｹｰﾀｲ会社"),
            ],
        )
        .unwrap();
        let items = list(&db.conn(), None).unwrap();
        assert!(items.iter().all(|i| i.suggestion.is_none()));
        let t = confirm(
            &db,
            items[0].id,
            &ConfirmInput {
                allocation_percent: Some(60),
                ..input(communication)
            },
        )
        .unwrap();
        assert_eq!(
            t.lines
                .iter()
                .map(|l| (l.account_id, l.amount))
                .collect::<Vec<_>>()[..2],
            [(communication, 5_400), (drawings, 3_600)]
        );
        // 同じ店の次の月は、前の取引から候補が出る
        let next = &list(&db.conn(), Some(InboxStatus::Pending)).unwrap()[0];
        let s = next.suggestion.as_ref().unwrap();
        assert_eq!(
            (s.source, s.result.account_id),
            (SuggestionSource::History, Some(communication))
        );
    }

    #[test]
    fn rules_drive_bulk_confirmation_and_ignoring() {
        let db = set_up_db();
        let (format, supplies) = {
            let conn = db.conn();
            let format = card_format(&conn);
            let supplies = account(&conn, "610");
            rules::create(
                &conn,
                &rules::RuleInput {
                    pattern: "文具".into(),
                    match_kind: MatchKind::Contains,
                    min_amount: None,
                    max_amount: None,
                    format_id: None,
                    result: RuleResult {
                        account_id: Some(supplies),
                        ..Default::default()
                    },
                    is_active: true,
                },
            )
            .unwrap();
            rules::create(
                &conn,
                &rules::RuleInput {
                    pattern: "スーパー".into(),
                    match_kind: MatchKind::Contains,
                    min_amount: None,
                    max_amount: None,
                    format_id: None,
                    result: RuleResult {
                        ignore: true,
                        ..Default::default()
                    },
                    is_active: true,
                },
            )
            .unwrap();
            (format, supplies)
        };
        add_statement(
            &db.conn(),
            &format,
            "a.csv",
            &[
                row("2026-10-01", 500, "文具店"),
                row("2026-10-02", 3_000, "スーパー"),
                row("2026-10-03", 800, "謎の店"),
                row("2014-01-01", 10, "文具店"),
            ],
        )
        .unwrap();
        let ids: Vec<i64> = list(&db.conn(), None)
            .unwrap()
            .iter()
            .map(|i| i.id)
            .collect();
        let result = confirm_many(&db, &ids, None).unwrap();
        // 2014 年度はないので残す
        assert_eq!(
            result,
            BulkResult {
                posted: 1,
                ignored: 1,
                skipped: 2
            }
        );
        let conn = db.conn();
        let pending = list(&conn, Some(InboxStatus::Pending)).unwrap();
        assert_eq!(
            pending
                .iter()
                .map(|i| i.merchant.as_str())
                .collect::<Vec<_>>(),
            ["文具店", "謎の店"]
        );
        let posted = list(&conn, Some(InboxStatus::Posted)).unwrap();
        assert_eq!(
            transactions::get(&conn, posted[0].transaction_id.unwrap())
                .unwrap()
                .lines[0]
                .account_id,
            supplies
        );
        assert_eq!(
            list(&conn, Some(InboxStatus::Ignored)).unwrap()[0].merchant,
            "スーパー"
        );
        assert_eq!(
            set_ignored(
                &conn,
                &[list(&conn, Some(InboxStatus::Ignored)).unwrap()[0].id],
                false
            )
            .unwrap(),
            1
        );
    }

    #[test]
    fn hand_entered_transactions_are_flagged_as_possible_duplicates() {
        let db = set_up_db();
        let (format, supplies, card) = {
            let conn = db.conn();
            (
                card_format(&conn),
                account(&conn, "610"),
                account(&conn, "204"),
            )
        };
        let manual =
            transactions::create(&db, 2026, &entry("2026-10-02", supplies, card, 1080)).unwrap();
        add_statement(
            &db.conn(),
            &format,
            "a.csv",
            &[
                row("2026-10-01", 1080, "文具店"),
                row("2026-10-20", 1080, "文具店"),
            ],
        )
        .unwrap();
        let items = list(&db.conn(), None).unwrap();
        assert_eq!(items[0].possible_duplicate_id, Some(manual.id));
        assert_eq!(items[1].possible_duplicate_id, None);
    }

    #[test]
    fn receipt_and_card_statement_of_the_same_purchase_become_one_transaction() {
        use crate::db::receipts::{
            self,
            tests::{add_one, READING},
        };
        let db = set_up_db();
        let (receipt_id, supplies, card) = {
            let conn = db.conn();
            // 課税事業者の年度（免税の年度は税区分を「対象外」にするため）
            conn.execute("UPDATE fiscal_years SET tax_status = 'standard'", [])
                .unwrap();
            let id = add_one(&conn, 1);
            receipts::record_reading(&conn, id, READING, "2026-11-16").unwrap();
            (id, account(&conn, "610"), account(&conn, "204"))
        };
        let item_id = receipts::get(&db.conn(), receipt_id)
            .unwrap()
            .inbox_item_id
            .unwrap();
        let saved = confirm(&db, item_id, &input(supplies)).unwrap();
        // 8% と 10% に分け、登録番号があるのでインボイスの印を付ける
        let expense: Vec<_> = saved
            .lines
            .iter()
            .filter(|l| l.account_id == supplies)
            .collect();
        assert_eq!(
            expense
                .iter()
                .map(|l| (l.amount, l.tax_category))
                .collect::<Vec<_>>(),
            [
                (2160, Some(TaxCategory::TaxablePurchase10)),
                (1080, Some(TaxCategory::TaxablePurchase8))
            ]
        );
        assert!(expense.iter().all(|l| l.is_qualified_invoice));
        assert_eq!(saved.entry_mode, EntryMode::Receipt);
        // 画像は証憑として取引に付く
        let files = crate::db::attachments::list_for_transaction(&db.conn(), saved.id).unwrap();
        assert_eq!(files.len(), 1);

        // 同じ買い物がカードの明細に出る（2 日後の利用日）
        let statement_id = {
            let conn = db.conn();
            let format = card_format(&conn);
            add_statement(
                &conn,
                &format,
                "card.csv",
                &[row("2026-03-07", 3240, "ﾃｽﾄｼｮｳﾃﾝ")],
            )
            .unwrap();
            let items = list(&conn, Some(InboxStatus::Pending)).unwrap();
            assert_eq!(items.len(), 1);
            assert_eq!(items[0].possible_duplicate_id, Some(saved.id));
            // 突合: レシートだけがある
            let r = reconciliation(&conn, 2026).unwrap();
            assert_eq!(
                (r.paired, r.receipt_only.len(), r.statement_only.len()),
                (0, 1, 0)
            );
            items[0].id
        };
        // 新しい取引を作らず、レシートの取引に紐付ける（経費が二重にならない）
        let linked = link(&db, statement_id, saved.id).unwrap();
        assert!(linked.linked && linked.paired);
        let conn = db.conn();
        assert_eq!(transactions::list(&conn, 2026, None).unwrap().len(), 1);
        let r = reconciliation(&conn, 2026).unwrap();
        assert_eq!(
            (r.paired, r.receipt_only.len(), r.statement_only.len()),
            (1, 0, 0)
        );
        // 外すと確認待ちに戻り、取引は残る
        let back = unlink(&conn, statement_id).unwrap();
        assert_eq!(back.status, InboxStatus::Pending);
        assert_eq!(transactions::list(&conn, 2026, None).unwrap().len(), 1);
        drop(conn);
        // 金額が違う取引には紐付けられない
        let other =
            crate::db::transactions::create(&db, 2026, &entry("2026-03-07", supplies, card, 999))
                .unwrap();
        assert_eq!(
            link(&db, statement_id, other.id).unwrap_err(),
            AppError::field(ErrorCode::OutOfRange, "transactionId")
        );
    }
}
