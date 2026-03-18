use crate::error::{CommandFlowError, CommandResult};
use tokio::process::Command;

#[cfg(target_os = "windows")]
use windows::{
    core::{w, GUID, PCWSTR},
    Devices::Radios::{Radio, RadioAccessStatus, RadioKind, RadioState},
    Win32::{
        Media::Audio::{
            eConsole, eRender, Endpoints::IAudioEndpointVolume, IMMDeviceEnumerator,
            MMDeviceEnumerator,
        },
        NetworkManagement::IpHelper::{
            FreeMibTable, GetIfEntry, GetIfTable2, SetIfEntry, IF_ADMIN_STATUS_DOWN,
            IF_ADMIN_STATUS_UP, IF_TYPE_SOFTWARE_LOOPBACK, MIB_IFROW, MIB_IF_TABLE2,
        },
        System::{
            Com::{
                CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_ALL, COINIT_MULTITHREADED,
            },
            Power::PowerSetActiveScheme,
            Registry::{
                RegCloseKey, RegOpenKeyExW, RegSetValueExW, HKEY, HKEY_CURRENT_USER, KEY_SET_VALUE,
                REG_DWORD,
            },
        },
        UI::{Shell::ShellExecuteW, WindowsAndMessaging::SW_SHOWNORMAL},
    },
};

#[cfg(target_os = "windows")]
struct ComApartment;

#[cfg(target_os = "windows")]
impl Drop for ComApartment {
    fn drop(&mut self) {
        unsafe {
            CoUninitialize();
        }
    }
}

#[allow(dead_code)]
async fn run_command(program: &str, args: &[String]) -> CommandResult<()> {
    let output = Command::new(program)
        .args(args)
        .output()
        .await
        .map_err(|error| CommandFlowError::Automation(error.to_string()))?;

    if output.status.success() {
        return Ok(());
    }

    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let details = if !stderr.is_empty() {
        stderr
    } else if !stdout.is_empty() {
        stdout
    } else {
        format!("{} exited with status {:?}", program, output.status.code())
    };

    Err(CommandFlowError::Automation(format!(
        "执行系统设置命令失败：{} {}，{}",
        program,
        args.join(" "),
        details
    )))
}

fn normalize_switch_state(state: &str) -> String {
    match state.trim().to_lowercase().as_str() {
        "on" | "enable" | "enabled" | "true" | "1" => "on".to_string(),
        "off" | "disable" | "disabled" | "false" | "0" => "off".to_string(),
        _ => "toggle".to_string(),
    }
}

fn normalize_theme_mode(mode: &str) -> String {
    match mode.trim().to_lowercase().as_str() {
        "light" => "light".to_string(),
        _ => "dark".to_string(),
    }
}

#[cfg(target_os = "windows")]
fn map_windows_error(error: windows::core::Error, action: &str) -> CommandFlowError {
    CommandFlowError::Automation(format!("{}失败：{}", action, error))
}

#[cfg(target_os = "windows")]
fn with_audio_endpoint<T>(
    action_name: &str,
    action: impl FnOnce(&IAudioEndpointVolume) -> windows::core::Result<T>,
) -> CommandResult<T> {
    unsafe {
        CoInitializeEx(None, COINIT_MULTITHREADED)
            .ok()
            .map_err(|error| map_windows_error(error, "初始化 COM"))?;
    }
    let _com = ComApartment;

    let enumerator: IMMDeviceEnumerator =
        unsafe { CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL) }
            .map_err(|error| map_windows_error(error, "创建音频枚举器"))?;

    let device = unsafe { enumerator.GetDefaultAudioEndpoint(eRender, eConsole) }
        .map_err(|error| map_windows_error(error, "获取默认音频设备"))?;

    let endpoint = unsafe { device.Activate::<IAudioEndpointVolume>(CLSCTX_ALL, None) }
        .map_err(|error| map_windows_error(error, "激活音频端点"))?;

    action(&endpoint).map_err(|error| map_windows_error(error, action_name))
}

