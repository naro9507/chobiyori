//! 請求書・見積書・納品書・領収書のコマンド（F11）。
//!
//! PDF・メール・ファイルの保存はすべて Rust 側で行う。メールのパスワードは OS の資格情報ストアに置き、
//! 画面には「登録済みかどうか」だけを返す。メールソフトとフォルダは Rust 側から開く
//! （画面に開く権限は渡さない）。

use super::files;
use crate::db::documents::{
    self, Document, DocumentInput, DocumentSettings, MailSettings, PaymentInput,
};
use crate::db::{attachments, setup, Database};
use crate::domain::document::{self as doc, DocumentKind, DocumentStatus};
use crate::domain::journal::{Side, TransactionInput};
use crate::domain::master::TaxCategory;
use crate::error::{AppError, AppResult, ErrorCode};
use crate::export::document::{self as layout, Images, Page};
use crate::export::labels::amount as yen;
use crate::export::pdf::find_font;
use crate::mail::{self, MailSender, OutgoingMail, Smtp};
use crate::receipt::secret::{KeyringItem, SecretStore, SMTP_PASSWORD};
use base64::Engine;
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, State};

fn password_store() -> KeyringItem<'static> {
    KeyringItem(SMTP_PASSWORD)
}

/// ロゴと印影の画像を読む。
fn images(conn: &Connection) -> AppResult<Images> {
    let s = documents::settings(conn)?;
    let read = |id: Option<i64>| -> AppResult<Option<(Vec<u8>, String)>> {
        match id {
            None => Ok(None),
            Some(id) => match attachments::content(conn, id) {
                Ok((a, bytes)) => Ok(Some((bytes, a.mime))),
                Err(_) => Ok(None),
            },
        }
    };
    Ok(Images {
        logo: read(s.logo_attachment_id)?,
        seal: read(s.seal_attachment_id)?,
    })
}

fn render_pdf(conn: &Connection, d: &Document) -> AppResult<Vec<u8>> {
    layout::render(d, &find_font()?, &images(conn)?)
}

#[tauri::command]
pub async fn list_documents(
    db: State<'_, Database>,
    kind: Option<DocumentKind>,
) -> AppResult<Vec<Document>> {
    documents::list(&db.conn(), kind)
}

#[tauri::command]
pub async fn get_document(db: State<'_, Database>, id: i64) -> AppResult<Document> {
    documents::get(&db.conn(), id)
}

#[tauri::command]
pub async fn create_document(db: State<'_, Database>, input: DocumentInput) -> AppResult<Document> {
    documents::create(&db, &input)
}

#[tauri::command]
pub async fn update_document(
    db: State<'_, Database>,
    id: i64,
    input: DocumentInput,
) -> AppResult<Document> {
    documents::update(&db, id, &input)
}

#[tauri::command]
pub async fn delete_document(db: State<'_, Database>, id: i64) -> AppResult<()> {
    documents::delete(&db, id)
}

/// 新しく作るときの初期値（発行日・支払期限・備考）。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NewDocumentDefaults {
    pub issue_date: String,
    pub due_date: Option<String>,
    pub notes: String,
}

/// 発行日の様式（適格請求書か、登録番号なしか）。登録番号なしの様式は消費税を足さない。
#[tauri::command]
pub async fn document_tax_mode(
    db: State<'_, Database>,
    issue_date: String,
) -> AppResult<doc::TaxMode> {
    documents::tax_mode_for(&db.conn(), &issue_date)
}

#[tauri::command]
pub async fn new_document_defaults(
    db: State<'_, Database>,
    kind: DocumentKind,
) -> AppResult<NewDocumentDefaults> {
    let conn = db.conn();
    let s = documents::settings(&conn)?;
    let issue_date: String = conn.query_row("SELECT date('now', 'localtime')", [], |r| r.get(0))?;
    let due_date = if kind == DocumentKind::Invoice {
        Some(conn.query_row(
            "SELECT date(?1, ?2)",
            rusqlite::params![issue_date, format!("+{} days", s.due_days)],
            |r| r.get(0),
        )?)
    } else {
        None
    };
    Ok(NewDocumentDefaults {
        issue_date,
        due_date,
        notes: if kind == DocumentKind::Invoice {
            s.default_notes
        } else {
            String::new()
        },
    })
}

