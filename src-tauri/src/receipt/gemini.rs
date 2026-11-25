//! Gemini API（Google AI Studio）でレシートを読む。
//!
//! 画像と指示の文を送り、`chobiyori_core::receipt::response_schema` の形の JSON を受け取る。
//! モデル名は設定で変えられる（提供側の改廃に備える）。キーはヘッダで送り、URL やログに出さない。

use super::{ReadError, ReceiptReader};
use base64::Engine;
use chobiyori_core::receipt::{response_schema, valid_model, PROMPT};
use serde_json::Value;
use std::time::Duration;

const ENDPOINT: &str = "https://generativelanguage.googleapis.com/v1beta/models";

pub struct Gemini {
    client: reqwest::Client,
    key: String,
    model: String,
}

impl Gemini {
    pub fn new(key: String, model: String) -> Result<Self, ReadError> {
        // TLS の暗号の実装（ring）を、まだ決まっていなければ決める（自動アップデートと同じ）
        if rustls::crypto::CryptoProvider::get_default().is_none() {
            let _ = rustls::crypto::ring::default_provider().install_default();
        }
        let client = reqwest::Client::builder()
            // 混んでいるときは 1 枚に 1 分以上かかる（2026-11 の実測で 35〜85 秒）。
            // 90 秒では打ち切ってしまい、同じ画像が何度読み直しても読めなかった
            .timeout(Duration::from_secs(180))
            .build()
            .map_err(|_| ReadError::Offline)?;
        Ok(Self { client, key, model })
    }
}

/// 送る中身。
pub fn request_body(image: &[u8], mime: &str) -> Value {
    serde_json::json!({
        "contents": [{
            "parts": [
                { "inline_data": { "mime_type": mime, "data": base64::engine::general_purpose::STANDARD.encode(image) } },
                { "text": PROMPT }
            ]
        }],
        "generationConfig": {
            "temperature": 0,
            "responseMimeType": "application/json",
            "responseSchema": response_schema()
        }
    })
}

/// 返事から、モデルが書いた JSON の文字列を取り出す。
pub fn response_text(body: &str) -> Result<String, ReadError> {
    let value: Value = serde_json::from_str(body).map_err(|_| ReadError::BadResponse)?;
    let parts = value
        .pointer("/candidates/0/content/parts")
        .and_then(Value::as_array)
        .ok_or(ReadError::BadResponse)?;
    let text: String = parts
        .iter()
        .filter_map(|p| p.get("text").and_then(Value::as_str))
        .collect();
    if text.trim().is_empty() {
        return Err(ReadError::BadResponse);
    }
    Ok(text)
}

/// HTTP の状態から、失敗の理由を決める。
pub fn error_of(status: u16, retry_after: Option<u64>) -> ReadError {
    match status {
        401 | 403 => ReadError::BadKey,
        404 => ReadError::ModelNotFound,
        429 => ReadError::RateLimited { retry_after },
        // 503 は「混んでいる」（high demand）。接続できないのでも回数の上限でもないので、待って読み直す
        503 => ReadError::Busy,
        400 | 413 | 415 => ReadError::Rejected,
        500..=599 => ReadError::Offline,
        _ => ReadError::BadResponse,
    }
}

/// 返事の中身がキーの間違い・期限切れを言っているか。Gemini は状態を 400・401・403・429 と
/// 変えて返すことがあるので、状態より先に中身で見分ける（間違ったキーを「回数の上限」と言わないため）。
pub fn is_bad_key(body: &str) -> bool {
    const SIGNS: [&str; 5] = [
        "API_KEY_INVALID",
        "API_KEY_EXPIRED",
        "API key not valid",
        "API key expired",
        "ACCESS_TOKEN_TYPE_UNSUPPORTED",
    ];
    SIGNS.iter().any(|s| body.contains(s))
}

/// 429 の返事の中身から、待てば読めるのか（1 分あたりの上限）、今日はもう読めないのか
/// （1 日の上限・無料枠で使えないモデル）を決める。Gemini は待つ秒数を `Retry-After` ではなく
/// 中身の `RetryInfo.retryDelay`（"39s" など）で返す。
pub fn rate_limit_of(body: &str, retry_after: Option<u64>) -> ReadError {
    let value: Value = serde_json::from_str(body).unwrap_or(Value::Null);
    let details = value
        .pointer("/error/details")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let exhausted = details
        .iter()
        .filter_map(|d| d.get("violations").and_then(Value::as_array))
        .flatten()
        .any(|v| {
            let id = v.get("quotaId").and_then(Value::as_str).unwrap_or("");
            let limit = v.get("quotaValue").and_then(Value::as_str).unwrap_or("");
            id.contains("PerDay") || limit == "0"
        });
    if exhausted {
        return ReadError::QuotaExhausted;
    }
    let delay = details
        .iter()
        .filter_map(|d| d.get("retryDelay").and_then(Value::as_str))
        .find_map(|s| s.trim_end_matches('s').parse::<f64>().ok())
        .map(|s| s.ceil() as u64);
    ReadError::RateLimited {
        retry_after: delay.or(retry_after),
    }
}

