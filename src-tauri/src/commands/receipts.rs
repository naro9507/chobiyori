//! レシートの読み取り・証憑・突合のコマンド。
//!
//! 画像を選ぶ画面と、読み取りのサービスの呼び出しは Rust 側で行う。API キーは OS の資格情報ストアから
//! 読み、画面には返さない（登録済みかどうかだけ）。読み取った結果は受信箱の候補にするだけで、
//! 確定するまで記帳しない。

use super::files;
use crate::receipt::gemini::Gemini;
use crate::receipt::secret::{self, Keyring, SecretStore};
use crate::receipt::{ReadError, ReceiptReader};
use base64::Engine;
use chobiyori_core::error::{AppError, AppResult, ErrorCode};
use chobiyori_storage::attachments::{self, Attachment, FILE_MAX};
use chobiyori_storage::inbox::{self, InboxItem, Reconciliation};
use chobiyori_storage::receipts::{
    self, AddReceiptsResult, Receipt, ReceiptFields, ReceiptSettings, ReceiptSettingsInput,
};
use chobiyori_storage::Database;
use serde::Serialize;
use std::path::PathBuf;
use tauri::{AppHandle, State};

const IMAGE_FILTER: (&str, &[&str]) = (
    "Image / PDF",
    &[
        "jpg", "jpeg", "png", "webp", "heic", "heif", "pdf", "JPG", "JPEG", "PNG", "HEIC", "PDF",
    ],
);

fn has_key() -> bool {
    Keyring.get().ok().flatten().is_some()
}

#[tauri::command]
pub async fn receipt_settings(db: State<'_, Database>) -> AppResult<ReceiptSettings> {
    let has_key = has_key();
    receipts::settings(&db.conn(), has_key)
}

#[tauri::command]
pub async fn save_receipt_settings(
    db: State<'_, Database>,
    input: ReceiptSettingsInput,
) -> AppResult<ReceiptSettings> {
    let has_key = has_key();
    receipts::save_settings(&db.conn(), &input, has_key)
}

/// API キーを OS の資格情報ストアに入れる。キーは返さない。
#[tauri::command]
pub async fn set_gemini_key(key: String) -> AppResult<()> {
    Keyring.set(&secret::validate_key(&key)?)
}

#[tauri::command]
pub async fn delete_gemini_key() -> AppResult<()> {
    Keyring.delete()
}

/// 読むファイルを集め、受信箱に入れる。
fn add_paths(db: &Database, paths: Vec<PathBuf>) -> AppResult<AddReceiptsResult> {
    let mut files_read = Vec::new();
    let mut rejected = 0;
    for path in paths {
        let size = std::fs::metadata(&path)
            .map(|m| m.len())
            .unwrap_or(u64::MAX);
        if size as usize > FILE_MAX || attachments::mime_of(&files::file_name(&path)).is_none() {
            rejected += 1;
            continue;
        }
        match std::fs::read(&path) {
            Ok(bytes) => files_read.push((files::file_name(&path), bytes)),
            Err(_) => rejected += 1,
        }
    }
    let mut result = db.transaction(|tx| receipts::add_files(tx, &files_read))?;
    result.rejected += rejected;
    Ok(result)
}

/// レシートの画像（いくつでも）を選んで取り込む。
#[tauri::command]
pub async fn choose_receipt_files(
    app: AppHandle,
    db: State<'_, Database>,
) -> AppResult<AddReceiptsResult> {
    let paths = files::open_paths(app, IMAGE_FILTER).await;
    add_paths(&db, paths)
}

/// フォルダの中のレシートの画像をまとめて取り込む（サブフォルダは見ない）。
#[tauri::command]
pub async fn choose_receipt_folder(
    app: AppHandle,
    db: State<'_, Database>,
) -> AppResult<AddReceiptsResult> {
    let Some(folder) = files::pick_folder(app).await else {
        return Ok(AddReceiptsResult::default());
    };
    let mut paths: Vec<PathBuf> = std::fs::read_dir(&folder)
        .map_err(|_| AppError::new(ErrorCode::FileRead))?
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.is_file() && attachments::mime_of(&files::file_name(p)).is_some())
        .collect();
    paths.sort();
    add_paths(&db, paths)
}

