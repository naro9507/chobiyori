//! Device unlock requires fresh access to the platform key.
mod device;

use super::security::{ensure_not_open, open_books, BookFiles};
use crate::{
    db::{unlock_guard, vault, Database},
    receipt::secret::{KeyringItem, SecretStore},
};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use chobiyori_core::error::{AppError, AppResult, ErrorCode};
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
    envelope: device::Envelope,
    // Recognize old linked accounts so a successful unlock can rewrite the record.
    #[serde(rename = "provider", default, skip_serializing)]
    legacy_provider: Option<serde::de::IgnoredAny>,
}

#[derive(Serialize, Deserialize)]
struct Credential {
    binding: String,
    password: String,
    // Present while the SQLCipher rekey may still be pending.
    #[serde(skip_serializing_if = "Option::is_none")]
    previous_password: Option<String>,
}

#[derive(Serialize)]
pub struct LoginStatus {
    supported: bool,
    enabled: bool,
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
        envelope: protect(data)?,
        legacy_provider: None,
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
    Ok(LoginStatus {
        supported: SUPPORTED,
        enabled: SUPPORTED && record()?.is_some(),
    })
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
) -> AppResult<()> {
    let _guard = state.0.lock().await;
    verify_password(&db, &password)?;
    if !SUPPORTED {
        return Err(device::failed());
    }
    let binding = URL_SAFE_NO_PAD.encode(device::random::<32>()?);
    let credential = Credential {
        binding: binding.clone(),
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
) -> AppResult<()> {
    let _guard = state.0.lock().await;
    ensure_not_open(&app)?;
    if vault::state(&files.path)? != vault::BookState::Encrypted {
        return Err(expired());
    }
    let record = record()?.ok_or_else(device::failed)?;
    let retire_link = record.legacy_provider.is_some();
    let (key, mut credential) =
        tauri::async_runtime::spawn_blocking(move || authenticate_record(&record))
            .await
            .map_err(|_| device::failed())??;
    let _access = files.access.lock().unwrap_or_else(|p| p.into_inner());
    ensure_not_open(&app)?;
    let (db, password) = unlock_credential(&files.path, &credential)?;
    if book_binding(&db)?.as_deref() != Some(&credential.binding) {
        return Err(expired());
    }
    if retire_link || credential.previous_password.is_some() {
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
    fn legacy_account_record_can_be_opened_and_rewritten_for_device_login() {
        let key = device::DeviceKey::test_key();
        let old_credential =
            br#"{"provider":"google","account":"owner","binding":"device","password":"sample"}"#;
        let envelope = key.seal(old_credential.to_vec()).unwrap();
        let record: Record = serde_json::from_value(serde_json::json!({
            "provider": "google",
            "envelope": envelope,
        }))
        .unwrap();
        assert!(record.legacy_provider.is_some());
        let credential: Credential =
            serde_json::from_slice(&key.open(&record.envelope).unwrap()).unwrap();
        assert_eq!(credential.binding, "device");
        assert_eq!(credential.password, "sample");
        assert!(credential.previous_password.is_none());

        let updated = seal_record(&credential, |data| key.seal(data)).unwrap();
        let updated: Record = serde_json::from_slice(&updated).unwrap();
        assert!(updated.legacy_provider.is_none());
        let data: serde_json::Value =
            serde_json::from_slice(&key.open(&updated.envelope).unwrap()).unwrap();
        assert_eq!(
            data,
            serde_json::json!({ "binding": "device", "password": "sample" })
        );
    }

    #[test]
    fn pending_device_login_opens_the_book_before_and_after_rekey() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("books.db");
        drop(vault::create(&path, "old password").unwrap());
        let credential = Credential {
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