/// プレビュー。紙面の図形と、ロゴ・印影の画像（data URL）。PDF と同じ配置になる。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Preview {
    pub pages: Vec<Page>,
    pub logo: Option<String>,
    pub seal: Option<String>,
}

fn data_url(image: &Option<(Vec<u8>, String)>) -> Option<String> {
    image.as_ref().map(|(bytes, mime)| {
        format!(
            "data:{mime};base64,{}",
            base64::engine::general_purpose::STANDARD.encode(bytes)
        )
    })
}

/// 書いている途中の書類（`input`）か、発行した書類（`id`）の紙面。
#[tauri::command]
pub async fn preview_document(
    db: State<'_, Database>,
    id: Option<i64>,
    input: Option<DocumentInput>,
) -> AppResult<Preview> {
    let conn = db.conn();
    let d = match (id, input) {
        (Some(id), _) => documents::get(&conn, id)?,
        (None, Some(input)) => documents::preview(&conn, input.kind, &input)?,
        (None, None) => return Err(AppError::field(ErrorCode::Required, "input")),
    };
    let images = images(&conn)?;
    Ok(Preview {
        pages: layout::pages(&d, &find_font()?, &images),
        logo: data_url(&images.logo),
        seal: data_url(&images.seal),
    })
}

#[tauri::command]
pub async fn issue_document(db: State<'_, Database>, id: i64) -> AppResult<Document> {
    documents::issue(&db, id, &render_pdf)
}

#[tauri::command]
pub async fn cancel_document(db: State<'_, Database>, id: i64) -> AppResult<Document> {
    documents::cancel(&db, id)
}

#[tauri::command]
pub async fn copy_document(
    db: State<'_, Database>,
    id: i64,
    kind: DocumentKind,
) -> AppResult<Document> {
    documents::copy_as(&db, id, kind)
}

/// 発行した書類の PDF（控え）。下書きはその場で作る（番号は仮）。
fn pdf_of(conn: &Connection, d: &Document) -> AppResult<Vec<u8>> {
    match d.pdf_attachment_id {
        Some(id) => Ok(attachments::content(conn, id)?.1),
        None => render_pdf(conn, d),
    }
}

fn file_name(d: &Document) -> String {
    let number = d.number.clone().unwrap_or_else(|| "下書き".into());
    format!("{}_{number}.pdf", layout::kind_name(d.kind))
}

/// PDF を保存する。保存先を選ばずにやめたら `None`。
#[tauri::command]
pub async fn save_document_pdf(
    app: AppHandle,
    db: State<'_, Database>,
    id: i64,
) -> AppResult<Option<String>> {
    let (name, bytes) = {
        let conn = db.conn();
        let d = documents::get(&conn, id)?;
        (file_name(&d), pdf_of(&conn, &d)?)
    };
    let Some(path) = files::save_path(app, name, ("PDF", "pdf")).await else {
        return Ok(None);
    };
    std::fs::write(&path, bytes).map_err(|_| AppError::new(ErrorCode::FileWrite))?;
    Ok(Some(files::file_name(&path)))
}

/// 売上の仕訳の候補（画面で確かめてから記帳する）。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProposalLine {
    pub side: Side,
    pub account_id: i64,
    pub amount: i64,
    pub tax_category: Option<TaxCategory>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SaleProposal {
    pub date: String,
    pub memo: String,
    pub lines: Vec<ProposalLine>,
}

impl From<TransactionInput> for SaleProposal {
    fn from(t: TransactionInput) -> Self {
        Self {
            date: t.date,
            memo: t.memo,
            lines: t
                .lines
                .into_iter()
                .map(|l| ProposalLine {
                    side: l.side,
                    account_id: l.account_id,
                    amount: l.amount,
                    tax_category: l.tax_category,
                })
                .collect(),
        }
    }
}

#[tauri::command]
pub async fn document_sale_proposal(db: State<'_, Database>, id: i64) -> AppResult<SaleProposal> {
    documents::sale_proposal(&db.conn(), id).map(Into::into)
}

