use std::sync::{atomic::Ordering, Arc};

use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager, Runtime,
};

use crate::AppState;

/// Bring the main window back from the tray: un-minimize, show, and focus it.
pub fn show_main_window<R: Runtime>(app: &AppHandle<R>) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

/// Close/minimize-to-tray window handling. Hides the window (instead of quitting or
/// staying on the taskbar) when "run in background" is on and no real quit is in progress.
pub fn on_window_event<R: Runtime>(window: &tauri::Window<R>, event: &tauri::WindowEvent) {
    let Some(state) = window.try_state::<Arc<AppState>>() else { return };
    if !state.run_in_background.load(Ordering::SeqCst) {
        return;
    }
    match event {
        tauri::WindowEvent::CloseRequested { api, .. } => {
            if !state.quitting.load(Ordering::SeqCst) {
                let _ = window.hide();
                api.prevent_close();
            }
        }
        tauri::WindowEvent::Resized(_) => {
            if window.is_minimized().unwrap_or(false) {
                let _ = window.hide();
            }
        }
        _ => {}
    }
}

/// Build the system-tray icon with a Show / Quit menu and wire up its events.
/// Left-clicking the icon restores the window; "Quit" marks the app as quitting
/// (so the close-to-tray handler lets it through) and exits.
pub fn build<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    let show_item = MenuItem::with_id(app, "show", "Show SpineForge X", true, None::<&str>)?;
    let quit_item = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show_item, &quit_item])?;

    let mut builder = TrayIconBuilder::with_id("main")
        .tooltip("SpineForge X")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => show_main_window(app),
            "quit" => {
                if let Some(state) = app.try_state::<Arc<AppState>>() {
                    state.quitting.store(true, Ordering::SeqCst);
                }
                app.exit(0);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main_window(tray.app_handle());
            }
        });

    if let Some(icon) = app.default_window_icon().cloned() {
        builder = builder.icon(icon);
    }

    builder.build(app)?;
    Ok(())
}