#[cfg(target_os = "windows")]
fn set_radio_state(kind: RadioKind, mode: &str, display_name: &str) -> CommandResult<()> {
    unsafe {
        CoInitializeEx(None, COINIT_MULTITHREADED)
            .ok()
            .map_err(|error| map_windows_error(error, "初始化无线电 API"))?;
    }
    let _com = ComApartment;

    let access = Radio::RequestAccessAsync()
        .map_err(|error| map_windows_error(error, "请求无线电权限"))?
        .get()
        .map_err(|error| map_windows_error(error, "获取无线电权限"))?;

    if access != RadioAccessStatus::Allowed {
        return Err(CommandFlowError::Automation(format!(
            "未获得 {} 控制权限：{:?}",
            display_name, access
        )));
    }

    let radios = Radio::GetRadiosAsync()
        .map_err(|error| map_windows_error(error, "查询无线电设备"))?
        .get()
        .map_err(|error| map_windows_error(error, "读取无线电设备列表"))?;

    let mut matched = false;
    for index in 0..radios.Size().unwrap_or(0) {
        let radio = radios
            .GetAt(index)
            .map_err(|error| map_windows_error(error, "访问无线电设备"))?;

        if radio
            .Kind()
            .map_err(|error| map_windows_error(error, "读取无线电类型"))?
            != kind
        {
            continue;
        }

        matched = true;
        let target_state = match mode {
            "on" => RadioState::On,
            "off" => RadioState::Off,
            _ => {
                let current = radio
                    .State()
                    .map_err(|error| map_windows_error(error, "读取无线电状态"))?;
                if current == RadioState::On {
                    RadioState::Off
                } else {
                    RadioState::On
                }
            }
        };

        let result = radio
            .SetStateAsync(target_state)
            .map_err(|error| map_windows_error(error, "设置无线电状态"))?
            .get()
            .map_err(|error| map_windows_error(error, "提交无线电状态变更"))?;

        if result != RadioAccessStatus::Allowed {
            return Err(CommandFlowError::Automation(format!(
                "{} 切换被拒绝：{:?}",
                display_name, result
            )));
        }
    }

    if !matched {
        return Err(CommandFlowError::Automation(format!(
            "未找到可控制的 {} 设备。",
            display_name
        )));
    }

    Ok(())
}

#[cfg(target_os = "windows")]
fn set_windows_theme(mode: &str) -> CommandResult<()> {
    let value: u32 = if mode == "light" { 1 } else { 0 };
    let bytes = value.to_le_bytes();
    let mut key = HKEY::default();

    let open_result = unsafe {
        RegOpenKeyExW(
            HKEY_CURRENT_USER,
            w!("Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize"),
            Some(0),
            KEY_SET_VALUE,
            &mut key,
        )
    };

    if open_result.0 != 0 {
        return Err(CommandFlowError::Automation(format!(
            "打开主题注册表失败，错误码：{}",
            open_result.0
        )));
    }

    let set_apps_result = unsafe {
        RegSetValueExW(
            key,
            w!("AppsUseLightTheme"),
            Some(0),
            REG_DWORD,
            Some(&bytes),
        )
    };

    if set_apps_result.0 != 0 {
        unsafe {
            let _ = RegCloseKey(key);
        }
        return Err(CommandFlowError::Automation(format!(
            "写入 AppsUseLightTheme 失败，错误码：{}",
            set_apps_result.0
        )));
    }

    let set_system_result = unsafe {
        RegSetValueExW(
            key,
            w!("SystemUsesLightTheme"),
            Some(0),
            REG_DWORD,
            Some(&bytes),
        )
    };

    unsafe {
        let _ = RegCloseKey(key);
    }

    if set_system_result.0 != 0 {
        return Err(CommandFlowError::Automation(format!(
            "写入 SystemUsesLightTheme 失败，错误码：{}",
            set_system_result.0
        )));
    }

    Ok(())
}

