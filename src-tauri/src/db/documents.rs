//! 請求書・見積書・納品書・領収書の読み書き（F11）。
//!
//! - 下書きは自由に直せる。発行すると番号を付け、そのときの自分の情報と様式を書類に残し、
//!   PDF の控えを帳簿と一緒に（暗号化して）保存する。発行した書類は書き換えない
//! - 直すときは取り消して作り直す。取り消した書類も控えとして残す
//! - 請求書を発行したら「売掛金 / 売上」を候補に出す。記帳は利用者が確認してから
//! - 入金は「預金 / 売掛金」で記帳し、入金の合計が請求額に届いたら入金済み（計算で決める）
//!
//! 書類の操作は変更履歴に残す（宛先のメールアドレスや金額は残さない）。

use super::transactions::Transaction;
use super::{attachments, audit, closing, setup, transactions, Database};
use crate::domain::document::{
    self as doc, DisplayStatus, DocumentKind, DocumentStatus, LineInput, TaxMode, Totals,
};
use crate::domain::journal::{self, EntryMode, Side, TransactionInput, TransactionKind};
use crate::domain::master::TaxCategory;
use crate::error::{AppError, AppResult, ErrorCode};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

const TITLE_MAX: usize = 100;
const NOTES_MAX: usize = 1_000;
const ADDRESS_MAX: usize = 200;

/// 書類に書く自分の情報。発行したときの内容を書類に残す（あとで事業者情報を変えても控えは変わらない）。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Issuer {
    pub trade_name: String,
    pub owner_name: String,
    pub address: String,
    pub phone: String,
    pub email: String,
    /// 適格請求書のときだけ
    pub registration_no: Option<String>,
    pub bank_account: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Send {
    pub method: String,
    pub to_address: String,
    pub sent_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Document {
    pub id: i64,
    pub kind: DocumentKind,
    pub number: Option<String>,
    pub status: DocumentStatus,
    pub display_status: DisplayStatus,
    pub partner_id: Option<i64>,
    pub recipient_name: String,
    pub recipient_address: String,
    pub recipient_email: String,
    pub issue_date: String,
    pub due_date: Option<String>,
    pub title: String,
    pub notes: String,
    /// 様式。下書きは発行日の年度から決めた見込み
    pub tax_mode: TaxMode,
    /// 自分の情報。下書きは今の事業者情報と書類の設定から作った見込み
    pub issuer: Issuer,
    pub lines: Vec<LineInput>,
    pub totals: Totals,
    /// 入金の合計（請求書だけ）
    pub paid: i64,
    pub last_payment_account_id: Option<i64>,
    pub source_document_id: Option<i64>,
    /// 売上の仕訳
    pub transaction_id: Option<i64>,
    pub pdf_attachment_id: Option<i64>,
    pub issued_at: Option<String>,
    pub canceled_at: Option<String>,
    pub sends: Vec<Send>,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentInput {
    pub kind: DocumentKind,
    #[serde(default)]
    pub partner_id: Option<i64>,
    #[serde(default)]
    pub recipient_name: String,
    #[serde(default)]
    pub recipient_address: String,
    #[serde(default)]
    pub recipient_email: String,
    pub issue_date: String,
    #[serde(default)]
    pub due_date: Option<String>,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub notes: String,
    pub lines: Vec<LineInput>,
}

/// 書類の設定（画像を除く）。`settings` に JSON で置く。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct DocumentSettings {
    pub phone: String,
    pub email: String,
    /// 振込先（複数行可）
    pub bank_account: String,
    /// 新しく作る請求書に入れる備考
    pub default_notes: String,
    /// 請求書の支払期限（発行日から何日後）
    pub due_days: i64,
    pub logo_attachment_id: Option<i64>,
    pub seal_attachment_id: Option<i64>,
    /// メールの件名と本文のひな形
    pub mail_subject: String,
    pub mail_body: String,
}

impl Default for DocumentSettings {
    fn default() -> Self {
        Self {
            phone: String::new(),
            email: String::new(),
            bank_account: String::new(),
            default_notes: String::new(),
            due_days: 30,
            logo_attachment_id: None,
            seal_attachment_id: None,
            mail_subject: "{書類}送付のご案内（{番号}）".into(),
            mail_body: "{宛名}\n\nいつもお世話になっております。{差出人}です。\n{書類}（{番号}）を添付いたします。合計金額は{金額}円です。\n\n{書類別の一文}{期限}\nご不明な点がございましたら、お知らせください。\n\nどうぞよろしくお願いいたします。\n\n{差出人}"
                .into(),
        }
    }
}

const SETTINGS_KEY: &str = "documents.settings";

fn setting(conn: &Connection, key: &str) -> AppResult<Option<String>> {
    Ok(conn
        .query_row("SELECT value FROM settings WHERE key = ?1", [key], |r| {
            r.get(0)
        })
        .optional()?)
}

fn set_setting(conn: &Connection, key: &str, value: &str) -> AppResult<()> {
    conn.execute(
        "INSERT INTO settings (key, value) VALUES (?1, ?2)
         ON CONFLICT (key) DO UPDATE SET value = excluded.value",
        params![key, value],
    )?;
    Ok(())
}

pub fn settings(conn: &Connection) -> AppResult<DocumentSettings> {
    Ok(setting(conn, SETTINGS_KEY)?
        .and_then(|v| serde_json::from_str(&v).ok())
        .unwrap_or_default())
}

pub fn save_settings(conn: &Connection, input: &DocumentSettings) -> AppResult<DocumentSettings> {
    let image = |id: Option<i64>, field| -> AppResult<Option<i64>> {
        match id {
            None => Ok(None),
            Some(id) => {
                let a = attachments::get(conn, id)
                    .map_err(|_| AppError::field(ErrorCode::NotFound, field))?;
                if a.mime == "image/png" || a.mime == "image/jpeg" {
                    Ok(Some(id))
                } else {
                    Err(AppError::field(ErrorCode::InvalidFormat, field))
                }
            }
        }
    };
    if !(0..=365).contains(&input.due_days) {
        return Err(AppError::field(ErrorCode::OutOfRange, "dueDays"));
    }
    let valid = DocumentSettings {
        phone: doc::text(&input.phone, 30, "phone")?,
        email: doc::email(&input.email, "email")?,
        bank_account: doc::text(&input.bank_account, 300, "bankAccount")?,
        default_notes: doc::text(&input.default_notes, NOTES_MAX, "defaultNotes")?,
        due_days: input.due_days,
        logo_attachment_id: image(input.logo_attachment_id, "logo")?,
        seal_attachment_id: image(input.seal_attachment_id, "seal")?,
        mail_subject: doc::text(&input.mail_subject, 200, "mailSubject")?,
        mail_body: doc::text(&input.mail_body, 4_000, "mailBody")?,
    };
    set_setting(
        conn,
        SETTINGS_KEY,
        &serde_json::to_string(&valid).map_err(|_| AppError::new(ErrorCode::Database))?,
    )?;
    Ok(valid)
}

/// メールの送信の設定（パスワードは OS の資格情報ストアに置き、ここには入れない）。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MailSettings {
    pub from_address: String,
    pub from_name: String,
    pub host: String,
    pub port: u16,
    /// `starttls`（587 番）か `tls`（465 番）
    pub security: String,
    pub username: String,
}