#[tauri::command]
pub async fn list_receipts(db: State<'_, Database>) -> AppResult<Vec<Receipt>> {
    receipts::list(&db.conn())
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadOutcome {
    /// 読んだレシート（読むものがなければ None）
    pub receipt: Option<Receipt>,
    /// まだ読み取り待ちの数
    pub remaining: i64,
}

fn today(db: &Database) -> AppResult<String> {
    Ok(db
        .conn()
        .query_row("SELECT date('now', 'localtime')", [], |r| r.get(0))?)
}

/// 読み取り待ちのレシートを 1 枚読む。画面はこれを繰り返して束を読む（操作を止めないため 1 枚ずつ）。
/// 接続できない・回数の上限のときは読み取り待ちのまま残し、エラーを返す（あとで読み直す）。
pub async fn read_next(
    db: &Database,
    reader: Option<&impl ReceiptReader>,
) -> AppResult<ReadOutcome> {
    let next = {
        let conn = db.conn();
        if receipts::settings(&conn, false)?.consented_at.is_none() {
            return Err(AppError::new(ErrorCode::ConsentRequired));
        }
        receipts::next_to_read(&conn)?
    };
    let Some((id, mime, bytes)) = next else {
        return Ok(ReadOutcome {
            receipt: None,
            remaining: 0,
        });
    };
    let Some(reader) = reader else {
        return Err(AppError::new(ErrorCode::NoApiKey));
    };
    let result = reader.read(&bytes, &mime).await;
    let today = today(db)?;
    let receipt = db.transaction(|tx| match result {
        Ok(text) => receipts::record_reading(tx, id, &text, &today).map(Some),
        Err(ReadError::Rejected) => receipts::record_failure(tx, id, "rejected").map(Some),
        Err(ReadError::BadResponse) => receipts::record_failure(tx, id, "badResponse").map(Some),
        Err(ReadError::NoKey) => Err(AppError::new(ErrorCode::NoApiKey)),
        Err(ReadError::BadKey) => Err(AppError::new(ErrorCode::BadApiKey)),
        Err(ReadError::Offline) => Err(AppError::new(ErrorCode::Offline)),
        Err(ReadError::ModelNotFound) => Err(AppError::new(ErrorCode::ModelNotFound)),
        Err(ReadError::QuotaExhausted) => Err(AppError::new(ErrorCode::QuotaExhausted)),
        Err(ReadError::RateLimited { retry_after }) => Err(AppError::rate_limited(retry_after)),
        Err(ReadError::Busy) => Err(AppError::new(ErrorCode::ServiceBusy)),
    })?;
    Ok(ReadOutcome {
        receipt,
        remaining: receipts::waiting_count(&db.conn())?,
    })
}

#[tauri::command]
pub async fn read_next_receipt(db: State<'_, Database>) -> AppResult<ReadOutcome> {
    let key = Keyring.get()?;
    let model = receipts::settings(&db.conn(), key.is_some())?.model;
    let reader = match key {
        Some(key) => Some(Gemini::new(key, model).map_err(|_| AppError::new(ErrorCode::Offline))?),
        None => None,
    };
    read_next(&db, reader.as_ref()).await
}

#[tauri::command]
pub async fn save_receipt_fields(
    db: State<'_, Database>,
    id: i64,
    fields: ReceiptFields,
) -> AppResult<Receipt> {
    db.transaction(|tx| receipts::save_fields(tx, id, &fields))
}

#[tauri::command]
pub async fn set_receipt_send_allowed(
    db: State<'_, Database>,
    id: i64,
    allowed: bool,
) -> AppResult<Receipt> {
    receipts::set_send_allowed(&db.conn(), id, allowed)
}

#[tauri::command]
pub async fn retry_receipt(db: State<'_, Database>, id: i64) -> AppResult<Receipt> {
    receipts::retry(&db.conn(), id)
}

#[tauri::command]
pub async fn delete_receipt(db: State<'_, Database>, id: i64) -> AppResult<()> {
    db.transaction(|tx| receipts::delete(tx, id))
}

// ---- 証憑 ----

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AttachmentContent {
    pub attachment: Attachment,
    /// 中身（base64）。画面で画像を出すのに使う
    pub data: String,
}

#[tauri::command]
pub async fn attachment_content(db: State<'_, Database>, id: i64) -> AppResult<AttachmentContent> {
    let (attachment, bytes) = attachments::content(&db.conn(), id)?;
    Ok(AttachmentContent {
        attachment,
        data: base64::engine::general_purpose::STANDARD.encode(bytes),
    })
}

/// 証憑をファイルに保存する（PDF や、画面に出せない形式の画像を開くため）。
#[tauri::command]
pub async fn save_attachment_copy(
    app: AppHandle,
    db: State<'_, Database>,
    id: i64,
) -> AppResult<Option<String>> {
    let (attachment, bytes) = attachments::content(&db.conn(), id)?;
    let ext: &'static str = match attachment.mime.as_str() {
        "image/jpeg" => "jpg",
        "image/png" => "png",
        "image/webp" => "webp",
        "image/heic" => "heic",
        "image/heif" => "heif",
        _ => "pdf",
    };
    let Some(path) = files::save_path(app, attachment.file_name.clone(), ("File", ext)).await
    else {
        return Ok(None);
    };
    std::fs::write(&path, bytes).map_err(|_| AppError::new(ErrorCode::FileWrite))?;
    Ok(Some(files::file_name(&path)))
}

