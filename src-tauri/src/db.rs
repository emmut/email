use std::path::PathBuf;
use std::sync::Arc;

use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension, Row};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

const MESSAGE_COLUMNS: &str = "uid, message_id, from_name, from_email, \"to\", cc, refs, subject,
     snippet, body_text, body_html, date, flags, read";

// Rows synced before encoded-word decoding landed hold raw RFC 2047 text;
// decode on read so the old cache heals without a resync.
fn fix_encoded(s: String) -> String {
    if s.contains("=?") {
        crate::account::decode_envelope_string(s.as_bytes())
    } else {
        s
    }
}

fn row_to_message(row: &Row<'_>) -> rusqlite::Result<CachedMessage> {
    let flags_json: String = row.get(12)?;
    let flags: Vec<String> = serde_json::from_str(&flags_json).unwrap_or_default();
    Ok(CachedMessage {
        uid: row.get(0)?,
        message_id: row.get(1)?,
        from_name: row.get::<_, Option<String>>(2)?.map(fix_encoded),
        from_email: row.get(3)?,
        to: row.get(4)?,
        cc: row.get(5)?,
        references: row.get(6)?,
        subject: fix_encoded(row.get(7)?),
        snippet: row.get(8)?,
        body_text: row.get(9)?,
        body_html: row.get(10)?,
        date: row.get(11)?,
        flags,
        read: row.get(13)?,
    })
}

