use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::sync::mpsc::{self, Receiver, Sender};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter};
use tokio::sync::oneshot;

#[cfg(target_os = "windows")]
use windows_sys::Win32::Foundation::POINT;
#[cfg(target_os = "windows")]
use windows_sys::Win32::UI::Input::KeyboardAndMouse::{
    GetAsyncKeyState, VK_0, VK_ADD,
    VK_BACK, VK_CAPITAL, VK_CONTROL, VK_DECIMAL, VK_DELETE, VK_DIVIDE, VK_DOWN, VK_END,
    VK_ESCAPE, VK_F1, VK_F10, VK_F11, VK_F12, VK_F13, VK_F14, VK_F15, VK_F16, VK_F17, VK_F18,
    VK_F19, VK_F2, VK_F20, VK_F21, VK_F22, VK_F23, VK_F24, VK_F3, VK_F4, VK_F5, VK_F6, VK_F7,
    VK_F8, VK_F9, VK_HOME, VK_INSERT, VK_LBUTTON, VK_LEFT, VK_LMENU, VK_LSHIFT, VK_LWIN,
    VK_MBUTTON, VK_MENU, VK_MULTIPLY, VK_NEXT, VK_PRIOR, VK_RBUTTON, VK_RETURN, VK_RIGHT,
    VK_RMENU, VK_RSHIFT, VK_RWIN, VK_SCROLL, VK_SHIFT, VK_SNAPSHOT, VK_SPACE, VK_SUBTRACT,
    VK_TAB, VK_UP,
};
#[cfg(target_os = "windows")]
use windows_sys::Win32::UI::WindowsAndMessaging::{
    CallNextHookEx, DispatchMessageW, GetCursorPos, GetMessageW, PostThreadMessageW,
    SetWindowsHookExW, TranslateMessage, UnhookWindowsHookEx, HC_ACTION, MSG,
    MSLLHOOKSTRUCT, WH_MOUSE_LL, WM_MOUSEWHEEL,
};
#[cfg(target_os = "windows")]
use windows_sys::Win32::{Foundation::{LPARAM, LRESULT, WPARAM}, System::Threading::GetCurrentThreadId};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InputRecordingOptions {
    pub record_keyboard: bool,
    pub record_mouse_clicks: bool,
    pub record_mouse_moves: bool,
}

