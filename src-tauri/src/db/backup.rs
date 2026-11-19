//! バックアップと復元。
//!
//! バックアップは帳簿全体（証憑の画像も含む）を 1 つのファイルにしたもの。帳簿と同じパスワードで
//! 暗号化する。終了するときに、前のバックアップから変更があれば自動で作り、自動の分は新しい順に
//! `AUTO_KEEP` 個だけ残す（手で作った分は消さない）。帳簿のデータは PC の外には送らない。
//!
//! 復元は、選んだバックアップを開けるか・壊れていないかを確かめてから、いまの帳簿のバックアップを
//! 作り、そのあとで入れ替える。復元した帳簿のパスワードは、いまのパスワードにそろえる。

use super::vault::{export_to, fingerprint, side_files, Password};
use super::{audit, connect, migrate, Database, MIGRATIONS};
use crate::error::{AppError, AppResult, ErrorCode};
use rusqlite::Connection;
use serde::Serialize;
use std::path::{Path, PathBuf};

/// 自動のバックアップを残す数。
pub const AUTO_KEEP: usize = 7;
/// バックアップのファイルの拡張子。
pub const EXTENSION: &str = "chobiyori-backup";
pub const LEGACY_EXTENSION: &str = "dcsbackup";
/// 保存先の設定のキー（`settings` 表）。
const DIR_SETTING: &str = "backup_dir";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum BackupKind {
    /// 終了するときに自動で作った
    Auto,
    /// 手で作った
    Manual,
    /// 復元の前に、それまでの帳簿を残した
    BeforeRestore,
}

impl BackupKind {
    fn prefix(self) -> &'static str {
        match self {
            Self::Auto => "auto",
            Self::Manual => "manual",
            Self::BeforeRestore => "before-restore",
        }
    }

    fn of(name: &str) -> Option<Self> {
        [Self::Auto, Self::Manual, Self::BeforeRestore]
            .into_iter()
            .find(|k| name.starts_with(&format!("books-{}-", k.prefix())))
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupFile {
    pub name: String,
    pub kind: BackupKind,
    /// 作った日時（ファイル名から。`YYYY-MM-DD HH:MM:SS`、PC の時刻）
    pub created_at: String,
    pub size: u64,
}

/// 保存先。設定がなければ `default_dir`（アプリのデータフォルダの `backups`）。
pub fn dir(conn: &Connection, default_dir: &Path) -> AppResult<PathBuf> {
    let saved: Option<String> = rusqlite::OptionalExtension::optional(conn.query_row(
        "SELECT value FROM settings WHERE key = ?1",
        [DIR_SETTING],
        |r| r.get(0),
    ))?;
    Ok(saved.map_or_else(|| default_dir.to_path_buf(), PathBuf::from))
}

/// 保存先を変える。None で既定に戻す。
pub fn set_dir(conn: &Connection, dir: Option<&Path>) -> AppResult<()> {
    match dir {
        Some(dir) => {
            let text = dir.to_str().ok_or(AppError::new(ErrorCode::FileWrite))?;
            conn.execute(
                "INSERT INTO settings (key, value) VALUES (?1, ?2)
                 ON CONFLICT (key) DO UPDATE SET value = excluded.value",
                [DIR_SETTING, text],
            )?;
        }
        None => {
            conn.execute("DELETE FROM settings WHERE key = ?1", [DIR_SETTING])?;
        }
    }
    Ok(())
}

/// PC の時刻で、ファイル名に使う日時（`YYYYMMDD-HHMMSS`）。
fn timestamp(conn: &Connection) -> AppResult<String> {
    Ok(conn.query_row(
        "SELECT strftime('%Y%m%d-%H%M%S', 'now', 'localtime')",
        [],
        |r| r.get(0),
    )?)
}

/// バックアップを作る。作ったファイルの名前を返す。
pub fn create(db: &Database, dir: &Path, kind: BackupKind) -> AppResult<String> {
    std::fs::create_dir_all(dir).map_err(|_| AppError::new(ErrorCode::FileWrite))?;
    let name = {
        let conn = db.conn();
        let key = db.key();
        let mut name = format!("books-{}-{}.{EXTENSION}", kind.prefix(), timestamp(&conn)?);
        // 同じ秒に 2 回作ったときは番号を付ける
        let mut n = 2;
        while dir.join(&name).exists() {
            name = format!(
                "books-{}-{}-{n}.{EXTENSION}",
                kind.prefix(),
                timestamp(&conn)?
            );
            n += 1;
        }
        export_to(&conn, &dir.join(&name), key.as_ref())?;
        name
    };
    db.mark_backed_up();
    if kind == BackupKind::Auto {
        prune(dir)?;
    }
    Ok(name)
}

/// 終了するときのバックアップ。前のバックアップから変更がなければ作らない。
pub fn auto(db: &Database, dir: &Path) -> AppResult<Option<String>> {
    if !db.changed_since_backup() {
        return Ok(None);
    }
    create(db, dir, BackupKind::Auto).map(Some)
}

/// 保存先のバックアップの一覧。新しい順。
pub fn list(dir: &Path) -> AppResult<Vec<BackupFile>> {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return Ok(Vec::new());
    };
    let mut files: Vec<BackupFile> = entries
        .flatten()
        .filter_map(|e| {
            let name = e.file_name().to_string_lossy().into_owned();
            let kind = BackupKind::of(&name)?;
            if !name.ends_with(&format!(".{EXTENSION}"))
                && !name.ends_with(&format!(".{LEGACY_EXTENSION}"))
            {
                return None;
            }
            let stamp = name
                .trim_start_matches(&format!("books-{}-", kind.prefix()))
                .get(..15)?
                .to_string();
            let created_at = format!(
                "{}-{}-{} {}:{}:{}",
                stamp.get(0..4)?,
                stamp.get(4..6)?,
                stamp.get(6..8)?,
                stamp.get(9..11)?,
                stamp.get(11..13)?,
                stamp.get(13..15)?
            );
            Some(BackupFile {
                size: e.metadata().map(|m| m.len()).unwrap_or(0),
                name,
                kind,
                created_at,
            })
        })
        .collect();
    files.sort_by(|a, b| b.name.cmp(&a.name).then(b.created_at.cmp(&a.created_at)));
    files.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    Ok(files)
}

