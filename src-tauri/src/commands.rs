use crate::automation::executor::WorkflowExecutor;
use crate::automation::screenshot;
use crate::automation::start_menu;
use crate::automation::uia;
use crate::automation::window;
use crate::input_recorder;
use crate::workflow::graph::WorkflowGraph;
use reqwest::header::{AUTHORIZATION, CONTENT_TYPE};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::fmt::Write as _;
use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, Position, Size};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;
use tokio::sync::mpsc;
use tokio::sync::oneshot;

#[cfg(target_os = "windows")]
use windows_sys::Win32::Foundation::{POINT, RECT};
#[cfg(target_os = "windows")]
use windows_sys::Win32::System::Diagnostics::Debug::Beep;
#[cfg(target_os = "windows")]
use windows_sys::Win32::UI::Input::KeyboardAndMouse::{
    GetAsyncKeyState, VK_ESCAPE, VK_LBUTTON, VK_MBUTTON, VK_RBUTTON,
};
#[cfg(target_os = "windows")]
use windows_sys::Win32::UI::WindowsAndMessaging::{
    GetCursorPos, GetSystemMetrics, SystemParametersInfoW, SM_CXVIRTUALSCREEN, SM_CYVIRTUALSCREEN,
    SM_XVIRTUALSCREEN, SM_YVIRTUALSCREEN, SPI_GETWORKAREA,
};

const WORKFLOW_PACKAGE_PROGRESS_EVENT: &str = "workflow-package-progress";
#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

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

#[derive(Debug, Default)]
struct ExecutionControl {
    running: AtomicBool,
    cancel_requested: AtomicBool,
}

fn execution_control() -> &'static ExecutionControl {
    static EXECUTION_CONTROL: OnceLock<ExecutionControl> = OnceLock::new();
    EXECUTION_CONTROL.get_or_init(ExecutionControl::default)
}

#[cfg(target_os = "windows")]
fn get_work_area() -> Option<(i32, i32, i32, i32)> {
    unsafe {
        let mut rect: RECT = std::mem::zeroed();
        let result = SystemParametersInfoW(SPI_GETWORKAREA, 0, &mut rect as *mut _ as *mut _, 0);
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

type CoordinatePickResult = Result<CoordinateInfo, String>;
type CoordinatePickSender = oneshot::Sender<CoordinatePickResult>;
type UiElementPickResult = Result<uia::UiElementPreview, String>;
type UiElementPickSender = oneshot::Sender<UiElementPickResult>;

fn coordinate_pick_sender_store(
) -> &'static Mutex<Option<CoordinatePickSender>> {
    static COORDINATE_PICK_SENDER: OnceLock<Mutex<Option<CoordinatePickSender>>> =
        OnceLock::new();
    COORDINATE_PICK_SENDER.get_or_init(|| Mutex::new(None))
}

fn ui_element_pick_sender_store(
) -> &'static Mutex<Option<UiElementPickSender>> {
    static UI_ELEMENT_PICK_SENDER: OnceLock<Mutex<Option<UiElementPickSender>>> =
        OnceLock::new();
    UI_ELEMENT_PICK_SENDER.get_or_init(|| Mutex::new(None))
}

fn complete_coordinate_pick(result: Result<CoordinateInfo, String>) -> Result<(), String> {
    let sender_mutex = coordinate_pick_sender_store();
    let mut sender_guard = sender_mutex
        .lock()
        .map_err(|_| "坐标拾取状态锁已损坏。".to_string())?;

    let sender = sender_guard
        .take()
        .ok_or_else(|| "当前没有进行中的坐标拾取。".to_string())?;

    sender
        .send(result)
        .map_err(|_| "坐标拾取结果发送失败。".to_string())
}

fn complete_ui_element_pick(result: Result<uia::UiElementPreview, String>) -> Result<(), String> {
    let sender_mutex = ui_element_pick_sender_store();
    let mut sender_guard = sender_mutex
        .lock()
        .map_err(|_| "元素提取状态锁已损坏。".to_string())?;

    let sender = sender_guard
        .take()
        .ok_or_else(|| "当前没有进行中的元素提取。".to_string())?;

    sender
        .send(result)
        .map_err(|_| "元素提取结果发送失败。".to_string())
}

#[cfg(target_os = "windows")]
fn is_vk_pressed(vk: i32) -> bool {
    unsafe { (GetAsyncKeyState(vk) as u16 & 0x8000) != 0 }
}

fn has_pending_ui_element_pick() -> bool {
    ui_element_pick_sender_store()
        .lock()
        .ok()
        .map(|guard| guard.is_some())
        .unwrap_or(false)
}

