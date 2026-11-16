//! Gemini API（Google AI Studio）でレシートを読む。
//!
//! 画像と指示の文を送り、`domain::receipt::response_schema` の形の JSON を受け取る。
//! モデル名は設定で変えられる（提供側の改廃に備える）。キーはヘッダで送り、URL やログに出さない。

use super::{ReadError, ReceiptReader};
use crate::domain::receipt::{response_schema, PROMPT};
use base64::Engine;
use serde_json::Value;
use std::time::Duration;

/// 設定がないときのモデル。
pub const DEFAULT_MODEL: &str = "gemini-2.5-flash";
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
            .timeout(Duration::from_secs(90))
            .build()
            .map_err(|_| ReadError::Offline)?;
        Ok(Self { client, key, model })
    }
}

/// モデル名に使える文字だけか（URL に入れるため）。
pub fn valid_model(model: &str) -> bool {
    !model.is_empty()
        && model.len() <= 80
        && model
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '.' | '_'))
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
        429 => ReadError::RateLimited { retry_after },
        400 | 413 | 415 => ReadError::Rejected,
        500..=599 => ReadError::Offline,
        _ => ReadError::BadResponse,
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
            // 400 でもキーの間違いのことがある
            if status == 400 && body.contains("API_KEY_INVALID") {
                return Err(ReadError::BadKey);
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
        assert_eq!(error_of(503, None), ReadError::Offline);
        assert_eq!(error_of(413, None), ReadError::Rejected);
    }

    #[test]
    fn model_names_are_safe_for_the_url() {
        assert!(valid_model("gemini-2.5-flash"));
        assert!(!valid_model("../x"));
        assert!(!valid_model(""));
    }
}
