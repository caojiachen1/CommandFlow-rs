use crate::error::CommandResult;
use crate::error::CommandFlowError;
use serde::Serialize;
use std::path::Path;

#[cfg(target_os = "windows")]
use windows_sys::Win32::Foundation::{BOOL, CloseHandle, HWND, LPARAM};
#[cfg(target_os = "windows")]
use windows_sys::Win32::System::Threading::{
    OpenProcess, QueryFullProcessImageNameW, PROCESS_QUERY_LIMITED_INFORMATION,
};
#[cfg(target_os = "windows")]
use windows_sys::Win32::UI::WindowsAndMessaging::{
    EnumWindows, GetClassNameW, GetForegroundWindow, GetWindowTextLengthW, GetWindowTextW,
    GetWindowThreadProcessId, IsIconic, IsWindowVisible, SetForegroundWindow, ShowWindow,
    SW_RESTORE,
};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenWindowEntry {
    pub title: String,
    pub program_name: String,
    pub program_path: String,
    pub class_name: String,
    pub process_id: u32,
}

#[derive(Debug, Clone)]
pub struct WindowMatchQuery {
    pub title: Option<String>,
    pub program: Option<String>,
    pub program_path: Option<String>,
    pub class_name: Option<String>,
    pub process_id: Option<u32>,
    pub match_mode: String,
}

impl WindowMatchQuery {
    pub fn new(match_mode: &str) -> Self {
        Self {
            title: None,
            program: None,
            program_path: None,
            class_name: None,
            process_id: None,
            match_mode: match_mode.trim().to_string(),
        }
    }
}

#[cfg(target_os = "windows")]
#[derive(Debug)]
struct WindowEntry {
    hwnd: HWND,
    title: String,
    program_name: String,
    program_path: String,
    class_name: String,
    process_id: u32,
}

#[cfg(target_os = "windows")]
fn to_public_window_entry(entry: WindowEntry) -> OpenWindowEntry {
    OpenWindowEntry {
        title: entry.title,
        program_name: entry.program_name,
        program_path: entry.program_path,
        class_name: entry.class_name,
        process_id: entry.process_id,
    }
}

#[cfg(target_os = "windows")]
fn read_window_process_id(hwnd: HWND) -> u32 {
    let mut process_id = 0u32;
    unsafe {
        GetWindowThreadProcessId(hwnd, &mut process_id as *mut u32);
    }
    process_id
}

#[cfg(target_os = "windows")]
fn read_window_process_path(hwnd: HWND) -> Option<String> {
    let process_id = read_window_process_id(hwnd);
    if process_id == 0 {
        return None;
    }

    let process_handle = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, process_id) };
    if process_handle.is_null() {
        return None;
    }

    let mut buffer = vec![0u16; 32_768];
    let mut length = buffer.len() as u32;
    let ok = unsafe { QueryFullProcessImageNameW(process_handle, 0, buffer.as_mut_ptr(), &mut length) };
    unsafe {
        CloseHandle(process_handle);
    }

    if ok == 0 || length == 0 {
        return None;
    }

    let path = String::from_utf16_lossy(&buffer[..length as usize])
        .trim()
        .to_string();
    if path.is_empty() {
        None
    } else {
        Some(path)
    }
}

#[cfg(target_os = "windows")]
fn read_window_class_name(hwnd: HWND) -> String {
    let mut buffer = vec![0u16; 512];
    let copied = unsafe { GetClassNameW(hwnd, buffer.as_mut_ptr(), buffer.len() as i32) };
    if copied <= 0 {
        return String::new();
    }

    String::from_utf16_lossy(&buffer[..copied as usize])
        .trim()
        .to_string()
}

#[cfg(target_os = "windows")]
fn read_window_process_name(hwnd: HWND) -> String {
    read_window_process_path(hwnd)
        .and_then(|path| {
            Path::new(&path)
                .file_name()
                .map(|name| name.to_string_lossy().trim().to_string())
                .filter(|name| !name.is_empty())
                .map(|name| (name, path))
        })
        .map(|(name, _)| name)
        .unwrap_or_default()
}

#[cfg(target_os = "windows")]
fn read_window_entry(hwnd: HWND) -> Option<WindowEntry> {
    let title = read_window_title(hwnd)?;
    let process_id = read_window_process_id(hwnd);
    let program_path = read_window_process_path(hwnd).unwrap_or_default();
    let program_name = if program_path.is_empty() {
        read_window_process_name(hwnd)
    } else {
        Path::new(&program_path)
            .file_name()
            .map(|name| name.to_string_lossy().trim().to_string())
            .filter(|name| !name.is_empty())
            .unwrap_or_default()
    };
    let class_name = read_window_class_name(hwnd);

    Some(WindowEntry {
        hwnd,
        title,
        program_name,
        program_path,
        class_name,
        process_id,
    })
}

