//! 帳簿の暗号化と起動時のパスワード。
//!
//! 帳簿のファイル（`books.db`）は SQLCipher で暗号化する。鍵は起動のたびに入れてもらう
//! パスワードで、SQLCipher がパスワードから鍵を作る（PBKDF2）。
//!
//! フェーズ 7 までの版で作った帳簿は暗号化されていない。最初にパスワードを決めたときに、
//! 暗号化した写しを別のファイルに作って中身を確かめてから、元のファイルと入れ替える。
//! 途中で失敗しても元のファイルは残る。

use super::{connect, migrate, Database};
use crate::error::{AppError, AppResult, ErrorCode};
use rusqlite::Connection;
use serde::Serialize;
use std::fmt;
use std::path::{Path, PathBuf};

/// パスワードの最短の長さ。
pub const PASSWORD_MIN: usize = 8;
const PASSWORD_MAX: usize = 200;

/// パスワード。`Debug` でも中身を出さない。
#[derive(Clone, PartialEq, Eq)]
pub struct Password(String);

impl Password {
    pub fn new(value: &str) -> Self {
        Self(value.to_string())
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl fmt::Debug for Password {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("Password(***)")
    }
}

/// 新しく決めるパスワードを確かめる。空白だけ・短すぎるものは使えない。
pub fn validate_new(value: &str) -> AppResult<Password> {
    if value.trim().is_empty() {
        return Err(AppError::field(ErrorCode::Required, "password"));
    }
    let length = value.chars().count();
    if length < PASSWORD_MIN {
        return Err(AppError::field(ErrorCode::WeakPassword, "password"));
    }
    if length > PASSWORD_MAX || value.chars().any(char::is_control) {
        return Err(AppError::field(ErrorCode::InvalidFormat, "password"));
    }
    Ok(Password::new(value))
}

/// 帳簿のファイルの状態。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum BookState {
    /// まだない（初めての起動）
    NotCreated,
    /// 暗号化されていない（フェーズ 7 までの版で作った帳簿）
    Plain,
    /// 暗号化されている（パスワードを入れれば開ける）
    Encrypted,
}

/// ファイルが暗号化されているかを、開いてみて調べる。中身は書き換えない。
pub fn state(path: &Path) -> AppResult<BookState> {
    if !path.exists() {
        return Ok(BookState::NotCreated);
    }
    let conn = Connection::open_with_flags(path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)?;
    let readable = conn
        .query_row("SELECT count(*) FROM sqlite_master", [], |r| {
            r.get::<_, i64>(0)
        })
        .is_ok();
    Ok(if readable {
        BookState::Plain
    } else {
        BookState::Encrypted
    })
}

/// 鍵を付けて、読めるかを確かめる。読めなければパスワード違い。
fn open_checked(path: &Path, password: &Password) -> AppResult<Connection> {
    let conn = Connection::open_with_flags(path, rusqlite::OpenFlags::SQLITE_OPEN_READ_WRITE)?;
    conn.pragma_update(None, "key", password.as_str())?;
    conn.query_row("SELECT count(*) FROM sqlite_master", [], |r| {
        r.get::<_, i64>(0)
    })
    .map_err(|_| AppError::field(ErrorCode::WrongPassword, "password"))?;
    Ok(conn)
}

/// 新しい帳簿を、暗号化して作る。
pub fn create(path: &Path, password: &str) -> AppResult<Database> {
    if path.exists() {
        return Err(AppError::new(ErrorCode::AlreadySetUp));
    }
    let password = validate_new(password)?;
    let db = Database::open(path, Some(password.as_str()))?;
    super::recovery::discard(path);
    Ok(db)
}

/// 暗号化した帳簿を開く。パスワードが違えば `WrongPassword`。
pub fn unlock(path: &Path, password: &str) -> AppResult<Database> {
    let password = Password::new(password);
    drop(open_checked(path, &password)?);
    Database::open(path, Some(password.as_str()))
}

/// 帳簿の中の表ごとの行の数。写しが元と同じかを確かめるのに使う。
pub(crate) fn fingerprint(conn: &Connection) -> AppResult<Vec<(String, i64)>> {
    let mut stmt = conn.prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    )?;
    let tables: Vec<String> = stmt
        .query_map([], |r| r.get(0))?
        .collect::<Result<_, _>>()?;
    let mut counts = Vec::with_capacity(tables.len() + 1);
    for table in tables {
        let count: i64 = conn.query_row(&format!("SELECT count(*) FROM \"{table}\""), [], |r| {
            r.get(0)
        })?;
        counts.push((table, count));
    }
    let version: i64 = conn.pragma_query_value(None, "user_version", |r| r.get(0))?;
    counts.push(("user_version".into(), version));
    Ok(counts)
}