#[cfg(target_os = "windows")]
async fn run_ui_element_pick_clickthrough_loop(app: AppHandle) {
    let start = std::time::Instant::now();
    let mut left_armed = !is_vk_pressed(VK_LBUTTON as i32);
    let mut prev_left = is_vk_pressed(VK_LBUTTON as i32);
    let mut prev_right = is_vk_pressed(VK_RBUTTON as i32);
    let mut prev_middle = is_vk_pressed(VK_MBUTTON as i32);
    let mut prev_escape = is_vk_pressed(VK_ESCAPE as i32);

    loop {
        if !has_pending_ui_element_pick() {
            break;
        }

        let left_pressed = is_vk_pressed(VK_LBUTTON as i32);
        let right_pressed = is_vk_pressed(VK_RBUTTON as i32);
        let middle_pressed = is_vk_pressed(VK_MBUTTON as i32);
        let escape_pressed = is_vk_pressed(VK_ESCAPE as i32);

        if !left_armed {
            if !left_pressed && start.elapsed() >= Duration::from_millis(120) {
                left_armed = true;
            }
        } else if left_pressed && !prev_left {
            let confirm_result = read_cursor_virtual_screen_point()
                .and_then(|(x, y)| {
                    uia::inspect_element_at_point(x, y)
                        .map_err(|error| error.to_string())?
                        .ok_or_else(|| "当前鼠标位置未检测到可用元素。".to_string())
                })
                .and_then(|preview| complete_ui_element_pick(Ok(preview)));

            if confirm_result.is_err() {
                let _ = complete_ui_element_pick(Err("当前鼠标位置未检测到可用元素。".to_string()));
            }

            if let Some(overlay) = app.get_webview_window("coordinate-overlay") {
                let _ = overlay.close();
            }
            break;
        }

        if right_pressed && !prev_right {
            let _ = complete_ui_element_pick(Err("用户取消元素提取（右键）。".to_string()));
            if let Some(overlay) = app.get_webview_window("coordinate-overlay") {
                let _ = overlay.close();
            }
            break;
        }

        if middle_pressed && !prev_middle {
            let _ = complete_ui_element_pick(Err("用户取消元素提取（中键）。".to_string()));
            if let Some(overlay) = app.get_webview_window("coordinate-overlay") {
                let _ = overlay.close();
            }
            break;
        }

        if escape_pressed && !prev_escape {
            let _ = complete_ui_element_pick(Err("用户取消元素提取（Esc）。".to_string()));
            if let Some(overlay) = app.get_webview_window("coordinate-overlay") {
                let _ = overlay.close();
            }
            break;
        }

        prev_left = left_pressed;
        prev_right = right_pressed;
        prev_middle = middle_pressed;
        prev_escape = escape_pressed;

        tokio::time::sleep(Duration::from_millis(8)).await;
    }
}

#[cfg(target_os = "windows")]
fn read_cursor_virtual_screen_point() -> Result<(i32, i32), String> {
    let mut point: POINT = unsafe { std::mem::zeroed() };
    let ok = unsafe { GetCursorPos(&mut point as *mut POINT) };
    if ok == 0 {
        return Err("获取当前鼠标坐标失败。".to_string());
    }

    Ok((point.x, point.y))
}

#[cfg(target_os = "windows")]
fn get_virtual_screen_bounds() -> (i32, i32, u32, u32) {
    let x = unsafe { GetSystemMetrics(SM_XVIRTUALSCREEN) };
    let y = unsafe { GetSystemMetrics(SM_YVIRTUALSCREEN) };
    let width = unsafe { GetSystemMetrics(SM_CXVIRTUALSCREEN) };
    let height = unsafe { GetSystemMetrics(SM_CYVIRTUALSCREEN) };

    (x, y, width.max(1) as u32, height.max(1) as u32)
}

#[derive(Debug, Clone, Serialize)]
pub struct NodeProgressPayload {
    pub node_id: String,
    pub node_kind: String,
    pub node_kind_key: String,
    pub node_label: String,
    pub params: HashMap<String, Value>,
}

#[derive(Debug, Clone, Serialize)]
pub struct NodeCompletedPayload {
    pub node_id: String,
    pub node_kind: String,
    pub node_kind_key: String,
    pub node_label: String,
    pub params: HashMap<String, Value>,
    pub outputs: HashMap<String, Value>,
    pub selected_control_output: Option<String>,
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

fn node_kind_key(kind: &crate::workflow::node::NodeKind) -> String {
    serde_json::to_value(kind)
        .ok()
        .and_then(|value| value.as_str().map(ToString::to_string))
        .unwrap_or_else(|| format!("{:?}", kind))
}

#[derive(Debug, Deserialize)]
struct ModelListResponse {
    #[serde(default)]
    data: Vec<ModelInfo>,
}

#[derive(Debug, Deserialize)]
struct ModelInfo {
    id: String,
}

#[tauri::command]
pub async fn health_check() -> Result<String, String> {
    Ok("ok".to_string())
}

#[tauri::command]
pub async fn run_workflow(app: AppHandle, graph: WorkflowGraph) -> Result<String, String> {
    let control = execution_control();
    if control
        .running
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        return Err("已有工作流在执行中，请先停止当前执行。".to_string());
    }

    control.cancel_requested.store(false, Ordering::SeqCst);

