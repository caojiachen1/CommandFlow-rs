use crate::error::{CommandFlowError, CommandResult};
use enigo::{Axis, Button, Coordinate, Direction, Enigo, Mouse, Settings};

#[cfg(target_os = "windows")]
use windows_sys::Win32::UI::Input::KeyboardAndMouse::{
    SendInput, INPUT, INPUT_0, INPUT_MOUSE, MOUSEEVENTF_HWHEEL, MOUSEEVENTF_WHEEL, MOUSEINPUT,
};
#[cfg(target_os = "windows")]
use windows_sys::Win32::Foundation::POINT;
#[cfg(target_os = "windows")]
use windows_sys::Win32::UI::WindowsAndMessaging::GetCursorPos;

fn parse_button(name: &str) -> Button {
    match name.to_lowercase().as_str() {
        "right" => Button::Right,
        "middle" => Button::Middle,
        _ => Button::Left,
    }
}

pub fn cursor_position() -> CommandResult<(i32, i32)> {
    #[cfg(target_os = "windows")]
    {
        let mut point: POINT = unsafe { std::mem::zeroed() };
        let ok = unsafe { GetCursorPos(&mut point as *mut POINT) };
        if ok == 0 {
            return Err(CommandFlowError::Automation(
                "获取当前鼠标坐标失败。".to_string(),
            ));
        }

        Ok((point.x, point.y))
    }

    #[cfg(not(target_os = "windows"))]
    {
        Err(CommandFlowError::Automation(
            "当前平台尚未支持系统级鼠标坐标读取。".to_string(),
        ))
    }
}

pub fn click(x: i32, y: i32, times: usize) -> CommandResult<bool> {
    let mut enigo = Enigo::new(&Settings::default())
        .map_err(|e| CommandFlowError::Automation(e.to_string()))?;
    enigo
        .move_mouse(x, y, Coordinate::Abs)
        .map_err(|e| CommandFlowError::Automation(e.to_string()))?;

    for _ in 0..times {
        enigo
            .button(Button::Left, Direction::Click)
            .map_err(|e| CommandFlowError::Automation(e.to_string()))?;
    }

    Ok(true)
}

pub fn move_to(x: i32, y: i32) -> CommandResult<()> {
    let mut enigo = Enigo::new(&Settings::default())
        .map_err(|e| CommandFlowError::Automation(e.to_string()))?;
    enigo
        .move_mouse(x, y, Coordinate::Abs)
        .map_err(|e| CommandFlowError::Automation(e.to_string()))?;
    Ok(())
}

pub fn wheel(vertical: i32) -> CommandResult<()> {
    let mut enigo = Enigo::new(&Settings::default())
        .map_err(|e| CommandFlowError::Automation(e.to_string()))?;
    enigo
        .scroll(vertical, Axis::Vertical)
        .map_err(|e| CommandFlowError::Automation(e.to_string()))?;
    Ok(())
}

pub fn wheel_at(x: i32, y: i32, vertical: i32) -> CommandResult<()> {
    let mut enigo = Enigo::new(&Settings::default())
        .map_err(|e| CommandFlowError::Automation(e.to_string()))?;
    enigo
        .move_mouse(x, y, Coordinate::Abs)
        .map_err(|e| CommandFlowError::Automation(e.to_string()))?;
    enigo
        .scroll(vertical, Axis::Vertical)
        .map_err(|e| CommandFlowError::Automation(e.to_string()))?;
    Ok(())
}

