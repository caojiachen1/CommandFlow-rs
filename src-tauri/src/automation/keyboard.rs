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