    let executor = WorkflowExecutor;
    let mut emit_progress = |node: &crate::workflow::node::WorkflowNode| {
        let _ = app.emit(
            "workflow-node-started",
            NodeProgressPayload {
                node_id: node.id.clone(),
                node_kind: format!("{:?}", node.kind),
                node_kind_key: node_kind_key(&node.kind),
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
    let mut emit_node_complete =
        |node: &crate::workflow::node::WorkflowNode,
         outputs: &HashMap<String, Value>,
         selected_control_output: Option<&str>| {
            let _ = app.emit(
                "workflow-node-completed",
                NodeCompletedPayload {
                    node_id: node.id.clone(),
                    node_kind: format!("{:?}", node.kind),
                    node_kind_key: node_kind_key(&node.kind),
                    node_label: node.label.clone(),
                    params: node.params.clone(),
                    outputs: outputs.clone(),
                    selected_control_output: selected_control_output.map(ToString::to_string),
                },
            );
        };

    let run_result = executor
        .execute_with_progress(
            &graph,
            &mut emit_progress,
            &mut emit_variables,
            &mut emit_log,
            &mut emit_node_complete,
            &|| control.cancel_requested.load(Ordering::Relaxed),
        )
        .await;

    control.cancel_requested.store(false, Ordering::SeqCst);
    control.running.store(false, Ordering::SeqCst);

    run_result.map_err(|e| e.to_string())?;
    Ok("workflow finished".to_string())
}

#[tauri::command]
pub async fn stop_workflow() -> Result<String, String> {
    let control = execution_control();
    control.cancel_requested.store(true, Ordering::SeqCst);

    let reset_result = screenshot::reset_primary_frame_stream("stop_workflow");

    if control.running.load(Ordering::SeqCst) {
        match reset_result {
            Ok(()) => Ok("停止信号已发送，已重置 xcap 帧流实例，正在中断当前执行...".to_string()),
            Err(error) => Ok(format!(
                "停止信号已发送，但重置 xcap 帧流实例失败：{}",
                error
            )),
        }
    } else {
        match reset_result {
            Ok(()) => Ok("当前没有正在执行的工作流；已清理 xcap 帧流实例。".to_string()),
            Err(error) => Ok(format!(
                "当前没有正在执行的工作流；但清理 xcap 帧流实例失败：{}",
                error
            )),
        }
    }
}

#[tauri::command]
pub async fn save_workflow(path: String, graph: WorkflowGraph) -> Result<String, String> {
    let payload = serde_json::to_string_pretty(&graph).map_err(|error| error.to_string())?;
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

#[derive(Debug, Clone, Serialize)]
pub struct PackageWorkflowResult {
    pub executable_path: String,
    pub binary_name: String,
    pub source_path: String,
    pub build_output: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct PackageWorkflowJobStarted {
    pub job_id: String,
    pub workflow_name: String,
    pub target_path: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct PackageWorkflowProgressPayload {
    pub job_id: String,
    pub workflow_name: String,
    pub target_path: String,
    pub status: String,
    pub stage: String,
    pub progress: f64,
    pub message: String,
    pub log_line: Option<String>,
    pub result: Option<PackageWorkflowResult>,
}

fn package_job_counter() -> &'static AtomicU64 {
    static PACKAGE_JOB_COUNTER: OnceLock<AtomicU64> = OnceLock::new();
    PACKAGE_JOB_COUNTER.get_or_init(|| AtomicU64::new(1))
}

fn next_package_job_id() -> String {
    let index = package_job_counter().fetch_add(1, Ordering::Relaxed);
    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0);
    format!("pkg-{}-{}", now_ms, index)
}

fn emit_package_progress(
    app: &AppHandle,
    payload: PackageWorkflowProgressPayload,
) {
    let _ = app.emit(WORKFLOW_PACKAGE_PROGRESS_EVENT, payload);
}

fn clamp_progress(value: f64) -> f64 {
    value.clamp(0.0, 100.0)
}

fn update_cargo_progress(line: &str, current: f64) -> f64 {
    let trimmed = line.trim();
    if trimmed.starts_with("Compiling ") {
        return clamp_progress((current + 1.8).min(88.0));
    }
    if trimmed.starts_with("Checking ") {
        return clamp_progress((current + 1.4).min(86.0));
    }
    if trimmed.starts_with("Finished ") {
        return current.max(93.0);
    }
    if trimmed.contains("Running") {
        return clamp_progress((current + 0.3).min(90.0));
    }
    if trimmed.contains("warning:") || trimmed.contains("error[") {
        return clamp_progress((current + 0.05).min(90.0));
    }
    clamp_progress((current + 0.02).min(90.0))
}

#[tauri::command]
pub async fn start_package_workflow_as_exe(
    app: AppHandle,
    graph: WorkflowGraph,
    target_path: String,
) -> Result<PackageWorkflowJobStarted, String> {
    let requested_target = target_path.trim().to_string();
    if requested_target.is_empty() {
        return Err("输出路径不能为空。".to_string());
    }

    let job_id = next_package_job_id();
    let workflow_name = graph.name.clone();
    let app_for_task = app.clone();
    let job_id_for_task = job_id.clone();
    let target_for_task = requested_target.clone();
    let workflow_for_task = workflow_name.clone();

    tokio::spawn(async move {
        run_package_workflow_job(
            app_for_task,
            graph,
            target_for_task,
            job_id_for_task,
            workflow_for_task,
        )
        .await;
    });

    Ok(PackageWorkflowJobStarted {
        job_id,
        workflow_name,
        target_path: requested_target,
    })
}

async fn run_package_workflow_job(
    app: AppHandle,
    graph: WorkflowGraph,
    target_path: String,
    job_id: String,
    workflow_name: String,
) {
    emit_package_progress(
        &app,
        PackageWorkflowProgressPayload {
            job_id: job_id.clone(),
            workflow_name: workflow_name.clone(),
            target_path: target_path.clone(),
            status: "running".to_string(),
            stage: "queued".to_string(),
            progress: 0.0,
            message: "打包任务已进入队列。".to_string(),
            log_line: None,
            result: None,
        },
    );

    match package_workflow_job_inner(&app, &graph, &target_path, &job_id, &workflow_name).await {
        Ok(result) => {
            emit_package_progress(
                &app,
                PackageWorkflowProgressPayload {
                    job_id,
                    workflow_name,
                    target_path,
                    status: "success".to_string(),
                    stage: "done".to_string(),
                    progress: 100.0,
                    message: format!("打包完成：{}", result.executable_path),
                    log_line: None,
                    result: Some(result),
                },
            );
        }
        Err(error) => {
            emit_package_progress(
                &app,
                PackageWorkflowProgressPayload {
                    job_id,
                    workflow_name,
                    target_path,
                    status: "error".to_string(),
                    stage: "failed".to_string(),
                    progress: 100.0,
                    message: format!("打包失败：{}", error),
                    log_line: None,
                    result: None,
                },
            );
        }
    }
}

async fn package_workflow_job_inner(
    app: &AppHandle,
    graph: &WorkflowGraph,
    target_path: &str,
    job_id: &str,
    workflow_name: &str,
) -> Result<PackageWorkflowResult, String> {
    let manifest_dir = resolve_manifest_dir()?;
    let target_path = target_path.trim();
    let target_candidate = PathBuf::from(target_path);

    emit_package_progress(
        app,
        PackageWorkflowProgressPayload {
            job_id: job_id.to_string(),
            workflow_name: workflow_name.to_string(),
            target_path: target_path.to_string(),
            status: "running".to_string(),
            stage: "prepare".to_string(),
            progress: 5.0,
            message: "准备打包环境...".to_string(),
            log_line: Some(format!("manifest_dir={}", manifest_dir.display())),
            result: None,
        },
    );

    let requested_name = target_candidate
        .file_stem()
        .and_then(|stem| stem.to_str())
        .map(str::trim)
        .filter(|name| !name.is_empty())
        .unwrap_or_else(|| graph.name.as_str());
    let bin_name = sanitize_bin_name(requested_name);

    let source_dir = manifest_dir.join("src").join("bin");
    fs::create_dir_all(&source_dir).map_err(|error| {
        format!(
            "创建打包源码目录失败（{}）：{}",
            source_dir.display(),
            error
        )
    })?;

    let source_path = source_dir.join(format!("{}.rs", bin_name));
    let source_code = generate_workflow_bin_source(&graph)?;
    fs::write(&source_path, source_code).map_err(|error| {
        format!(
            "写入打包源码失败（{}）：{}",
            source_path.display(),
            error
        )
    })?;

    emit_package_progress(
        app,
        PackageWorkflowProgressPayload {
            job_id: job_id.to_string(),
            workflow_name: workflow_name.to_string(),
            target_path: target_path.to_string(),
            status: "running".to_string(),
            stage: "generate".to_string(),
            progress: 12.0,
            message: "已生成 Rust 源码，开始调用 Cargo 编译...".to_string(),
            log_line: Some(format!("source={}", source_path.display())),
            result: None,
        },
    );

    let mut command = Command::new("cargo");
    command
        .arg("build")
        .arg("--release")
        .arg("--bin")
        .arg(&bin_name)
        .current_dir(&manifest_dir)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());

    #[cfg(target_os = "windows")]
    {
        command.creation_flags(CREATE_NO_WINDOW);
    }

    let mut child = command
        .spawn()
        .map_err(|error| format!("调用 cargo 编译失败：{}", error))?;

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "无法捕捉 cargo stdout 输出。".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "无法捕捉 cargo stderr 输出。".to_string())?;

    let (line_tx, mut line_rx) = mpsc::unbounded_channel::<(String, String)>();

    let out_tx = line_tx.clone();
    let stdout_task = tokio::spawn(async move {
        let mut lines = BufReader::new(stdout).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            let _ = out_tx.send(("stdout".to_string(), line));
        }
    });

    let err_tx = line_tx.clone();
    let stderr_task = tokio::spawn(async move {
        let mut lines = BufReader::new(stderr).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            let _ = err_tx.send(("stderr".to_string(), line));
        }
    });