const MAIL_KEY: &str = "mail.settings";

pub fn mail_settings(conn: &Connection) -> AppResult<Option<MailSettings>> {
    Ok(setting(conn, MAIL_KEY)?.and_then(|v| serde_json::from_str(&v).ok()))
}

pub fn save_mail_settings(conn: &Connection, input: &MailSettings) -> AppResult<MailSettings> {
    let from_address = doc::email(&input.from_address, "fromAddress")?;
    if from_address.is_empty() {
        return Err(AppError::field(ErrorCode::Required, "fromAddress"));
    }
    let host = input.host.trim().to_ascii_lowercase();
    if host.is_empty() {
        return Err(AppError::field(ErrorCode::Required, "host"));
    }
    if host.len() > 253
        || !host
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-')
    {
        return Err(AppError::field(ErrorCode::InvalidFormat, "host"));
    }
    if input.port == 0 {
        return Err(AppError::field(ErrorCode::OutOfRange, "port"));
    }
    if !matches!(input.security.as_str(), "starttls" | "tls") {
        return Err(AppError::field(ErrorCode::InvalidFormat, "security"));
    }
    let username = input.username.trim();
    let valid = MailSettings {
        from_name: doc::text(&input.from_name, 60, "fromName")?,
        username: if username.is_empty() {
            from_address.clone()
        } else {
            doc::text(username, 254, "username")?
        },
        from_address,
        host,
        port: input.port,
        security: input.security.clone(),
    };
    set_setting(
        conn,
        MAIL_KEY,
        &serde_json::to_string(&valid).map_err(|_| AppError::new(ErrorCode::Database))?,
    )?;
    Ok(valid)
}

/// 発行日で様式を決める。課税の日（年の途中で登録した年は登録日から）で、登録番号があるときだけ適格請求書。
pub fn tax_mode_for(conn: &Connection, issue_date: &str) -> AppResult<TaxMode> {
    if journal::parse_date(issue_date).is_none() {
        return Err(AppError::field(ErrorCode::InvalidFormat, "issueDate"));
    }
    let exempt = transactions::date_is_exempt(conn, issue_date)?;
    let registered = setup::profile(conn)?.invoice_registration_no.is_some()
        && super::filing::registered_on(conn)?.is_none_or(|date| date.as_str() <= issue_date);
    Ok(if !exempt && registered {
        TaxMode::Qualified
    } else {
        TaxMode::Simple
    })
}

fn current_issuer(conn: &Connection, mode: TaxMode) -> AppResult<Issuer> {
    let p = setup::profile(conn)?;
    let s = settings(conn)?;
    Ok(Issuer {
        trade_name: p.trade_name,
        owner_name: p.owner_name,
        address: p.address,
        phone: s.phone,
        email: s.email,
        registration_no: if mode == TaxMode::Qualified {
            p.invoice_registration_no
        } else {
            None
        },
        bank_account: s.bank_account,
    })
}

struct Valid {
    partner_id: Option<i64>,
    recipient_name: String,
    recipient_address: String,
    recipient_email: String,
    issue_date: String,
    due_date: Option<String>,
    title: String,
    notes: String,
    lines: Vec<LineInput>,
}

fn validate(conn: &Connection, input: &DocumentInput) -> AppResult<Valid> {
    let issue_date = input.issue_date.trim();
    if journal::parse_date(issue_date).is_none() {
        return Err(AppError::field(ErrorCode::InvalidFormat, "issueDate"));
    }
    let due_date = match input
        .due_date
        .as_deref()
        .map(str::trim)
        .filter(|d| !d.is_empty())
    {
        None => None,
        Some(d) if journal::parse_date(d).is_none() => {
            return Err(AppError::field(ErrorCode::InvalidFormat, "dueDate"))
        }
        Some(d) if d < issue_date => return Err(AppError::field(ErrorCode::OutOfRange, "dueDate")),
        Some(d) => Some(d.to_string()),
    };
    if let Some(id) = input.partner_id {
        let exists: bool = conn.query_row(
            "SELECT EXISTS (SELECT 1 FROM partners WHERE id = ?1)",
            [id],
            |r| r.get(0),
        )?;
        if !exists {
            return Err(AppError::field(ErrorCode::NotFound, "partnerId"));
        }
    }
    Ok(Valid {
        partner_id: input.partner_id,
        recipient_name: doc::text(&input.recipient_name, doc::RECIPIENT_MAX, "recipientName")?,
        recipient_address: doc::text(&input.recipient_address, ADDRESS_MAX, "recipientAddress")?,
        recipient_email: doc::email(&input.recipient_email, "recipientEmail")?,
        issue_date: issue_date.to_string(),
        due_date,
        title: doc::text(&input.title, TITLE_MAX, "title")?,
        notes: doc::text(&input.notes, NOTES_MAX, "notes")?,
        lines: doc::validate_lines(&input.lines)?,
    })
}

fn today(conn: &Connection) -> AppResult<String> {
    Ok(conn.query_row("SELECT date('now', 'localtime')", [], |r| r.get(0))?)
}

struct Row {
    id: i64,
    kind: DocumentKind,
    number: Option<String>,
    status: DocumentStatus,
    partner_id: Option<i64>,
    recipient_name: String,
    recipient_address: String,
    recipient_email: String,
    issue_date: String,
    due_date: Option<String>,
    title: String,
    notes: String,
    tax_mode: Option<TaxMode>,
    issuer_json: Option<String>,
    source_document_id: Option<i64>,
    transaction_id: Option<i64>,
    pdf_attachment_id: Option<i64>,
    issued_at: Option<String>,
    canceled_at: Option<String>,
}