#[cfg(target_os = "windows")]
fn set_windows_power_plan(plan: &str) -> CommandResult<()> {
    let guid = match plan {
        "highperformance" | "high_performance" | "high-performance" => {
            GUID::from_u128(0x8c5e7fda_e8bf_4a96_9a85_a6e23a8c635c)
        }
        "powersaver" | "power_saver" | "power-saver" => {
            GUID::from_u128(0xa1841308_3541_4fab_bc81_f71556f20b4a)
        }
        _ => GUID::from_u128(0x381b4222_f694_41f0_9685_ff5bb260df2e),
    };

    let result = unsafe { PowerSetActiveScheme(None, Some(&guid)) };
    if result.0 != 0 {
        return Err(CommandFlowError::Automation(format!(
            "切换电源计划失败，错误码：{}",
            result.0
        )));
    }
    Ok(())
}

#[cfg(target_os = "windows")]
fn utf16_buf_to_string(buf: &[u16]) -> String {
    let end = buf.iter().position(|&ch| ch == 0).unwrap_or(buf.len());
    String::from_utf16_lossy(&buf[..end]).trim().to_string()
}

#[cfg(target_os = "windows")]
fn switch_windows_network_adapter(adapter_name: Option<&str>, mode: &str) -> CommandResult<()> {
    let requested = adapter_name
        .map(str::trim)
        .filter(|name| !name.is_empty())
        .map(|name| name.to_lowercase());

    let mut table_ptr: *mut MIB_IF_TABLE2 = std::ptr::null_mut();
    let status = unsafe { GetIfTable2(&mut table_ptr) };
    if status.0 != 0 {
        return Err(CommandFlowError::Automation(format!(
            "读取网络接口列表失败，错误码：{}",
            status.0
        )));
    }

    let mut selected_index: Option<u32> = None;
    let mut selected_alias = String::new();

    unsafe {
        let table = &*table_ptr;
        let rows = std::slice::from_raw_parts(table.Table.as_ptr(), table.NumEntries as usize);

        for row in rows {
            if row.Type == IF_TYPE_SOFTWARE_LOOPBACK {
                continue;
            }

            let alias = utf16_buf_to_string(&row.Alias);
            let description = utf16_buf_to_string(&row.Description);

            if let Some(ref keyword) = requested {
                let alias_l = alias.to_lowercase();
                let description_l = description.to_lowercase();
                if !alias_l.contains(keyword) && !description_l.contains(keyword) {
                    continue;
                }
            }

            selected_index = Some(row.InterfaceIndex);
            selected_alias = if alias.is_empty() { description } else { alias };
            break;
        }

        FreeMibTable(table_ptr as *const _);
    }

    let Some(interface_index) = selected_index else {
        return Err(CommandFlowError::Automation(
            "未找到匹配的网络适配器。".to_string(),
        ));
    };

    let mut if_row = MIB_IFROW::default();
    if_row.dwIndex = interface_index;

    let query_status = unsafe { GetIfEntry(&mut if_row) };
    if query_status != 0 {
        return Err(CommandFlowError::Automation(format!(
            "读取网络适配器状态失败（{}），错误码：{}",
            selected_alias, query_status
        )));
    }

    let target_status = match mode {
        "on" => IF_ADMIN_STATUS_UP,
        "off" => IF_ADMIN_STATUS_DOWN,
        _ => {
            if if_row.dwAdminStatus == IF_ADMIN_STATUS_UP {
                IF_ADMIN_STATUS_DOWN
            } else {
                IF_ADMIN_STATUS_UP
            }
        }
    };

    if_row.dwAdminStatus = target_status;
    let apply_status = unsafe { SetIfEntry(&if_row) };
    if apply_status != 0 {
        return Err(CommandFlowError::Automation(format!(
            "切换网络适配器失败（{}），错误码：{}",
            selected_alias, apply_status
        )));
    }

    Ok(())
}