/// 自動のバックアップを、新しい `AUTO_KEEP` 個だけ残す。
fn prune(dir: &Path) -> AppResult<()> {
    for old in list(dir)?
        .into_iter()
        .filter(|f| f.kind == BackupKind::Auto)
        .skip(AUTO_KEEP)
    {
        let _ = std::fs::remove_file(dir.join(old.name));
    }
    Ok(())
}

/// 復元する前に見せる、バックアップの中身。
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupSummary {
    pub transactions: i64,
    pub fiscal_years: Vec<i64>,
    pub trade_name: String,
}

/// バックアップを開いて確かめる。開けない・壊れている・このアプリより新しい版のものなら
/// `BackupInvalid`（パスワード違いもこれに含む）。
fn open_backup(path: &Path, password: Option<&Password>) -> AppResult<Connection> {
    let invalid = || AppError::field(ErrorCode::BackupInvalid, "password");
    // 書き出し（新しいファイルへの ATTACH）にも使うので、作る権限も付けて開く。
    // ないファイルを作ってしまわないよう、先にあるかを確かめる。中身は書き換えない
    if !path.is_file() {
        return Err(invalid());
    }
    let conn = Connection::open(path).map_err(|_| invalid())?;
    if let Some(password) = password {
        conn.pragma_update(None, "key", password.as_str())
            .map_err(|_| invalid())?;
    }
    let ok: String = conn
        .query_row("PRAGMA integrity_check", [], |r| r.get(0))
        .map_err(|_| invalid())?;
    let version: i64 = conn
        .pragma_query_value(None, "user_version", |r| r.get(0))
        .map_err(|_| invalid())?;
    let has_books: bool = conn
        .query_row(
            "SELECT EXISTS (SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'transactions')",
            [],
            |r| r.get(0),
        )
        .map_err(|_| invalid())?;
    if ok != "ok" || !has_books || version < 1 || version as usize > MIGRATIONS.len() {
        return Err(invalid());
    }
    Ok(conn)
}

pub fn inspect(path: &Path, password: Option<&str>) -> AppResult<BackupSummary> {
    let conn = open_backup(path, password.map(Password::new).as_ref())?;
    let transactions = conn.query_row("SELECT count(*) FROM transactions", [], |r| r.get(0))?;
    let mut stmt = conn.prepare("SELECT year FROM fiscal_years ORDER BY year")?;
    let fiscal_years = stmt
        .query_map([], |r| r.get(0))?
        .collect::<Result<_, _>>()?;
    let trade_name: String = rusqlite::OptionalExtension::optional(conn.query_row(
        "SELECT CASE WHEN trade_name = '' THEN owner_name ELSE trade_name END FROM business_profile WHERE id = 1",
        [],
        |r| r.get(0),
    ))?
    .unwrap_or_default();
    Ok(BackupSummary {
        transactions,
        fiscal_years,
        trade_name,
    })
}

