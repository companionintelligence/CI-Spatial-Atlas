#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

//! The Companion Atlas desktop shell: one window that shows the bundled viewer.
//!
//! The viewer opens links in a new tab (`target="_blank"`): links in a story's text and the
//! map layers' attributions. A WebView has no tabs, and without a handler it drops those
//! clicks, so the main window sends them to the system browser instead. A link that would
//! take the window itself away from the app goes to the browser too. Only http(s), mailto
//! and tel links leave the app; anything else (file:, custom schemes) is ignored.

use tauri::webview::{NewWindowResponse, WebviewWindowBuilder};
use tauri::{AppHandle, Manager, Runtime, Url};
use tauri_plugin_opener::OpenerExt;

/// The window in tauri.conf.json. It has `create: false`, so it is built here, where the
/// link handlers can be attached to it. It is built from that config entry, so the entry's
/// other settings still apply, `dragDropEnabled: false` among them.
const MAIN_WINDOW: &str = "main";

/// Links the system may open: in the browser, the mail client or the phone app.
fn is_external(url: &Url) -> bool {
    matches!(url.scheme(), "http" | "https" | "mailto" | "tel")
}

/// Pages of the app itself, and documents the page makes for itself.
fn is_app_page(url: &Url, dev_url: Option<&Url>) -> bool {
    match url.scheme() {
        // macOS and Linux serve the bundled viewer from tauri://localhost.
        "tauri" => true,
        // Windows serves it from http://tauri.localhost; `tauri dev` uses the Vite server.
        "http" | "https" => {
            url.host_str() == Some("tauri.localhost")
                || dev_url.is_some_and(|dev| dev.origin() == url.origin())
        }
        "about" | "blob" | "data" => true,
        _ => false,
    }
}

fn open_externally<R: Runtime>(app: &AppHandle<R>, url: &Url) {
    if !is_external(url) {
        return;
    }
    if let Err(error) = app.opener().open_url(url.as_str(), None::<&str>) {
        eprintln!("Companion Atlas: could not open {url}: {error}");
    }
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let config = app
                .config()
                .app
                .windows
                .iter()
                .find(|window| window.label == MAIN_WINDOW)
                .cloned()
                .ok_or("tauri.conf.json has no window labelled \"main\"")?;
            let dev_url = if cfg!(debug_assertions) {
                app.config().build.dev_url.clone()
            } else {
                None
            };
            let new_window_dev_url = dev_url.clone();

            let new_window_app = app.handle().clone();
            let navigation_app = app.handle().clone();
            WebviewWindowBuilder::from_config(app.handle(), &config)?
                // `target="_blank"` and `window.open`: never a second WebView window.
                .on_new_window(move |url, _features| {
                    if is_app_page(&url, new_window_dev_url.as_ref()) {
                        // A link to another page of the app opens in this window.
                        if let Some(window) = new_window_app.get_webview_window(MAIN_WINDOW) {
                            let _ = window.navigate(url);
                        }
                    } else {
                        open_externally(&new_window_app, &url);
                    }
                    NewWindowResponse::Deny
                })
                // A plain link to another site would replace the app, with no way back.
                .on_navigation(move |url| {
                    if is_app_page(url, dev_url.as_ref()) {
                        return true;
                    }
                    open_externally(&navigation_app, url);
                    false
                })
                .build()?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Companion Atlas");
}

#[cfg(test)]
mod tests {
    use super::*;

    fn url(s: &str) -> Url {
        s.parse().unwrap()
    }

    #[test]
    fn the_bundled_viewer_stays_in_the_window() {
        assert!(is_app_page(&url("tauri://localhost/index.html"), None));
        assert!(is_app_page(&url("http://tauri.localhost/?story=/stories/a.json"), None));
        assert!(is_app_page(&url("https://tauri.localhost/"), None));
        assert!(is_app_page(&url("about:blank"), None));
    }

    #[test]
    fn other_sites_leave_the_window() {
        assert!(!is_app_page(&url("https://atlas.ci.computer/"), None));
        assert!(!is_app_page(&url("http://tauri.localhost.example.com/"), None));
        assert!(!is_app_page(&url("http://127.0.0.1:4174/"), None));
        assert!(is_app_page(&url("http://127.0.0.1:4174/"), Some(&url("http://127.0.0.1:4174"))));
    }

    #[test]
    fn only_web_mail_and_phone_links_reach_the_system() {
        assert!(is_external(&url("https://www.esri.com/")));
        assert!(is_external(&url("http://example.org/")));
        assert!(is_external(&url("mailto:someone@example.org")));
        assert!(is_external(&url("tel:+15555550100")));
        assert!(!is_external(&url("file:///etc/passwd")));
        assert!(!is_external(&url("javascript:alert(1)")));
        assert!(!is_external(&url("ms-settings:privacy")));
    }
}
