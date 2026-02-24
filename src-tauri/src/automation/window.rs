use crate::error::CommandResult;
use crate::error::CommandFlowError;

#[cfg(target_os = "windows")]
use windows_sys::Win32::Foundation::{BOOL, HWND, LPARAM};
#[cfg(target_os = "windows")]
use windows_sys::Win32::UI::WindowsAndMessaging::{
    EnumWindows, GetWindowTextLengthW, GetWindowTextW, IsIconic, IsWindowVisible,
    SetForegroundWindow, ShowWindow, SW_RESTORE,
};

#[cfg(target_os = "windows")]
#[derive(Debug)]
struct WindowEntry {
    hwnd: HWND,
    title: String,
}

#[cfg(target_os = "windows")]
fn enumerate_windows() -> Vec<WindowEntry> {
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

        let entries = &mut *(lparam as *mut Vec<WindowEntry>);
        if !entries.iter().any(|entry| entry.title == title) {
            entries.push(WindowEntry { hwnd, title });
        }

        1
    }

    let mut entries = Vec::<WindowEntry>::new();
    unsafe {
        EnumWindows(Some(enum_windows_proc), &mut entries as *mut Vec<WindowEntry> as LPARAM);
    }
    entries
}

pub fn list_open_window_titles() -> CommandResult<Vec<String>> {
    #[cfg(target_os = "windows")]
    {
        let titles = enumerate_windows()
            .into_iter()
            .map(|entry| entry.title)
            .collect::<Vec<_>>();
        return Ok(titles);
    }

    #[cfg(not(target_os = "windows"))]
    {
        Ok(vec![])
    }
}

pub fn window_title_exists(title: &str, match_mode: &str) -> CommandResult<bool> {
    #[cfg(target_os = "windows")]
    {
        let target = title.trim();
        if target.is_empty() {
            return Err(CommandFlowError::Validation("window title is empty".to_string()));
        }

        let target_lower = target.to_lowercase();
        let mode = match_mode.to_lowercase();

        let matched = enumerate_windows().into_iter().any(|entry| {
            let current = entry.title.to_lowercase();
            match mode.as_str() {
                "exact" => current == target_lower,
                _ => current.contains(&target_lower),
            }
        });

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

pub fn activate_window(title: &str) -> CommandResult<()> {
    #[cfg(target_os = "windows")]
    {
        let target = title.trim();
        if target.is_empty() {
            return Err(CommandFlowError::Validation("window title is empty".to_string()));
        }

        let target_lower = target.to_lowercase();
        let maybe_window = enumerate_windows()
            .into_iter()
            .find(|entry| entry.title.to_lowercase().contains(&target_lower));

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
                    "failed to switch to target window: {}",
                    window.title
                )));
            }
        }

        return Ok(());
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = title;
        Err(CommandFlowError::Automation(
            "window switching is only supported on Windows currently".to_string(),
        ))
    }
}