/// `conn` の中身を、`dest` に `key` で暗号化して書き出す（`key` が None なら暗号化しない）。
/// `dest` は新しいファイル。書き出したあと、開き直して行の数が同じかを確かめる。
pub(crate) fn export_to(conn: &Connection, dest: &Path, key: Option<&Password>) -> AppResult<()> {
    if dest.exists() {
        std::fs::remove_file(dest).map_err(|_| AppError::new(ErrorCode::FileWrite))?;
    }
    let dest_text = dest
        .to_str()
        .ok_or(AppError::new(ErrorCode::FileWrite))?
        .to_string();
    conn.execute(
        "ATTACH DATABASE ?1 AS export KEY ?2",
        rusqlite::params![dest_text, key.map_or("", Password::as_str)],
    )?;
    let result = (|| -> AppResult<()> {
        conn.query_row("SELECT sqlcipher_export('export')", [], |_| Ok(()))?;
        // sqlcipher_export は版の番号（user_version）を写さないので、手で写す
        let version: i64 = conn.pragma_query_value(None, "user_version", |r| r.get(0))?;
        conn.execute_batch(&format!("PRAGMA export.user_version = {version};"))?;
        Ok(())
    })();
    conn.execute_batch("DETACH DATABASE export;")?;
    result?;

    // 写しを開き直して、元と同じかを確かめる
    let copy = Connection::open(dest)?;
    if let Some(key) = key {
        copy.pragma_update(None, "key", key.as_str())?;
    }
    let ok: String = copy
        .query_row("PRAGMA integrity_check", [], |r| r.get(0))
        .map_err(|_| AppError::new(ErrorCode::BackupInvalid))?;
    if ok != "ok" || fingerprint(&copy)? != fingerprint(conn)? {
        drop(copy);
        let _ = std::fs::remove_file(dest);
        return Err(AppError::new(ErrorCode::BackupInvalid));
    }
    Ok(())
}

/// SQLite が一緒に使うファイル（`-wal`・`-shm`）。
pub(crate) fn side_files(path: &Path) -> [PathBuf; 2] {
    let with = |suffix: &str| {
        let mut name = path.as_os_str().to_os_string();
        name.push(suffix);
        PathBuf::from(name)
    };
    [with("-wal"), with("-shm")]
}

/// 暗号化されていない帳簿を暗号化する。
///
/// 1. 元の帳簿の書きかけ（WAL）を本体に書き込む
/// 2. 暗号化した写し（`books.db.encrypting`）を作り、行の数が同じかを確かめる
/// 3. 元のファイルを `books.db.plain-old` に名前を変え、写しを `books.db` にする
/// 4. 暗号化した帳簿を開けたら、古いファイルを消す（暗号化していない写しを残さない）
///
/// 3 の前に失敗したら元のファイルはそのまま。3 のあとに開けなければ元に戻す。
pub fn encrypt_existing(path: &Path, password: &str) -> AppResult<Database> {
    let password = validate_new(password)?;
    let encrypting = path.with_extension("db.encrypting");
    let old = path.with_extension("db.plain-old");
    {
        let conn = connect(path, None)?;
        migrate(&conn)?;
        conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);")?;
        export_to(&conn, &encrypting, Some(&password))?;
    }
    for side in side_files(path) {
        let _ = std::fs::remove_file(side);
    }
    std::fs::rename(path, &old).map_err(|_| AppError::new(ErrorCode::FileWrite))?;
    if std::fs::rename(&encrypting, path).is_err() {
        let _ = std::fs::rename(&old, path);
        return Err(AppError::new(ErrorCode::FileWrite));
    }
    match Database::open(path, Some(password.as_str())) {
        Ok(db) => {
            super::recovery::discard(path);
            let _ = std::fs::remove_file(&old);
            for side in side_files(&old) {
                let _ = std::fs::remove_file(side);
            }
            Ok(db)
        }
        Err(error) => {
            let _ = std::fs::remove_file(path);
            let _ = std::fs::rename(&old, path);
            Err(error)
        }
    }
}