#[tauri::command]
pub async fn post_document_sale(db: State<'_, Database>, id: i64) -> AppResult<Document> {
    documents::post_sale(&db, id)
}

#[tauri::command]
pub async fn record_document_payment(
    db: State<'_, Database>,
    id: i64,
    input: PaymentInput,
) -> AppResult<Document> {
    documents::record_payment(&db, id, &input)
}

#[tauri::command]
pub async fn document_settings(db: State<'_, Database>) -> AppResult<DocumentSettings> {
    documents::settings(&db.conn())
}

#[tauri::command]
pub async fn save_document_settings(
    db: State<'_, Database>,
    input: DocumentSettings,
) -> AppResult<DocumentSettings> {
    documents::save_settings(&db.conn(), &input)
}

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ImageRole {
    Logo,
    Seal,
}

/// ロゴか印影の画像（PNG・JPEG）を選んで登録する。やめたら今の設定のまま。
#[tauri::command]
pub async fn choose_document_image(
    app: AppHandle,
    db: State<'_, Database>,
    role: ImageRole,
) -> AppResult<DocumentSettings> {
    let picked = files::open_path(
        app,
        ("Image", &["png", "jpg", "jpeg", "PNG", "JPG", "JPEG"]),
    )
    .await;
    let Some(path) = picked else {
        return documents::settings(&db.conn());
    };
    let size = std::fs::metadata(&path)
        .map(|m| m.len())
        .unwrap_or(u64::MAX);
    if size > 2 * 1024 * 1024 {
        return Err(AppError::field(ErrorCode::OutOfRange, "image"));
    }
    let bytes = std::fs::read(&path).map_err(|_| AppError::new(ErrorCode::FileRead))?;
    let name = files::file_name(&path);
    db.transaction(|tx| {
        let (a, _) = attachments::add(tx, &name, &bytes)?;
        if a.mime != "image/png" && a.mime != "image/jpeg" {
            return Err(AppError::field(ErrorCode::InvalidFormat, "image"));
        }
        let mut s = documents::settings(tx)?;
        match role {
            ImageRole::Logo => s.logo_attachment_id = Some(a.id),
            ImageRole::Seal => s.seal_attachment_id = Some(a.id),
        }
        documents::save_settings(tx, &s)
    })
}

#[tauri::command]
pub async fn remove_document_image(
    db: State<'_, Database>,
    role: ImageRole,
) -> AppResult<DocumentSettings> {
    let conn = db.conn();
    let mut s = documents::settings(&conn)?;
    match role {
        ImageRole::Logo => s.logo_attachment_id = None,
        ImageRole::Seal => s.seal_attachment_id = None,
    }
    documents::save_settings(&conn, &s)
}

/// メールの送信の設定。パスワードは返さず、登録済みかどうかだけ。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MailStatus {
    pub settings: Option<MailSettings>,
    pub has_password: bool,
}

fn mail_status(conn: &Connection, store: &impl SecretStore) -> AppResult<MailStatus> {
    Ok(MailStatus {
        settings: documents::mail_settings(conn)?,
        has_password: store.get().ok().flatten().is_some(),
    })
}

#[tauri::command]
pub async fn mail_settings(db: State<'_, Database>) -> AppResult<MailStatus> {
    mail_status(&db.conn(), &password_store())
}

#[tauri::command]
pub async fn save_mail_settings(
    db: State<'_, Database>,
    input: MailSettings,
) -> AppResult<MailStatus> {
    let conn = db.conn();
    documents::save_mail_settings(&conn, &input)?;
    mail_status(&conn, &password_store())
}

/// パスワードを OS の資格情報ストアに入れる。パスワードは返さない。
#[tauri::command]
pub async fn set_mail_password(password: String) -> AppResult<()> {
    password_store().set(&mail::validate_password(&password)?)
}

#[tauri::command]
pub async fn delete_mail_password() -> AppResult<()> {
    password_store().delete()
}

/// メールの下書き（宛先・件名・本文）。書類の設定のひな形に、書類の値を差し込む。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MailDraft {
    pub to: String,
    pub subject: String,
    pub body: String,
}