    drop(line_tx);

    let mut build_output = String::new();
    let mut progress = 18.0;
    while let Some((stream, line)) = line_rx.recv().await {
        progress = update_cargo_progress(&line, progress);
        let prefixed = format!("[{}] {}", stream, line);
        let _ = writeln!(&mut build_output, "{}", prefixed);
        emit_package_progress(
            app,
            PackageWorkflowProgressPayload {
                job_id: job_id.to_string(),
                workflow_name: workflow_name.to_string(),
                target_path: target_path.to_string(),
                status: "running".to_string(),
                stage: "build".to_string(),
                progress,
                message: "Cargo 编译进行中...".to_string(),
                log_line: Some(prefixed),
                result: None,
            },
        );
    }

    let _ = stdout_task.await;
    let _ = stderr_task.await;

    let status = child
        .wait()
        .await
        .map_err(|error| format!("等待 cargo 进程结束失败：{}", error))?;

    if !status.success() {
        return Err(format!(
            "Cargo 编译失败（bin={}，exit={}）。\n{}",
            bin_name,
            status,
            build_output
        ));
    }

    emit_package_progress(
        app,
        PackageWorkflowProgressPayload {
            job_id: job_id.to_string(),
            workflow_name: workflow_name.to_string(),
            target_path: target_path.to_string(),
            status: "running".to_string(),
            stage: "copy".to_string(),
            progress: 95.0,
            message: "编译完成，正在复制 exe 到目标目录...".to_string(),
            log_line: None,
            result: None,
        },
    );

    let compiled_path = manifest_dir
        .join("target")
        .join("release")
        .join(format!("{}.exe", bin_name));

    if !compiled_path.exists() {
        return Err(format!(
            "Cargo 编译已完成，但未找到产物：{}",
            compiled_path.display()
        ));
    }

    let mut final_target = target_candidate;
    if final_target
        .extension()
        .and_then(|value| value.to_str())
        .map(|ext| !ext.eq_ignore_ascii_case("exe"))
        .unwrap_or(true)
    {
        final_target.set_extension("exe");
    }

    if let Some(parent) = final_target.parent() {
        fs::create_dir_all(parent).map_err(|error| {
            format!(
                "创建输出目录失败（{}）：{}",
                parent.display(),
                error
            )
        })?;
    }

    fs::copy(&compiled_path, &final_target).map_err(|error| {
        format!(
            "复制 exe 到输出路径失败（{} -> {}）：{}",
            compiled_path.display(),
            final_target.display(),
            error
        )
    })?;

    Ok(PackageWorkflowResult {
        executable_path: final_target.to_string_lossy().to_string(),
        binary_name: bin_name,
        source_path: source_path.to_string_lossy().to_string(),
        build_output,
    })
}