#[cfg(target_os = "windows")]
fn enumerate_windows() -> Vec<WindowEntry> {
    unsafe extern "system" fn enum_windows_proc(hwnd: HWND, lparam: LPARAM) -> BOOL {
        if IsWindowVisible(hwnd) == 0 {
            return 1;
        }

        let Some(entry) = read_window_entry(hwnd) else {
            return 1;
        };

        let entries = &mut *(lparam as *mut Vec<WindowEntry>);
        entries.push(entry);

        1
    }

    let mut entries = Vec::<WindowEntry>::new();
    unsafe {
        EnumWindows(Some(enum_windows_proc), &mut entries as *mut Vec<WindowEntry> as LPARAM);
    }
    entries
}

#[cfg(target_os = "windows")]
fn read_window_title(hwnd: HWND) -> Option<String> {
    let len = unsafe { GetWindowTextLengthW(hwnd) };
    if len <= 0 {
        return None;
    }

    let mut buffer = vec![0u16; (len as usize) + 1];
    let copied = unsafe { GetWindowTextW(hwnd, buffer.as_mut_ptr(), buffer.len() as i32) };
    if copied <= 0 {
        return None;
    }

    let title = String::from_utf16_lossy(&buffer[..copied as usize])
        .trim()
        .to_string();
    if title.is_empty() {
        None
    } else {
        Some(title)
    }
}

#[cfg(target_os = "windows")]
fn read_foreground_window_entry() -> Option<WindowEntry> {
    let hwnd = unsafe { GetForegroundWindow() };
    if hwnd.is_null() {
        return None;
    }

    read_window_entry(hwnd)
}

fn match_text(candidate: &str, target: &str, match_mode: &str) -> bool {
    let candidate = candidate.trim().to_lowercase();
    let target = target.trim().to_lowercase();
    if candidate.is_empty() || target.is_empty() {
        return false;
    }

    match match_mode.trim().to_lowercase().as_str() {
        "exact" => candidate == target,
        _ => candidate.contains(&target),
    }
}

#[cfg(target_os = "windows")]
fn matches_program(entry: &WindowEntry, target: &str, match_mode: &str) -> bool {
    match_text(&entry.program_name, target, match_mode)
        || match_text(&entry.program_path, target, match_mode)
}

#[cfg(target_os = "windows")]
fn matches_query(entry: &WindowEntry, query: &WindowMatchQuery) -> bool {
    if let Some(title) = query.title.as_deref() {
        if !match_text(&entry.title, title, &query.match_mode) {
            return false;
        }
    }

    if let Some(program) = query.program.as_deref() {
        if !matches_program(entry, program, &query.match_mode) {
            return false;
        }
    }

    if let Some(program_path) = query.program_path.as_deref() {
        if !match_text(&entry.program_path, program_path, &query.match_mode) {
            return false;
        }
    }

    if let Some(class_name) = query.class_name.as_deref() {
        if !match_text(&entry.class_name, class_name, &query.match_mode) {
            return false;
        }
    }

    if let Some(process_id) = query.process_id {
        if entry.process_id != process_id {
            return false;
        }
    }

    true
}

fn validate_match_value(value: &str, field_label: &str) -> CommandResult<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        Err(CommandFlowError::Validation(format!(
            "window {} is empty",
            field_label
        )))
    } else {
        Ok(trimmed.to_string())
    }
}

pub fn list_open_window_entries() -> CommandResult<Vec<OpenWindowEntry>> {
    #[cfg(target_os = "windows")]
    {
        return Ok(enumerate_windows()
            .into_iter()
            .map(to_public_window_entry)
            .collect());
    }

    #[cfg(not(target_os = "windows"))]
    {
        Ok(vec![])
    }
}

pub fn list_open_window_titles() -> CommandResult<Vec<String>> {
    #[cfg(target_os = "windows")]
    {
        let mut titles = enumerate_windows()
            .into_iter()
            .map(|entry| entry.title)
            .collect::<Vec<_>>();
        titles.sort();
        titles.dedup();
        return Ok(titles);
    }

    #[cfg(not(target_os = "windows"))]
    {
        Ok(vec![])
    }
}

pub fn foreground_window_matches_title(
    title: &str,
    match_mode: &str,
) -> CommandResult<Option<OpenWindowEntry>> {
    #[cfg(target_os = "windows")]
    {
        let target = validate_match_value(title, "title")?;
        let matched = read_foreground_window_entry()
            .filter(|entry| match_text(&entry.title, &target, match_mode))
            .map(to_public_window_entry);
        return Ok(matched);
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = title;
        let _ = match_mode;
        Err(CommandFlowError::Automation(
            "window trigger is only supported on Windows currently".to_string(),
        ))
    }
}

pub fn foreground_window_matches_program(
    program: &str,
    match_mode: &str,
) -> CommandResult<Option<OpenWindowEntry>> {
    #[cfg(target_os = "windows")]
    {
        let target = validate_match_value(program, "program")?;
        let matched = read_foreground_window_entry()
            .filter(|entry| matches_program(entry, &target, match_mode))
            .map(to_public_window_entry);
        return Ok(matched);
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = program;
        let _ = match_mode;
        Err(CommandFlowError::Automation(
            "window trigger is only supported on Windows currently".to_string(),
        ))
    }
}

