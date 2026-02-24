use crate::automation::executor::WorkflowExecutor;
use crate::automation::window;
use crate::workflow::graph::WorkflowGraph;
use serde_json::Value;
use std::collections::HashMap;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

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
    window::list_open_window_titles().map_err(|error| error.to_string())
}
