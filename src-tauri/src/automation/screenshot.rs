use crate::error::{CommandFlowError, CommandResult};
use image::{GrayImage, ImageBuffer, Luma, Rgba};
use std::fs;
use std::path::Path;
use std::sync::mpsc::{Receiver, RecvTimeoutError};
use std::thread;
use std::time::Duration;
use xcap::{Frame, Monitor, VideoRecorder};

const STREAM_START_RETRY: usize = 3;
const STREAM_START_RETRY_DELAY: Duration = Duration::from_millis(60);
const STREAM_STOP_SETTLE_DELAY: Duration = Duration::from_millis(80);

pub struct PrimaryFrameStream {
    recorder: VideoRecorder,
    receiver: Receiver<Frame>,
}

impl PrimaryFrameStream {
    pub fn recv_gray_timeout(&mut self, timeout: Duration) -> CommandResult<Option<GrayImage>> {
        match self.receiver.recv_timeout(timeout) {
            Ok(frame) => Ok(Some(frame_to_gray_image(&frame)?)),
            Err(RecvTimeoutError::Timeout) => Ok(None),
            Err(RecvTimeoutError::Disconnected) => Err(CommandFlowError::Automation(
                "xcap recv frame failed: stream disconnected".to_string(),
            )),
        }
    }
}

impl Drop for PrimaryFrameStream {
    fn drop(&mut self) {
        let _ = self.recorder.stop();
        thread::sleep(STREAM_STOP_SETTLE_DELAY);
    }
}

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
    let monitor = primary_monitor()?;
    let image = monitor
        .capture_image()
        .map_err(|error| CommandFlowError::Automation(error.to_string()))?;

    let width = image.width();
    let height = image.height();
    let rgba = image.into_raw();
    Ok((rgba, width, height))
}

pub fn capture_fullscreen_gray() -> CommandResult<GrayImage> {
    let (rgba, width, height) = capture_primary_rgba()?;
    let mut gray = vec![0u8; (width * height) as usize];

    for (idx, pixel) in rgba.chunks_exact(4).enumerate() {
        let r = pixel[0] as u32;
        let g = pixel[1] as u32;
        let b = pixel[2] as u32;
        let luma = ((77 * r + 150 * g + 29 * b) >> 8) as u8;
        gray[idx] = luma;
    }

    GrayImage::from_vec(width, height, gray).ok_or_else(|| {
        CommandFlowError::Automation("failed to build grayscale image from captured frame".to_string())
    })
}

pub fn start_primary_frame_stream() -> CommandResult<PrimaryFrameStream> {
    let mut last_error: Option<String> = None;

    for attempt in 1..=STREAM_START_RETRY {
        let monitor = primary_monitor()?;
        let stream = monitor
            .video_recorder()
            .map_err(|error| {
                CommandFlowError::Automation(format!(
                    "xcap video_recorder init failed (attempt {}): {}",
                    attempt, error
                ))
            });

        let (recorder, receiver) = match stream {
            Ok(v) => v,
            Err(error) => {
                last_error = Some(error.to_string());
                if attempt < STREAM_START_RETRY {
                    thread::sleep(STREAM_START_RETRY_DELAY);
                    continue;
                }
                break;
            }
        };

        match recorder.start() {
            Ok(()) => return Ok(PrimaryFrameStream { recorder, receiver }),
            Err(error) => {
                last_error = Some(format!(
                    "xcap recorder.start failed (attempt {}): {}",
                    attempt, error
                ));
                if attempt < STREAM_START_RETRY {
                    thread::sleep(STREAM_START_RETRY_DELAY);
                    continue;
                }
            }
        }
    }

    Err(CommandFlowError::Automation(format!(
        "failed to start xcap frame stream: {}",
        last_error.unwrap_or_else(|| "unknown error".to_string())
    )))
}

pub fn save_gray(path: &str, gray: &GrayImage) -> CommandResult<String> {
    ensure_output_parent(path)?;
    let width = gray.width();
    let height = gray.height();
    let buffer = gray.as_raw().clone();
    let image = ImageBuffer::<Luma<u8>, Vec<u8>>::from_vec(width, height, buffer)
        .ok_or_else(|| CommandFlowError::Automation("failed to build debug gray image".to_string()))?;
    image
        .save(path)
        .map_err(|error| CommandFlowError::Automation(error.to_string()))?;
    Ok(path.to_string())
}