fn resolve_manifest_dir() -> Result<PathBuf, String> {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    if manifest_dir.join("Cargo.toml").exists() {
        return Ok(manifest_dir);
    }

    let current_dir = std::env::current_dir().map_err(|error| error.to_string())?;
    let direct = current_dir.join("Cargo.toml");
    if direct.exists() {
        return Ok(current_dir);
    }

    let nested = current_dir.join("src-tauri").join("Cargo.toml");
    if nested.exists() {
        return Ok(current_dir.join("src-tauri"));
    }

    Err("无法定位 src-tauri/Cargo.toml，请确保在项目源码目录运行。".to_string())
}

fn sanitize_bin_name(raw: &str) -> String {
    let mut normalized = raw
        .trim()
        .to_lowercase()
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() {
                ch
            } else {
                '_'
            }
        })
        .collect::<String>();

    while normalized.contains("__") {
        normalized = normalized.replace("__", "_");
    }
    normalized = normalized.trim_matches('_').to_string();

    if normalized.is_empty() {
        normalized = "workflow_package".to_string();
    }

    if !normalized
        .chars()
        .next()
        .map(|ch| ch.is_ascii_alphabetic())
        .unwrap_or(false)
    {
        normalized = format!("workflow_{}", normalized);
    }

    if normalized.len() > 64 {
        normalized.truncate(64);
        normalized = normalized.trim_end_matches('_').to_string();
    }

    normalized
}

fn to_rust_string_literal(value: &str) -> String {
    serde_json::to_string(value).unwrap_or_else(|_| "\"\"".to_string())
}

fn format_option_string(value: &Option<String>) -> String {
    match value {
        Some(content) => format!("Some({}.to_string())", to_rust_string_literal(content)),
        None => "None".to_string(),
    }
}

fn generate_workflow_bin_source(graph: &WorkflowGraph) -> Result<String, String> {
    let mut source = String::new();
    source.push_str("use commandflow_rs_lib::automation::executor::WorkflowExecutor;\n");
    source.push_str("use commandflow_rs_lib::workflow::edge::WorkflowEdge;\n");
    source.push_str("use commandflow_rs_lib::workflow::graph::WorkflowGraph;\n");
    source.push_str("use commandflow_rs_lib::workflow::node::{NodeKind, WorkflowNode};\n\n");

    source.push_str("fn build_graph() -> WorkflowGraph {\n");
    let _ = writeln!(
        &mut source,
        "    WorkflowGraph {{\n        id: {}.to_string(),\n        name: {}.to_string(),\n        nodes: vec![",
        to_rust_string_literal(&graph.id),
        to_rust_string_literal(&graph.name)
    );

    for node in &graph.nodes {
        let kind_literal = format!("{:?}", node.kind);
        let params_json = serde_json::to_string(&node.params)
            .map_err(|error| format!("序列化节点参数失败（{}）：{}", node.id, error))?;
        let _ = writeln!(
            &mut source,
            "            WorkflowNode {{ id: {}.to_string(), label: {}.to_string(), kind: NodeKind::{}, position_x: {:?}, position_y: {:?}, params: serde_json::from_str::<std::collections::HashMap<String, serde_json::Value>>({}).expect(\"invalid embedded params\") }},",
            to_rust_string_literal(&node.id),
            to_rust_string_literal(&node.label),
            kind_literal,
            node.position_x,
            node.position_y,
            to_rust_string_literal(&params_json)
        );
    }

    source.push_str("        ],\n        edges: vec![\n");
    for edge in &graph.edges {
        let _ = writeln!(
            &mut source,
            "            WorkflowEdge {{ id: {}.to_string(), source: {}.to_string(), target: {}.to_string(), source_handle: {}, target_handle: {} }},",
            to_rust_string_literal(&edge.id),
            to_rust_string_literal(&edge.source),
            to_rust_string_literal(&edge.target),
            format_option_string(&edge.source_handle),
            format_option_string(&edge.target_handle)
        );
    }
    source.push_str("        ],\n    }\n}\n\n");

    source.push_str("#[tokio::main]\n");
    source.push_str("async fn main() {\n");
    source.push_str("    let graph = build_graph();\n");
    source.push_str(
        "    println!(\"[CommandFlow] 开始执行工作流: {} (nodes={}, edges={})\", graph.name, graph.nodes.len(), graph.edges.len());\n",
    );
    source.push_str("    let executor = WorkflowExecutor::default();\n");
    source.push_str("\n");
    source.push_str("    let mut on_node_start = |node: &WorkflowNode| {\n");
    source.push_str("        let params_json = serde_json::to_string(&node.params).unwrap_or_else(|_| \"{}\".to_string());\n");
    source.push_str("        println!(\"[NODE_START] id={} kind={:?} label={} params={}\", node.id, node.kind, node.label, params_json);\n");
    source.push_str("    };\n");
    source.push_str("\n");
    source.push_str("    let mut on_variables_update = |variables: &std::collections::HashMap<String, serde_json::Value>| {\n");
    source.push_str("        let vars_json = serde_json::to_string(variables).unwrap_or_else(|_| \"{}\".to_string());\n");
    source.push_str("        println!(\"[VARS] {}\", vars_json);\n");
    source.push_str("    };\n");
    source.push_str("\n");
    source.push_str("    let mut on_log = |level: &str, message: String| {\n");
    source.push_str("        println!(\"[LOG:{}] {}\", level, message);\n");
    source.push_str("    };\n");
    source.push_str("\n");
    source.push_str("    let mut on_node_complete = |node: &WorkflowNode, outputs: &std::collections::HashMap<String, serde_json::Value>, selected_control_output: Option<&str>| {\n");
    source.push_str("        let outputs_json = serde_json::to_string(outputs).unwrap_or_else(|_| \"{}\".to_string());\n");
    source.push_str("        println!(\"[NODE_DONE] id={} kind={:?} label={} selected={} outputs={}\", node.id, node.kind, node.label, selected_control_output.unwrap_or(\"\"), outputs_json);\n");
    source.push_str("    };\n");
    source.push_str("\n");
    source.push_str("    let should_cancel = || false;\n");
    source.push_str("\n");
    source.push_str("    match executor\n");
    source.push_str("        .execute_with_progress(\n");
    source.push_str("            &graph,\n");
    source.push_str("            &mut on_node_start,\n");
    source.push_str("            &mut on_variables_update,\n");
    source.push_str("            &mut on_log,\n");
    source.push_str("            &mut on_node_complete,\n");
    source.push_str("            &should_cancel,\n");
    source.push_str("        )\n");
    source.push_str("        .await\n");
    source.push_str("    {\n");
    source.push_str("        Ok(()) => {\n");
    source.push_str("            println!(\"[CommandFlow] 工作流执行完成: {}\", graph.name);\n");
    source.push_str("        }\n");
    source.push_str("        Err(error) => {\n");
    source.push_str("            eprintln!(\"[CommandFlow] 工作流执行失败: {}\", error);\n");
    source.push_str("            std::process::exit(1);\n");
    source.push_str("        }\n");
    source.push_str("    }\n");
    source.push_str("}\n");

    Ok(source)
}

