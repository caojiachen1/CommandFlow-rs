use crate::automation::screenshot::encode_rgba_to_png_base64;
use crate::error::{CommandFlowError, CommandResult};
use image::ImageReader;
use lnk_parser::LNKParser;
use serde::Serialize;
use std::cmp::Ordering;
use std::collections::HashSet;
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
use windows_sys::Win32::UI::Shell::{ExtractIconExW, SHGetFileInfoW, SHFILEINFOW, SHGFI_ICON, SHGFI_LARGEICON};
#[cfg(target_os = "windows")]
use windows_sys::Win32::UI::WindowsAndMessaging::{DestroyIcon, DrawIconEx, HICON, DI_NORMAL};

const EXECUTABLE_EXTENSIONS: &[&str] = &["exe", "com", "bat", "cmd"];
const DIRECT_IMAGE_EXTENSIONS: &[&str] = &["png", "jpg", "jpeg", "bmp", "webp", "ico"];
const ICON_RESOURCE_EXTENSIONS: &[&str] = &["exe", "dll", "ico", "icl", "cpl", "scr"];
const EXTRACTED_ICON_SIZE: i32 = 64;

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

pub fn scan_start_menu_apps() -> CommandResult<Vec<StartMenuAppEntry>> {
    if !cfg!(target_os = "windows") {
        return Ok(Vec::new());
    }

    let mut entries = Vec::new();
    for root in start_menu_roots() {
        collect_start_menu_entries(&root, &mut entries);
    }

    entries.sort_by(compare_entries);

    let mut deduped = Vec::new();
    let mut seen_targets = HashSet::new();
    for entry in entries {
        let key = normalize_path_key(&entry.target_path);
        if seen_targets.insert(key) {
            deduped.push(entry);
        }
    }

    Ok(deduped)
}

pub fn resolve_launch_application_entry(
    target_path: &str,
    source_path: Option<&str>,
    app_name: Option<&str>,
    icon_path: Option<&str>,
) -> CommandResult<StartMenuAppEntry> {
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

pub fn launch_application(entry: &StartMenuAppEntry) -> CommandResult<Option<u32>> {
    let target_path = PathBuf::from(&entry.target_path);
    if !is_valid_launch_target(&target_path) {
        return Err(CommandFlowError::Validation(format!(
            "应用目标不可执行或不存在：{}",
            entry.target_path
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

pub fn resolve_app_icon_data_url(
    icon_path: Option<&str>,
    target_path: Option<&str>,
    source_path: Option<&str>,
) -> CommandResult<Option<String>> {
    #[cfg(target_os = "windows")]
    {
        for location in icon_candidates(icon_path, target_path, source_path) {
            if let Some(data_url) = load_icon_location_data_url(&location)? {
                return Ok(Some(data_url));
            }
        }

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

    let target_path = sanitize_path_string(parser.get_target_full_path().as_deref()?)?;
    let target = PathBuf::from(&target_path);
    if !is_valid_launch_target(&target) {
        return None;
    }

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
        return Ok(None);
    }

    let reader = match ImageReader::open(path) {
        Ok(reader) => reader,
        Err(_) => return Ok(None),
    };

    let decoded = match reader.decode() {
        Ok(image) => image,
        Err(_) => return Ok(None),
    };

    let rgba = decoded.to_rgba8();
    rgba_to_png_data_url(rgba.as_raw(), rgba.width(), rgba.height())
}

#[cfg(target_os = "windows")]
fn to_wide_null(value: &str) -> Vec<u16> {
    OsStr::new(value)
        .encode_wide()
        .chain(std::iter::once(0))
        .collect()
}

#[cfg(target_os = "windows")]
fn extract_icon_resource_data_url(path: &Path, index: i32) -> CommandResult<Option<String>> {
    if !path.exists() || !path.is_file() {
        return Ok(None);
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
        return Ok(None);
    }

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
        return Ok(None);
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
        return Ok(None);
    }

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
        return Ok(None);
    }

    let dc = unsafe { CreateCompatibleDC(ptr::null_mut()) };
    if dc.is_null() {
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

    if drawn == 0 || bgra.is_empty() {
        return Ok(None);
    }

    let mut rgba = bgra;
    for chunk in rgba.chunks_exact_mut(4) {
        chunk.swap(0, 2);
    }

    rgba_to_png_data_url(&rgba, size as u32, size as u32)
}

fn load_icon_location_data_url(location: &IconLocation) -> CommandResult<Option<String>> {
    let path = Path::new(&location.path);

    if is_direct_image_extension(path) {
        if let Some(data_url) = load_image_file_data_url(path)? {
            return Ok(Some(data_url));
        }
    }

    #[cfg(target_os = "windows")]
    {
        if is_icon_resource_extension(path) {
            if let Some(data_url) = extract_icon_resource_data_url(path, location.index)? {
                return Ok(Some(data_url));
            }
        }

        if let Some(data_url) = extract_associated_icon_data_url(path)? {
            return Ok(Some(data_url));
        }
    }

    Ok(None)
}

#[cfg(test)]
mod tests {
    use super::{
        compare_entries, is_valid_launch_target, normalize_path_key, parse_icon_location,
        StartMenuAppEntry,
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
}