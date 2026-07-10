mod account;
mod db;
mod oauth;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_http::init())
        .setup(|app| {
            use tauri::Manager;
            let auth_state = oauth::AuthState::default();
            app.manage(auth_state);
            let account_state = account::AccountState::new(app.handle())?;
            app.manage(account_state);
            let cache_db = db::CacheDb::new(app.handle())?;
            app.manage(cache_db);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            oauth::auth_status,
            oauth::sign_in,
            oauth::sign_out,
            oauth::get_access_token,
            account::list_accounts,
            account::add_google_account,
            account::add_icloud_account,
            account::remove_account,
            account::set_default_account,
            account::get_account_config,
            account::update_account_display_name,
            account::get_google_access_token,
            account::get_icloud_credentials,
            account::icloud_list_folders,
            account::icloud_list_messages,
            account::icloud_fetch_message,
            account::icloud_send_message,
            account::icloud_mark_read,
            account::icloud_move_message,
            account::icloud_folder_counts,
            account::icloud_cached_messages,
            account::cache_get_json,
            account::cache_put_json,
            account::cache_delete_prefix,
            account::cache_list_messages,
            account::cache_get_message,
            account::cache_mark_read,
            account::cache_sync_icloud,
            account::cache_delete_account,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