#[tauri::command]
pub async fn pick_coordinate(app: AppHandle) -> Result<CoordinateInfo, String> {
    {
        let sender_mutex = coordinate_pick_sender_store();
        let sender_guard = sender_mutex
            .lock()
            .map_err(|_| "坐标拾取状态锁已损坏。".to_string())?;
        if sender_guard.is_some() {
            return Err("已有坐标拾取正在进行中。".to_string());
        }
    }

    if let Some(existing) = app.get_webview_window("coordinate-overlay") {
        let _ = existing.close();
    }

    let (tx, rx) = oneshot::channel::<Result<CoordinateInfo, String>>();
    {
        let sender_mutex = coordinate_pick_sender_store();
        let mut sender_guard = sender_mutex
            .lock()
            .map_err(|_| "坐标拾取状态锁已损坏。".to_string())?;
        *sender_guard = Some(tx);
    }

    let window = tauri::WebviewWindowBuilder::new(
        &app,
        "coordinate-overlay",
        tauri::WebviewUrl::App("index.html?coordinateOverlay=1".into()),
    )
    .title("Coordinate Overlay")
    .decorations(false)
    .resizable(false)
    .always_on_top(true)
    .skip_taskbar(true)
    .focused(true)
    .transparent(true)
    .build()
    .map_err(|error| {
        let sender_mutex = coordinate_pick_sender_store();
        if let Ok(mut sender_guard) = sender_mutex.lock() {
            sender_guard.take();
        }
        format!("创建坐标拾取 Overlay 失败：{}", error)
    })?;

    #[cfg(target_os = "windows")]
    {
        if let Err(fullscreen_error) = window.set_fullscreen(true) {
            let (x, y, width, height) = get_virtual_screen_bounds();
            window
                .set_position(Position::Physical(PhysicalPosition { x, y }))
                .map_err(|error| format!("设置 Overlay 位置失败：{}", error))?;
            window
                .set_size(Size::Physical(PhysicalSize { width, height }))
                .map_err(|error| format!("设置 Overlay 尺寸失败：{}", error))?;
            eprintln!(
                "[coordinate-overlay] set_fullscreen failed on windows, fallback to virtual screen bounds: {}",
                fullscreen_error
            );
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        window
            .set_fullscreen(true)
            .map_err(|error| format!("设置 Overlay 全屏失败：{}", error))?;
    }

    let _ = window.set_focus();

    let output = match tokio::time::timeout(Duration::from_secs(300), rx).await {
        Ok(Ok(result)) => result,
        Ok(Err(_)) => Err("坐标拾取流程异常中断。".to_string()),
        Err(_) => Err("坐标拾取超时，已自动取消。".to_string()),
    };

    {
        let sender_mutex = coordinate_pick_sender_store();
        if let Ok(mut sender_guard) = sender_mutex.lock() {
            sender_guard.take();
        }
    }

    if let Some(overlay) = app.get_webview_window("coordinate-overlay") {
        let _ = overlay.close();
    }

    output
}

#[tauri::command]
pub async fn pick_ui_element(app: AppHandle) -> Result<uia::UiElementPreview, String> {
    {
        let sender_mutex = ui_element_pick_sender_store();
        let sender_guard = sender_mutex
            .lock()
            .map_err(|_| "元素提取状态锁已损坏。".to_string())?;
        if sender_guard.is_some() {
            return Err("已有元素提取正在进行中。".to_string());
        }
    }

    if let Some(existing) = app.get_webview_window("coordinate-overlay") {
        let _ = existing.close();
    }

    let (tx, rx) = oneshot::channel::<Result<uia::UiElementPreview, String>>();
    {
        let sender_mutex = ui_element_pick_sender_store();
        let mut sender_guard = sender_mutex
            .lock()
            .map_err(|_| "元素提取状态锁已损坏。".to_string())?;
        *sender_guard = Some(tx);
    }

    let window = tauri::WebviewWindowBuilder::new(
        &app,
        "coordinate-overlay",
        tauri::WebviewUrl::App("index.html?coordinateOverlay=1&pickMode=element".into()),
    )
    .title("UI Element Overlay")
    .decorations(false)
    .resizable(false)
    .always_on_top(true)
    .skip_taskbar(true)
    .focused(true)
    .transparent(true)
    .build()
    .map_err(|error| {
        let sender_mutex = ui_element_pick_sender_store();
        if let Ok(mut sender_guard) = sender_mutex.lock() {
            sender_guard.take();
        }
        format!("创建元素提取 Overlay 失败：{}", error)
    })?;

    #[cfg(target_os = "windows")]
    {
        if let Err(fullscreen_error) = window.set_fullscreen(true) {
            let (x, y, width, height) = get_virtual_screen_bounds();
            window
                .set_position(Position::Physical(PhysicalPosition { x, y }))
                .map_err(|error| format!("设置 Overlay 位置失败：{}", error))?;
            window
                .set_size(Size::Physical(PhysicalSize { width, height }))
                .map_err(|error| format!("设置 Overlay 尺寸失败：{}", error))?;
            eprintln!(
                "[ui-element-overlay] set_fullscreen failed on windows, fallback to virtual screen bounds: {}",
                fullscreen_error
            );
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        window
            .set_fullscreen(true)
            .map_err(|error| format!("设置 Overlay 全屏失败：{}", error))?;
    }

    #[cfg(target_os = "windows")]
    {
        window
            .set_ignore_cursor_events(true)
            .map_err(|error| format!("设置元素拾取 Overlay 鼠标穿透失败：{}", error))?;

        let app_for_loop = app.clone();
        tokio::spawn(async move {
            run_ui_element_pick_clickthrough_loop(app_for_loop).await;
        });
    }

    let output = match tokio::time::timeout(Duration::from_secs(300), rx).await {
        Ok(Ok(result)) => result,
        Ok(Err(_)) => Err("元素提取流程异常中断。".to_string()),
        Err(_) => Err("元素提取超时，已自动取消。".to_string()),
    };

    {
        let sender_mutex = ui_element_pick_sender_store();
        if let Ok(mut sender_guard) = sender_mutex.lock() {
            sender_guard.take();
        }
    }

    if let Some(overlay) = app.get_webview_window("coordinate-overlay") {
        let _ = overlay.close();
    }

    output
}

#[tauri::command]
pub async fn get_cursor_position() -> Result<CoordinateInfo, String> {
    #[cfg(target_os = "windows")]
    {
        let (x, y) = read_cursor_virtual_screen_point()?;
        Ok(CoordinateInfo {
            x,
            y,
            is_physical_pixel: true,
            mode: "virtualScreen".to_string(),
        })
    }

    #[cfg(not(target_os = "windows"))]
    {
        Err("当前平台尚未支持系统级鼠标坐标读取。".to_string())
    }
}

#[tauri::command]
pub async fn confirm_coordinate_pick(app: AppHandle) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        let (x, y) = read_cursor_virtual_screen_point()?;
        complete_coordinate_pick(Ok(CoordinateInfo {
            x,
            y,
            is_physical_pixel: true,
            mode: "virtualScreen".to_string(),
        }))?;

        if let Some(overlay) = app.get_webview_window("coordinate-overlay") {
            let _ = overlay.close();
        }

        Ok(())
    }

    #[cfg(not(target_os = "windows"))]
    {
        if let Some(overlay) = app.get_webview_window("coordinate-overlay") {
            let _ = overlay.close();
        }
        complete_coordinate_pick(Err("当前平台尚未支持系统级坐标拾取。".to_string()))
    }
}

