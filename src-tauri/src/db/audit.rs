//! 変更履歴。取引の追加・変更・削除と、締め・締めの解除・復元などの操作を残す。
//!
//! 取引は変更の前と後の内容を JSON で持つ。パスワードや API キーは入れない。
//! 履歴は帳簿と一緒に暗号化される。履歴そのものは画面から消せない。

use crate::db::transactions::Transaction;
use chobiyori_core::error::AppResult;
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

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuditPage {
    pub entries: Vec<AuditEntry>,
    pub total: i64,
    pub page: i64,
    pub page_size: i64,
}

const PAGE_SIZE: i64 = 50;

#[derive(Default)]
pub struct AuditFilters<'a> {
    pub query: Option<&'a str>,
    // 記録日時の境界（Unix 秒）。開始を含み、終了の境界は含まない。
    pub start_at: Option<i64>,
    pub end_before: Option<i64>,
}

// 年度のない操作はどの年度にも出す。メモなどは変更前と変更後の両方を検索する。
const FILTER: &str = "
    WHERE (?1 IS NULL OR fiscal_year IS NULL OR fiscal_year = ?1)
      AND (?3 IS NULL OR unixepoch(at) >= ?3)
      AND (?4 IS NULL OR unixepoch(at) < ?4)
      AND (?2 IS NULL
        OR instr(at, ?2) > 0
        OR instr(lower(CASE WHEN json_valid(before_json) THEN
            coalesce(before_json ->> 'date', '') || ' ' ||
            coalesce(before_json ->> 'memo', '')
          END), lower(?2)) > 0
        OR instr(lower(CASE WHEN json_valid(after_json) THEN
            coalesce(after_json ->> 'date', '') || ' ' ||
            coalesce(after_json ->> 'memo', '') || ' ' ||
            coalesce(after_json ->> 'number', '')
          END), lower(?2)) > 0)";

/// 絞り込んだ履歴を新しい順に返す。存在しないページは最も近いページに丸める。
pub fn list(
    conn: &Connection,
    fiscal_year: Option<i64>,
    page: i64,
    AuditFilters {
        query,
        start_at,
        end_before,
    }: AuditFilters<'_>,
) -> AppResult<AuditPage> {
    let query = query.map(str::trim).filter(|query| !query.is_empty());
    let total: i64 = conn.query_row(
        &format!("SELECT count(*) FROM audit_logs {FILTER}"),
        params![fiscal_year, query, start_at, end_before],
        |row| row.get(0),
    )?;
    let last_page = (total.max(1) - 1) / PAGE_SIZE + 1;
    let page = page.clamp(1, last_page);
    let offset = (page - 1) * PAGE_SIZE;
    let mut stmt = conn.prepare(&format!(
        "SELECT id, entity, entity_id, action, fiscal_year, before_json, after_json, at
         FROM audit_logs {FILTER}
         ORDER BY id DESC LIMIT ?5 OFFSET ?6"
    ))?;
    let parse = |text: Option<String>| text.and_then(|t| serde_json::from_str(&t).ok());
    let rows = stmt.query_map(
        params![fiscal_year, query, start_at, end_before, PAGE_SIZE, offset],
        |r| {
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
        },
    )?;
    Ok(AuditPage {
        entries: rows.collect::<Result<_, _>>()?,
        total,
        page,
        page_size: PAGE_SIZE,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn pages_include_older_history_and_keep_the_fiscal_year_filter() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(include_str!("migrations/0007_security.sql"))
            .unwrap();
        for year in std::iter::repeat_n(2026, 204).chain([2025]) {
            event(&conn, "document", "issue", Some(year), None).unwrap();
        }
        event(&conn, "book", "restore", None, None).unwrap();

        let first = list(&conn, Some(2026), 1, AuditFilters::default()).unwrap();
        assert_eq!(first.total, 205);
        assert_eq!(first.page_size, 50);
        assert_eq!(first.entries.len(), 50);
        assert_eq!(first.entries[0].action, "restore");

        let ids: Vec<_> = (1..=5)
            .flat_map(|page| {
                list(&conn, Some(2026), page, AuditFilters::default())
                    .unwrap()
                    .entries
            })
            .map(|entry| entry.id)
            .collect();
        assert_eq!(
            ids,
            std::iter::once(206)
                .chain((1..=204).rev())
                .collect::<Vec<_>>()
        );

        let last = list(&conn, Some(2026), 99, AuditFilters::default()).unwrap();
        assert_eq!(last.page, 5);
        assert_eq!(last.entries.len(), 5);
    }

    #[test]
    fn search_filters_before_paging_and_matches_old_and_new_entry_details() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(include_str!("migrations/0007_security.sql"))
            .unwrap();
        let before = json!({ "date": "2026-01-01", "memo": "仕入れ_旧" });
        let after = json!({ "date": "2026-01-02", "memo": "仕入れ・修正後" });
        conn.execute(
            "INSERT INTO audit_logs (entity, action, fiscal_year, before_json, after_json)
             VALUES ('transaction', 'update', 2026, ?1, ?2)",
            params![before.to_string(), after.to_string()],
        )
        .unwrap();
        for _ in 0..51 {
            event(
                &conn,
                "document",
                "issue",
                Some(2026),
                Some(json!({"number": "INV-123"})),
            )
            .unwrap();
        }
        event(
            &conn,
            "document",
            "issue",
            Some(2025),
            Some(json!({"number": "INV-123"})),
        )
        .unwrap();

        let search = |page, query| {
            list(
                &conn,
                Some(2026),
                page,
                AuditFilters {
                    query: Some(query),
                    ..AuditFilters::default()
                },
            )
            .unwrap()
        };
        for query in [" 仕入れ_旧 ", "修正後", "2026-01-01", "2026-01-02"] {
            let matched = search(1, query);
            assert_eq!(matched.total, 1);
            assert_eq!(matched.entries[0].id, 1);
        }
        let matched = search(2, "inv-123");
        assert_eq!(matched.total, 51);
        assert_eq!(matched.page, 2);
        assert_eq!(matched.entries.len(), 1);
        let empty = search(2, "%");
        assert_eq!(empty.total, 0);
        assert!(empty.entries.is_empty());
    }

    #[test]
    fn filters_by_recorded_time_with_optional_bounds_and_keywords() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(include_str!("migrations/0007_security.sql"))
            .unwrap();
        let midnight = 1_767_225_600_i64;
        for (offset, memo) in [
            (59, "備品"),
            (60, "備品"),
            (80, "旅費"),
            (119, "備品"),
            (120, "備品"),
        ] {
            conn.execute(
                "INSERT INTO audit_logs (entity, action, fiscal_year, after_json, at)
                 VALUES ('transaction', 'create', 2026, ?1, strftime('%Y-%m-%dT%H:%M:%SZ', ?2, 'unixepoch'))",
                params![json!({"date": "2026-01-01", "memo": memo}).to_string(), midnight + offset],
            )
            .unwrap();
        }

        for (start_at, end_before, expected) in [
            (Some(midnight + 60), Some(midnight + 120), &[4, 2][..]),
            (Some(midnight + 60), None, &[5, 4, 2]),
            (None, Some(midnight + 120), &[4, 2, 1]),
        ] {
            let matched = list(
                &conn,
                Some(2026),
                1,
                AuditFilters {
                    query: Some("備品"),
                    start_at,
                    end_before,
                },
            )
            .unwrap();
            let ids: Vec<_> = matched.entries.iter().map(|entry| entry.id).collect();
            assert_eq!(ids, expected);
            assert_eq!(matched.total as usize, expected.len());
        }
    }
}
