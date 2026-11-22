//! 復旧コードで保護した帳簿の鍵情報。コードは発行時だけ画面に返す。

use super::{vault, Database};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use chobiyori_core::error::{AppError, AppResult, ErrorCode};
use ring::aead::{Aad, LessSafeKey, Nonce, UnboundKey, AES_256_GCM, NONCE_LEN};
use ring::rand::{SecureRandom, SystemRandom};
use std::fs::File;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

const CODE_BYTES: usize = 32;
const MAX_RECORD_BYTES: usize = 1024;
const CONTEXT: &[u8] = b"chobiyori-books-recovery-v1";

fn record_path(path: &Path) -> PathBuf {
    path.with_extension("db.recovery")
}

pub fn is_issued(path: &Path) -> bool {
    record_path(path).is_file()
}

fn invalid_code() -> AppError {
    AppError::field(ErrorCode::InvalidRecoveryCode, "recoveryCode")
}

fn encryption_key(bytes: &[u8]) -> LessSafeKey {
    LessSafeKey::new(UnboundKey::new(&AES_256_GCM, bytes).expect("32-byte recovery key"))
}

/// いまのパスワードを確認してから、復旧コードを新しく発行する。
pub fn issue(db: &Database, current: &str) -> AppResult<String> {
    let path = db
        .path()
        .ok_or_else(|| AppError::new(ErrorCode::BooksLocked))?;
    let _conn = db.conn();
    let password = vault::check_current(db, current)?;
    let write_error = |_| AppError::new(ErrorCode::FileWrite);
    let crypto_error = |_| AppError::new(ErrorCode::FileWrite);
    let random = SystemRandom::new();
    let mut code = [0; CODE_BYTES];
    let mut nonce = [0; NONCE_LEN];
    random.fill(&mut code).map_err(crypto_error)?;
    random.fill(&mut nonce).map_err(crypto_error)?;
    let mut ciphertext = password.as_str().as_bytes().to_vec();
    encryption_key(&code)
        .seal_in_place_append_tag(
            Nonce::assume_unique_for_key(nonce),
            Aad::from(CONTEXT),
            &mut ciphertext,
        )
        .map_err(crypto_error)?;

    // 書き込み途中のファイルで、それまでの鍵情報を上書きしない。
    let dest = record_path(path);
    let parent = dest
        .parent()
        .ok_or_else(|| AppError::new(ErrorCode::FileWrite))?;
    let mut pending = tempfile::NamedTempFile::new_in(parent).map_err(write_error)?;
    pending.write_all(&nonce).map_err(write_error)?;
    pending.write_all(&ciphertext).map_err(write_error)?;
    pending.as_file().sync_all().map_err(write_error)?;
    pending
        .persist(dest)
        .map_err(|_| AppError::new(ErrorCode::FileWrite))?;
    Ok(URL_SAFE_NO_PAD.encode(code))
}

/// パスワードが変わったあとに、以前の鍵情報を片付ける。
pub(super) fn discard(path: &Path) {
    let _ = std::fs::remove_file(record_path(path));
}

fn recover_password(path: &Path, code: &str) -> AppResult<String> {
    let code = code.trim();
    if code.len() != 43 {
        return Err(invalid_code());
    }
    let key_bytes: [u8; CODE_BYTES] = URL_SAFE_NO_PAD
        .decode(code)
        .map_err(|_| invalid_code())?
        .try_into()
        .map_err(|_| invalid_code())?;

    let file = File::open(record_path(path)).map_err(|error| {
        if error.kind() == std::io::ErrorKind::NotFound {
            invalid_code()
        } else {
            AppError::new(ErrorCode::FileRead)
        }
    })?;
    let mut record = Vec::new();
    file.take(MAX_RECORD_BYTES as u64 + 1)
        .read_to_end(&mut record)
        .map_err(|_| AppError::new(ErrorCode::FileRead))?;
    if record.len() > MAX_RECORD_BYTES {
        return Err(invalid_code());
    }
    let (nonce, ciphertext) = record
        .split_first_chunk_mut::<NONCE_LEN>()
        .ok_or_else(invalid_code)?;
    let plaintext = encryption_key(&key_bytes)
        .open_in_place(
            Nonce::assume_unique_for_key(*nonce),
            Aad::from(CONTEXT),
            ciphertext,
        )
        .map_err(|_| invalid_code())?;
    String::from_utf8(plaintext.to_vec()).map_err(|_| invalid_code())
}

pub fn reset(path: &Path, code: &str, new: &str) -> AppResult<Database> {
    vault::validate_new(new).map_err(|error| AppError::field(error.code, "newPassword"))?;
    if vault::state(path)? != vault::BookState::Encrypted {
        return Err(invalid_code());
    }
    let current = recover_password(path, code)?;
    let db = vault::unlock(path, &current).map_err(|error| {
        if error.code == ErrorCode::WrongPassword {
            invalid_code()
        } else {
            error
        }
    })?;
    if current == new {
        return Err(AppError::field(ErrorCode::SamePassword, "newPassword"));
    }
    db.conn()
        .execute("DELETE FROM settings WHERE key=?1", [vault::DEVICE_BINDING])?;
    vault::change_password(&db, &current, new)?;
    Ok(db)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resets_existing_books_without_losing_data_and_consumes_the_code() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("books.db");
        let current = "最初のパスワード";
        let db = vault::create(&path, current).unwrap();
        db.conn()
            .execute(
                "INSERT INTO settings (key, value) VALUES ('test', 'kept')",
                [],
            )
            .unwrap();
        assert_eq!(
            issue(&db, "wrong").unwrap_err().code,
            ErrorCode::WrongPassword
        );
        db.conn()
            .execute(
                "INSERT INTO settings VALUES (?1, 'device')",
                [vault::DEVICE_BINDING],
            )
            .unwrap();
        let earlier = issue(&db, current).unwrap();
        let code = issue(&db, current).unwrap();
        drop(db);

        assert_eq!(
            reset(&path, &earlier, "second password").unwrap_err(),
            invalid_code()
        );
        assert_eq!(
            reset(&path, &code, "short").unwrap_err().code,
            ErrorCode::WeakPassword
        );
        assert_eq!(
            reset(&path, &code, current).unwrap_err().code,
            ErrorCode::SamePassword
        );
        let db = reset(&path, &format!(" {code}\n"), "second password").unwrap();
        let value: String = db
            .conn()
            .query_row("SELECT value FROM settings WHERE key = 'test'", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(value, "kept");
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
        drop(db);
        assert!(!record_path(&path).exists());
        assert_eq!(
            reset(&path, &code, "third password").unwrap_err(),
            invalid_code()
        );
        assert!(vault::unlock(&path, current).is_err());
        assert!(vault::unlock(&path, "second password").is_ok());
    }

    #[test]
    fn changing_the_password_invalidates_the_code() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("books.db");
        let db = vault::create(&path, "first password").unwrap();
        let code = issue(&db, "first password").unwrap();
        vault::change_password(&db, "first password", "second password").unwrap();
        drop(db);
        assert_eq!(
            reset(&path, &code, "third password").unwrap_err(),
            invalid_code()
        );
    }
}
