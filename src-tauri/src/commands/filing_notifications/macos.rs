use super::{epoch_millis, FilingNotification, ScheduleResult, PREFIX};
use block2::RcBlock;
use objc2::{rc::autoreleasepool, runtime::Bool};
use objc2_foundation::{NSArray, NSBundle, NSError, NSString};
use objc2_user_notifications::{
    UNAuthorizationOptions, UNMutableNotificationContent, UNNotificationRequest,
    UNTimeIntervalNotificationTrigger, UNUserNotificationCenter,
};
use std::{ptr::NonNull, sync::mpsc, time::Duration};

const TIMEOUT: Duration = Duration::from_secs(15);

pub fn sync(identifier: &str, entries: &[FilingNotification]) -> Result<ScheduleResult, ()> {
    autoreleasepool(|_| {
        // 通知センターはアプリバンドルを必要とする。開発用の裸の実行ファイルでは呼ばない。
        if NSBundle::mainBundle()
            .bundleIdentifier()
            .is_none_or(|bundle| bundle.to_string() != identifier)
        {
            return Ok(ScheduleResult::Unavailable);
        }
        let center = UNUserNotificationCenter::currentNotificationCenter();
        let (tx, rx) = mpsc::channel();
        center.getPendingNotificationRequestsWithCompletionHandler(&RcBlock::new(
            move |requests: NonNull<NSArray<UNNotificationRequest>>| {
                // OS が渡した配列は、このコールバックの間だけ読む。
                let requests = unsafe { requests.as_ref() };
                let ids: Vec<_> = (0..requests.count())
                    .map(|index| requests.objectAtIndex(index).identifier().to_string())
                    .filter(|id| id.starts_with(PREFIX))
                    .collect();
                let _ = tx.send(ids);
            },
        ));
        let pending = rx.recv_timeout(TIMEOUT).map_err(|_| ())?;
        let obsolete: Vec<_> = pending
            .iter()
            .filter(|id| !entries.iter().any(|entry| entry.id == **id))
            .map(|id| NSString::from_str(id))
            .collect();
        if !obsolete.is_empty() {
            center.removePendingNotificationRequestsWithIdentifiers(&NSArray::from_retained_slice(
                &obsolete,
            ));
        }
        if entries.is_empty() {
            return Ok(ScheduleResult::Ready);
        }

        let (tx, rx) = mpsc::channel();
        center.requestAuthorizationWithOptions_completionHandler(
            UNAuthorizationOptions::Alert,
            &RcBlock::new(move |granted: Bool, error: *mut NSError| {
                let _ = tx.send(error.is_null().then(|| granted.as_bool()));
            }),
        );
        if !rx
            .recv_timeout(Duration::from_secs(90))
            .map_err(|_| ())?
            .ok_or(())?
        {
            return Ok(ScheduleResult::Unavailable);
        }

        let (tx, rx) = mpsc::channel();
        let mut count = 0;
        for entry in entries {
            let seconds = (entry.at - epoch_millis()) as f64 / 1000.0;
            if seconds <= 0.0 {
                continue;
            }
            let content = UNMutableNotificationContent::new();
            content.setTitle(&NSString::from_str(&entry.title));
            content.setBody(&NSString::from_str(&entry.body));
            let trigger =
                UNTimeIntervalNotificationTrigger::triggerWithTimeInterval_repeats(seconds, false);
            let request = UNNotificationRequest::requestWithIdentifier_content_trigger(
                &NSString::from_str(&entry.id),
                &content,
                Some(&trigger),
            );
            let tx = tx.clone();
            // 同じ ID で追加すると既存の予約が更新される。
            center.addNotificationRequest_withCompletionHandler(
                &request,
                Some(&RcBlock::new(move |error: *mut NSError| {
                    let _ = tx.send(error.is_null());
                })),
            );
            count += 1;
        }
        for _ in 0..count {
            if !rx.recv_timeout(TIMEOUT).map_err(|_| ())? {
                return Err(());
            }
        }
        Ok(ScheduleResult::Ready)
    })
}
