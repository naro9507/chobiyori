//! 証憑（レシートや領収書の画像・PDF）の読み書き。
//!
//! 中身は帳簿の DB の中に置く（帳簿と一緒に SQLCipher で暗号化される）。
//! 入れるときに sha256 を計算して記録し、同じファイルは 2 回入れない。

use chobiyori_core::error::{AppError, AppResult, ErrorCode};
use rusqlite::{params, Connection, OptionalExtension, Row};
use serde::Serialize;
use sha2::{Digest, Sha256};

/// 1 つのファイルの大きさの上限。読み取りのサービスに送れる大きさに合わせる
pub const FILE_MAX: usize = 15 * 1024 * 1024;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Attachment {
    pub id: i64,
    pub transaction_id: Option<i64>,
    pub file_name: String,
    pub mime: String,
    pub size: i64,
    pub sha256: String,
    pub added_at: String,
}

/// ファイル名の拡張子から種類を決める。証憑にできない種類なら None。
pub fn mime_of(file_name: &str) -> Option<&'static str> {
    let ext = file_name.rsplit('.').next()?.to_lowercase();
    Some(match ext.as_str() {
        "jpg" | "jpeg" => "image/jpeg",
        "png" => "image/png",
        "webp" => "image/webp",
        "heic" => "image/heic",
        "heif" => "image/heif",
        "pdf" => "application/pdf",
        _ => return None,
    })
}

/// 中身が、拡張子の種類と合っているか（先頭の数バイトで見る）。
fn looks_like(mime: &str, bytes: &[u8]) -> bool {
    match mime {
        "image/jpeg" => bytes.starts_with(&[0xFF, 0xD8, 0xFF]),
        "image/png" => bytes.starts_with(b"\x89PNG"),
        "image/webp" => bytes.len() > 12 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WEBP",
        "image/heic" | "image/heif" => bytes.len() > 12 && &bytes[4..8] == b"ftyp",
        "application/pdf" => bytes.starts_with(b"%PDF"),
        _ => false,
    }
}

pub fn sha256_hex(bytes: &[u8]) -> String {
    Sha256::digest(bytes)
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

const FIELDS: &str = "a.file_name, a.mime, a.size, a.sha256, a.added_at";

const LINKS: &str = "
    SELECT transaction_id, attachment_id FROM transaction_attachments
    UNION
    SELECT i.transaction_id, r.attachment_id
    FROM receipts r JOIN inbox_items i ON i.id = r.inbox_item_id
    WHERE i.transaction_id IS NOT NULL";

fn from_row(row: &Row<'_>) -> rusqlite::Result<Attachment> {
    Ok(Attachment {
        id: row.get(0)?,
        transaction_id: row.get(1)?,
        file_name: row.get(2)?,
        mime: row.get(3)?,
        size: row.get(4)?,
        sha256: row.get(5)?,
        added_at: row.get(6)?,
    })
}

pub fn get(conn: &Connection, id: i64) -> AppResult<Attachment> {
    Ok(conn.query_row(
        &format!(
            "SELECT a.id, (SELECT min(transaction_id) FROM ({LINKS}) WHERE attachment_id = a.id),
                  {FIELDS} FROM attachments a WHERE a.id = ?1"
        ),
        [id],
        from_row,
    )?)
}

/// 証憑を入れる。同じ中身がすでにあれば、それを返す（2 つ目の値が true）。
pub fn add(conn: &Connection, file_name: &str, bytes: &[u8]) -> AppResult<(Attachment, bool)> {
    let mime = mime_of(file_name).ok_or(AppError::field(ErrorCode::InvalidFormat, "file"))?;
    if bytes.is_empty() || bytes.len() > FILE_MAX {
        return Err(AppError::field(ErrorCode::OutOfRange, "file"));
    }
    if !looks_like(mime, bytes) {
        return Err(AppError::field(ErrorCode::InvalidFormat, "file"));
    }
    let hash = sha256_hex(bytes);
    let existing: Option<i64> = conn
        .query_row(
            "SELECT id FROM attachments WHERE sha256 = ?1",
            [&hash],
            |r| r.get(0),
        )
        .optional()?;
    if let Some(id) = existing {
        return Ok((get(conn, id)?, true));
    }
    let name: String = file_name.chars().take(200).collect();
    conn.execute(
        "INSERT INTO attachments (file_name, mime, size, sha256, data) VALUES (?1, ?2, ?3, ?4, ?5)",
        params![name, mime, bytes.len() as i64, hash, bytes],
    )?;
    Ok((get(conn, conn.last_insert_rowid())?, false))
}

/// 取引の証憑。
pub fn list_for_transaction(conn: &Connection, transaction_id: i64) -> AppResult<Vec<Attachment>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT a.id, l.transaction_id, {FIELDS} FROM attachments a
         JOIN ({LINKS}) l ON l.attachment_id = a.id WHERE l.transaction_id = ?1 ORDER BY a.id"
    ))?;
    let rows = stmt.query_map([transaction_id], from_row)?;
    Ok(rows.collect::<Result<_, _>>()?)
}

