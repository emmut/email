use std::path::PathBuf;
use std::sync::Arc;

use chrono::Utc;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

const CACHE_DB_NAME: &str = "mail_cache.db";

fn cache_db_path(app: &AppHandle) -> PathBuf {
    let mut path = app.path().app_data_dir().expect("app data dir");
    std::fs::create_dir_all(&path).ok();
    path.push(CACHE_DB_NAME);
    path
}

pub struct CacheDb {
    pub conn: Arc<tokio::sync::Mutex<Connection>>,
}

impl CacheDb {
    pub fn new(app: &AppHandle) -> Result<Self, String> {
        let path = cache_db_path(app);
        let conn = Connection::open(&path).map_err(|e| e.to_string())?;
        Self::init_tables(&conn)?;
        Ok(Self {
            conn: Arc::new(tokio::sync::Mutex::new(conn)),
        })
    }

    fn init_tables(conn: &Connection) -> Result<(), String> {
        conn.execute_batch(
            r#"
            CREATE TABLE IF NOT EXISTS cached_messages (
                account_id TEXT NOT NULL,
                uid INTEGER NOT NULL,
                folder TEXT NOT NULL,
                message_id TEXT,
                from_name TEXT,
                from_email TEXT NOT NULL,
                "to" TEXT NOT NULL,
                subject TEXT NOT NULL,
                snippet TEXT NOT NULL DEFAULT '',
                body_text TEXT NOT NULL DEFAULT '',
                body_html TEXT,
                date TEXT,
                flags TEXT NOT NULL DEFAULT '[]',
                read INTEGER NOT NULL DEFAULT 0,
                fetched_at TEXT NOT NULL,
                PRIMARY KEY (account_id, folder, uid)
            );
            CREATE INDEX IF NOT EXISTS idx_cached_messages_account
                ON cached_messages(account_id, folder);
            CREATE INDEX IF NOT EXISTS idx_cached_messages_date
                ON cached_messages(account_id, folder, date DESC);

            CREATE TABLE IF NOT EXISTS sync_state (
                account_id TEXT NOT NULL,
                folder TEXT NOT NULL,
                last_uid INTEGER NOT NULL DEFAULT 0,
                last_synced_at TEXT NOT NULL,
                PRIMARY KEY (account_id, folder)
            );
            "#,
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub async fn upsert_messages(
        &self,
        account_id: &str,
        folder: &str,
        messages: &[CachedMessage],
    ) -> Result<(), String> {
        let conn = self.conn.lock().await;
        let now = Utc::now().to_rfc3339();
        let mut stmt = conn
            .prepare(
                "INSERT OR REPLACE INTO cached_messages
                 (account_id, uid, folder, message_id, from_name, from_email, \"to\",
                  subject, snippet, body_text, body_html, date, flags, read, fetched_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)",
            )
            .map_err(|e| e.to_string())?;

        for msg in messages {
            let flags_json = serde_json::to_string(&msg.flags).unwrap_or_default();
            stmt.execute(params![
                account_id,
                msg.uid,
                folder,
                msg.message_id,
                msg.from_name,
                msg.from_email,
                msg.to,
                msg.subject,
                msg.snippet,
                msg.body_text,
                msg.body_html,
                msg.date,
                flags_json,
                msg.read,
                now,
            ])
            .map_err(|e| e.to_string())?;
        }
        Ok(())
    }

    pub async fn list_messages(
        &self,
        account_id: &str,
        folder: &str,
        limit: usize,
    ) -> Result<Vec<CachedMessage>, String> {
        let conn = self.conn.lock().await;
        let mut stmt = conn
            .prepare(
                "SELECT uid, message_id, from_name, from_email, \"to\", subject,
                        snippet, body_text, body_html, date, flags, read
                 FROM cached_messages
                 WHERE account_id = ?1 AND folder = ?2
                 ORDER BY date DESC
                 LIMIT ?3",
            )
            .map_err(|e| e.to_string())?;

        let messages = stmt
            .query_map(params![account_id, folder, limit as i64], |row| {
                let flags_json: String = row.get(10)?;
                let flags: Vec<String> =
                    serde_json::from_str(&flags_json).unwrap_or_default();
                Ok(CachedMessage {
                    uid: row.get(0)?,
                    message_id: row.get(1)?,
                    from_name: row.get(2)?,
                    from_email: row.get(3)?,
                    to: row.get(4)?,
                    subject: row.get(5)?,
                    snippet: row.get(6)?,
                    body_text: row.get(7)?,
                    body_html: row.get(8)?,
                    date: row.get(9)?,
                    flags,
                    read: row.get(11)?,
                })
            })
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;

        Ok(messages)
    }

    pub async fn get_message(
        &self,
        account_id: &str,
        folder: &str,
        uid: u32,
    ) -> Result<Option<CachedMessage>, String> {
        let conn = self.conn.lock().await;
        let mut stmt = conn
            .prepare(
                "SELECT uid, message_id, from_name, from_email, \"to\", subject,
                        snippet, body_text, body_html, date, flags, read
                 FROM cached_messages
                 WHERE account_id = ?1 AND folder = ?2 AND uid = ?3",
            )
            .map_err(|e| e.to_string())?;

        let mut rows = stmt
            .query_map(params![account_id, folder, uid], |row| {
                let flags_json: String = row.get(10)?;
                let flags: Vec<String> =
                    serde_json::from_str(&flags_json).unwrap_or_default();
                Ok(CachedMessage {
                    uid: row.get(0)?,
                    message_id: row.get(1)?,
                    from_name: row.get(2)?,
                    from_email: row.get(3)?,
                    to: row.get(4)?,
                    subject: row.get(5)?,
                    snippet: row.get(6)?,
                    body_text: row.get(7)?,
                    body_html: row.get(8)?,
                    date: row.get(9)?,
                    flags,
                    read: row.get(11)?,
                })
            })
            .map_err(|e| e.to_string())?;

        match rows.next() {
            Some(row) => Ok(Some(row.map_err(|e| e.to_string())?)),
            None => Ok(None),
        }
    }

    pub async fn update_sync_state(
        &self,
        account_id: &str,
        folder: &str,
        last_uid: u32,
    ) -> Result<(), String> {
        let conn = self.conn.lock().await;
        let now = Utc::now().to_rfc3339();
        conn.execute(
            "INSERT OR REPLACE INTO sync_state (account_id, folder, last_uid, last_synced_at)
             VALUES (?1, ?2, ?3, ?4)",
            params![account_id, folder, last_uid, now],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub async fn get_sync_state(
        &self,
        account_id: &str,
        folder: &str,
    ) -> Result<Option<SyncState>, String> {
        let conn = self.conn.lock().await;
        let mut stmt = conn
            .prepare(
                "SELECT last_uid, last_synced_at FROM sync_state
                 WHERE account_id = ?1 AND folder = ?2",
            )
            .map_err(|e| e.to_string())?;

        let mut rows = stmt
            .query_map(params![account_id, folder], |row| {
                Ok(SyncState {
                    last_uid: row.get(0)?,
                    last_synced_at: row.get(1)?,
                })
            })
            .map_err(|e| e.to_string())?;

        match rows.next() {
            Some(row) => Ok(Some(row.map_err(|e| e.to_string())?)),
            None => Ok(None),
        }
    }

    pub async fn delete_account_cache(&self, account_id: &str) -> Result<(), String> {
        let conn = self.conn.lock().await;
        conn.execute(
            "DELETE FROM cached_messages WHERE account_id = ?1",
            params![account_id],
        )
        .map_err(|e| e.to_string())?;
        conn.execute(
            "DELETE FROM sync_state WHERE account_id = ?1",
            params![account_id],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub async fn mark_read(
        &self,
        account_id: &str,
        folder: &str,
        uid: u32,
        read: bool,
    ) -> Result<(), String> {
        let conn = self.conn.lock().await;
        conn.execute(
            "UPDATE cached_messages SET read = ?3
             WHERE account_id = ?1 AND folder = ?2 AND uid = ?4",
            params![account_id, folder, read, uid],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CachedMessage {
    pub uid: u32,
    pub message_id: Option<String>,
    pub from_name: Option<String>,
    pub from_email: String,
    pub to: String,
    pub subject: String,
    pub snippet: String,
    pub body_text: String,
    pub body_html: Option<String>,
    pub date: Option<String>,
    pub flags: Vec<String>,
    pub read: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncState {
    pub last_uid: u32,
    pub last_synced_at: String,
}
