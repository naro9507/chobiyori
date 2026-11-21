//! 帳簿を開くときのパスワード・復旧コードの入力回数の制限。
//!
//! 続けて [`FREE_ATTEMPTS`] 回間違えると、しばらく入力を受け付けない。待つ時間は 30 秒から
//! 始めて、間違えるたびに倍になり、最長で 1 時間。正しく開けたら数え直す。
//!
//! 記録は帳簿の隣のファイル（`unlock-attempts.json`）に置く。帳簿は暗号化してあり、開く前には
//! 読めないため。ファイルを消せば制限は外れるが、そもそも PC のファイルに触れる人は帳簿の
//! ファイルを持ち出して試せる。ここで防ぐのは、アプリの画面から続けて試されることだけ。

use chobiyori_core::error::{AppError, AppResult, ErrorCode};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

/// 待たずに試せる回数。
pub const FREE_ATTEMPTS: u32 = 5;
/// 最初に待つ秒数。
const FIRST_WAIT: u64 = 30;
/// いちばん長く待つ秒数。
const MAX_WAIT: u64 = 60 * 60;
const FILE: &str = "unlock-attempts.json";

#[derive(Debug, Default, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Record {
    /// 続けて間違えた回数
    failures: u32,
    /// この時刻（UNIX 秒）まで入力を受け付けない
    locked_until: u64,
}

/// 画面に出す、入力の制限の状態。
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Attempts {
    /// 入力を受け付けるまでの秒数。制限していなければ 0
    pub retry_after: u64,
    /// 待たずに試せる残りの回数
    pub attempts_left: u32,
}

/// 帳簿のファイル `book` の入力回数を記録する場所。
pub fn path_for(book: &Path) -> PathBuf {
    book.with_file_name(FILE)
}

fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_secs())
}

fn read(path: &Path) -> Record {
    // 壊れた記録は無かったものとして扱う（消されたのと同じ）
    std::fs::read(path)
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_default()
}

/// `failures` 回目に間違えたあと、待つ秒数。
fn wait_after(failures: u32) -> u64 {
    if failures < FREE_ATTEMPTS {
        return 0;
    }
    let doublings = (failures - FREE_ATTEMPTS).min(16);
    (FIRST_WAIT << doublings).min(MAX_WAIT)
}

fn status_at(record: Record, now: u64) -> Attempts {
    Attempts {
        // 時計が戻されても、最長の待ち時間を超えては待たせない
        retry_after: record.locked_until.saturating_sub(now).min(MAX_WAIT),
        attempts_left: FREE_ATTEMPTS.saturating_sub(record.failures),
    }
}

/// いまの制限の状態。
pub fn status(path: &Path) -> Attempts {
    status_at(read(path), now())
}

/// 制限を外す。パスワード以外の方法（端末の本人確認）で開けたときに使う。
pub fn reset(path: &Path) {
    if path.exists() && std::fs::remove_file(path).is_err() {
        eprintln!("入力回数の記録を消せませんでした。");
    }
}

fn too_many(field: &'static str) -> AppError {
    AppError::field(ErrorCode::TooManyAttempts, field)
}

/// パスワード・復旧コードを試す。制限中なら試さずに `TooManyAttempts` を返す。
/// `attempt` が `wrong` のエラーを返したら 1 回間違えたと数え、成功したら数え直す。
/// それ以外のエラー（入力の形の誤りなど）は数えない。
pub fn guard<T>(
    path: &Path,
    field: &'static str,
    wrong: ErrorCode,
    attempt: impl FnOnce() -> AppResult<T>,
) -> AppResult<T> {
    guard_at(path, field, wrong, now(), attempt)
}

