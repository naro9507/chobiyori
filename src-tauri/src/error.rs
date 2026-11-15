//! 画面に返すエラー。
//!
//! 画面は `code` を見て文言を選び、`field` があればその入力欄に表示する。
//! 文言そのものは画面側（i18n）に置く。ここでは個人名や金額をエラーに含めない。

use serde::Serialize;
use std::fmt;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ErrorCode {
    /// 必須の項目が空
    Required,
    /// 長すぎる
    TooLong,
    /// 形式が正しくない（コードに使えない文字、登録番号の桁数など）
    InvalidFormat,
    /// 範囲外の値（割合が 0〜100 でない、年度が範囲外など）
    OutOfRange,
    /// 同じコードがすでにある
    DuplicateCode,
    /// 対象が見つからない
    NotFound,
    /// 仕訳などで使われているので削除できない
    InUse,
    /// 標準の科目なので削除や区分の変更ができない
    SystemAccount,
    /// 初期設定はすでに終わっている
    AlreadySetUp,
    /// 初期設定がまだ終わっていない
    NotSetUp,
    /// データベースの読み書きに失敗した
    Database,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppError {
    pub code: ErrorCode,
    /// 問題のある入力欄（camelCase のキー）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub field: Option<&'static str>,
}

impl AppError {
    pub fn new(code: ErrorCode) -> Self {
        Self { code, field: None }
    }

    pub fn field(code: ErrorCode, field: &'static str) -> Self {
        Self {
            code,
            field: Some(field),
        }
    }
}

impl fmt::Display for AppError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self.field {
            Some(field) => write!(f, "{:?} ({field})", self.code),
            None => write!(f, "{:?}", self.code),
        }
    }
}

impl std::error::Error for AppError {}

impl From<rusqlite::Error> for AppError {
    fn from(error: rusqlite::Error) -> Self {
        use rusqlite::ffi;
        if let rusqlite::Error::SqliteFailure(failure, _) = &error {
            match failure.extended_code {
                ffi::SQLITE_CONSTRAINT_UNIQUE | ffi::SQLITE_CONSTRAINT_PRIMARYKEY => {
                    return AppError::field(ErrorCode::DuplicateCode, "code");
                }
                ffi::SQLITE_CONSTRAINT_FOREIGNKEY | ffi::SQLITE_CONSTRAINT_TRIGGER => {
                    return AppError::new(ErrorCode::InUse);
                }
                _ => {}
            }
        }
        if matches!(error, rusqlite::Error::QueryReturnedNoRows) {
            return AppError::new(ErrorCode::NotFound);
        }
        // 詳細は開発時のログにだけ出す。SQL の値（名前や金額）は含めない
        eprintln!("データベースのエラー: {error}");
        AppError::new(ErrorCode::Database)
    }
}

pub type AppResult<T> = Result<T, AppError>;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn serializes_code_and_field_in_camel_case() {
        let json = serde_json::to_value(AppError::field(ErrorCode::DuplicateCode, "code")).unwrap();
        assert_eq!(
            json,
            serde_json::json!({ "code": "duplicateCode", "field": "code" })
        );
        let json = serde_json::to_value(AppError::new(ErrorCode::InUse)).unwrap();
        assert_eq!(json, serde_json::json!({ "code": "inUse" }));
    }
}
