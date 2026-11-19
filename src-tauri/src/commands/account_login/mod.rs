//! A provider proves identity during enrollment or online login. The device can
//! unlock offline, but both routes require fresh access to the platform key.
mod device;

use super::filing_calendar_sync::{http_client, oauth::OAuth, Provider};
use super::security::{ensure_not_open, open_books, BookFiles};
use crate::{
    db::{vault, Database},
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
    provider: Provider,
    envelope: device::Envelope,
}

#[derive(Serialize, Deserialize)]
struct Credential {
    binding: String,
    provider: Provider,
    account: String,
    password: String,
}

#[derive(Serialize)]
pub struct LoginStatus {
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

fn record() -> AppResult<Option<Record>> {
    ITEM.get_bytes()?
        .map(|bytes| serde_json::from_slice(&bytes).map_err(|_| failed()))
        .transpose()
}

#[tauri::command]
pub async fn login_status() -> AppResult<LoginStatus> {
    Ok(LoginStatus {
        google: SUPPORTED && OAuth::login(Provider::Google).is_some(),
        microsoft: SUPPORTED && OAuth::login(Provider::Outlook).is_some(),
        linked: if SUPPORTED {
            record()?.map(|r| r.provider)
        } else {
            None
        },
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
    provider: Provider,
    locale: Locale,
) -> AppResult<()> {
    let _guard = state.0.lock().await;
    verify_password(&db, &password)?;
    if !SUPPORTED {
        return Err(device::failed());
    }
    let account = identify(provider, locale).await?;
    let binding = URL_SAFE_NO_PAD.encode(device::random::<32>()?);
    let data = serde_json::to_vec(&Credential {
        binding: binding.clone(),
        provider,
        account,
        password: password.clone(),
    })
    .map_err(|_| failed())?;
    let envelope = tauri::async_runtime::spawn_blocking(move || device::seal(data))
        .await
        .map_err(|_| device::failed())??;
    verify_password(&db, &password)?;
    let record = serde_json::to_vec(&Record { provider, envelope }).map_err(|_| failed())?;
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

fn authorize(credential: &Credential, provider: Provider, account: Option<&str>) -> AppResult<()> {
    if provider != credential.provider || account.is_some_and(|id| id != credential.account) {
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
        return Err(mismatch());
    }
    let record = record()?.ok_or_else(failed)?;
    let account = if online {
        Some(identify(record.provider, locale).await?)
    } else {
        None
    };
    let bytes = tauri::async_runtime::spawn_blocking(move || device::open(&record.envelope))
        .await
        .map_err(|_| device::failed())??;
    let credential: Credential = serde_json::from_slice(&bytes).map_err(|_| failed())?;
    authorize(&credential, record.provider, account.as_deref())?;
    let db = vault::unlock(&files.path, &credential.password)?;
    let binding: Option<String> = db
        .conn()
        .query_row(
            "SELECT value FROM settings WHERE key=?1",
            [BINDING],
            |row| row.get(0),
        )
        .optional()?;
    if binding.as_deref() != Some(&credential.binding) {
        return Err(mismatch());
    }
    ensure_not_open(&app)?;
    open_books(&app, db);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn online_unlock_checks_provider_and_subject() {
        let credential = Credential {
            provider: Provider::Google,
            account: "owner".into(),
            binding: "device".into(),
            password: "sample".into(),
        };
        assert!(authorize(&credential, Provider::Google, Some("owner")).is_ok());
        assert!(authorize(&credential, Provider::Google, Some("other")).is_err());
        assert!(authorize(&credential, Provider::Outlook, Some("owner")).is_err());
        assert!(authorize(&credential, Provider::Google, None).is_ok());
    }
}
