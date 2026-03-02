use crate::error::{CommandFlowError, CommandResult};
use tokio::process::Command;

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

#[cfg(target_os = "windows")]
async fn run_powershell(script: &str) -> CommandResult<()> {
	run_command(
		"powershell",
		&[
			"-NoProfile".to_string(),
			"-ExecutionPolicy".to_string(),
			"Bypass".to_string(),
			"-Command".to_string(),
			script.to_string(),
		],
	)
	.await
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

pub async fn set_volume_mute(mode: &str) -> CommandResult<()> {
	let normalized = normalize_switch_state(mode);

	#[cfg(target_os = "windows")]
	{
		const AUDIO_PREFIX: &str = r#"
$code = @"
using System;
using System.Runtime.InteropServices;

[Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioEndpointVolume {
	int RegisterControlChangeNotify(IntPtr pNotify);
	int UnregisterControlChangeNotify(IntPtr pNotify);
	int GetChannelCount(out uint channelCount);
	int SetMasterVolumeLevel(float levelDB, Guid eventContext);
	int SetMasterVolumeLevelScalar(float level, Guid eventContext);
	int GetMasterVolumeLevel(out float levelDB);
	int GetMasterVolumeLevelScalar(out float level);
	int SetChannelVolumeLevel(uint channelNumber, float levelDB, Guid eventContext);
	int SetChannelVolumeLevelScalar(uint channelNumber, float level, Guid eventContext);
	int GetChannelVolumeLevel(uint channelNumber, out float levelDB);
	int GetChannelVolumeLevelScalar(uint channelNumber, out float level);
	int SetMute([MarshalAs(UnmanagedType.Bool)] bool isMuted, Guid eventContext);
	int GetMute(out bool isMuted);
	int GetVolumeStepInfo(out uint step, out uint stepCount);
	int VolumeStepUp(Guid eventContext);
	int VolumeStepDown(Guid eventContext);
	int QueryHardwareSupport(out uint hardwareSupportMask);
	int GetVolumeRange(out float volumeMinDB, out float volumeMaxDB, out float volumeIncrementDB);
}

[Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDeviceEnumerator {
	int NotImpl1();
	int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice device);
}

[Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDevice {
	int Activate(ref Guid iid, int clsCtx, IntPtr activationParams, [MarshalAs(UnmanagedType.IUnknown)] out object interfacePointer);
}

[ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
class MMDeviceEnumeratorComObject {}

public static class AudioCtl {
	static IAudioEndpointVolume GetVolumeObject() {
		var enumerator = (IMMDeviceEnumerator)(new MMDeviceEnumeratorComObject());
		IMMDevice device;
		Marshal.ThrowExceptionForHR(enumerator.GetDefaultAudioEndpoint(0, 1, out device));
		var iid = typeof(IAudioEndpointVolume).GUID;
		object obj;
		Marshal.ThrowExceptionForHR(device.Activate(ref iid, 23, IntPtr.Zero, out obj));
		return (IAudioEndpointVolume)obj;
	}

	public static bool GetMute() {
		bool muted;
		Marshal.ThrowExceptionForHR(GetVolumeObject().GetMute(out muted));
		return muted;
	}

	public static void SetMute(bool muted) {
		Marshal.ThrowExceptionForHR(GetVolumeObject().SetMute(muted, Guid.Empty));
	}

	public static float GetVolumePercent() {
		float level;
		Marshal.ThrowExceptionForHR(GetVolumeObject().GetMasterVolumeLevelScalar(out level));
		return level * 100.0f;
	}

	public static void SetVolumePercent(float percent) {
		if (percent < 0f) percent = 0f;
		if (percent > 100f) percent = 100f;
		Marshal.ThrowExceptionForHR(GetVolumeObject().SetMasterVolumeLevelScalar(percent / 100.0f, Guid.Empty));
	}
}
"@
Add-Type -TypeDefinition $code -Language CSharp
"#;

		let action = match normalized.as_str() {
			"on" => "[AudioCtl]::SetMute($true)",
			"off" => "[AudioCtl]::SetMute($false)",
			_ => "[AudioCtl]::SetMute(-not [AudioCtl]::GetMute())",
		};

		let script = format!("{}\n{}", AUDIO_PREFIX, action);
		return run_powershell(&script).await;
	}

	#[cfg(target_os = "linux")]
	{
		return match normalized.as_str() {
			"on" => run_command("pactl", &["set-sink-mute".to_string(), "@DEFAULT_SINK@".to_string(), "1".to_string()]).await,
			"off" => run_command("pactl", &["set-sink-mute".to_string(), "@DEFAULT_SINK@".to_string(), "0".to_string()]).await,
			_ => run_command("pactl", &["set-sink-mute".to_string(), "@DEFAULT_SINK@".to_string(), "toggle".to_string()]).await,
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
	Err(CommandFlowError::Automation("当前平台暂不支持系统静音控制。".to_string()))
}

pub async fn set_volume_percent(percent: u8) -> CommandResult<()> {
	let safe_percent = percent.min(100);

	#[cfg(target_os = "windows")]
	{
		const AUDIO_PREFIX: &str = r#"
$code = @"
using System;
using System.Runtime.InteropServices;

[Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioEndpointVolume {
	int RegisterControlChangeNotify(IntPtr pNotify);
	int UnregisterControlChangeNotify(IntPtr pNotify);
	int GetChannelCount(out uint channelCount);
	int SetMasterVolumeLevel(float levelDB, Guid eventContext);
	int SetMasterVolumeLevelScalar(float level, Guid eventContext);
	int GetMasterVolumeLevel(out float levelDB);
	int GetMasterVolumeLevelScalar(out float level);
	int SetChannelVolumeLevel(uint channelNumber, float levelDB, Guid eventContext);
	int SetChannelVolumeLevelScalar(uint channelNumber, float level, Guid eventContext);
	int GetChannelVolumeLevel(uint channelNumber, out float levelDB);
	int GetChannelVolumeLevelScalar(uint channelNumber, out float level);
	int SetMute([MarshalAs(UnmanagedType.Bool)] bool isMuted, Guid eventContext);
	int GetMute(out bool isMuted);
	int GetVolumeStepInfo(out uint step, out uint stepCount);
	int VolumeStepUp(Guid eventContext);
	int VolumeStepDown(Guid eventContext);
	int QueryHardwareSupport(out uint hardwareSupportMask);
	int GetVolumeRange(out float volumeMinDB, out float volumeMaxDB, out float volumeIncrementDB);
}

[Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDeviceEnumerator {
	int NotImpl1();
	int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice device);
}

[Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDevice {
	int Activate(ref Guid iid, int clsCtx, IntPtr activationParams, [MarshalAs(UnmanagedType.IUnknown)] out object interfacePointer);
}

[ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
class MMDeviceEnumeratorComObject {}

public static class AudioCtl {
	static IAudioEndpointVolume GetVolumeObject() {
		var enumerator = (IMMDeviceEnumerator)(new MMDeviceEnumeratorComObject());
		IMMDevice device;
		Marshal.ThrowExceptionForHR(enumerator.GetDefaultAudioEndpoint(0, 1, out device));
		var iid = typeof(IAudioEndpointVolume).GUID;
		object obj;
		Marshal.ThrowExceptionForHR(device.Activate(ref iid, 23, IntPtr.Zero, out obj));
		return (IAudioEndpointVolume)obj;
	}

	public static void SetVolumePercent(float percent) {
		if (percent < 0f) percent = 0f;
		if (percent > 100f) percent = 100f;
		Marshal.ThrowExceptionForHR(GetVolumeObject().SetMasterVolumeLevelScalar(percent / 100.0f, Guid.Empty));
	}
}
"@
Add-Type -TypeDefinition $code -Language CSharp
"#;
		let action = format!("[AudioCtl]::SetVolumePercent({})", safe_percent);
		let script = format!("{}\n{}", AUDIO_PREFIX, action);
		return run_powershell(&script).await;
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
			&["-e".to_string(), format!("set volume output volume {}", safe_percent)],
		)
		.await;
	}

	#[allow(unreachable_code)]
	Err(CommandFlowError::Automation("当前平台暂不支持系统音量设置。".to_string()))
}

pub async fn adjust_volume(delta: i32) -> CommandResult<()> {
	#[cfg(target_os = "windows")]
	{
		const AUDIO_PREFIX: &str = r#"
$code = @"
using System;
using System.Runtime.InteropServices;

[Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioEndpointVolume {
	int RegisterControlChangeNotify(IntPtr pNotify);
	int UnregisterControlChangeNotify(IntPtr pNotify);
	int GetChannelCount(out uint channelCount);
	int SetMasterVolumeLevel(float levelDB, Guid eventContext);
	int SetMasterVolumeLevelScalar(float level, Guid eventContext);
	int GetMasterVolumeLevel(out float levelDB);
	int GetMasterVolumeLevelScalar(out float level);
	int SetChannelVolumeLevel(uint channelNumber, float levelDB, Guid eventContext);
	int SetChannelVolumeLevelScalar(uint channelNumber, float level, Guid eventContext);
	int GetChannelVolumeLevel(uint channelNumber, out float levelDB);
	int GetChannelVolumeLevelScalar(uint channelNumber, out float level);
	int SetMute([MarshalAs(UnmanagedType.Bool)] bool isMuted, Guid eventContext);
	int GetMute(out bool isMuted);
	int GetVolumeStepInfo(out uint step, out uint stepCount);
	int VolumeStepUp(Guid eventContext);
	int VolumeStepDown(Guid eventContext);
	int QueryHardwareSupport(out uint hardwareSupportMask);
	int GetVolumeRange(out float volumeMinDB, out float volumeMaxDB, out float volumeIncrementDB);
}

[Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDeviceEnumerator {
	int NotImpl1();
	int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice device);
}

[Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDevice {
	int Activate(ref Guid iid, int clsCtx, IntPtr activationParams, [MarshalAs(UnmanagedType.IUnknown)] out object interfacePointer);
}

[ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
class MMDeviceEnumeratorComObject {}

public static class AudioCtl {
	static IAudioEndpointVolume GetVolumeObject() {
		var enumerator = (IMMDeviceEnumerator)(new MMDeviceEnumeratorComObject());
		IMMDevice device;
		Marshal.ThrowExceptionForHR(enumerator.GetDefaultAudioEndpoint(0, 1, out device));
		var iid = typeof(IAudioEndpointVolume).GUID;
		object obj;
		Marshal.ThrowExceptionForHR(device.Activate(ref iid, 23, IntPtr.Zero, out obj));
		return (IAudioEndpointVolume)obj;
	}

	public static float GetVolumePercent() {
		float level;
		Marshal.ThrowExceptionForHR(GetVolumeObject().GetMasterVolumeLevelScalar(out level));
		return level * 100.0f;
	}

	public static void SetVolumePercent(float percent) {
		if (percent < 0f) percent = 0f;
		if (percent > 100f) percent = 100f;
		Marshal.ThrowExceptionForHR(GetVolumeObject().SetMasterVolumeLevelScalar(percent / 100.0f, Guid.Empty));
	}
}
"@
Add-Type -TypeDefinition $code -Language CSharp
"#;
		let action = format!(
			"$current=[AudioCtl]::GetVolumePercent(); $next=[Math]::Max(0,[Math]::Min(100,$current + ({}))); [AudioCtl]::SetVolumePercent($next)",
			delta
		);
		let script = format!("{}\n{}", AUDIO_PREFIX, action);
		return run_powershell(&script).await;
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
			direction,
			delta
		);
		return run_command("osascript", &["-e".to_string(), script]).await;
	}

	#[allow(unreachable_code)]
	Err(CommandFlowError::Automation("当前平台暂不支持系统音量增减。".to_string()))
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
				let feature_code: FeatureCode = 0x10u8.into();
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
	Err(CommandFlowError::Automation("当前平台暂不支持亮度设置。".to_string()))
}

pub async fn switch_wifi(state: &str) -> CommandResult<()> {
	let normalized = normalize_switch_state(state);

	#[cfg(target_os = "windows")]
	{
		let script = match normalized.as_str() {
			"on" => {
				r#"$adapter = Get-NetAdapter -Physical | Where-Object { $_.InterfaceDescription -match 'Wireless|Wi-Fi|WLAN' -or $_.Name -match 'Wi-Fi|WLAN|Wireless' } | Select-Object -First 1
if (-not $adapter) { throw '未找到 WiFi 适配器' }
Enable-NetAdapter -Name $adapter.Name -Confirm:$false"#
					.to_string()
			}
			"off" => {
				r#"$adapter = Get-NetAdapter -Physical | Where-Object { $_.InterfaceDescription -match 'Wireless|Wi-Fi|WLAN' -or $_.Name -match 'Wi-Fi|WLAN|Wireless' } | Select-Object -First 1
if (-not $adapter) { throw '未找到 WiFi 适配器' }
Disable-NetAdapter -Name $adapter.Name -Confirm:$false"#
					.to_string()
			}
			_ => {
				r#"$adapter = Get-NetAdapter -Physical | Where-Object { $_.InterfaceDescription -match 'Wireless|Wi-Fi|WLAN' -or $_.Name -match 'Wi-Fi|WLAN|Wireless' } | Select-Object -First 1
if (-not $adapter) { throw '未找到 WiFi 适配器' }
if ($adapter.Status -eq 'Up') {
  Disable-NetAdapter -Name $adapter.Name -Confirm:$false
} else {
  Enable-NetAdapter -Name $adapter.Name -Confirm:$false
}"#
				.to_string()
			}
		};
		return run_powershell(&script).await;
	}

	#[cfg(target_os = "linux")]
	{
		let action = match normalized.as_str() {
			"on" => "on",
			"off" => "off",
			_ => "toggle",
		};
		return run_command("nmcli", &["radio".to_string(), "wifi".to_string(), action.to_string()]).await;
	}

	#[cfg(target_os = "macos")]
	{
		return Err(CommandFlowError::Automation(
			"macOS 下 WiFi 开关依赖 networksetup 接口名，当前未自动实现。".to_string(),
		));
	}

	#[allow(unreachable_code)]
	Err(CommandFlowError::Automation("当前平台暂不支持 WiFi 开关。".to_string()))
}

pub async fn switch_bluetooth(state: &str) -> CommandResult<()> {
	let normalized = normalize_switch_state(state);

	#[cfg(target_os = "windows")]
	{
		let script = match normalized.as_str() {
			"on" => r#"$devs = Get-PnpDevice -Class Bluetooth -ErrorAction Stop
if (-not $devs) { throw '未找到蓝牙设备' }
$devs | ForEach-Object { Enable-PnpDevice -InstanceId $_.InstanceId -Confirm:$false -ErrorAction SilentlyContinue }"#
				.to_string(),
			"off" => r#"$devs = Get-PnpDevice -Class Bluetooth -ErrorAction Stop
if (-not $devs) { throw '未找到蓝牙设备' }
$devs | ForEach-Object { Disable-PnpDevice -InstanceId $_.InstanceId -Confirm:$false -ErrorAction SilentlyContinue }"#
				.to_string(),
			_ => r#"$devs = Get-PnpDevice -Class Bluetooth -ErrorAction Stop
if (-not $devs) { throw '未找到蓝牙设备' }
$enabled = $devs | Where-Object { $_.Status -eq 'OK' }
if ($enabled.Count -gt 0) {
  $enabled | ForEach-Object { Disable-PnpDevice -InstanceId $_.InstanceId -Confirm:$false -ErrorAction SilentlyContinue }
} else {
  $devs | ForEach-Object { Enable-PnpDevice -InstanceId $_.InstanceId -Confirm:$false -ErrorAction SilentlyContinue }
}"#
				.to_string(),
		};
		return run_powershell(&script).await;
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
	Err(CommandFlowError::Automation("当前平台暂不支持蓝牙开关。".to_string()))
}

pub async fn switch_network_adapter(adapter_name: Option<&str>, state: &str) -> CommandResult<()> {
	let normalized = normalize_switch_state(state);

	#[cfg(target_os = "windows")]
	{
		let adapter_name = adapter_name.unwrap_or("").trim();
		let selector = if adapter_name.is_empty() {
			"Get-NetAdapter -Physical | Select-Object -First 1".to_string()
		} else {
			format!("Get-NetAdapter -Name \"{}\" -ErrorAction Stop", adapter_name.replace('"', "\""))
		};

		let action = match normalized.as_str() {
			"on" => "Enable-NetAdapter -Name $adapter.Name -Confirm:$false",
			"off" => "Disable-NetAdapter -Name $adapter.Name -Confirm:$false",
			_ => "if ($adapter.Status -eq 'Up') { Disable-NetAdapter -Name $adapter.Name -Confirm:$false } else { Enable-NetAdapter -Name $adapter.Name -Confirm:$false }",
		};

		let script = format!(
			"$adapter = {}\nif (-not $adapter) {{ throw '未找到网络适配器' }}\n{}",
			selector, action
		);
		return run_powershell(&script).await;
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
	Err(CommandFlowError::Automation("当前平台暂不支持网络适配器开关。".to_string()))
}

pub async fn set_theme(mode: &str) -> CommandResult<()> {
	let normalized = normalize_theme_mode(mode);

	#[cfg(target_os = "windows")]
	{
		let value = if normalized == "light" { 1 } else { 0 };
		let script = format!(
			"Set-ItemProperty -Path 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize' -Name AppsUseLightTheme -Type DWord -Value {}\nSet-ItemProperty -Path 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize' -Name SystemUsesLightTheme -Type DWord -Value {}",
			value, value
		);
		return run_powershell(&script).await;
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
	Err(CommandFlowError::Automation("当前平台暂不支持主题切换。".to_string()))
}

pub async fn set_power_plan(plan: &str) -> CommandResult<()> {
	let normalized = plan.trim().to_lowercase();

	#[cfg(target_os = "windows")]
	{
		let scheme = match normalized.as_str() {
			"highperformance" | "high_performance" | "high-performance" => "SCHEME_MIN",
			"powersaver" | "power_saver" | "power-saver" => "SCHEME_MAX",
			_ => "SCHEME_BALANCED",
		};
		return run_command(
			"powercfg",
			&["/setactive".to_string(), scheme.to_string()],
		)
		.await;
	}

	#[cfg(target_os = "linux")]
	{
		let profile = match normalized.as_str() {
			"highperformance" | "high_performance" | "high-performance" => "performance",
			"powersaver" | "power_saver" | "power-saver" => "power-saver",
			_ => "balanced",
		};
		return run_command("powerprofilesctl", &["set".to_string(), profile.to_string()]).await;
	}

	#[cfg(target_os = "macos")]
	{
		let _ = normalized;
		return Err(CommandFlowError::Automation(
			"macOS 未提供统一电源计划切换命令。".to_string(),
		));
	}

	#[allow(unreachable_code)]
	Err(CommandFlowError::Automation("当前平台暂不支持电源计划切换。".to_string()))
}

pub async fn open_settings_page(page: &str) -> CommandResult<()> {
	let normalized = page.trim().to_lowercase();

	#[cfg(target_os = "windows")]
	{
		let uri = match normalized.as_str() {
			"sound" | "audio" => "ms-settings:sound",
			"display" => "ms-settings:display",
			"network" => "ms-settings:network",
			"wifi" => "ms-settings:network-wifi",
			"bluetooth" => "ms-settings:bluetooth",
			"power" | "battery" => "ms-settings:powersleep",
			_ => "ms-settings:system",
		};
		return run_command(
			"cmd",
			&[
				"/C".to_string(),
				"start".to_string(),
				"".to_string(),
				uri.to_string(),
			],
		)
		.await;
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
	Err(CommandFlowError::Automation("当前平台暂不支持打开系统设置页。".to_string()))
}