#[tauri::command]
pub async fn list_attachments(
    db: State<'_, Database>,
    transaction_id: i64,
) -> AppResult<Vec<Attachment>> {
    attachments::list_for_transaction(&db.conn(), transaction_id)
}

/// 年度の取引ごとの証憑の数。`[取引の id, 数]` の並び。
#[tauri::command]
pub async fn attachment_counts(
    db: State<'_, Database>,
    fiscal_year: i64,
) -> AppResult<Vec<(i64, i64)>> {
    attachments::counts(&db.conn(), fiscal_year)
}

/// 取引に証憑（画像・PDF）を付ける。
#[tauri::command]
pub async fn attach_files(
    app: AppHandle,
    db: State<'_, Database>,
    transaction_id: i64,
) -> AppResult<Vec<Attachment>> {
    let paths = files::open_paths(app, IMAGE_FILTER).await;
    let mut loaded = Vec::new();
    for path in paths {
        let bytes = std::fs::read(&path).map_err(|_| AppError::new(ErrorCode::FileRead))?;
        loaded.push((files::file_name(&path), bytes));
    }
    db.transaction(|tx| {
        for (name, bytes) in &loaded {
            let (attachment, _) = attachments::add(tx, name, bytes)?;
            attachments::attach(tx, attachment.id, transaction_id)?;
        }
        attachments::list_for_transaction(tx, transaction_id)
    })
}

/// 証憑を消す。レシートとして取り込んだものは消せない（受信箱から消す）。
#[tauri::command]
pub async fn delete_attachment(
    db: State<'_, Database>,
    id: i64,
    transaction_id: i64,
) -> AppResult<()> {
    db.transaction(|tx| attachments::detach(tx, id, transaction_id))
}

// ---- 突合 ----

#[tauri::command]
pub async fn link_inbox_item(
    db: State<'_, Database>,
    id: i64,
    transaction_id: i64,
) -> AppResult<InboxItem> {
    inbox::link(&db, id, transaction_id)
}

#[tauri::command]
pub async fn unlink_inbox_item(db: State<'_, Database>, id: i64) -> AppResult<InboxItem> {
    inbox::unlink(&db.conn(), id)
}

