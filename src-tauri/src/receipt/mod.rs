//! レシートの読み取り（外の AI に画像を送る部分）と、API キーの保管。
//!
//! 読み取りは `ReceiptReader` の向こうに置き、Gemini 以外にも差し替えられるようにする。
//! テストでは本物の API を呼ばず、決まった返事を返す偽物を使う。
//! 送るのはレシートの画像と指示の文だけ。帳簿・取引先・顧客名は送らない。

pub mod gemini;
pub mod secret;

/// 読み取りに失敗した理由。画面はこれを見て文を選ぶ。キーや画像の中身は入れない。
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ReadError {
    /// API キーが登録されていない
    NoKey,
    /// API キーが正しくない・使えない
    BadKey,
    /// 接続できない（オフラインなど）。あとでまとめて読み直す
    Offline,
    /// 回数の上限に達した。`retry_after` 秒たってから読み直す
    RateLimited { retry_after: Option<u64> },
    /// 送った画像を受け付けなかった（形式・大きさ）
    Rejected,
    /// 返事の形が違う
    BadResponse,
}

/// 画像を読み、指定の形の JSON（文字列）を返すもの。
pub trait ReceiptReader {
    fn read(
        &self,
        image: &[u8],
        mime: &str,
    ) -> impl std::future::Future<Output = Result<String, ReadError>> + Send;
}
