use crate::automation::executor::WorkflowExecutor;
use crate::automation::window;
use crate::workflow::graph::WorkflowGraph;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, Position, Size};

#[cfg(target_os = "windows")]
use windows_sys::Win32::Foundation::RECT;
#[cfg(target_os = "windows")]
use windows_sys::Win32::UI::WindowsAndMessaging::{SystemParametersInfoW, SPI_GETWORKAREA};

#[derive(Debug, Clone, Copy)]
struct WindowSnapshot {
    size: PhysicalSize<u32>,
    position: PhysicalPosition<i32>,
    was_maximized: bool,
}

fn window_snapshot_store() -> &'static Mutex<Option<WindowSnapshot>> {
    static WINDOW_SNAPSHOT: OnceLock<Mutex<Option<WindowSnapshot>>> = OnceLock::new();
    WINDOW_SNAPSHOT.get_or_init(|| Mutex::new(None))
}

#[cfg(target_os = "windows")]
fn get_work_area() -> Option<(i32, i32, i32, i32)> {
    unsafe {
        let mut rect: RECT = std::mem::zeroed();
        let result = SystemParametersInfoW(
            SPI_GETWORKAREA,
            0,
            &mut rect as *mut _ as *mut _,
            0,
        );
        if result != 0 {
            Some((rect.left, rect.top, rect.right, rect.bottom))
        } else {
            None
        }
    }
}

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
    pub node_kind: String,
    pub node_label: String,
    pub params: HashMap<String, Value>,
}

#[derive(Debug, Clone, Serialize)]
pub struct VariablesUpdatedPayload {
    pub variables: HashMap<String, Value>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ExecutionLogPayload {
    pub level: String,
    pub message: String,
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
                node_kind: format!("{:?}", node.kind),
                node_label: node.label.clone(),
                params: node.params.clone(),
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
    let mut emit_log = |level: &str, message: String| {
        let _ = app.emit(
            "workflow-log",
            ExecutionLogPayload {
                level: level.to_string(),
                message,
            },
        );
    };
    executor
        .execute_with_progress(&graph, &mut emit_progress, &mut emit_variables, &mut emit_log)
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
    window::list_open_window_titles().map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn set_background_mode(app: AppHandle, enabled: bool) -> Result<String, String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "未找到主窗口。".to_string())?;

    let snapshot_mutex = window_snapshot_store();

    if enabled {
        let compact_width = 460u32;
        let compact_height = 340u32;

        {
            let mut snapshot_guard = snapshot_mutex
                .lock()
                .map_err(|_| "读取窗口状态失败。".to_string())?;

            if snapshot_guard.is_none() {
                let size = window.inner_size().map_err(|error| error.to_string())?;
                let position = window.outer_position().map_err(|error| error.to_string())?;
                let was_maximized = window.is_maximized().map_err(|error| error.to_string())?;
                *snapshot_guard = Some(WindowSnapshot {
                    size,
                    position,
                    was_maximized,
                });
            }
        }

        if window.is_maximized().map_err(|error| error.to_string())? {
            window.unmaximize().map_err(|error| error.to_string())?;
        }

        window
            .set_size(Size::Physical(PhysicalSize {
                width: compact_width,
                height: compact_height,
            }))
            .map_err(|error| error.to_string())?;

        // 获取窗口外边框尺寸，用于精确计算位置
        std::thread::sleep(std::time::Duration::from_millis(50));
        let outer_size = window.outer_size().unwrap_or_else(|_| PhysicalSize { width: compact_width, height: compact_height });

        #[cfg(target_os = "windows")]
        {
            // Windows: 使用工作区域（排除任务栏）
            let margin = 12i32;
            if let Some((_, _, work_right, work_bottom)) = get_work_area() {
                // 工作区域右下角作为基准
                let target_x = work_right - outer_size.width as i32 - margin;
                let target_y = work_bottom - outer_size.height as i32 - margin;
                window
                    .set_position(Position::Physical(PhysicalPosition { x: target_x, y: target_y }))
                    .map_err(|error| error.to_string())?;
            }
        }

        #[cfg(not(target_os = "windows"))]
        {
            // 其他平台：使用显示器尺寸
            if let Some(monitor) = window.current_monitor().map_err(|error| error.to_string())? {
                let margin = 12i32;
                let monitor_pos = monitor.position();
                let monitor_size = monitor.size();

                let target_x = monitor_pos.x + monitor_size.width as i32 - outer_size.width as i32 - margin;
                let target_y = monitor_pos.y + monitor_size.height as i32 - outer_size.height as i32 - margin;

                window
                    .set_position(Position::Physical(PhysicalPosition { x: target_x, y: target_y }))
                    .map_err(|error| error.to_string())?;
            }
        }

        window
            .set_always_on_top(true)
            .map_err(|error| error.to_string())?;
        return Ok("已进入后台模式（紧凑置顶窗口）。".to_string());
    }

    window
        .set_always_on_top(false)
        .map_err(|error| error.to_string())?;

    let previous_snapshot = {
        let mut snapshot_guard = snapshot_mutex
            .lock()
            .map_err(|_| "读取窗口状态失败。".to_string())?;
        snapshot_guard.take()
    };

    if let Some(snapshot) = previous_snapshot {
        if snapshot.was_maximized {
            window.maximize().map_err(|error| error.to_string())?;
            return Ok("已退出后台模式。".to_string());
        }

        window
            .set_size(Size::Physical(snapshot.size))
            .map_err(|error| error.to_string())?;
        window
            .set_position(Position::Physical(snapshot.position))
            .map_err(|error| error.to_string())?;
    }

    Ok("已退出后台模式。".to_string())
}