impl Default for InputRecordingOptions {
    fn default() -> Self {
        Self {
            record_keyboard: true,
            record_mouse_clicks: true,
            record_mouse_moves: true,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordedCursorPoint {
    pub x: i32,
    pub y: i32,
    pub timestamp_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum InputRecordingAction {
    KeyDown {
        key: String,
        timestamp_ms: u64,
    },
    KeyUp {
        key: String,
        timestamp_ms: u64,
    },
    MouseDown {
        button: String,
        x: i32,
        y: i32,
        timestamp_ms: u64,
    },
    MouseUp {
        button: String,
        x: i32,
        y: i32,
        timestamp_ms: u64,
    },
    MouseWheel {
        x: i32,
        y: i32,
        vertical: i32,
        timestamp_ms: u64,
    },
    MouseMovePath {
        points: Vec<RecordedCursorPoint>,
        duration_ms: u64,
        distance_px: f64,
        simplified_from: usize,
        timestamp_ms: u64,
    },
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InputRecordingStatePayload {
    pub recording: bool,
    pub operation_count: usize,
    pub started_at_ms: Option<u64>,
    pub options: InputRecordingOptions,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InputRecordingLogPayload {
    pub level: String,
    pub message: String,
    pub operation_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InputRecordingStopResult {
    pub message: String,
    pub actions: Vec<InputRecordingAction>,
    pub operation_count: usize,
    pub started_at_ms: u64,
    pub ended_at_ms: u64,
    pub options: InputRecordingOptions,
}

#[derive(Debug)]
struct RecorderRunState {
    options: InputRecordingOptions,
    cancel_requested: Arc<AtomicBool>,
    finished_rx: oneshot::Receiver<Result<InputRecordingStopResult, String>>,
    started_at_ms: u64,
}

#[cfg(target_os = "windows")]
#[derive(Debug, Clone)]
struct MouseWheelRawEvent {
    x: i32,
    y: i32,
    vertical: i32,
    occurred_at: Instant,
}

#[cfg(target_os = "windows")]
struct MouseWheelHook {
    receiver: Receiver<MouseWheelRawEvent>,
    thread_id: u32,
    join_handle: Option<std::thread::JoinHandle<()>>,
}

fn recorder_store() -> &'static Mutex<Option<RecorderRunState>> {
    static RECORDER: OnceLock<Mutex<Option<RecorderRunState>>> = OnceLock::new();
    RECORDER.get_or_init(|| Mutex::new(None))
}

#[cfg(target_os = "windows")]
fn mouse_wheel_sender_store() -> &'static Mutex<Option<Sender<MouseWheelRawEvent>>> {
    static STORE: OnceLock<Mutex<Option<Sender<MouseWheelRawEvent>>>> = OnceLock::new();
    STORE.get_or_init(|| Mutex::new(None))
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|it| it.as_millis() as u64)
        .unwrap_or(0)
}

fn emit_state(app: &AppHandle, recording: bool, operation_count: usize, started_at_ms: Option<u64>, options: InputRecordingOptions) {
    let _ = app.emit(
        "input-recorder-state",
        InputRecordingStatePayload {
            recording,
            operation_count,
            started_at_ms,
            options,
        },
    );
}

fn emit_log(app: &AppHandle, level: &str, message: String, operation_count: usize) {
    let _ = app.emit(
        "input-recorder-log",
        InputRecordingLogPayload {
            level: level.to_string(),
            message,
            operation_count,
        },
    );
}

fn action_summary(action: &InputRecordingAction) -> String {
    match action {
        InputRecordingAction::KeyDown { key, .. } => format!("键盘按下：{}", key),
        InputRecordingAction::KeyUp { key, .. } => format!("键盘松开：{}", key),
        InputRecordingAction::MouseDown { button, x, y, .. } => {
            format!("鼠标按下：{} @ ({}, {})", button, x, y)
        }
        InputRecordingAction::MouseUp { button, x, y, .. } => {
            format!("鼠标松开：{} @ ({}, {})", button, x, y)
        }
        InputRecordingAction::MouseWheel { x, y, vertical, .. } => {
            let direction = if *vertical > 0 { "上滚" } else { "下滚" };
            format!("鼠标滚轮：{} {} @ ({}, {})", direction, vertical.abs(), x, y)
        }
        InputRecordingAction::MouseMovePath {
            points,
            simplified_from,
            distance_px,
            ..
        } => format!(
            "轨迹片段：{} 个点（原始 {} 个，约 {:.0}px）",
            points.len(),
            simplified_from,
            distance_px
        ),
    }
}

fn push_action(app: &AppHandle, actions: &mut Vec<InputRecordingAction>, action: InputRecordingAction) {
    actions.push(action.clone());
    emit_log(app, "info", format!("已记录第 {} 个操作：{}", actions.len(), action_summary(&action)), actions.len());
}

#[cfg(target_os = "windows")]
fn is_vk_pressed(vk: i32) -> bool {
    unsafe { (GetAsyncKeyState(vk) as u16 & 0x8000) != 0 }
}

#[cfg(not(target_os = "windows"))]
fn is_vk_pressed(_vk: i32) -> bool {
    false
}

#[cfg(target_os = "windows")]
fn get_cursor() -> Result<(i32, i32), String> {
    let mut point: POINT = unsafe { std::mem::zeroed() };
    let ok = unsafe { GetCursorPos(&mut point as *mut POINT) };
    if ok == 0 {
        return Err("获取鼠标位置失败。".to_string());
    }
    Ok((point.x, point.y))
}

#[cfg(not(target_os = "windows"))]
fn get_cursor() -> Result<(i32, i32), String> {
    Err("当前平台暂不支持键鼠录制。".to_string())
}

#[cfg(target_os = "windows")]
unsafe extern "system" fn mouse_wheel_hook_proc(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    if code == HC_ACTION as i32 && wparam == WM_MOUSEWHEEL as usize {
        let info = &*(lparam as *const MSLLHOOKSTRUCT);
        let vertical = ((info.mouseData >> 16) as i16) as i32;
        if vertical != 0 {
            if let Ok(guard) = mouse_wheel_sender_store().lock() {
                if let Some(sender) = guard.as_ref() {
                    let _ = sender.send(MouseWheelRawEvent {
                        x: info.pt.x,
                        y: info.pt.y,
                        vertical,
                        occurred_at: Instant::now(),
                    });
                }
            }
        }
    }

    CallNextHookEx(std::ptr::null_mut(), code, wparam, lparam)
}

#[cfg(target_os = "windows")]
fn start_mouse_wheel_hook() -> Result<MouseWheelHook, String> {
    let (event_tx, event_rx) = mpsc::channel::<MouseWheelRawEvent>();
    let (ready_tx, ready_rx) = mpsc::channel::<Result<u32, String>>();

    let join_handle = std::thread::spawn(move || {
        if let Ok(mut guard) = mouse_wheel_sender_store().lock() {
            *guard = Some(event_tx.clone());
        }

        let thread_id = unsafe { GetCurrentThreadId() };
        let hook = unsafe { SetWindowsHookExW(WH_MOUSE_LL, Some(mouse_wheel_hook_proc), std::ptr::null_mut(), 0) };
        if hook.is_null() {
            if let Ok(mut guard) = mouse_wheel_sender_store().lock() {
                *guard = None;
            }
            let _ = ready_tx.send(Err(format!(
                "安装鼠标滚轮钩子失败：{}",
                std::io::Error::last_os_error()
            )));
            return;
        }

        let _ = ready_tx.send(Ok(thread_id));

        let mut msg: MSG = unsafe { std::mem::zeroed() };
        loop {
            let result = unsafe { GetMessageW(&mut msg as *mut MSG, std::ptr::null_mut(), 0, 0) };
            if result <= 0 {
                break;
            }
            unsafe {
                TranslateMessage(&msg);
                DispatchMessageW(&msg);
            }
        }

        unsafe {
            let _ = UnhookWindowsHookEx(hook);
        }
        if let Ok(mut guard) = mouse_wheel_sender_store().lock() {
            *guard = None;
        }
    });

    let thread_id = ready_rx
        .recv()
        .map_err(|_| "鼠标滚轮钩子初始化线程异常退出。".to_string())??;

    Ok(MouseWheelHook {
        receiver: event_rx,
        thread_id,
        join_handle: Some(join_handle),
    })
}

#[cfg(target_os = "windows")]
impl Drop for MouseWheelHook {
    fn drop(&mut self) {
        unsafe {
            let _ = PostThreadMessageW(self.thread_id, windows_sys::Win32::UI::WindowsAndMessaging::WM_QUIT, 0, 0);
        }
        if let Some(handle) = self.join_handle.take() {
            let _ = handle.join();
        }
    }
}

#[cfg(target_os = "windows")]
fn monitored_keys() -> Vec<(i32, &'static str)> {
    let mut keys: Vec<(i32, &'static str)> = vec![
        (VK_CONTROL as i32, "Ctrl"),
        (VK_MENU as i32, "Alt"),
        (VK_SHIFT as i32, "Shift"),
        (VK_LWIN as i32, "Win"),
        (VK_TAB as i32, "Tab"),
        (VK_RETURN as i32, "Enter"),
        (VK_SPACE as i32, "Space"),
        (VK_ESCAPE as i32, "Escape"),
        (VK_BACK as i32, "Backspace"),
        (VK_DELETE as i32, "Delete"),
        (VK_INSERT as i32, "Insert"),
        (VK_HOME as i32, "Home"),
        (VK_END as i32, "End"),
        (VK_PRIOR as i32, "PageUp"),
        (VK_NEXT as i32, "PageDown"),
        (VK_LEFT as i32, "Left"),
        (VK_RIGHT as i32, "Right"),
        (VK_UP as i32, "Up"),
        (VK_DOWN as i32, "Down"),
        (VK_CAPITAL as i32, "CapsLock"),
        (VK_SCROLL as i32, "ScrollLock"),
        (VK_SNAPSHOT as i32, "PrintScreen"),
        (VK_ADD as i32, "+"),
        (VK_SUBTRACT as i32, "-"),
        (VK_MULTIPLY as i32, "*"),
        (VK_DIVIDE as i32, "/"),
        (VK_DECIMAL as i32, "."),
        (VK_LSHIFT as i32, "LShift"),
        (VK_RSHIFT as i32, "RShift"),
        (VK_LMENU as i32, "LAlt"),
        (VK_RMENU as i32, "RAlt"),
        (VK_RWIN as i32, "RWin"),
    ];

    for offset in 0..=9 {
        let code = VK_0 as i32 + offset;
        let label = char::from(b'0' + offset as u8).to_string();
        keys.push((code, Box::leak(label.into_boxed_str())));
    }

    for offset in 0..26 {
        let code = 0x41 + offset;
        let label = char::from(b'A' + offset as u8).to_string();
        keys.push((code, Box::leak(label.into_boxed_str())));
    }

    let function_keys = [
        VK_F1, VK_F2, VK_F3, VK_F4, VK_F5, VK_F6, VK_F7, VK_F8, VK_F9, VK_F10, VK_F11, VK_F12,
        VK_F13, VK_F14, VK_F15, VK_F16, VK_F17, VK_F18, VK_F19, VK_F20, VK_F21, VK_F22, VK_F23,
        VK_F24,
    ];
    for (index, vk) in function_keys.into_iter().enumerate() {
        let label = format!("F{}", index + 1);
        keys.push((vk as i32, Box::leak(label.into_boxed_str())));
    }

    keys
}

#[cfg(target_os = "windows")]
fn monitored_mouse_buttons() -> Vec<(i32, &'static str)> {
    vec![(VK_LBUTTON as i32, "left"), (VK_RBUTTON as i32, "right"), (VK_MBUTTON as i32, "middle")]
}

#[cfg(target_os = "windows")]
fn optimize_mouse_path(raw: &[RecordedCursorPoint]) -> Vec<RecordedCursorPoint> {
    if raw.len() <= 2 {
        return raw.to_vec();
    }

    // 1) 去重与最小位移降采样
    let mut deduped = Vec::<RecordedCursorPoint>::new();
    for point in raw {
        let Some(last) = deduped.last() else {
            deduped.push(point.clone());
            continue;
        };

        let dx = point.x - last.x;
        let dy = point.y - last.y;
        let dt = point.timestamp_ms.saturating_sub(last.timestamp_ms);
        if dx == 0 && dy == 0 {
            continue;
        }
        if (dx * dx + dy * dy) < 4 && dt < 10 {
            continue;
        }
        deduped.push(point.clone());
    }

    if deduped.len() <= 2 {
        return deduped;
    }

    // 2) 适度平滑（3 点加权平均，保留首尾）
    let mut smoothed = deduped.clone();
    for index in 1..(deduped.len() - 1) {
        let prev = &deduped[index - 1];
        let curr = &deduped[index];
        let next = &deduped[index + 1];
        smoothed[index].x = ((prev.x as f64 * 0.2) + (curr.x as f64 * 0.6) + (next.x as f64 * 0.2)).round() as i32;
        smoothed[index].y = ((prev.y as f64 * 0.2) + (curr.y as f64 * 0.6) + (next.y as f64 * 0.2)).round() as i32;
    }

    // 3) 特征提取：保留起终点、转折点、长距离点
    let mut featured = HashSet::<usize>::new();
    featured.insert(0);
    featured.insert(smoothed.len() - 1);
    let mut last_feature = 0usize;
    for index in 1..(smoothed.len() - 1) {
        let prev = &smoothed[index - 1];
        let curr = &smoothed[index];
        let next = &smoothed[index + 1];
        let v1x = (curr.x - prev.x) as f64;
        let v1y = (curr.y - prev.y) as f64;
        let v2x = (next.x - curr.x) as f64;
        let v2y = (next.y - curr.y) as f64;
        let mag1 = (v1x * v1x + v1y * v1y).sqrt();
        let mag2 = (v2x * v2x + v2y * v2y).sqrt();
        let angle = if mag1 > 0.1 && mag2 > 0.1 {
            let dot = (v1x * v2x + v1y * v2y) / (mag1 * mag2);
            dot.clamp(-1.0, 1.0).acos().to_degrees()
        } else {
            0.0
        };
        let anchor = &smoothed[last_feature];
        let dist_from_anchor = (((curr.x - anchor.x).pow(2) + (curr.y - anchor.y).pow(2)) as f64).sqrt();
        if angle > 18.0 || dist_from_anchor >= 24.0 {
            featured.insert(index);
            last_feature = index;
        }
    }

    // 4) RDP 进一步压缩，同时保留特征点
    let simplified_indices = rdp_indices(&smoothed, 3.0);
    let mut merged = simplified_indices.into_iter().collect::<HashSet<_>>();
    merged.extend(featured);
    let mut ordered = merged.into_iter().collect::<Vec<_>>();
    ordered.sort_unstable();
    ordered.into_iter().map(|index| smoothed[index].clone()).collect()
}

#[cfg(target_os = "windows")]
fn rdp_indices(points: &[RecordedCursorPoint], epsilon: f64) -> Vec<usize> {
    fn recurse(points: &[RecordedCursorPoint], start: usize, end: usize, epsilon: f64, keep: &mut HashSet<usize>) {
        if end <= start + 1 {
            keep.insert(start);
            keep.insert(end);
            return;
        }

        let a = &points[start];
        let b = &points[end];
        let mut max_distance = -1.0;
        let mut max_index = start;

        for index in (start + 1)..end {
            let distance = perpendicular_distance(&points[index], a, b);
            if distance > max_distance {
                max_distance = distance;
                max_index = index;
            }
        }

        if max_distance > epsilon {
            recurse(points, start, max_index, epsilon, keep);
            recurse(points, max_index, end, epsilon, keep);
        } else {
            keep.insert(start);
            keep.insert(end);
        }
    }

    if points.len() <= 2 {
        return (0..points.len()).collect();
    }

    let mut keep = HashSet::<usize>::new();
    recurse(points, 0, points.len() - 1, epsilon, &mut keep);
    let mut ordered = keep.into_iter().collect::<Vec<_>>();
    ordered.sort_unstable();
    ordered
}

#[cfg(target_os = "windows")]
fn perpendicular_distance(point: &RecordedCursorPoint, line_start: &RecordedCursorPoint, line_end: &RecordedCursorPoint) -> f64 {
    let x0 = point.x as f64;
    let y0 = point.y as f64;
    let x1 = line_start.x as f64;
    let y1 = line_start.y as f64;
    let x2 = line_end.x as f64;
    let y2 = line_end.y as f64;

    let dx = x2 - x1;
    let dy = y2 - y1;
    if dx.abs() < f64::EPSILON && dy.abs() < f64::EPSILON {
        return ((x0 - x1).powi(2) + (y0 - y1).powi(2)).sqrt();
    }

    ((dy * x0 - dx * y0 + x2 * y1 - y2 * x1).abs()) / (dx * dx + dy * dy).sqrt()
}

#[cfg(target_os = "windows")]
fn path_distance(points: &[RecordedCursorPoint]) -> f64 {
    points
        .windows(2)
        .map(|pair| {
            let dx = (pair[1].x - pair[0].x) as f64;
            let dy = (pair[1].y - pair[0].y) as f64;
            (dx * dx + dy * dy).sqrt()
        })
        .sum()
}

#[cfg(target_os = "windows")]
fn flush_mouse_path(app: &AppHandle, actions: &mut Vec<InputRecordingAction>, buffer: &mut Vec<RecordedCursorPoint>) {
    if buffer.len() < 2 {
        buffer.clear();
        return;
    }

    let raw_count = buffer.len();
    let optimized = optimize_mouse_path(buffer);
    if optimized.len() < 2 {
        buffer.clear();
        return;
    }

    let duration_ms = optimized
        .last()
        .map(|point| point.timestamp_ms.saturating_sub(optimized[0].timestamp_ms))
        .unwrap_or(0);
    let distance_px = path_distance(&optimized);
    let timestamp_ms = optimized[0].timestamp_ms;
    push_action(
        app,
        actions,
        InputRecordingAction::MouseMovePath {
            points: optimized,
            duration_ms,
            distance_px,
            simplified_from: raw_count,
            timestamp_ms,
        },
    );
    buffer.clear();
}

#[cfg(target_os = "windows")]
async fn run_recording_loop(
    app: AppHandle,
    options: InputRecordingOptions,
    cancel_requested: Arc<AtomicBool>,
    started_at_ms: u64,
) -> Result<InputRecordingStopResult, String> {
    let mut actions = Vec::<InputRecordingAction>::new();
    let start_instant = Instant::now();
    let mut last_mouse_path = Vec::<RecordedCursorPoint>::new();
    let mut last_mouse_change_at = Instant::now();
    let mut mouse_wheel_hook = match start_mouse_wheel_hook() {
        Ok(hook) => Some(hook),
        Err(error) => {
            emit_log(&app, "warn", format!("鼠标滚轮录制初始化失败，将继续录制其它操作：{}", error), 0);
            None
        }
    };

    let ignored_keys = ["ScrollLock", "LAlt", "RAlt", "Alt"]
        .into_iter()
        .collect::<HashSet<_>>();

    let key_map = monitored_keys();
    let mouse_map = monitored_mouse_buttons();
    let mut key_states = HashMap::<i32, bool>::new();
    let mut mouse_states = HashMap::<i32, bool>::new();

    for (vk, _) in &key_map {
        key_states.insert(*vk, is_vk_pressed(*vk));
    }
    for (vk, _) in &mouse_map {
        mouse_states.insert(*vk, is_vk_pressed(*vk));
    }

    if options.record_mouse_moves {
        if let Ok((x, y)) = get_cursor() {
            last_mouse_path.push(RecordedCursorPoint {
                x,
                y,
                timestamp_ms: 0,
            });
        }
    }

    emit_log(&app, "info", "键鼠录制已开始，可使用 Scroll Lock 开始 / Alt+Scroll Lock 停止。".to_string(), 0);
    emit_state(&app, true, 0, Some(started_at_ms), options.clone());

    loop {
        if cancel_requested.load(Ordering::SeqCst) {
            break;
        }

        let elapsed_ms = start_instant.elapsed().as_millis() as u64;

        if options.record_keyboard {
            for (vk, key_name) in &key_map {
                let pressed = is_vk_pressed(*vk);
                let previous = key_states.get(vk).copied().unwrap_or(false);
                if pressed != previous {
                    key_states.insert(*vk, pressed);
                    if ignored_keys.contains(key_name) {
                        continue;
                    }
                    let action = if pressed {
                        InputRecordingAction::KeyDown {
                            key: (*key_name).to_string(),
                            timestamp_ms: elapsed_ms,
                        }
                    } else {
                        InputRecordingAction::KeyUp {
                            key: (*key_name).to_string(),
                            timestamp_ms: elapsed_ms,
                        }
                    };
                    push_action(&app, &mut actions, action);
                    emit_state(&app, true, actions.len(), Some(started_at_ms), options.clone());
                }
            }
        }

        if options.record_mouse_moves {
            let (x, y) = get_cursor()?;
            let changed = last_mouse_path
                .last()
                .map(|last| last.x != x || last.y != y)
                .unwrap_or(true);
            if changed {
                last_mouse_path.push(RecordedCursorPoint {
                    x,
                    y,
                    timestamp_ms: elapsed_ms,
                });
                last_mouse_change_at = Instant::now();
            } else if last_mouse_path.len() >= 2 && last_mouse_change_at.elapsed() >= Duration::from_millis(90) {
                flush_mouse_path(&app, &mut actions, &mut last_mouse_path);
                emit_state(&app, true, actions.len(), Some(started_at_ms), options.clone());
                last_mouse_change_at = Instant::now();
                last_mouse_path.push(RecordedCursorPoint {
                    x,
                    y,
                    timestamp_ms: elapsed_ms,
                });
            }
        }

        if let Some(hook) = mouse_wheel_hook.as_mut() {
            while let Ok(event) = hook.receiver.try_recv() {
                if options.record_mouse_moves {
                    flush_mouse_path(&app, &mut actions, &mut last_mouse_path);
                }

                let timestamp_ms = event.occurred_at.duration_since(start_instant).as_millis() as u64;
                push_action(
                    &app,
                    &mut actions,
                    InputRecordingAction::MouseWheel {
                        x: event.x,
                        y: event.y,
                        vertical: event.vertical,
                        timestamp_ms,
                    },
                );
                emit_state(&app, true, actions.len(), Some(started_at_ms), options.clone());
            }
        }

        if options.record_mouse_clicks {
            let (x, y) = get_cursor()?;
            for (vk, button_name) in &mouse_map {
                let pressed = is_vk_pressed(*vk);
                let previous = mouse_states.get(vk).copied().unwrap_or(false);
                if pressed != previous {
                    mouse_states.insert(*vk, pressed);
                    if options.record_mouse_moves {
                        flush_mouse_path(&app, &mut actions, &mut last_mouse_path);
                    }
                    let action = if pressed {
                        InputRecordingAction::MouseDown {
                            button: (*button_name).to_string(),
                            x,
                            y,
                            timestamp_ms: elapsed_ms,
                        }
                    } else {
                        InputRecordingAction::MouseUp {
                            button: (*button_name).to_string(),
                            x,
                            y,
                            timestamp_ms: elapsed_ms,
                        }
                    };
                    push_action(&app, &mut actions, action);
                    emit_state(&app, true, actions.len(), Some(started_at_ms), options.clone());
                }
            }
        }

        tokio::time::sleep(Duration::from_millis(8)).await;
    }

    if options.record_mouse_moves {
        flush_mouse_path(&app, &mut actions, &mut last_mouse_path);
    }

    let ended_at_ms = now_ms();
    emit_state(&app, false, actions.len(), Some(started_at_ms), options.clone());
    emit_log(
        &app,
        "success",
        format!("录制已停止，共保存 {} 个操作。", actions.len()),
        actions.len(),
    );

    Ok(InputRecordingStopResult {
        message: format!("录制完成，已保存 {} 个操作。", actions.len()),
        operation_count: actions.len(),
        actions,
        started_at_ms,
        ended_at_ms,
        options,
    })
}

pub async fn start_recording(app: AppHandle, options: InputRecordingOptions) -> Result<String, String> {
    #[cfg(not(target_os = "windows"))]
    {
        let _ = app;
        let _ = options;
        return Err("当前平台暂不支持键鼠录制。".to_string());
    }

    #[cfg(target_os = "windows")]
    {
        let started_at_ms = now_ms();
        let cancel_requested = Arc::new(AtomicBool::new(false));
        let (finished_tx, finished_rx) = oneshot::channel::<Result<InputRecordingStopResult, String>>();

        {
            let store = recorder_store();
            let mut guard = store.lock().map_err(|_| "录制状态锁已损坏。".to_string())?;
            if guard.is_some() {
                return Err("当前已有录制任务正在进行。".to_string());
            }
            *guard = Some(RecorderRunState {
                options: options.clone(),
                cancel_requested: cancel_requested.clone(),
                finished_rx,
                started_at_ms,
            });
        }

        let app_handle = app.clone();
        tokio::spawn(async move {
            let result = run_recording_loop(app_handle.clone(), options.clone(), cancel_requested, started_at_ms).await;
            if let Err(error) = &result {
                emit_state(&app_handle, false, 0, Some(started_at_ms), options.clone());
                emit_log(&app_handle, "error", format!("录制失败：{}", error), 0);
            }
            let _ = finished_tx.send(result);
        });

        Ok("已开始录制键鼠操作。".to_string())
    }
}

pub async fn stop_recording(app: AppHandle) -> Result<InputRecordingStopResult, String> {
    let state = {
        let store = recorder_store();
        let mut guard = store.lock().map_err(|_| "录制状态锁已损坏。".to_string())?;
        let Some(state) = guard.take() else {
            return Err("当前没有正在进行的录制任务。".to_string());
        };
        state.cancel_requested.store(true, Ordering::SeqCst);
        state
    };

    match state.finished_rx.await {
        Ok(result) => result,
        Err(_) => {
            emit_state(&app, false, 0, Some(state.started_at_ms), state.options);
            Err("录制任务异常中断。".to_string())
        }
    }
}

pub fn is_recording() -> bool {
    recorder_store()
        .lock()
        .ok()
        .and_then(|guard| guard.as_ref().map(|_| true))
        .unwrap_or(false)
}
