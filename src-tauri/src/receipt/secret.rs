//! API キーの保管。OS の資格情報ストア（Windows の資格情報マネージャー、macOS のキーチェーン）に置く。
//! DB・ファイル・ログ・画面には出さない（画面には「登録済みかどうか」だけを返す）。

use std::sync::{Arc, LazyLock};

#[cfg(target_os = "macos")]
use apple_native_keyring_store::keychain::Store as NativeStore;
use chobiyori_core::error::{AppError, AppResult, ErrorCode};
#[cfg(not(any(target_os = "macos", target_os = "linux", windows)))]
use keyring::mock::Store as NativeStore;
#[cfg(target_os = "linux")]
use linux_keyutils_keyring_store::Store as NativeStore;
#[cfg(windows)]
use windows_native_keyring_store::Store as NativeStore;

const SERVICE: &str = "jp.dcs.accounting";
const GEMINI_KEY: &str = "gemini-api-key";

/// 秘密の値を出し入れするところ。テストでは偽物に差し替える。
pub trait SecretStore {
    fn get(&self) -> AppResult<Option<String>>;
    fn set(&self, value: &str) -> AppResult<()>;
    fn delete(&self) -> AppResult<()>;
}

/// OS の資格情報ストアの Gemini の API キー。
pub struct Keyring;

/// メールの送信に使うパスワード（請求書のメール送信、F11）。
pub const SMTP_PASSWORD: &str = "smtp-password";

/// OS の資格情報ストアの、名前 `0` の項目。
pub struct KeyringItem<'a>(pub &'a str);

fn entry() -> AppResult<keyring::Entry> {
    entry_for(GEMINI_KEY)
}

fn entry_for(name: &str) -> AppResult<keyring::Entry> {
    static STORE: LazyLock<AppResult<Arc<keyring::CredentialStore>>> = LazyLock::new(|| {
        let store = NativeStore::new().map_err(|_| AppError::new(ErrorCode::SecretStore))?;
        Ok(store)
    });

    // keyring v3 が保存した項目を引き続き参照する。
    #[cfg(target_os = "linux")]
    let description = format!("keyring-rs:{name}@{SERVICE}");
    #[cfg(target_os = "linux")]
    let modifiers = Some(std::collections::HashMap::from([(
        "description",
        description.as_str(),
    )]));
    #[cfg(not(target_os = "linux"))]
    let modifiers = None;

    STORE
        .as_ref()
        .map_err(Clone::clone)?
        .build(SERVICE, name, modifiers.as_ref())
        .map_err(|_| AppError::new(ErrorCode::SecretStore))
}

impl KeyringItem<'_> {
    // OAuth の更新トークンは長いため、Windows の資格情報に UTF-8 バイト列で置く。
    pub fn get_bytes(&self) -> AppResult<Option<Vec<u8>>> {
        match entry_for(self.0)?.get_secret() {
            Ok(value) => Ok(Some(value)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(_) => Err(AppError::new(ErrorCode::SecretStore)),
        }
    }

    pub fn set_bytes(&self, value: &[u8]) -> AppResult<()> {
        entry_for(self.0)?
            .set_secret(value)
            .map_err(|_| AppError::new(ErrorCode::SecretStore))
    }
}

impl SecretStore for KeyringItem<'_> {
    fn get(&self) -> AppResult<Option<String>> {
        match entry_for(self.0)?.get_password() {
            Ok(value) => Ok(Some(value)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(_) => Err(AppError::new(ErrorCode::SecretStore)),
        }
    }

    fn set(&self, value: &str) -> AppResult<()> {
        entry_for(self.0)?
            .set_password(value)
            .map_err(|_| AppError::new(ErrorCode::SecretStore))
    }

    fn delete(&self) -> AppResult<()> {
        match entry_for(self.0)?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(_) => Err(AppError::new(ErrorCode::SecretStore)),
        }
    }
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
