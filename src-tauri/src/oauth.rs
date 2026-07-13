//! OAuth2 + PKCE against Google for the Gmail API.
//!
//! The refresh token is the only long-lived credential and never leaves this
//! module except into the OS keychain. The webview only ever sees short-lived
//! access tokens via the `get_access_token` command.

use std::time::{Duration, Instant};

use base64::Engine as _;
use rand::RngCore;
use serde::Deserialize;
use sha2::{Digest, Sha256};
use tauri::async_runtime::Mutex;
use tauri::{AppHandle, State};
use tauri_plugin_opener::OpenerExt;

pub const AUTH_ENDPOINT: &str = "https://accounts.google.com/o/oauth2/v2/auth";
pub const TOKEN_ENDPOINT: &str = "https://oauth2.googleapis.com/token";
pub const REVOKE_ENDPOINT: &str = "https://oauth2.googleapis.com/revoke";
// Full mail scope (not gmail.modify): permanent delete and empty-trash use
// messages.delete/batchDelete, which gmail.modify does not permit.
// gmail.settings.basic: mail rules are materialized as server-side Gmail
// filters (settings.filters), which the full mail scope does not cover.
pub const SCOPE: &str = "https://mail.google.com/ https://www.googleapis.com/auth/gmail.settings.basic https://www.googleapis.com/auth/contacts.readonly https://www.googleapis.com/auth/contacts.other.readonly https://www.googleapis.com/auth/userinfo.profile";
const KEYCHAIN_SERVICE: &str = "com.emiljansson.email";
const KEYCHAIN_USER: &str = "gmail-refresh-token";
const REDIRECT_TIMEOUT: Duration = Duration::from_secs(300);

#[derive(Default)]
pub struct AuthState(pub Mutex<Inner>);

/// All auth state lives behind one async lock so concurrent `get_access_token`
/// calls queue up instead of each hitting the keychain or the token endpoint.
#[derive(Default)]
pub struct Inner {
    pub access: Option<CachedToken>,
    pub refresh: Option<String>,
    /// The keychain is read at most once per app run; afterwards `refresh`
    /// (including `None` when signed out) is authoritative.
    pub keychain_loaded: bool,
}

pub(crate) struct CachedToken {
    access_token: String,
    expires_at: Instant,
}

#[derive(Deserialize, Debug)]
pub struct TokenResponse {
    pub access_token: String,
    pub expires_in: u64,
    pub refresh_token: Option<String>,
}

pub fn client_id() -> Result<String, String> {
    std::env::var("GOOGLE_OAUTH_CLIENT_ID")
        .ok()
        .or_else(|| option_env!("GOOGLE_OAUTH_CLIENT_ID").map(String::from))
        .ok_or_else(|| {
            "GOOGLE_OAUTH_CLIENT_ID is not set. Create a Google Cloud OAuth client \
             (type: Desktop app) and export GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET."
                .to_string()
        })
}

// Google "Desktop app" clients require the client secret in token requests even
// with PKCE. It is not treated as confidential for installed apps.
pub fn client_secret() -> Option<String> {
    std::env::var("GOOGLE_OAUTH_CLIENT_SECRET")
        .ok()
        .or_else(|| option_env!("GOOGLE_OAUTH_CLIENT_SECRET").map(String::from))
}

fn keychain_entry() -> Result<keyring::Entry, String> {
    keyring::Entry::new(KEYCHAIN_SERVICE, KEYCHAIN_USER).map_err(|e| e.to_string())
}

pub fn store_refresh_token(token: &str) -> Result<(), String> {
    keychain_entry()?.set_password(token).map_err(|e| e.to_string())
}

