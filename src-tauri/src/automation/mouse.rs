use crate::error::{CommandFlowError, CommandResult};
use enigo::{Axis, Button, Coordinate, Direction, Enigo, Mouse, Settings};

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
