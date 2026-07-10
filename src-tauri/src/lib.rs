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
            use tauri::menu::{
                AboutMetadata, Menu, MenuItem, PredefinedMenuItem, Submenu,
                HELP_SUBMENU_ID, WINDOW_SUBMENU_ID,
            };

            // Native app menu: macOS menu bar, GTK in-window menubar, and
            // DBus-exported global menus (KDE Plasma) all render this Menu.
            //
            // muda's GTK backend silently drops most predefined items (only
            // copy/cut/paste/select-all/about/separator render on Linux), so
            // window and app commands are custom items acted on in
            // on_menu_event; mail commands are forwarded to the webview.
            let about = AboutMetadata {
                name: Some(app.package_info().name.clone()),
                version: Some(app.package_info().version.to_string()),
                ..Default::default()
            };

            let file_menu = Submenu::with_items(
                app,
                "File",
                true,
                &[
                    &MenuItem::with_id(app, "compose", "New Message", true, Some("CmdOrCtrl+N"))?,
                    &PredefinedMenuItem::separator(app)?,
                    &MenuItem::with_id(app, "close_window", "Close Window", true, Some("CmdOrCtrl+W"))?,
                    #[cfg(not(target_os = "macos"))]
                    &MenuItem::with_id(app, "quit", "Quit", true, Some("CmdOrCtrl+Q"))?,
                ],
            )?;

            let edit_menu = Submenu::with_items(
                app,
                "Edit",
                true,
                &[
                    #[cfg(target_os = "macos")]
                    &PredefinedMenuItem::undo(app, None)?,
                    #[cfg(target_os = "macos")]
                    &PredefinedMenuItem::redo(app, None)?,
                    #[cfg(not(target_os = "macos"))]
                    &MenuItem::with_id(app, "undo", "Undo", true, Some("CmdOrCtrl+Z"))?,
                    #[cfg(not(target_os = "macos"))]
                    &MenuItem::with_id(app, "redo", "Redo", true, Some("CmdOrCtrl+Shift+Z"))?,
                    &PredefinedMenuItem::separator(app)?,
                    &PredefinedMenuItem::cut(app, None)?,
                    &PredefinedMenuItem::copy(app, None)?,
                    &PredefinedMenuItem::paste(app, None)?,
                    &PredefinedMenuItem::select_all(app, None)?,
                ],
            )?;

            let view_menu = Submenu::with_items(
                app,
                "View",
                true,
                &[
                    &MenuItem::with_id(app, "command_palette", "Command Palette…", true, Some("CmdOrCtrl+P"))?,
                    &PredefinedMenuItem::separator(app)?,
                    &MenuItem::with_id(
                        app,
                        "fullscreen",
                        "Toggle Full Screen",
                        true,
                        Some(if cfg!(target_os = "macos") { "Ctrl+Cmd+F" } else { "F11" }),
                    )?,
                ],
            )?;

            let go_menu = Submenu::with_items(
                app,
                "Go",
                true,
                &[
                    &MenuItem::with_id(app, "go_inbox", "Inbox", true, Some("CmdOrCtrl+1"))?,
                    &MenuItem::with_id(app, "go_drafts", "Drafts", true, Some("CmdOrCtrl+2"))?,
                    &MenuItem::with_id(app, "go_sent", "Sent", true, Some("CmdOrCtrl+3"))?,
                    &MenuItem::with_id(app, "go_junk", "Junk", true, Some("CmdOrCtrl+4"))?,
                    &MenuItem::with_id(app, "go_trash", "Trash", true, Some("CmdOrCtrl+5"))?,
                    &MenuItem::with_id(app, "go_archive", "Archive", true, Some("CmdOrCtrl+6"))?,
                ],
            )?;

            let message_menu = Submenu::with_items(
                app,
                "Message",
                true,
                &[
                    &MenuItem::with_id(app, "reply", "Reply", true, Some("CmdOrCtrl+R"))?,
                    &MenuItem::with_id(app, "reply_all", "Reply All", true, Some("CmdOrCtrl+Shift+R"))?,
                    &PredefinedMenuItem::separator(app)?,
                    &MenuItem::with_id(app, "archive", "Archive", true, None::<&str>)?,
                    &MenuItem::with_id(app, "trash", "Move to Trash", true, None::<&str>)?,
                    &PredefinedMenuItem::separator(app)?,
                    &MenuItem::with_id(app, "toggle_read", "Mark as Read/Unread", true, Some("CmdOrCtrl+Shift+U"))?,
                ],
            )?;

            let window_menu = Submenu::with_id_and_items(
                app,
                WINDOW_SUBMENU_ID,
                "Window",
                true,
                &[
                    &MenuItem::with_id(app, "minimize", "Minimize", true, Some("CmdOrCtrl+M"))?,
                    &MenuItem::with_id(app, "zoom", "Zoom", true, None::<&str>)?,
                ],
            )?;

            let help_menu = Submenu::with_id_and_items(
                app,
                HELP_SUBMENU_ID,
                "Help",
                true,
                &[
                    &MenuItem::with_id(app, "shortcuts", "Keyboard Shortcuts", true, None::<&str>)?,
                    #[cfg(not(target_os = "macos"))]
                    &PredefinedMenuItem::separator(app)?,
                    #[cfg(not(target_os = "macos"))]
                    &PredefinedMenuItem::about(app, None, Some(about.clone()))?,
                ],
            )?;

            let menu = Menu::with_items(
                app,
                &[
                    #[cfg(target_os = "macos")]
                    &Submenu::with_items(
                        app,
                        app.package_info().name.clone(),
                        true,
                        &[
                            &PredefinedMenuItem::about(app, None, Some(about.clone()))?,
                            &PredefinedMenuItem::separator(app)?,
                            &PredefinedMenuItem::services(app, None)?,
                            &PredefinedMenuItem::separator(app)?,
                            &PredefinedMenuItem::hide(app, None)?,
                            &PredefinedMenuItem::hide_others(app, None)?,
                            &PredefinedMenuItem::separator(app)?,
                            &PredefinedMenuItem::quit(app, None)?,
                        ],
                    )?,
                    &file_menu,
                    &edit_menu,
                    &view_menu,
                    &go_menu,
                    &message_menu,
                    &window_menu,
                    &help_menu,
                ],
            )?;
            app.set_menu(menu)?;
            let _ = &about; // used only under cfg on each platform

            let auth_state = oauth::AuthState::default();
            app.manage(auth_state);
            let account_state = account::AccountState::new(app.handle())?;
            app.manage(account_state);
            app.manage(account::ImapPool::default());
            let cache_db = db::CacheDb::new(app.handle())?;
            app.manage(cache_db);
            Ok(())
        })
        .on_menu_event(|app, event| {
            use tauri::{Emitter, Manager};
            let focused = || {
                let windows = app.webview_windows();
                windows
                    .values()
                    .find(|w| w.is_focused().unwrap_or(false))
                    .or_else(|| windows.values().next())
                    .cloned()
            };
            match event.id().as_ref() {
                // Window/app commands handled natively (GTK renders no
                // working predefined items for these).
                "quit" => app.exit(0),
                "close_window" => {
                    if let Some(window) = focused() {
                        let _ = window.close();
                    }
                }
                "minimize" => {
                    if let Some(window) = focused() {
                        let _ = window.minimize();
                    }
                }
                "zoom" => {
                    if let Some(window) = focused() {
                        let _ = if window.is_maximized().unwrap_or(false) {
                            window.unmaximize()
                        } else {
                            window.maximize()
                        };
                    }
                }
                "fullscreen" => {
                    if let Some(window) = focused() {
                        let on = window.is_fullscreen().unwrap_or(false);
                        let _ = window.set_fullscreen(!on);
                    }
                }
                // Mail commands are the webview's job; forward the item id.
                id => {
                    let _ = app.emit("menu", id.to_string());
                }
            }
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
            account::update_account_display_name,
            account::get_google_access_token,
            account::icloud_search_messages,
            account::icloud_fetch_message,
            account::icloud_send_message,
            account::icloud_mark_read,
            account::icloud_move_message,
            account::icloud_folder_counts,
            account::icloud_cached_messages,
            account::cache_get_json,
            account::cache_put_json,
            account::cache_delete_prefix,
            account::cache_remove_message,
            account::gmail_cache_replace_folder,
            account::gmail_cache_upsert,
            account::gmail_cache_list,
            account::gmail_cache_modify_labels,
            account::gmail_cache_delete,
            account::gmail_cache_clear,
            account::ops_enqueue,
            account::ops_list,
            account::ops_delete,
            account::ops_bump,
            account::cache_list_messages,
            account::cache_get_message,
            account::cache_mark_read,
            account::cache_sync_icloud,
            account::cache_contacts,
            account::cache_delete_account,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