#[cfg(target_os = "windows")]
fn open_windows_settings_page(page: &str) -> CommandResult<()> {
    let uri = match page {
        "sound" | "audio" => "ms-settings:sound",
        "display" => "ms-settings:display",
        "network" => "ms-settings:network",
        "wifi" => "ms-settings:network-wifi",
        "bluetooth" => "ms-settings:bluetooth",
        "power" | "battery" => "ms-settings:powersleep",
        _ => "ms-settings:system",
    };

    let operation = w!("open");
    let mut uri_utf16 = uri.encode_utf16().collect::<Vec<u16>>();
    uri_utf16.push(0);

    let instance = unsafe {
        ShellExecuteW(
            None,
            operation,
            PCWSTR(uri_utf16.as_ptr()),
            PCWSTR::null(),
            PCWSTR::null(),
            SW_SHOWNORMAL,
        )
    };

    if instance.0 as isize <= 32 {
        return Err(CommandFlowError::Automation(format!(
            "打开设置页失败：{}",
            uri
        )));
    }

    Ok(())
}

pub async fn set_volume_mute(mode: &str) -> CommandResult<()> {
    let normalized = normalize_switch_state(mode);

    #[cfg(target_os = "windows")]
    {
        let normalized_clone = normalized.clone();
        let join_result = tokio::task::spawn_blocking(move || {
            with_audio_endpoint("设置系统静音", |endpoint| unsafe {
                let target = match normalized_clone.as_str() {
                    "on" => true,
                    "off" => false,
                    _ => {
                        let current = endpoint.GetMute()?;
                        current.0 == 0
                    }
                };
                endpoint.SetMute(target, std::ptr::null())?;
                Ok(())
            })
        })
        .await
        .map_err(|error| CommandFlowError::Automation(format!("静音任务执行失败：{}", error)))?;

        return join_result;
    }

    #[cfg(target_os = "linux")]
    {
        return match normalized.as_str() {
            "on" => {
                run_command(
                    "pactl",
                    &[
                        "set-sink-mute".to_string(),
                        "@DEFAULT_SINK@".to_string(),
                        "1".to_string(),
                    ],
                )
                .await
            }
            "off" => {
                run_command(
                    "pactl",
                    &[
                        "set-sink-mute".to_string(),
                        "@DEFAULT_SINK@".to_string(),
                        "0".to_string(),
                    ],
                )
                .await
            }
            _ => {
                run_command(
                    "pactl",
                    &[
                        "set-sink-mute".to_string(),
                        "@DEFAULT_SINK@".to_string(),
                        "toggle".to_string(),
                    ],
                )
                .await
            }
        };
    }

    #[cfg(target_os = "macos")]
    {
        let script = match normalized.as_str() {
            "on" => "set volume with output muted",
            "off" => "set volume without output muted",
            _ => "set volume output muted not (output muted of (get volume settings))",
        };
        return run_command("osascript", &["-e".to_string(), script.to_string()]).await;
    }

    #[allow(unreachable_code)]
    Err(CommandFlowError::Automation(
        "当前平台暂不支持系统静音控制。".to_string(),
    ))
}

pub async fn set_volume_percent(percent: u8) -> CommandResult<()> {
    let safe_percent = percent.min(100);

    #[cfg(target_os = "windows")]
    {
        let join_result = tokio::task::spawn_blocking(move || {
            with_audio_endpoint("设置系统音量", |endpoint| unsafe {
                endpoint
                    .SetMasterVolumeLevelScalar(safe_percent as f32 / 100.0, std::ptr::null())?;
                Ok(())
            })
        })
        .await
        .map_err(|error| {
            CommandFlowError::Automation(format!("音量设置任务执行失败：{}", error))
        })?;

        return join_result;
    }

    #[cfg(target_os = "linux")]
    {
        return run_command(
            "pactl",
            &[
                "set-sink-volume".to_string(),
                "@DEFAULT_SINK@".to_string(),
                format!("{}%", safe_percent),
            ],
        )
        .await;
    }

    #[cfg(target_os = "macos")]
    {
        return run_command(
            "osascript",
            &[
                "-e".to_string(),
                format!("set volume output volume {}", safe_percent),
            ],
        )
        .await;
    }

    #[allow(unreachable_code)]
    Err(CommandFlowError::Automation(
        "当前平台暂不支持系统音量设置。".to_string(),
    ))
}

