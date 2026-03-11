use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

const SETTINGS_KEY_LLM_PRESETS: &str = "llm_presets.v1";
const SETTINGS_KEY_INPUT_RECORDING_PRESETS: &str = "input_recording_presets.v1";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LlmPreset {
    pub id: String,
    pub name: String,
    pub base_url: String,
    pub api_key: String,
    pub model: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InputRecordingOptions {
    pub record_keyboard: bool,
    pub record_mouse_clicks: bool,
    pub record_mouse_moves: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordedCursorPoint {
    pub x: i32,
    pub y: i32,
    pub timestamp_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum InputRecordingAction {
    KeyDown {
        key: String,
        timestamp_ms: u64,
    },
    KeyUp {
        key: String,
        timestamp_ms: u64,
    },
    MouseDown {
        button: String,
        x: i32,
        y: i32,
        timestamp_ms: u64,
    },
    MouseUp {
        button: String,
        x: i32,
        y: i32,
        timestamp_ms: u64,
    },
    MouseMovePath {
        points: Vec<RecordedCursorPoint>,
        duration_ms: u64,
        distance_px: f64,
        simplified_from: usize,
        timestamp_ms: u64,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InputRecordingPreset {
    pub id: String,
    pub name: String,
    pub options: InputRecordingOptions,
    pub actions: Vec<InputRecordingAction>,
    pub updated_at: u64,
}

fn now_millis() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|it| it.as_millis())
        .unwrap_or(0)
}

fn default_preset() -> LlmPreset {
    LlmPreset {
        id: format!("preset-{}", now_millis()),
        name: "默认 OpenAI".to_string(),
        base_url: "https://api.openai.com".to_string(),
        api_key: String::new(),
        model: "gpt-5".to_string(),
    }
}

fn default_input_recording_options() -> InputRecordingOptions {
    InputRecordingOptions {
        record_keyboard: true,
        record_mouse_clicks: true,
        record_mouse_moves: true,
    }
}

fn default_input_recording_preset() -> InputRecordingPreset {
    InputRecordingPreset {
        id: format!("input-preset-{}", now_millis()),
        name: "默认键鼠预设".to_string(),
        options: default_input_recording_options(),
        actions: Vec::new(),
        updated_at: now_millis() as u64,
    }
}

fn sanitize_preset(mut item: LlmPreset) -> LlmPreset {
    if item.id.trim().is_empty() {
        item.id = format!("preset-{}", now_millis());
    } else {
        item.id = item.id.trim().to_string();
    }

    item.name = if item.name.trim().is_empty() {
        "未命名预设".to_string()
    } else {
        item.name.trim().to_string()
    };

    item.base_url = item.base_url.trim().to_string();
    item.model = if item.model.trim().is_empty() {
        "gpt-5".to_string()
    } else {
        item.model.trim().to_string()
    };

    item
}

fn normalize_presets(input: Vec<LlmPreset>) -> Vec<LlmPreset> {
    let mut output = input
        .into_iter()
        .map(sanitize_preset)
        .collect::<Vec<LlmPreset>>();

    if output.is_empty() {
        output.push(default_preset());
    }

    output
}

fn sanitize_input_recording_preset(mut item: InputRecordingPreset) -> InputRecordingPreset {
    if item.id.trim().is_empty() {
        item.id = format!("input-preset-{}", now_millis());
    } else {
        item.id = item.id.trim().to_string();
    }

    item.name = if item.name.trim().is_empty() {
        "未命名键鼠预设".to_string()
    } else {
        item.name.trim().to_string()
    };

    item.updated_at = if item.updated_at == 0 {
        now_millis() as u64
    } else {
        item.updated_at
    };

    item
}

fn normalize_input_recording_presets(input: Vec<InputRecordingPreset>) -> Vec<InputRecordingPreset> {
    let mut output = input
        .into_iter()
        .map(sanitize_input_recording_preset)
        .collect::<Vec<_>>();

    if output.is_empty() {
        output.push(default_input_recording_preset());
    }

    output
}

fn shared_db_path() -> PathBuf {
    #[cfg(target_os = "windows")]
    {
        if let Ok(program_data) = std::env::var("PROGRAMDATA") {
            return PathBuf::from(program_data)
                .join("CommandFlow")
                .join("commandflow_shared_settings.db");
        }

        PathBuf::from(r"C:\ProgramData")
            .join("CommandFlow")
            .join("commandflow_shared_settings.db")
    }

    #[cfg(not(target_os = "windows"))]
    {
        std::env::temp_dir().join("commandflow_shared_settings.db")
    }
}

fn ensure_parent_dir(path: &Path) -> Result<(), String> {
    let Some(parent) = path.parent() else {
        return Err("无法解析数据库目录。".to_string());
    };

    std::fs::create_dir_all(parent)
        .map_err(|error| format!("创建共享设置目录失败（{}）：{}", parent.display(), error))
}

fn open_connection() -> Result<Connection, String> {
    let path = shared_db_path();
    ensure_parent_dir(&path)?;

    let conn = Connection::open(&path)
        .map_err(|error| format!("打开共享设置数据库失败（{}）：{}", path.display(), error))?;

    conn.execute_batch(
        "
        PRAGMA journal_mode = WAL;
        CREATE TABLE IF NOT EXISTS secure_settings (
            setting_key TEXT PRIMARY KEY,
            encrypted_value BLOB NOT NULL,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        ",
    )
    .map_err(|error| format!("初始化共享设置数据库失败：{}", error))?;

    Ok(conn)
}

#[cfg(target_os = "windows")]
fn dpapi_entropy_blob() -> windows_sys::Win32::Security::Cryptography::CRYPT_INTEGER_BLOB {
    let bytes = b"CommandFlow::LLM_PRESETS::v1";
    windows_sys::Win32::Security::Cryptography::CRYPT_INTEGER_BLOB {
        cbData: bytes.len() as u32,
        pbData: bytes.as_ptr() as *mut u8,
    }
}

#[cfg(target_os = "windows")]
fn encrypt_for_windows(plain: &[u8]) -> Result<Vec<u8>, String> {
    use std::ptr::null_mut;
    use windows_sys::Win32::Security::Cryptography::{
        CryptProtectData, CRYPT_INTEGER_BLOB, CRYPTPROTECT_UI_FORBIDDEN,
    };
    use windows_sys::Win32::Foundation::LocalFree;

    let input = CRYPT_INTEGER_BLOB {
        cbData: plain.len() as u32,
        pbData: plain.as_ptr() as *mut u8,
    };
    let entropy = dpapi_entropy_blob();
    let mut output = CRYPT_INTEGER_BLOB {
        cbData: 0,
        pbData: null_mut(),
    };

    let ok = unsafe {
        CryptProtectData(
            &input,
            null_mut(),
            &entropy,
            null_mut(),
            null_mut(),
            CRYPTPROTECT_UI_FORBIDDEN,
            &mut output,
        )
    };

    if ok == 0 {
        return Err(format!(
            "加密 LLM 预设失败：{}",
            std::io::Error::last_os_error()
        ));
    }

    let encrypted = unsafe { std::slice::from_raw_parts(output.pbData, output.cbData as usize) }.to_vec();
    unsafe {
        let _ = LocalFree(output.pbData as *mut core::ffi::c_void);
    }
    Ok(encrypted)
}

#[cfg(target_os = "windows")]
fn decrypt_for_windows(encrypted: &[u8]) -> Result<Vec<u8>, String> {
    use std::ptr::null_mut;
    use windows_sys::Win32::Foundation::LocalFree;
    use windows_sys::Win32::Security::Cryptography::{CryptUnprotectData, CRYPT_INTEGER_BLOB};

    let input = CRYPT_INTEGER_BLOB {
        cbData: encrypted.len() as u32,
        pbData: encrypted.as_ptr() as *mut u8,
    };
    let entropy = dpapi_entropy_blob();
    let mut output = CRYPT_INTEGER_BLOB {
        cbData: 0,
        pbData: null_mut(),
    };

    let ok = unsafe {
        CryptUnprotectData(
            &input,
            null_mut(),
            &entropy,
            null_mut(),
            null_mut(),
            0,
            &mut output,
        )
    };

    if ok == 0 {
        return Err(format!(
            "解密 LLM 预设失败：{}",
            std::io::Error::last_os_error()
        ));
    }

    let plain = unsafe { std::slice::from_raw_parts(output.pbData, output.cbData as usize) }.to_vec();
    unsafe {
        let _ = LocalFree(output.pbData as *mut core::ffi::c_void);
    }
    Ok(plain)
}

#[cfg(not(target_os = "windows"))]
fn encrypt_for_windows(_plain: &[u8]) -> Result<Vec<u8>, String> {
    Err("当前平台暂不支持 Windows DPAPI 加密。".to_string())
}

#[cfg(not(target_os = "windows"))]
fn decrypt_for_windows(_encrypted: &[u8]) -> Result<Vec<u8>, String> {
    Err("当前平台暂不支持 Windows DPAPI 解密。".to_string())
}

pub fn save_llm_presets(presets: Vec<LlmPreset>) -> Result<(), String> {
    let normalized = normalize_presets(presets);
    let serialized = serde_json::to_vec(&normalized).map_err(|error| format!("序列化预设失败：{}", error))?;
    let encrypted = encrypt_for_windows(&serialized)?;

    let conn = open_connection()?;
    conn.execute(
        "
        INSERT INTO secure_settings (setting_key, encrypted_value, updated_at)
        VALUES (?1, ?2, CURRENT_TIMESTAMP)
        ON CONFLICT(setting_key)
        DO UPDATE SET encrypted_value = excluded.encrypted_value, updated_at = CURRENT_TIMESTAMP
        ",
        params![SETTINGS_KEY_LLM_PRESETS, encrypted],
    )
    .map_err(|error| format!("保存 LLM 预设失败：{}", error))?;

    Ok(())
}

pub fn load_llm_presets() -> Result<Vec<LlmPreset>, String> {
    let conn = open_connection()?;
    let encrypted = conn
        .query_row(
            "SELECT encrypted_value FROM secure_settings WHERE setting_key = ?1",
            params![SETTINGS_KEY_LLM_PRESETS],
            |row| row.get::<_, Vec<u8>>(0),
        )
        .optional()
        .map_err(|error| format!("读取 LLM 预设失败：{}", error))?;

    let Some(encrypted) = encrypted else {
        return Ok(vec![default_preset()]);
    };

    let plain = decrypt_for_windows(&encrypted)?;
    let parsed = serde_json::from_slice::<Vec<LlmPreset>>(&plain)
        .map_err(|error| format!("解析已保存 LLM 预设失败：{}", error))?;

    Ok(normalize_presets(parsed))
}

pub fn save_input_recording_presets(presets: Vec<InputRecordingPreset>) -> Result<(), String> {
    let normalized = normalize_input_recording_presets(presets);
    let serialized = serde_json::to_vec(&normalized).map_err(|error| format!("序列化键鼠预设失败：{}", error))?;
    let encrypted = encrypt_for_windows(&serialized)?;

    let conn = open_connection()?;
    conn.execute(
        "
        INSERT INTO secure_settings (setting_key, encrypted_value, updated_at)
        VALUES (?1, ?2, CURRENT_TIMESTAMP)
        ON CONFLICT(setting_key)
        DO UPDATE SET encrypted_value = excluded.encrypted_value, updated_at = CURRENT_TIMESTAMP
        ",
        params![SETTINGS_KEY_INPUT_RECORDING_PRESETS, encrypted],
    )
    .map_err(|error| format!("保存键鼠预设失败：{}", error))?;

    Ok(())
}

pub fn load_input_recording_presets() -> Result<Vec<InputRecordingPreset>, String> {
    let conn = open_connection()?;
    let encrypted = conn
        .query_row(
            "SELECT encrypted_value FROM secure_settings WHERE setting_key = ?1",
            params![SETTINGS_KEY_INPUT_RECORDING_PRESETS],
            |row| row.get::<_, Vec<u8>>(0),
        )
        .optional()
        .map_err(|error| format!("读取键鼠预设失败：{}", error))?;

    let Some(encrypted) = encrypted else {
        return Ok(vec![default_input_recording_preset()]);
    };

    let plain = decrypt_for_windows(&encrypted)?;
    let parsed = serde_json::from_slice::<Vec<InputRecordingPreset>>(&plain)
        .map_err(|error| format!("解析键鼠预设失败：{}", error))?;

    Ok(normalize_input_recording_presets(parsed))
}
