//! 請求書などのメール送信（F11-3）。SMTP で、TLS は rustls（ring）、証明書は OS のものを使う。
//!
//! 送るのは利用者が確認した宛先・件名・本文と、書類の PDF だけ。パスワードは OS の資格情報ストアから
//! 読み、画面・ログには出さない。宛先や金額もログに出さない。
//! 送る処理は `MailSender` の後ろに置き、テストでは偽物に差し替える（本物のメールは送らない）。

use chobiyori_core::error::{AppError, AppResult, ErrorCode};
use chobiyori_storage::documents::MailSettings;
use lettre::message::header::ContentType;
use lettre::message::{Attachment, Mailbox, MultiPart, SinglePart};
use lettre::transport::smtp::authentication::Credentials;
use lettre::{Message, SmtpTransport, Transport};
use std::time::Duration;

/// 送るメール。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OutgoingMail {
    pub to: String,
    pub subject: String,
    pub body: String,
    pub attachment_name: String,
    pub attachment: Vec<u8>,
}

pub trait MailSender {
    fn send(&self, settings: &MailSettings, password: &str, mail: &OutgoingMail) -> AppResult<()>;
}

/// メールの形にする。宛先・差出人のアドレスが読めなければ `InvalidFormat`。
pub fn build_message(settings: &MailSettings, mail: &OutgoingMail) -> AppResult<Message> {
    let from = Mailbox::new(
        (!settings.from_name.is_empty()).then(|| settings.from_name.clone()),
        settings
            .from_address
            .parse()
            .map_err(|_| AppError::field(ErrorCode::InvalidFormat, "fromAddress"))?,
    );
    let to: Mailbox = mail
        .to
        .parse()
        .map_err(|_| AppError::field(ErrorCode::InvalidFormat, "to"))?;
    let pdf =
        ContentType::parse("application/pdf").map_err(|_| AppError::new(ErrorCode::MailFailed))?;
    Message::builder()
        .from(from)
        .to(to)
        .subject(mail.subject.clone())
        .multipart(
            MultiPart::mixed()
                .singlepart(SinglePart::plain(mail.body.clone()))
                .singlepart(
                    Attachment::new(mail.attachment_name.clone())
                        .body(mail.attachment.clone(), pdf),
                ),
        )
        .map_err(|_| AppError::new(ErrorCode::MailFailed))
}

/// SMTP で送る。
pub struct Smtp;

impl MailSender for Smtp {
    fn send(&self, settings: &MailSettings, password: &str, mail: &OutgoingMail) -> AppResult<()> {
        // TLS の暗号の実装（ring）を、まだ決まっていなければ決める（レシートの読み取りと同じ）
        if rustls::crypto::CryptoProvider::get_default().is_none() {
            let _ = rustls::crypto::ring::default_provider().install_default();
        }
        let message = build_message(settings, mail)?;
        let builder = match settings.security.as_str() {
            "tls" => SmtpTransport::relay(&settings.host),
            _ => SmtpTransport::starttls_relay(&settings.host),
        }
        .map_err(|_| AppError::new(ErrorCode::MailFailed))?;
        let transport = builder
            .port(settings.port)
            .credentials(Credentials::new(
                settings.username.clone(),
                password.to_string(),
            ))
            .timeout(Some(Duration::from_secs(30)))
            .build();
        transport.send(&message).map(|_| ()).map_err(|error| {
            // 詳細は開発時のログにだけ出す（宛先・パスワードは含まない）
            let code = error.status().map(|c| c.to_string());
            eprintln!("メールを送れませんでした（{code:?}）");
            match code.as_deref() {
                Some("530" | "534" | "535") => AppError::new(ErrorCode::MailAuth),
                _ => AppError::new(ErrorCode::MailFailed),
            }
        })
    }
}

/// 登録するパスワードを確かめる。Gmail のアプリ パスワード（「abcd efgh ijkl mnop」）は空白を除く。
pub fn validate_password(password: &str) -> AppResult<String> {
    let password = password.trim();
    if password.is_empty() {
        return Err(AppError::field(ErrorCode::Required, "password"));
    }
    if password.chars().count() > 200 || password.chars().any(char::is_control) {
        return Err(AppError::field(ErrorCode::InvalidFormat, "password"));
    }
    let groups: Vec<&str> = password.split(' ').collect();
    if groups.len() == 4
        && groups
            .iter()
            .all(|g| g.len() == 4 && g.chars().all(|c| c.is_ascii_lowercase()))
    {
        return Ok(groups.concat());
    }
    Ok(password.to_string())
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use std::sync::Mutex;

    /// 送ったメールを覚えておく偽物。
    #[derive(Default)]
    pub(crate) struct FakeSender {
        pub sent: Mutex<Vec<OutgoingMail>>,
        pub fail: Option<ErrorCode>,
    }

    impl MailSender for FakeSender {
        fn send(&self, _: &MailSettings, password: &str, mail: &OutgoingMail) -> AppResult<()> {
            assert!(!password.is_empty());
            if let Some(code) = self.fail {
                return Err(AppError::new(code));
            }
            self.sent.lock().unwrap().push(mail.clone());
            Ok(())
        }
    }

    fn settings() -> MailSettings {
        MailSettings {
            from_address: "me@example.com".into(),
            from_name: "テスト教室".into(),
            host: "smtp.example.com".into(),
            port: 587,
            security: "starttls".into(),
            username: "me@example.com".into(),
        }
    }

    #[test]
    fn builds_a_message_with_the_pdf_attached() {
        let mail = OutgoingMail {
            to: "client@example.com".into(),
            subject: "請求書のご送付（INV-2026-0001）".into(),
            body: "よろしくお願いします".into(),
            attachment_name: "INV-2026-0001.pdf".into(),
            attachment: b"%PDF-1.7 test".to_vec(),
        };
        let raw =
            String::from_utf8(build_message(&settings(), &mail).unwrap().formatted()).unwrap();
        assert!(raw.contains("To: client@example.com"));
        assert!(raw.contains("Content-Type: application/pdf"));
        assert!(raw.contains("INV-2026-0001.pdf"));
        // 件名は符号化される（日本語のまま生では入らない）
        assert!(raw.contains("Subject: =?utf-8?"));
        let bad = OutgoingMail {
            to: "not an address".into(),
            ..mail
        };
        assert_eq!(
            build_message(&settings(), &bad).unwrap_err(),
            AppError::field(ErrorCode::InvalidFormat, "to")
        );
    }

    #[test]
    fn app_passwords_lose_their_spaces() {
        assert_eq!(
            validate_password(" abcd efgh ijkl mnop ").unwrap(),
            "abcdefghijklmnop"
        );
        assert_eq!(validate_password("my pass word").unwrap(), "my pass word");
        assert_eq!(
            validate_password("").unwrap_err(),
            AppError::field(ErrorCode::Required, "password")
        );
    }
}
