use crate::error::{CommandFlowError, CommandResult};
use enigo::{Direction, Enigo, Key, Keyboard, Settings};
use tokio::time::{sleep, Duration, Instant};

#[cfg(target_os = "windows")]
use windows_sys::Win32::UI::Input::KeyboardAndMouse::{
    GetAsyncKeyState, VK_ADD, VK_BACK, VK_CONTROL, VK_DECIMAL, VK_DELETE, VK_DIVIDE, VK_DOWN,
    VK_END, VK_ESCAPE, VK_F1, VK_F10, VK_F11, VK_F12, VK_F13, VK_F14, VK_F15, VK_F16, VK_F17,
    VK_F18, VK_F19, VK_F2, VK_F20, VK_F21, VK_F22, VK_F23, VK_F24, VK_F3, VK_F4, VK_F5, VK_F6,
    VK_F7, VK_F8, VK_F9, VK_HOME, VK_LEFT, VK_LWIN, VK_MULTIPLY, VK_NEXT, VK_PRIOR, VK_RETURN,
    VK_RIGHT, VK_SHIFT, VK_SPACE, VK_SUBTRACT, VK_TAB, VK_UP, VK_MENU,
};

pub fn key_press(key: Key) -> CommandResult<()> {
    let mut enigo = Enigo::new(&Settings::default()).map_err(|e| CommandFlowError::Automation(e.to_string()))?;
    enigo
        .key(key, Direction::Click)
        .map_err(|e| CommandFlowError::Automation(e.to_string()))?;
    Ok(())
}

pub fn text_input(text: &str) -> CommandResult<()> {
    let mut enigo = Enigo::new(&Settings::default()).map_err(|e| CommandFlowError::Automation(e.to_string()))?;
    enigo
        .text(text)
        .map_err(|e| CommandFlowError::Automation(e.to_string()))?;
    Ok(())
}

pub fn key_tap_by_name(name: &str) -> CommandResult<()> {
    let key = parse_key(name);
    key_press(key)
}

pub fn shortcut(modifiers: &[String], key: &str) -> CommandResult<()> {
    let mut enigo = Enigo::new(&Settings::default()).map_err(|e| CommandFlowError::Automation(e.to_string()))?;
    for modifier in modifiers {
        enigo
            .key(parse_key(modifier), Direction::Press)
            .map_err(|e| CommandFlowError::Automation(e.to_string()))?;
    }

    enigo
        .key(parse_key(key), Direction::Click)
        .map_err(|e| CommandFlowError::Automation(e.to_string()))?;

    for modifier in modifiers.iter().rev() {
        enigo
            .key(parse_key(modifier), Direction::Release)
            .map_err(|e| CommandFlowError::Automation(e.to_string()))?;
    }

    Ok(())
}

