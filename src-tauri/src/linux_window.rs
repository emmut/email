use gtk::prelude::GtkWindowExt;
use tauri::Manager;

fn is_kde_desktop(desktop: &str) -> bool {
    desktop
        .split(':')
        .any(|name| {
            name.eq_ignore_ascii_case("kde") || name.eq_ignore_ascii_case("plasma")
        })
}

/// tao 0.35 installs a GTK HeaderBar on every Wayland window. Keep it on
/// GNOME, where it is native, but let KWin provide KDE's server-side frame.
/// This must run before the initially-hidden window is first shown.
pub fn use_native_decorations(app: &tauri::App) -> tauri::Result<()> {
    let is_kde = ["XDG_CURRENT_DESKTOP", "XDG_SESSION_DESKTOP"]
        .into_iter()
        .filter_map(|name| std::env::var(name).ok())
        .any(|desktop| is_kde_desktop(&desktop));

    if is_kde {
        if let Some(window) = app.get_webview_window("main") {
            window.gtk_window()?.set_titlebar(None::<&gtk::Widget>);
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::is_kde_desktop;

    #[test]
    fn detects_kde_in_xdg_desktop_lists() {
        assert!(is_kde_desktop("KDE"));
        assert!(is_kde_desktop("KDE:Plasma"));
        assert!(is_kde_desktop("ubuntu:KDE"));
        assert!(is_kde_desktop("plasma"));
    }

    #[test]
    fn leaves_non_kde_desktops_alone() {
        assert!(!is_kde_desktop("GNOME"));
        assert!(!is_kde_desktop("ubuntu:GNOME"));
        assert!(!is_kde_desktop("XFCE"));
        assert!(!is_kde_desktop(""));
    }
}
