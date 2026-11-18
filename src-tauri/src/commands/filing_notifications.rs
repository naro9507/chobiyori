//! Windows と macOS の通知を、アプリ終了後にも OS が届けられるように予約する。

#[cfg(target_os = "macos")]
mod macos;
#[cfg(windows)]
mod windows;

#[cfg(any(windows, target_os = "macos"))]
const PREFIX: &str = "cbf-";

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FilingNotification {
    pub id: String,
    pub at: i64,
    pub title: String,
    pub body: String,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ScheduleResult {
    #[cfg(any(windows, target_os = "macos"))]
    Ready,
    Unavailable,
}

#[tauri::command]
pub async fn sync_filing_notifications(
    app: tauri::AppHandle,
    notifications: Vec<FilingNotification>,
) -> Result<ScheduleResult, &'static str> {
    // WinRT の予約 ID は 16 文字まで。受け付けるのはこの機能専用の ID だけ。
    if notifications.len() > 60
        || notifications.iter().any(|entry| {
            !entry.id.starts_with("cbf-")
                || entry.id.len() > 16
                || !entry
                    .id
                    .bytes()
                    .all(|c| c.is_ascii_alphanumeric() || c == b'-')
                || entry.title.len() > 256
                || entry.body.len() > 512
                || !(0..=253_402_300_799_000).contains(&entry.at)
        })
    {
        return Err("invalidNotificationSchedule");
    }

    #[cfg(any(windows, target_os = "macos"))]
    {
        let identifier = app.config().identifier.clone();
        tauri::async_runtime::spawn_blocking(move || {
            // 設定を続けて変えた場合も同時に予約を書き換えない。
            static LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());
            let _lock = LOCK.lock().map_err(|_| "notificationScheduleFailed")?;
            let now = epoch_millis();
            let notifications: Vec<_> = notifications
                .into_iter()
                .filter(|entry| entry.at > now)
                .collect();
            #[cfg(windows)]
            let result = windows::sync(&identifier, &notifications);
            #[cfg(target_os = "macos")]
            let result = macos::sync(&identifier, &notifications);
            result.map_err(|_| "notificationScheduleFailed")
        })
        .await
        .map_err(|_| "notificationScheduleFailed")?
    }
    #[cfg(not(any(windows, target_os = "macos")))]
    {
        let _ = app;
        Ok(ScheduleResult::Unavailable)
    }
}

#[cfg(any(windows, target_os = "macos"))]
fn epoch_millis() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |elapsed| elapsed.as_millis() as i64)
}
