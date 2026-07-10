//! Multi-account management: Google OAuth2 and iCloud IMAP/SMTP.
//!
//! Each account has its own Keychain entry (refresh token or app password).
//! Accounts are stored in a local SQLite DB with sync state.

use std::path::PathBuf;
use std::sync::Arc;

use base64::Engine as _;
use chrono::{DateTime, Utc};
use rand::RngCore;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Manager, State};
use tauri_plugin_opener::OpenerExt;
use uuid::Uuid;

use crate::oauth::{self, AuthState};

// --- Account types ---

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum AccountKind {
    Google,
    Icloud,
}

// Rusqlite FromSql implementation for AccountKind
impl rusqlite::types::FromSql for AccountKind {
    fn column_result(value: rusqlite::types::ValueRef<'_>) -> rusqlite::types::FromSqlResult<Self> {
        value.as_str().and_then(|s| match s {
            "google" => Ok(AccountKind::Google),
            "icloud" => Ok(AccountKind::Icloud),
            _ => Err(rusqlite::types::FromSqlError::InvalidType),
        })
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Account {
    pub id: String,
    pub kind: AccountKind,
    pub email: String,
    pub display_name: Option<String>,
    pub avatar_url: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub last_synced_at: Option<DateTime<Utc>>,
    pub is_default: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GoogleAccountConfig {
    pub refresh_token: String,
    pub access_token: Option<String>,
    pub access_token_expires_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IcloudAccountConfig {
    pub email: String,
    pub app_password: String,
    pub imap_server: String,
    pub imap_port: u16,
    pub smtp_server: String,
    pub smtp_port: u16,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind")]
pub enum AccountConfig {
    Google(GoogleAccountConfig),
    Icloud(IcloudAccountConfig),
}

impl AccountConfig {
    #[allow(dead_code)]
    pub fn kind(&self) -> AccountKind {
        match self {
            AccountConfig::Google(_) => AccountKind::Google,
            AccountConfig::Icloud(_) => AccountKind::Icloud,
        }
    }
}

// --- Database ---

const DB_NAME: &str = "accounts.db";

fn db_path(app: &AppHandle) -> PathBuf {
    let mut path = app.path().app_data_dir().expect("app data dir");
    std::fs::create_dir_all(&path).ok();
    path.push(DB_NAME);
    path
}

fn init_db(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS accounts (
            id TEXT PRIMARY KEY,
            kind TEXT NOT NULL,
            email TEXT NOT NULL UNIQUE,
            display_name TEXT,
            avatar_url TEXT,
            config TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            last_synced_at TEXT,
            is_default INTEGER NOT NULL DEFAULT 0
        );
        CREATE INDEX IF NOT EXISTS idx_accounts_email ON accounts(email);
        CREATE INDEX IF NOT EXISTS idx_accounts_kind ON accounts(kind);
    "#,
    )?;
    Ok(())
}

fn get_conn(app: &AppHandle) -> Result<Connection, String> {
    let path = db_path(app);
    let conn = Connection::open(&path).map_err(|e| e.to_string())?;
    let _ = conn.pragma_update(None, "journal_mode", "WAL");
    let _ = conn.pragma_update(None, "busy_timeout", 5000);
    init_db(&conn).map_err(|e| e.to_string())?;
    Ok(conn)
}

// --- Keychain ---

const KEYCHAIN_SERVICE: &str = "com.emiljansson.email.accounts";

fn keychain_entry(account_id: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new(KEYCHAIN_SERVICE, account_id).map_err(|e| e.to_string())
}

fn store_secret(account_id: &str, secret: &str) -> Result<(), String> {
    keychain_entry(account_id)?.set_password(secret).map_err(|e| e.to_string())
}

fn load_secret(account_id: &str) -> Result<Option<String>, String> {
    match keychain_entry(account_id)?.get_password() {
        Ok(s) => Ok(Some(s)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

fn delete_secret(account_id: &str) -> Result<(), String> {
    match keychain_entry(account_id)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

// --- AccountState for Tauri ---

pub struct AccountState {
    pub db: Arc<tokio::sync::Mutex<Connection>>,
    /// In-memory Google access-token cache: account id → (token, expiry).
    /// Access tokens are bearer credentials — they never touch disk.
    pub tokens: tokio::sync::Mutex<std::collections::HashMap<String, (String, DateTime<Utc>)>>,
}

impl AccountState {
    pub fn new(app: &AppHandle) -> Result<Self, String> {
        let conn = get_conn(app)?;
        scrub_secrets(&conn);
        Ok(Self {
            db: Arc::new(tokio::sync::Mutex::new(conn)),
            tokens: tokio::sync::Mutex::new(std::collections::HashMap::new()),
        })
    }
}

/// One-time migration: earlier builds persisted the iCloud app password and
/// Google tokens inside the accounts table's config JSON. Move them to the
/// keychain (if not already there) and blank them in the DB — the keychain is
/// the only durable secret store.
fn scrub_secrets(conn: &Connection) {
    let rows: Vec<(String, String)> = conn
        .prepare("SELECT id, config FROM accounts")
        .and_then(|mut stmt| {
            stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?
                .collect()
        })
        .unwrap_or_default();

    for (id, config_json) in rows {
        let Ok(mut config) = serde_json::from_str::<AccountConfig>(&config_json) else {
            continue;
        };
        let dirty = match &mut config {
            AccountConfig::Google(g) => {
                let mut dirty = false;
                if !g.refresh_token.is_empty() {
                    if matches!(load_secret(&id), Ok(None)) {
                        let _ = store_secret(&id, &g.refresh_token);
                    }
                    g.refresh_token = String::new();
                    dirty = true;
                }
                if g.access_token.is_some() || g.access_token_expires_at.is_some() {
                    g.access_token = None;
                    g.access_token_expires_at = None;
                    dirty = true;
                }
                dirty
            }
            AccountConfig::Icloud(c) => {
                if c.app_password.is_empty() {
                    false
                } else {
                    if matches!(load_secret(&id), Ok(None)) {
                        let _ = store_secret(&id, &c.app_password);
                    }
                    c.app_password = String::new();
                    true
                }
            }
        };
        if dirty {
            if let Ok(json) = serde_json::to_string(&config) {
                let _ = conn.execute(
                    "UPDATE accounts SET config = ?1 WHERE id = ?2",
                    params![json, id],
                );
            }
        }
    }
}

// --- Helpers ---

fn random_token() -> String {
    let mut buf = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut buf);
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(buf)
}

async fn get_account_config_inner(
    state: &State<'_, AccountState>,
    account_id: &str,
) -> Result<AccountConfig, String> {
    let db = state.db.lock().await;
    let config_json: String = db
        .query_row(
            "SELECT config FROM accounts WHERE id = ?1",
            params![account_id],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    serde_json::from_str(&config_json).map_err(|e| e.to_string())
}

async fn fetch_google_profile(access_token: &str) -> Result<GoogleProfile, String> {
    let client = reqwest::Client::new();
    let res = client
        .get("https://www.googleapis.com/oauth2/v2/userinfo")
        .bearer_auth(access_token)
        .send()
        .await
        .map_err(|e| format!("profile request failed: {e}"))?;
    if !res.status().is_success() {
        return Err(format!("profile request failed: {}", res.status()));
    }
    res.json().await.map_err(|e| e.to_string())
}

#[derive(Deserialize)]
#[allow(dead_code)]
struct GoogleProfile {
    email: String,
    name: Option<String>,
    picture: Option<String>,
}

/// Validates the credentials by actually logging in over IMAP.
async fn test_icloud_connection(config: IcloudAccountConfig) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut session = connect_imap(&config)?;
        let _ = session.logout();
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

// --- Tauri Commands ---

#[tauri::command(rename_all = "snake_case")]
pub async fn list_accounts(state: State<'_, AccountState>) -> Result<Vec<Account>, String> {
    let db = state.db.lock().await;
    let mut stmt = db
        .prepare(
            "SELECT id, kind, email, display_name, avatar_url, config, created_at, updated_at, last_synced_at, is_default FROM accounts ORDER BY is_default DESC, created_at ASC",
        )
        .map_err(|e| e.to_string())?;
    let accounts = stmt
        .query_map([], |row| {
            let _config_json: String = row.get(5)?;
            Ok(Account {
                id: row.get(0)?,
                kind: row.get(1)?,
                email: row.get(2)?,
                display_name: row.get(3)?,
                avatar_url: row.get(4)?,
                created_at: DateTime::parse_from_rfc3339(&row.get::<_, String>(6)?)
                    .map_err(|e| rusqlite::Error::FromSqlConversionFailure(6, rusqlite::types::Type::Text, Box::new(e)))?
                    .with_timezone(&Utc),
                updated_at: DateTime::parse_from_rfc3339(&row.get::<_, String>(7)?)
                    .map_err(|e| rusqlite::Error::FromSqlConversionFailure(7, rusqlite::types::Type::Text, Box::new(e)))?
                    .with_timezone(&Utc),
                last_synced_at: row.get::<_, Option<String>>(8)?.map(|s| {
                    DateTime::parse_from_rfc3339(&s).ok().map(|dt| dt.with_timezone(&Utc))
                }).flatten(),
                is_default: row.get(9)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(accounts)
}

#[tauri::command(rename_all = "snake_case")]
pub async fn add_google_account(
    app: AppHandle,
    state: State<'_, AccountState>,
    auth: State<'_, AuthState>,
    display_name: Option<String>,
) -> Result<Account, String> {
    // Start Google OAuth flow
    let client_id = oauth::client_id()?;
    let verifier = random_token();
    let challenge = oauth::base64url(&Sha256::digest(verifier.as_bytes()));
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
        oauth::AUTH_ENDPOINT,
        &[
            ("client_id", client_id.as_str()),
            ("redirect_uri", redirect_uri.as_str()),
            ("response_type", "code"),
            ("scope", oauth::SCOPE),
            ("code_challenge", challenge.as_str()),
            ("code_challenge_method", "S256"),
            ("state", csrf.as_str()),
            ("access_type", "offline"),
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

    let secret = oauth::client_secret();
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

    let tokens = oauth::exchange(&params).await?;
    let refresh = tokens
        .refresh_token
        .as_deref()
        .ok_or("Google did not return a refresh token")?;

    // Store refresh token in Keychain per account
    let account_id = Uuid::new_v4().to_string();
    store_secret(&account_id, refresh)?;

    // Fetch profile to get email
    let access_token = tokens.access_token.clone();
    let profile = fetch_google_profile(&access_token).await?;

    // Create account record
    let now = Utc::now();
    let account = Account {
        id: account_id.clone(),
        kind: AccountKind::Google,
        email: profile.email,
        display_name,
        avatar_url: profile.picture,
        created_at: now,
        updated_at: now,
        last_synced_at: None,
        is_default: false,
    };

    // Secrets live in the keychain (and tokens in memory) — never in the DB.
    let config = AccountConfig::Google(GoogleAccountConfig {
        refresh_token: String::new(),
        access_token: None,
        access_token_expires_at: None,
    });
    state.tokens.lock().await.insert(
        account_id.clone(),
        (
            access_token,
            now + chrono::Duration::seconds(tokens.expires_in as i64 - 60),
        ),
    );

    let db = state.db.lock().await;
    let is_first = db
        .query_row("SELECT COUNT(*) FROM accounts", [], |r| r.get::<_, i64>(0))
        .unwrap_or(0)
        == 0;
    let is_default = if is_first { 1 } else { 0 };

    db.execute(
        "INSERT INTO accounts (id, kind, email, display_name, avatar_url, config, created_at, updated_at, is_default) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        params![
            &account.id,
            "google",
            &account.email,
            &account.display_name,
            &account.avatar_url,
            &serde_json::to_string(&config).map_err(|e| e.to_string())?,
            &account.created_at.to_rfc3339(),
            &account.updated_at.to_rfc3339(),
            is_default,
        ],
    ).map_err(|e| e.to_string())?;

    // If this is the first account, also initialize the Google AuthState for
    // backward compat — including the legacy keychain entry, so gmail.ts's
    // get_access_token keeps working after an app restart.
    if is_first {
        oauth::store_refresh_token(refresh)?;
        let mut inner = auth.0.lock().await;
        inner.refresh = Some(refresh.to_string());
        inner.keychain_loaded = true;
        oauth::cache_token(&mut inner, &tokens);
    }

    Ok(account)
}

#[tauri::command(rename_all = "snake_case")]
pub async fn add_icloud_account(
    state: State<'_, AccountState>,
    email: String,
    app_password: String,
    display_name: Option<String>,
    imap_server: Option<String>,
    imap_port: Option<u16>,
    smtp_server: Option<String>,
    smtp_port: Option<u16>,
) -> Result<Account, String> {
    let imap_server = imap_server.unwrap_or_else(|| "imap.mail.me.com".to_string());
    let imap_port = imap_port.unwrap_or(993);
    let smtp_server = smtp_server.unwrap_or_else(|| "smtp.mail.me.com".to_string());
    let smtp_port = smtp_port.unwrap_or(587);

    let icloud_config = IcloudAccountConfig {
        email: email.clone(),
        app_password: app_password.clone(),
        imap_server,
        imap_port,
        smtp_server,
        smtp_port,
    };

    // Validate the credentials with a real IMAP login before storing anything.
    test_icloud_connection(icloud_config.clone()).await?;

    let account_id = Uuid::new_v4().to_string();
    store_secret(&account_id, &app_password)?;

    let now = Utc::now();
    let account = Account {
        id: account_id.clone(),
        kind: AccountKind::Icloud,
        email: email.clone(),
        display_name,
        avatar_url: None,
        created_at: now,
        updated_at: now,
        last_synced_at: None,
        is_default: false,
    };

    // The app password lives in the keychain only — blank it in the DB row.
    let config = AccountConfig::Icloud(IcloudAccountConfig {
        app_password: String::new(),
        ..icloud_config
    });

    let db = state.db.lock().await;
    let is_first = db
        .query_row("SELECT COUNT(*) FROM accounts", [], |r| r.get::<_, i64>(0))
        .unwrap_or(0)
        == 0;
    let is_default = if is_first { 1 } else { 0 };

    db.execute(
        "INSERT INTO accounts (id, kind, email, display_name, avatar_url, config, created_at, updated_at, is_default) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        params![
            &account.id,
            "icloud",
            &account.email,
            &account.display_name,
            &account.avatar_url,
            &serde_json::to_string(&config).map_err(|e| e.to_string())?,
            &account.created_at.to_rfc3339(),
            &account.updated_at.to_rfc3339(),
            is_default,
        ],
    ).map_err(|e| e.to_string())?;

    Ok(account)
}

#[tauri::command(rename_all = "snake_case")]
pub async fn remove_account(
    state: State<'_, AccountState>,
    cache: State<'_, crate::db::CacheDb>,
    pool: State<'_, ImapPool>,
    account_id: String,
) -> Result<(), String> {
    // Delete from Keychain and drop in-memory credentials/connections
    delete_secret(&account_id)?;
    state.tokens.lock().await.remove(&account_id);
    pool.evict(&account_id);

    // Delete from DB
    {
        let db = state.db.lock().await;
        db.execute("DELETE FROM accounts WHERE id = ?1", params![&account_id])
            .map_err(|e| e.to_string())?;

        // If no default account remains, promote the oldest one.
        let has_default: bool = db
            .query_row("SELECT COUNT(*) FROM accounts WHERE is_default = 1", [], |r| {
                r.get::<_, i64>(0)
            })
            .map_err(|e| e.to_string())?
            > 0;
        if !has_default {
            let new_default: Option<String> = db
                .query_row(
                    "SELECT id FROM accounts ORDER BY created_at ASC LIMIT 1",
                    [],
                    |r| r.get(0),
                )
                .optional()
                .map_err(|e| e.to_string())?;
            if let Some(id) = new_default {
                db.execute("UPDATE accounts SET is_default = 1 WHERE id = ?1", params![&id])
                    .map_err(|e| e.to_string())?;
            }
        }
    }

    // Drop any cached mail (and per-account kv entries) for the account
    cache.delete_account_cache(&account_id).await?;
    cache
        .delete_kv_prefix(&format!("icloud:counts:{account_id}"))
        .await?;

    Ok(())
}

#[tauri::command(rename_all = "snake_case")]
pub async fn set_default_account(
    state: State<'_, AccountState>,
    account_id: String,
) -> Result<(), String> {
    let mut db = state.db.lock().await;
    let tx = db.transaction().map_err(|e| e.to_string())?;
    tx.execute("UPDATE accounts SET is_default = 0", params![])
        .map_err(|e| e.to_string())?;
    tx.execute(
        "UPDATE accounts SET is_default = 1 WHERE id = ?1",
        params![&account_id],
    )
    .map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command(rename_all = "snake_case")]
pub async fn update_account_display_name(
    state: State<'_, AccountState>,
    account_id: String,
    display_name: String,
) -> Result<(), String> {
    let db = state.db.lock().await;
    db.execute(
        "UPDATE accounts SET display_name = ?1, updated_at = ?2 WHERE id = ?3",
        params![&display_name, &Utc::now().to_rfc3339(), &account_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command(rename_all = "snake_case")]
pub async fn get_google_access_token(
    state: State<'_, AccountState>,
    account_id: String,
) -> Result<String, String> {
    // In-memory token cache — access tokens never touch disk.
    {
        let tokens = state.tokens.lock().await;
        if let Some((token, expires)) = tokens.get(&account_id) {
            if *expires > Utc::now() {
                return Ok(token.clone());
            }
        }
    }

    let config = get_account_config_inner(&state, &account_id).await?;
    let AccountConfig::Google(_) = config else {
        return Err("not a Google account".to_string());
    };

    // Refresh using the keychain-held refresh token
    let refresh_token = load_secret(&account_id)?.ok_or("no refresh token in keychain")?;
    let client_id = oauth::client_id()?;
    let secret = oauth::client_secret();
    let mut params = vec![
        ("client_id", client_id.as_str()),
        ("refresh_token", refresh_token.as_str()),
        ("grant_type", "refresh_token"),
    ];
    if let Some(secret) = secret.as_deref() {
        params.push(("client_secret", secret));
    }

    let tokens = oauth::exchange(&params).await?;

    // Update keychain if the refresh token rotated
    if let Some(new_refresh) = &tokens.refresh_token {
        store_secret(&account_id, new_refresh)?;
    }

    state.tokens.lock().await.insert(
        account_id,
        (
            tokens.access_token.clone(),
            Utc::now() + chrono::Duration::seconds(tokens.expires_in as i64 - 60),
        ),
    );

    Ok(tokens.access_token)
}

// --- OAuth redirect handler ---

fn wait_for_redirect(server: tiny_http::Server, expected_state: &str) -> Result<String, String> {
    use std::time::{Duration, Instant};

    const REDIRECT_TIMEOUT: Duration = Duration::from_secs(300);
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

// --- iCloud IMAP/SMTP commands ---

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IcloudMessageSummary {
    pub uid: u32,
    pub message_id: Option<String>,
    pub from_name: Option<String>,
    pub from_email: String,
    pub to: String,
    pub subject: String,
    pub snippet: String,
    pub date: Option<String>,
    pub flags: Vec<String>,
    pub folder: String,
    pub read: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IcloudMessageDetail {
    pub uid: u32,
    pub message_id: String,
    pub from_name: Option<String>,
    pub from_email: String,
    pub to: String,
    pub cc: Option<String>,
    pub references: Option<String>,
    pub subject: String,
    pub body_text: String,
    pub body_html: Option<String>,
    pub date: Option<String>,
    pub flags: Vec<String>,
    pub folder: String,
}

/// Server-side full-mailbox search (IMAP SEARCH TEXT) — covers messages far
/// beyond the locally cached page.
#[tauri::command(rename_all = "snake_case")]
pub async fn icloud_search_messages(
    state: State<'_, AccountState>,
    pool: State<'_, ImapPool>,
    account_id: String,
    folder: String,
    query: String,
    limit: Option<u32>,
) -> Result<Vec<IcloudMessageSummary>, String> {
    let config = get_icloud_config(&state, &account_id).await?;
    let limit = limit.unwrap_or(50) as usize;
    let pool = pool.0.clone();
    tauri::async_runtime::spawn_blocking(move || {
        with_imap(&pool, &account_id, &config, |s| {
            search_messages_blocking(s, &folder, &query, limit)
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command(rename_all = "snake_case")]
pub async fn icloud_fetch_message(
    state: State<'_, AccountState>,
    cache: State<'_, crate::db::CacheDb>,
    pool: State<'_, ImapPool>,
    account_id: String,
    folder: String,
    uid: u32,
) -> Result<IcloudMessageDetail, String> {
    // Bodies are immutable — serve from cache when we have one.
    if let Ok(Some(m)) = cache.get_message(&account_id, &folder, uid).await {
        if !m.body_text.is_empty() || m.body_html.is_some() {
            return Ok(IcloudMessageDetail {
                uid,
                message_id: m.message_id.unwrap_or_default(),
                from_name: m.from_name,
                from_email: m.from_email,
                to: m.to,
                cc: m.cc,
                references: m.references,
                subject: m.subject,
                body_text: m.body_text,
                body_html: m.body_html,
                date: m.date,
                flags: m.flags,
                folder,
            });
        }
    }

    let config = get_icloud_config(&state, &account_id).await?;
    let imap = pool.0.clone();
    let folder_clone = folder.clone();
    let account = account_id.clone();
    let detail = tauri::async_runtime::spawn_blocking(move || {
        with_imap(&imap, &account, &config, |s| {
            fetch_message_blocking(s, &folder_clone, uid)
        })
    })
    .await
    .map_err(|e| e.to_string())??;

    // Write back: offline reading, instant reopen, and a real list snippet.
    let cached = crate::db::CachedMessage {
        uid,
        message_id: Some(detail.message_id.clone()).filter(|s| !s.is_empty()),
        from_name: detail.from_name.clone(),
        from_email: detail.from_email.clone(),
        to: detail.to.clone(),
        cc: detail.cc.clone(),
        references: detail.references.clone(),
        subject: detail.subject.clone(),
        snippet: snippet_of(&detail.body_text),
        body_text: detail.body_text.clone(),
        body_html: detail.body_html.clone(),
        date: detail.date.clone(),
        flags: detail.flags.clone(),
        read: detail
            .flags
            .iter()
            .any(|f| f.eq_ignore_ascii_case("\\Seen")),
    };
    let _ = cache.upsert_messages(&account_id, &folder, &[cached]).await;

    Ok(detail)
}

#[tauri::command(rename_all = "snake_case")]
pub async fn icloud_send_message(
    state: State<'_, AccountState>,
    account_id: String,
    from_email: String,
    to: String,
    cc: Option<String>,
    bcc: Option<String>,
    subject: String,
    body_text: String,
    body_html: Option<String>,
    in_reply_to: Option<String>,
    references: Option<String>,
) -> Result<(), String> {
    let config = get_icloud_config(&state, &account_id).await?;
    tauri::async_runtime::spawn_blocking(move || {
        smtp_send_blocking(&config, &from_email, &to, cc.as_deref(), bcc.as_deref(), &subject, &body_text, body_html.as_deref(), in_reply_to.as_deref(), references.as_deref())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command(rename_all = "snake_case")]
pub async fn icloud_mark_read(
    state: State<'_, AccountState>,
    cache: State<'_, crate::db::CacheDb>,
    pool: State<'_, ImapPool>,
    account_id: String,
    folder: String,
    uid: u32,
    read: bool,
) -> Result<(), String> {
    let config = get_icloud_config(&state, &account_id).await?;
    let imap = pool.0.clone();
    let folder_clone = folder.clone();
    let account = account_id.clone();
    tauri::async_runtime::spawn_blocking(move || {
        with_imap(&imap, &account, &config, |s| {
            mark_read_blocking(s, &folder_clone, uid, read)
        })
    })
    .await
    .map_err(|e| e.to_string())??;
    // Keep the local cache in step so the state survives a restart.
    let _ = cache.mark_read(&account_id, &folder, uid, read).await;
    Ok(())
}

#[tauri::command(rename_all = "snake_case")]
pub async fn icloud_move_message(
    state: State<'_, AccountState>,
    cache: State<'_, crate::db::CacheDb>,
    pool: State<'_, ImapPool>,
    account_id: String,
    folder: String,
    uid: u32,
    target_folder: String,
) -> Result<(), String> {
    let config = get_icloud_config(&state, &account_id).await?;
    let imap = pool.0.clone();
    let folder_clone = folder.clone();
    let account = account_id.clone();
    tauri::async_runtime::spawn_blocking(move || {
        with_imap(&imap, &account, &config, |s| {
            move_message_blocking(s, &folder_clone, uid, &target_folder)
        })
    })
    .await
    .map_err(|e| e.to_string())??;
    let _ = cache.delete_messages(&account_id, &folder, &[uid]).await;
    Ok(())
}

#[tauri::command(rename_all = "snake_case")]
pub async fn icloud_folder_counts(
    state: State<'_, AccountState>,
    pool: State<'_, ImapPool>,
    account_id: String,
) -> Result<std::collections::HashMap<String, u32>, String> {
    let config = get_icloud_config(&state, &account_id).await?;
    let pool = pool.0.clone();
    tauri::async_runtime::spawn_blocking(move || {
        with_imap(&pool, &account_id, &config, folder_counts_blocking)
    })
    .await
    .map_err(|e| e.to_string())?
}

async fn get_icloud_config(
    state: &State<'_, AccountState>,
    account_id: &str,
) -> Result<IcloudAccountConfig, String> {
    let config = get_account_config_inner(state, account_id).await?;
    match config {
        AccountConfig::Icloud(mut cfg) => {
            // The DB row stores no secret — the keychain is the only store.
            if cfg.app_password.is_empty() {
                cfg.app_password =
                    load_secret(account_id)?.ok_or("no app password in keychain")?;
            }
            Ok(cfg)
        }
        _ => Err("not an iCloud account".to_string()),
    }
}

// --- blocking IMAP/SMTP helpers (run on blocking threads) ---

type ImapSession = imap::Session<native_tls::TlsStream<std::net::TcpStream>>;
type SessionMap = std::collections::HashMap<String, ImapSession>;

/// Reused IMAP sessions per account. TLS + LOGIN costs hundreds of ms per
/// operation; keeping the session alive makes every subsequent command a
/// single round trip. A session is checked out of the map while in use, so
/// concurrent operations simply open a second connection.
#[derive(Default)]
pub struct ImapPool(Arc<std::sync::Mutex<SessionMap>>);

impl ImapPool {
    pub fn evict(&self, account_id: &str) {
        self.0.lock().unwrap().remove(account_id);
    }
}

/// Run `f` against a pooled session; on failure (stale/dropped connection,
/// server timeout) retry once on a fresh connection. Operations must be
/// idempotent — all ours are (select/search/fetch/store/move/status).
fn with_imap<T>(
    pool: &Arc<std::sync::Mutex<SessionMap>>,
    account_id: &str,
    config: &IcloudAccountConfig,
    f: impl Fn(&mut ImapSession) -> Result<T, String>,
) -> Result<T, String> {
    let existing = pool.lock().unwrap().remove(account_id);
    if let Some(mut session) = existing {
        if let Ok(value) = f(&mut session) {
            pool.lock().unwrap().insert(account_id.to_string(), session);
            return Ok(value);
        }
        // Likely a dead connection — fall through to a fresh one. If the
        // error was real, the retry hits it again and reports it.
    }
    let mut session = connect_imap(config)?;
    let value = f(&mut session)?;
    pool.lock().unwrap().insert(account_id.to_string(), session);
    Ok(value)
}

fn connect_imap(config: &IcloudAccountConfig) -> Result<ImapSession, String> {
    let connector = native_tls::TlsConnector::new().map_err(|e| format!("TLS init failed: {e}"))?;
    let client = imap::connect(
        (config.imap_server.as_str(), config.imap_port),
        config.imap_server.as_str(),
        &connector,
    )
    .map_err(|e| format!("IMAP connect failed: {e}"))?;
    let session = client
        .login(&config.email, &config.app_password)
        .map_err(|e| format!("IMAP login failed: {e:?}"))?;
    Ok(session)
}

fn search_messages_blocking(
    session: &mut ImapSession,
    folder: &str,
    query: &str,
    limit: usize,
) -> Result<Vec<IcloudMessageSummary>, String> {
    session
        .select(folder)
        .map_err(|e| format!("select folder failed: {e}"))?;

    // Strip quotes/backslashes/control chars — the query lands inside an IMAP
    // quoted string.
    let clean: String = query
        .chars()
        .filter(|c| !c.is_control() && *c != '"' && *c != '\\')
        .collect();
    if clean.trim().is_empty() {
        return Ok(Vec::new());
    }

    // Non-ASCII needs an explicit charset; some servers reject it, so fall
    // back to the plain form rather than failing the search outright.
    let uids = session
        .uid_search(format!("CHARSET UTF-8 TEXT \"{clean}\""))
        .or_else(|_| session.uid_search(format!("TEXT \"{clean}\"")))
        .map_err(|e| format!("search failed: {e}"))?;

    let mut uids: Vec<u32> = uids.into_iter().collect();
    if uids.is_empty() {
        return Ok(Vec::new());
    }
    uids.sort();
    let start = uids.len().saturating_sub(limit);
    let set: String = uids[start..]
        .iter()
        .map(|u| u.to_string())
        .collect::<Vec<_>>()
        .join(",");

    let fetches = session
        .uid_fetch(&set, "(UID FLAGS ENVELOPE BODY.PEEK[HEADER.FIELDS (FROM TO SUBJECT DATE MESSAGE-ID)])")
        .map_err(|e| format!("fetch failed: {e}"))?;

    let mut messages: Vec<IcloudMessageSummary> = fetches
        .iter()
        .map(|f| summary_from_fetch(f, folder))
        .collect();

    // Newest first.
    messages.reverse();
    Ok(messages)
}

/// What one incremental sync pass found, all in a single IMAP session:
/// envelopes for new UIDs, current flags for already-cached UIDs, and cached
/// UIDs no longer on the server (deleted or moved elsewhere).
struct IcloudSyncDelta {
    new_messages: Vec<IcloudMessageSummary>,
    /// Prefetched full bodies for the newest new messages: (uid, text, html).
    bodies: Vec<(u32, String, Option<String>)>,
    flag_updates: Vec<(u32, Vec<String>, bool)>,
    vanished: Vec<u32>,
}

/// How many new messages get their body prefetched per sync pass (offline
/// reading without having opened them).
const BODY_PREFETCH: usize = 10;

fn sync_messages_blocking(
    session: &mut ImapSession,
    folder: &str,
    limit: usize,
    last_uid: Option<u32>,
    known_uids: &[u32],
) -> Result<IcloudSyncDelta, String> {
    session
        .select(folder)
        .map_err(|e| format!("select folder failed: {e}"))?;

    let uid_range = match last_uid {
        Some(uid) => format!("{}:*", uid + 1),
        None => "1:*".to_string(),
    };

    let uids = session
        .uid_search(format!("UID {uid_range}"))
        .map_err(|e| format!("uid search failed: {e}"))?;
    // "UID n:*" always matches the highest-UID message even when its UID < n,
    // so with no new mail the newest message comes back every time — drop it.
    let mut uids: Vec<u32> = uids
        .into_iter()
        .filter(|u| last_uid.is_none_or(|last| *u > last))
        .collect();
    uids.sort();
    let start = uids.len().saturating_sub(limit);
    let slice = &uids[start..];

    let mut new_messages = Vec::new();
    if !slice.is_empty() {
        let set: String = slice
            .iter()
            .map(|s| s.to_string())
            .collect::<Vec<_>>()
            .join(",");
        let fetches = session
            .uid_fetch(&set, "(UID FLAGS ENVELOPE BODY.PEEK[HEADER.FIELDS (FROM TO SUBJECT DATE MESSAGE-ID)])")
            .map_err(|e| format!("uid fetch failed: {e}"))?;
        new_messages = fetches
            .iter()
            .map(|f| summary_from_fetch(f, folder))
            .collect();
        new_messages.reverse();
    }

    // Prefetch bodies for the newest few new messages (BODY.PEEK keeps them
    // unread) so they're readable offline without ever being opened.
    let mut bodies = Vec::new();
    if !new_messages.is_empty() {
        let set: String = new_messages
            .iter()
            .take(BODY_PREFETCH)
            .map(|m| m.uid.to_string())
            .collect::<Vec<_>>()
            .join(",");
        if let Ok(fetches) = session.uid_fetch(&set, "(UID BODY.PEEK[])") {
            for fetch in fetches.iter() {
                if let (Some(uid), Some(raw)) = (fetch.uid, fetch.body()) {
                    let (text, html) = parse_body(raw);
                    bodies.push((uid, text, html));
                }
            }
        }
    }

    // Refresh flags for what we already have cached (read state can change
    // from other devices) and detect messages that vanished from the folder.
    let mut flag_updates = Vec::new();
    let mut vanished = Vec::new();
    if !known_uids.is_empty() {
        let set: String = known_uids
            .iter()
            .map(|u| u.to_string())
            .collect::<Vec<_>>()
            .join(",");
        let fetches = session
            .uid_fetch(&set, "(UID FLAGS)")
            .map_err(|e| format!("flags fetch failed: {e}"))?;
        let mut present = std::collections::HashSet::new();
        for fetch in fetches.iter() {
            let Some(uid) = fetch.uid else { continue };
            present.insert(uid);
            let flags: Vec<String> = fetch.flags().iter().map(|x| x.to_string()).collect();
            let read = flags.iter().any(|f| f.eq_ignore_ascii_case("\\Seen"));
            flag_updates.push((uid, flags, read));
        }
        vanished = known_uids
            .iter()
            .filter(|u| !present.contains(u))
            .copied()
            .collect();
    }

    Ok(IcloudSyncDelta {
        new_messages,
        bodies,
        flag_updates,
        vanished,
    })
}

fn fetch_message_blocking(
    session: &mut ImapSession,
    folder: &str,
    uid: u32,
) -> Result<IcloudMessageDetail, String> {
    session
        .select(folder)
        .map_err(|e| format!("select folder failed: {e}"))?;

    let set = uid.to_string();
    let fetches = session
        .uid_fetch(&set, "(UID FLAGS ENVELOPE BODY[])")
        .map_err(|e| format!("fetch failed: {e}"))?;

    let fetch = fetches
        .first()
        .ok_or_else(|| "message not found".to_string())?;

    let envelope = fetch.envelope();
    let (from_name, from_email) = parse_address(envelope.and_then(|e| e.from.as_ref()).and_then(|v| v.first()));
    let to = envelope
        .and_then(|e| e.to.as_ref())
        .map(|v| v.iter().map(address_to_string).collect::<Vec<_>>().join(", "))
        .unwrap_or_default();
    let cc = envelope
        .and_then(|e| e.cc.as_ref())
        .map(|v| v.iter().map(address_to_string).collect::<Vec<_>>().join(", "));
    let subject = envelope
        .and_then(|e| e.subject)
        .map(|s| String::from_utf8_lossy(s).into_owned())
        .unwrap_or_default();
    let message_id = envelope
        .and_then(|e| e.message_id)
        .map(|s| String::from_utf8_lossy(s).into_owned())
        .unwrap_or_default();
    let date = normalize_date(
        envelope
            .and_then(|e| e.date)
            .map(|s| String::from_utf8_lossy(s).into_owned()),
    );
    let flags: Vec<String> = fetch.flags().iter().map(|x| x.to_string()).collect();

    let (body_text, body_html) = match fetch.body() {
        Some(raw) => parse_body(raw),
        None => (String::new(), None),
    };
    // References isn't in the ENVELOPE — pull it from the raw headers so
    // replies thread correctly beyond the immediate parent.
    let references = fetch.body().and_then(|raw| {
        use mailparse::MailHeaderMap;
        mailparse::parse_mail(raw)
            .ok()
            .and_then(|m| m.headers.get_first_value("References"))
            .filter(|s| !s.trim().is_empty())
    });

    Ok(IcloudMessageDetail {
        uid,
        message_id,
        from_name,
        from_email,
        to,
        cc,
        references,
        subject,
        body_text,
        body_html,
        date,
        flags,
        folder: folder.to_string(),
    })
}

fn mark_read_blocking(
    session: &mut ImapSession,
    folder: &str,
    uid: u32,
    read: bool,
) -> Result<(), String> {
    session
        .select(folder)
        .map_err(|e| format!("select folder failed: {e}"))?;
    let set = uid.to_string();
    let res = if read {
        session.uid_store(&set, "+FLAGS (\\Seen)")
    } else {
        session.uid_store(&set, "-FLAGS (\\Seen)")
    };
    res.map_err(|e| format!("store flags failed: {e}"))?;
    Ok(())
}

fn move_message_blocking(
    session: &mut ImapSession,
    folder: &str,
    uid: u32,
    target_folder: &str,
) -> Result<(), String> {
    session
        .select(folder)
        .map_err(|e| format!("select folder failed: {e}"))?;
    let set = uid.to_string();
    // iCloud supports UID MOVE; fall back to copy + delete + expunge otherwise.
    if session.uid_mv(&set, target_folder).is_err() {
        session
            .uid_copy(&set, target_folder)
            .map_err(|e| format!("copy failed: {e}"))?;
        session
            .uid_store(&set, "+FLAGS (\\Deleted)")
            .map_err(|e| format!("delete flag failed: {e}"))?;
        session
            .expunge()
            .map_err(|e| format!("expunge failed: {e}"))?;
    }
    Ok(())
}

/// Badge counts keyed by app folder id: unread for inbox/junk, totals for
/// drafts (matching the Gmail sidebar semantics). Missing folders are skipped.
fn folder_counts_blocking(
    session: &mut ImapSession,
) -> Result<std::collections::HashMap<String, u32>, String> {
    let mut counts = std::collections::HashMap::new();
    for (id, mailbox, unread) in [
        ("inbox", "INBOX", true),
        ("junk", "Junk", true),
        ("drafts", "Drafts", false),
    ] {
        if let Ok(status) = session.status(mailbox, "(MESSAGES UNSEEN)") {
            let count = if unread {
                status.unseen.unwrap_or(0)
            } else {
                status.exists
            };
            counts.insert(id.to_string(), count);
        }
    }
    Ok(counts)
}

fn smtp_send_blocking(
    config: &IcloudAccountConfig,
    from_email: &str,
    to: &str,
    cc: Option<&str>,
    bcc: Option<&str>,
    subject: &str,
    body_text: &str,
    body_html: Option<&str>,
    in_reply_to: Option<&str>,
    references: Option<&str>,
) -> Result<(), String> {
    use lettre::message::header::{ContentTransferEncoding, ContentType, InReplyTo, References};
    use lettre::message::{Mailbox, MultiPart, SinglePart};
    use lettre::transport::smtp::authentication::Credentials;
    use lettre::{AsyncSmtpTransport, AsyncTransport, Message, Tokio1Executor};

    let from_addr: Mailbox = from_email
        .parse::<Mailbox>()
        .map_err(|e| format!("invalid from address: {e}"))?;

    let mut builder = Message::builder()
        .from(from_addr)
        .to(to.parse::<Mailbox>().map_err(|e| e.to_string())?)
        .subject(subject);
    if let Some(cc) = cc {
        builder = builder.cc(cc.parse::<Mailbox>().map_err(|e| e.to_string())?);
    }
    if let Some(bcc) = bcc {
        builder = builder.bcc(bcc.parse::<Mailbox>().map_err(|e| e.to_string())?);
    }
    if let Some(irt) = in_reply_to {
        builder = builder.header(InReplyTo::from(irt.to_string()));
    }
    if let Some(refs) = references {
        builder = builder.header(References::from(refs.to_string()));
    }

    let email = if let Some(html) = body_html {
        builder
            .multipart(
                MultiPart::alternative()
                    .singlepart(
                        SinglePart::builder()
                            .header(ContentType::TEXT_PLAIN)
                            .header(ContentTransferEncoding::QuotedPrintable)
                            .body(body_text.to_string()),
                    )
                    .singlepart(
                        SinglePart::builder()
                            .header(ContentType::TEXT_HTML)
                            .header(ContentTransferEncoding::QuotedPrintable)
                            .body(html.to_string()),
                    ),
            )
            .map_err(|e| e.to_string())?
    } else {
        builder
            .singlepart(
                SinglePart::builder()
                    .header(ContentType::TEXT_PLAIN)
                    .header(ContentTransferEncoding::QuotedPrintable)
                    .body(body_text.to_string()),
            )
            .map_err(|e| e.to_string())?
    };

    let creds = Credentials::new(
        config.email.clone(),
        config.app_password.clone(),
    );
    // Port 465 is implicit TLS; 587 (iCloud's default) requires STARTTLS.
    let builder = if config.smtp_port == 465 {
        AsyncSmtpTransport::<Tokio1Executor>::relay(&config.smtp_server)
    } else {
        AsyncSmtpTransport::<Tokio1Executor>::starttls_relay(&config.smtp_server)
    };
    let mailer: AsyncSmtpTransport<Tokio1Executor> = builder
        .map_err(|e| e.to_string())?
        .port(config.smtp_port)
        .credentials(creds)
        .build();

    tauri::async_runtime::block_on(mailer.send(email)).map_err(|e| e.to_string())?;
    Ok(())
}

// --- helpers ---

/// Envelope dates are RFC 2822; normalize to RFC 3339 so SQLite's
/// `ORDER BY date DESC` and JS `new Date()` both behave.
fn normalize_date(raw: Option<String>) -> Option<String> {
    raw.map(|s| {
        // Strip trailing "(CEST)"-style comments parse_from_rfc2822 rejects.
        let trimmed = s.split(" (").next().unwrap_or(&s).trim();
        DateTime::parse_from_rfc2822(trimmed)
            .map(|d| d.with_timezone(&Utc).to_rfc3339())
            .unwrap_or(s.clone())
    })
}

/// List-preview snippet from a plain-text body.
fn snippet_of(text: &str) -> String {
    let collapsed = text.split_whitespace().collect::<Vec<_>>().join(" ");
    collapsed.chars().take(200).collect()
}

fn summary_from_fetch(fetch: &imap::types::Fetch, folder: &str) -> IcloudMessageSummary {
    let uid = fetch.uid.unwrap_or(0);
    let envelope = fetch.envelope();
    let (from_name, from_email) =
        parse_address(envelope.and_then(|e| e.from.as_ref()).and_then(|v| v.first()));
    let to = envelope
        .and_then(|e| e.to.as_ref())
        .map(|v| v.iter().map(address_to_string).collect::<Vec<_>>().join(", "))
        .unwrap_or_default();
    let subject = envelope
        .and_then(|e| e.subject)
        .map(|s| String::from_utf8_lossy(s).into_owned())
        .unwrap_or_else(|| "(no subject)".to_string());
    let message_id = envelope
        .and_then(|e| e.message_id)
        .map(|s| String::from_utf8_lossy(s).into_owned());
    let date = normalize_date(
        envelope
            .and_then(|e| e.date)
            .map(|s| String::from_utf8_lossy(s).into_owned()),
    );
    let flags: Vec<String> = fetch.flags().iter().map(|x| x.to_string()).collect();
    let read = flags.iter().any(|f| f.eq_ignore_ascii_case("\\Seen"));

    IcloudMessageSummary {
        uid,
        message_id,
        from_name,
        from_email,
        to,
        subject,
        snippet: String::new(),
        date,
        flags,
        folder: folder.to_string(),
        read,
    }
}

fn address_to_string(addr: &imap_proto::Address) -> String {
    let mailbox = addr.mailbox.map(|b| String::from_utf8_lossy(b)).unwrap_or_default();
    let host = addr.host.map(|b| String::from_utf8_lossy(b)).unwrap_or_default();
    format!("{mailbox}@{host}")
}

fn parse_address(addr: Option<&imap_proto::Address>) -> (Option<String>, String) {
    match addr {
        Some(a) => {
            let name = a.name.map(|b| String::from_utf8_lossy(b).into_owned());
            let email = address_to_string(a);
            (name, email)
        }
        None => (None, "unknown".to_string()),
    }
}

fn parse_body(raw: &[u8]) -> (String, Option<String>) {
    use mailparse::parse_mail;
    let mail = match parse_mail(raw) {
        Ok(m) => m,
        Err(_) => return (String::new(), None),
    };

    let mut text = String::new();
    let mut html = None;
    collect_parts(&mail, &mut text, &mut html);
    let html = html.filter(|h| !h.trim().is_empty());
    (text, html)
}

fn collect_parts(
    mail: &mailparse::ParsedMail,
    text: &mut String,
    html: &mut Option<String>,
) {
    let ctype = mail.ctype.mimetype.as_str();
    if !mail.subparts.is_empty() {
        for part in &mail.subparts {
            collect_parts(part, text, html);
        }
        return;
    }
    let body = mail.get_body().unwrap_or_default();
    if ctype.contains("text/html") {
        if html.is_none() {
            *html = Some(body);
        }
    } else if ctype.contains("text/plain") {
        if text.is_empty() {
            *text = body;
        }
    }
}

// --- Cache commands ---

#[tauri::command(rename_all = "snake_case")]
pub async fn cache_list_messages(
    cache: State<'_, crate::db::CacheDb>,
    account_id: String,
    folder: String,
    limit: Option<u32>,
) -> Result<Vec<crate::db::CachedMessage>, String> {
    let limit = limit.unwrap_or(50) as usize;
    cache.list_messages(&account_id, &folder, limit).await
}

#[tauri::command(rename_all = "snake_case")]
pub async fn cache_get_message(
    cache: State<'_, crate::db::CacheDb>,
    account_id: String,
    folder: String,
    uid: u32,
) -> Result<Option<crate::db::CachedMessage>, String> {
    cache.get_message(&account_id, &folder, uid).await
}

#[tauri::command(rename_all = "snake_case")]
pub async fn cache_mark_read(
    cache: State<'_, crate::db::CacheDb>,
    account_id: String,
    folder: String,
    uid: u32,
    read: bool,
) -> Result<(), String> {
    cache.mark_read(&account_id, &folder, uid, read).await
}

#[tauri::command(rename_all = "snake_case")]
pub async fn cache_sync_icloud(
    state: State<'_, AccountState>,
    cache: State<'_, crate::db::CacheDb>,
    pool: State<'_, ImapPool>,
    account_id: String,
    folder: String,
    limit: Option<u32>,
) -> Result<u32, String> {
    let config = get_icloud_config(&state, &account_id).await?;
    let limit = limit.unwrap_or(50) as usize;

    let last_uid = cache
        .get_sync_state(&account_id, &folder)
        .await?
        .map(|s| s.last_uid);
    let known_uids = cache.list_uids(&account_id, &folder).await?;

    let imap = pool.0.clone();
    let folder_clone = folder.clone();
    let account = account_id.clone();
    let delta = tauri::async_runtime::spawn_blocking(move || {
        with_imap(&imap, &account, &config, |s| {
            sync_messages_blocking(s, &folder_clone, limit, last_uid, &known_uids)
        })
    })
    .await
    .map_err(|e| e.to_string())??;

    let bodies: std::collections::HashMap<u32, (String, Option<String>)> = delta
        .bodies
        .into_iter()
        .map(|(uid, text, html)| (uid, (text, html)))
        .collect();
    let cached: Vec<crate::db::CachedMessage> = delta
        .new_messages
        .into_iter()
        .map(|m| {
            let (body_text, body_html) = bodies.get(&m.uid).cloned().unwrap_or_default();
            crate::db::CachedMessage {
                uid: m.uid,
                message_id: m.message_id,
                from_name: m.from_name,
                from_email: m.from_email,
                to: m.to,
                cc: None,
                references: None,
                subject: m.subject,
                snippet: snippet_of(&body_text),
                body_text,
                body_html,
                date: m.date,
                flags: m.flags,
                read: m.read,
            }
        })
        .collect();

    let count = cached.len() as u32;
    if !cached.is_empty() {
        cache.upsert_messages(&account_id, &folder, &cached).await?;
    }
    for (uid, flags, read) in delta.flag_updates {
        cache
            .update_flags(&account_id, &folder, uid, &flags, read)
            .await?;
    }
    cache
        .delete_messages(&account_id, &folder, &delta.vanished)
        .await?;
    if let Some(max_uid) = cached.iter().map(|m| m.uid).max() {
        if max_uid > last_uid.unwrap_or(0) {
            cache.update_sync_state(&account_id, &folder, max_uid).await?;
        }
    }

    Ok(count)
}

/// Read the cached folder listing (no network) as summaries the UI renders.
#[tauri::command(rename_all = "snake_case")]
pub async fn icloud_cached_messages(
    cache: State<'_, crate::db::CacheDb>,
    account_id: String,
    folder: String,
    limit: Option<u32>,
) -> Result<Vec<IcloudMessageSummary>, String> {
    let messages = cache
        .list_messages(&account_id, &folder, limit.unwrap_or(50) as usize)
        .await?;
    Ok(messages
        .into_iter()
        .map(|m| IcloudMessageSummary {
            uid: m.uid,
            message_id: m.message_id,
            from_name: m.from_name,
            from_email: m.from_email,
            to: m.to,
            subject: m.subject,
            snippet: m.snippet,
            date: m.date,
            flags: m.flags,
            folder: folder.clone(),
            read: m.read,
        })
        .collect())
}

#[tauri::command(rename_all = "snake_case")]
pub async fn cache_get_json(
    cache: State<'_, crate::db::CacheDb>,
    key: String,
) -> Result<Option<String>, String> {
    cache.get_kv(&key).await
}

#[tauri::command(rename_all = "snake_case")]
pub async fn cache_put_json(
    cache: State<'_, crate::db::CacheDb>,
    key: String,
    json: String,
) -> Result<(), String> {
    cache.put_kv(&key, &json).await
}

#[tauri::command(rename_all = "snake_case")]
pub async fn cache_delete_prefix(
    cache: State<'_, crate::db::CacheDb>,
    prefix: String,
) -> Result<(), String> {
    cache.delete_kv_prefix(&prefix).await
}

/// Drop one message from the local cache (offline archive/trash bookkeeping).
#[tauri::command(rename_all = "snake_case")]
pub async fn cache_remove_message(
    cache: State<'_, crate::db::CacheDb>,
    account_id: String,
    folder: String,
    uid: u32,
) -> Result<(), String> {
    cache.delete_messages(&account_id, &folder, &[uid]).await
}

// --- offline operation queue ---

#[tauri::command(rename_all = "snake_case")]
pub async fn ops_enqueue(
    cache: State<'_, crate::db::CacheDb>,
    kind: String,
    payload: String,
) -> Result<i64, String> {
    cache.enqueue_op(&kind, &payload).await
}

#[tauri::command(rename_all = "snake_case")]
pub async fn ops_list(
    cache: State<'_, crate::db::CacheDb>,
) -> Result<Vec<crate::db::PendingOp>, String> {
    cache.list_ops().await
}

#[tauri::command(rename_all = "snake_case")]
pub async fn ops_delete(
    cache: State<'_, crate::db::CacheDb>,
    id: i64,
) -> Result<(), String> {
    cache.delete_op(id).await
}

#[tauri::command(rename_all = "snake_case")]
pub async fn ops_bump(
    cache: State<'_, crate::db::CacheDb>,
    id: i64,
) -> Result<(), String> {
    cache.bump_op(id).await
}

#[tauri::command(rename_all = "snake_case")]
pub async fn cache_delete_account(
    cache: State<'_, crate::db::CacheDb>,
    account_id: String,
) -> Result<(), String> {
    cache.delete_account_cache(&account_id).await
}