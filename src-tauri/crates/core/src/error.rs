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
    /// 無効にしたマスタは新しい仕訳に使えない
    Inactive,
    /// 取引の借方合計と貸方合計が一致しない
    Unbalanced,
    /// 同じ科目が借方と貸方の両方にある
    SameAccount,
    /// 締めた年度には書き込めない
    YearClosed,
    /// データベースの読み書きに失敗した
    Database,
    /// 選んだ文字コード（Shift_JIS）で書けない文字がある
    Unencodable,
    /// PDF に使える日本語のフォントが PC に見つからない
    FontNotFound,
    /// ファイルを読めない（形式が違う、壊れている、開けない）
    FileRead,
    /// ファイルを保存できない
    FileWrite,
    /// 取込の内容に直すところが残っている
    ImportBlocked,
    /// 明細ファイルの行数が上限を超えた
    TooManyStatementRows,
    /// 少額減価償却資産の特例を適用できない
    SmallAssetIneligible,
    /// 少額減価償却資産の特例の年間上限を超えた
    SmallAssetLimit,
    /// 定型仕訳のその月の分は、もう記録してある（見送ってある）
    AlreadyRecorded,
    /// 定期売上のその月は請求書で請求している（入金は請求書に記録する）
    MonthInvoiced,
    /// OS の資格情報ストア（API キーの保管場所）を使えない
    SecretStore,
    /// レシートの読み取りの API キーが登録されていない
    NoApiKey,
    /// API キーが正しくない
    BadApiKey,
    /// 読み取りのサービスに接続できない
    Offline,
    /// 読み取りの回数の上限に達した
    RateLimited,
    /// 読み取りのサービスが混んでいる（しばらく待てば読める）
    ServiceBusy,
    /// 設定のモデルが読み取りのサービスにない（名前の間違い・提供の終了）
    ModelNotFound,
    /// 読み取りの 1 日の上限に達した、またはモデルが無料枠で使えない（待っても読めない）
    QuotaExhausted,
    /// 読み取りのサービスが画像を受け付けなかった、または返事が読めなかった
    ReadFailed,
    /// 画像を送ることへの同意がまだない
    ConsentRequired,
    /// 期首残高はもう確定している（直すときは確定を取り消す）
    OpeningConfirmed,
    /// 期首残高が入力途中のため、棚卸や繰越には使えない
    OpeningNotConfirmed,
    /// 締めた月・年の取引は追加・変更・削除できない
    MonthLocked,
    /// パスワードが違う
    WrongPassword,
    /// 復旧コードが現在の帳簿に使えない
    InvalidRecoveryCode,
    /// パスワード・復旧コードを続けて間違えたため、しばらく入力を受け付けない
    TooManyAttempts,
    /// 再設定するパスワードがいまのものと同じ
    SamePassword,
    /// パスワードが短すぎる
    WeakPassword,
    /// 帳簿がまだ開いていない（パスワードを入れる前）
    BooksLocked,
    /// バックアップのファイルが壊れている・帳簿のファイルでない・パスワードが合わない
    BackupInvalid,
    /// 復元すると法定保存の対象となる帳簿の変更履歴が失われる
    BackupMissingBookHistory,
    /// 発行した書類は書き換えられない（取り消して作り直す）
    DocumentIssued,
    /// 入金のある請求書は取り消せない
    HasPayments,
    /// 紐付いた請求書・入金と矛盾する仕訳変更
    LinkedPosting,
    /// 入金の前に、請求書の売上を記帳する
    SaleNotRecorded,
    /// メールの送信の設定がまだない
    MailNotConfigured,
    /// メールのサーバーにログインできない（アドレス・パスワードが違う）
    MailAuth,
    /// メールを送れなかった（つながらない・相手のアドレスが受け付けられない）
    MailFailed,
    /// カレンダーの承認が取り消されたか、期限が切れた
    CalendarAuth,
    /// ブラウザでの連携を取り消したか、制限時間を過ぎた
    CalendarCancelled,
    /// カレンダーサービスへの接続や同期が失敗した
    CalendarFailed,
    /// 端末の設定が古い（パスワードの変更や復元のあと）。設定し直す
    LoginExpired,
    /// Windows Hello・Touch ID などの本人確認が完了しなかった
    DeviceAuthFailed,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppError {
    pub code: ErrorCode,
    /// 問題のある入力欄（camelCase のキー）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub field: Option<&'static str>,
    /// 問題のある明細行（0 から数える）。仕訳の明細のエラーのときだけ
    #[serde(skip_serializing_if = "Option::is_none")]
    pub line: Option<usize>,
}

impl AppError {
    pub fn new(code: ErrorCode) -> Self {
        Self {
            code,
            field: None,
            line: None,
        }
    }

    pub fn field(code: ErrorCode, field: &'static str) -> Self {
        Self {
            code,
            field: Some(field),
            line: None,
        }
    }

    /// 明細行 `line` の入力欄 `field` のエラー。
    pub fn line(code: ErrorCode, line: usize, field: &'static str) -> Self {
        Self {
            code,
            field: Some(field),
            line: Some(line),
        }
    }
}

impl fmt::Display for AppError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match (self.field, self.line) {
            (Some(field), Some(line)) => write!(f, "{:?} ({field}, line {line})", self.code),
            (Some(field), None) => write!(f, "{:?} ({field})", self.code),
            _ => write!(f, "{:?}", self.code),
        }
    }
}

impl std::error::Error for AppError {}

#[cfg(feature = "rusqlite")]
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
        let json =
            serde_json::to_value(AppError::line(ErrorCode::SameAccount, 1, "accountId")).unwrap();
        assert_eq!(
            json,
            serde_json::json!({ "code": "sameAccount", "field": "accountId", "line": 1 })
        );
    }
}