const SELECT: &str =
    "SELECT id, kind, number, status, partner_id, recipient_name, recipient_address,
    recipient_email, issue_date, due_date, title, notes, tax_mode, issuer_json, source_document_id,
    transaction_id, pdf_attachment_id, issued_at, canceled_at FROM documents";

fn read_row(r: &rusqlite::Row<'_>) -> rusqlite::Result<Row> {
    Ok(Row {
        id: r.get(0)?,
        kind: r.get(1)?,
        number: r.get(2)?,
        status: r.get(3)?,
        partner_id: r.get(4)?,
        recipient_name: r.get(5)?,
        recipient_address: r.get(6)?,
        recipient_email: r.get(7)?,
        issue_date: r.get(8)?,
        due_date: r.get(9)?,
        title: r.get(10)?,
        notes: r.get(11)?,
        tax_mode: r.get(12)?,
        issuer_json: r.get(13)?,
        source_document_id: r.get(14)?,
        transaction_id: r.get(15)?,
        pdf_attachment_id: r.get(16)?,
        issued_at: r.get(17)?,
        canceled_at: r.get(18)?,
    })
}

fn lines_of(conn: &Connection, id: i64) -> AppResult<Vec<LineInput>> {
    let mut stmt = conn.prepare_cached(
        "SELECT name, quantity, unit, unit_price, tax_rate FROM document_lines WHERE document_id = ?1 ORDER BY line_no",
    )?;
    let rows = stmt.query_map([id], |r| {
        Ok(LineInput {
            name: r.get(0)?,
            quantity: r.get(1)?,
            unit: r.get(2)?,
            unit_price: r.get(3)?,
            tax_rate: r.get(4)?,
        })
    })?;
    Ok(rows.collect::<Result<_, _>>()?)
}

fn paid_of(conn: &Connection, id: i64) -> AppResult<i64> {
    Ok(conn.query_row(
        "SELECT coalesce(sum(amount), 0) FROM document_payments WHERE document_id = ?1",
        [id],
        |r| r.get(0),
    )?)
}

fn last_payment_account(conn: &Connection, id: i64) -> AppResult<Option<i64>> {
    Ok(conn
        .query_row(
            "SELECT l.account_id
         FROM document_payments p JOIN journal_lines l ON l.transaction_id = p.transaction_id
         WHERE p.document_id = ?1 AND l.side = 'debit'
         ORDER BY p.id DESC, l.line_no LIMIT 1",
            [id],
            |r| r.get(0),
        )
        .optional()?)
}

fn sends_of(conn: &Connection, id: i64) -> AppResult<Vec<Send>> {
    let mut stmt = conn.prepare_cached(
        "SELECT method, to_address, sent_at FROM document_sends WHERE document_id = ?1 ORDER BY id",
    )?;
    let rows = stmt.query_map([id], |r| {
        Ok(Send {
            method: r.get(0)?,
            to_address: r.get(1)?,
            sent_at: r.get(2)?,
        })
    })?;
    Ok(rows.collect::<Result<_, _>>()?)
}

fn build(conn: &Connection, row: Row, today: &str) -> AppResult<Document> {
    let lines = lines_of(conn, row.id)?;
    let tax_mode = match row.tax_mode {
        Some(m) => m,
        None => tax_mode_for(conn, &row.issue_date)?,
    };
    let issuer = match &row.issuer_json {
        Some(json) => serde_json::from_str(json).map_err(|_| AppError::new(ErrorCode::Database))?,
        None => current_issuer(conn, tax_mode)?,
    };
    let totals = doc::totals(&lines, tax_mode);
    let paid = paid_of(conn, row.id)?;
    Ok(Document {
        display_status: doc::display_status(
            row.kind,
            row.status,
            totals.total,
            paid,
            row.due_date.as_deref(),
            today,
        ),
        id: row.id,
        kind: row.kind,
        number: row.number,
        status: row.status,
        partner_id: row.partner_id,
        recipient_name: row.recipient_name,
        recipient_address: row.recipient_address,
        recipient_email: row.recipient_email,
        issue_date: row.issue_date,
        due_date: row.due_date,
        title: row.title,
        notes: row.notes,
        tax_mode,
        issuer,
        lines,
        totals,
        paid,
        last_payment_account_id: if paid > 0 {
            last_payment_account(conn, row.id)?
        } else {
            None
        },
        source_document_id: row.source_document_id,
        transaction_id: row.transaction_id,
        pdf_attachment_id: row.pdf_attachment_id,
        issued_at: row.issued_at,
        canceled_at: row.canceled_at,
        sends: sends_of(conn, row.id)?,
    })
}

pub fn get(conn: &Connection, id: i64) -> AppResult<Document> {
    let row = conn
        .query_row(&format!("{SELECT} WHERE id = ?1"), [id], read_row)
        .optional()?
        .ok_or(AppError::new(ErrorCode::NotFound))?;
    build(conn, row, &today(conn)?)
}

/// 書類の一覧。新しい順。`kind` を渡すとその種類だけ。
pub fn list(conn: &Connection, kind: Option<DocumentKind>) -> AppResult<Vec<Document>> {
    let today = today(conn)?;
    let mut stmt = conn.prepare(&format!(
        "{SELECT} WHERE ?1 IS NULL OR kind = ?1 ORDER BY issue_date DESC, id DESC"
    ))?;
    let rows: Vec<Row> = stmt
        .query_map([kind], read_row)?
        .collect::<Result<_, _>>()?;
    rows.into_iter().map(|r| build(conn, r, &today)).collect()
}

