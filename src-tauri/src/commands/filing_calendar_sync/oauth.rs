use super::{failed, Provider};
use crate::error::{AppError, AppResult, ErrorCode};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use reqwest::{Client, Url};
use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{Ipv4Addr, TcpListener, TcpStream};
use std::time::{Duration, Instant};

pub(in crate::commands) struct OAuth {
    client_id: &'static str,
    client_secret: Option<&'static str>,
    authorize_url: &'static str,
    token_url: &'static str,
    userinfo_url: &'static str,
    scope: &'static str,
    host: &'static str,
}

impl OAuth {
    pub(in crate::commands) fn configured(provider: Provider) -> Option<Self> {
        let config = match provider {
            Provider::Google => Self {
                client_id: option_env!("CHOBIYORI_GOOGLE_CALENDAR_CLIENT_ID")?,
                client_secret: Some(option_env!("CHOBIYORI_GOOGLE_CALENDAR_CLIENT_SECRET")?),
                authorize_url: "https://accounts.google.com/o/oauth2/v2/auth",
                token_url: "https://oauth2.googleapis.com/token",
                userinfo_url: "https://openidconnect.googleapis.com/v1/userinfo",
                scope: "openid https://www.googleapis.com/auth/calendar.app.created",
                host: "127.0.0.1",
            },
            Provider::Outlook => Self {
                client_id: option_env!("CHOBIYORI_OUTLOOK_CALENDAR_CLIENT_ID")?,
                client_secret: None,
                authorize_url: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
                token_url: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
                userinfo_url: "https://graph.microsoft.com/oidc/userinfo",
                scope: "openid https://graph.microsoft.com/Calendars.ReadWrite offline_access",
                host: "localhost",
            },
        };
        if config.client_id.trim().is_empty()
            || config
                .client_secret
                .is_some_and(|value| value.trim().is_empty())
        {
            return None;
        }
        Some(config)
    }

    pub(in crate::commands) fn login(provider: Provider) -> Option<Self> {
        let mut config = Self::configured(provider)?;
        config.scope = "openid";
        Some(config)
    }

    pub(in crate::commands) async fn connect(
        &self,
        client: &Client,
        japanese: bool,
    ) -> AppResult<Token> {
        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).map_err(|_| failed())?;
        listener.set_nonblocking(true).map_err(|_| failed())?;
        let port = listener.local_addr().map_err(|_| failed())?.port();
        let redirect = format!("http://{}:{port}", self.host);
        let state = nonce()?;
        let verifier = nonce()?;
        let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
        let mut authorize = Url::parse(self.authorize_url).map_err(|_| failed())?;
        authorize.query_pairs_mut().extend_pairs([
            ("client_id", self.client_id),
            ("response_type", "code"),
            ("redirect_uri", &redirect),
            ("scope", self.scope),
            ("state", &state),
            ("code_challenge", &challenge),
            ("code_challenge_method", "S256"),
        ]);
        if self.client_secret.is_some() && self.scope != "openid" {
            authorize
                .query_pairs_mut()
                .append_pair("access_type", "offline")
                .append_pair("prompt", "consent select_account");
        } else {
            authorize
                .query_pairs_mut()
                .append_pair("prompt", "select_account");
        }
        tauri_plugin_opener::open_url(authorize.as_str(), None::<&str>).map_err(|_| failed())?;
        let code =
            tauri::async_runtime::spawn_blocking(move || callback(listener, &state, japanese))
                .await
                .map_err(|_| failed())??;
        self.token(
            client,
            &[
                ("grant_type", "authorization_code"),
                ("code", &code),
                ("redirect_uri", &redirect),
                ("code_verifier", &verifier),
            ],
        )
        .await
    }

    // 同じアカウントを再連携するときに専用カレンダーを再利用する。名前やアドレスは使わない。
    pub(in crate::commands) async fn account_key(
        &self,
        client: &Client,
        access_token: &str,
    ) -> AppResult<String> {
        #[derive(Deserialize)]
        struct Account {
            sub: String,
        }
        let text = client
            .get(self.userinfo_url)
            .bearer_auth(access_token)
            .send()
            .await
            .and_then(reqwest::Response::error_for_status)
            .map_err(|_| failed())?
            .text()
            .await
            .map_err(|_| failed())?;
        let account: Account = serde_json::from_str(&text).map_err(|_| failed())?;
        if account.sub.is_empty() {
            return Err(failed());
        }
        Ok(URL_SAFE_NO_PAD.encode(Sha256::digest(account.sub.as_bytes())))
    }

    pub(in crate::commands) async fn refresh(
        &self,
        client: &Client,
        refresh_token: &str,
    ) -> AppResult<Token> {
        self.token(
            client,
            &[
                ("grant_type", "refresh_token"),
                ("refresh_token", refresh_token),
            ],
        )
        .await
    }

    async fn token(&self, client: &Client, params: &[(&str, &str)]) -> AppResult<Token> {
        let mut form = Url::parse(self.token_url).map_err(|_| failed())?;
        form.query_pairs_mut()
            .append_pair("client_id", self.client_id)
            .extend_pairs(params.iter().copied());
        if let Some(secret) = self.client_secret {
            form.query_pairs_mut().append_pair("client_secret", secret);
        }
        let response = client
            .post(self.token_url)
            .header("content-type", "application/x-www-form-urlencoded")
            .body(form.query().unwrap_or_default().to_owned())
            .send()
            .await
            .map_err(|_| failed())?;
        let status = response.status();
        let body = response.text().await.map_err(|_| failed())?;
        if status.is_success() {
            return serde_json::from_str(&body).map_err(|_| failed());
        }
        let error = serde_json::from_str::<serde_json::Value>(&body).ok();
        if matches!(
            error.as_ref().and_then(|value| value["error"].as_str()),
            Some("invalid_grant" | "interaction_required")
        ) {
            return Err(AppError::new(ErrorCode::CalendarAuth));
        }
        Err(failed())
    }
}