#[cfg(target_os = "windows")]
fn send_native_wheel_delta(delta: i32, horizontal: bool) -> CommandResult<()> {
    let mut input = INPUT {
        r#type: INPUT_MOUSE,
        Anonymous: INPUT_0 {
            mi: MOUSEINPUT {
                dx: 0,
                dy: 0,
                mouseData: delta as u32,
                dwFlags: if horizontal {
                    MOUSEEVENTF_HWHEEL
                } else {
                    MOUSEEVENTF_WHEEL
                },
                time: 0,
                dwExtraInfo: 0,
            },
        },
    };

    let sent = unsafe {
        SendInput(
            1,
            &mut input as *mut INPUT,
            std::mem::size_of::<INPUT>() as i32,
        )
    };
    if sent == 0 {
        return Err(CommandFlowError::Automation(format!(
            "发送原生滚轮输入失败：{}",
            std::io::Error::last_os_error()
        )));
    }

    Ok(())
}

#[cfg(not(target_os = "windows"))]
fn send_native_wheel_delta(delta: i32, horizontal: bool) -> CommandResult<()> {
    let mut enigo = Enigo::new(&Settings::default())
        .map_err(|e| CommandFlowError::Automation(e.to_string()))?;
    enigo
        .scroll(
            delta,
            if horizontal {
                Axis::Horizontal
            } else {
                Axis::Vertical
            },
        )
        .map_err(|e| CommandFlowError::Automation(e.to_string()))?;
    Ok(())
}

pub fn wheel_exact(vertical_delta: i32) -> CommandResult<()> {
    send_native_wheel_delta(vertical_delta, false)
}

pub fn wheel_exact_at(x: i32, y: i32, vertical_delta: i32) -> CommandResult<()> {
    move_to(x, y)?;
    wheel_exact(vertical_delta)
}

pub fn wheel_horizontal_exact(horizontal_delta: i32) -> CommandResult<()> {
    send_native_wheel_delta(horizontal_delta, true)
}

pub fn wheel_horizontal(horizontal: i32) -> CommandResult<()> {
    let mut enigo = Enigo::new(&Settings::default())
        .map_err(|e| CommandFlowError::Automation(e.to_string()))?;
    enigo
        .scroll(horizontal, Axis::Horizontal)
        .map_err(|e| CommandFlowError::Automation(e.to_string()))?;
    Ok(())
}

pub fn drag(from_x: i32, from_y: i32, to_x: i32, to_y: i32) -> CommandResult<()> {
    let mut enigo = Enigo::new(&Settings::default())
        .map_err(|e| CommandFlowError::Automation(e.to_string()))?;
    enigo
        .move_mouse(from_x, from_y, Coordinate::Abs)
        .map_err(|e| CommandFlowError::Automation(e.to_string()))?;
    enigo
        .button(Button::Left, Direction::Press)
        .map_err(|e| CommandFlowError::Automation(e.to_string()))?;
    enigo
        .move_mouse(to_x, to_y, Coordinate::Abs)
        .map_err(|e| CommandFlowError::Automation(e.to_string()))?;
    enigo
        .button(Button::Left, Direction::Release)
        .map_err(|e| CommandFlowError::Automation(e.to_string()))?;
    Ok(())
}

pub fn button_down(x: i32, y: i32, button: &str) -> CommandResult<()> {
    let mut enigo = Enigo::new(&Settings::default())
        .map_err(|e| CommandFlowError::Automation(e.to_string()))?;
    enigo
        .move_mouse(x, y, Coordinate::Abs)
        .map_err(|e| CommandFlowError::Automation(e.to_string()))?;
    enigo
        .button(parse_button(button), Direction::Press)
        .map_err(|e| CommandFlowError::Automation(e.to_string()))?;
    Ok(())
}

pub fn button_up(x: i32, y: i32, button: &str) -> CommandResult<()> {
    let mut enigo = Enigo::new(&Settings::default())
        .map_err(|e| CommandFlowError::Automation(e.to_string()))?;
    enigo
        .move_mouse(x, y, Coordinate::Abs)
        .map_err(|e| CommandFlowError::Automation(e.to_string()))?;
    enigo
        .button(parse_button(button), Direction::Release)
        .map_err(|e| CommandFlowError::Automation(e.to_string()))?;
    Ok(())
}