fn mail_guidance(kind: DocumentKind) -> &'static str {
    match kind {
        DocumentKind::Invoice => "お手数をおかけいたしますが、ご請求内容をご確認のうえ、お支払いのお手続きをお願いいたします。",
        DocumentKind::Estimate => "お見積もりの内容をご確認のうえ、ご検討いただけますと幸いです。",
        DocumentKind::Delivery => "お手数ですが、納品内容をご確認くださいますようお願いいたします。",
        DocumentKind::Receipt => "このたびはお支払いいただき、誠にありがとうございます。領収書をお手元にて保管いただけますと幸いです。",
    }
}

#[tauri::command]
pub fn document_mail_guidance() -> [(DocumentKind, &'static str); 4] {
    [
        DocumentKind::Invoice,
        DocumentKind::Estimate,
        DocumentKind::Delivery,
        DocumentKind::Receipt,
    ]
    .map(|kind| (kind, mail_guidance(kind)))
}

fn mail_draft_of(conn: &Connection, d: &Document) -> AppResult<MailDraft> {
    let s = documents::settings(conn)?;
    let sender = {
        let p = setup::profile(conn)?;
        if p.trade_name.is_empty() {
            p.owner_name
        } else {
            format!("{} {}", p.trade_name, p.owner_name)
        }
    };
    let due = match (&d.due_date, d.kind) {
        (Some(due), DocumentKind::Invoice) => {
            format!("\nお支払期限は{}です。", layout::japanese_date(due))
        }
        _ => String::new(),
    };
    let guidance = mail_guidance(d.kind);
    let values = [
        ("書類", layout::kind_name(d.kind).to_string()),
        ("番号", d.number.clone().unwrap_or_default()),
        ("宛名", d.recipient_name.clone()),
        ("金額", yen(d.totals.total)),
        ("期限", due),
        ("書類別の一文", guidance.to_string()),
        ("ご案内", guidance.to_string()), // 以前のひな形でも展開する
        ("差出人", sender),
    ];
    Ok(MailDraft {
        to: d.recipient_email.clone(),
        subject: doc::fill_template(&s.mail_subject, &values)
            .lines()
            .collect::<Vec<_>>()
            .join(" "),
        body: doc::fill_template(&s.mail_body, &values),
    })
}

#[tauri::command]
pub async fn document_mail_draft(db: State<'_, Database>, id: i64) -> AppResult<MailDraft> {
    let conn = db.conn();
    let d = documents::get(&conn, id)?;
    mail_draft_of(&conn, &d)
}

/// メールを送る準備（宛先の確認、設定とパスワード、PDF の控え）。
fn prepare_mail(
    conn: &Connection,
    store: &impl SecretStore,
    id: i64,
    draft: &MailDraft,
) -> AppResult<(MailSettings, String, OutgoingMail)> {
    let d = documents::get(conn, id)?;
    if matches!(d.status, DocumentStatus::Draft | DocumentStatus::Canceled) {
        return Err(AppError::field(ErrorCode::InvalidFormat, "status"));
    }
    let to = doc::email(&draft.to, "to")?;
    if to.is_empty() {
        return Err(AppError::field(ErrorCode::Required, "to"));
    }
    let settings =
        documents::mail_settings(conn)?.ok_or(AppError::new(ErrorCode::MailNotConfigured))?;
    let password = store
        .get()?
        .ok_or(AppError::new(ErrorCode::MailNotConfigured))?;
    let mail = OutgoingMail {
        to,
        subject: doc::text(&draft.subject, 200, "subject")?,
        body: doc::text(&draft.body, 10_000, "body")?,
        attachment_name: file_name(&d),
        attachment: pdf_of(conn, &d)?,
    };
    Ok((settings, password, mail))
}

/// 送って、送った記録を残す。コマンドは送るところを別のスレッドで行うので、同じ手順をテストで確かめる。
#[cfg(test)]
fn send_and_record(
    db: &Database,
    store: &impl SecretStore,
    sender: &impl MailSender,
    id: i64,
    draft: &MailDraft,
) -> AppResult<Document> {
    let (settings, password, mail) = prepare_mail(&db.conn(), store, id, draft)?;
    sender.send(&settings, &password, &mail)?;
    documents::record_send(&db.conn(), id, "smtp", &mail.to, &mail.subject)
}

/// アプリからメールで送る。送れたら送信済みにする。
#[tauri::command]
pub async fn send_document_mail(
    db: State<'_, Database>,
    id: i64,
    draft: MailDraft,
) -> AppResult<Document> {
    let (settings, password, mail) = prepare_mail(&db.conn(), &password_store(), id, &draft)?;
    // つながるまで待つので、画面を止めないよう別のスレッドで送る
    let to_record = (mail.to.clone(), mail.subject.clone());
    tauri::async_runtime::spawn_blocking(move || Smtp.send(&settings, &password, &mail))
        .await
        .map_err(|_| AppError::new(ErrorCode::MailFailed))??;
    documents::record_send(&db.conn(), id, "smtp", &to_record.0, &to_record.1)
}

/// 予備: PDF を保存し、宛先・件名・本文を入れたメールソフトと、PDF のフォルダを開く。
/// 送ったことはアプリに分からないので、送ったら利用者が「送信済みにする」を押す。
#[tauri::command]
pub async fn open_document_in_mail_app(
    app: AppHandle,
    db: State<'_, Database>,
    id: i64,
    draft: MailDraft,
    target: Option<doc::MailTarget>,
) -> AppResult<Option<String>> {
    let (name, bytes) = {
        let conn = db.conn();
        let d = documents::get(&conn, id)?;
        if matches!(d.status, DocumentStatus::Draft | DocumentStatus::Canceled) {
            return Err(AppError::field(ErrorCode::InvalidFormat, "status"));
        }
        (file_name(&d), pdf_of(&conn, &d)?)
    };
    let to = doc::email(&draft.to, "to")?;
    let Some(path) = files::save_path(app, name, ("PDF", "pdf")).await else {
        return Ok(None);
    };
    std::fs::write(&path, bytes).map_err(|_| AppError::new(ErrorCode::FileWrite))?;
    let url = target
        .unwrap_or_default()
        .compose_url(&to, &draft.subject, &draft.body);
    tauri_plugin_opener::open_url(url, None::<&str>)
        .map_err(|_| AppError::new(ErrorCode::MailFailed))?;
    let _ = tauri_plugin_opener::reveal_item_in_dir(&path);
    Ok(Some(files::file_name(&path)))
}

/// メールソフトで送ったことを記録する。
#[tauri::command]
pub async fn mark_document_sent(
    db: State<'_, Database>,
    id: i64,
    to: String,
) -> AppResult<Document> {
    let to = doc::email(&to, "to")?;
    documents::record_send(&db.conn(), id, "mail_app", &to, "")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::setup::tests::set_up_db;
    use crate::domain::document::LineInput;
    use crate::mail::tests::FakeSender;
    use crate::receipt::secret::tests::MemoryStore;

    fn issued(db: &Database) -> Document {
        let d = documents::create(
            db,
            &DocumentInput {
                kind: DocumentKind::Invoice,
                partner_id: None,
                recipient_name: "株式会社テスト 御中".into(),
                recipient_address: String::new(),
                recipient_email: "billing@example.com".into(),
                issue_date: "2026-03-01".into(),
                due_date: Some("2026-03-31".into()),
                title: String::new(),
                notes: String::new(),
                lines: vec![LineInput {
                    name: "作業".into(),
                    quantity: 100,
                    unit: String::new(),
                    unit_price: 11_000,
                    tax_rate: 10,
                }],
            },
        )
        .unwrap();
        documents::issue(db, d.id, &|_, d| {
            Ok(format!("%PDF {}", d.number.clone().unwrap()).into_bytes())
        })
        .unwrap()
    }

    fn configure(db: &Database) {
        documents::save_mail_settings(
            &db.conn(),
            &MailSettings {
                from_address: "me@example.com".into(),
                from_name: String::new(),
                host: "smtp.example.com".into(),
                port: 587,
                security: "starttls".into(),
                username: String::new(),
            },
        )
        .unwrap();
    }

    #[test]
    fn draft_mail_fills_the_template() {
        let db = set_up_db();
        let d = issued(&db);
        let draft = mail_draft_of(&db.conn(), &d).unwrap();
        assert_eq!(draft.to, "billing@example.com");
        assert_eq!(draft.subject, "請求書送付のご案内（INV-2026-0001）");
        assert!(draft.body.starts_with("株式会社テスト 御中\n"));
        assert!(draft.body.contains("お支払いのお手続き"));
        assert!(draft.body.contains("お支払期限は2026年3月31日です。"));
    }

    #[test]
    fn other_documents_use_their_own_wording_without_a_payment_deadline() {
        let db = set_up_db();
        let mut d = issued(&db);
        for (kind, wording) in [
            (DocumentKind::Estimate, "ご検討"),
            (DocumentKind::Delivery, "納品内容"),
            (DocumentKind::Receipt, "保管"),
        ] {
            d.kind = kind;
            let draft = mail_draft_of(&db.conn(), &d).unwrap();
            assert!(draft.subject.starts_with(layout::kind_name(kind)));
            assert!(draft.body.contains(wording));
            assert!(!draft.body.contains("お支払期限"));
        }
    }

    #[test]
    fn sending_needs_settings_and_a_password_then_records_the_send() {
        let db = set_up_db();
        let d = issued(&db);
        let draft = mail_draft_of(&db.conn(), &d).unwrap();
        let store = MemoryStore::default();
        let sender = FakeSender::default();
        assert_eq!(
            send_and_record(&db, &store, &sender, d.id, &draft)
                .unwrap_err()
                .code,
            ErrorCode::MailNotConfigured
        );
        configure(&db);
        assert_eq!(
            send_and_record(&db, &store, &sender, d.id, &draft)
                .unwrap_err()
                .code,
            ErrorCode::MailNotConfigured
        );
        store.set("app-password").unwrap();
        let sent = send_and_record(&db, &store, &sender, d.id, &draft).unwrap();
        assert_eq!(sent.status, DocumentStatus::Sent);
        let mails = sender.sent.lock().unwrap();
        assert_eq!(mails.len(), 1);
        assert_eq!(mails[0].attachment, b"%PDF INV-2026-0001");
        assert_eq!(mails[0].attachment_name, "請求書_INV-2026-0001.pdf");
    }

    #[test]
    fn failed_sends_are_not_recorded() {
        let db = set_up_db();
        let d = issued(&db);
        configure(&db);
        let store = MemoryStore::default();
        store.set("wrong").unwrap();
        let sender = FakeSender {
            fail: Some(ErrorCode::MailAuth),
            ..Default::default()
        };
        let draft = mail_draft_of(&db.conn(), &d).unwrap();
        assert_eq!(
            send_and_record(&db, &store, &sender, d.id, &draft)
                .unwrap_err()
                .code,
            ErrorCode::MailAuth
        );
        assert_eq!(
            documents::get(&db.conn(), d.id).unwrap().status,
            DocumentStatus::Issued
        );
    }

    #[test]
    fn drafts_cannot_be_sent() {
        let db = set_up_db();
        configure(&db);
        let d = documents::create(
            &db,
            &DocumentInput {
                kind: DocumentKind::Estimate,
                partner_id: None,
                recipient_name: "A".into(),
                recipient_address: String::new(),
                recipient_email: "a@example.com".into(),
                issue_date: "2026-03-01".into(),
                due_date: None,
                title: String::new(),
                notes: String::new(),
                lines: vec![LineInput {
                    name: "x".into(),
                    quantity: 100,
                    unit: String::new(),
                    unit_price: 1,
                    tax_rate: 10,
                }],
            },
        )
        .unwrap();
        let store = MemoryStore::default();
        store.set("p").unwrap();
        let draft = MailDraft {
            to: "a@example.com".into(),
            subject: "s".into(),
            body: "b".into(),
        };
        assert_eq!(
            send_and_record(&db, &store, &FakeSender::default(), d.id, &draft).unwrap_err(),
            AppError::field(ErrorCode::InvalidFormat, "status")
        );
    }
}
