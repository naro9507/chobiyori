//! 変更履歴。取引の追加・変更・削除と、締め・締めの解除・復元などの操作を残す。
//!
//! 取引は変更の前と後の内容を JSON で持つ。パスワードや API キーは入れない。
//! 履歴は帳簿と一緒に暗号化される。履歴そのものは画面から消せない。

use crate::db::transactions::Transaction;
use crate::error::AppResult;
use rusqlite::{params, Connection};
use serde::Serialize;

/// 取引の変更を残す。
pub(crate) fn transaction(
    conn: &Connection,
    action: &str,
    before: Option<&Transaction>,
    after: Option<&Transaction>,
) -> AppResult<()> {
    let id = after.or(before).map(|t| t.id);
    let year = after.or(before).map(|t| t.fiscal_year);
    let json = |t: Option<&Transaction>| t.and_then(|t| serde_json::to_string(t).ok());
    conn.execute(
        "INSERT INTO audit_logs (entity, entity_id, action, fiscal_year, before_json, after_json)
         VALUES ('transaction', ?1, ?2, ?3, ?4, ?5)",
        params![id, action, year, json(before), json(after)],
    )?;
    Ok(())
}

/// 取引以外の操作（締め・締めの解除・復元・パスワードの変更など）を残す。`detail` は短い説明の JSON。
pub(crate) fn event(
    conn: &Connection,
    entity: &str,
    action: &str,
    fiscal_year: Option<i64>,
    detail: Option<serde_json::Value>,
) -> AppResult<()> {
    conn.execute(
        "INSERT INTO audit_logs (entity, action, fiscal_year, after_json) VALUES (?1, ?2, ?3, ?4)",
        params![entity, action, fiscal_year, detail.map(|d| d.to_string())],
    )?;
    Ok(())
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuditEntry {
    pub id: i64,
    pub entity: String,
    pub entity_id: Option<i64>,
    pub action: String,
    pub fiscal_year: Option<i64>,
    pub before: Option<serde_json::Value>,
    pub after: Option<serde_json::Value>,
    pub at: String,
}

/// 新しい順に、`limit` 件まで。`fiscal_year` を渡すとその年度のものだけ（年度のない操作も含める）。
pub fn list(conn: &Connection, fiscal_year: Option<i64>, limit: i64) -> AppResult<Vec<AuditEntry>> {
    let mut stmt = conn.prepare(
        "SELECT id, entity, entity_id, action, fiscal_year, before_json, after_json, at
         FROM audit_logs
         WHERE ?1 IS NULL OR fiscal_year IS NULL OR fiscal_year = ?1
         ORDER BY id DESC LIMIT ?2",
    )?;
    let parse = |text: Option<String>| text.and_then(|t| serde_json::from_str(&t).ok());
    let rows = stmt.query_map(params![fiscal_year, limit.clamp(1, 1000)], |r| {
        Ok(AuditEntry {
            id: r.get(0)?,
            entity: r.get(1)?,
            entity_id: r.get(2)?,
            action: r.get(3)?,
            fiscal_year: r.get(4)?,
            before: parse(r.get(5)?),
            after: parse(r.get(6)?),
            at: r.get(7)?,
        })
    })?;
    Ok(rows.collect::<Result<_, _>>()?)
}