impl ReceiptReader for Gemini {
    async fn read(&self, image: &[u8], mime: &str) -> Result<String, ReadError> {
        if !valid_model(&self.model) {
            return Err(ReadError::Rejected);
        }
        let url = format!("{ENDPOINT}/{}:generateContent", self.model);
        let response = self
            .client
            .post(url)
            .header("x-goog-api-key", &self.key)
            .header("content-type", "application/json")
            .body(request_body(image, mime).to_string())
            .send()
            .await
            .map_err(|_| ReadError::Offline)?;
        let status = response.status().as_u16();
        let retry_after = response
            .headers()
            .get("retry-after")
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.parse().ok());
        let body = response.text().await.map_err(|_| ReadError::Offline)?;
        if status != 200 {
            // 400 や 429 でもキーの間違いのことがある
            if is_bad_key(&body) {
                return Err(ReadError::BadKey);
            }
            if status == 429 {
                return Err(rate_limit_of(&body, retry_after));
            }
            return Err(error_of(status, retry_after));
        }
        response_text(&body)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn request_has_the_image_and_asks_for_json_only() {
        let body = request_body(b"abc", "image/jpeg");
        assert_eq!(
            body["contents"][0]["parts"][0]["inline_data"]["data"],
            "YWJj"
        );
        assert_eq!(
            body["contents"][0]["parts"][0]["inline_data"]["mime_type"],
            "image/jpeg"
        );
        assert_eq!(
            body["generationConfig"]["responseMimeType"],
            "application/json"
        );
        // 帳簿の情報は入らない（画像と固定の指示だけ）
        assert_eq!(body["contents"][0]["parts"].as_array().unwrap().len(), 2);
    }

    #[test]
    fn reads_the_text_out_of_the_response() {
        let body = r#"{"candidates":[{"content":{"parts":[{"text":"{\"total\":"},{"text":"\"100\"}"}]}}]}"#;
        assert_eq!(response_text(body).unwrap(), r#"{"total":"100"}"#);
        assert_eq!(
            response_text(r#"{"candidates":[]}"#),
            Err(ReadError::BadResponse)
        );
        assert_eq!(response_text("<html>"), Err(ReadError::BadResponse));
    }

    #[test]
    fn statuses_become_reasons() {
        assert_eq!(
            error_of(429, Some(30)),
            ReadError::RateLimited {
                retry_after: Some(30)
            }
        );
        assert_eq!(error_of(403, None), ReadError::BadKey);
        assert_eq!(error_of(503, None), ReadError::Busy);
        assert_eq!(error_of(500, None), ReadError::Offline);
        assert_eq!(error_of(413, None), ReadError::Rejected);
        // モデルがない（提供の終了など）は 1 枚の失敗にしない
        assert_eq!(error_of(404, None), ReadError::ModelNotFound);
    }

    #[test]
    fn bad_keys_are_told_whatever_the_status() {
        let invalid = r#"{"error":{"code":400,"message":"API key not valid. Please pass a valid API key.","status":"INVALID_ARGUMENT","details":[{"@type":"type.googleapis.com/google.rpc.ErrorInfo","reason":"API_KEY_INVALID"}]}}"#;
        assert!(is_bad_key(invalid));
        assert!(is_bad_key(
            &invalid.replace("API_KEY_INVALID", "API_KEY_EXPIRED")
        ));
        let per_minute = r#"{"error":{"code":429,"status":"RESOURCE_EXHAUSTED","details":[{"@type":"type.googleapis.com/google.rpc.RetryInfo","retryDelay":"38.5s"}]}}"#;
        assert!(!is_bad_key(per_minute));
    }

    #[test]
    fn rate_limits_tell_waiting_from_giving_up() {
        // 1 分あたりの上限: 待てば読める。待つ秒数は中身の retryDelay
        let per_minute = r#"{"error":{"code":429,"status":"RESOURCE_EXHAUSTED","details":[
            {"@type":"type.googleapis.com/google.rpc.QuotaFailure","violations":[
                {"quotaId":"GenerateRequestsPerMinutePerProjectPerModel-FreeTier","quotaValue":"10"}]},
            {"@type":"type.googleapis.com/google.rpc.RetryInfo","retryDelay":"38.5s"}]}}"#;
        assert_eq!(
            rate_limit_of(per_minute, None),
            ReadError::RateLimited {
                retry_after: Some(39)
            }
        );
        // 1 日の上限: 待っても今日は読めない
        let per_day = per_minute.replace("PerMinute", "PerDay");
        assert_eq!(rate_limit_of(&per_day, None), ReadError::QuotaExhausted);
        // 無料枠で使えないモデル（上限 0）
        let zero = per_minute.replace(r#""quotaValue":"10""#, r#""quotaValue":"0""#);
        assert_eq!(rate_limit_of(&zero, None), ReadError::QuotaExhausted);
        // 中身が読めなければ、ヘッダの秒数で待つ
        assert_eq!(
            rate_limit_of("<html>", Some(30)),
            ReadError::RateLimited {
                retry_after: Some(30)
            }
        );
    }
}