pub fn foreground_window_matches(query: &WindowMatchQuery) -> CommandResult<Option<OpenWindowEntry>> {
    #[cfg(target_os = "windows")]
    {
        let matched = read_foreground_window_entry()
            .filter(|entry| matches_query(entry, query))
            .map(to_public_window_entry);
        return Ok(matched);
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = query;
        Err(CommandFlowError::Automation(
            "window trigger is only supported on Windows currently".to_string(),
        ))
    }
}

pub fn window_title_exists(title: &str, match_mode: &str) -> CommandResult<bool> {
    foreground_window_matches_title(title, match_mode).map(|matched| matched.is_some())
}

pub fn window_program_exists(program: &str, match_mode: &str) -> CommandResult<bool> {
    foreground_window_matches_program(program, match_mode).map(|matched| matched.is_some())
}

pub fn activate_window_by_title(title: &str, match_mode: &str) -> CommandResult<OpenWindowEntry> {
    #[cfg(target_os = "windows")]
    {
        let target = validate_match_value(title, "title")?;
        let maybe_window = enumerate_windows()
            .into_iter()
            .find(|entry| match_text(&entry.title, &target, match_mode));

        let window = maybe_window.ok_or_else(|| {
            CommandFlowError::Automation(format!("cannot find open window matching title: {}", target))
        })?;

        unsafe {
            if IsIconic(window.hwnd) != 0 {
                ShowWindow(window.hwnd, SW_RESTORE);
            }
            let focused = SetForegroundWindow(window.hwnd);
            if focused == 0 {
                return Err(CommandFlowError::Automation(format!(
                    "failed to switch to target window: {} ({})",
                    window.title,
                    if window.program_name.is_empty() {
                        "unknown program".to_string()
                    } else {
                        window.program_name.clone()
                    }
                )));
            }
        }

        return Ok(to_public_window_entry(window));
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = title;
        let _ = match_mode;
        Err(CommandFlowError::Automation(
            "window switching is only supported on Windows currently".to_string(),
        ))
    }
}

pub fn activate_window_by_program(
    program: &str,
    match_mode: &str,
) -> CommandResult<OpenWindowEntry> {
    #[cfg(target_os = "windows")]
    {
        let target = validate_match_value(program, "program")?;
        let maybe_window = enumerate_windows()
            .into_iter()
            .find(|entry| matches_program(entry, &target, match_mode));

        let window = maybe_window.ok_or_else(|| {
            CommandFlowError::Automation(format!(
                "cannot find open window matching program: {}",
                target
            ))
        })?;

        unsafe {
            if IsIconic(window.hwnd) != 0 {
                ShowWindow(window.hwnd, SW_RESTORE);
            }
            let focused = SetForegroundWindow(window.hwnd);
            if focused == 0 {
                return Err(CommandFlowError::Automation(format!(
                    "failed to switch to target window: {} ({})",
                    window.title,
                    if window.program_name.is_empty() {
                        "unknown program".to_string()
                    } else {
                        window.program_name.clone()
                    }
                )));
            }
        }

        return Ok(to_public_window_entry(window));
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = program;
        let _ = match_mode;
        Err(CommandFlowError::Automation(
            "window switching is only supported on Windows currently".to_string(),
        ))
    }
}

pub fn activate_window(query: &WindowMatchQuery) -> CommandResult<OpenWindowEntry> {
    #[cfg(target_os = "windows")]
    {
        let maybe_window = enumerate_windows()
            .into_iter()
            .find(|entry| matches_query(entry, query));

        let window = maybe_window.ok_or_else(|| {
            CommandFlowError::Automation("cannot find open window matching current filters".to_string())
        })?;

        unsafe {
            if IsIconic(window.hwnd) != 0 {
                ShowWindow(window.hwnd, SW_RESTORE);
            }
            let focused = SetForegroundWindow(window.hwnd);
            if focused == 0 {
                return Err(CommandFlowError::Automation(format!(
                    "failed to switch to target window: {} ({})",
                    window.title,
                    if window.program_name.is_empty() {
                        "unknown program".to_string()
                    } else {
                        window.program_name.clone()
                    }
                )));
            }
        }

        return Ok(to_public_window_entry(window));
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = query;
        Err(CommandFlowError::Automation(
            "window switching is only supported on Windows currently".to_string(),
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::match_text;

    #[test]
    fn match_text_is_case_insensitive_for_contains() {
        assert!(match_text("Visual Studio Code", "studio", "contains"));
    }

    #[test]
    fn match_text_supports_exact_mode() {
        assert!(match_text("notepad.exe", "NOTEPAD.EXE", "exact"));
        assert!(!match_text("notepad++.exe", "notepad.exe", "exact"));
    }
}
