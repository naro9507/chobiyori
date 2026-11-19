use super::{FilingNotification, ScheduleResult, PREFIX};
use ::windows::{
    core::HSTRING,
    Data::Xml::Dom::XmlDocument,
    Foundation::DateTime,
    UI::Notifications::{
        NotificationSetting, ScheduledToastNotification, ToastNotificationManager,
    },
};

fn escape_xml(text: &str) -> String {
    text.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}

pub fn sync(
    identifier: &str,
    entries: &[FilingNotification],
) -> ::windows::core::Result<ScheduleResult> {
    // NSIS が登録するアプリ ID で、終了後も同じアプリの通知として表示する。
    let notifier = ToastNotificationManager::CreateToastNotifierWithId(&HSTRING::from(identifier))?;
    let pending = notifier.GetScheduledToastNotifications()?;
    let mut existing = std::collections::HashMap::new();
    for index in 0..pending.Size()? {
        let notification = pending.GetAt(index)?;
        let id = notification.Id()?.to_string_lossy();
        if id.starts_with(PREFIX) {
            existing.insert(id, notification);
        }
    }
    for (id, notification) in &existing {
        if !entries.iter().any(|entry| entry.id == *id) {
            notifier.RemoveFromSchedule(notification)?;
        }
    }
    if entries.is_empty() {
        return Ok(ScheduleResult::Ready);
    }
    if notifier.Setting()? != NotificationSetting::Enabled {
        return Ok(ScheduleResult::Denied);
    }
    for entry in entries {
        let xml = format!(
            r#"<toast><visual><binding template="ToastGeneric"><text>{}</text><text>{}</text></binding></visual></toast>"#,
            escape_xml(&entry.title),
            escape_xml(&entry.body)
        );
        let content = XmlDocument::new()?;
        content.LoadXml(&HSTRING::from(&xml))?;
        let at = DateTime {
            UniversalTime: entry.at * 10_000 + 116_444_736_000_000_000,
        };
        if let Some(previous) = existing.get(&entry.id) {
            if previous.DeliveryTime()?.UniversalTime == at.UniversalTime
                && previous.Content()?.GetXml()? == content.GetXml()?
            {
                continue;
            }
            notifier.RemoveFromSchedule(previous)?;
        }
        let toast = ScheduledToastNotification::CreateScheduledToastNotification(&content, at)?;
        toast.SetId(&HSTRING::from(&entry.id))?;
        notifier.AddToSchedule(&toast)?;
    }
    Ok(ScheduleResult::Ready)
}