/// 発行済みの書類から、カレンダーに必要な番号（内部ID）と期限だけを取り出す。
pub fn upcoming_dates(
    conn: &Connection,
    kind: DocumentKind,
    today: &str,
) -> AppResult<Vec<(i64, String)>> {
    let mut stmt = conn.prepare(
        "SELECT id, due_date, issue_date, tax_mode FROM documents AS d
         WHERE kind = ?1 AND due_date >= ?2 AND status IN ('issued', 'sent')
           AND (?1 != 'estimate' OR NOT EXISTS (
                SELECT 1 FROM documents AS invoice WHERE invoice.source_document_id = d.id
                    AND invoice.kind = 'invoice' AND invoice.status IN ('issued', 'sent', 'paid')
           ))
         ORDER BY id",
    )?;
    let rows = stmt.query_map(params![kind, today], |row| {
        Ok((
            row.get::<_, i64>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
            row.get::<_, Option<TaxMode>>(3)?,
        ))
    })?;
    let mut due = Vec::new();
    for row in rows {
        let (id, date, issue_date, tax_mode) = row?;
        if kind == DocumentKind::Invoice {
            let mode = match tax_mode {
                Some(mode) => mode,
                None => tax_mode_for(conn, &issue_date)?,
            };
            if paid_of(conn, id)? >= doc::totals(&lines_of(conn, id)?, mode).total {
                continue;
            }
        }
        due.push((id, date));
    }
    Ok(due)
}

fn write_lines(conn: &Connection, id: i64, lines: &[LineInput]) -> AppResult<()> {
    conn.execute("DELETE FROM document_lines WHERE document_id = ?1", [id])?;
    let mut insert = conn.prepare_cached(
        "INSERT INTO document_lines (document_id, line_no, name, quantity, unit, unit_price, tax_rate)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
    )?;
    for (i, l) in lines.iter().enumerate() {
        insert.execute(params![
            id,
            i as i64 + 1,
            l.name,
            l.quantity,
            l.unit,
            l.unit_price,
            l.tax_rate
        ])?;
    }
    Ok(())
}

fn insert_draft(
    conn: &Connection,
    kind: DocumentKind,
    v: &Valid,
    source: Option<i64>,
) -> AppResult<i64> {
    conn.execute(
        "INSERT INTO documents (kind, partner_id, recipient_name, recipient_address, recipient_email,
                                issue_date, due_date, title, notes, source_document_id)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
        params![
            kind,
            v.partner_id,
            v.recipient_name,
            v.recipient_address,
            v.recipient_email,
            v.issue_date,
            v.due_date,
            v.title,
            v.notes,
            source
        ],
    )?;
    let id = conn.last_insert_rowid();
    write_lines(conn, id, &v.lines)?;
    Ok(id)
}

/// 下書きを作る（呼び出し側の DB トランザクションの中で）。定期売上からまとめて作るときに使う。
pub(crate) fn create_in(conn: &Connection, input: &DocumentInput) -> AppResult<i64> {
    let v = validate(conn, input)?;
    insert_draft(conn, input.kind, &v, None)
}

/// 下書きを作る。
pub fn create(db: &Database, input: &DocumentInput) -> AppResult<Document> {
    db.transaction(|tx| {
        let v = validate(tx, input)?;
        let id = insert_draft(tx, input.kind, &v, None)?;
        get(tx, id)
    })
}

fn ensure_draft(d: &Document) -> AppResult<()> {
    if d.status != DocumentStatus::Draft {
        return Err(AppError::new(ErrorCode::DocumentIssued));
    }
    Ok(())
}

/// 下書きを直す。発行した書類は直せない（取り消して作り直す）。種類は変えない。
pub fn update(db: &Database, id: i64, input: &DocumentInput) -> AppResult<Document> {
    db.transaction(|tx| {
        ensure_draft(&get(tx, id)?)?;
        let v = validate(tx, input)?;
        tx.execute(
            "UPDATE documents SET partner_id = ?2, recipient_name = ?3, recipient_address = ?4,
                    recipient_email = ?5, issue_date = ?6, due_date = ?7, title = ?8, notes = ?9,
                    updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
             WHERE id = ?1",
            params![
                id,
                v.partner_id,
                v.recipient_name,
                v.recipient_address,
                v.recipient_email,
                v.issue_date,
                v.due_date,
                v.title,
                v.notes
            ],
        )?;
        write_lines(tx, id, &v.lines)?;
        get(tx, id)
    })
}

/// 下書きを消す。発行した書類は消さない（取り消す）。
pub fn delete(db: &Database, id: i64) -> AppResult<()> {
    db.transaction(|tx| {
        ensure_draft(&get(tx, id)?)?;
        tx.execute("DELETE FROM documents WHERE id = ?1", [id])?;
        Ok(())
    })
}

/// 下書きの書類を、発行したときの姿で見る（PDF とプレビューに使う。番号は仮）。
pub fn preview(
    conn: &Connection,
    kind: DocumentKind,
    input: &DocumentInput,
) -> AppResult<Document> {
    let v = validate(conn, input)?;
    let tax_mode = tax_mode_for(conn, &v.issue_date)?;
    let totals = doc::totals(&v.lines, tax_mode);
    Ok(Document {
        id: 0,
        kind,
        number: None,
        status: DocumentStatus::Draft,
        display_status: DisplayStatus::Draft,
        partner_id: v.partner_id,
        recipient_name: v.recipient_name,
        recipient_address: v.recipient_address,
        recipient_email: v.recipient_email,
        issue_date: v.issue_date,
        due_date: v.due_date,
        title: v.title,
        notes: v.notes,
        issuer: current_issuer(conn, tax_mode)?,
        tax_mode,
        lines: v.lines,
        totals,
        paid: 0,
        last_payment_account_id: None,
        source_document_id: None,
        transaction_id: None,
        pdf_attachment_id: None,
        issued_at: None,
        canceled_at: None,
        sends: Vec::new(),
    })
}

/// 発行する。番号を付け、自分の情報と様式を書類に残し、`render` で作った PDF の控えを保存する。
/// 宛名がなければ発行しない。
pub fn issue(
    db: &Database,
    id: i64,
    render: &dyn Fn(&Connection, &Document) -> AppResult<Vec<u8>>,
) -> AppResult<Document> {
    db.transaction(|tx| {
        let draft = get(tx, id)?;
        ensure_draft(&draft)?;
        if draft.recipient_name.is_empty() {
            return Err(AppError::field(ErrorCode::Required, "recipientName"));
        }
        let year = journal::parse_date(&draft.issue_date)
            .map(|(y, _, _)| y)
            .ok_or(AppError::field(ErrorCode::InvalidFormat, "issueDate"))?;
        let seq: i64 = tx.query_row(
            "SELECT coalesce(max(number_seq), 0) + 1 FROM documents WHERE kind = ?1 AND number_year = ?2",
            params![draft.kind, year],
            |r| r.get(0),
        )?;
        let number = doc::number(draft.kind, year, seq);
        let issuer_json =
            serde_json::to_string(&draft.issuer).map_err(|_| AppError::new(ErrorCode::Database))?;
        tx.execute(
            "UPDATE documents SET status = 'issued', number = ?2, number_year = ?3, number_seq = ?4,
                    tax_mode = ?5, issuer_json = ?6, issued_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now'),
                    updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
             WHERE id = ?1",
            params![id, number, year, seq, draft.tax_mode, issuer_json],
        )?;
        let issued = get(tx, id)?;
        let pdf = render(tx, &issued)?;
        let (attachment, _) = attachments::add(tx, &format!("{number}.pdf"), &pdf)?;
        tx.execute(
            "UPDATE documents SET pdf_attachment_id = ?2 WHERE id = ?1",
            params![id, attachment.id],
        )?;
        audit::event(
            tx,
            "document",
            "issue",
            Some(year),
            Some(serde_json::json!({ "id": id, "number": number })),
        )?;
        get(tx, id)
    })
}