pub fn load_refresh_token() -> Result<Option<String>, String> {
    match keychain_entry()?.get_password() {
        Ok(token) => Ok(Some(token)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

pub fn delete_refresh_token() -> Result<(), String> {
    match keychain_entry()?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

/// Recreates the keychain item so the current binary becomes its ACL owner.
/// macOS ties keychain access to the exact code signature; with ad-hoc signed
/// builds every rebuild looks like a new app to the item created by the old
/// one, so without this each launch after an update would prompt again.
pub fn reown_refresh_token(token: &str) {
    if delete_refresh_token().is_ok() {
        if let Err(e) = store_refresh_token(token) {
            eprintln!("failed to rewrite refresh token to keychain: {e}");
        }
    }
}

/// Returns the refresh token, reading the keychain only on the first call per
/// app run. Callers must hold the state lock, which also means at most one
/// keychain prompt regardless of how many requests race at startup.
async fn refresh_token(inner: &mut Inner) -> Result<Option<String>, String> {
    if !inner.keychain_loaded {
        // The read can block for as long as the user stares at the keychain
        // prompt — keep it off the async workers.
        let token = tauri::async_runtime::spawn_blocking(load_refresh_token)
            .await
            .map_err(|e| e.to_string())??;
        if let Some(token) = token.clone() {
            // Awaited under the lock so a concurrent rotation can't interleave
            // with the delete + recreate. No prompt: deleting never reveals the
            // secret and the new item is created owned by us.
            let _ = tauri::async_runtime::spawn_blocking(move || reown_refresh_token(&token)).await;
        }
        inner.refresh = token;
        inner.keychain_loaded = true;
    }
    Ok(inner.refresh.clone())
}

pub fn base64url(bytes: &[u8]) -> String {
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes)
}

pub fn random_token() -> String {
    let mut buf = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut buf);
    base64url(&buf)
}

pub fn cache_token(inner: &mut Inner, tokens: &TokenResponse) {
    inner.access = Some(CachedToken {
        access_token: tokens.access_token.clone(),
        expires_at: Instant::now() + Duration::from_secs(tokens.expires_in.saturating_sub(60)),
    });
}

pub async fn exchange(params: &[(&str, &str)]) -> Result<TokenResponse, String> {
    let resp = reqwest::Client::new()
        .post(TOKEN_ENDPOINT)
        .form(params)
        .send()
        .await
        .map_err(|e| format!("token request failed: {e}"))?;
    let status = resp.status();
    let body = resp.text().await.map_err(|e| e.to_string())?;
    if !status.is_success() {
        return Err(format!("token endpoint returned {status}: {body}"));
    }
    serde_json::from_str(&body).map_err(|e| format!("unexpected token response: {e}"))
}

fn respond_html(request: tiny_http::Request, message: &str) {
    let html = format!(
        "<!doctype html><meta charset=\"utf-8\"><title>Email</title>\
         <body style=\"font-family: sans-serif; padding: 2rem\"><p>{message}</p>"
    );
    let response = tiny_http::Response::from_string(html).with_header(
        "Content-Type: text/html; charset=utf-8"
            .parse::<tiny_http::Header>()
            .unwrap(),
    );
    let _ = request.respond(response);
}

/// Blocks until Google redirects the browser back to the loopback listener,
/// then returns the authorization code.
fn wait_for_redirect(server: tiny_http::Server, expected_state: &str) -> Result<String, String> {
    let deadline = Instant::now() + REDIRECT_TIMEOUT;
    loop {
        let remaining = deadline
            .checked_duration_since(Instant::now())
            .ok_or("timed out waiting for the browser sign-in")?;
        let request = server
            .recv_timeout(remaining)
            .map_err(|e| e.to_string())?
            .ok_or("timed out waiting for the browser sign-in")?;

        let url = url::Url::parse(&format!("http://127.0.0.1{}", request.url()))
            .map_err(|e| e.to_string())?;
        let mut code = None;
        let mut state = None;
        let mut error = None;
        for (key, value) in url.query_pairs() {
            match key.as_ref() {
                "code" => code = Some(value.into_owned()),
                "state" => state = Some(value.into_owned()),
                "error" => error = Some(value.into_owned()),
                _ => {}
            }
        }

        // Browsers also request /favicon.ico etc. — keep listening.
        if code.is_none() && error.is_none() {
            let _ = request.respond(tiny_http::Response::empty(404));
            continue;
        }
        if let Some(error) = error {
            respond_html(request, "Sign-in failed. You can close this tab.");
            return Err(format!("authorization failed: {error}"));
        }
        if state.as_deref() != Some(expected_state) {
            respond_html(request, "Sign-in failed. You can close this tab.");
            return Err("state mismatch in OAuth redirect".to_string());
        }
        respond_html(request, "Signed in. You can close this tab and return to the app.");
        return Ok(code.unwrap());
    }
}

#[tauri::command]
pub async fn auth_status(state: State<'_, AuthState>) -> Result<bool, String> {
    let mut inner = state.0.lock().await;
    Ok(refresh_token(&mut inner).await?.is_some())
}

#[tauri::command]
pub async fn sign_in(app: AppHandle, state: State<'_, AuthState>) -> Result<(), String> {
    let client_id = client_id()?;
    let verifier = random_token();
    let challenge = base64url(&Sha256::digest(verifier.as_bytes()));
    let csrf = random_token();

    let server = tiny_http::Server::http("127.0.0.1:0")
        .map_err(|e| format!("failed to start local redirect listener: {e}"))?;
    let port = server
        .server_addr()
        .to_ip()
        .ok_or("redirect listener has no IP address")?
        .port();
    let redirect_uri = format!("http://127.0.0.1:{port}");

    let auth_url = url::Url::parse_with_params(
        AUTH_ENDPOINT,
        &[
            ("client_id", client_id.as_str()),
            ("redirect_uri", redirect_uri.as_str()),
            ("response_type", "code"),
            ("scope", SCOPE),
            ("code_challenge", challenge.as_str()),
            ("code_challenge_method", "S256"),
            ("state", csrf.as_str()),
            ("access_type", "offline"),
            // Without this Google may omit the refresh token on repeat consent.
            ("prompt", "consent"),
        ],
    )
    .map_err(|e| e.to_string())?;

    app.opener()
        .open_url(auth_url.as_str(), None::<&str>)
        .map_err(|e| format!("failed to open browser: {e}"))?;

    let code = tauri::async_runtime::spawn_blocking(move || wait_for_redirect(server, &csrf))
        .await
        .map_err(|e| e.to_string())??;

    let secret = client_secret();
    let mut params = vec![
        ("client_id", client_id.as_str()),
        ("code", code.as_str()),
        ("code_verifier", verifier.as_str()),
        ("grant_type", "authorization_code"),
        ("redirect_uri", redirect_uri.as_str()),
    ];
    if let Some(secret) = secret.as_deref() {
        params.push(("client_secret", secret));
    }

    let tokens = exchange(&params).await?;
    let refresh = tokens
        .refresh_token
        .as_deref()
        .ok_or("Google did not return a refresh token")?;
    store_refresh_token(refresh)?;
    let mut inner = state.0.lock().await;
    inner.refresh = Some(refresh.to_string());
    inner.keychain_loaded = true;
    cache_token(&mut inner, &tokens);
    Ok(())
}

#[tauri::command]
pub async fn get_access_token(state: State<'_, AuthState>) -> Result<String, String> {
    // Held across the refresh exchange on purpose: racing callers wait here
    // and are then served the freshly cached token instead of each refreshing.
    let mut inner = state.0.lock().await;
    if let Some(cached) = inner.access.as_ref() {
        if cached.expires_at > Instant::now() {
            return Ok(cached.access_token.clone());
        }
    }

    let refresh = refresh_token(&mut inner).await?.ok_or("not signed in")?;
    let client_id = client_id()?;
    let secret = client_secret();
    let mut params = vec![
        ("client_id", client_id.as_str()),
        ("refresh_token", refresh.as_str()),
        ("grant_type", "refresh_token"),
    ];
    if let Some(secret) = secret.as_deref() {
        params.push(("client_secret", secret));
    }

    let tokens = match exchange(&params).await {
        Ok(tokens) => tokens,
        // Refresh token revoked or expired — force a fresh sign-in.
        Err(e) if e.contains("invalid_grant") => {
            delete_refresh_token()?;
            inner.access = None;
            inner.refresh = None;
            return Err("session expired — sign in again".to_string());
        }
        Err(e) => return Err(e),
    };
    if let Some(new_refresh) = tokens.refresh_token.as_deref() {
        store_refresh_token(new_refresh)?;
        inner.refresh = Some(new_refresh.to_string());
    }
    cache_token(&mut inner, &tokens);
    Ok(tokens.access_token)
}

#[tauri::command]
pub async fn sign_out(state: State<'_, AuthState>) -> Result<(), String> {
    let mut inner = state.0.lock().await;
    if let Some(refresh) = refresh_token(&mut inner).await? {
        // Best-effort revocation; sign-out must still succeed offline.
        let _ = reqwest::Client::new()
            .post(REVOKE_ENDPOINT)
            .form(&[("token", refresh.as_str())])
            .send()
            .await;
    }
    delete_refresh_token()?;
    inner.access = None;
    inner.refresh = None;
    Ok(())
}
