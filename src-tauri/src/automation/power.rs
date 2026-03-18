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
        "执行系统电源命令失败：{} {}，{}",
        program,
        args.join(" "),
        details
    )))
}

pub async fn shutdown(timeout_sec: u64, force: bool) -> CommandResult<()> {
    #[cfg(target_os = "windows")]
    {
        let mut args = vec!["/s".to_string(), "/t".to_string(), timeout_sec.to_string()];
        if force {
            args.push("/f".to_string());
        }
        return run_command("shutdown", &args).await;
    }

    #[cfg(target_os = "linux")]
    {
        let _ = timeout_sec;
        let _ = force;
        return run_command("systemctl", &["poweroff".to_string()]).await;
    }

    #[cfg(target_os = "macos")]
    {
        let minutes = ((timeout_sec as f64) / 60.0).ceil() as u64;
        return run_command("shutdown", &["-h".to_string(), format!("+{}", minutes)]).await;
    }

    #[allow(unreachable_code)]
    Err(CommandFlowError::Automation(
        "当前平台暂不支持关机操作。".to_string(),
    ))
}

pub async fn restart(timeout_sec: u64, force: bool) -> CommandResult<()> {
    #[cfg(target_os = "windows")]
    {
        let mut args = vec!["/r".to_string(), "/t".to_string(), timeout_sec.to_string()];
        if force {
            args.push("/f".to_string());
        }
        return run_command("shutdown", &args).await;
    }

    #[cfg(target_os = "linux")]
    {
        let _ = timeout_sec;
        let _ = force;
        return run_command("systemctl", &["reboot".to_string()]).await;
    }

    #[cfg(target_os = "macos")]
    {
        let minutes = ((timeout_sec as f64) / 60.0).ceil() as u64;
        return run_command("shutdown", &["-r".to_string(), format!("+{}", minutes)]).await;
    }

    #[allow(unreachable_code)]
    Err(CommandFlowError::Automation(
        "当前平台暂不支持重启操作。".to_string(),
    ))
}

pub async fn sleep() -> CommandResult<()> {
    #[cfg(target_os = "windows")]
    {
        return run_command(
            "rundll32.exe",
            &["powrprof.dll,SetSuspendState 0,1,0".to_string()],
        )
        .await;
    }

    #[cfg(target_os = "linux")]
    {
        return run_command("systemctl", &["suspend".to_string()]).await;
    }

    #[cfg(target_os = "macos")]
    {
        return run_command("pmset", &["sleepnow".to_string()]).await;
    }

    #[allow(unreachable_code)]
    Err(CommandFlowError::Automation(
        "当前平台暂不支持睡眠操作。".to_string(),
    ))
}

pub async fn hibernate() -> CommandResult<()> {
    #[cfg(target_os = "windows")]
    {
        return run_command("shutdown", &["/h".to_string()]).await;
    }

    #[cfg(target_os = "linux")]
    {
        return run_command("systemctl", &["hibernate".to_string()]).await;
    }

    #[cfg(target_os = "macos")]
    {
        return Err(CommandFlowError::Automation(
            "macOS 暂不直接支持通用休眠命令。".to_string(),
        ));
    }

    #[allow(unreachable_code)]
    Err(CommandFlowError::Automation(
        "当前平台暂不支持休眠操作。".to_string(),
    ))
}

pub async fn lock_screen() -> CommandResult<()> {
    #[cfg(target_os = "windows")]
    {
        return run_command("rundll32.exe", &["user32.dll,LockWorkStation".to_string()]).await;
    }

    #[cfg(target_os = "linux")]
    {
        return run_command("loginctl", &["lock-session".to_string()]).await;
    }

    #[cfg(target_os = "macos")]
    {
        return run_command(
            "osascript",
            &["-e".to_string(), "tell application \"System Events\" to keystroke \"q\" using {control down, command down}".to_string()],
        )
        .await;
    }

    #[allow(unreachable_code)]
    Err(CommandFlowError::Automation(
        "当前平台暂不支持锁屏操作。".to_string(),
    ))
}

pub async fn sign_out(force: bool) -> CommandResult<()> {
    #[cfg(target_os = "windows")]
    {
        let mut args = vec!["/l".to_string()];
        if force {
            args.push("/f".to_string());
        }
        return run_command("shutdown", &args).await;
    }

    #[cfg(target_os = "linux")]
    {
        let _ = force;
        let user = std::env::var("USER")
            .or_else(|_| std::env::var("LOGNAME"))
            .map_err(|_| CommandFlowError::Automation("无法解析当前 Linux 用户名。".to_string()))?;
        return run_command("loginctl", &["terminate-user".to_string(), user]).await;
    }

    #[cfg(target_os = "macos")]
    {
        let _ = force;
        return run_command(
            "osascript",
            &[
                "-e".to_string(),
                "tell application \"System Events\" to log out".to_string(),
            ],
        )
        .await;
    }

    #[allow(unreachable_code)]
    Err(CommandFlowError::Automation(
        "当前平台暂不支持注销操作。".to_string(),
    ))
}
