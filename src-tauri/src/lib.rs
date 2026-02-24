pub mod automation;
pub mod commands;
pub mod config;
pub mod error;
pub mod workflow;

use tauri::Emitter;
use tauri::Manager;
use tauri_plugin_global_shortcut::ShortcutState;

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
                        .with_shortcuts(["F10"])?
                        .with_handler(|app, _shortcut, event| {
                            if event.state == ShortcutState::Pressed {
                                let _ = app.emit("commandflow-global-run-step", ());
                            }
                        })
                        .build(),
                )?;
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
            commands::list_open_windows,
            commands::health_check,
        ])
        .run(tauri::generate_context!())
        .expect("failed to run tauri app");
}
