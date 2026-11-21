//! Device unlock requires access to the platform key. An optional provider can
//! also verify the linked account during enrollment and online unlock.
mod device;

use super::filing_calendar_sync::{http_client, oauth::OAuth, Provider};
use super::security::{ensure_not_open, open_books, BookFiles};
use crate::{
    db::{unlock_guard, vault, Database},
    error::{AppError, AppResult, ErrorCode},
    export::labels::Locale,
    receipt::secret::{KeyringItem, SecretStore},
};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use rusqlite::OptionalExtension;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, State};

#[derive(Default)]
pub struct LoginState(pub(super) tauri::async_runtime::Mutex<()>);

const ITEM: KeyringItem<'static> = KeyringItem("book-device-login-v1");
use crate::db::vault::DEVICE_BINDING as BINDING;
const SUPPORTED: bool = cfg!(any(windows, target_os = "macos"));

pub(super) fn discard_device_record() {
    // The encrypted book already invalidated its binding. An unavailable keyring
    // must not turn a completed restore or password change into a reported failure.
    if SUPPORTED && ITEM.delete().is_err() {
        eprintln!("Could not remove an invalidated device login.");
    }
}

#[derive(Serialize, Deserialize)]
struct Record {
    provider: Option<Provider>,
    envelope: device::Envelope,
}

#[derive(Serialize, Deserialize)]
struct Credential {
    binding: String,
    provider: Option<Provider>,
    account: Option<String>,
    password: String,
}

#[derive(Serialize)]
pub struct LoginStatus {
    supported: bool,
    enabled: bool,
    google: bool,
    microsoft: bool,
    linked: Option<Provider>,
}

fn failed() -> AppError {
    AppError::new(ErrorCode::LoginFailed)
}
fn mismatch() -> AppError {
    AppError::new(ErrorCode::LoginMismatch)
}
/// 端末に残した設定が、いまの帳簿と合わない（パスワードの変更や復元のあと）。
fn expired() -> AppError {
    AppError::new(ErrorCode::LoginExpired)
}

fn record() -> AppResult<Option<Record>> {
    ITEM.get_bytes()?
        .map(|bytes| serde_json::from_slice(&bytes).map_err(|_| device::failed()))
        .transpose()
}

#[tauri::command]
pub async fn login_status() -> AppResult<LoginStatus> {
    let record = if SUPPORTED { record()? } else { None };
    Ok(LoginStatus {
        supported: SUPPORTED,
        enabled: record.is_some(),
        google: SUPPORTED && OAuth::login(Provider::Google).is_some(),
        microsoft: SUPPORTED && OAuth::login(Provider::Outlook).is_some(),
        linked: record.and_then(|r| r.provider),
    })
}

async fn identify(provider: Provider, locale: Locale) -> AppResult<String> {
    let oauth = OAuth::login(provider).ok_or_else(failed)?;
    let client = http_client().map_err(|_| failed())?;
    let token = oauth
        .connect(&client, locale == Locale::Ja)
        .await
        .map_err(|_| failed())?;
    oauth
        .account_key(&client, &token.access_token)
        .await
        .map_err(|_| failed())
}

fn verify_password(db: &Database, password: &str) -> AppResult<()> {
    if db.key().is_some_and(|key| key.as_str() == password) {
        Ok(())
    } else {
        Err(AppError::new(ErrorCode::WrongPassword))
    }
}

#[tauri::command]
pub async fn link_login(
    state: State<'_, LoginState>,
    db: State<'_, Database>,
    password: String,
    provider: Option<Provider>,
    locale: Locale,
) -> AppResult<()> {
    let _guard = state.0.lock().await;
    verify_password(&db, &password)?;
    if !SUPPORTED {
        return Err(device::failed());
    }
    let account = match provider {
        Some(provider) => Some(identify(provider, locale).await?),
        None => None,
    };
    let binding = URL_SAFE_NO_PAD.encode(device::random::<32>()?);
    let data = serde_json::to_vec(&Credential {
        binding: binding.clone(),
        provider,
        account,
        password: password.clone(),
    })
    .map_err(|_| device::failed())?;
    let envelope = tauri::async_runtime::spawn_blocking(move || device::seal(data))
        .await
        .map_err(|_| device::failed())??;
    verify_password(&db, &password)?;
    let record =
        serde_json::to_vec(&Record { provider, envelope }).map_err(|_| device::failed())?;
    db.transaction(|tx| {
        tx.execute(
            "INSERT OR REPLACE INTO settings(key,value) VALUES (?1,?2)",
            (&BINDING, &binding),
        )?;
        ITEM.set_bytes(&record)
    })
}