pub fn save_gray_with_box(
    path: &str,
    gray: &GrayImage,
    rect: Option<(u32, u32, u32, u32)>,
    matched: bool,
) -> CommandResult<String> {
    ensure_output_parent(path)?;

    let mut rgb = image::RgbImage::new(gray.width(), gray.height());
    for (idx, pixel) in gray.as_raw().iter().enumerate() {
        let x = (idx as u32) % gray.width();
        let y = (idx as u32) / gray.width();
        rgb.put_pixel(x, y, image::Rgb([*pixel, *pixel, *pixel]));
    }

    if let Some((x, y, w, h)) = rect {
        let color = if matched {
            image::Rgb([0, 255, 0])
        } else {
            image::Rgb([255, 64, 64])
        };

        draw_rect_outline(&mut rgb, x, y, w, h, color);
    }

    rgb.save(path)
        .map_err(|error| CommandFlowError::Automation(error.to_string()))?;
    Ok(path.to_string())
}

fn draw_rect_outline(
    image: &mut image::RgbImage,
    x: u32,
    y: u32,
    width: u32,
    height: u32,
    color: image::Rgb<u8>,
) {
    if width == 0 || height == 0 || image.width() == 0 || image.height() == 0 {
        return;
    }

    let x2 = x.saturating_add(width.saturating_sub(1)).min(image.width() - 1);
    let y2 = y.saturating_add(height.saturating_sub(1)).min(image.height() - 1);

    for xx in x.min(image.width() - 1)..=x2 {
        image.put_pixel(xx, y.min(image.height() - 1), color);
        image.put_pixel(xx, y2, color);
    }

    for yy in y.min(image.height() - 1)..=y2 {
        image.put_pixel(x.min(image.width() - 1), yy, color);
        image.put_pixel(x2, yy, color);
    }
}

fn frame_to_gray_image(frame: &Frame) -> CommandResult<GrayImage> {
    if frame.width == 0 || frame.height == 0 {
        return Err(CommandFlowError::Automation(
            "xcap frame has invalid dimensions".to_string(),
        ));
    }

    let expected = (frame.width as usize)
        .checked_mul(frame.height as usize)
        .and_then(|v| v.checked_mul(4))
        .ok_or_else(|| CommandFlowError::Automation("xcap frame size overflow".to_string()))?;

    if frame.raw.len() < expected {
        return Err(CommandFlowError::Automation(
            "xcap frame raw buffer is smaller than expected".to_string(),
        ));
    }

    let mut gray = vec![0u8; (frame.width * frame.height) as usize];
    for (idx, pixel) in frame.raw[..expected].chunks_exact(4).enumerate() {
        let c0 = pixel[0] as u32;
        let c1 = pixel[1] as u32;
        let c2 = pixel[2] as u32;
        gray[idx] = ((c0 + c1 + c2) / 3) as u8;
    }

    GrayImage::from_vec(frame.width, frame.height, gray).ok_or_else(|| {
        CommandFlowError::Automation("failed to build grayscale image from xcap frame".to_string())
    })
}

fn primary_monitor() -> CommandResult<Monitor> {
    let monitors = Monitor::all().map_err(|error| CommandFlowError::Automation(error.to_string()))?;
    monitors
        .into_iter()
        .find(|monitor| monitor.is_primary().unwrap_or(false))
        .or_else(|| Monitor::from_point(0, 0).ok())
        .ok_or_else(|| CommandFlowError::Automation("failed to resolve primary monitor".to_string()))
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
    let monitor = primary_monitor()?;
    let monitor_width = monitor
        .width()
        .map_err(|error| CommandFlowError::Automation(error.to_string()))?;
    let monitor_height = monitor
        .height()
        .map_err(|error| CommandFlowError::Automation(error.to_string()))?;

    let target_width = width.min(monitor_width);
    let target_height = height.min(monitor_height);

    if target_width == 0 || target_height == 0 {
        return Err(CommandFlowError::Automation(
            "invalid capture size for region screenshot".to_string(),
        ));
    }

    let region_image = monitor
        .capture_region(0, 0, target_width, target_height)
        .map_err(|error| CommandFlowError::Automation(error.to_string()))?;
    let region_rgba = region_image.into_raw();

    save_rgba(path, region_rgba, target_width, target_height)
}

pub fn capture_fullscreen(path: &str) -> CommandResult<String> {
    let (rgba, width, height) = capture_primary_rgba()?;
    save_rgba(path, rgba, width, height)
}