pub(super) fn check_current(db: &Database, current: &str) -> AppResult<Password> {
    let Some(key) = db.key() else {
        return Err(AppError::new(ErrorCode::BooksLocked));
    };
    if key.as_str() != current {
        return Err(AppError::field(ErrorCode::WrongPassword, "currentPassword"));
    }
    Ok(key)
}

/// パスワードを変える。いまのパスワードが合っていなければ変えない。
pub fn change_password(db: &Database, current: &str, new: &str) -> AppResult<()> {
    let conn = db.conn();
    let current = check_current(db, current)?;
    let new = validate_new(new).map_err(|e| AppError::field(e.code, "newPassword"))?;
    if current != new {
        let path = db
            .path()
            .ok_or_else(|| AppError::new(ErrorCode::BooksLocked))?;
        // 復旧コードを破棄する前に、新しい鍵での書き込みをディスクに同期する。
        conn.pragma_update(None, "synchronous", "FULL")?;
        let rekey = conn.pragma_update(None, "rekey", new.as_str());
        let _ = conn.pragma_update(None, "synchronous", "NORMAL");
        rekey?;
        drop(open_checked(path, &new)?);
        db.set_key(Some(new));
        super::recovery::discard(path);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::setup::tests::input;

    fn books_with_data(path: &Path, key: Option<&str>) {
        let db = Database::open(path, key).unwrap();
        crate::db::setup::complete(&db, &input()).unwrap();
    }

    #[test]
    fn passwords_need_eight_characters_and_are_not_printed() {
        assert_eq!(
            validate_new("short").unwrap_err(),
            AppError::field(ErrorCode::WeakPassword, "password")
        );
        assert_eq!(
            validate_new("        ").unwrap_err(),
            AppError::field(ErrorCode::Required, "password")
        );
        let p = validate_new("ながいパスワードです").unwrap();
        assert_eq!(format!("{p:?}"), "Password(***)");
    }

    #[test]
    fn new_books_are_encrypted_and_need_the_password() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("books.db");
        assert_eq!(state(&path).unwrap(), BookState::NotCreated);
        drop(create(&path, "correct horse").unwrap());
        assert_eq!(state(&path).unwrap(), BookState::Encrypted);
        assert_eq!(
            unlock(&path, "wrong password").unwrap_err(),
            AppError::field(ErrorCode::WrongPassword, "password")
        );
        let db = unlock(&path, "correct horse").unwrap();
        assert_eq!(db.key().unwrap().as_str(), "correct horse");
        // 2 回目の作成はしない（帳簿を上書きしない）
        assert_eq!(
            create(&path, "another one").unwrap_err().code,
            ErrorCode::AlreadySetUp
        );
    }

    #[test]
    fn plain_books_are_encrypted_without_losing_data_or_leaving_a_plain_copy() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("books.db");
        books_with_data(&path, None);
        let before = fingerprint(&connect(&path, None).unwrap()).unwrap();
        assert_eq!(state(&path).unwrap(), BookState::Plain);

        let db = encrypt_existing(&path, "correct horse").unwrap();
        assert_eq!(fingerprint(&db.conn()).unwrap(), before);
        drop(db);
        assert_eq!(state(&path).unwrap(), BookState::Encrypted);
        let names: Vec<String> = std::fs::read_dir(dir.path())
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        assert!(
            names
                .iter()
                .all(|n| !n.contains("plain-old") && !n.contains("encrypting")),
            "{names:?}"
        );
        assert!(unlock(&path, "correct horse").is_ok());
    }

    #[test]
    fn a_failed_encryption_keeps_the_original_file() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("books.db");
        books_with_data(&path, None);
        assert_eq!(
            encrypt_existing(&path, "short").unwrap_err().code,
            ErrorCode::WeakPassword
        );
        assert_eq!(state(&path).unwrap(), BookState::Plain);
    }

    #[test]
    fn password_can_be_changed_with_the_current_one() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("books.db");
        books_with_data(&path, Some("first password"));
        let db = unlock(&path, "first password").unwrap();
        assert_eq!(
            change_password(&db, "not it", "second password").unwrap_err(),
            AppError::field(ErrorCode::WrongPassword, "currentPassword")
        );
        change_password(&db, "first password", "second password").unwrap();
        drop(db);
        assert!(unlock(&path, "first password").is_err());
        let db = unlock(&path, "second password").unwrap();
        assert!(crate::db::setup::status(&db.conn()).unwrap().completed);
    }
}
