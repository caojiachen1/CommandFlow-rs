use crate::automation::screenshot::encode_rgba_to_png_base64;
use crate::error::{CommandFlowError, CommandResult};
use image::ImageReader;
use lnk_parser::LNKParser;
use serde::Serialize;
use std::cmp::Ordering;
use std::fs;
use std::path::{Component, Path, PathBuf};

#[cfg(target_os = "windows")]
use std::ffi::OsStr;
#[cfg(target_os = "windows")]
use std::os::windows::ffi::OsStrExt;
#[cfg(target_os = "windows")]
use std::ptr;
#[cfg(target_os = "windows")]
use std::slice;
#[cfg(target_os = "windows")]
use windows_sys::Win32::Graphics::Gdi::{
    CreateCompatibleDC, CreateDIBSection, DeleteDC, DeleteObject, SelectObject, BITMAPINFO,
    BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS, RGBQUAD,
};
#[cfg(target_os = "windows")]
use windows_sys::Win32::UI::Shell::{ExtractIconExW, ShellExecuteW, SHGetFileInfoW, SHFILEINFOW, SHGFI_ICON, SHGFI_LARGEICON};
#[cfg(target_os = "windows")]
use windows_sys::Win32::UI::WindowsAndMessaging::{DestroyIcon, DrawIconEx, PrivateExtractIconsW, HICON, DI_NORMAL, SW_SHOWNORMAL};

const EXECUTABLE_EXTENSIONS: &[&str] = &["exe", "com", "bat", "cmd"];
const DIRECT_IMAGE_EXTENSIONS: &[&str] = &["png", "jpg", "jpeg", "bmp", "webp", "ico"];
const ICON_RESOURCE_EXTENSIONS: &[&str] = &["exe", "dll", "ico", "icl", "cpl", "scr"];
const EXTRACTED_ICON_SIZE: i32 = 256;
const ICON_RENDER_FALLBACK_SIZES: &[i32] = &[128, 64, 48, 32, 24, 16];

