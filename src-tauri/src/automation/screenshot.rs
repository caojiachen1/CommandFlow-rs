use crate::error::{CommandFlowError, CommandResult};
use image::{ImageBuffer, Rgba};

pub fn capture_region(path: &str, width: u32, height: u32) -> CommandResult<String> {
    let img = ImageBuffer::<Rgba<u8>, Vec<u8>>::from_fn(width, height, |_, _| Rgba([0, 0, 0, 255]));
    img.save(path)
        .map_err(|error| CommandFlowError::Automation(error.to_string()))?;
    Ok(path.to_string())
}