#[derive(Debug, Serialize)]
pub struct CachedContact {
    pub name: Option<String>,
    pub email: String,
}

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
        // WAL keeps readers unblocked during sync writes; NORMAL sync is safe
        // with WAL and much faster for a disposable cache.
        let _ = conn.pragma_update(None, "journal_mode", "WAL");
        let _ = conn.pragma_update(None, "synchronous", "NORMAL");
        let _ = conn.pragma_update(None, "busy_timeout", 5000);
        Self::init_tables(&conn)?;
        Ok(Self {
            conn: Arc::new(tokio::sync::Mutex::new(conn)),
        })
    }

    fn init_tables(conn: &Connection) -> Result<(), String> {
        // Cache contents are disposable — on schema changes, drop and rebuild.
        let version: i64 = conn
            .query_row("PRAGMA user_version", [], |r| r.get(0))
            .map_err(|e| e.to_string())?;
        if version < 3 {
            conn.execute_batch(
                r#"
                DROP TABLE IF EXISTS cached_messages;
                DROP TABLE IF EXISTS sync_state;
                DROP TABLE IF EXISTS gmail_messages;
                DROP TABLE IF EXISTS gmail_message_labels;
                PRAGMA user_version = 3;
                "#,
            )
            .map_err(|e| e.to_string())?;
        }
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
                cc TEXT,
                refs TEXT,
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

            -- Generic JSON cache (Gmail lists/bodies), keyed by opaque strings.
            CREATE TABLE IF NOT EXISTS cache_kv (
                key TEXT PRIMARY KEY,
                json TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            -- Gmail message store: one row per message, label membership in a
            -- join table so folder listings are index lookups.
            CREATE TABLE IF NOT EXISTS gmail_messages (
                account_id TEXT NOT NULL,
                id TEXT NOT NULL,
                thread_id TEXT,
                name TEXT NOT NULL,
                email TEXT NOT NULL,
                subject TEXT NOT NULL,
                snippet TEXT NOT NULL DEFAULT '',
                date TEXT NOT NULL,
                read INTEGER NOT NULL DEFAULT 0,
                label_ids TEXT NOT NULL DEFAULT '[]',
                fetched_at TEXT NOT NULL,
                PRIMARY KEY (account_id, id)
            );
            CREATE INDEX IF NOT EXISTS idx_gmail_messages_date
                ON gmail_messages(account_id, date DESC);
            CREATE TABLE IF NOT EXISTS gmail_message_labels (
                account_id TEXT NOT NULL,
                message_id TEXT NOT NULL,
                label_id TEXT NOT NULL,
                PRIMARY KEY (account_id, message_id, label_id)
            );
            CREATE INDEX IF NOT EXISTS idx_gmail_labels_label
                ON gmail_message_labels(account_id, label_id);

            -- Offline write queue: actions taken while offline, replayed
            -- against the provider when connectivity returns.
            CREATE TABLE IF NOT EXISTS pending_ops (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                kind TEXT NOT NULL,
                payload TEXT NOT NULL,
                attempts INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL
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
                 (account_id, uid, folder, message_id, from_name, from_email, \"to\", cc, refs,
                  subject, snippet, body_text, body_html, date, flags, read, fetched_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17)",
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
                msg.cc,
                msg.references,
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
            .prepare(&format!(
                "SELECT {MESSAGE_COLUMNS}
                 FROM cached_messages
                 WHERE account_id = ?1 AND folder = ?2
                 ORDER BY date DESC, uid DESC
                 LIMIT ?3"
            ))
            .map_err(|e| e.to_string())?;

        let messages = stmt
            .query_map(params![account_id, folder, limit as i64], row_to_message)
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
            .prepare(&format!(
                "SELECT {MESSAGE_COLUMNS}
                 FROM cached_messages
                 WHERE account_id = ?1 AND folder = ?2 AND uid = ?3"
            ))
            .map_err(|e| e.to_string())?;

        let mut rows = stmt
            .query_map(params![account_id, folder, uid], row_to_message)
            .map_err(|e| e.to_string())?;

        match rows.next() {
            Some(row) => Ok(Some(row.map_err(|e| e.to_string())?)),
            None => Ok(None),
        }
    }

    /// All cached UIDs for a folder — the set the incremental sync verifies
    /// (flag refresh + vanished-message detection).
    pub async fn list_uids(&self, account_id: &str, folder: &str) -> Result<Vec<u32>, String> {
        let conn = self.conn.lock().await;
        let mut stmt = conn
            .prepare("SELECT uid FROM cached_messages WHERE account_id = ?1 AND folder = ?2")
            .map_err(|e| e.to_string())?;
        let uids = stmt
            .query_map(params![account_id, folder], |row| row.get(0))
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<u32>, _>>()
            .map_err(|e| e.to_string())?;
        Ok(uids)
    }

    pub async fn update_flags(
        &self,
        account_id: &str,
        folder: &str,
        uid: u32,
        flags: &[String],
        read: bool,
    ) -> Result<(), String> {
        let conn = self.conn.lock().await;
        let flags_json = serde_json::to_string(flags).unwrap_or_default();
        conn.execute(
            "UPDATE cached_messages SET flags = ?4, read = ?3
             WHERE account_id = ?1 AND folder = ?2 AND uid = ?5",
            params![account_id, folder, read, flags_json, uid],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub async fn delete_messages(
        &self,
        account_id: &str,
        folder: &str,
        uids: &[u32],
    ) -> Result<(), String> {
        if uids.is_empty() {
            return Ok(());
        }
        let conn = self.conn.lock().await;
        let list = uids
            .iter()
            .map(|u| u.to_string())
            .collect::<Vec<_>>()
            .join(",");
        conn.execute(
            &format!(
                "DELETE FROM cached_messages
                 WHERE account_id = ?1 AND folder = ?2 AND uid IN ({list})"
            ),
            params![account_id, folder],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub async fn get_kv(&self, key: &str) -> Result<Option<String>, String> {
        let conn = self.conn.lock().await;
        conn.query_row(
            "SELECT json FROM cache_kv WHERE key = ?1",
            params![key],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())
    }

    pub async fn put_kv(&self, key: &str, json: &str) -> Result<(), String> {
        let conn = self.conn.lock().await;
        conn.execute(
            "INSERT OR REPLACE INTO cache_kv (key, json, updated_at) VALUES (?1, ?2, ?3)",
            params![key, json, Utc::now().to_rfc3339()],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    // --- Gmail message store ---
    //
    // Folder semantics: a folder is either one label id (INBOX, DRAFT, tag
    // labels, …) or `None` = Archive (no system folder label at all).

    pub async fn gmail_replace_folder(
        &self,
        account_id: &str,
        label_id: Option<&str>,
        messages: &[GmailCachedMessage],
    ) -> Result<(), String> {
        let mut conn = self.conn.lock().await;
        let tx = conn.transaction().map_err(|e| e.to_string())?;
        match label_id {
            Some(label) => {
                tx.execute(
                    "DELETE FROM gmail_messages WHERE account_id = ?1 AND id IN
                     (SELECT message_id FROM gmail_message_labels
                      WHERE account_id = ?1 AND label_id = ?2)",
                    params![account_id, label],
                )
                .map_err(|e| e.to_string())?;
            }
            None => {
                tx.execute(
                    &format!(
                        "DELETE FROM gmail_messages WHERE account_id = ?1 AND id NOT IN
                         (SELECT message_id FROM gmail_message_labels
                          WHERE account_id = ?1 AND label_id IN ({GMAIL_FOLDER_LABELS}))"
                    ),
                    params![account_id],
                )
                .map_err(|e| e.to_string())?;
            }
        }
        // Orphaned label rows from the deletes above
        tx.execute(
            "DELETE FROM gmail_message_labels WHERE account_id = ?1 AND message_id NOT IN
             (SELECT id FROM gmail_messages WHERE account_id = ?1)",
            params![account_id],
        )
        .map_err(|e| e.to_string())?;
        gmail_upsert_in_tx(&tx, account_id, messages)?;
        tx.commit().map_err(|e| e.to_string())
    }

    pub async fn gmail_upsert(
        &self,
        account_id: &str,
        messages: &[GmailCachedMessage],
    ) -> Result<(), String> {
        let mut conn = self.conn.lock().await;
        let tx = conn.transaction().map_err(|e| e.to_string())?;
        gmail_upsert_in_tx(&tx, account_id, messages)?;
        tx.commit().map_err(|e| e.to_string())
    }

    pub async fn gmail_list(
        &self,
        account_id: &str,
        label_id: Option<&str>,
        limit: usize,
    ) -> Result<Vec<GmailCachedMessage>, String> {
        let conn = self.conn.lock().await;
        let (sql, has_label) = match label_id {
            Some(_) => (
                "SELECT m.id, m.thread_id, m.name, m.email, m.subject, m.snippet,
                        m.date, m.read, m.label_ids
                 FROM gmail_messages m
                 JOIN gmail_message_labels l
                   ON l.account_id = m.account_id AND l.message_id = m.id
                 WHERE m.account_id = ?1 AND l.label_id = ?2
                 ORDER BY m.date DESC LIMIT ?3"
                    .to_string(),
                true,
            ),
            None => (
                format!(
                    "SELECT id, thread_id, name, email, subject, snippet,
                            date, read, label_ids
                     FROM gmail_messages
                     WHERE account_id = ?1 AND id NOT IN
                       (SELECT message_id FROM gmail_message_labels
                        WHERE account_id = ?1 AND label_id IN ({GMAIL_FOLDER_LABELS}))
                     ORDER BY date DESC LIMIT ?2"
                ),
                false,
            ),
        };
        let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
        let map_row = |row: &Row<'_>| -> rusqlite::Result<GmailCachedMessage> {
            let label_json: String = row.get(8)?;
            Ok(GmailCachedMessage {
                id: row.get(0)?,
                thread_id: row.get(1)?,
                name: fix_encoded(row.get(2)?),
                email: row.get(3)?,
                subject: fix_encoded(row.get(4)?),
                snippet: row.get(5)?,
                date: row.get(6)?,
                read: row.get(7)?,
                label_ids: serde_json::from_str(&label_json).unwrap_or_default(),
            })
        };
        let rows = if has_label {
            stmt.query_map(
                params![account_id, label_id.unwrap(), limit as i64],
                map_row,
            )
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
        } else {
            stmt.query_map(params![account_id, limit as i64], map_row)
                .map_err(|e| e.to_string())?
                .collect::<Result<Vec<_>, _>>()
        };
        rows.map_err(|e| e.to_string())
    }

    pub async fn gmail_modify_labels(
        &self,
        account_id: &str,
        message_id: &str,
        add: &[String],
        remove: &[String],
    ) -> Result<(), String> {
        let mut conn = self.conn.lock().await;
        let tx = conn.transaction().map_err(|e| e.to_string())?;
        let label_json: Option<String> = tx
            .query_row(
                "SELECT label_ids FROM gmail_messages WHERE account_id = ?1 AND id = ?2",
                params![account_id, message_id],
                |r| r.get(0),
            )
            .optional()
            .map_err(|e| e.to_string())?;
        let Some(label_json) = label_json else {
            return Ok(()); // not cached — nothing to do
        };
        let mut labels: Vec<String> = serde_json::from_str(&label_json).unwrap_or_default();
        labels.retain(|l| !remove.contains(l));
        for l in add {
            if !labels.contains(l) {
                labels.push(l.clone());
            }
        }
        let read = !labels.iter().any(|l| l == "UNREAD");
        tx.execute(
            "UPDATE gmail_messages SET label_ids = ?3, read = ?4
             WHERE account_id = ?1 AND id = ?2",
            params![
                account_id,
                message_id,
                serde_json::to_string(&labels).unwrap_or_default(),
                read
            ],
        )
        .map_err(|e| e.to_string())?;
        tx.execute(
            "DELETE FROM gmail_message_labels WHERE account_id = ?1 AND message_id = ?2",
            params![account_id, message_id],
        )
        .map_err(|e| e.to_string())?;
        for label in &labels {
            tx.execute(
                "INSERT OR IGNORE INTO gmail_message_labels (account_id, message_id, label_id)
                 VALUES (?1, ?2, ?3)",
                params![account_id, message_id, label],
            )
            .map_err(|e| e.to_string())?;
        }
        tx.commit().map_err(|e| e.to_string())
    }

    pub async fn gmail_delete(&self, account_id: &str, ids: &[String]) -> Result<(), String> {
        let conn = self.conn.lock().await;
        for id in ids {
            conn.execute(
                "DELETE FROM gmail_messages WHERE account_id = ?1 AND id = ?2",
                params![account_id, id],
            )
            .map_err(|e| e.to_string())?;
            conn.execute(
                "DELETE FROM gmail_message_labels WHERE account_id = ?1 AND message_id = ?2",
                params![account_id, id],
            )
            .map_err(|e| e.to_string())?;
        }
        Ok(())
    }

    pub async fn gmail_clear(&self, account_id: &str) -> Result<(), String> {
        let conn = self.conn.lock().await;
        conn.execute(
            "DELETE FROM gmail_messages WHERE account_id = ?1",
            params![account_id],
        )
        .map_err(|e| e.to_string())?;
        conn.execute(
            "DELETE FROM gmail_message_labels WHERE account_id = ?1",
            params![account_id],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub async fn enqueue_op(&self, kind: &str, payload: &str) -> Result<i64, String> {
        let conn = self.conn.lock().await;
        conn.execute(
            "INSERT INTO pending_ops (kind, payload, created_at) VALUES (?1, ?2, ?3)",
            params![kind, payload, Utc::now().to_rfc3339()],
        )
        .map_err(|e| e.to_string())?;
        Ok(conn.last_insert_rowid())
    }

    pub async fn list_ops(&self) -> Result<Vec<PendingOp>, String> {
        let conn = self.conn.lock().await;
        let mut stmt = conn
            .prepare(
                "SELECT id, kind, payload, attempts, created_at FROM pending_ops ORDER BY id ASC",
            )
            .map_err(|e| e.to_string())?;
        let ops = stmt
            .query_map([], |row| {
                Ok(PendingOp {
                    id: row.get(0)?,
                    kind: row.get(1)?,
                    payload: row.get(2)?,
                    attempts: row.get(3)?,
                    created_at: row.get(4)?,
                })
            })
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        Ok(ops)
    }

    pub async fn delete_op(&self, id: i64) -> Result<(), String> {
        let conn = self.conn.lock().await;
        conn.execute("DELETE FROM pending_ops WHERE id = ?1", params![id])
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub async fn bump_op(&self, id: i64) -> Result<(), String> {
        let conn = self.conn.lock().await;
        conn.execute(
            "UPDATE pending_ops SET attempts = attempts + 1 WHERE id = ?1",
            params![id],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub async fn delete_kv_prefix(&self, prefix: &str) -> Result<(), String> {
        let conn = self.conn.lock().await;
        conn.execute(
            "DELETE FROM cache_kv WHERE key LIKE ?1 || '%'",
            params![prefix],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
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

    /// Contacts derived from the iCloud message cache: everyone we've
    /// received from, plus every To/Cc recipient (IMAP has no contacts API,
    /// so mail history is the best available address book).
    pub async fn icloud_contacts(&self) -> Result<Vec<CachedContact>, String> {
        let conn = self.conn.lock().await;
        let mut by_email: std::collections::HashMap<String, CachedContact> =
            std::collections::HashMap::new();

        let mut stmt = conn
            .prepare("SELECT DISTINCT from_name, from_email FROM cached_messages")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| {
                Ok((row.get::<_, Option<String>>(0)?, row.get::<_, String>(1)?))
            })
            .map_err(|e| e.to_string())?;
        for row in rows {
            let (name, email) = row.map_err(|e| e.to_string())?;
            if !email.contains('@') {
                continue; // parse_address "unknown" placeholder
            }
            let name = name.map(fix_encoded).filter(|n| !n.trim().is_empty());
            let entry = by_email
                .entry(email.to_lowercase())
                .or_insert(CachedContact { name: None, email });
            if entry.name.is_none() {
                entry.name = name;
            }
        }

        let mut stmt = conn
            .prepare(r#"SELECT DISTINCT "to", cc FROM cached_messages"#)
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, Option<String>>(1)?,
                ))
            })
            .map_err(|e| e.to_string())?;
        for row in rows {
            let (to, cc) = row.map_err(|e| e.to_string())?;
            let cc = cc.unwrap_or_default();
            for addr in to.split(',').chain(cc.split(',')) {
                let addr = addr.trim();
                if addr.is_empty() || !addr.contains('@') {
                    continue;
                }
                by_email
                    .entry(addr.to_lowercase())
                    .or_insert(CachedContact {
                        name: None,
                        email: addr.to_string(),
                    });
            }
        }

        let mut contacts: Vec<_> = by_email.into_values().collect();
        contacts.sort_by(|a, b| a.email.cmp(&b.email));
        Ok(contacts)
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
    pub cc: Option<String>,
    pub references: Option<String>,
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

/// System labels that define the app's folders — a message carrying none of
/// them is in Archive.
const GMAIL_FOLDER_LABELS: &str = "'INBOX','SENT','DRAFT','SPAM','TRASH'";

fn gmail_upsert_in_tx(
    tx: &rusqlite::Transaction<'_>,
    account_id: &str,
    messages: &[GmailCachedMessage],
) -> Result<(), String> {
    let now = Utc::now().to_rfc3339();
    for msg in messages {
        tx.execute(
            "INSERT OR REPLACE INTO gmail_messages
             (account_id, id, thread_id, name, email, subject, snippet, date, read, label_ids, fetched_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
            params![
                account_id,
                msg.id,
                msg.thread_id,
                msg.name,
                msg.email,
                msg.subject,
                msg.snippet,
                msg.date,
                msg.read,
                serde_json::to_string(&msg.label_ids).unwrap_or_default(),
                now,
            ],
        )
        .map_err(|e| e.to_string())?;
        tx.execute(
            "DELETE FROM gmail_message_labels WHERE account_id = ?1 AND message_id = ?2",
            params![account_id, msg.id],
        )
        .map_err(|e| e.to_string())?;
        for label in &msg.label_ids {
            tx.execute(
                "INSERT OR IGNORE INTO gmail_message_labels (account_id, message_id, label_id)
                 VALUES (?1, ?2, ?3)",
                params![account_id, msg.id, label],
            )
            .map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GmailCachedMessage {
    pub id: String,
    pub thread_id: Option<String>,
    pub name: String,
    pub email: String,
    pub subject: String,
    pub snippet: String,
    pub date: String,
    pub read: bool,
    pub label_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PendingOp {
    pub id: i64,
    pub kind: String,
    pub payload: String,
    pub attempts: i64,
    pub created_at: String,
}
