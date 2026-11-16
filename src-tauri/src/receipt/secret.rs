//! API キーの保管。OS の資格情報ストア（Windows の資格情報マネージャー、macOS のキーチェーン）に置く。
//! DB・ファイル・ログ・画面には出さない（画面には「登録済みかどうか」だけを返す）。

use crate::error::{AppError, AppResult, ErrorCode};

const SERVICE: &str = "jp.dcs.accounting";
const GEMINI_KEY: &str = "gemini-api-key";

/// 秘密の値を出し入れするところ。テストでは偽物に差し替える。
pub trait SecretStore {
    fn get(&self) -> AppResult<Option<String>>;
    fn set(&self, value: &str) -> AppResult<()>;
    fn delete(&self) -> AppResult<()>;
}

/// OS の資格情報ストア。
pub struct Keyring;

fn entry() -> AppResult<keyring::Entry> {
    keyring::Entry::new(SERVICE, GEMINI_KEY).map_err(|_| AppError::new(ErrorCode::SecretStore))
}

impl SecretStore for Keyring {
    fn get(&self) -> AppResult<Option<String>> {
        match entry()?.get_password() {
            Ok(value) => Ok(Some(value)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(_) => Err(AppError::new(ErrorCode::SecretStore)),
        }
    }

    fn set(&self, value: &str) -> AppResult<()> {
        entry()?
            .set_password(value)
            .map_err(|_| AppError::new(ErrorCode::SecretStore))
    }

    fn delete(&self) -> AppResult<()> {
        match entry()?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(_) => Err(AppError::new(ErrorCode::SecretStore)),
        }
    }
}

/// 登録する API キーを確かめる。前後の空白を除き、使える文字だけか見る。
pub fn validate_key(key: &str) -> AppResult<String> {
    let key = key.trim();
    if key.is_empty() {
        return Err(AppError::field(ErrorCode::Required, "apiKey"));
    }
    if key.len() > 200
        || !key
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        return Err(AppError::field(ErrorCode::InvalidFormat, "apiKey"));
    }
    Ok(key.to_string())
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use std::sync::Mutex;

    /// テスト用の保管場所（メモリの中）。
    #[derive(Default)]
    pub(crate) struct MemoryStore(pub Mutex<Option<String>>);

    impl SecretStore for MemoryStore {
        fn get(&self) -> AppResult<Option<String>> {
            Ok(self.0.lock().unwrap().clone())
        }
        fn set(&self, value: &str) -> AppResult<()> {
            *self.0.lock().unwrap() = Some(value.to_string());
            Ok(())
        }
        fn delete(&self) -> AppResult<()> {
            *self.0.lock().unwrap() = None;
            Ok(())
        }
    }

    #[test]
    fn keys_are_checked_before_saving() {
        assert_eq!(validate_key("  AIza-abc_123  ").unwrap(), "AIza-abc_123");
        assert_eq!(
            validate_key(" ").unwrap_err(),
            AppError::field(ErrorCode::Required, "apiKey")
        );
        assert_eq!(
            validate_key("abc def").unwrap_err(),
            AppError::field(ErrorCode::InvalidFormat, "apiKey")
        );
        let store = MemoryStore::default();
        store.set("k").unwrap();
        assert_eq!(store.get().unwrap().as_deref(), Some("k"));
        store.delete().unwrap();
        assert_eq!(store.get().unwrap(), None);
    }
}