/// バックアップから復元する。`password` はそのバックアップを作ったときのパスワード
/// （None ならいまのパスワード）。入れ替える前に、いまの帳簿のバックアップを `dir` に作る。
pub fn restore(db: &Database, source: &Path, password: Option<&str>, dir: &Path) -> AppResult<()> {
    let Some(path) = db.path().map(Path::to_path_buf) else {
        return Err(AppError::new(ErrorCode::FileWrite));
    };
    let key = db.key();
    let source_key = password.map(Password::new).or_else(|| key.clone());
    // 1. バックアップを確かめ、いまのパスワードで暗号化した写しを作る
    let incoming = path.with_extension("db.restoring");
    {
        let conn = open_backup(source, source_key.as_ref())?;
        let expected = fingerprint(&conn)?;
        export_to(&conn, &incoming, key.as_ref())?;
        let copy = connect(&incoming, key.as_ref().map(Password::as_str))?;
        if fingerprint(&copy)? != expected {
            drop(copy);
            let _ = std::fs::remove_file(&incoming);
            return Err(AppError::new(ErrorCode::BackupInvalid));
        }
        // Imported device enrollments cannot authorize this installation.
        copy.execute(
            "DELETE FROM settings WHERE key=?1",
            [super::vault::DEVICE_BINDING],
        )?;
        copy.execute_batch("PRAGMA wal_checkpoint(TRUNCATE)")?;
    }
    // 2. いまの帳簿を残す
    create(db, dir, BackupKind::BeforeRestore)?;

    // 3. 入れ替える。接続を閉じている間は、ほかの処理を待たせる
    let old = path.with_extension("db.replaced");
    let mut guard = db.conn();
    let checkpoint: i64 =
        guard.query_row("PRAGMA wal_checkpoint(TRUNCATE)", [], |row| row.get(0))?;
    if checkpoint != 0 {
        let _ = std::fs::remove_file(&incoming);
        return Err(AppError::new(ErrorCode::FileWrite));
    }
    *guard = Connection::open_in_memory()?;
    for side in side_files(&path) {
        let _ = std::fs::remove_file(side);
    }
    let reopen = |file: &Path| -> AppResult<Connection> {
        let conn = connect(file, key.as_ref().map(Password::as_str))?;
        migrate(&conn)?;
        Ok(conn)
    };
    if std::fs::rename(&path, &old).is_err() {
        *guard = reopen(&path)?;
        let _ = std::fs::remove_file(&incoming);
        return Err(AppError::new(ErrorCode::FileWrite));
    }
    let swapped = std::fs::rename(&incoming, &path)
        .map_err(|_| AppError::new(ErrorCode::FileWrite))
        .and_then(|()| reopen(&path));
    match swapped {
        Ok(conn) => {
            *guard = conn;
            let _ = std::fs::remove_file(&old);
            for side in side_files(&old) {
                let _ = std::fs::remove_file(side);
            }
            audit::event(
                &guard,
                "books",
                "restore",
                None,
                source
                    .file_name()
                    .map(|n| serde_json::json!({ "file": n.to_string_lossy() })),
            )?;
            drop(guard);
            db.mark_backed_up();
            Ok(())
        }
        Err(error) => {
            // 元に戻す
            let _ = std::fs::remove_file(&path);
            let _ = std::fs::rename(&old, &path);
            if let Ok(conn) = reopen(&path) {
                *guard = conn;
            }
            let _ = std::fs::remove_file(&incoming);
            Err(error)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::setup::tests::input;
    use crate::db::transactions::tests::{account, entry};
    use crate::db::{setup, transactions, vault};

    fn books(dir: &Path) -> Database {
        let path = dir.join("books.db");
        let db = vault::create(&path, "correct horse").unwrap();
        setup::complete(&db, &input()).unwrap();
        db
    }

    fn count(db: &Database) -> i64 {
        db.conn()
            .query_row("SELECT count(*) FROM transactions", [], |r| r.get(0))
            .unwrap()
    }

    fn add(db: &Database, amount: i64) {
        let (cash, supplies) = {
            let conn = db.conn();
            (account(&conn, "101"), account(&conn, "610"))
        };
        transactions::create(db, 2026, &entry("2026-03-01", supplies, cash, amount)).unwrap();
    }

    #[test]
    fn legacy_backups_remain_listed() {
        let dir = tempfile::tempdir().unwrap();
        let backups = dir.path().join("backups");
        let db = books(dir.path());
        let created = create(&db, &backups, BackupKind::Manual).unwrap();
        let legacy = created.replace(EXTENSION, LEGACY_EXTENSION);
        std::fs::rename(backups.join(&created), backups.join(&legacy)).unwrap();
        assert_eq!(list(&backups).unwrap()[0].name, legacy);
    }

    #[test]
    fn backups_are_encrypted_and_restore_brings_the_books_back() {
        let dir = tempfile::tempdir().unwrap();
        let backups = dir.path().join("backups");
        let db = books(dir.path());
        add(&db, 1000);
        db.conn()
            .execute(
                "INSERT INTO settings VALUES (?1,'old')",
                [vault::DEVICE_BINDING],
            )
            .unwrap();
        let name = create(&db, &backups, BackupKind::Manual).unwrap();
        let file = backups.join(&name);
        assert_eq!(vault::state(&file).unwrap(), vault::BookState::Encrypted);
        assert_eq!(
            inspect(&file, Some("wrong one")).unwrap_err().code,
            ErrorCode::BackupInvalid
        );
        let summary = inspect(&file, Some("correct horse")).unwrap();
        assert_eq!(
            (summary.transactions, summary.fiscal_years),
            (1, vec![2026])
        );

        // バックアップのあとに 2 件足し、復元すると 1 件に戻る
        add(&db, 2000);
        add(&db, 3000);
        assert_eq!(count(&db), 3);
        restore(&db, &file, None, &backups).unwrap();
        assert_eq!(count(&db), 1);
        assert_eq!(
            db.conn()
                .query_row(
                    "SELECT count(*) FROM settings WHERE key=?1",
                    [vault::DEVICE_BINDING],
                    |row| row.get::<_, i64>(0)
                )
                .unwrap(),
            0
        );
        // 復元の前の帳簿は残っている
        let files = list(&backups).unwrap();
        let before = files
            .iter()
            .find(|f| f.kind == BackupKind::BeforeRestore)
            .unwrap();
        assert_eq!(
            inspect(&backups.join(&before.name), Some("correct horse"))
                .unwrap()
                .transactions,
            3
        );
        // 復元しても同じパスワードで開ける。復元したことは履歴に残る
        let path = db.path().unwrap().to_path_buf();
        drop(db);
        let db = vault::unlock(&path, "correct horse").unwrap();
        let log = super::super::audit::list(&db.conn(), None, 5).unwrap();
        assert_eq!(log[0].action, "restore");
    }

    #[test]
    fn a_backup_made_with_another_password_is_rekeyed_on_restore() {
        let dir = tempfile::tempdir().unwrap();
        let other = tempfile::tempdir().unwrap();
        let backups = dir.path().join("backups");
        // 別のパスワードの帳簿のバックアップ
        let old = books(other.path());
        vault::change_password(&old, "correct horse", "old password").unwrap();
        add(&old, 500);
        let name = create(&old, &backups, BackupKind::Manual).unwrap();

        let db = books(dir.path());
        assert_eq!(
            restore(&db, &backups.join(&name), None, &backups)
                .unwrap_err()
                .code,
            ErrorCode::BackupInvalid
        );
        assert_eq!(count(&db), 0);
        restore(&db, &backups.join(&name), Some("old password"), &backups).unwrap();
        assert_eq!(count(&db), 1);
        let path = db.path().unwrap().to_path_buf();
        drop(db);
        assert!(vault::unlock(&path, "correct horse").is_ok());
    }

    #[test]
    fn broken_files_are_not_restored() {
        let dir = tempfile::tempdir().unwrap();
        let backups = dir.path().join("backups");
        let db = books(dir.path());
        add(&db, 1000);
        let junk = dir.path().join("junk.dcsbackup");
        std::fs::write(&junk, b"not a database").unwrap();
        assert_eq!(
            restore(&db, &junk, None, &backups).unwrap_err().code,
            ErrorCode::BackupInvalid
        );
        assert_eq!(count(&db), 1);
        // 何も残らない（作りかけのファイルも）
        assert!(list(&backups).unwrap().is_empty());
    }

    #[test]
    fn automatic_backups_skip_unchanged_books_and_keep_seven() {
        let dir = tempfile::tempdir().unwrap();
        let backups = dir.path().join("backups");
        let db = books(dir.path());
        db.mark_backed_up();
        assert_eq!(auto(&db, &backups).unwrap(), None);
        for n in 0..9 {
            add(&db, 100 + n);
            // ファイル名は秒までなので、同じ秒でも重ならないようにする
            assert!(auto(&db, &backups).unwrap().is_some());
        }
        assert_eq!(auto(&db, &backups).unwrap(), None);
        let autos = list(&backups)
            .unwrap()
            .into_iter()
            .filter(|f| f.kind == BackupKind::Auto)
            .count();
        assert_eq!(autos, AUTO_KEEP);
        create(&db, &backups, BackupKind::Manual).unwrap();
        assert_eq!(list(&backups).unwrap().len(), AUTO_KEEP + 1);
    }

    #[test]
    fn backup_folder_can_be_changed() {
        let db = Database::open_in_memory().unwrap();
        let default = Path::new("/tmp/default");
        assert_eq!(dir(&db.conn(), default).unwrap(), default);
        set_dir(&db.conn(), Some(Path::new("/media/usb/books"))).unwrap();
        assert_eq!(
            dir(&db.conn(), default).unwrap(),
            Path::new("/media/usb/books")
        );
        set_dir(&db.conn(), None).unwrap();
        assert_eq!(dir(&db.conn(), default).unwrap(), default);
    }
}