pub async fn adjust_volume(delta: i32) -> CommandResult<()> {
    #[cfg(target_os = "windows")]
    {
        let join_result = tokio::task::spawn_blocking(move || {
            with_audio_endpoint("调整系统音量", |endpoint| unsafe {
                let current = endpoint.GetMasterVolumeLevelScalar()?;
                let next = (current * 100.0 + delta as f32).clamp(0.0, 100.0) / 100.0;
                endpoint.SetMasterVolumeLevelScalar(next, std::ptr::null())?;
                Ok(())
            })
        })
        .await
        .map_err(|error| {
            CommandFlowError::Automation(format!("音量调节任务执行失败：{}", error))
        })?;

        return join_result;
    }

    #[cfg(target_os = "linux")]
    {
        return run_command(
            "pactl",
            &[
                "set-sink-volume".to_string(),
                "@DEFAULT_SINK@".to_string(),
                if delta >= 0 {
                    format!("+{}%", delta)
                } else {
                    format!("{}%", delta)
                },
            ],
        )
        .await;
    }

    #[cfg(target_os = "macos")]
    {
        let direction = if delta >= 0 { "+" } else { "" };
        let script = format!(
            "set volume output volume ((output volume of (get volume settings)) {} {})",
            direction, delta
        );
        return run_command("osascript", &["-e".to_string(), script]).await;
    }

    #[allow(unreachable_code)]
    Err(CommandFlowError::Automation(
        "当前平台暂不支持系统音量增减。".to_string(),
    ))
}

pub async fn set_brightness_percent(percent: u8) -> CommandResult<()> {
    let safe_percent = percent.min(100);

    #[cfg(any(target_os = "windows", target_os = "linux", target_os = "macos"))]
    {
        let target = safe_percent as u16;
        let join_result = tokio::task::spawn_blocking(move || {
            use ddc_hi::{Ddc, Display, FeatureCode};

            let mut displays = Display::enumerate();
            if displays.is_empty() {
                return Err(CommandFlowError::Automation(
                    "未检测到支持 DDC/CI 的显示器，无法设置亮度。".to_string(),
                ));
            }

            let mut success_count = 0usize;
            let mut failed: Vec<String> = Vec::new();

            for mut display in displays.drain(..) {
                let display_name = format!("{}", display.info);
                let feature_code: FeatureCode = 0x10u8;
                let result = display.handle.set_vcp_feature(feature_code, target);
                match result {
                    Ok(_) => success_count += 1,
                    Err(error) => failed.push(format!("{}: {}", display_name, error)),
                }
            }

            if success_count == 0 {
                return Err(CommandFlowError::Automation(format!(
                    "DDC/CI 亮度设置失败：{}",
                    if failed.is_empty() {
                        "未能在任何显示器上执行亮度写入".to_string()
                    } else {
                        failed.join("; ")
                    }
                )));
            }

            Ok(())
        })
        .await
        .map_err(|error| {
            CommandFlowError::Automation(format!("亮度设置任务执行失败：{}", error))
        })?;

        return join_result;
    }

    #[allow(unreachable_code)]
    Err(CommandFlowError::Automation(
        "当前平台暂不支持亮度设置。".to_string(),
    ))
}

