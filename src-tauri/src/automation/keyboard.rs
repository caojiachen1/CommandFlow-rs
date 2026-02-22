use crate::error::{CommandFlowError, CommandResult};
use enigo::{Direction, Enigo, Key, Keyboard, Settings};

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
