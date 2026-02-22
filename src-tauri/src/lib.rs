pub mod automation;
pub mod commands;
pub mod config;
pub mod error;
pub mod workflow;

use tauri::Manager;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
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
            commands::health_check,
        ])
        .run(tauri::generate_context!())
        .expect("failed to run tauri app");
}
