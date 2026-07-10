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
}

impl AccountState {
    pub fn new(app: &AppHandle) -> Result<Self, String> {
        let conn = get_conn(app)?;
        Ok(Self {
            db: Arc::new(tokio::sync::Mutex::new(conn)),
        })
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

    let config = AccountConfig::Google(GoogleAccountConfig {
        refresh_token: refresh.to_string(),
        access_token: Some(access_token),
        access_token_expires_at: Some(now + chrono::Duration::seconds(tokens.expires_in as i64 - 60)),
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

    let config = AccountConfig::Icloud(icloud_config);

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
    account_id: String,
) -> Result<(), String> {
    // Delete from Keychain
    delete_secret(&account_id)?;

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

    // Drop any cached mail for the account
    cache.delete_account_cache(&account_id).await?;

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
pub async fn get_account_config(
    state: State<'_, AccountState>,
    account_id: String,
) -> Result<AccountConfig, String> {
    get_account_config_inner(&state, &account_id).await
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
    let config = get_account_config_inner(&state, &account_id).await?;
    let AccountConfig::Google(google_config) = config else {
        return Err("not a Google account".to_string());
    };

    // Check cached token
    if let (Some(token), Some(expires)) = (&google_config.access_token, &google_config.access_token_expires_at) {
        if *expires > Utc::now() {
            return Ok(token.clone());
        }
    }

    // Refresh
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

    // Update stored config
    let db = state.db.lock().await;
    let new_config = AccountConfig::Google(GoogleAccountConfig {
        refresh_token: tokens.refresh_token.as_deref().unwrap_or(&refresh_token).to_string(),
        access_token: Some(tokens.access_token.clone()),
        access_token_expires_at: Some(Utc::now() + chrono::Duration::seconds(tokens.expires_in as i64 - 60)),
    });
    db.execute(
        "UPDATE accounts SET config = ?1, updated_at = ?2 WHERE id = ?3",
        params![
            &serde_json::to_string(&new_config).map_err(|e| e.to_string())?,
            &Utc::now().to_rfc3339(),
            &account_id,
        ],
    )
    .map_err(|e| e.to_string())?;

    // Update keychain if refresh token rotated
    if let Some(new_refresh) = tokens.refresh_token {
        store_secret(&account_id, &new_refresh)?;
    }

    Ok(tokens.access_token)
}

#[tauri::command(rename_all = "snake_case")]
pub async fn get_icloud_credentials(
    state: State<'_, AccountState>,
    account_id: String,
) -> Result<IcloudAccountConfig, String> {
    let config = get_account_config_inner(&state, &account_id).await?;
    let AccountConfig::Icloud(cfg) = config else {
        return Err("not an iCloud account".to_string());
    };
    Ok(cfg)
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
pub struct IcloudFolder {
    pub name: String,
    pub delimiter: String,
    pub attributes: Vec<String>,
}

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
    pub subject: String,
    pub body_text: String,
    pub body_html: Option<String>,
    pub date: Option<String>,
    pub flags: Vec<String>,
    pub folder: String,
}

#[tauri::command(rename_all = "snake_case")]
pub async fn icloud_list_folders(
    state: State<'_, AccountState>,
    account_id: String,
) -> Result<Vec<IcloudFolder>, String> {
    let config = get_icloud_config(&state, &account_id).await?;
    tauri::async_runtime::spawn_blocking(move || list_folders_blocking(&config))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command(rename_all = "snake_case")]
pub async fn icloud_list_messages(
    state: State<'_, AccountState>,
    account_id: String,
    folder: String,
    limit: Option<u32>,
) -> Result<Vec<IcloudMessageSummary>, String> {
    let config = get_icloud_config(&state, &account_id).await?;
    let limit = limit.unwrap_or(50) as usize;
    tauri::async_runtime::spawn_blocking(move || {
        list_messages_blocking(&config, &folder, limit)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command(rename_all = "snake_case")]
pub async fn icloud_fetch_message(
    state: State<'_, AccountState>,
    account_id: String,
    folder: String,
    uid: u32,
) -> Result<IcloudMessageDetail, String> {
    let config = get_icloud_config(&state, &account_id).await?;
    tauri::async_runtime::spawn_blocking(move || fetch_message_blocking(&config, &folder, uid))
        .await
        .map_err(|e| e.to_string())?
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
    account_id: String,
    folder: String,
    uid: u32,
    read: bool,
) -> Result<(), String> {
    let config = get_icloud_config(&state, &account_id).await?;
    tauri::async_runtime::spawn_blocking(move || {
        mark_read_blocking(&config, &folder, uid, read)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command(rename_all = "snake_case")]
pub async fn icloud_move_message(
    state: State<'_, AccountState>,
    account_id: String,
    folder: String,
    uid: u32,
    target_folder: String,
) -> Result<(), String> {
    let config = get_icloud_config(&state, &account_id).await?;
    tauri::async_runtime::spawn_blocking(move || {
        move_message_blocking(&config, &folder, uid, &target_folder)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command(rename_all = "snake_case")]
pub async fn icloud_folder_counts(
    state: State<'_, AccountState>,
    account_id: String,
) -> Result<std::collections::HashMap<String, u32>, String> {
    let config = get_icloud_config(&state, &account_id).await?;
    tauri::async_runtime::spawn_blocking(move || folder_counts_blocking(&config))
        .await
        .map_err(|e| e.to_string())?
}

async fn get_icloud_config(
    state: &State<'_, AccountState>,
    account_id: &str,
) -> Result<IcloudAccountConfig, String> {
    let config = get_account_config_inner(state, account_id).await?;
    match config {
        AccountConfig::Icloud(cfg) => Ok(cfg),
        _ => Err("not an iCloud account".to_string()),
    }
}

// --- blocking IMAP/SMTP helpers (run on blocking threads) ---

type ImapSession = imap::Session<native_tls::TlsStream<std::net::TcpStream>>;

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

fn list_folders_blocking(config: &IcloudAccountConfig) -> Result<Vec<IcloudFolder>, String> {
    let mut session = connect_imap(config)?;
    let folders = session
        .list(Some(""), Some("*"))
        .map_err(|e| format!("list folders failed: {e}"))?;
    let mut out = Vec::new();
    for f in folders.iter() {
        out.push(IcloudFolder {
            name: f.name().to_string(),
            delimiter: f.delimiter().unwrap_or("").to_string(),
            attributes: f.attributes().iter().map(|a| format!("{a:?}")).collect(),
        });
    }
    let _ = session.logout();
    Ok(out)
}

fn list_messages_blocking(
    config: &IcloudAccountConfig,
    folder: &str,
    limit: usize,
) -> Result<Vec<IcloudMessageSummary>, String> {
    let mut session = connect_imap(config)?;
    session
        .select(folder)
        .map_err(|e| format!("select folder failed: {e}"))?;

    let seqs = session
        .search("ALL")
        .map_err(|e| format!("search failed: {e}"))?;
    let mut seqs: Vec<u32> = seqs.into_iter().collect();
    let total = seqs.len();
    if total == 0 {
        let _ = session.logout();
        return Ok(Vec::new());
    }
    // Take the most recent `limit` by sequence number (highest = newest).
    seqs.sort();
    let start = total.saturating_sub(limit);
    let slice = &seqs[start..];
    let set: String = slice
        .iter()
        .map(|s| s.to_string())
        .collect::<Vec<_>>()
        .join(",");

    let fetches = session
        .fetch(&set, "(UID FLAGS ENVELOPE BODY.PEEK[HEADER.FIELDS (FROM TO SUBJECT DATE MESSAGE-ID)])")
        .map_err(|e| format!("fetch failed: {e}"))?;

    let mut messages = Vec::new();
    for fetch in fetches.iter() {
        let uid = fetch.uid.unwrap_or(0);
        let envelope = fetch.envelope();
        let (from_name, from_email) = parse_address(envelope.and_then(|e| e.from.as_ref()).and_then(|v| v.first()));
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
        let date = envelope.and_then(|e| e.date).map(|s| String::from_utf8_lossy(s).into_owned());

        // Snippet from the header we fetched (fallback to empty).
        let snippet = String::new();
        let flags: Vec<String> = fetch.flags().iter().map(|x| x.to_string()).collect();
        let read = flags.iter().any(|f| f.eq_ignore_ascii_case("\\Seen"));

        messages.push(IcloudMessageSummary {
            uid,
            message_id,
            from_name,
            from_email,
            to,
            subject,
            snippet,
            date,
            flags,
            folder: folder.to_string(),
            read,
        });
    }

    // Newest first.
    messages.reverse();
    let _ = session.logout();
    Ok(messages)
}

fn sync_messages_blocking(
    config: &IcloudAccountConfig,
    folder: &str,
    limit: usize,
    last_uid: Option<u32>,
) -> Result<Vec<IcloudMessageSummary>, String> {
    let mut session = connect_imap(config)?;
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
    if uids.is_empty() {
        let _ = session.logout();
        return Ok(Vec::new());
    }

    uids.sort();
    let total = uids.len();
    let start = total.saturating_sub(limit);
    let slice = &uids[start..];
    let set: String = slice
        .iter()
        .map(|s| s.to_string())
        .collect::<Vec<_>>()
        .join(",");

    let fetches = session
        .uid_fetch(&set, "(UID FLAGS ENVELOPE BODY.PEEK[HEADER.FIELDS (FROM TO SUBJECT DATE MESSAGE-ID)])")
        .map_err(|e| format!("uid fetch failed: {e}"))?;

    let mut messages = Vec::new();
    for fetch in fetches.iter() {
        let uid = fetch.uid.unwrap_or(0);
        let envelope = fetch.envelope();
        let (from_name, from_email) = parse_address(envelope.and_then(|e| e.from.as_ref()).and_then(|v| v.first()));
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
        let date = envelope.and_then(|e| e.date).map(|s| String::from_utf8_lossy(s).into_owned());

        let snippet = String::new();
        let flags: Vec<String> = fetch.flags().iter().map(|x| x.to_string()).collect();
        let read = flags.iter().any(|f| f.eq_ignore_ascii_case("\\Seen"));

        messages.push(IcloudMessageSummary {
            uid,
            message_id,
            from_name,
            from_email,
            to,
            subject,
            snippet,
            date,
            flags,
            folder: folder.to_string(),
            read,
        });
    }

    messages.reverse();
    let _ = session.logout();
    Ok(messages)
}

fn fetch_message_blocking(
    config: &IcloudAccountConfig,
    folder: &str,
    uid: u32,
) -> Result<IcloudMessageDetail, String> {
    let mut session = connect_imap(config)?;
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
    let date = envelope.and_then(|e| e.date).map(|s| String::from_utf8_lossy(s).into_owned());
    let flags: Vec<String> = fetch.flags().iter().map(|x| x.to_string()).collect();

    let (body_text, body_html) = match fetch.body() {
        Some(raw) => parse_body(raw),
        None => (String::new(), None),
    };

    let _ = session.logout();
    Ok(IcloudMessageDetail {
        uid,
        message_id,
        from_name,
        from_email,
        to,
        cc,
        subject,
        body_text,
        body_html,
        date,
        flags,
        folder: folder.to_string(),
    })
}

fn mark_read_blocking(
    config: &IcloudAccountConfig,
    folder: &str,
    uid: u32,
    read: bool,
) -> Result<(), String> {
    let mut session = connect_imap(config)?;
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
    let _ = session.logout();
    Ok(())
}

fn move_message_blocking(
    config: &IcloudAccountConfig,
    folder: &str,
    uid: u32,
    target_folder: &str,
) -> Result<(), String> {
    let mut session = connect_imap(config)?;
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
    let _ = session.logout();
    Ok(())
}

/// Badge counts keyed by app folder id: unread for inbox/junk, totals for
/// drafts (matching the Gmail sidebar semantics). Missing folders are skipped.
fn folder_counts_blocking(
    config: &IcloudAccountConfig,
) -> Result<std::collections::HashMap<String, u32>, String> {
    let mut session = connect_imap(config)?;
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
    let _ = session.logout();
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
    account_id: String,
    folder: String,
    limit: Option<u32>,
) -> Result<u32, String> {
    let config = get_icloud_config(&state, &account_id).await?;
    let limit = limit.unwrap_or(50) as usize;

    // Get last synced UID for incremental sync
    let last_uid = cache
        .get_sync_state(&account_id, &folder)
        .await
        .map_err(|e| e.to_string())?
        .map(|s| s.last_uid);

    let folder_clone = folder.clone();
    let messages = tauri::async_runtime::spawn_blocking(move || {
        sync_messages_blocking(&config, &folder_clone, limit, last_uid)
    })
    .await
    .map_err(|e| e.to_string())??;

    let cached: Vec<crate::db::CachedMessage> = messages
        .into_iter()
        .map(|m| crate::db::CachedMessage {
            uid: m.uid,
            message_id: m.message_id,
            from_name: m.from_name,
            from_email: m.from_email,
            to: m.to,
            subject: m.subject,
            snippet: m.snippet,
            body_text: String::new(),
            body_html: None,
            date: m.date,
            flags: m.flags,
            read: m.read,
        })
        .collect();

    let count = cached.len() as u32;
    if let Some(max_uid) = cached.iter().map(|m| m.uid).max() {
        cache.upsert_messages(&account_id, &folder, &cached).await?;
        cache.update_sync_state(&account_id, &folder, max_uid).await?;
    }

    Ok(count)
}

#[tauri::command(rename_all = "snake_case")]
pub async fn cache_delete_account(
    cache: State<'_, crate::db::CacheDb>,
    account_id: String,
) -> Result<(), String> {
    cache.delete_account_cache(&account_id).await
}