pub async fn switch_wifi(state: &str) -> CommandResult<()> {
    let normalized = normalize_switch_state(state);

    #[cfg(target_os = "windows")]
    {
        let normalized_clone = normalized.clone();
        let join_result = tokio::task::spawn_blocking(move || {
            set_radio_state(RadioKind::WiFi, &normalized_clone, "WiFi")
        })
        .await
        .map_err(|error| {
            CommandFlowError::Automation(format!("WiFi 切换任务执行失败：{}", error))
        })?;

        return join_result;
    }

    #[cfg(target_os = "linux")]
    {
        let action = match normalized.as_str() {
            "on" => "on",
            "off" => "off",
            _ => "toggle",
        };
        return run_command(
            "nmcli",
            &["radio".to_string(), "wifi".to_string(), action.to_string()],
        )
        .await;
    }

    #[cfg(target_os = "macos")]
    {
        return Err(CommandFlowError::Automation(
            "macOS 下 WiFi 开关依赖 networksetup 接口名，当前未自动实现。".to_string(),
        ));
    }

    #[allow(unreachable_code)]
    Err(CommandFlowError::Automation(
        "当前平台暂不支持 WiFi 开关。".to_string(),
    ))
}

pub async fn switch_bluetooth(state: &str) -> CommandResult<()> {
    let normalized = normalize_switch_state(state);

    #[cfg(target_os = "windows")]
    {
        let normalized_clone = normalized.clone();
        let join_result = tokio::task::spawn_blocking(move || {
            set_radio_state(RadioKind::Bluetooth, &normalized_clone, "蓝牙")
        })
        .await
        .map_err(|error| {
            CommandFlowError::Automation(format!("蓝牙切换任务执行失败：{}", error))
        })?;

        return join_result;
    }

    #[cfg(target_os = "linux")]
    {
        let action = match normalized.as_str() {
            "on" => "unblock",
            "off" => "block",
            _ => "toggle",
        };

        if action == "toggle" {
            return run_command(
				"bash",
				&[
					"-lc".to_string(),
					"if rfkill list bluetooth | grep -qi 'Soft blocked: yes'; then rfkill unblock bluetooth; else rfkill block bluetooth; fi".to_string(),
				],
			)
			.await;
        }

        return run_command("rfkill", &[action.to_string(), "bluetooth".to_string()]).await;
    }

    #[cfg(target_os = "macos")]
    {
        return Err(CommandFlowError::Automation(
            "macOS 下蓝牙开关通常需要 blueutil 等第三方工具。".to_string(),
        ));
    }

    #[allow(unreachable_code)]
    Err(CommandFlowError::Automation(
        "当前平台暂不支持蓝牙开关。".to_string(),
    ))
}

pub async fn switch_network_adapter(adapter_name: Option<&str>, state: &str) -> CommandResult<()> {
    let normalized = normalize_switch_state(state);

    #[cfg(target_os = "windows")]
    {
        let adapter_name_owned = adapter_name.map(|name| name.to_string());
        let normalized_clone = normalized.clone();
        let join_result = tokio::task::spawn_blocking(move || {
            switch_windows_network_adapter(adapter_name_owned.as_deref(), &normalized_clone)
        })
        .await
        .map_err(|error| {
            CommandFlowError::Automation(format!("网卡切换任务执行失败：{}", error))
        })?;

        return join_result;
    }

    #[cfg(target_os = "linux")]
    {
        let adapter = adapter_name
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or("eth0");

        return match normalized.as_str() {
			"on" => run_command("ip", &["link".to_string(), "set".to_string(), adapter.to_string(), "up".to_string()]).await,
			"off" => run_command("ip", &["link".to_string(), "set".to_string(), adapter.to_string(), "down".to_string()]).await,
			_ => run_command(
				"bash",
				&[
					"-lc".to_string(),
					format!("if ip link show {} | grep -q 'state UP'; then ip link set {} down; else ip link set {} up; fi", adapter, adapter, adapter),
				],
			)
			.await,
		};
    }

    #[cfg(target_os = "macos")]
    {
        let _ = adapter_name;
        let _ = normalized;
        return Err(CommandFlowError::Automation(
            "macOS 下网络适配器开关依赖 networksetup 具体服务名，当前未自动实现。".to_string(),
        ));
    }

    #[allow(unreachable_code)]
    Err(CommandFlowError::Automation(
        "当前平台暂不支持网络适配器开关。".to_string(),
    ))
}