#[tauri::command]
pub async fn cancel_coordinate_pick(app: AppHandle, reason: Option<String>) -> Result<(), String> {
    let cancel_reason = reason.unwrap_or_else(|| "已取消坐标拾取。".to_string());

    if let Some(overlay) = app.get_webview_window("coordinate-overlay") {
        let _ = overlay.close();
    }

    complete_coordinate_pick(Err(cancel_reason))
}

#[tauri::command]
pub async fn preview_ui_element_pick() -> Result<Option<uia::UiElementPreview>, String> {
    #[cfg(target_os = "windows")]
    {
        let (x, y) = read_cursor_virtual_screen_point()?;
        uia::inspect_element_at_point(x, y).map_err(|error| error.to_string())
    }

    #[cfg(not(target_os = "windows"))]
    {
        Err("当前平台尚未支持 UI 元素提取预览。".to_string())
    }
}

#[tauri::command]
pub async fn confirm_ui_element_pick(app: AppHandle) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        let (x, y) = read_cursor_virtual_screen_point()?;
        let preview = uia::inspect_element_at_point(x, y)
            .map_err(|error| error.to_string())?
            .ok_or_else(|| "当前鼠标位置未检测到可用元素。".to_string())?;

        complete_ui_element_pick(Ok(preview))?;

        if let Some(overlay) = app.get_webview_window("coordinate-overlay") {
            let _ = overlay.close();
        }

        Ok(())
    }

    #[cfg(not(target_os = "windows"))]
    {
        if let Some(overlay) = app.get_webview_window("coordinate-overlay") {
            let _ = overlay.close();
        }
        complete_ui_element_pick(Err("当前平台尚未支持 UI 元素提取。".to_string()))
    }
}

#[tauri::command]
pub async fn cancel_ui_element_pick(app: AppHandle, reason: Option<String>) -> Result<(), String> {
    let cancel_reason = reason.unwrap_or_else(|| "已取消元素提取。".to_string());

    if let Some(overlay) = app.get_webview_window("coordinate-overlay") {
        let _ = overlay.close();
    }

    complete_ui_element_pick(Err(cancel_reason))
}