#[tauri::command]
pub async fn unlink_login(
    state: State<'_, LoginState>,
    db: State<'_, Database>,
    password: String,
) -> AppResult<()> {
    let _guard = state.0.lock().await;
    verify_password(&db, &password)?;
    db.transaction(|tx| {
        tx.execute("DELETE FROM settings WHERE key=?1", [BINDING])?;
        ITEM.delete()
    })
}

fn authorize(
    credential: &Credential,
    provider: Option<Provider>,
    account: Option<&str>,
) -> AppResult<()> {
    if provider != credential.provider
        || provider.is_some() != credential.account.is_some()
        || account.is_some_and(|id| Some(id) != credential.account.as_deref())
    {
        return Err(mismatch());
    }
    Ok(())
}

#[tauri::command]
pub async fn open_with_login(
    app: AppHandle,
    files: State<'_, BookFiles>,
    state: State<'_, LoginState>,
    online: bool,
    locale: Locale,
) -> AppResult<()> {
    let _guard = state.0.lock().await;
    ensure_not_open(&app)?;
    if vault::state(&files.path)? != vault::BookState::Encrypted {
        return Err(expired());
    }
    let record = record()?.ok_or_else(device::failed)?;
    let account = if online {
        Some(identify(record.provider.ok_or_else(failed)?, locale).await?)
    } else {
        None
    };
    let bytes = tauri::async_runtime::spawn_blocking(move || device::open(&record.envelope))
        .await
        .map_err(|_| device::failed())??;
    let credential: Credential = serde_json::from_slice(&bytes).map_err(|_| device::failed())?;
    authorize(&credential, record.provider, account.as_deref())?;
    let _access = files.access.lock().unwrap_or_else(|p| p.into_inner());
    ensure_not_open(&app)?;
    let db = vault::unlock(&files.path, &credential.password).map_err(|error| {
        if error.code == ErrorCode::WrongPassword {
            expired()
        } else {
            error
        }
    })?;
    let binding: Option<String> = db
        .conn()
        .query_row(
            "SELECT value FROM settings WHERE key=?1",
            [BINDING],
            |row| row.get(0),
        )
        .optional()?;
    if binding.as_deref() != Some(&credential.binding) {
        return Err(expired());
    }
    // 本人確認できたので、パスワードの入力回数の制限も数え直す
    unlock_guard::reset(&unlock_guard::path_for(&files.path));
    open_books(&app, db);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn linked_credentials_from_previous_versions_check_provider_and_subject() {
        let credential: Credential = serde_json::from_str(
            r#"{"provider":"google","account":"owner","binding":"device","password":"sample"}"#,
        )
        .unwrap();
        let google = Some(Provider::Google);
        assert!(authorize(&credential, google, Some("owner")).is_ok());
        assert!(authorize(&credential, google, Some("other")).is_err());
        assert!(authorize(&credential, Some(Provider::Outlook), Some("owner")).is_err());
        assert!(authorize(&credential, google, None).is_ok());
        assert!(authorize(&credential, None, None).is_err());
    }

    #[test]
    fn device_only_credentials_require_no_account() {
        let credential = Credential {
            provider: None,
            account: None,
            binding: "device".into(),
            password: "sample".into(),
        };
        assert!(authorize(&credential, None, None).is_ok());
        assert!(authorize(&credential, Some(Provider::Google), None).is_err());
        assert!(authorize(&credential, None, Some("owner")).is_err());
    }
}
