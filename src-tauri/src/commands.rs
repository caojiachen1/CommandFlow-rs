use crate::automation::executor::WorkflowExecutor;
use crate::workflow::graph::WorkflowGraph;
use serde_json::Value;
use std::collections::HashMap;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

#[cfg(target_os = "windows")]
use windows_sys::Win32::Foundation::{BOOL, HWND, LPARAM};
#[cfg(target_os = "windows")]
use windows_sys::Win32::UI::WindowsAndMessaging::{EnumWindows, GetWindowTextLengthW, GetWindowTextW, IsWindowVisible};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CoordinateInfo {
    pub x: i32,
    pub y: i32,
    pub is_physical_pixel: bool,
    pub mode: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct NodeProgressPayload {
    pub node_id: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct VariablesUpdatedPayload {
    pub variables: HashMap<String, Value>,
}

#[tauri::command]
pub async fn health_check() -> Result<String, String> {
    Ok("ok".to_string())
}

#[tauri::command]
pub async fn run_workflow(app: AppHandle, graph: WorkflowGraph) -> Result<String, String> {
    let executor = WorkflowExecutor::default();
    let mut emit_progress = |node: &crate::workflow::node::WorkflowNode| {
        let _ = app.emit(
            "workflow-node-started",
            NodeProgressPayload {
                node_id: node.id.clone(),
            },
        );
    };
    let mut emit_variables = |variables: &HashMap<String, Value>| {
        let _ = app.emit(
            "workflow-variables-updated",
            VariablesUpdatedPayload {
                variables: variables.clone(),
            },
        );
    };
    executor
        .execute_with_progress(&graph, &mut emit_progress, &mut emit_variables)
        .await
        .map_err(|e| e.to_string())?;
    Ok("workflow finished".to_string())
}

#[tauri::command]
pub async fn stop_workflow() -> Result<String, String> {
    Ok("stop signal delivered".to_string())
}

#[tauri::command]
pub async fn save_workflow(path: String, graph: WorkflowGraph) -> Result<String, String> {
    let payload = serde_json::to_string_pretty(&graph)
        .map_err(|error| error.to_string())?;
    std::fs::write(&path, payload).map_err(|error| error.to_string())?;
    Ok(path)
}

#[tauri::command]
pub async fn load_workflow(path: String) -> Result<WorkflowGraph, String> {
    let payload = std::fs::read_to_string(&path).map_err(|error| error.to_string())?;
    let graph =
        serde_json::from_str::<WorkflowGraph>(&payload).map_err(|error| error.to_string())?;
    Ok(graph)
}

#[tauri::command]
pub async fn pick_coordinate(mode: Option<String>) -> Result<CoordinateInfo, String> {
    let resolved_mode = mode.unwrap_or_else(|| "virtualScreen".to_string());

    Ok(CoordinateInfo {
        x: 0,
        y: 0,
        is_physical_pixel: true,
        mode: resolved_mode,
    })
}

#[tauri::command]
pub async fn list_open_windows() -> Result<Vec<String>, String> {
    #[cfg(target_os = "windows")]
    {
        unsafe extern "system" fn enum_windows_proc(hwnd: HWND, lparam: LPARAM) -> BOOL {
            if IsWindowVisible(hwnd) == 0 {
                return 1;
            }

            let len = GetWindowTextLengthW(hwnd);
            if len <= 0 {
                return 1;
            }

            let mut buffer = vec![0u16; (len as usize) + 1];
            let copied = GetWindowTextW(hwnd, buffer.as_mut_ptr(), buffer.len() as i32);
            if copied <= 0 {
                return 1;
            }

            let title = String::from_utf16_lossy(&buffer[..copied as usize])
                .trim()
                .to_string();
            if title.is_empty() {
                return 1;
            }

            let titles = &mut *(lparam as *mut Vec<String>);
            if !titles.iter().any(|existing| existing == &title) {
                titles.push(title);
            }

            1
        }

        let mut titles = Vec::<String>::new();
        unsafe {
            EnumWindows(Some(enum_windows_proc), &mut titles as *mut Vec<String> as LPARAM);
        }

        return Ok(titles);
    }

    #[cfg(not(target_os = "windows"))]
    {
        Ok(vec![])
    }
}
