use crate::error::{CommandFlowError, CommandResult};
use lnk_parser::LNKParser;
use serde::Serialize;
use std::cmp::Ordering;
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};

const EXECUTABLE_EXTENSIONS: &[&str] = &["exe", "com", "bat", "cmd"];

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StartMenuAppEntry {
    pub app_name: String,
    pub target_path: String,
    pub icon_path: String,
    pub source_path: String,
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
                    if let Some(name) = app_name
                        .map(str::trim)
                        .filter(|value| !value.is_empty())
                    {
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
        .then_with(|| left.source_path.to_ascii_lowercase().cmp(&right.source_path.to_ascii_lowercase()))
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

#[cfg(test)]
mod tests {
    use super::{compare_entries, is_valid_launch_target, normalize_path_key, StartMenuAppEntry};
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
}