#[tauri::command]
pub async fn list_open_windows() -> Result<Vec<String>, String> {
    window::list_open_window_titles().map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn list_open_window_details() -> Result<Vec<window::OpenWindowEntry>, String> {
    window::list_open_window_entries().map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn list_start_menu_apps() -> Result<Vec<start_menu::StartMenuAppEntry>, String> {
    start_menu::scan_start_menu_apps().map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn resolve_start_menu_app_icon(
    icon_path: String,
    target_path: String,
    source_path: Option<String>,
) -> Result<Option<String>, String> {
    start_menu::resolve_app_icon_data_url(
        Some(icon_path.as_str()),
        Some(target_path.as_str()),
        source_path.as_deref(),
    )
    .map_err(|error| error.to_string())
}

fn ends_with_version_segment(url: &str) -> bool {
    let Some(segment) = url.rsplit('/').next() else {
        return false;
    };

    if !segment.starts_with('v') || segment.len() < 2 {
        return false;
    }

    segment[1..].chars().all(|ch| ch.is_ascii_digit())
}

fn resolve_models_endpoint(base_url: &str) -> String {
    let trimmed = base_url.trim().trim_end_matches('/');

    if trimmed.ends_with("/models") {
        return trimmed.to_string();
    }

    if trimmed.ends_with("/chat/completions") {
        let root = trimmed.trim_end_matches("/chat/completions");
        if ends_with_version_segment(root) {
            return format!("{}/models", root);
        }
        return format!("{}/v1/models", root);
    }

    if ends_with_version_segment(trimmed) {
        format!("{}/models", trimmed)
    } else {
        format!("{}/v1/models", trimmed)
    }
}

#[tauri::command]
pub async fn fetch_llm_models(base_url: String, api_key: String) -> Result<Vec<String>, String> {
    let normalized = base_url.trim();
    if normalized.is_empty() {
        return Ok(Vec::new());
    }

    let endpoint = resolve_models_endpoint(normalized);
    let client = reqwest::Client::new();
    let mut request = client
        .get(endpoint)
        .header(CONTENT_TYPE, "application/json");

    if !api_key.trim().is_empty() {
        request = request.header(AUTHORIZATION, format!("Bearer {}", api_key.trim()));
    }

    let response = request
        .send()
        .await
        .map_err(|error| format!("获取模型列表请求失败: {}", error))?
        .error_for_status()
        .map_err(|error| format!("获取模型列表失败: {}", error))?;

    let payload = response
        .json::<ModelListResponse>()
        .await
        .map_err(|error| format!("解析模型列表失败: {}", error))?;

    let mut model_ids = payload
        .data
        .into_iter()
        .map(|item| item.id.trim().to_string())
        .filter(|id| !id.is_empty())
        .collect::<Vec<_>>();

    model_ids.sort();
    model_ids.dedup();
    Ok(model_ids)
}

#[tauri::command]
pub async fn load_llm_presets() -> Result<Vec<crate::secure_settings::LlmPreset>, String> {
    crate::secure_settings::load_llm_presets()
}

#[tauri::command]
pub async fn save_llm_presets(
    presets: Vec<crate::secure_settings::LlmPreset>,
) -> Result<(), String> {
    crate::secure_settings::save_llm_presets(presets)
}

#[tauri::command]
pub async fn load_input_recording_presets(
) -> Result<Vec<crate::secure_settings::InputRecordingPreset>, String> {
    crate::secure_settings::load_input_recording_presets()
}

#[tauri::command]
pub async fn save_input_recording_presets(
    presets: Vec<crate::secure_settings::InputRecordingPreset>,
) -> Result<(), String> {
    crate::secure_settings::save_input_recording_presets(presets)
}

#[tauri::command]
pub async fn start_input_recording(
    app: AppHandle,
    options: crate::input_recorder::InputRecordingOptions,
) -> Result<String, String> {
    input_recorder::start_recording(app, options).await
}

#[tauri::command]
pub async fn stop_input_recording(
    app: AppHandle,
) -> Result<crate::input_recorder::InputRecordingStopResult, String> {
    input_recorder::stop_recording(app).await
}

#[tauri::command]
pub async fn set_background_mode(app: AppHandle, enabled: bool) -> Result<String, String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "未找到主窗口。".to_string())?;

    let snapshot_mutex = window_snapshot_store();

    if enabled {
        let compact_width = 640u32;
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
        let outer_size = window.outer_size().unwrap_or(PhysicalSize {
            width: compact_width,
            height: compact_height,
        });

        #[cfg(target_os = "windows")]
        {
            // Windows: 使用工作区域（排除任务栏）
            let margin = 12i32;
            if let Some((_, _, work_right, work_bottom)) = get_work_area() {
                // 工作区域右下角作为基准
                let target_x = work_right - outer_size.width as i32 - margin;
                let target_y = work_bottom - outer_size.height as i32 - margin;
                window
                    .set_position(Position::Physical(PhysicalPosition {
                        x: target_x,
                        y: target_y,
                    }))
                    .map_err(|error| error.to_string())?;
            }
        }

        #[cfg(not(target_os = "windows"))]
        {
            // 其他平台：使用显示器尺寸
            if let Some(monitor) = window
                .current_monitor()
                .map_err(|error| error.to_string())?
            {
                let margin = 12i32;
                let monitor_pos = monitor.position();
                let monitor_size = monitor.size();

                let target_x =
                    monitor_pos.x + monitor_size.width as i32 - outer_size.width as i32 - margin;
                let target_y =
                    monitor_pos.y + monitor_size.height as i32 - outer_size.height as i32 - margin;

                window
                    .set_position(Position::Physical(PhysicalPosition {
                        x: target_x,
                        y: target_y,
                    }))
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

#[tauri::command]
pub async fn play_completion_beep() -> Result<String, String> {
    #[cfg(target_os = "windows")]
    {
        unsafe {
            let _ = Beep(880, 180);
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        print!("\x07");
    }

    Ok("played".to_string())
}