/// 取り消す。入金があれば取り消せない（入金の取引を先に消す）。売上の仕訳があれば一緒に消す
/// （締めた月なら消せないので、取り消しもしない）。
pub fn cancel(db: &Database, id: i64) -> AppResult<Document> {
    db.transaction(|tx| {
        let d = get(tx, id)?;
        if d.status == DocumentStatus::Draft || d.status == DocumentStatus::Canceled {
            return Err(AppError::field(ErrorCode::InvalidFormat, "status"));
        }
        if d.paid > 0 {
            return Err(AppError::new(ErrorCode::HasPayments));
        }
        if let Some(t) = d.transaction_id {
            transactions::remove(tx, t)?;
        }
        tx.execute(
            "UPDATE documents SET status = 'canceled', canceled_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
             WHERE id = ?1",
            [id],
        )?;
        audit::event(
            tx,
            "document",
            "cancel",
            None,
            Some(serde_json::json!({ "id": id, "number": d.number })),
        )?;
        get(tx, id)
    })
}

/// 書類から別の書類（見積書 → 請求書、請求書 → 納品書・領収書）の下書きを作る。宛先と明細を写す。
/// 取り消した書類からも作れる（作り直し）。同じ種類なら作り直しとして写す。
pub fn copy_as(db: &Database, id: i64, kind: DocumentKind) -> AppResult<Document> {
    db.transaction(|tx| {
        let d = get(tx, id)?;
        if d.kind != kind && !d.kind.can_convert_to(kind) {
            return Err(AppError::field(ErrorCode::InvalidFormat, "kind"));
        }
        let issue_date = today(tx)?;
        let due_date = if kind == DocumentKind::Invoice {
            let days = settings(tx)?.due_days;
            Some(tx.query_row(
                "SELECT date(?1, ?2)",
                params![issue_date, format!("+{days} days")],
                |r| r.get::<_, String>(0),
            )?)
        } else {
            None
        };
        let v = Valid {
            partner_id: d.partner_id,
            recipient_name: d.recipient_name,
            recipient_address: d.recipient_address,
            recipient_email: d.recipient_email,
            issue_date,
            due_date,
            title: d.title,
            notes: d.notes,
            lines: d.lines,
        };
        let new_id = insert_draft(tx, kind, &v, Some(id))?;
        get(tx, new_id)
    })
}

/// 送った記録を残す。発行済みなら送信済みにする。宛先と件名は記録に残すが、変更履歴には入れない。
pub fn record_send(
    conn: &Connection,
    id: i64,
    method: &str,
    to: &str,
    subject: &str,
) -> AppResult<Document> {
    let d = get(conn, id)?;
    if d.status == DocumentStatus::Draft || d.status == DocumentStatus::Canceled {
        return Err(AppError::field(ErrorCode::InvalidFormat, "status"));
    }
    conn.execute(
        "INSERT INTO document_sends (document_id, method, to_address, subject) VALUES (?1, ?2, ?3, ?4)",
        params![id, method, to, subject],
    )?;
    conn.execute(
        "UPDATE documents SET status = 'sent' WHERE id = ?1 AND status = 'issued'",
        [id],
    )?;
    audit::event(
        conn,
        "document",
        "send",
        None,
        Some(serde_json::json!({ "id": id, "method": method })),
    )?;
    get(conn, id)
}

fn sales_category(rate: i64) -> TaxCategory {
    match rate {
        10 => TaxCategory::TaxableSales10,
        8 => TaxCategory::TaxableSales8,
        _ => TaxCategory::OutOfScope,
    }
}

/// 請求書の売上の仕訳の候補。「売掛金 / 売上」を税率ごとに分け、取引先を付ける。日付は発行日。
pub fn sale_proposal(conn: &Connection, id: i64) -> AppResult<TransactionInput> {
    let d = get(conn, id)?;
    if d.kind != DocumentKind::Invoice
        || matches!(d.status, DocumentStatus::Draft | DocumentStatus::Canceled)
    {
        return Err(AppError::field(ErrorCode::InvalidFormat, "status"));
    }
    if d.transaction_id.is_some() {
        return Err(AppError::new(ErrorCode::AlreadyRecorded));
    }
    if d.totals.total <= 0 {
        return Err(AppError::field(ErrorCode::OutOfRange, "amount"));
    }
    let receivable = closing::account_by_line(conn, "bs.accounts_receivable")?;
    let sales = closing::account_by_line(conn, "pl.sales")?;
    let mut lines = vec![journal::LineInput {
        partner_id: d.partner_id,
        ..journal::LineInput::new(Side::Debit, receivable, d.totals.total)
    }];
    if transactions::date_is_exempt(conn, &d.issue_date)? {
        lines.push(journal::LineInput {
            partner_id: d.partner_id,
            ..journal::LineInput::new(Side::Credit, sales, d.totals.total)
        });
    } else {
        for r in &d.totals.by_rate {
            let amount = r.base + r.tax;
            if amount == 0 {
                continue;
            }
            let side = if amount > 0 {
                Side::Credit
            } else {
                Side::Debit
            };
            lines.push(journal::LineInput {
                partner_id: d.partner_id,
                tax_category: Some(sales_category(r.rate)),
                ..journal::LineInput::new(side, sales, amount.abs())
            });
        }
    }
    Ok(TransactionInput {
        date: d.issue_date.clone(),
        entry_mode: EntryMode::Grid,
        memo: format!("請求書 {}", d.number.unwrap_or_default()),
        lines,
    })
}