fn icon_debug(_message: impl AsRef<str>) {
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StartMenuAppEntry {
    pub app_name: String,
    pub target_path: String,
    pub icon_path: String,
    pub source_path: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct IconLocation {
    path: String,
    index: i32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ApplicationLaunchMode {
    Auto,
    Direct,
    Shell,
}

impl ApplicationLaunchMode {
    pub fn from_param(raw: &str) -> Self {
        match raw.trim().to_ascii_lowercase().as_str() {
            "direct" => Self::Direct,
            "shell" | "shellapi" | "shell_api" => Self::Shell,
            _ => Self::Auto,
        }
    }
}

pub fn scan_start_menu_apps() -> CommandResult<Vec<StartMenuAppEntry>> {
    if !cfg!(target_os = "windows") {
        return Ok(Vec::new());
    }

    let mut entries = Vec::new();
    for root in start_menu_roots() {
        collect_start_menu_entries(&root, &mut entries);
    }

    entries.sort_by(compare_entries);

    Ok(entries)
}

pub fn resolve_launch_application_entry(
    target_path: &str,
    source_path: Option<&str>,
    app_name: Option<&str>,
    icon_path: Option<&str>,
) -> CommandResult<StartMenuAppEntry> {
    if let Some(source_path) = source_path.and_then(sanitize_path_string) {
        let source = PathBuf::from(&source_path);
        if source.is_file() && is_shortcut_file(&source) {
            if let Some(mut parsed) = parse_shortcut_entry(&source) {
                if parsed.app_name.trim().is_empty() {
                    if let Some(name) = app_name.map(str::trim).filter(|value| !value.is_empty()) {
                        parsed.app_name = name.to_string();
                    }
                }

                if parsed.icon_path.trim().is_empty() {
                    parsed.icon_path = icon_path
                        .and_then(sanitize_optional_metadata)
                        .unwrap_or_default();
                }

                if parsed.target_path.trim().is_empty() {
                    parsed.target_path = sanitize_path_string(target_path).unwrap_or_default();
                }

                return Ok(parsed);
            }

            let sanitized_target = sanitize_path_string(target_path).unwrap_or_default();
            let app_name = app_name
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(ToOwned::to_owned)
                .or_else(|| derive_name_from_source_or_target(&source_path, &sanitized_target))
                .unwrap_or_else(|| source_path.clone());

            return Ok(StartMenuAppEntry {
                app_name,
                target_path: sanitized_target,
                icon_path: icon_path
                    .and_then(sanitize_optional_metadata)
                    .unwrap_or_default(),
                source_path,
            });
        }
    }

    if let Some(target_path) = sanitize_path_string(target_path) {
        let target = PathBuf::from(&target_path);
        if is_valid_launch_target(&target) {
            let source = source_path
                .and_then(sanitize_path_string)
                .unwrap_or_default();
            let app_name = app_name
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(ToOwned::to_owned)
                .or_else(|| derive_name_from_source_or_target(&source, &target_path))
                .unwrap_or_else(|| target_path.clone());

            return Ok(StartMenuAppEntry {
                app_name,
                target_path,
                icon_path: icon_path
                    .and_then(sanitize_optional_metadata)
                    .unwrap_or_default(),
                source_path: source,
            });
        }
    }

    if let Some(source_path) = source_path.and_then(sanitize_path_string) {
        let source = PathBuf::from(&source_path);
        if source.is_file() {
            if let Some(mut parsed) = parse_shortcut_entry(&source) {
                if parsed.app_name.trim().is_empty() {
                    if let Some(name) = app_name.map(str::trim).filter(|value| !value.is_empty()) {
                        parsed.app_name = name.to_string();
                    }
                }

                if parsed.icon_path.trim().is_empty() {
                    parsed.icon_path = icon_path
                        .and_then(sanitize_optional_metadata)
                        .unwrap_or_default();
                }

                return Ok(parsed);
            }
        }
    }

    Err(CommandFlowError::Validation(
        "未找到可启动的应用目标，请重新选择开始菜单中的有效应用。".to_string(),
    ))
}

pub fn launch_application(
    entry: &StartMenuAppEntry,
    mode: ApplicationLaunchMode,
) -> CommandResult<Option<u32>> {
    #[cfg(target_os = "windows")]
    {
        if mode == ApplicationLaunchMode::Shell {
            let shell_path = resolve_shell_launch_path(entry)?;
            open_path_via_shell_execute(&shell_path)?;
            return Ok(None);
        }

        let source_path = PathBuf::from(&entry.source_path);
        if mode == ApplicationLaunchMode::Auto && should_launch_shortcut_via_shell(entry, &source_path) {
            open_path_via_shell_execute(&source_path)?;
            return Ok(None);
        }
    }

    let target_path = PathBuf::from(&entry.target_path);
    if !is_valid_launch_target(&target_path) {
        let reason = if mode == ApplicationLaunchMode::Direct {
            "当前启动方式为直接启动，请改为自动或 Shell API 启动。"
        } else {
            ""
        };
        return Err(CommandFlowError::Validation(format!(
            "应用目标不可执行或不存在：{}{}{}",
            entry.target_path,
            if reason.is_empty() { "" } else { "；" },
            reason
        )));
    }

    let extension = target_path
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.to_ascii_lowercase())
        .unwrap_or_default();

    let mut command = if extension == "bat" || extension == "cmd" {
        let mut cmd = std::process::Command::new("cmd");
        cmd.arg("/C").arg(&entry.target_path);
        cmd
    } else {
        std::process::Command::new(&entry.target_path)
    };

    let child = command.spawn().map_err(|error| {
        CommandFlowError::Automation(format!(
            "启动应用失败 '{}': {}",
            entry.target_path, error
        ))
    })?;

    Ok(Some(child.id()))
}

#[cfg(target_os = "windows")]
fn resolve_shell_launch_path(entry: &StartMenuAppEntry) -> CommandResult<PathBuf> {
    let source_path = PathBuf::from(&entry.source_path);
    if source_path.is_file() {
        return Ok(source_path);
    }

    let target_path = PathBuf::from(&entry.target_path);
    if target_path.is_file() {
        return Ok(target_path);
    }

    Err(CommandFlowError::Validation(format!(
        "未找到可通过 Shell API 启动的应用路径：{}",
        entry.app_name
    )))
}

#[cfg(target_os = "windows")]
fn should_launch_shortcut_via_shell(entry: &StartMenuAppEntry, source_path: &Path) -> bool {
    if !(source_path.is_file() && is_shortcut_file(source_path)) {
        return false;
    }

    let target_path = PathBuf::from(&entry.target_path);
    !is_valid_launch_target(&target_path)
}

pub fn resolve_app_icon_data_url(
    icon_path: Option<&str>,
    target_path: Option<&str>,
    source_path: Option<&str>,
) -> CommandResult<Option<String>> {
    #[cfg(target_os = "windows")]
    {
        icon_debug(format!(
            "resolve start: icon_path={:?}, target_path={:?}, source_path={:?}",
            icon_path, target_path, source_path
        ));
        for location in icon_candidates(icon_path, target_path, source_path) {
            icon_debug(format!(
                "trying candidate path='{}', index={}",
                location.path, location.index
            ));
            if let Some(data_url) = load_icon_location_data_url(&location)? {
                icon_debug(format!(
                    "resolved icon for path='{}', index={} (data url length={})",
                    location.path,
                    location.index,
                    data_url.len()
                ));
                return Ok(Some(data_url));
            }
        }

        icon_debug("all icon resolution attempts failed; returning None");

        Ok(None)
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = (icon_path, target_path, source_path);
        Ok(None)
    }
}

fn start_menu_roots() -> Vec<PathBuf> {
    let mut roots = Vec::new();

    if let Some(program_data) = std::env::var_os("PROGRAMDATA") {
        roots.push(
            PathBuf::from(program_data)
                .join("Microsoft")
                .join("Windows")
                .join("Start Menu")
                .join("Programs"),
        );
    }

    if let Some(app_data) = std::env::var_os("APPDATA") {
        roots.push(
            PathBuf::from(app_data)
                .join("Microsoft")
                .join("Windows")
                .join("Start Menu")
                .join("Programs"),
        );
    }

    roots
}

fn collect_start_menu_entries(dir: &Path, entries: &mut Vec<StartMenuAppEntry>) {
    let Ok(children) = fs::read_dir(dir) else {
        return;
    };

    for child in children.flatten() {
        let path = child.path();

        if path.is_dir() {
            collect_start_menu_entries(&path, entries);
            continue;
        }

        if !is_shortcut_file(&path) {
            continue;
        }

        if let Some(entry) = parse_shortcut_entry(&path) {
            entries.push(entry);
        }
    }
}

fn is_shortcut_file(path: &Path) -> bool {
    path.extension()
        .and_then(|value| value.to_str())
        .map(|value| value.eq_ignore_ascii_case("lnk"))
        .unwrap_or(false)
}

fn parse_shortcut_entry(path: &Path) -> Option<StartMenuAppEntry> {
    let parser = LNKParser::from_path(path.to_str()?).ok()?;

    let target_path = parser
        .get_target_full_path()
        .as_deref()
        .and_then(sanitize_path_string)
        .unwrap_or_default();

    let source_path = normalize_display_path(path);
    let app_name = path
        .file_stem()
        .and_then(|value| value.to_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)?;

    let icon_path = parser
        .get_icon_location()
        .as_ref()
        .and_then(|value| sanitize_optional_metadata(&value.string))
        .unwrap_or_default();

    Some(StartMenuAppEntry {
        app_name,
        target_path,
        icon_path,
        source_path,
    })
}

fn sanitize_path_string(raw: &str) -> Option<String> {
    let trimmed = raw.trim().trim_matches('"').trim();
    if trimmed.is_empty() {
        return None;
    }

    Some(trimmed.trim_start_matches(r"\\?\").to_string())
}

fn sanitize_optional_metadata(raw: &str) -> Option<String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

fn normalize_display_path(path: &Path) -> String {
    match fs::canonicalize(path) {
        Ok(value) => value.to_string_lossy().replace(r"\\?\", ""),
        Err(_) => path.to_string_lossy().replace(r"\\?\", ""),
    }
}

fn is_valid_launch_target(path: &Path) -> bool {
    if !path.exists() || !path.is_file() {
        return false;
    }

    path.extension()
        .and_then(|value| value.to_str())
        .map(|value| EXECUTABLE_EXTENSIONS.iter().any(|ext| value.eq_ignore_ascii_case(ext)))
        .unwrap_or(false)
}

#[cfg(test)]
fn normalize_path_key(path: &str) -> String {
    path.trim()
        .trim_matches('"')
        .trim_start_matches(r"\\?\")
        .replace('/', "\\")
        .to_ascii_lowercase()
}

fn compare_entries(left: &StartMenuAppEntry, right: &StartMenuAppEntry) -> Ordering {
    left.app_name
        .to_ascii_lowercase()
        .cmp(&right.app_name.to_ascii_lowercase())
        .then_with(|| source_depth(&right.source_path).cmp(&source_depth(&left.source_path)))
        .then_with(|| {
            left.source_path
                .to_ascii_lowercase()
                .cmp(&right.source_path.to_ascii_lowercase())
        })
}

fn source_depth(path: &str) -> usize {
    Path::new(path).components().count()
}

fn derive_name_from_source_or_target(source_path: &str, target_path: &str) -> Option<String> {
    let source_name = Path::new(source_path)
        .file_stem()
        .and_then(|value| value.to_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned);

    source_name.or_else(|| {
        Path::new(target_path)
            .file_stem()
            .and_then(|value| value.to_str())
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(ToOwned::to_owned)
    })
}

fn normalize_icon_path(raw: &str) -> String {
    let trimmed = raw.trim().trim_matches('"').trim();
    if trimmed.is_empty() {
        return String::new();
    }

    let normalized = trimmed.trim_start_matches(r"\\?\");
    let mut result = String::with_capacity(normalized.len());
    let mut previous_is_separator = false;

    for component in Path::new(normalized).components() {
        match component {
            Component::Prefix(prefix) => {
                result.push_str(&prefix.as_os_str().to_string_lossy());
                previous_is_separator = false;
            }
            Component::RootDir => {
                if !result.ends_with('\\') {
                    result.push('\\');
                }
                previous_is_separator = true;
            }
            _ => {
                if !result.is_empty() && !previous_is_separator {
                    result.push('\\');
                }
                result.push_str(&component.as_os_str().to_string_lossy());
                previous_is_separator = false;
            }
        }
    }

    if result.is_empty() {
        normalized.to_string()
    } else {
        result
    }
}

fn parse_icon_location(raw: &str) -> Option<IconLocation> {
    let trimmed = raw.trim().trim_matches('"').trim();
    if trimmed.is_empty() {
        return None;
    }

    if let Some((path, index)) = trimmed.rsplit_once(',') {
        if let Ok(icon_index) = index.trim().parse::<i32>() {
            let normalized_path = normalize_icon_path(path);
            if !normalized_path.is_empty() {
                return Some(IconLocation {
                    path: normalized_path,
                    index: icon_index,
                });
            }
        }
    }

    let normalized_path = normalize_icon_path(trimmed);
    if normalized_path.is_empty() {
        None
    } else {
        Some(IconLocation {
            path: normalized_path,
            index: 0,
        })
    }
}

fn push_icon_candidate(candidates: &mut Vec<IconLocation>, raw: Option<&str>) {
    let Some(raw) = raw else {
        return;
    };

    let Some(location) = parse_icon_location(raw) else {
        return;
    };

    if !candidates.iter().any(|item| item == &location) {
        candidates.push(location);
    }
}

fn icon_candidates(
    icon_path: Option<&str>,
    target_path: Option<&str>,
    source_path: Option<&str>,
) -> Vec<IconLocation> {
    let mut candidates = Vec::new();
    push_icon_candidate(&mut candidates, icon_path);
    push_icon_candidate(&mut candidates, target_path);
    push_icon_candidate(&mut candidates, source_path);
    candidates
}

fn is_direct_image_extension(path: &Path) -> bool {
    path.extension()
        .and_then(|value| value.to_str())
        .map(|value| DIRECT_IMAGE_EXTENSIONS.iter().any(|ext| value.eq_ignore_ascii_case(ext)))
        .unwrap_or(false)
}

fn is_icon_resource_extension(path: &Path) -> bool {
    path.extension()
        .and_then(|value| value.to_str())
        .map(|value| ICON_RESOURCE_EXTENSIONS.iter().any(|ext| value.eq_ignore_ascii_case(ext)))
        .unwrap_or(false)
}

fn rgba_to_png_data_url(rgba: &[u8], width: u32, height: u32) -> CommandResult<Option<String>> {
    let base64 = encode_rgba_to_png_base64(rgba, width, height)?;
    Ok(Some(format!("data:image/png;base64,{}", base64)))
}

fn load_image_file_data_url(path: &Path) -> CommandResult<Option<String>> {
    if !path.exists() || !path.is_file() {
        icon_debug(format!("image file missing: {}", path.display()));
        return Ok(None);
    }

    let reader = match ImageReader::open(path) {
        Ok(reader) => reader,
        Err(error) => {
            icon_debug(format!("failed to open image file '{}': {}", path.display(), error));
            return Ok(None);
        }
    };

    let decoded = match reader.decode() {
        Ok(image) => image,
        Err(error) => {
            icon_debug(format!("failed to decode image file '{}': {}", path.display(), error));
            return Ok(None);
        }
    };

    let rgba = decoded.to_rgba8();
    icon_debug(format!(
        "loaded direct image icon '{}' at {}x{}",
        path.display(),
        rgba.width(),
        rgba.height()
    ));
    rgba_to_png_data_url(rgba.as_raw(), rgba.width(), rgba.height())
}

#[cfg(target_os = "windows")]
fn open_path_via_shell_execute(path: &Path) -> CommandResult<()> {
    if !path.exists() || !path.is_file() {
        return Err(CommandFlowError::Validation(format!(
            "应用快捷方式不存在：{}",
            path.display()
        )));
    }

    let operation = to_wide_null("open");
    let file = to_wide_null(&path.to_string_lossy());
    let result = unsafe {
        ShellExecuteW(
            ptr::null_mut(),
            operation.as_ptr(),
            file.as_ptr(),
            ptr::null(),
            ptr::null(),
            SW_SHOWNORMAL,
        )
    };

    if result as usize <= 32 {
        return Err(CommandFlowError::Automation(format!(
            "通过 Windows Shell 打开快捷方式失败：{}（code={}）",
            path.display(),
            result as isize
        )));
    }

    Ok(())
}

#[cfg(target_os = "windows")]
fn to_wide_null(value: &str) -> Vec<u16> {
    OsStr::new(value)
        .encode_wide()
        .chain(std::iter::once(0))
        .collect()
}

#[cfg(target_os = "windows")]
fn extract_high_resolution_icon_data_url(path: &Path, index: i32) -> CommandResult<Option<String>> {
    if !path.exists() || !path.is_file() {
        icon_debug(format!("high-resolution extract skipped; file missing: {}", path.display()));
        return Ok(None);
    }

    let wide_path = to_wide_null(&path.to_string_lossy());
    let mut icon_handle: HICON = ptr::null_mut();
    let mut icon_id = 0u32;
    let extracted = unsafe {
        PrivateExtractIconsW(
            wide_path.as_ptr(),
            index,
            EXTRACTED_ICON_SIZE,
            EXTRACTED_ICON_SIZE,
            &mut icon_handle,
            &mut icon_id,
            1,
            0,
        )
    };

    if extracted == 0 || icon_handle.is_null() {
        icon_debug(format!(
            "PrivateExtractIconsW failed for '{}' index={} (count={}, icon_id={})",
            path.display(),
            index,
            extracted,
            icon_id
        ));
        return Ok(None);
    }

    icon_debug(format!(
        "PrivateExtractIconsW succeeded for '{}' index={} at requested {}px",
        path.display(),
        index,
        EXTRACTED_ICON_SIZE
    ));

    let result = hicon_to_png_data_url(icon_handle, EXTRACTED_ICON_SIZE);
    unsafe {
        DestroyIcon(icon_handle);
    }
    result
}

#[cfg(target_os = "windows")]
fn extract_icon_resource_data_url(path: &Path, index: i32) -> CommandResult<Option<String>> {
    if !path.exists() || !path.is_file() {
        icon_debug(format!("resource extract skipped; file missing: {}", path.display()));
        return Ok(None);
    }

    if let Some(data_url) = extract_high_resolution_icon_data_url(path, index)? {
        return Ok(Some(data_url));
    }

    let wide_path = to_wide_null(&path.to_string_lossy());
    let mut large_icons: [HICON; 1] = [ptr::null_mut(); 1];
    let extracted = unsafe {
        ExtractIconExW(
            wide_path.as_ptr(),
            index,
            large_icons.as_mut_ptr(),
            ptr::null_mut(),
            1,
        )
    };

    if extracted == 0 || large_icons[0].is_null() {
        icon_debug(format!(
            "ExtractIconExW failed for '{}' index={} (count={})",
            path.display(),
            index,
            extracted
        ));
        return Ok(None);
    }

    icon_debug(format!(
        "ExtractIconExW succeeded for '{}' index={} (fallback path)",
        path.display(),
        index
    ));

    let icon_handle = large_icons[0];
    let result = hicon_to_png_data_url(icon_handle, EXTRACTED_ICON_SIZE);
    unsafe {
        DestroyIcon(icon_handle);
    }
    result
}

#[cfg(target_os = "windows")]
fn extract_associated_icon_data_url(path: &Path) -> CommandResult<Option<String>> {
    if !path.exists() {
        icon_debug(format!("associated icon extract skipped; file missing: {}", path.display()));
        return Ok(None);
    }

    if let Some(data_url) = extract_high_resolution_icon_data_url(path, 0)? {
        icon_debug(format!(
            "associated high-resolution icon resolved from '{}' via PrivateExtractIconsW",
            path.display()
        ));
        return Ok(Some(data_url));
    }

    let wide_path = to_wide_null(&path.to_string_lossy());
    let mut file_info = unsafe { std::mem::zeroed::<SHFILEINFOW>() };
    let result = unsafe {
        SHGetFileInfoW(
            wide_path.as_ptr(),
            0,
            &mut file_info,
            std::mem::size_of::<SHFILEINFOW>() as u32,
            SHGFI_ICON | SHGFI_LARGEICON,
        )
    };

    if result == 0 || file_info.hIcon.is_null() {
        icon_debug(format!("SHGetFileInfoW failed for '{}'", path.display()));
        return Ok(None);
    }

    icon_debug(format!("SHGetFileInfoW succeeded for '{}'", path.display()));

    let icon_handle = file_info.hIcon;
    let data_url = hicon_to_png_data_url(icon_handle, EXTRACTED_ICON_SIZE);
    unsafe {
        DestroyIcon(icon_handle);
    }
    data_url
}

#[cfg(target_os = "windows")]
fn hicon_to_png_data_url(icon_handle: HICON, size: i32) -> CommandResult<Option<String>> {
    if icon_handle.is_null() || size <= 0 {
        icon_debug(format!("hicon_to_png_data_url received invalid input (size={})", size));
        return Ok(None);
    }

    if let Some(data_url) = render_hicon_to_png_data_url(icon_handle, size)? {
        return Ok(Some(data_url));
    }

    for fallback_size in ICON_RENDER_FALLBACK_SIZES {
        if *fallback_size >= size {
            continue;
        }

        if let Some(data_url) = render_hicon_to_png_data_url(icon_handle, *fallback_size)? {
            icon_debug(format!(
                "icon render recovered with fallback size {} (requested {})",
                fallback_size, size
            ));
            return Ok(Some(data_url));
        }
    }

    icon_debug(format!(
        "DrawIconEx failed or produced empty bitmap for all attempted sizes (requested {})",
        size
    ));
    Ok(None)
}

#[cfg(target_os = "windows")]
fn render_hicon_to_png_data_url(icon_handle: HICON, size: i32) -> CommandResult<Option<String>> {
    if icon_handle.is_null() || size <= 0 {
        return Ok(None);
    }

    let dc = unsafe { CreateCompatibleDC(ptr::null_mut()) };
    if dc.is_null() {
        icon_debug("CreateCompatibleDC failed");
        return Ok(None);
    }

    let mut bits = ptr::null_mut();
    let mut bitmap_info = BITMAPINFO {
        bmiHeader: BITMAPINFOHEADER {
            biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
            biWidth: size,
            biHeight: -size,
            biPlanes: 1,
            biBitCount: 32,
            biCompression: BI_RGB,
            biSizeImage: 0,
            biXPelsPerMeter: 0,
            biYPelsPerMeter: 0,
            biClrUsed: 0,
            biClrImportant: 0,
        },
        bmiColors: [RGBQUAD {
            rgbBlue: 0,
            rgbGreen: 0,
            rgbRed: 0,
            rgbReserved: 0,
        }],
    };

    let bitmap = unsafe {
        CreateDIBSection(
            dc,
            &mut bitmap_info,
            DIB_RGB_COLORS,
            &mut bits,
            ptr::null_mut(),
            0,
        )
    };
    if bitmap.is_null() || bits.is_null() {
        icon_debug("CreateDIBSection failed");
        unsafe {
            DeleteDC(dc);
        }
        return Ok(None);
    }

    let previous = unsafe { SelectObject(dc, bitmap as _) };
    let byte_len = (size as usize) * (size as usize) * 4;
    unsafe {
        slice::from_raw_parts_mut(bits as *mut u8, byte_len).fill(0);
    }

    let drawn = unsafe { DrawIconEx(dc, 0, 0, icon_handle, size, size, 0, ptr::null_mut(), DI_NORMAL) };
    let bgra = if drawn != 0 {
        unsafe { slice::from_raw_parts(bits as *const u8, byte_len).to_vec() }
    } else {
        Vec::new()
    };

    unsafe {
        SelectObject(dc, previous);
        DeleteObject(bitmap as _);
        DeleteDC(dc);
    }

    if drawn == 0 {
        icon_debug(format!("DrawIconEx failed at size {}", size));
        return Ok(None);
    }

    if bgra.is_empty() {
        icon_debug(format!("DrawIconEx produced no bitmap data at size {}", size));
        return Ok(None);
    }

    if !bitmap_has_visible_pixels(&bgra) {
        icon_debug(format!("DrawIconEx produced a fully transparent bitmap at size {}", size));
        return Ok(None);
    }

    let mut rgba = bgra;
    for chunk in rgba.chunks_exact_mut(4) {
        chunk.swap(0, 2);
    }

    rgba_to_png_data_url(&rgba, size as u32, size as u32)
}

fn bitmap_has_visible_pixels(bgra: &[u8]) -> bool {
    bgra.chunks_exact(4)
        .any(|pixel| pixel[0] != 0 || pixel[1] != 0 || pixel[2] != 0 || pixel[3] != 0)
}

fn load_icon_location_data_url(location: &IconLocation) -> CommandResult<Option<String>> {
    let path = Path::new(&location.path);

    if is_direct_image_extension(path) {
        icon_debug(format!("attempting direct image load for '{}'", path.display()));
        if let Some(data_url) = load_image_file_data_url(path)? {
            return Ok(Some(data_url));
        }
    }

    #[cfg(target_os = "windows")]
    {
        if is_icon_resource_extension(path) {
            icon_debug(format!(
                "attempting icon resource extraction for '{}' index={}",
                path.display(),
                location.index
            ));
            if let Some(data_url) = extract_icon_resource_data_url(path, location.index)? {
                return Ok(Some(data_url));
            }
        }

        icon_debug(format!("attempting associated icon fallback for '{}'", path.display()));
        if let Some(data_url) = extract_associated_icon_data_url(path)? {
            return Ok(Some(data_url));
        }
    }

    icon_debug(format!("no icon data resolved for '{}'", path.display()));
    Ok(None)
}

#[cfg(test)]
mod tests {
    use super::{
        bitmap_has_visible_pixels, compare_entries, is_valid_launch_target,
        normalize_path_key, parse_icon_location, resolve_launch_application_entry,
        ApplicationLaunchMode, StartMenuAppEntry,
    };
    use std::fs;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn unique_temp_path(file_name: &str) -> PathBuf {
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock")
            .as_nanos();
        std::env::temp_dir().join(format!("commandflow-start-menu-test-{}-{}", stamp, file_name))
    }

    #[test]
    fn normalizes_path_keys_case_insensitively() {
        let left = normalize_path_key(r#"\\?\C:\Program Files\App\APP.EXE"#);
        let right = normalize_path_key(r#"c:/program files/app/app.exe"#);
        assert_eq!(left, right);
    }

    #[test]
    fn rejects_non_executable_extension_even_if_file_exists() {
        let path = unique_temp_path("readme.txt");
        fs::write(&path, b"hello").expect("create test file");
        assert!(!is_valid_launch_target(&path));
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn accepts_existing_executable_like_file() {
        let path = unique_temp_path("demo.exe");
        fs::write(&path, b"MZ").expect("create test file");
        assert!(is_valid_launch_target(&path));
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn resolves_existing_shortcut_even_without_valid_target() {
        let path = unique_temp_path("demo.lnk");
        fs::write(&path, b"not-a-real-shortcut").expect("create test shortcut placeholder");

        let entry = resolve_launch_application_entry("", path.to_str(), Some("Demo Shortcut"), None)
            .expect("resolve shortcut entry");

        assert_eq!(entry.app_name, "Demo Shortcut");
        assert!(entry.target_path.is_empty());
        assert!(entry.source_path.ends_with("demo.lnk"));

        let _ = fs::remove_file(&path);
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn shortcut_with_direct_executable_target_prefers_direct_launch_path() {
        let shortcut = unique_temp_path("direct-demo.lnk");
        let executable = unique_temp_path("direct-demo.exe");
        fs::write(&shortcut, b"shortcut-placeholder").expect("create test shortcut placeholder");
        fs::write(&executable, b"MZ").expect("create test executable placeholder");

        let entry = StartMenuAppEntry {
            app_name: "Direct Demo".to_string(),
            target_path: executable.to_string_lossy().into_owned(),
            icon_path: String::new(),
            source_path: shortcut.to_string_lossy().into_owned(),
        };

        assert!(!super::should_launch_shortcut_via_shell(&entry, &shortcut));

        let _ = fs::remove_file(&shortcut);
        let _ = fs::remove_file(&executable);
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn shortcut_without_direct_executable_target_uses_shell_fallback() {
        let shortcut = unique_temp_path("shell-demo.lnk");
        fs::write(&shortcut, b"shortcut-placeholder").expect("create test shortcut placeholder");

        let entry = StartMenuAppEntry {
            app_name: "Shell Demo".to_string(),
            target_path: String::new(),
            icon_path: String::new(),
            source_path: shortcut.to_string_lossy().into_owned(),
        };

        assert!(super::should_launch_shortcut_via_shell(&entry, &shortcut));

        let _ = fs::remove_file(&shortcut);
    }

    #[test]
    fn compare_prefers_deeper_source_path_when_names_match() {
        let shallow = StartMenuAppEntry {
            app_name: "App".to_string(),
            target_path: r"C:\App\app.exe".to_string(),
            icon_path: String::new(),
            source_path: r"C:\ProgramData\Microsoft\Windows\Start Menu\Programs\App.lnk".to_string(),
        };
        let deep = StartMenuAppEntry {
            app_name: "App".to_string(),
            target_path: r"C:\App\app.exe".to_string(),
            icon_path: String::new(),
            source_path: r"C:\ProgramData\Microsoft\Windows\Start Menu\Programs\Tools\Utilities\App.lnk".to_string(),
        };

        assert_eq!(compare_entries(&deep, &shallow), std::cmp::Ordering::Less);
    }

    #[test]
    fn parses_icon_location_with_index() {
        let parsed = parse_icon_location(r#"C:\Program Files\App\app.exe,3"#).expect("icon location");
        assert_eq!(parsed.path, r#"C:\Program Files\App\app.exe"#);
        assert_eq!(parsed.index, 3);
    }

    #[test]
    fn parses_icon_location_without_index() {
        let parsed = parse_icon_location(r#"\\?\C:\Icons\app.ico"#).expect("icon location");
        assert!(parsed.path.ends_with(r#"C:\Icons\app.ico"#));
        assert_eq!(parsed.index, 0);
    }

    #[test]
    fn detects_fully_transparent_bitmap_as_empty() {
        let pixels = vec![0u8; 16];
        assert!(!bitmap_has_visible_pixels(&pixels));
    }

    #[test]
    fn detects_non_empty_bitmap_pixels() {
        let pixels = vec![0u8, 0u8, 0u8, 0u8, 0u8, 0u8, 0u8, 255u8];
        assert!(bitmap_has_visible_pixels(&pixels));
    }

    #[test]
    fn parses_launch_mode_from_params() {
        assert_eq!(ApplicationLaunchMode::from_param("auto"), ApplicationLaunchMode::Auto);
        assert_eq!(ApplicationLaunchMode::from_param("direct"), ApplicationLaunchMode::Direct);
        assert_eq!(ApplicationLaunchMode::from_param("shell"), ApplicationLaunchMode::Shell);
        assert_eq!(ApplicationLaunchMode::from_param("shell_api"), ApplicationLaunchMode::Shell);
        assert_eq!(ApplicationLaunchMode::from_param("unknown"), ApplicationLaunchMode::Auto);
    }
}