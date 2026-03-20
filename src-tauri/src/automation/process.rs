use crate::error::{CommandFlowError, CommandResult};
use encoding_rs::GBK;
use serde::Serialize;
use std::process::Command;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunningProcessEntry {
    pub process_name: String,
    pub pid: u32,
}

#[derive(Debug, Clone)]
pub struct TerminateProcessOutcome {
    pub killed_count: u32,
    pub stdout: String,
    pub stderr: String,
}

fn io_to_automation(error: std::io::Error) -> CommandFlowError {
    CommandFlowError::Automation(error.to_string())
}

fn decode_command_output(raw: &[u8]) -> String {
    if raw.is_empty() {
        return String::new();
    }

    if let Ok(text) = String::from_utf8(raw.to_vec()) {
        return text;
    }

    #[cfg(target_os = "windows")]
    {
        let (decoded, _, had_errors) = GBK.decode(raw);
        if !had_errors {
            return decoded.into_owned();
        }
    }

    String::from_utf8_lossy(raw).into_owned()
}

fn parse_csv_line(line: &str) -> Vec<String> {
    let mut fields = Vec::new();
    let mut current = String::new();
    let mut chars = line.chars().peekable();
    let mut in_quotes = false;

    while let Some(ch) = chars.next() {
        match ch {
            '"' => {
                if in_quotes {
                    if matches!(chars.peek(), Some('"')) {
                        current.push('"');
                        let _ = chars.next();
                    } else {
                        in_quotes = false;
                    }
                } else {
                    in_quotes = true;
                }
            }
            ',' if !in_quotes => {
                fields.push(current.trim().to_string());
                current.clear();
            }
            _ => current.push(ch),
        }
    }

    fields.push(current.trim().to_string());
    fields
}

fn count_taskkill_success_lines(stdout: &str) -> u32 {
    stdout
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .filter(|line| {
            let lower = line.to_ascii_lowercase();
            lower.contains("success") || lower.contains("已终止") || lower.contains("终止进程")
        })
        .count() as u32
}

pub fn list_running_processes() -> CommandResult<Vec<RunningProcessEntry>> {
    #[cfg(target_os = "windows")]
    {
        let output = Command::new("tasklist")
            .args(["/FO", "CSV", "/NH"])
            .output()
            .map_err(io_to_automation)?;

        if !output.status.success() {
            let stderr = decode_command_output(&output.stderr).trim().to_string();
            return Err(CommandFlowError::Automation(if stderr.is_empty() {
                "执行 tasklist 失败。".to_string()
            } else {
                format!("执行 tasklist 失败：{}", stderr)
            }));
        }

        let stdout = decode_command_output(&output.stdout);
        let mut entries = Vec::<RunningProcessEntry>::new();

        for raw_line in stdout.lines() {
            let line = raw_line.trim();
            if line.is_empty() {
                continue;
            }
            if line.to_ascii_lowercase().starts_with("info:") {
                continue;
            }

            let columns = parse_csv_line(line);
            if columns.len() < 2 {
                continue;
            }

            let process_name = columns[0].trim().to_string();
            let pid = columns[1].trim().parse::<u32>().ok().unwrap_or(0);
            if process_name.is_empty() || pid == 0 {
                continue;
            }

            entries.push(RunningProcessEntry { process_name, pid });
        }

        entries.sort_by(|a, b| a.process_name.cmp(&b.process_name).then(a.pid.cmp(&b.pid)));
        entries.dedup_by(|a, b| a.pid == b.pid);

        Ok(entries)
    }

    #[cfg(not(target_os = "windows"))]
    {
        Ok(vec![])
    }
}

pub fn terminate_process_by_pid(
    pid: u32,
    force: bool,
    kill_tree: bool,
) -> CommandResult<TerminateProcessOutcome> {
    #[cfg(target_os = "windows")]
    {
        if pid == 0 {
            return Err(CommandFlowError::Validation("PID 必须大于 0。".to_string()));
        }

        let mut command = Command::new("taskkill");
        command.arg("/PID").arg(pid.to_string());
        if force {
            command.arg("/F");
        }
        if kill_tree {
            command.arg("/T");
        }

        let output = command.output().map_err(io_to_automation)?;
        let stdout = decode_command_output(&output.stdout).trim().to_string();
        let stderr = decode_command_output(&output.stderr).trim().to_string();

        if !output.status.success() {
            let detail = if !stderr.is_empty() {
                stderr.clone()
            } else if !stdout.is_empty() {
                stdout.clone()
            } else {
                format!("exit={}", output.status)
            };
            return Err(CommandFlowError::Automation(format!(
                "按 PID 终止进程失败（pid={}）：{}",
                pid, detail
            )));
        }

        let killed_count = count_taskkill_success_lines(&stdout).max(1);

        Ok(TerminateProcessOutcome {
            killed_count,
            stdout,
            stderr,
        })
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = pid;
        let _ = force;
        let _ = kill_tree;
        Err(CommandFlowError::Automation(
            "终止进程目前仅支持 Windows。".to_string(),
        ))
    }
}

pub fn terminate_process_by_name(
    process_name: &str,
    force: bool,
    kill_tree: bool,
) -> CommandResult<TerminateProcessOutcome> {
    #[cfg(target_os = "windows")]
    {
        let process_name = process_name.trim();
        if process_name.is_empty() {
            return Err(CommandFlowError::Validation(
                "进程名不能为空。".to_string(),
            ));
        }

        let mut command = Command::new("taskkill");
        command.arg("/IM").arg(process_name);
        if force {
            command.arg("/F");
        }
        if kill_tree {
            command.arg("/T");
        }

        let output = command.output().map_err(io_to_automation)?;
        let stdout = decode_command_output(&output.stdout).trim().to_string();
        let stderr = decode_command_output(&output.stderr).trim().to_string();

        if !output.status.success() {
            let detail = if !stderr.is_empty() {
                stderr.clone()
            } else if !stdout.is_empty() {
                stdout.clone()
            } else {
                format!("exit={}", output.status)
            };
            return Err(CommandFlowError::Automation(format!(
                "按进程名终止进程失败（name={}）：{}",
                process_name, detail
            )));
        }

        let killed_count = count_taskkill_success_lines(&stdout).max(1);

        Ok(TerminateProcessOutcome {
            killed_count,
            stdout,
            stderr,
        })
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = process_name;
        let _ = force;
        let _ = kill_tree;
        Err(CommandFlowError::Automation(
            "终止进程目前仅支持 Windows。".to_string(),
        ))
    }
}
