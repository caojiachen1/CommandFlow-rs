use crate::error::{CommandFlowError, CommandResult};
use enigo::{Axis, Button, Coordinate, Direction, Enigo, Mouse, Settings};

fn parse_button(name: &str) -> Button {
    match name.to_lowercase().as_str() {
        "right" => Button::Right,
        "middle" => Button::Middle,
        _ => Button::Left,
    }
}

pub fn click(x: i32, y: i32, times: usize) -> CommandResult<bool> {
    let mut enigo = Enigo::new(&Settings::default()).map_err(|e| CommandFlowError::Automation(e.to_string()))?;
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
    let mut enigo = Enigo::new(&Settings::default()).map_err(|e| CommandFlowError::Automation(e.to_string()))?;
    enigo
        .move_mouse(x, y, Coordinate::Abs)
        .map_err(|e| CommandFlowError::Automation(e.to_string()))?;
    Ok(())
}

pub fn wheel(vertical: i32) -> CommandResult<()> {
    let mut enigo = Enigo::new(&Settings::default()).map_err(|e| CommandFlowError::Automation(e.to_string()))?;
    enigo
        .scroll(vertical, Axis::Vertical)
        .map_err(|e| CommandFlowError::Automation(e.to_string()))?;
    Ok(())
}

pub fn drag(from_x: i32, from_y: i32, to_x: i32, to_y: i32) -> CommandResult<()> {
    let mut enigo = Enigo::new(&Settings::default()).map_err(|e| CommandFlowError::Automation(e.to_string()))?;
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
    let mut enigo = Enigo::new(&Settings::default()).map_err(|e| CommandFlowError::Automation(e.to_string()))?;
    enigo
        .move_mouse(x, y, Coordinate::Abs)
        .map_err(|e| CommandFlowError::Automation(e.to_string()))?;
    enigo
        .button(parse_button(button), Direction::Press)
        .map_err(|e| CommandFlowError::Automation(e.to_string()))?;
    Ok(())
}

pub fn button_up(x: i32, y: i32, button: &str) -> CommandResult<()> {
    let mut enigo = Enigo::new(&Settings::default()).map_err(|e| CommandFlowError::Automation(e.to_string()))?;
    enigo
        .move_mouse(x, y, Coordinate::Abs)
        .map_err(|e| CommandFlowError::Automation(e.to_string()))?;
    enigo
        .button(parse_button(button), Direction::Release)
        .map_err(|e| CommandFlowError::Automation(e.to_string()))?;
    Ok(())
}