pub async fn set_theme(mode: &str) -> CommandResult<()> {
    let normalized = normalize_theme_mode(mode);

    #[cfg(target_os = "windows")]
    {
        let normalized_clone = normalized.clone();
        let join_result = tokio::task::spawn_blocking(move || set_windows_theme(&normalized_clone))
            .await
            .map_err(|error| {
                CommandFlowError::Automation(format!("主题切换任务执行失败：{}", error))
            })?;
        return join_result;
    }

    #[cfg(target_os = "linux")]
    {
        if normalized == "light" {
            return run_command(
                "gsettings",
                &[
                    "set".to_string(),
                    "org.gnome.desktop.interface".to_string(),
                    "color-scheme".to_string(),
                    "prefer-light".to_string(),
                ],
            )
            .await;
        }

        return run_command(
            "gsettings",
            &[
                "set".to_string(),
                "org.gnome.desktop.interface".to_string(),
                "color-scheme".to_string(),
                "prefer-dark".to_string(),
            ],
        )
        .await;
    }

    #[cfg(target_os = "macos")]
    {
        let script = if normalized == "light" {
            "tell application \"System Events\" to tell appearance preferences to set dark mode to false"
        } else {
            "tell application \"System Events\" to tell appearance preferences to set dark mode to true"
        };
        return run_command("osascript", &["-e".to_string(), script.to_string()]).await;
    }

    #[allow(unreachable_code)]
    Err(CommandFlowError::Automation(
        "当前平台暂不支持主题切换。".to_string(),
    ))
}

pub async fn set_power_plan(plan: &str) -> CommandResult<()> {
    let normalized = plan.trim().to_lowercase();

    #[cfg(target_os = "windows")]
    {
        let normalized_clone = normalized.clone();
        let join_result =
            tokio::task::spawn_blocking(move || set_windows_power_plan(&normalized_clone))
                .await
                .map_err(|error| {
                    CommandFlowError::Automation(format!("电源计划切换任务执行失败：{}", error))
                })?;
        return join_result;
    }

    #[cfg(target_os = "linux")]
    {
        let profile = match normalized.as_str() {
            "highperformance" | "high_performance" | "high-performance" => "performance",
            "powersaver" | "power_saver" | "power-saver" => "power-saver",
            _ => "balanced",
        };
        return run_command(
            "powerprofilesctl",
            &["set".to_string(), profile.to_string()],
        )
        .await;
    }

    #[cfg(target_os = "macos")]
    {
        let _ = normalized;
        return Err(CommandFlowError::Automation(
            "macOS 未提供统一电源计划切换命令。".to_string(),
        ));
    }

    #[allow(unreachable_code)]
    Err(CommandFlowError::Automation(
        "当前平台暂不支持电源计划切换。".to_string(),
    ))
}

pub async fn open_settings_page(page: &str) -> CommandResult<()> {
    let normalized = page.trim().to_lowercase();

    #[cfg(target_os = "windows")]
    {
        let normalized_clone = normalized.clone();
        let join_result =
            tokio::task::spawn_blocking(move || open_windows_settings_page(&normalized_clone))
                .await
                .map_err(|error| {
                    CommandFlowError::Automation(format!("打开设置页任务执行失败：{}", error))
                })?;
        return join_result;
    }

    #[cfg(target_os = "linux")]
    {
        let command = match normalized.as_str() {
            "sound" | "audio" => "gnome-control-center sound",
            "display" => "gnome-control-center display",
            "network" | "wifi" => "gnome-control-center wifi",
            "bluetooth" => "gnome-control-center bluetooth",
            "power" | "battery" => "gnome-control-center power",
            _ => "gnome-control-center",
        };
        return run_command("bash", &["-lc".to_string(), command.to_string()]).await;
    }

    #[cfg(target_os = "macos")]
    {
        return run_command("open", &["x-apple.systempreferences:".to_string()]).await;
    }

    #[allow(unreachable_code)]
    Err(CommandFlowError::Automation(
        "当前平台暂不支持打开系统设置页。".to_string(),
    ))
}