#[derive(Deserialize)]
pub(in crate::commands) struct Token {
    pub access_token: String,
    pub refresh_token: Option<String>,
}

fn nonce() -> AppResult<String> {
    let mut bytes = [0u8; 32];
    rustls::crypto::ring::default_provider()
        .secure_random
        .fill(&mut bytes)
        .map_err(|_| failed())?;
    Ok(URL_SAFE_NO_PAD.encode(bytes))
}

fn callback(listener: TcpListener, state: &str, japanese: bool) -> AppResult<String> {
    let deadline = Instant::now() + Duration::from_secs(180);
    while Instant::now() < deadline {
        match listener.accept() {
            Ok((mut stream, _)) => {
                if let Some(result) = handle_callback(&mut stream, state, japanese) {
                    return result;
                }
            }
            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                std::thread::sleep(Duration::from_millis(100));
            }
            Err(_) => return Err(failed()),
        }
    }
    Err(AppError::new(ErrorCode::CalendarCancelled))
}

fn handle_callback(
    stream: &mut TcpStream,
    state: &str,
    japanese: bool,
) -> Option<AppResult<String>> {
    let timeout = Some(Duration::from_secs(2));
    stream.set_read_timeout(timeout).ok()?;
    stream.set_write_timeout(timeout).ok()?;
    let mut line = String::new();
    BufReader::new(&mut *stream)
        .take(8192)
        .read_line(&mut line)
        .ok()?;
    let result = parse_callback(&line, state);
    let (status, message) = if result.is_some() {
        (
            "200 OK",
            if japanese {
                "帳日和に戻ってください。"
            } else {
                "Return to Chobiyori."
            },
        )
    } else {
        ("400 Bad Request", "Invalid request.")
    };
    let _ = write!(
        stream,
        "HTTP/1.1 {status}\r\nContent-Type: text/plain; charset=utf-8\r\nCache-Control: no-store\r\nConnection: close\r\nContent-Length: {}\r\n\r\n{message}",
        message.len()
    );
    result
}

fn parse_callback(line: &str, state: &str) -> Option<AppResult<String>> {
    if !line.ends_with("\r\n") {
        return None;
    }
    let mut parts = line.split_ascii_whitespace();
    if parts.next()? != "GET" {
        return None;
    }
    let query = parts.next()?.strip_prefix("/?")?;
    let url = Url::parse(&format!("http://localhost/?{query}")).ok()?;
    let value = |key| {
        url.query_pairs()
            .find(|(name, _)| name == key)
            .map(|(_, value)| value.into_owned())
    };
    if value("state")?.as_str() != state {
        return None;
    }
    Some(match value("error").as_deref() {
        Some("access_denied") => Err(AppError::new(ErrorCode::CalendarCancelled)),
        Some(_) => Err(failed()),
        None => value("code")
            .filter(|code| !code.is_empty())
            .ok_or_else(failed),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn callback_accepts_only_the_matching_request() {
        let request = "GET /?code=a%2Bb&state=correct HTTP/1.1\r\n";
        assert_eq!(parse_callback(request, "correct").unwrap().unwrap(), "a+b");
        assert!(parse_callback(request, "wrong").is_none());
        assert!(parse_callback("GET /favicon.ico HTTP/1.1\r\n", "correct").is_none());
        let declined = "GET /?error=access_denied&state=correct HTTP/1.1\r\n";
        assert_eq!(
            parse_callback(declined, "correct")
                .unwrap()
                .unwrap_err()
                .code,
            ErrorCode::CalendarCancelled
        );
    }
}
