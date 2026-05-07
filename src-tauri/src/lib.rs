mod textspeed;

use std::sync::{Arc, Mutex};
use tauri::{
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager, WindowEvent,
};
use textspeed::inline_engine::InlineRuntime;
use textspeed::settings::AppSettings;

pub struct TextSpeedState {
    settings: Arc<Mutex<AppSettings>>,
    inline_runtime: InlineRuntime,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(TextSpeedState {
            settings: Arc::new(Mutex::new(AppSettings::default())),
            inline_runtime: InlineRuntime::new(),
        })
        .invoke_handler(tauri::generate_handler![
            textspeed::commands::get_settings,
            textspeed::commands::save_settings,
            textspeed::commands::read_clipboard_text,
            textspeed::commands::write_clipboard_text,
            textspeed::commands::hide_floating_window,
            textspeed::commands::hide_main_window,
            textspeed::commands::parse_inline_buffer,
            textspeed::commands::execute_inline_command,
            textspeed::commands::run_ai_action,
            textspeed::commands::run_floating_action,
            textspeed::commands::get_model_ids,
            textspeed::commands::get_runtime_status,
        ])
        .on_window_event(|window, event| {
            if window.label() == "floating" {
                if let WindowEvent::Focused(false) = event {
                    let _ = window.hide();
                }
            }
        })
        .setup(|app| {
            let loaded_settings = textspeed::store::load_settings(app.handle());
            let state = app.state::<TextSpeedState>();
            if let Ok(mut settings) = state.settings.lock() {
                *settings = loaded_settings;
            }
            state
                .inline_runtime
                .start(state.settings.clone(), app.handle().clone());
            if let Ok(settings) = state.settings.lock() {
                state.inline_runtime.set_enabled(settings.inline_enabled);
            }

            let mut tray_builder = TrayIconBuilder::with_id("textspeed")
                .tooltip("TextSpeed - click to open")
                .show_menu_on_left_click(false)
                .on_tray_icon_event(|tray, event| match event {
                    TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    }
                    | TrayIconEvent::DoubleClick {
                        button: MouseButton::Left,
                        ..
                    } => {
                        if let Some(window) = tray.app_handle().get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.unminimize();
                            let _ = window.set_focus();
                        }
                    }
                    _ => {}
                });

            if let Some(icon) = app.default_window_icon().cloned() {
                tray_builder = tray_builder.icon(icon);
            }
            let _tray = tray_builder.build(app)?;

            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
