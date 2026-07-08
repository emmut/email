mod oauth;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(oauth::AuthState::default())
        .invoke_handler(tauri::generate_handler![
            oauth::auth_status,
            oauth::sign_in,
            oauth::sign_out,
            oauth::get_access_token,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
