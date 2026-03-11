pub mod automation;
pub mod commands;
pub mod config;
pub mod error;
pub mod input_recorder;
pub mod secure_settings;
pub mod workflow;

use tauri::Emitter;
use tauri::Manager;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            #[cfg(desktop)]
            {
                app.handle().plugin(
                    tauri_plugin_global_shortcut::Builder::new()
                        .with_handler(|app, shortcut, event| {
                            if event.state == ShortcutState::Released {
                                let key = shortcut.to_string();
                                if key.eq_ignore_ascii_case("F8") {
                                    let _ = app.emit("commandflow-global-toggle-background-mode", ());
                                } else if key.eq_ignore_ascii_case("F10") {
                                    let _ = app.emit("commandflow-global-run-step", ());
                                } else if key.eq_ignore_ascii_case("ScrollLock") {
                                    let _ = app.emit("commandflow-global-start-input-recording", ());
                                } else if key.eq_ignore_ascii_case("Alt+ScrollLock") {
                                    let _ = app.emit("commandflow-global-stop-input-recording", ());
                                }
                            }
                        })
                        .build(),
                )?;

                for shortcut in ["F8", "F10", "ScrollLock", "Alt+ScrollLock"] {
                    if let Err(error) = app.global_shortcut().register(shortcut) {
                        let message = error.to_string();
                        if message.to_lowercase().contains("already registered") {
                            eprintln!(
                                "[CommandFlow] 全局快捷键 '{}' 已被占用，已跳过注册（应用继续启动）。详细信息: {}",
                                shortcut, message
                            );
                        } else {
                            return Err(error.into());
                        }
                    }
                }
            }

            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_title("CommandFlow-rs");
                let _ = window.show();
                let _ = window.set_focus();
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::run_workflow,
            commands::stop_workflow,
            commands::save_workflow,
            commands::load_workflow,
            commands::pick_coordinate,
            commands::get_cursor_position,
            commands::confirm_coordinate_pick,
            commands::cancel_coordinate_pick,
            commands::list_open_windows,
            commands::list_open_window_details,
            commands::list_start_menu_apps,
            commands::resolve_start_menu_app_icon,
            commands::fetch_llm_models,
            commands::load_llm_presets,
            commands::load_input_recording_presets,
            commands::play_completion_beep,
            commands::save_llm_presets,
            commands::save_input_recording_presets,
            commands::health_check,
            commands::set_background_mode,
            commands::start_input_recording,
            commands::stop_input_recording,
        ])
        .run(tauri::generate_context!())
        .expect("failed to run tauri app");
}
