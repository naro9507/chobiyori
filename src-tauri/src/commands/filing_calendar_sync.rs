//! 申告期限だけを、許可されたカレンダーに反映する。

mod api;
pub(super) mod oauth;

use self::{
    api::{CalendarApi, Deadline},
    oauth::{Flow, OAuth},
};
use crate::db::{filing, Database};
use crate::domain::filing::add_days;
use crate::error::{AppError, AppResult, ErrorCode};
use crate::export::{filing_calendar, labels::Locale};
use crate::receipt::secret::{KeyringItem, SecretStore};
use serde::{Deserialize, Serialize};
use std::time::Duration;
use tauri::{async_runtime::Mutex, State};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Provider {
    Google,
    Outlook,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ConnectionStatus {
    Unavailable,
    Disconnected,
    Connected,
}

#[derive(Deserialize, Serialize)]
struct Connection {
    refresh_token: String,
    account_key: String,
}

#[derive(Default)]
pub struct CalendarSyncState {
    google: Mutex<()>,
    outlook: Mutex<()>,
}

impl Provider {
    fn credential(self) -> KeyringItem<'static> {
        KeyringItem(match self {
            Self::Google => "filing-calendar-google",
            Self::Outlook => "filing-calendar-outlook",
        })
    }

    fn lock(self, state: &CalendarSyncState) -> &Mutex<()> {
        match self {
            Self::Google => &state.google,
            Self::Outlook => &state.outlook,
        }
    }

    fn connection(self) -> AppResult<Option<Connection>> {
        self.credential()
            .get_bytes()?
            .map(|value| serde_json::from_slice(&value).map_err(|_| failed()))
            .transpose()
    }

    fn save(self, connection: &Connection) -> AppResult<()> {
        self.credential()
            .set_bytes(&serde_json::to_vec(connection).map_err(|_| failed())?)
    }
}

fn failed() -> AppError {
    AppError::new(ErrorCode::CalendarFailed)
}

pub(super) fn http_client() -> AppResult<reqwest::Client> {
    if rustls::crypto::CryptoProvider::get_default().is_none() {
        let _ = rustls::crypto::ring::default_provider().install_default();
    }
    reqwest::Client::builder()
        .timeout(Duration::from_secs(20))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|_| failed())
}

#[tauri::command]
pub async fn filing_calendar_connection(provider: Provider) -> AppResult<ConnectionStatus> {
    if OAuth::configured(provider).is_none() {
        return Ok(ConnectionStatus::Unavailable);
    }
    Ok(if provider.connection()?.is_some() {
        ConnectionStatus::Connected
    } else {
        ConnectionStatus::Disconnected
    })
}

#[tauri::command]
pub async fn connect_filing_calendar(
    state: State<'_, CalendarSyncState>,
    provider: Provider,
    locale: Locale,
) -> AppResult<()> {
    let _guard = provider.lock(&state).lock().await;
    let oauth = OAuth::configured(provider).ok_or_else(failed)?;
    let client = http_client()?;
    let token = oauth.connect(&client, locale, Flow::Calendar).await?;
    let refresh_token = token
        .refresh_token
        .filter(|token| !token.is_empty())
        .ok_or_else(|| AppError::new(ErrorCode::CalendarAuth))?;
    let account_key = oauth.account_key(&client, &token.access_token).await?;
    provider.save(&Connection {
        refresh_token,
        account_key,
    })
}

#[tauri::command]
pub async fn disconnect_filing_calendar(
    state: State<'_, CalendarSyncState>,
    provider: Provider,
) -> AppResult<()> {
    let _guard = provider.lock(&state).lock().await;
    provider.credential().delete()
}

#[tauri::command]
pub async fn sync_filing_calendar(
    db: State<'_, Database>,
    state: State<'_, CalendarSyncState>,
    provider: Provider,
    today: String,
    locale: Locale,
) -> AppResult<()> {
    let _guard = provider.lock(&state).lock().await;
    let Some(oauth) = OAuth::configured(provider) else {
        return Ok(());
    };
    let Some(mut connection) = provider.connection()? else {
        return Ok(());
    };
    let deadlines = filing::upcoming_deadlines(&db.conn(), &today)?
        .into_iter()
        .filter(|notice| !notice.submitted && notice.days_left >= 0)
        .map(|notice| {
            let (kind, label) = filing_calendar::event_label(&notice, locale);
            Ok(Deadline {
                key: format!("{kind}-{}", notice.fiscal_year),
                title: format!("{} ({})", label, notice.fiscal_year),
                end: add_days(&notice.date, 1).ok_or_else(failed)?,
                date: notice.date,
            })
        })
        .collect::<AppResult<Vec<_>>>()?;
    let calendar_key = format!("{}-{}", provider.credential().0, connection.account_key);
    let calendar_store = KeyringItem(&calendar_key);
    let calendar_id = calendar_store.get()?;
    if deadlines.is_empty() && calendar_id.is_none() {
        return Ok(());
    }

    let client = http_client()?;
    let token = oauth.refresh(&client, &connection.refresh_token).await?;
    if let Some(refresh_token) = token.refresh_token.filter(|token| !token.is_empty()) {
        if refresh_token != connection.refresh_token {
            connection.refresh_token = refresh_token;
            provider.save(&connection)?;
        }
    }
    let api = CalendarApi {
        client: &client,
        provider,
        token: &token.access_token,
    };
    if let Some(id) = &calendar_id {
        if api.sync(id, &deadlines).await? {
            return Ok(());
        }
    }
    if deadlines.is_empty() {
        return calendar_store.delete();
    }
    let id = api.create_calendar().await?;
    calendar_store.set(&id)?;
    if !api.sync(&id, &deadlines).await? {
        return Err(failed());
    }
    Ok(())
}
