//! 取り込んだレシート。読み取りの状態と結果を持ち、日付と合計が分かったら受信箱の候補を作る。
//!
//! 候補は確認して確定したときに初めて取引になる（読み取っただけでは記帳しない）。
//! 読み取りのサービスに送らないレシート・読めなかったレシートは、手で入力して候補にする。

use super::attachments::{self, Attachment};
use super::inbox::InboxStatus;
use crate::domain::receipt::{self, Check, PaymentMethod, ReceiptReading};
use crate::domain::string_enum;
use crate::error::{AppError, AppResult, ErrorCode};
use crate::receipt::gemini::{valid_model, DEFAULT_MODEL};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

string_enum! {
    pub enum ReceiptStatus {
        /// 読み取り待ち（オフラインのときもここで待つ）
        Waiting => "waiting",
        /// 読み取った
        Read => "read",
        /// 読み取れなかった（手で入力できる）
        Failed => "failed",
        /// 手で入力した
        Manual => "manual",
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Receipt {
    pub id: i64,
    pub attachment: Attachment,
    pub status: ReceiptStatus,
    pub send_allowed: bool,
    pub reading: Option<ReceiptReading>,
    pub checks: Vec<Check>,
    /// 読み取れなかった理由（コード）
    pub error: Option<String>,
    pub reduced_amount: i64,
    pub invoice_no: Option<String>,
    pub inbox_item_id: Option<i64>,
    /// 候補の状態（候補がまだなければ None）
    pub inbox_status: Option<InboxStatus>,
    pub transaction_id: Option<i64>,
}

// ---- 設定 ----

const MODEL_KEY: &str = "receipt.model";
const CASH_KEY: &str = "receipt.cash_account_id";
const CARD_KEY: &str = "receipt.card_account_id";
const CONSENT_KEY: &str = "receipt.consented_at";

/// レシートの読み取りの設定。API キーは OS の資格情報ストアにあり、ここには「あるかどうか」だけ。
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReceiptSettings {
    pub model: String,
    /// 現金払いの口座
    pub cash_account_id: Option<i64>,
    /// カード・電子マネー払いの口座（カードの未払金など）
    pub card_account_id: Option<i64>,
    /// 画像を読み取りのサービスに送ることに同意した日時
    pub consented_at: Option<String>,
    pub has_key: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReceiptSettingsInput {
    pub model: String,
    pub cash_account_id: Option<i64>,
    pub card_account_id: Option<i64>,
    pub consented: bool,
}

fn setting(conn: &Connection, key: &str) -> AppResult<Option<String>> {
    Ok(conn
        .query_row("SELECT value FROM settings WHERE key = ?1", [key], |r| {
            r.get(0)
        })
        .optional()?)
}

fn set_setting(conn: &Connection, key: &str, value: Option<&str>) -> AppResult<()> {
    match value {
        Some(value) => conn.execute(
            "INSERT INTO settings (key, value) VALUES (?1, ?2)
             ON CONFLICT (key) DO UPDATE SET value = excluded.value",
            params![key, value],
        )?,
        None => conn.execute("DELETE FROM settings WHERE key = ?1", [key])?,
    };
    Ok(())
}

/// 標準の科目のコードから id を引く（口座の既定に使う）。
fn system_account(conn: &Connection, code: &str) -> AppResult<Option<i64>> {
    Ok(conn
        .query_row(
            "SELECT id FROM accounts WHERE code = ?1 AND is_system = 1 AND is_payment_account = 1",
            [code],
            |r| r.get(0),
        )
        .optional()?)
}

pub fn settings(conn: &Connection, has_key: bool) -> AppResult<ReceiptSettings> {
    let id =
        |key| -> AppResult<Option<i64>> { Ok(setting(conn, key)?.and_then(|v| v.parse().ok())) };
    Ok(ReceiptSettings {
        model: setting(conn, MODEL_KEY)?.unwrap_or_else(|| DEFAULT_MODEL.to_string()),
        // 決めていなければ、標準の現金（101）とカードの未払金（204）
        cash_account_id: id(CASH_KEY)?.or(system_account(conn, "101")?),
        card_account_id: id(CARD_KEY)?.or(system_account(conn, "204")?),
        consented_at: setting(conn, CONSENT_KEY)?,
        has_key,
    })
}

fn ensure_payment_account(
    conn: &Connection,
    id: Option<i64>,
    field: &'static str,
) -> AppResult<()> {
    let Some(id) = id else { return Ok(()) };
    let ok: Option<bool> = conn
        .query_row(
            "SELECT is_payment_account AND is_active FROM accounts WHERE id = ?1",
            [id],
            |r| r.get(0),
        )
        .optional()?;
    match ok {
        Some(true) => Ok(()),
        Some(false) => Err(AppError::field(ErrorCode::InvalidFormat, field)),
        None => Err(AppError::field(ErrorCode::NotFound, field)),
    }
}

pub fn save_settings(
    conn: &Connection,
    input: &ReceiptSettingsInput,
    has_key: bool,
) -> AppResult<ReceiptSettings> {
    let model = input.model.trim();
    if !valid_model(model) {
        return Err(AppError::field(ErrorCode::InvalidFormat, "model"));
    }
    ensure_payment_account(conn, input.cash_account_id, "cashAccountId")?;
    ensure_payment_account(conn, input.card_account_id, "cardAccountId")?;
    set_setting(conn, MODEL_KEY, Some(model))?;
    set_setting(
        conn,
        CASH_KEY,
        input.cash_account_id.map(|v| v.to_string()).as_deref(),
    )?;
    set_setting(
        conn,
        CARD_KEY,
        input.card_account_id.map(|v| v.to_string()).as_deref(),
    )?;
    match (input.consented, setting(conn, CONSENT_KEY)?) {
        (true, None) => {
            let now: String =
                conn.query_row("SELECT strftime('%Y-%m-%dT%H:%M:%SZ', 'now')", [], |r| {
                    r.get(0)
                })?;
            set_setting(conn, CONSENT_KEY, Some(&now))?;
        }
        (false, Some(_)) => set_setting(conn, CONSENT_KEY, None)?,
        _ => {}
    }
    settings(conn, has_key)
}

// ---- レシート ----

const SELECT: &str = "
    SELECT r.id, r.attachment_id, r.status, r.send_allowed, r.reading, r.checks, r.error,
           r.reduced_amount, r.invoice_no, r.inbox_item_id, i.transaction_id, i.ignored
    FROM receipts r
    LEFT JOIN inbox_items i ON i.id = r.inbox_item_id";

fn read(conn: &Connection, filter: &str, params: impl rusqlite::Params) -> AppResult<Vec<Receipt>> {
    let mut stmt = conn.prepare(&format!("{SELECT} {filter}"))?;
    let rows: Vec<_> = stmt
        .query_map(params, |r| {
            Ok((
                r.get::<_, i64>(0)?,
                r.get::<_, i64>(1)?,
                r.get::<_, ReceiptStatus>(2)?,
                r.get::<_, bool>(3)?,
                r.get::<_, Option<String>>(4)?,
                r.get::<_, String>(5)?,
                r.get::<_, Option<String>>(6)?,
                r.get::<_, i64>(7)?,
                r.get::<_, Option<String>>(8)?,
                r.get::<_, Option<i64>>(9)?,
                r.get::<_, Option<i64>>(10)?,
                r.get::<_, Option<bool>>(11)?,
            ))
        })?
        .collect::<Result<_, _>>()?;
    rows.into_iter()
        .map(
            |(
                id,
                attachment_id,
                status,
                send_allowed,
                reading,
                checks,
                error,
                reduced,
                invoice,
                item,
                transaction,
                ignored,
            )| {
                Ok(Receipt {
                    id,
                    attachment: attachments::get(conn, attachment_id)?,
                    status,
                    send_allowed,
                    reading: reading.and_then(|r| serde_json::from_str(&r).ok()),
                    checks: serde_json::from_str(&checks).unwrap_or_default(),
                    error,
                    reduced_amount: reduced,
                    invoice_no: invoice,
                    inbox_item_id: item,
                    inbox_status: item.map(|_| match (transaction, ignored) {
                        (Some(_), _) => InboxStatus::Posted,
                        (None, Some(true)) => InboxStatus::Ignored,
                        _ => InboxStatus::Pending,
                    }),
                    transaction_id: transaction,
                })
            },
        )
        .collect()
}

pub fn get(conn: &Connection, id: i64) -> AppResult<Receipt> {
    read(conn, "WHERE r.id = ?1", [id])?
        .pop()
        .ok_or(AppError::new(ErrorCode::NotFound))
}

/// レシートの一覧。確定していないものが先、その中は取り込んだ順。
pub fn list(conn: &Connection) -> AppResult<Vec<Receipt>> {
    read(
        conn,
        "ORDER BY (i.transaction_id IS NOT NULL OR coalesce(i.ignored, 0) = 1), r.id",
        [],
    )
}

/// 読み取り待ちの数（送ってよいものだけ）。
pub fn waiting_count(conn: &Connection) -> AppResult<i64> {
    Ok(conn.query_row(
        "SELECT count(*) FROM receipts WHERE status = 'waiting' AND send_allowed = 1",
        [],
        |r| r.get(0),
    )?)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AddReceiptsResult {
    pub added: usize,
    /// 前に取り込んだ画像と同じなので飛ばした数
    pub duplicates: usize,
    /// 画像・PDF でない、大きすぎるなどで入れなかった数
    pub rejected: usize,
}

/// レシートの画像を取り込む（読み取り待ちにする）。
pub fn add_files(conn: &Connection, files: &[(String, Vec<u8>)]) -> AppResult<AddReceiptsResult> {
    let mut result = AddReceiptsResult::default();
    for (name, bytes) in files {
        conn.execute_batch("SAVEPOINT receipt_file")?;
        let outcome = (|| -> AppResult<bool> {
            let (attachment, existed) = attachments::add(conn, name, bytes)?;
            if existed {
                return Ok(false);
            }
            conn.execute(
                "INSERT INTO receipts (attachment_id) VALUES (?1)",
                [attachment.id],
            )?;
            Ok(true)
        })();
        match outcome {
            Ok(true) => {
                conn.execute_batch("RELEASE receipt_file")?;
                result.added += 1;
            }
            Ok(false) => {
                conn.execute_batch("RELEASE receipt_file")?;
                result.duplicates += 1;
            }
            Err(e) if e.code == ErrorCode::Database => {
                conn.execute_batch("ROLLBACK TO receipt_file; RELEASE receipt_file")?;
                return Err(e);
            }
            Err(_) => {
                conn.execute_batch("ROLLBACK TO receipt_file; RELEASE receipt_file")?;
                result.rejected += 1;
            }
        }
    }
    Ok(result)
}

/// 次に読み取るレシート（id・種類・中身）。送ってよいものだけ。
pub fn next_to_read(conn: &Connection) -> AppResult<Option<(i64, String, Vec<u8>)>> {
    let next: Option<(i64, i64)> = conn
        .query_row(
            "SELECT id, attachment_id FROM receipts WHERE status = 'waiting' AND send_allowed = 1 ORDER BY id LIMIT 1",
            [],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()?;
    let Some((id, attachment_id)) = next else {
        return Ok(None);
    };
    let (attachment, data) = attachments::content(conn, attachment_id)?;
    Ok(Some((id, attachment.mime, data)))
}

/// 候補の中身。手で入力するとき・読み取った値を直すとき。
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReceiptFields {
    pub date: String,
    pub total: i64,
    pub merchant: String,
    pub payment_account_id: i64,
    /// 軽減税率（8%）の対象額（税込）。0 なら分けない
    #[serde(default)]
    pub reduced_amount: i64,
    #[serde(default)]
    pub invoice_no: Option<String>,
}

fn ensure_editable(receipt: &Receipt) -> AppResult<()> {
    if receipt.inbox_status == Some(InboxStatus::Posted) {
        return Err(AppError::new(ErrorCode::AlreadyRecorded));
    }
    Ok(())
}

/// 受信箱の候補を作る（あれば直す）。
fn upsert_item(conn: &Connection, receipt: &Receipt, fields: &ReceiptFields) -> AppResult<i64> {
    let date = crate::domain::journal::parse_date(fields.date.trim())
        .map(|_| fields.date.trim().to_string())
        .ok_or(AppError::field(ErrorCode::InvalidFormat, "date"))?;
    if !(1..=crate::domain::journal::AMOUNT_MAX).contains(&fields.total) {
        return Err(AppError::field(ErrorCode::OutOfRange, "total"));
    }
    if !(0..=fields.total).contains(&fields.reduced_amount) {
        return Err(AppError::field(ErrorCode::OutOfRange, "reducedAmount"));
    }
    ensure_payment_account(conn, Some(fields.payment_account_id), "paymentAccountId")?;
    let merchant = crate::domain::master::optional(&fields.merchant, 100, "merchant")?;
    let invoice_no = match fields
        .invoice_no
        .as_deref()
        .map(str::trim)
        .filter(|v| !v.is_empty())
    {
        None => None,
        Some(text) => Some(
            receipt::normalize_invoice_no(text)
                .ok_or(AppError::field(ErrorCode::InvalidFormat, "invoiceNo"))?,
        ),
    };
    conn.execute(
        "UPDATE receipts SET reduced_amount = ?2, invoice_no = ?3 WHERE id = ?1",
        params![receipt.id, fields.reduced_amount, invoice_no],
    )?;
    if let Some(item) = receipt.inbox_item_id {
        conn.execute(
            "UPDATE inbox_items SET date = ?2, spend = ?3, merchant = ?4, payment_account_id = ?5, payment_sub_account_id = NULL
             WHERE id = ?1 AND transaction_id IS NULL",
            params![item, date, fields.total, merchant, fields.payment_account_id],
        )?;
        return Ok(item);
    }
    conn.execute(
        "INSERT INTO inbox_items (source, file_name, row_key, payment_account_id, date, spend, merchant)
         VALUES ('receipt', ?1, ?2, ?3, ?4, ?5, ?6)",
        params![
            receipt.attachment.file_name,
            format!("receipt:{}", receipt.attachment.sha256),
            fields.payment_account_id,
            date,
            fields.total,
            merchant
        ],
    )?;
    let item = conn.last_insert_rowid();
    conn.execute(
        "UPDATE receipts SET inbox_item_id = ?2 WHERE id = ?1",
        params![receipt.id, item],
    )?;
    Ok(item)
}

/// 支払方法から、貸方の口座を決める。分からなければ現金。
fn payment_account(settings: &ReceiptSettings, method: Option<PaymentMethod>) -> Option<i64> {
    match method {
        Some(PaymentMethod::Card | PaymentMethod::EMoney) => settings.card_account_id,
        _ => settings.cash_account_id,
    }
}

/// 読み取った結果を記録する。日付と合計が読めていれば、受信箱の候補を作る。
/// `text` は読み取りのサービスが返した JSON。`today` は `YYYY-MM-DD`。
pub fn record_reading(conn: &Connection, id: i64, text: &str, today: &str) -> AppResult<Receipt> {
    let current = get(conn, id)?;
    ensure_editable(&current)?;
    let Some((reading, bad_invoice)) = receipt::parse_reading(text) else {
        return record_failure(conn, id, "badResponse");
    };
    let checks = receipt::checks(&reading, bad_invoice, today);
    let reduced = receipt::reduced_amount(&reading);
    conn.execute(
        "UPDATE receipts SET status = 'read', reading = ?2, checks = ?3, error = NULL,
             reduced_amount = ?4, invoice_no = ?5, read_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
         WHERE id = ?1",
        params![
            id,
            serde_json::to_string(&reading).unwrap_or_default(),
            serde_json::to_string(&checks).unwrap_or_default(),
            reduced,
            reading.invoice_no
        ],
    )?;
    let receipt = get(conn, id)?;
    let settings = settings(conn, false)?;
    if let (Some(date), Some(total), Some(account)) = (
        reading.date.clone(),
        reading.total,
        payment_account(&settings, reading.payment),
    ) {
        upsert_item(
            conn,
            &receipt,
            &ReceiptFields {
                date,
                total,
                merchant: reading.merchant.clone(),
                payment_account_id: account,
                reduced_amount: reduced,
                invoice_no: reading.invoice_no.clone(),
            },
        )?;
    } else {
        conn.execute(
            "UPDATE receipts SET status = 'failed', error = 'unreadable' WHERE id = ?1",
            [id],
        )?;
    }
    get(conn, id)
}

/// 読み取れなかったことを記録する（手で入力してもらう）。
pub fn record_failure(conn: &Connection, id: i64, code: &str) -> AppResult<Receipt> {
    conn.execute(
        "UPDATE receipts SET status = 'failed', error = ?2 WHERE id = ?1 AND status = 'waiting'",
        params![id, code],
    )?;
    get(conn, id)
}

/// 手で入力する・読み取った値を直す。候補を作り直し、手で入力したことにする。
pub fn save_fields(conn: &Connection, id: i64, fields: &ReceiptFields) -> AppResult<Receipt> {
    let receipt = get(conn, id)?;
    ensure_editable(&receipt)?;
    upsert_item(conn, &receipt, fields)?;
    if receipt.status != ReceiptStatus::Read {
        conn.execute("UPDATE receipts SET status = 'manual' WHERE id = ?1", [id])?;
    }
    get(conn, id)
}

/// 読み取りのサービスに送るかを変える。送らないものは手で入力する。
pub fn set_send_allowed(conn: &Connection, id: i64, allowed: bool) -> AppResult<Receipt> {
    conn.execute(
        "UPDATE receipts SET send_allowed = ?2 WHERE id = ?1",
        params![id, allowed],
    )?;
    get(conn, id)
}

/// 読み取れなかったレシートを、もう一度読み取り待ちにする。
pub fn retry(conn: &Connection, id: i64) -> AppResult<Receipt> {
    let receipt = get(conn, id)?;
    ensure_editable(&receipt)?;
    conn.execute(
        "UPDATE receipts SET status = 'waiting', error = NULL WHERE id = ?1 AND status = 'failed'",
        [id],
    )?;
    get(conn, id)
}

/// レシートを消す（画像も消す）。確定したものは消せない（取引を先に消す）。
pub fn delete(conn: &Connection, id: i64) -> AppResult<()> {
    let receipt = get(conn, id)?;
    ensure_editable(&receipt)?;
    conn.execute("DELETE FROM receipts WHERE id = ?1", [id])?;
    if let Some(item) = receipt.inbox_item_id {
        conn.execute(
            "DELETE FROM inbox_items WHERE id = ?1 AND transaction_id IS NULL",
            [item],
        )?;
    }
    conn.execute(
        "DELETE FROM attachments WHERE id = ?1",
        [receipt.attachment.id],
    )?;
    Ok(())
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use crate::db::attachments::tests::jpeg;
    use crate::db::setup::tests::set_up_db;
    use crate::db::transactions::tests::account;

    pub(crate) const READING: &str = r#"{
        "date": "2026-03-05", "total": "3,240", "merchant": "テスト商店",
        "invoiceNo": "T1234567890123",
        "taxParts": [{"rate": 10, "amount": "2160", "tax": "196"}, {"rate": 8, "amount": "1080", "tax": "80"}],
        "payment": "card"
    }"#;

    pub(crate) fn add_one(conn: &Connection, seed: u8) -> i64 {
        add_files(conn, &[(format!("r{seed}.jpg"), jpeg(seed))]).unwrap();
        conn.query_row("SELECT max(id) FROM receipts", [], |r| r.get(0))
            .unwrap()
    }

    #[test]
    fn adding_skips_the_same_image_and_rejects_other_files() {
        let db = set_up_db();
        let conn = db.conn();
        let result = add_files(
            &conn,
            &[
                ("a.jpg".into(), jpeg(1)),
                ("b.jpg".into(), jpeg(1)),
                ("c.txt".into(), b"x".to_vec()),
                ("d.jpg".into(), jpeg(2)),
            ],
        )
        .unwrap();
        assert_eq!(
            result,
            AddReceiptsResult {
                added: 2,
                duplicates: 1,
                rejected: 1
            }
        );
        assert_eq!(waiting_count(&conn).unwrap(), 2);
        let (id, mime, data) = next_to_read(&conn).unwrap().unwrap();
        assert_eq!((mime.as_str(), data), ("image/jpeg", jpeg(1)));
        // 送らないことにしたものは読み取りに回さない
        set_send_allowed(&conn, id, false).unwrap();
        assert_eq!(waiting_count(&conn).unwrap(), 1);
    }

    #[test]
    fn a_reading_becomes_an_inbox_candidate_on_the_card_account() {
        let db = set_up_db();
        let conn = db.conn();
        let id = add_one(&conn, 1);
        let r = record_reading(&conn, id, READING, "2026-11-16").unwrap();
        assert_eq!(r.status, ReceiptStatus::Read);
        assert!(r.checks.is_empty());
        assert_eq!(r.reduced_amount, 1080);
        assert_eq!(r.inbox_status, Some(InboxStatus::Pending));
        let item = crate::db::inbox::get(&conn, r.inbox_item_id.unwrap()).unwrap();
        assert_eq!(item.payment_account_id, account(&conn, "204"));
        assert_eq!((item.date.as_str(), item.spend), ("2026-03-05", 3240));
    }

    #[test]
    fn unreadable_receipts_wait_for_hand_entry() {
        let db = set_up_db();
        let conn = db.conn();
        let id = add_one(&conn, 1);
        let r = record_reading(
            &conn,
            id,
            r#"{"date":"","total":"","merchant":"","payment":"cash"}"#,
            "2026-11-16",
        )
        .unwrap();
        assert_eq!(
            (r.status, r.error.as_deref()),
            (ReceiptStatus::Failed, Some("unreadable"))
        );
        assert_eq!(r.inbox_item_id, None);
        let r = save_fields(
            &conn,
            id,
            &ReceiptFields {
                date: "2026-03-06".into(),
                total: 550,
                merchant: "パン屋".into(),
                payment_account_id: account(&conn, "101"),
                reduced_amount: 550,
                invoice_no: Some("bad".into()),
            },
        )
        .unwrap_err();
        assert_eq!(r, AppError::field(ErrorCode::InvalidFormat, "invoiceNo"));
        let r = save_fields(
            &conn,
            id,
            &ReceiptFields {
                date: "2026-03-06".into(),
                total: 550,
                merchant: "パン屋".into(),
                payment_account_id: account(&conn, "101"),
                reduced_amount: 550,
                invoice_no: None,
            },
        )
        .unwrap();
        assert_eq!(r.status, ReceiptStatus::Manual);
        assert_eq!(r.inbox_status, Some(InboxStatus::Pending));
        // 消すと画像も消える
        delete(&conn, id).unwrap();
        let count: i64 = conn
            .query_row("SELECT count(*) FROM attachments", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 0);
    }

    #[test]
    fn settings_default_to_standard_accounts_and_record_consent() {
        let db = set_up_db();
        let conn = db.conn();
        let s = settings(&conn, false).unwrap();
        assert_eq!(s.model, DEFAULT_MODEL);
        assert_eq!(s.cash_account_id, Some(account(&conn, "101")));
        assert_eq!(s.consented_at, None);
        let s = save_settings(
            &conn,
            &ReceiptSettingsInput {
                model: "gemini-x".into(),
                cash_account_id: None,
                card_account_id: Some(account(&conn, "104")),
                consented: true,
            },
            true,
        )
        .unwrap();
        assert!(s.consented_at.is_some() && s.has_key);
        assert_eq!(s.card_account_id, Some(account(&conn, "104")));
        // 口座でない科目は選べない
        assert_eq!(
            save_settings(
                &conn,
                &ReceiptSettingsInput {
                    model: "gemini-x".into(),
                    cash_account_id: Some(account(&conn, "610")),
                    card_account_id: None,
                    consented: true,
                },
                true,
            )
            .unwrap_err(),
            AppError::field(ErrorCode::InvalidFormat, "cashAccountId")
        );
    }
}