fn guard_at<T>(
    path: &Path,
    field: &'static str,
    wrong: ErrorCode,
    now: u64,
    attempt: impl FnOnce() -> AppResult<T>,
) -> AppResult<T> {
    let record = read(path);
    if status_at(record, now).retry_after > 0 {
        return Err(too_many(field));
    }
    match attempt() {
        Ok(value) => {
            if record != Record::default() {
                reset(path);
            }
            Ok(value)
        }
        Err(error) if error.code == wrong => {
            let failures = record.failures.saturating_add(1);
            let wait = wait_after(failures);
            let next = Record {
                failures,
                locked_until: if wait > 0 { now + wait } else { 0 },
            };
            let saved = serde_json::to_vec(&next)
                .ok()
                .is_some_and(|bytes| std::fs::write(path, bytes).is_ok());
            if !saved {
                eprintln!("入力回数の記録を保存できませんでした。");
            }
            Err(if wait > 0 { too_many(field) } else { error })
        }
        Err(error) => Err(error),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn wrong() -> AppResult<()> {
        Err(AppError::field(ErrorCode::WrongPassword, "password"))
    }

    #[test]
    fn waits_grow_after_the_free_attempts_and_are_capped() {
        assert_eq!(wait_after(4), 0);
        assert_eq!(wait_after(5), 30);
        assert_eq!(wait_after(6), 60);
        assert_eq!(wait_after(7), 120);
        assert_eq!(wait_after(12), 3600);
        assert_eq!(wait_after(u32::MAX), 3600);
    }

    #[test]
    fn locks_after_repeated_failures_and_resets_on_success() {
        let dir = tempfile::tempdir().unwrap();
        let path = path_for(&dir.path().join("books.db"));
        let t = 1_000_000;
        for left in (1..FREE_ATTEMPTS).rev() {
            let error =
                guard_at(&path, "password", ErrorCode::WrongPassword, t, wrong).unwrap_err();
            assert_eq!(error.code, ErrorCode::WrongPassword);
            assert_eq!(status_at(read(&path), t).attempts_left, left);
        }
        // 5 回目で制限がかかる
        let error = guard_at(&path, "password", ErrorCode::WrongPassword, t, wrong).unwrap_err();
        assert_eq!(
            error,
            AppError::field(ErrorCode::TooManyAttempts, "password")
        );
        assert_eq!(status_at(read(&path), t).retry_after, 30);

        // 制限中は、正しいパスワードでも試さない
        let mut tried = false;
        let error = guard_at(&path, "password", ErrorCode::WrongPassword, t + 29, || {
            tried = true;
            Ok(())
        })
        .unwrap_err();
        assert_eq!(error.code, ErrorCode::TooManyAttempts);
        assert!(!tried);

        // 待ったあとにまた間違えると、倍待つ
        guard_at(&path, "password", ErrorCode::WrongPassword, t + 30, wrong).unwrap_err();
        assert_eq!(status_at(read(&path), t + 30).retry_after, 60);

        // 開けたら数え直す
        guard_at(&path, "password", ErrorCode::WrongPassword, t + 90, || {
            Ok(())
        })
        .unwrap();
        assert!(!path.exists());
        assert_eq!(
            status_at(read(&path), t + 90),
            Attempts {
                retry_after: 0,
                attempts_left: FREE_ATTEMPTS
            }
        );
    }

    #[test]
    fn other_errors_are_not_counted() {
        let dir = tempfile::tempdir().unwrap();
        let path = path_for(&dir.path().join("books.db"));
        let error = guard_at(
            &path,
            "recoveryCode",
            ErrorCode::InvalidRecoveryCode,
            1,
            || Err::<(), _>(AppError::field(ErrorCode::WeakPassword, "newPassword")),
        )
        .unwrap_err();
        assert_eq!(error.code, ErrorCode::WeakPassword);
        assert!(!path.exists());
    }

    #[test]
    fn a_clock_moved_back_never_locks_longer_than_the_maximum() {
        let record = Record {
            failures: 20,
            locked_until: u64::MAX,
        };
        assert_eq!(status_at(record, 0).retry_after, MAX_WAIT);
    }
}
