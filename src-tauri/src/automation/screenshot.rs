use crate::error::{CommandFlowError, CommandResult};
use image::{ImageBuffer, Rgba};
use scrap::{Capturer, Display};
use std::fs;
use std::io::ErrorKind;
use std::path::Path;
use std::thread;
use std::time::Duration;

const CAPTURE_RETRY_MAX: usize = 80;
const CAPTURE_RETRY_INTERVAL: Duration = Duration::from_millis(25);

fn ensure_output_parent(path: &str) -> CommandResult<()> {
    let output_path = Path::new(path);
    if let Some(parent) = output_path.parent() {
        if !parent.as_os_str().is_empty() {
            fs::create_dir_all(parent)
                .map_err(|error| CommandFlowError::Io(error.to_string()))?;
        }
    }
    Ok(())
}

fn capture_primary_rgba() -> CommandResult<(Vec<u8>, u32, u32)> {
    let display =
        Display::primary().map_err(|error| CommandFlowError::Automation(error.to_string()))?;
    let width = display.width();
    let height = display.height();

    if width == 0 || height == 0 {
        return Err(CommandFlowError::Automation(
            "failed to resolve primary display size".to_string(),
        ));
    }

    let mut capturer =
        Capturer::new(display).map_err(|error| CommandFlowError::Automation(error.to_string()))?;

    for _ in 0..CAPTURE_RETRY_MAX {
        match capturer.frame() {
            Ok(frame) => {
                let width_u32 = width as u32;
                let height_u32 = height as u32;
                let stride = frame.len() / height;
                let row_bytes = width * 4;
                if stride < row_bytes {
                    return Err(CommandFlowError::Automation(
                        "captured frame has invalid stride".to_string(),
                    ));
                }
                let mut rgba = vec![0u8; width * height * 4];

                for y in 0..height {
                    let src_row_start = y * stride;
                    let src_row_end = src_row_start + row_bytes;
                    let src_row = &frame[src_row_start..src_row_end];
                    let dst_row_start = y * row_bytes;

                    for x in 0..width {
                        let src_idx = x * 4;
                        let dst_idx = dst_row_start + x * 4;

                        let b = src_row[src_idx];
                        let g = src_row[src_idx + 1];
                        let r = src_row[src_idx + 2];

                        rgba[dst_idx] = r;
                        rgba[dst_idx + 1] = g;
                        rgba[dst_idx + 2] = b;
                        rgba[dst_idx + 3] = 255;
                    }
                }

                return Ok((rgba, width_u32, height_u32));
            }
            Err(error) if error.kind() == ErrorKind::WouldBlock => {
                thread::sleep(CAPTURE_RETRY_INTERVAL);
            }
            Err(error) => {
                return Err(CommandFlowError::Automation(error.to_string()));
            }
        }
    }

    Err(CommandFlowError::Automation(
        "screen capture timeout while waiting for frame".to_string(),
    ))
}

fn save_rgba(path: &str, rgba: Vec<u8>, width: u32, height: u32) -> CommandResult<String> {
    ensure_output_parent(path)?;
    let img =
        ImageBuffer::<Rgba<u8>, Vec<u8>>::from_vec(width, height, rgba).ok_or_else(|| {
            CommandFlowError::Automation("failed to build image from captured frame".to_string())
        })?;
    img.save(path)
        .map_err(|error| CommandFlowError::Automation(error.to_string()))?;
    Ok(path.to_string())
}

pub fn capture_region(path: &str, width: u32, height: u32) -> CommandResult<String> {
    let (screen_rgba, screen_width, screen_height) = capture_primary_rgba()?;
    let target_width = width.min(screen_width);
    let target_height = height.min(screen_height);

    if target_width == 0 || target_height == 0 {
        return Err(CommandFlowError::Automation(
            "invalid capture size for region screenshot".to_string(),
        ));
    }

    let src_stride = (screen_width * 4) as usize;
    let dst_stride = (target_width * 4) as usize;
    let mut region_rgba = vec![0u8; (target_width * target_height * 4) as usize];

    for y in 0..target_height as usize {
        let src_start = y * src_stride;
        let src_end = src_start + dst_stride;
        let dst_start = y * dst_stride;
        let dst_end = dst_start + dst_stride;
        region_rgba[dst_start..dst_end].copy_from_slice(&screen_rgba[src_start..src_end]);
    }

    save_rgba(path, region_rgba, target_width, target_height)
}

pub fn capture_fullscreen(path: &str) -> CommandResult<String> {
    let (rgba, width, height) = capture_primary_rgba()?;
    save_rgba(path, rgba, width, height)
}
