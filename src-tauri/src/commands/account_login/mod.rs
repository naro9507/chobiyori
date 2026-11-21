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
use std::path::Path;
use tauri::{AppHandle, State};

#[derive(Default)]
pub struct LoginState(pub(super) tauri::async_runtime::Mutex<()>);

const ITEM: KeyringItem<'static> = KeyringItem("book-device-login-v1");
use crate::db::vault::DEVICE_BINDING as BINDING;
const SUPPORTED: bool = cfg!(any(windows, target_os = "macos"));

pub(super) fn discard_device_record() {
    // The encrypted book already invalidated its binding. An unavailable keyring
    // must not turn a completed restore or recovery into a reported failure.
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
    // Present while the SQLCipher rekey may still be pending.
    #[serde(skip_serializing_if = "Option::is_none")]
    previous_password: Option<String>,
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
/// 端末に残した設定が、いまの帳簿と合わない。
fn expired() -> AppError {
    AppError::new(ErrorCode::LoginExpired)
}

fn record() -> AppResult<Option<Record>> {
    ITEM.get_bytes()?
        .map(|bytes| serde_json::from_slice(&bytes).map_err(|_| device::failed()))
        .transpose()
}

fn book_binding(db: &Database) -> AppResult<Option<String>> {
    Ok(db
        .conn()
        .query_row(
            "SELECT value FROM settings WHERE key=?1",
            [BINDING],
            |row| row.get(0),
        )
        .optional()?)
}

fn seal_record(
    credential: &Credential,
    protect: impl FnOnce(Vec<u8>) -> AppResult<device::Envelope>,
) -> AppResult<Vec<u8>> {
    let data = serde_json::to_vec(credential).map_err(|_| device::failed())?;
    let record = Record {
        provider: credential.provider,
        envelope: protect(data)?,
    };
    serde_json::to_vec(&record).map_err(|_| device::failed())
}

fn authenticate_record(record: &Record) -> AppResult<(device::DeviceKey, Credential)> {
    let key = record.envelope.authenticate()?;
    let bytes = key.open(&record.envelope)?;
    let credential = serde_json::from_slice(&bytes).map_err(|_| device::failed())?;
    Ok((key, credential))
}

pub(super) async fn prepare_password_change(
    db: &Database,
    current: &str,
    new: &str,
) -> AppResult<Option<Vec<u8>>> {
    if !SUPPORTED {
        return Ok(None);
    }
    let Some(binding) = book_binding(db)? else {
        return Ok(None);
    };
    let Some(record) = record()? else {
        return Ok(None);
    };
    let current = current.to_owned();
    let new = new.to_owned();
    let (pending, updated) = tauri::async_runtime::spawn_blocking(move || -> AppResult<_> {
        let (key, mut credential) = authenticate_record(&record)?;
        authorize(&credential, record.provider, None)?;
        if credential.binding != binding
            || (credential.password != current
                && credential.previous_password.as_deref() != Some(&current))
        {
            return Err(expired());
        }
        credential.password = new;
        credential.previous_password = Some(current);
        let pending = seal_record(&credential, |data| key.seal(data))?;
        credential.previous_password = None;
        let updated = seal_record(&credential, |data| key.seal(data))?;
        Ok((pending, updated))
    })
    .await
    .map_err(|_| device::failed())??;
    // Keep both passwords until rekey succeeds so an interruption at either
    // side of the rekey leaves a usable credential.
    ITEM.set_bytes(&pending)?;
    Ok(Some(updated))
}

pub(super) fn finish_password_change(updated: &[u8]) {
    if ITEM.set_bytes(updated).is_err() {
        eprintln!("Could not finish updating the device login.");
    }
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
    let credential = Credential {
        binding: binding.clone(),
        provider,
        account,
        password: password.clone(),
        previous_password: None,
    };
    let record =
        tauri::async_runtime::spawn_blocking(move || seal_record(&credential, device::seal))
            .await
            .map_err(|_| device::failed())??;
    verify_password(&db, &password)?;
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

fn unlock_credential<'a>(
    path: &Path,
    credential: &'a Credential,
) -> AppResult<(Database, &'a str)> {
    for password in
        std::iter::once(credential.password.as_str()).chain(credential.previous_password.as_deref())
    {
        match vault::unlock(path, password) {
            Ok(db) => return Ok((db, password)),
            Err(error) if error.code == ErrorCode::WrongPassword => {}
            Err(error) => return Err(error),
        }
    }
    Err(expired())
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
    let provider = record.provider;
    let (key, mut credential) =
        tauri::async_runtime::spawn_blocking(move || authenticate_record(&record))
            .await
            .map_err(|_| device::failed())??;
    authorize(&credential, provider, account.as_deref())?;
    let _access = files.access.lock().unwrap_or_else(|p| p.into_inner());
    ensure_not_open(&app)?;
    let (db, password) = unlock_credential(&files.path, &credential)?;
    if book_binding(&db)?.as_deref() != Some(&credential.binding) {
        return Err(expired());
    }
    if credential.previous_password.is_some() {
        credential.password = password.to_owned();
        credential.previous_password = None;
        if let Ok(updated) = seal_record(&credential, |data| key.seal(data)) {
            finish_password_change(&updated);
        }
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
        assert!(credential.previous_password.is_none());
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
            previous_password: None,
        };
        assert!(authorize(&credential, None, None).is_ok());
        assert!(authorize(&credential, Some(Provider::Google), None).is_err());
        assert!(authorize(&credential, None, Some("owner")).is_err());
    }

    #[test]
    fn pending_device_login_opens_the_book_before_and_after_rekey() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("books.db");
        drop(vault::create(&path, "old password").unwrap());
        let credential = Credential {
            provider: None,
            account: None,
            binding: "device".into(),
            password: "new password".into(),
            previous_password: Some("old password".into()),
        };
        let (db, password) = unlock_credential(&path, &credential).unwrap();
        assert_eq!(password, "old password");
        vault::change_password(&db, "old password", "new password").unwrap();
        drop(db);

        let (_, password) = unlock_credential(&path, &credential).unwrap();
        assert_eq!(password, "new password");
    }

    #[test]
    fn pending_record_fits_windows_credential_manager_with_long_passwords() {
        let password = "𠀀".repeat(200);
        let credential = Credential {
            provider: Some(Provider::Outlook),
            account: Some("a".repeat(43)),
            binding: "b".repeat(43),
            password: password.clone(),
            previous_password: Some(password),
        };
        let key = device::DeviceKey::test_key();
        let bytes = seal_record(&credential, |data| key.seal(data)).unwrap();
        let mut value: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        value["envelope"]["nonce"] = serde_json::to_value([255u8; 12]).unwrap();
        assert!(serde_json::to_vec(&value).unwrap().len() <= 2560);
    }
}