#[tauri::command]
pub async fn reconciliation(
    db: State<'_, Database>,
    fiscal_year: i64,
) -> AppResult<Reconciliation> {
    inbox::reconciliation(&db.conn(), fiscal_year)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::receipt::ReadError;
    use chobiyori_storage::test_support::set_up_db;
    use chobiyori_storage::test_support::READING;
    use std::sync::Mutex;

    /// 決まった返事を順に返す偽物の読み取り。本物の API は呼ばない。
    struct Fake(Mutex<Vec<Result<String, ReadError>>>);

    impl ReceiptReader for Fake {
        async fn read(&self, image: &[u8], mime: &str) -> Result<String, ReadError> {
            assert!(!image.is_empty());
            assert_eq!(mime, "image/jpeg");
            self.0.lock().unwrap().remove(0)
        }
    }

    fn block_on<F: std::future::Future>(f: F) -> F::Output {
        tauri::async_runtime::block_on(f)
    }

    fn consent(db: &Database) {
        let conn = db.conn();
        let s = receipts::settings(&conn, true).unwrap();
        receipts::save_settings(
            &conn,
            &ReceiptSettingsInput {
                model: s.model,
                cash_account_id: s.cash_account_id,
                card_account_id: s.card_account_id,
                consented: true,
            },
            true,
        )
        .unwrap();
    }

    #[test]
    fn a_bundle_of_receipts_is_read_one_by_one_into_the_inbox() {
        let db = set_up_db();
        let jpeg = chobiyori_storage::test_support::jpeg;
        db.transaction(|tx| {
            receipts::add_files(
                tx,
                &[
                    ("a.jpg".into(), jpeg(1)),
                    ("b.jpg".into(), jpeg(2)),
                    ("c.jpg".into(), jpeg(3)),
                ],
            )
        })
        .unwrap();
        // 同意する前は送らない
        let fake = Fake(Mutex::new(vec![]));
        assert_eq!(
            block_on(read_next(&db, Some(&fake))).unwrap_err(),
            AppError::new(ErrorCode::ConsentRequired)
        );
        consent(&db);
        // キーがなければ読まない
        assert_eq!(
            block_on(read_next(&db, None::<&Fake>)).unwrap_err(),
            AppError::new(ErrorCode::NoApiKey)
        );
        let fake = Fake(Mutex::new(vec![
            Ok(READING.to_string()),
            Err(ReadError::Offline),
            Err(ReadError::BadResponse),
            Ok(READING
                .replace("3,240", "500")
                .replace("2160", "500")
                .replace("1080\", \"tax\": \"80\"", "0\", \"tax\": \"0\"")),
        ]));
        let first = block_on(read_next(&db, Some(&fake))).unwrap();
        assert_eq!(first.remaining, 2);
        assert!(first.receipt.unwrap().inbox_item_id.is_some());
        // 接続できないときは読み取り待ちのまま
        assert_eq!(
            block_on(read_next(&db, Some(&fake))).unwrap_err(),
            AppError::new(ErrorCode::Offline)
        );
        assert_eq!(receipts::waiting_count(&db.conn()).unwrap(), 2);
        // 返事が読めないものは「読み取れなかった」にして次へ
        let failed = block_on(read_next(&db, Some(&fake))).unwrap();
        assert_eq!(
            failed.receipt.unwrap().error.as_deref(),
            Some("badResponse")
        );
        let last = block_on(read_next(&db, Some(&fake))).unwrap();
        assert_eq!(last.remaining, 0);
        // 読み終えた
        assert!(block_on(read_next(&db, Some(&fake)))
            .unwrap()
            .receipt
            .is_none());
        // 読み取っただけでは記帳しない
        let count: i64 = db
            .conn()
            .query_row("SELECT count(*) FROM transactions", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 0);
        assert_eq!(inbox::pending_count(&db.conn()).unwrap(), 2);
    }

    #[test]
    fn the_rate_limit_tells_the_screen_how_long_to_wait() {
        let db = set_up_db();
        let jpeg = chobiyori_storage::test_support::jpeg;
        db.transaction(|tx| receipts::add_files(tx, &[("a.jpg".into(), jpeg(1))]))
            .unwrap();
        consent(&db);
        let fake = Fake(Mutex::new(vec![
            Err(ReadError::RateLimited {
                retry_after: Some(7),
            }),
            Err(ReadError::RateLimited { retry_after: None }),
        ]));
        let error = block_on(read_next(&db, Some(&fake))).unwrap_err();
        assert_eq!(error.code, ErrorCode::RateLimited);
        assert_eq!(error.retry_after, Some(7));
        assert_eq!(
            serde_json::to_value(&error).unwrap()["retryAfter"],
            serde_json::json!(7)
        );
        // 待つ秒数が分からないときは送らない（画面が決まった時間だけ待つ）
        let error = block_on(read_next(&db, Some(&fake))).unwrap_err();
        assert_eq!(error, AppError::new(ErrorCode::RateLimited));
        assert!(serde_json::to_value(&error)
            .unwrap()
            .get("retryAfter")
            .is_none());
        // 読み取り待ちのまま
        assert_eq!(receipts::waiting_count(&db.conn()).unwrap(), 1);
    }

    #[test]
    fn a_missing_model_or_used_up_quota_stops_the_bundle_without_failing_receipts() {
        let db = set_up_db();
        let jpeg = chobiyori_storage::test_support::jpeg;
        db.transaction(|tx| receipts::add_files(tx, &[("a.jpg".into(), jpeg(1))]))
            .unwrap();
        consent(&db);
        let fake = Fake(Mutex::new(vec![
            Err(ReadError::ModelNotFound),
            Err(ReadError::QuotaExhausted),
        ]));
        assert_eq!(
            block_on(read_next(&db, Some(&fake))).unwrap_err(),
            AppError::new(ErrorCode::ModelNotFound)
        );
        assert_eq!(
            block_on(read_next(&db, Some(&fake))).unwrap_err(),
            AppError::new(ErrorCode::QuotaExhausted)
        );
        // どちらも「読めなかった」にせず、読み取り待ちのまま残す
        assert_eq!(receipts::waiting_count(&db.conn()).unwrap(), 1);
    }
}