/// 売上の仕訳を記帳する（候補を利用者が確かめてから）。
pub fn post_sale(db: &Database, id: i64) -> AppResult<Document> {
    db.transaction(|tx| {
        let input = sale_proposal(tx, id)?;
        let year = journal::parse_date(&input.date)
            .map(|(y, _, _)| y)
            .ok_or(AppError::field(ErrorCode::InvalidFormat, "date"))?;
        let t = transactions::insert_kind(tx, year, &input, TransactionKind::Normal)?;
        tx.execute(
            "UPDATE documents SET transaction_id = ?2 WHERE id = ?1",
            params![id, t.id],
        )?;
        get(tx, id)
    })
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PaymentInput {
    pub date: String,
    pub amount: i64,
    /// 入金した口座（預金・現金）
    pub account_id: i64,
    /// 口座の補助科目（明細の取込先が補助科目を持つとき）
    #[serde(default)]
    pub sub_account_id: Option<i64>,
}

/// 請求書の入金を記帳する（呼び出し側の DB トランザクションの中で）。「口座 / 売掛金」。
/// 売上をまだ記帳していなければ先に記帳してもらう。残りの額より多くは入れない。
/// かんたん入力・受信箱から入金を記録するときも、これを使う。
pub(crate) fn record_payment_in(
    conn: &Connection,
    id: i64,
    input: &PaymentInput,
    entry_mode: EntryMode,
) -> AppResult<Transaction> {
    let d = get(conn, id)?;
    if d.kind != DocumentKind::Invoice
        || matches!(d.status, DocumentStatus::Draft | DocumentStatus::Canceled)
    {
        return Err(AppError::field(ErrorCode::InvalidFormat, "status"));
    }
    if d.transaction_id.is_none() {
        return Err(AppError::new(ErrorCode::SaleNotRecorded));
    }
    let remaining = d.totals.total - d.paid;
    if input.amount <= 0 || input.amount > remaining {
        return Err(AppError::field(ErrorCode::OutOfRange, "amount"));
    }
    transactions::ensure_payment_account(conn, input.account_id, "accountId")?;
    let receivable = closing::account_by_line(conn, "bs.accounts_receivable")?;
    let year = journal::parse_date(input.date.trim())
        .map(|(y, _, _)| y)
        .ok_or(AppError::field(ErrorCode::InvalidFormat, "date"))?;
    let t = transactions::insert_kind(
        conn,
        year,
        &TransactionInput {
            date: input.date.trim().to_string(),
            entry_mode,
            memo: format!("入金 {}", d.number.clone().unwrap_or_default()),
            lines: vec![
                journal::LineInput {
                    partner_id: d.partner_id,
                    sub_account_id: input.sub_account_id,
                    ..journal::LineInput::new(Side::Debit, input.account_id, input.amount)
                },
                journal::LineInput {
                    partner_id: d.partner_id,
                    ..journal::LineInput::new(Side::Credit, receivable, input.amount)
                },
            ],
        },
        TransactionKind::Normal,
    )?;
    conn.execute(
        "INSERT INTO document_payments (document_id, transaction_id, amount) VALUES (?1, ?2, ?3)",
        params![id, t.id, input.amount],
    )?;
    Ok(t)
}

/// 仕訳の金額を訂正したときも、請求額の範囲で入金の記録をそろえる。
pub(crate) fn update_payment_amount(
    conn: &Connection,
    transaction_id: i64,
    amount: i64,
) -> AppResult<()> {
    let Some((id, previous)) = conn
        .query_row(
            "SELECT document_id, amount FROM document_payments WHERE transaction_id = ?1",
            [transaction_id],
            |row| Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?)),
        )
        .optional()?
    else {
        return Ok(());
    };
    let document = get(conn, id)?;
    if amount > document.totals.total - (document.paid - previous) {
        return Err(AppError::field(ErrorCode::OutOfRange, "amount"));
    }
    conn.execute(
        "UPDATE document_payments SET amount = ?2 WHERE transaction_id = ?1",
        params![transaction_id, amount],
    )?;
    Ok(())
}