pub async fn wait_for_hotkey(hotkey: &str, timeout_ms: u64, poll_ms: u64) -> CommandResult<()> {
    #[cfg(target_os = "windows")]
    {
        let spec = parse_hotkey(hotkey)?;
        let timeout = Duration::from_millis(timeout_ms);
        let interval = Duration::from_millis(poll_ms.max(10));
        let started = Instant::now();

        let mut seen_released = false;
        loop {
            let pressed = is_hotkey_pressed(&spec);
            if pressed && seen_released {
                return Ok(());
            }

            if !pressed {
                seen_released = true;
            }

            if started.elapsed() >= timeout {
                return Err(CommandFlowError::Automation(format!(
                    "hotkey trigger timed out after {} ms for '{}'",
                    timeout_ms, hotkey
                )));
            }

            sleep(interval).await;
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = hotkey;
        let _ = timeout_ms;
        let _ = poll_ms;
        Err(CommandFlowError::Automation(
            "hotkey trigger is only supported on Windows currently".to_string(),
        ))
    }
}

fn parse_key(name: &str) -> Key {
    match name.to_lowercase().as_str() {
        "enter" => Key::Return,
        "tab" => Key::Tab,
        "space" => Key::Space,
        "esc" | "escape" => Key::Escape,
        "backspace" => Key::Backspace,
        "delete" | "del" => Key::Delete,
        "up" => Key::UpArrow,
        "down" => Key::DownArrow,
        "left" => Key::LeftArrow,
        "right" => Key::RightArrow,
        "home" => Key::Home,
        "end" => Key::End,
        "pageup" => Key::PageUp,
        "pagedown" => Key::PageDown,
        "ctrl" | "control" => Key::Control,
        "shift" => Key::Shift,
        "alt" => Key::Alt,
        "meta" | "win" | "cmd" => Key::Meta,
        "f1" => Key::F1,
        "f2" => Key::F2,
        "f3" => Key::F3,
        "f4" => Key::F4,
        "f5" => Key::F5,
        "f6" => Key::F6,
        "f7" => Key::F7,
        "f8" => Key::F8,
        "f9" => Key::F9,
        "f10" => Key::F10,
        "f11" => Key::F11,
        "f12" => Key::F12,
        other => {
            let ch = other.chars().next().unwrap_or(' ');
            Key::Unicode(ch)
        }
    }
}

#[cfg(target_os = "windows")]
struct HotkeySpec {
    modifiers: Vec<u16>,
    main_key: u16,
}

#[cfg(target_os = "windows")]
fn parse_hotkey(hotkey: &str) -> CommandResult<HotkeySpec> {
    let tokens = hotkey
        .split('+')
        .map(|part| part.trim())
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>();

    if tokens.is_empty() {
        return Err(CommandFlowError::Validation(
            "hotkey cannot be empty".to_string(),
        ));
    }

    let mut modifiers = Vec::<u16>::new();
    let mut main_key = None;

    for token in tokens {
        let normalized = token.to_lowercase();
        let key = map_hotkey_token(&normalized).ok_or_else(|| {
            CommandFlowError::Validation(format!("unsupported hotkey token '{}': {}", token, hotkey))
        })?;

        let is_modifier = matches!(normalized.as_str(), "ctrl" | "control" | "shift" | "alt" | "win" | "meta" | "cmd");
        if is_modifier {
            modifiers.push(key);
        } else {
            if main_key.is_some() {
                return Err(CommandFlowError::Validation(format!(
                    "hotkey '{}' contains multiple primary keys",
                    hotkey
                )));
            }
            main_key = Some(key);
        }
    }

    let main_key = main_key.ok_or_else(|| {
        CommandFlowError::Validation(format!(
            "hotkey '{}' is missing a primary key (e.g. Ctrl+Shift+R)",
            hotkey
        ))
    })?;

    Ok(HotkeySpec {
        modifiers,
        main_key,
    })
}

#[cfg(target_os = "windows")]
fn map_hotkey_token(token: &str) -> Option<u16> {
    let key = match token {
        "ctrl" | "control" => VK_CONTROL,
        "shift" => VK_SHIFT,
        "alt" => VK_MENU,
        "win" | "meta" | "cmd" => VK_LWIN,
        "enter" => VK_RETURN,
        "tab" => VK_TAB,
        "space" => VK_SPACE,
        "esc" | "escape" => VK_ESCAPE,
        "backspace" => VK_BACK,
        "delete" | "del" => VK_DELETE,
        "up" => VK_UP,
        "down" => VK_DOWN,
        "left" => VK_LEFT,
        "right" => VK_RIGHT,
        "home" => VK_HOME,
        "end" => VK_END,
        "pageup" => VK_PRIOR,
        "pagedown" => VK_NEXT,
        "f1" => VK_F1,
        "f2" => VK_F2,
        "f3" => VK_F3,
        "f4" => VK_F4,
        "f5" => VK_F5,
        "f6" => VK_F6,
        "f7" => VK_F7,
        "f8" => VK_F8,
        "f9" => VK_F9,
        "f10" => VK_F10,
        "f11" => VK_F11,
        "f12" => VK_F12,
        "f13" => VK_F13,
        "f14" => VK_F14,
        "f15" => VK_F15,
        "f16" => VK_F16,
        "f17" => VK_F17,
        "f18" => VK_F18,
        "f19" => VK_F19,
        "f20" => VK_F20,
        "f21" => VK_F21,
        "f22" => VK_F22,
        "f23" => VK_F23,
        "f24" => VK_F24,
        "plus" => VK_ADD,
        "minus" => VK_SUBTRACT,
        "multiply" => VK_MULTIPLY,
        "divide" => VK_DIVIDE,
        "decimal" => VK_DECIMAL,
        _ => {
            if token.len() == 1 {
                let ch = token.chars().next()?;
                if ch.is_ascii_alphanumeric() {
                    ch.to_ascii_uppercase() as u16
                } else {
                    return None;
                }
            } else {
                return None;
            }
        }
    };

    Some(key)
}

#[cfg(target_os = "windows")]
fn is_hotkey_pressed(spec: &HotkeySpec) -> bool {
    spec.modifiers.iter().all(|vk| is_virtual_key_pressed(*vk))
        && is_virtual_key_pressed(spec.main_key)
}

#[cfg(target_os = "windows")]
fn is_virtual_key_pressed(vk: u16) -> bool {
    unsafe { (GetAsyncKeyState(vk as i32) as u16 & 0x8000) != 0 }
}