/// 年度の取引ごとの証憑の数（帳簿の一覧で印を出すため）。
pub fn counts(conn: &Connection, year: i64) -> AppResult<Vec<(i64, i64)>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT l.transaction_id, count(*) FROM ({LINKS}) l
         JOIN transactions t ON t.id = l.transaction_id
         WHERE t.fiscal_year = ?1 GROUP BY l.transaction_id"
    ))?;
    let rows = stmt.query_map([year], |r| Ok((r.get(0)?, r.get(1)?)))?;
    Ok(rows.collect::<Result<_, _>>()?)
}

/// 中身（種類と中身）。
pub fn content(conn: &Connection, id: i64) -> AppResult<(Attachment, Vec<u8>)> {
    let attachment = get(conn, id)?;
    let data: Vec<u8> =
        conn.query_row("SELECT data FROM attachments WHERE id = ?1", [id], |r| {
            r.get(0)
        })?;
    Ok((attachment, data))
}

/// 取引に付ける。
pub fn attach(conn: &Connection, id: i64, transaction_id: i64) -> AppResult<()> {
    let exists: bool = conn.query_row(
        "SELECT EXISTS (SELECT 1 FROM transactions WHERE id = ?1)",
        [transaction_id],
        |r| r.get(0),
    )?;
    if !exists {
        return Err(AppError::field(ErrorCode::NotFound, "transactionId"));
    }
    conn.execute(
        "INSERT INTO transaction_attachments (attachment_id, transaction_id)
         VALUES (?1, ?2) ON CONFLICT DO NOTHING",
        params![id, transaction_id],
    )?;
    Ok(())
}

/// 取引への手動添付だけを外す。レシートの紐付けは受信箱で外す。
pub fn detach(conn: &Connection, id: i64, transaction_id: i64) -> AppResult<()> {
    let changed = conn.execute(
        "DELETE FROM transaction_attachments WHERE attachment_id = ?1 AND transaction_id = ?2",
        params![id, transaction_id],
    )?;
    if changed == 0 {
        let receipt: bool = conn.query_row(
            "SELECT EXISTS (SELECT 1 FROM receipts r JOIN inbox_items i ON i.id = r.inbox_item_id
                            WHERE r.attachment_id = ?1 AND i.transaction_id = ?2)",
            params![id, transaction_id],
            |r| r.get(0),
        )?;
        return Err(AppError::new(if receipt {
            ErrorCode::InUse
        } else {
            ErrorCode::NotFound
        }));
    }
    remove_unused(conn, id)
}

pub(crate) fn remove_unused(conn: &Connection, id: i64) -> AppResult<()> {
    let settings = super::documents::settings(conn)?;
    if settings.logo_attachment_id == Some(id) || settings.seal_attachment_id == Some(id) {
        return Ok(());
    }
    conn.execute(
        "DELETE FROM attachments WHERE id = ?1
         AND NOT EXISTS (SELECT 1 FROM transaction_attachments WHERE attachment_id = ?1)
         AND NOT EXISTS (SELECT 1 FROM receipts WHERE attachment_id = ?1)
         AND NOT EXISTS (SELECT 1 FROM documents WHERE pdf_attachment_id = ?1)",
        [id],
    )?;
    Ok(())
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use crate::db::setup::tests::set_up_db;

    /// テスト用の小さな JPEG（中身の先頭だけそれらしくしたもの）。
    pub(crate) fn jpeg(seed: u8) -> Vec<u8> {
        let mut bytes = vec![0xFF, 0xD8, 0xFF, 0xE0];
        bytes.extend(std::iter::repeat_n(seed, 64));
        bytes
    }

    #[test]
    fn same_file_is_stored_once_with_its_hash() {
        let db = set_up_db();
        let conn = db.conn();
        let (a, existed) = add(&conn, "receipt.JPG", &jpeg(1)).unwrap();
        assert!(!existed);
        assert_eq!(a.mime, "image/jpeg");
        assert_eq!(a.sha256, sha256_hex(&jpeg(1)));
        assert_eq!(a.sha256.len(), 64);
        let (again, existed) = add(&conn, "copy.jpg", &jpeg(1)).unwrap();
        assert!(existed);
        assert_eq!(again.id, a.id);
        let (_, data) = content(&conn, a.id).unwrap();
        assert_eq!(data, jpeg(1));
    }

    #[test]
    fn only_images_and_pdf_whose_contents_match() {
        let db = set_up_db();
        let conn = db.conn();
        assert_eq!(
            add(&conn, "memo.txt", b"hello").unwrap_err(),
            AppError::field(ErrorCode::InvalidFormat, "file")
        );
        // 拡張子は JPEG だが中身が違う
        assert_eq!(
            add(&conn, "fake.jpg", b"%PDF-1.7").unwrap_err(),
            AppError::field(ErrorCode::InvalidFormat, "file")
        );
        assert!(add(&conn, "invoice.pdf", b"%PDF-1.7 ...").is_ok());
        assert_eq!(mime_of("IMG_0001.HEIC"), Some("image/heic"));
    }
}
