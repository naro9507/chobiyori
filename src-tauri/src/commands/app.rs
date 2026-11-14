//! アプリ自体の情報を返すコマンド。

use serde::Serialize;

/// 画面に表示するアプリの情報。
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    pub name: String,
    pub version: String,
}

impl AppInfo {
    /// ビルド時の Cargo.toml の値から作る。
    pub fn current() -> Self {
        Self {
            name: env!("CARGO_PKG_NAME").to_string(),
            version: env!("CARGO_PKG_VERSION").to_string(),
        }
    }
}

/// アプリ名とバージョンを返す。画面とバックエンドの接続確認にも使う。
#[tauri::command]
pub fn app_info() -> AppInfo {
    AppInfo::current()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn app_info_matches_cargo_metadata() {
        let info = app_info();
        assert_eq!(info.name, "dcs-accounting");
        assert_eq!(info.version, env!("CARGO_PKG_VERSION"));
    }

    #[test]
    fn app_info_serializes_with_camel_case_keys() {
        let json = serde_json::to_value(AppInfo {
            name: "dcs-accounting".into(),
            version: "0.1.0".into(),
        })
        .unwrap();
        assert_eq!(
            json,
            serde_json::json!({ "name": "dcs-accounting", "version": "0.1.0" })
        );
    }
}