/// 請求書の画面から入金を記帳する。
pub fn record_payment(db: &Database, id: i64, input: &PaymentInput) -> AppResult<Document> {
    db.transaction(|tx| {
        record_payment_in(tx, id, input, EntryMode::Simple)?;
        get(tx, id)
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::setup::tests::set_up_db;
    use crate::db::transactions::tests::account;

    fn line(name: &str, quantity: i64, unit_price: i64, tax_rate: i64) -> LineInput {
        LineInput {
            name: name.into(),
            quantity,
            unit: String::new(),
            unit_price,
            tax_rate,
        }
    }

    fn input(kind: DocumentKind) -> DocumentInput {
        DocumentInput {
            kind,
            partner_id: None,
            recipient_name: "株式会社テスト".into(),
            recipient_address: String::new(),
            recipient_email: "billing@example.com".into(),
            issue_date: "2026-03-01".into(),
            due_date: Some("2099-12-31".into()),
            title: "3 月分".into(),
            notes: String::new(),
            lines: vec![
                line("レッスン", 400, 5_000, 10),
                line("教材", 100, 1_080, 8),
            ],
        }
    }

    fn fake_pdf(_: &Connection, d: &Document) -> AppResult<Vec<u8>> {
        Ok(format!("%PDF-fake {}", d.number.clone().unwrap_or_default()).into_bytes())
    }

    /// 課税の年度にして、登録番号を入れる。
    fn make_taxable(db: &Database) {
        let conn = db.conn();
        conn.execute("UPDATE fiscal_years SET tax_status = 'standard'", [])
            .unwrap();
        conn.execute(
            "UPDATE business_profile SET invoice_registration_no = 'T1234567890123'",
            [],
        )
        .unwrap();
    }

    #[test]
    fn drafts_follow_the_years_tax_status() {
        let db = set_up_db();
        // 免税の年度: 登録番号なし、消費税なし
        let d = create(&db, &input(DocumentKind::Invoice)).unwrap();
        assert_eq!(d.tax_mode, TaxMode::Simple);
        assert_eq!(d.issuer.registration_no, None);
        assert_eq!(
            (d.totals.subtotal, d.totals.tax, d.totals.total),
            (21_080, 0, 21_080)
        );
        assert_eq!(d.status, DocumentStatus::Draft);
        assert_eq!(d.number, None);

        make_taxable(&db);
        let d = get(&db.conn(), d.id).unwrap();
        assert_eq!(d.tax_mode, TaxMode::Qualified);
        assert_eq!(d.issuer.registration_no.as_deref(), Some("T1234567890123"));
        // 10%: 20,000 → 2,000、8%: 1,080 → 86（86.4 を切り捨て）
        assert_eq!((d.totals.tax, d.totals.total), (2_086, 23_166));
    }

    #[test]
    fn issuing_numbers_freezes_and_stores_a_copy() {
        let db = set_up_db();
        make_taxable(&db);
        let a = create(&db, &input(DocumentKind::Invoice)).unwrap();
        let b = create(&db, &input(DocumentKind::Invoice)).unwrap();
        let est = create(&db, &input(DocumentKind::Estimate)).unwrap();
        let a = issue(&db, a.id, &fake_pdf).unwrap();
        let b = issue(&db, b.id, &fake_pdf).unwrap();
        let est = issue(&db, est.id, &fake_pdf).unwrap();
        assert_eq!(a.number.as_deref(), Some("INV-2026-0001"));
        assert_eq!(b.number.as_deref(), Some("INV-2026-0002"));
        assert_eq!(est.number.as_deref(), Some("EST-2026-0001"));
        assert_eq!(a.status, DocumentStatus::Issued);
        let (_, pdf) = attachments::content(&db.conn(), a.pdf_attachment_id.unwrap()).unwrap();
        assert_eq!(pdf, b"%PDF-fake INV-2026-0001");

        // 発行した書類は直せない・消せない
        assert_eq!(
            update(&db, a.id, &input(DocumentKind::Invoice))
                .unwrap_err()
                .code,
            ErrorCode::DocumentIssued
        );
        assert_eq!(
            delete(&db, a.id).unwrap_err().code,
            ErrorCode::DocumentIssued
        );
        // 事業者情報を変えても、発行した書類の自分の情報は変わらない
        db.conn()
            .execute("UPDATE business_profile SET trade_name = '新しい屋号'", [])
            .unwrap();
        assert_ne!(
            get(&db.conn(), a.id).unwrap().issuer.trade_name,
            "新しい屋号"
        );
        assert_eq!(
            create(&db, &input(DocumentKind::Invoice))
                .unwrap()
                .issuer
                .trade_name,
            "新しい屋号"
        );
    }

    #[test]
    fn issuing_needs_a_recipient() {
        let db = set_up_db();
        let mut i = input(DocumentKind::Invoice);
        i.recipient_name = String::new();
        let d = create(&db, &i).unwrap();
        assert_eq!(
            issue(&db, d.id, &fake_pdf).unwrap_err(),
            AppError::field(ErrorCode::Required, "recipientName")
        );
        assert_eq!(get(&db.conn(), d.id).unwrap().status, DocumentStatus::Draft);
    }

    #[test]
    fn sale_and_payments_flow_into_the_books() {
        let db = set_up_db();
        make_taxable(&db);
        let d = create(&db, &input(DocumentKind::Invoice)).unwrap();
        let d = issue(&db, d.id, &fake_pdf).unwrap();
        let (receivable, sales, bank) = {
            let conn = db.conn();
            (
                account(&conn, "106"),
                account(&conn, "401"),
                account(&conn, "104"),
            )
        };

        // 売上を記帳する前は、入金を記録できない
        let pay = |amount| PaymentInput {
            date: "2026-03-20".into(),
            amount,
            account_id: bank,
            sub_account_id: None,
        };
        assert_eq!(
            record_payment(&db, d.id, &pay(1_000)).unwrap_err().code,
            ErrorCode::SaleNotRecorded
        );

        let proposal = sale_proposal(&db.conn(), d.id).unwrap();
        let summary: Vec<(Side, i64, i64, Option<TaxCategory>)> = proposal
            .lines
            .iter()
            .map(|l| (l.side, l.account_id, l.amount, l.tax_category))
            .collect();
        assert_eq!(
            summary,
            [
                (Side::Debit, receivable, 23_166, None),
                (
                    Side::Credit,
                    sales,
                    22_000,
                    Some(TaxCategory::TaxableSales10)
                ),
                (Side::Credit, sales, 1_166, Some(TaxCategory::TaxableSales8)),
            ]
        );
        let d = post_sale(&db, d.id).unwrap();
        assert!(d.transaction_id.is_some());
        assert_eq!(
            post_sale(&db, d.id).unwrap_err().code,
            ErrorCode::AlreadyRecorded
        );

        let invoice_dates =
            || upcoming_dates(&db.conn(), DocumentKind::Invoice, "2026-03-01").unwrap();
        assert_eq!(invoice_dates(), [(d.id, "2099-12-31".into())]);

        // 一部入金 → 残りより多くは入れられない → 残りを入金して入金済み
        assert_eq!(d.last_payment_account_id, None);
        let d = record_payment(&db, d.id, &pay(10_000)).unwrap();
        assert_eq!(d.last_payment_account_id, Some(bank));
        assert_eq!(invoice_dates(), [(d.id, "2099-12-31".into())]);
        assert_eq!(
            (d.paid, d.display_status),
            (10_000, DisplayStatus::PartlyPaid)
        );
        assert_eq!(
            record_payment(&db, d.id, &pay(13_167)).unwrap_err(),
            AppError::field(ErrorCode::OutOfRange, "amount")
        );
        let d = record_payment(&db, d.id, &pay(13_166)).unwrap();
        assert_eq!(d.display_status, DisplayStatus::Paid);
        assert!(invoice_dates().is_empty());

        // 売掛金は 0 に戻り、売上は税込みの合計
        let tb = crate::db::reports::trial_balance(&db.conn(), 2026, 1, 12).unwrap();
        let balance = |id| {
            tb.rows
                .iter()
                .find(|r| r.account_id == id)
                .map(|r| r.balance)
        };
        assert_eq!(balance(receivable), Some(0));
        assert_eq!(balance(sales), Some(23_166));
        assert_eq!(balance(bank), Some(23_166));

        // 入金があるうちは取り消せない
        assert_eq!(cancel(&db, d.id).unwrap_err().code, ErrorCode::HasPayments);
    }

    #[test]
    fn deleting_the_payment_transaction_reopens_the_invoice() {
        let db = set_up_db();
        let d = create(&db, &input(DocumentKind::Invoice)).unwrap();
        issue(&db, d.id, &fake_pdf).unwrap();
        post_sale(&db, d.id).unwrap();
        let bank = account(&db.conn(), "104");
        let paid = record_payment(
            &db,
            d.id,
            &PaymentInput {
                date: "2026-03-20".into(),
                amount: 21_080,
                account_id: bank,
                sub_account_id: None,
            },
        )
        .unwrap();
        assert_eq!(paid.display_status, DisplayStatus::Paid);
        let payment_tx: i64 = db
            .conn()
            .query_row("SELECT transaction_id FROM document_payments", [], |r| {
                r.get(0)
            })
            .unwrap();
        transactions::delete(&db, payment_tx).unwrap();
        assert_eq!(get(&db.conn(), d.id).unwrap().paid, 0);
    }

    #[test]
    fn canceling_removes_the_sale_and_keeps_the_copy() {
        let db = set_up_db();
        let d = create(&db, &input(DocumentKind::Invoice)).unwrap();
        issue(&db, d.id, &fake_pdf).unwrap();
        let posted = post_sale(&db, d.id).unwrap();
        let t = posted.transaction_id.unwrap();
        let canceled = cancel(&db, d.id).unwrap();
        assert_eq!(canceled.display_status, DisplayStatus::Canceled);
        assert!(canceled.pdf_attachment_id.is_some());
        assert_eq!(canceled.transaction_id, None);
        assert!(transactions::get(&db.conn(), t).is_err());
        // 作り直し: 同じ内容の下書きができ、番号は次の番号になる
        let again = copy_as(&db, d.id, DocumentKind::Invoice).unwrap();
        assert_eq!(again.status, DocumentStatus::Draft);
        assert_eq!(again.lines, canceled.lines);
        assert_eq!(
            issue(&db, again.id, &fake_pdf).unwrap().number.as_deref(),
            Some("INV-2026-0002")
        );
    }

    #[test]
    fn locked_months_block_the_sale_and_the_cancel() {
        let db = set_up_db();
        let d = create(&db, &input(DocumentKind::Invoice)).unwrap();
        issue(&db, d.id, &fake_pdf).unwrap();
        crate::db::locks::set_month(&db, 2026, 3, true).unwrap();
        assert_eq!(
            post_sale(&db, d.id).unwrap_err().code,
            ErrorCode::MonthLocked
        );
        crate::db::locks::set_month(&db, 2026, 3, false).unwrap();
        post_sale(&db, d.id).unwrap();
        crate::db::locks::set_month(&db, 2026, 3, true).unwrap();
        assert_eq!(cancel(&db, d.id).unwrap_err().code, ErrorCode::MonthLocked);
        assert_eq!(
            get(&db.conn(), d.id).unwrap().status,
            DocumentStatus::Issued
        );
    }

    #[test]
    fn conversions_copy_recipient_and_lines() {
        let db = set_up_db();
        let est = create(&db, &input(DocumentKind::Estimate)).unwrap();
        let inv = copy_as(&db, est.id, DocumentKind::Invoice).unwrap();
        assert_eq!(inv.kind, DocumentKind::Invoice);
        assert_eq!(inv.source_document_id, Some(est.id));
        assert_eq!(inv.recipient_name, est.recipient_name);
        assert!(inv.due_date.is_some());
        assert_eq!(
            copy_as(&db, est.id, DocumentKind::Receipt).unwrap_err(),
            AppError::field(ErrorCode::InvalidFormat, "kind")
        );
    }

    #[test]
    fn estimate_expiration_is_removed_when_its_invoice_is_issued() {
        let db = set_up_db();
        let estimate = create(&db, &input(DocumentKind::Estimate)).unwrap();
        let dates = || upcoming_dates(&db.conn(), DocumentKind::Estimate, "2026-03-01").unwrap();
        assert!(dates().is_empty());
        issue(&db, estimate.id, &fake_pdf).unwrap();
        let invoice = copy_as(&db, estimate.id, DocumentKind::Invoice).unwrap();
        assert_eq!(dates(), [(estimate.id, "2099-12-31".into())]);

        // copy_as uses today's issue date, so restore the year that was set up for the test.
        let invoice = update(&db, invoice.id, &input(DocumentKind::Invoice)).unwrap();
        issue(&db, invoice.id, &fake_pdf).unwrap();
        assert!(dates().is_empty());
        cancel(&db, invoice.id).unwrap();
        assert_eq!(dates(), [(estimate.id, "2099-12-31".into())]);
    }

    #[test]
    fn sending_marks_the_document_sent() {
        let db = set_up_db();
        let d = create(&db, &input(DocumentKind::Invoice)).unwrap();
        assert!(record_send(&db.conn(), d.id, "smtp", "a@example.com", "件名").is_err());
        issue(&db, d.id, &fake_pdf).unwrap();
        let d = record_send(&db.conn(), d.id, "mail_app", "a@example.com", "件名").unwrap();
        assert_eq!(d.status, DocumentStatus::Sent);
        assert_eq!(d.sends.len(), 1);
        // 履歴に宛先は残さない
        let history: String = db
            .conn()
            .query_row(
                "SELECT after_json FROM audit_logs WHERE action = 'send'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert!(!history.contains("example.com"));
    }

    #[test]
    fn settings_round_trip_and_validate() {
        let db = set_up_db();
        let conn = db.conn();
        assert_eq!(settings(&conn).unwrap().due_days, 30);
        let mut s = DocumentSettings {
            bank_account: "テスト銀行 普通 1234567".into(),
            ..Default::default()
        };
        assert_eq!(
            save_settings(&conn, &s).unwrap().bank_account,
            s.bank_account
        );
        s.email = "not-an-email".into();
        assert_eq!(
            save_settings(&conn, &s).unwrap_err(),
            AppError::field(ErrorCode::InvalidFormat, "email")
        );

        let mail = MailSettings {
            from_address: "me@example.com".into(),
            from_name: "テスト教室".into(),
            host: "SMTP.Example.com".into(),
            port: 587,
            security: "starttls".into(),
            username: String::new(),
        };
        let saved = save_mail_settings(&conn, &mail).unwrap();
        assert_eq!(
            (saved.host.as_str(), saved.username.as_str()),
            ("smtp.example.com", "me@example.com")
        );
        assert_eq!(mail_settings(&conn).unwrap(), Some(saved));
    }
}
