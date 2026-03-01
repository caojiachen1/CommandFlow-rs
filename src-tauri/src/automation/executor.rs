use crate::automation::{file_ops, image_match, keyboard, mouse, screenshot, window};
use arboard::Clipboard;
use base64::Engine as _;
use regex::Regex;
use reqwest::header::{AUTHORIZATION, CONTENT_TYPE};
use rfd::{MessageButtons, MessageDialog, MessageDialogResult, MessageLevel};
use crate::error::{CommandFlowError, CommandResult};
use crate::workflow::graph::WorkflowGraph;
use crate::workflow::node::{NodeKind, WorkflowNode};
use serde_json::{Number, Value};
use std::backtrace::Backtrace;
use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::ErrorKind;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use std::time::{SystemTime, UNIX_EPOCH};
use tokio::process::Command;
use tokio::time::{sleep, Duration};

const DEFAULT_POST_DELAY_MS: u64 = 50;
const IMAGE_MATCH_DEBUG_SAVE_EVERY: u64 = 15;
const PARAM_INPUT_PREFIX: &str = "param:";
const PARAM_INPUT_SUFFIX: &str = ":in";

#[derive(Debug, Default)]
pub struct WorkflowExecutor;

#[derive(Debug, Default)]
struct ExecutionContext {
    variables: HashMap<String, Value>,
    loop_remaining: HashMap<String, u64>,
    while_iterations: HashMap<String, u64>,
    node_outputs: HashMap<String, HashMap<String, Value>>,
}

enum NextDirective {
    Default,
    Branch(&'static str),
}

impl WorkflowExecutor {
    pub async fn execute(&self, graph: &WorkflowGraph) -> CommandResult<()> {
        let mut noop = |_node: &WorkflowNode| {};
        let mut noop_vars = |_variables: &HashMap<String, Value>| {};
        let mut noop_log = |_level: &str, _message: String| {};
        let never_cancel = || false;
        self.execute_with_progress(
            graph,
            &mut noop,
            &mut noop_vars,
            &mut noop_log,
            &never_cancel,
        )
            .await
    }

    pub async fn execute_with_progress<F, G, H, I>(
        &self,
        graph: &WorkflowGraph,
        on_node_start: &mut F,
        on_variables_update: &mut G,
        on_log: &mut H,
        should_cancel: &I,
    ) -> CommandResult<()>
    where
        F: FnMut(&WorkflowNode),
        G: FnMut(&HashMap<String, Value>),
        H: FnMut(&str, String),
        I: Fn() -> bool,
    {
        if graph.nodes.is_empty() {
            return Err(CommandFlowError::Validation(
                "workflow has no executable nodes".to_string(),
            ));
        }

        let node_map: HashMap<&str, &WorkflowNode> =
            graph.nodes.iter().map(|node| (node.id.as_str(), node)).collect();

        let mut incoming_count: HashMap<&str, usize> =
            graph.nodes.iter().map(|node| (node.id.as_str(), 0)).collect();
        for edge in &graph.edges {
            if !is_control_flow_edge(edge.source_handle.as_deref(), edge.target_handle.as_deref()) {
                continue;
            }
            if let Some(in_count) = incoming_count.get_mut(edge.target.as_str()) {
                *in_count += 1;
            }
        }

        let manual_trigger_starts: Vec<&str> = graph
            .nodes
            .iter()
            .filter(|node| is_manual_trigger(&node.kind))
            .map(|node| node.id.as_str())
            .collect();

        let auto_trigger_starts: Vec<&str> = graph
            .nodes
            .iter()
            .filter(|node| is_trigger(&node.kind) && !is_manual_trigger(&node.kind))
            .map(|node| node.id.as_str())
            .collect();

        let starts: Vec<&str> = if !manual_trigger_starts.is_empty() {
            manual_trigger_starts
        } else if auto_trigger_starts.len() == 1 {
            auto_trigger_starts
        } else if auto_trigger_starts.len() > 1 {
            return Err(CommandFlowError::Validation(
                "workflow has multiple non-manual triggers; direct run requires exactly one trigger or at least one manual trigger".to_string(),
            ));
        } else {
            let roots: Vec<&str> = graph
                .nodes
                .iter()
                .filter(|node| incoming_count.get(node.id.as_str()).copied().unwrap_or(0) == 0)
                .map(|node| node.id.as_str())
                .collect();
            if roots.is_empty() {
                vec![graph.nodes[0].id.as_str()]
            } else {
                roots
            }
        };

        let mut visited_entry = HashSet::<String>::new();
        let mut ctx = ExecutionContext::default();
        for start in starts {
            if visited_entry.insert(start.to_string()) {
                self.execute_from_node(
                    start,
                    graph,
                    &node_map,
                    &mut ctx,
                    on_node_start,
                    on_variables_update,
                    on_log,
                    should_cancel,
                )
                    .await?;
            }
        }

        Ok(())
    }

    async fn execute_from_node(
        &self,
        start_id: &str,
        graph: &WorkflowGraph,
        node_map: &HashMap<&str, &WorkflowNode>,
        ctx: &mut ExecutionContext,
        on_node_start: &mut impl FnMut(&WorkflowNode),
        on_variables_update: &mut impl FnMut(&HashMap<String, Value>),
        on_log: &mut impl FnMut(&str, String),
        should_cancel: &impl Fn() -> bool,
    ) -> CommandResult<()> {
        let mut current_id = start_id.to_string();
        let mut guard_steps = 0usize;
        let mut loop_stack: Vec<String> = Vec::new();

        while guard_steps < 10_000 {
            if should_cancel() {
                return Err(CommandFlowError::Canceled);
            }

            guard_steps += 1;
            let node = node_map.get(current_id.as_str()).ok_or_else(|| {
                CommandFlowError::Validation(format!("node '{}' not found", current_id))
            })?;
            let effective_node = resolve_node_with_data_inputs(node, graph, ctx);

            on_node_start(&effective_node);

            if matches!(effective_node.kind, NodeKind::Loop | NodeKind::WhileLoop) {
                let outgoing: Vec<_> = graph
                    .edges
                    .iter()
                    .filter(|edge| {
                        edge.source == current_id
                            && is_control_flow_edge(edge.source_handle.as_deref(), edge.target_handle.as_deref())
                    })
                    .collect();

                let loop_edge = outgoing
                    .iter()
                    .find(|edge| edge.source_handle.as_deref() == Some("loop"))
                    .copied()
                    .or_else(|| outgoing.first().copied());

                let done_edge = outgoing
                    .iter()
                    .find(|edge| edge.source_handle.as_deref() == Some("done"))
                    .copied()
                    .or_else(|| {
                        outgoing
                            .iter()
                            .find(|edge| edge.source_handle.as_deref() != Some("loop"))
                            .copied()
                    });

                on_variables_update(&ctx.variables);

                match effective_node.kind {
                    NodeKind::Loop => {
                        let times = get_u64(&effective_node, "times", 1);
                        let remaining = ctx
                            .loop_remaining
                            .entry(effective_node.id.clone())
                            .or_insert(times);

                        if *remaining > 0 {
                            if let Some(edge) = loop_edge {
                                *remaining -= 1;

                                if loop_stack.last().map(String::as_str) != Some(effective_node.id.as_str()) {
                                    loop_stack.push(effective_node.id.clone());
                                }

                                sleep_after_node(&effective_node, should_cancel).await?;
                                current_id = edge.target.clone();
                                continue;
                            }

                            *remaining = 0;
                        }

                        ctx.loop_remaining.remove(&effective_node.id);
                        if loop_stack.last().map(String::as_str) == Some(effective_node.id.as_str()) {
                            loop_stack.pop();
                        }

                        if let Some(edge) = done_edge {
                            sleep_after_node(&effective_node, should_cancel).await?;
                            current_id = edge.target.clone();
                            continue;
                        }

                        if let Some(parent_loop_id) = loop_stack.last() {
                            sleep_after_node(&effective_node, should_cancel).await?;
                            current_id = parent_loop_id.clone();
                            continue;
                        }

                        sleep_after_node(&effective_node, should_cancel).await?;
                        return Ok(());
                    }
                    NodeKind::WhileLoop => {
                        let max_iterations = get_u64(&effective_node, "maxIterations", 1000).max(1);
                        let condition_true = evaluate_condition(&effective_node, &ctx.variables);
                        let iterations = ctx
                            .while_iterations
                            .entry(effective_node.id.clone())
                            .or_insert(0);

                        if condition_true && *iterations < max_iterations {
                            if let Some(edge) = loop_edge {
                                *iterations += 1;

                                if loop_stack.last().map(String::as_str) != Some(effective_node.id.as_str()) {
                                    loop_stack.push(effective_node.id.clone());
                                }

                                sleep_after_node(&effective_node, should_cancel).await?;
                                current_id = edge.target.clone();
                                continue;
                            }
                        } else if condition_true && *iterations >= max_iterations {
                            on_log(
                                "warn",
                                format!(
                                    "while 节点 '{}' 达到最大循环次数 {}，已自动切换 done 分支。",
                                    effective_node.label, max_iterations
                                ),
                            );
                        }

                        ctx.while_iterations.remove(&effective_node.id);
                        if loop_stack.last().map(String::as_str) == Some(effective_node.id.as_str()) {
                            loop_stack.pop();
                        }

                        if let Some(edge) = done_edge {
                            sleep_after_node(&effective_node, should_cancel).await?;
                            current_id = edge.target.clone();
                            continue;
                        }

                        if let Some(parent_loop_id) = loop_stack.last() {
                            sleep_after_node(&effective_node, should_cancel).await?;
                            current_id = parent_loop_id.clone();
                            continue;
                        }

                        sleep_after_node(&effective_node, should_cancel).await?;
                        return Ok(());
                    }
                    _ => {}
                }
            }

            let directive = self
                .execute_single_node(&effective_node, ctx, on_log, should_cancel)
                .await?;
            sleep_after_node(&effective_node, should_cancel).await?;
            on_variables_update(&ctx.variables);

            let outgoing = graph
                .edges
                .iter()
                .filter(|edge| {
                    edge.source == current_id
                        && is_control_flow_edge(edge.source_handle.as_deref(), edge.target_handle.as_deref())
                });
            let next = match directive {
                NextDirective::Default => outgoing.into_iter().next(),
                NextDirective::Branch(handle) => graph
                    .edges
                    .iter()
                    .find(|edge| {
                        edge.source == current_id
                            && edge.source_handle.as_deref() == Some(handle)
                            && is_control_flow_edge(edge.source_handle.as_deref(), edge.target_handle.as_deref())
                    }),
            };

            match next {
                Some(edge) => current_id = edge.target.clone(),
                None => {
                    if let Some(active_loop_id) = loop_stack.last() {
                        current_id = active_loop_id.clone();
                        continue;
                    }
                    return Ok(());
                }
            }
        }

        Err(CommandFlowError::Validation(format!(
            "possible infinite loop detected near node '{}'",
            current_id
        )))
    }

    async fn execute_single_node(
        &self,
        node: &WorkflowNode,
        ctx: &mut ExecutionContext,
        on_log: &mut impl FnMut(&str, String),
        should_cancel: &impl Fn() -> bool,
    ) -> CommandResult<NextDirective> {
        ctx.node_outputs
            .insert(node.id.clone(), HashMap::<String, Value>::new());

        match node.kind {
            NodeKind::HotkeyTrigger => {
                let hotkey = get_string(node, "hotkey", "Ctrl+Shift+R");
                let timeout_ms = get_u64(node, "timeoutMs", 30_000);
                let poll_ms = get_u64(node, "pollMs", 50);
                keyboard::wait_for_hotkey(&hotkey, timeout_ms, poll_ms).await?;
                Ok(NextDirective::Default)
            }
            NodeKind::TimerTrigger => {
                let interval_ms = get_u64(node, "intervalMs", 1000);
                interruptible_sleep(Duration::from_millis(interval_ms), should_cancel).await?;
                Ok(NextDirective::Default)
            }
            NodeKind::ManualTrigger => Ok(NextDirective::Default),
            NodeKind::WindowTrigger => {
                let title = get_string(node, "title", "");
                let match_mode = get_string(node, "matchMode", "contains");
                let timeout_ms = get_u64(node, "timeoutMs", 30_000);
                let poll_ms = get_u64(node, "pollMs", 250);

                if title.trim().is_empty() {
                    return Err(CommandFlowError::Validation(format!(
                        "node '{}' window trigger title is empty",
                        node.id
                    )));
                }

                let poll_interval = Duration::from_millis(poll_ms.max(10));
                let deadline = Duration::from_millis(timeout_ms);
                let started = tokio::time::Instant::now();

                loop {
                    if should_cancel() {
                        return Err(CommandFlowError::Canceled);
                    }

                    if window::window_title_exists(&title, &match_mode)? {
                        break;
                    }

                    if started.elapsed() >= deadline {
                        return Err(CommandFlowError::Automation(format!(
                            "window trigger timed out after {} ms waiting for foreground window title '{}'",
                            timeout_ms, title
                        )));
                    }

                    interruptible_sleep(poll_interval, should_cancel).await?;
                }

                set_node_output(ctx, node, "title", Value::String(title));

                Ok(NextDirective::Default)
            }
            NodeKind::MouseClick => {
                let x = get_i32(node, "x", 0);
                let y = get_i32(node, "y", 0);
                let times = get_u64(node, "times", 1) as usize;
                mouse::click(x, y, times.max(1))?;
                set_node_output(ctx, node, "x", value_from_i32(x));
                set_node_output(ctx, node, "y", value_from_i32(y));
                Ok(NextDirective::Default)
            }
            NodeKind::MouseMove => {
                let x = get_i32(node, "x", 0);
                let y = get_i32(node, "y", 0);
                mouse::move_to(x, y)?;
                set_node_output(ctx, node, "x", value_from_i32(x));
                set_node_output(ctx, node, "y", value_from_i32(y));
                Ok(NextDirective::Default)
            }
            NodeKind::MouseDrag => {
                let from_x = get_i32(node, "fromX", 0);
                let from_y = get_i32(node, "fromY", 0);
                let to_x = get_i32(node, "toX", 0);
                let to_y = get_i32(node, "toY", 0);
                mouse::drag(from_x, from_y, to_x, to_y)?;
                set_node_output(ctx, node, "toX", value_from_i32(to_x));
                set_node_output(ctx, node, "toY", value_from_i32(to_y));
                Ok(NextDirective::Default)
            }
            NodeKind::MouseWheel => {
                let vertical = get_i32(node, "vertical", -1);
                mouse::wheel(vertical)?;
                set_node_output(ctx, node, "vertical", value_from_i32(vertical));
                Ok(NextDirective::Default)
            }
            NodeKind::MouseDown => {
                let x = get_i32(node, "x", 0);
                let y = get_i32(node, "y", 0);
                let button = get_string(node, "button", "left");
                mouse::button_down(x, y, &button)?;
                set_node_output(ctx, node, "x", value_from_i32(x));
                set_node_output(ctx, node, "y", value_from_i32(y));
                set_node_output(ctx, node, "button", Value::String(button));
                Ok(NextDirective::Default)
            }
            NodeKind::MouseUp => {
                let x = get_i32(node, "x", 0);
                let y = get_i32(node, "y", 0);
                let button = get_string(node, "button", "left");
                mouse::button_up(x, y, &button)?;
                set_node_output(ctx, node, "x", value_from_i32(x));
                set_node_output(ctx, node, "y", value_from_i32(y));
                set_node_output(ctx, node, "button", Value::String(button));
                Ok(NextDirective::Default)
            }
            NodeKind::KeyboardKey => {
                let key = get_string(node, "key", "Enter");
                keyboard::key_tap_by_name(&key)?;
                set_node_output(ctx, node, "key", Value::String(key));
                Ok(NextDirective::Default)
            }
            NodeKind::KeyboardInput => {
                let text = get_string(node, "text", "");
                keyboard::text_input(&text)?;
                set_node_output(ctx, node, "text", Value::String(text));
                Ok(NextDirective::Default)
            }
            NodeKind::KeyboardDown => {
                let key = get_string(node, "key", "Shift");
                let simulate_repeat = get_bool(node, "simulateRepeat", false);

                if simulate_repeat {
                    let repeat_count = get_u64(node, "repeatCount", 8).max(1);
                    let repeat_interval_ms = get_u64(node, "repeatIntervalMs", 35).max(1);

                    for i in 0..repeat_count {
                        if should_cancel() {
                            return Err(CommandFlowError::Canceled);
                        }

                        keyboard::key_tap_by_name(&key)?;
                        if i + 1 < repeat_count {
                            interruptible_sleep(Duration::from_millis(repeat_interval_ms), should_cancel)
                                .await?;
                        }
                    }
                } else {
                    keyboard::key_down_by_name(&key)?;
                }

                set_node_output(ctx, node, "key", Value::String(key));

                Ok(NextDirective::Default)
            }
            NodeKind::KeyboardUp => {
                let key = get_string(node, "key", "Shift");
                keyboard::key_up_by_name(&key)?;
                set_node_output(ctx, node, "key", Value::String(key));
                Ok(NextDirective::Default)
            }
            NodeKind::Shortcut => {
                let key = get_string(node, "key", "S");
                let modifiers = get_string_array(node, "modifiers", vec!["Ctrl".to_string()]);
                keyboard::shortcut(&modifiers, &key)?;
                set_node_output(ctx, node, "key", Value::String(key));
                Ok(NextDirective::Default)
            }
            NodeKind::Screenshot => {
                let output_path = resolve_screenshot_output_path(node)?;
                let fullscreen = get_bool(node, "fullscreen", false);

                let (rgba, width, height) = if fullscreen {
                    screenshot::capture_fullscreen_rgba()?
                } else {
                    let width = get_u32(node, "width", 320);
                    let height = get_u32(node, "height", 240);
                    screenshot::capture_region_rgba(width.max(1), height.max(1))?
                };

                let screenshot_base64 = screenshot::encode_rgba_to_png_base64(&rgba, width, height)?;
                set_node_output(ctx, node, "screenshot", Value::String(screenshot_base64));

                if let Some(path) = output_path {
                    screenshot::save_rgba_image(&path, rgba, width, height)?;
                    set_node_output(ctx, node, "path", Value::String(path));
                } else {
                    set_node_output(ctx, node, "path", Value::String(String::new()));
                }
                Ok(NextDirective::Default)
            }
            NodeKind::GuiAgent => {
                execute_gui_agent_action(node, should_cancel, on_log).await?;
                Ok(NextDirective::Default)
            }
            NodeKind::WindowActivate => {
                let switch_mode = get_string(node, "switchMode", "title");
                if switch_mode.eq_ignore_ascii_case("shortcut") {
                    let shortcut = get_string(node, "shortcut", "Alt+Tab");
                    let times = get_u64(node, "shortcutTimes", 1).max(1);
                    let interval_ms = get_u64(node, "shortcutIntervalMs", 120).max(1);
                    for i in 0..times {
                        if should_cancel() {
                            return Err(CommandFlowError::Canceled);
                        }

                        keyboard::shortcut_by_hotkey(&shortcut)?;
                        if i + 1 < times {
                            interruptible_sleep(Duration::from_millis(interval_ms), should_cancel)
                                .await?;
                        }
                    }
                    set_node_output(ctx, node, "title", Value::String(shortcut));
                } else {
                    let title = get_string(node, "title", "");
                    window::activate_window(&title)?;
                    set_node_output(ctx, node, "title", Value::String(title));
                }
                Ok(NextDirective::Default)
            }
            NodeKind::FileCopy => {
                let source_path = get_string(node, "sourcePath", "");
                let target_path = get_string(node, "targetPath", "");
                let overwrite = get_bool(node, "overwrite", false);
                let recursive = get_bool(node, "recursive", true);

                if source_path.trim().is_empty() || target_path.trim().is_empty() {
                    return Err(CommandFlowError::Validation(format!(
                        "node '{}' sourcePath/targetPath cannot be empty",
                        node.id
                    )));
                }

                file_ops::copy_path(&source_path, &target_path, overwrite, recursive)?;
                set_node_output(ctx, node, "targetPath", Value::String(target_path));
                Ok(NextDirective::Default)
            }
            NodeKind::FileMove => {
                let source_path = get_string(node, "sourcePath", "");
                let target_path = get_string(node, "targetPath", "");
                let overwrite = get_bool(node, "overwrite", false);

                if source_path.trim().is_empty() || target_path.trim().is_empty() {
                    return Err(CommandFlowError::Validation(format!(
                        "node '{}' sourcePath/targetPath cannot be empty",
                        node.id
                    )));
                }

                file_ops::move_path(&source_path, &target_path, overwrite)?;
                set_node_output(ctx, node, "targetPath", Value::String(target_path));
                Ok(NextDirective::Default)
            }
            NodeKind::FileDelete => {
                let path = get_string(node, "path", "");
                let recursive = get_bool(node, "recursive", true);

                if path.trim().is_empty() {
                    return Err(CommandFlowError::Validation(format!(
                        "node '{}' path cannot be empty",
                        node.id
                    )));
                }

                file_ops::delete_path(&path, recursive)?;
                set_node_output(ctx, node, "path", Value::String(path));
                Ok(NextDirective::Default)
            }
            NodeKind::RunCommand => {
                let command = get_string(node, "command", "");
                if command.trim().is_empty() {
                    return Err(CommandFlowError::Validation(format!(
                        "node '{}' command is empty",
                        node.id
                    )));
                }
                let use_shell = get_bool(node, "shell", true);
                run_system_command(&command, use_shell).await?;
                set_node_output(ctx, node, "command", Value::String(command));
                Ok(NextDirective::Default)
            }
            NodeKind::PythonCode => {
                run_python_code(node, on_log).await?;
                Ok(NextDirective::Default)
            }
            NodeKind::ClipboardRead => {
                let mut clipboard = Clipboard::new()
                    .map_err(|error| CommandFlowError::Automation(format!("初始化系统剪贴板失败：{}", error)))?;
                let text = clipboard
                    .get_text()
                    .map_err(|error| CommandFlowError::Automation(format!("读取系统剪贴板失败：{}", error)))?;
                set_node_output(ctx, node, "text", Value::String(text.clone()));

                let output_var = get_string(node, "outputVar", "clipboardText").trim().to_string();
                if !output_var.is_empty() {
                    ctx.variables.insert(output_var.clone(), Value::String(text.clone()));
                    on_log(
                        "info",
                        format!(
                            "剪贴板读取节点 '{}' 已输出 {} 字符到变量 '{}'。",
                            node.label,
                            text.chars().count(),
                            output_var
                        ),
                    );
                } else {
                    on_log(
                        "info",
                        format!(
                            "剪贴板读取节点 '{}' 读取到 {} 字符（未配置输出变量）。",
                            node.label,
                            text.chars().count()
                        ),
                    );
                }

                Ok(NextDirective::Default)
            }
            NodeKind::ClipboardWrite => {
                let text = resolve_text_input(node, &ctx.variables);
                let mut clipboard = Clipboard::new()
                    .map_err(|error| CommandFlowError::Automation(format!("初始化系统剪贴板失败：{}", error)))?;
                clipboard
                    .set_text(text.clone())
                    .map_err(|error| CommandFlowError::Automation(format!("写入系统剪贴板失败：{}", error)))?;
                on_log(
                    "info",
                    format!(
                        "剪贴板写入节点 '{}' 已写入 {} 字符。",
                        node.label,
                        text.chars().count()
                    ),
                );
                Ok(NextDirective::Default)
            }
            NodeKind::FileReadText => {
                let path_raw = get_string(node, "path", "");
                let path = resolve_text_template(&path_raw, &ctx.variables);
                if path.trim().is_empty() {
                    return Err(CommandFlowError::Validation(format!(
                        "node '{}' path cannot be empty",
                        node.id
                    )));
                }

                let content = fs::read_to_string(&path)
                    .map_err(|error| CommandFlowError::Io(format!("读取文本文件失败 '{}': {}", path, error)))?;
                set_node_output(ctx, node, "text", Value::String(content.clone()));
                let output_var = get_string(node, "outputVar", "fileText").trim().to_string();

                if !output_var.is_empty() {
                    ctx.variables.insert(output_var.clone(), Value::String(content.clone()));
                    on_log(
                        "info",
                        format!(
                            "文本读取节点 '{}' 已读取 {} 字符到变量 '{}'。",
                            node.label,
                            content.chars().count(),
                            output_var
                        ),
                    );
                } else {
                    on_log(
                        "info",
                        format!(
                            "文本读取节点 '{}' 已读取 {} 字符（未配置输出变量）。",
                            node.label,
                            content.chars().count()
                        ),
                    );
                }

                Ok(NextDirective::Default)
            }
            NodeKind::FileWriteText => {
                let path_raw = get_string(node, "path", "");
                let path = resolve_text_template(&path_raw, &ctx.variables);
                if path.trim().is_empty() {
                    return Err(CommandFlowError::Validation(format!(
                        "node '{}' path cannot be empty",
                        node.id
                    )));
                }

                let text = resolve_text_input(node, &ctx.variables);
                let append = get_bool(node, "append", false);
                let create_parent_dir = get_bool(node, "createParentDir", true);
                write_text_file(&path, &text, append, create_parent_dir)?;
                set_node_output(ctx, node, "path", Value::String(path.clone()));

                on_log(
                    "info",
                    format!(
                        "文本写入节点 '{}' 已{} {} 字符到 '{}'。",
                        node.label,
                        if append { "追加" } else { "写入" },
                        text.chars().count(),
                        path
                    ),
                );
                Ok(NextDirective::Default)
            }
            NodeKind::ShowMessage => {
                let title_raw = get_string(node, "title", "CommandFlow");
                let title = resolve_text_template(&title_raw, &ctx.variables);
                let message = resolve_text_input(node, &ctx.variables);
                let level = get_string(node, "level", "info");
                set_node_output(ctx, node, "message", Value::String(message.clone()));

                show_message_dialog(&title, &message, &level)?;
                on_log(
                    "info",
                    format!(
                        "弹窗节点 '{}' 已显示（级别={}，{} 字符）。",
                        node.label,
                        level,
                        message.chars().count()
                    ),
                );
                Ok(NextDirective::Default)
            }
            NodeKind::Delay => {
                let duration = get_u64(node, "ms", 100);
                interruptible_sleep(Duration::from_millis(duration), should_cancel).await?;
                set_node_output(ctx, node, "ms", value_from_u64(duration));
                Ok(NextDirective::Default)
            }
            NodeKind::Condition => {
                let condition_true = evaluate_condition(node, &ctx.variables);
                Ok(if condition_true {
                    NextDirective::Branch("true")
                } else {
                    NextDirective::Branch("false")
                })
            }
            NodeKind::Loop => {
                let times = get_u64(node, "times", 1);
                let remaining = ctx
                    .loop_remaining
                    .entry(node.id.clone())
                    .or_insert(times);

                if *remaining > 0 {
                    *remaining -= 1;
                    Ok(NextDirective::Branch("loop"))
                } else {
                    ctx.loop_remaining.remove(&node.id);
                    Ok(NextDirective::Branch("done"))
                }
            }
            NodeKind::WhileLoop => {
                let max_iterations = get_u64(node, "maxIterations", 1000).max(1);
                let iterations = ctx.while_iterations.entry(node.id.clone()).or_insert(0);
                let condition_true = evaluate_condition(node, &ctx.variables);

                if condition_true && *iterations < max_iterations {
                    *iterations += 1;
                    Ok(NextDirective::Branch("loop"))
                } else {
                    if condition_true && *iterations >= max_iterations {
                        on_log(
                            "warn",
                            format!(
                                "while 节点 '{}' 达到最大循环次数 {}，已自动切换 done 分支。",
                                node.label, max_iterations
                            ),
                        );
                    }
                    ctx.while_iterations.remove(&node.id);
                    Ok(NextDirective::Branch("done"))
                }
            }
            NodeKind::ImageMatch => {
                let template_path = get_string(node, "templatePath", "");
                if template_path.trim().is_empty() {
                    return Err(CommandFlowError::Validation(format!(
                        "node '{}' templatePath cannot be empty",
                        node.id
                    )));
                }

                let source_path = get_string(node, "sourcePath", "");
                let threshold = get_f32(node, "threshold", 0.99).clamp(0.0, 1.0);
                let timeout_ms = get_u64(node, "timeoutMs", 10_000);
                let poll_ms = get_u64(node, "pollMs", 16).max(1);
                let click_on_match = get_bool(node, "clickOnMatch", false);
                let click_times = get_u64(node, "clickTimes", 1).max(1) as usize;
                let confirm_frames = get_u64(node, "confirmFrames", 2).max(1);
                let debug_save_every = IMAGE_MATCH_DEBUG_SAVE_EVERY;
                let mut matcher = image_match::TemplateMatcher::from_path(&template_path, threshold)?;
                let debug_dir = prepare_image_match_debug_dir(node)?;

                let started = tokio::time::Instant::now();
                let deadline = Duration::from_millis(timeout_ms);
                let poll_interval = Duration::from_millis(poll_ms);
                let fast_confirm_interval = Duration::from_millis(1);
                let mut attempts: u64 = 0;
                let mut matched_streak: u64 = 0;
                let mut best_similarity_seen = 0.0_f32;

                if !source_path.trim().is_empty() {
                    let source = image::open(&source_path)
                        .map_err(|error| CommandFlowError::Automation(error.to_string()))?
                        .to_luma8();
                    let evaluation = matcher.evaluate(&source);
                    best_similarity_seen = best_similarity_seen.max(evaluation.best_similarity);
                    set_node_output(
                        ctx,
                        node,
                        "similarity",
                        value_from_f64(evaluation.best_similarity as f64),
                    );
                    on_log(
                        "info",
                        format!(
                            "图像匹配节点 '{}'：静态源图匹配，bestSimilarity={:.4}，threshold={:.2}。",
                            node.label, evaluation.best_similarity, threshold
                        ),
                    );

                    if let Some((x, y)) = evaluation.matched_point {
                        set_node_output(ctx, node, "matchX", value_from_i32(x));
                        set_node_output(ctx, node, "matchY", value_from_i32(y));
                        on_log(
                            "info",
                            format!(
                                "图像匹配节点 '{}' 命中，坐标=({}, {})，阈值={}。",
                                node.label, x, y, threshold
                            ),
                        );
                        if click_on_match {
                            mouse::click(x, y, click_times)?;
                        }
                        return Ok(NextDirective::Branch("true"));
                    }

                    let debug_path = debug_dir.join("static-source-gray.png");
                    let rect = evaluation.best_top_left.map(|(x, y)| {
                        (
                            x,
                            y,
                            evaluation.template_size.0,
                            evaluation.template_size.1,
                        )
                    });
                    let _ = screenshot::save_gray_with_box(
                        path_to_string(&debug_path)?,
                        &source,
                        rect,
                        evaluation.matched_point.is_some(),
                    );

                    on_log(
                        "warn",
                        format!(
                            "图像匹配节点 '{}' 静态源图未命中（bestSimilarity={:.4}），已走 false 分支。",
                            node.label, best_similarity_seen
                        ),
                    );
                    return Ok(NextDirective::Branch("false"));
                }

                screenshot::ensure_primary_frame_stream().map_err(|error| {
                    let bt = Backtrace::force_capture();
                    CommandFlowError::Automation(format!(
                        "imageMatch xcap stream init failed at node '{}': {}\nbacktrace:\n{}",
                        node.label, error, bt
                    ))
                })?;

                on_log(
                    "info",
                    format!(
                        "图像匹配节点 '{}' 已启用 xcap 实时帧流匹配。",
                        node.label
                    ),
                );

                let mut stream_recover_attempted = false;

                loop {
                    if should_cancel() {
                        let _ = screenshot::stop_primary_frame_stream();
                        return Err(CommandFlowError::Canceled);
                    }

                    let fast_confirm_mode = matched_streak > 0 && matched_streak < confirm_frames;
                    let stream_recv_timeout = if fast_confirm_mode {
                        fast_confirm_interval
                    } else {
                        poll_interval
                    };

                    let recv_result = tokio::task::block_in_place(|| {
                        screenshot::recv_primary_frame_gray_timeout(stream_recv_timeout)
                    });

                    let frame = match recv_result {
                        Ok(frame) => frame,
                        Err(error) => {
                            if !stream_recover_attempted {
                                stream_recover_attempted = true;
                                on_log(
                                    "warn",
                                    format!(
                                        "图像匹配节点 '{}' 帧流接收异常，尝试重置并重建 xcap 实例：{}",
                                        node.label, error
                                    ),
                                );

                                let _ = screenshot::reset_primary_frame_stream("image_match_recv_failed");
                                screenshot::ensure_primary_frame_stream().map_err(|reinit_error| {
                                    let bt = Backtrace::force_capture();
                                    CommandFlowError::Automation(format!(
                                        "imageMatch xcap stream recover failed at node '{}': recv_error={}, reinit_error={}\nbacktrace:\n{}",
                                        node.label, error, reinit_error, bt
                                    ))
                                })?;
                                continue;
                            }

                            let bt = Backtrace::force_capture();
                            return Err(CommandFlowError::Automation(format!(
                                "imageMatch xcap stream recv failed at node '{}': {}\nbacktrace:\n{}",
                                node.label, error, bt
                            )));
                        }
                    };

                    let Some(frame) = frame else {
                        if started.elapsed() >= deadline {
                            let _ = screenshot::stop_primary_frame_stream();
                            on_log(
                                "warn",
                                format!(
                                    "图像匹配节点 '{}' 在 {}ms 内未命中，bestSimilarity={:.4}，已走 false 分支。",
                                    node.label, timeout_ms, best_similarity_seen
                                ),
                            );
                            return Ok(NextDirective::Branch("false"));
                        }
                        continue;
                    };

                    attempts += 1;

                    let evaluation = matcher.evaluate(&frame);
                    best_similarity_seen = best_similarity_seen.max(evaluation.best_similarity);
                    let elapsed_ms = started.elapsed().as_millis();

                    if attempts % debug_save_every == 0 {
                        let frame_path = debug_dir.join(format!(
                            "frame-{:05}-sim-{:.4}.png",
                            attempts, evaluation.best_similarity
                        ));
                        let rect = evaluation.best_top_left.map(|(x, y)| {
                            (
                                x,
                                y,
                                evaluation.template_size.0,
                                evaluation.template_size.1,
                            )
                        });
                        let _ = screenshot::save_gray_with_box(
                            path_to_string(&frame_path)?,
                            &frame,
                            rect,
                            evaluation.matched_point.is_some(),
                        );
                    }

                    on_log(
                        "info",
                        format!(
                            "图像匹配节点 '{}' 第 {} 帧匹配，elapsed={}ms，bestSimilarity={:.4}，threshold={:.2}，confirm={}/{}。",
                            node.label,
                            attempts,
                            elapsed_ms,
                            evaluation.best_similarity,
                            threshold,
                            matched_streak,
                            confirm_frames
                        ),
                    );

                    if evaluation.matched_point.is_some() {
                        matched_streak += 1;
                    } else {
                        matched_streak = 0;
                    }

                    set_node_output(
                        ctx,
                        node,
                        "similarity",
                        value_from_f64(evaluation.best_similarity as f64),
                    );

                    if matched_streak >= confirm_frames {
                        let (x, y) = evaluation
                            .matched_point
                            .ok_or_else(|| CommandFlowError::Automation("matched point missing".to_string()))?;
                        set_node_output(ctx, node, "matchX", value_from_i32(x));
                        set_node_output(ctx, node, "matchY", value_from_i32(y));
                        let _ = screenshot::stop_primary_frame_stream();
                        on_log(
                            "info",
                            format!(
                                "图像匹配节点 '{}' 连续命中 {} 帧，坐标=({}, {})，阈值={}，已确认通过。",
                                node.label, confirm_frames, x, y, threshold
                            ),
                        );

                        let frame_path = debug_dir.join(format!(
                            "match-{:05}-sim-{:.4}.png",
                            attempts, evaluation.best_similarity
                        ));
                        let rect = evaluation.best_top_left.map(|(x, y)| {
                            (
                                x,
                                y,
                                evaluation.template_size.0,
                                evaluation.template_size.1,
                            )
                        });
                        let _ = screenshot::save_gray_with_box(
                            path_to_string(&frame_path)?,
                            &frame,
                            rect,
                            true,
                        );

                        if click_on_match {
                            mouse::click(x, y, click_times)?;
                        }
                        return Ok(NextDirective::Branch("true"));
                    }

                    if started.elapsed() >= deadline {
                        let _ = screenshot::stop_primary_frame_stream();
                        on_log(
                            "warn",
                            format!(
                                "图像匹配节点 '{}' 在 {}ms 内未命中（peakSimilarity={:.4}），已走 false 分支。",
                                node.label, timeout_ms, best_similarity_seen
                            ),
                        );
                        return Ok(NextDirective::Branch("false"));
                    }
                }
            }
            NodeKind::VarDefine => {
                let name = get_string(node, "name", "");
                if !name.trim().is_empty() {
                    let value = resolve_typed_param_value(node, "value");
                    set_node_output(ctx, node, "value", value.clone());
                    ctx.variables.entry(name).or_insert(value);
                }
                Ok(NextDirective::Default)
            }
            NodeKind::VarSet => {
                let name = get_string(node, "name", "");
                if !name.trim().is_empty() {
                    let value = resolve_typed_param_value(node, "value");
                    set_node_output(ctx, node, "value", value.clone());
                    ctx.variables.insert(name, value);
                }
                Ok(NextDirective::Default)
            }
            NodeKind::VarMath => {
                let name = get_string(node, "name", "");
                if name.trim().is_empty() {
                    return Err(CommandFlowError::Validation(format!(
                        "node '{}' variable name cannot be empty",
                        node.id
                    )));
                }

                let operation = get_string(node, "operation", "add").to_lowercase();
                let assign_to_variable = get_bool(node, "assignToVariable", true);
                let operand = as_f64(&resolve_typed_param_value(node, "operand"));
                let current = ctx.variables.get(&name).map(as_f64).unwrap_or(0.0);
                let current_i64 = current as i64;
                let operand_i64 = operand as i64;
                let shift_bits = operand_i64.max(0) as u32;

                let bool_to_num = |v: bool| if v { 1.0 } else { 0.0 };
                let as_bool = |v: f64| v.abs() > f64::EPSILON;

                let result = match operation.as_str() {
                    "add" | "+" => current + operand,
                    "sub" | "-" => current - operand,
                    "mul" | "*" => current * operand,
                    "div" | "/" => {
                        if operand.abs() < f64::EPSILON {
                            return Err(CommandFlowError::Validation(format!(
                                "node '{}' division by zero",
                                node.id
                            )));
                        }
                        current / operand
                    }
                    "mod" | "%" => {
                        if operand.abs() < f64::EPSILON {
                            return Err(CommandFlowError::Validation(format!(
                                "node '{}' modulo by zero",
                                node.id
                            )));
                        }
                        current.rem_euclid(operand)
                    }
                    "rem" => {
                        if operand.abs() < f64::EPSILON {
                            return Err(CommandFlowError::Validation(format!(
                                "node '{}' remainder by zero",
                                node.id
                            )));
                        }
                        current % operand
                    }
                    "floordiv" => {
                        if operand.abs() < f64::EPSILON {
                            return Err(CommandFlowError::Validation(format!(
                                "node '{}' floor division by zero",
                                node.id
                            )));
                        }
                        (current / operand).floor()
                    }
                    "pow" => current.powf(operand),
                    "max" => current.max(operand),
                    "min" => current.min(operand),
                    "hypot" => current.hypot(operand),
                    "atan2" => current.atan2(operand),
                    "eq" | "==" => bool_to_num((current - operand).abs() < f64::EPSILON),
                    "ne" | "!=" => bool_to_num((current - operand).abs() >= f64::EPSILON),
                    "gt" | ">" => bool_to_num(current > operand),
                    "ge" | ">=" => bool_to_num(current >= operand),
                    "lt" | "<" => bool_to_num(current < operand),
                    "le" | "<=" => bool_to_num(current <= operand),
                    "land" | "&&" => bool_to_num(as_bool(current) && as_bool(operand)),
                    "lor" | "||" => bool_to_num(as_bool(current) || as_bool(operand)),
                    "lxor" => bool_to_num(as_bool(current) ^ as_bool(operand)),
                    "band" | "&" => (current_i64 & operand_i64) as f64,
                    "bor" | "|" => (current_i64 | operand_i64) as f64,
                    "bxor" | "^" => (current_i64 ^ operand_i64) as f64,
                    "shl" | "<<" => (current_i64.wrapping_shl(shift_bits)) as f64,
                    "shr" | ">>" => (current_i64.wrapping_shr(shift_bits)) as f64,
                    "ushr" | ">>>" => ((current_i64 as u64).wrapping_shr(shift_bits)) as f64,
                    "neg" => -current,
                    "abs" => current.abs(),
                    "sign" => current.signum(),
                    "square" => current * current,
                    "cube" => current * current * current,
                    "sqrt" => current.sqrt(),
                    "cbrt" => current.cbrt(),
                    "exp" => current.exp(),
                    "ln" => current.ln(),
                    "log2" => current.log2(),
                    "log10" => current.log10(),
                    "sin" => current.sin(),
                    "cos" => current.cos(),
                    "tan" => current.tan(),
                    "asin" => current.asin(),
                    "acos" => current.acos(),
                    "atan" => current.atan(),
                    "ceil" => current.ceil(),
                    "floor" => current.floor(),
                    "round" => current.round(),
                    "trunc" => current.trunc(),
                    "frac" => current.fract(),
                    "recip" => {
                        if current.abs() < f64::EPSILON {
                            return Err(CommandFlowError::Validation(format!(
                                "node '{}' reciprocal of zero",
                                node.id
                            )));
                        }
                        current.recip()
                    }
                    "lnot" | "!" => bool_to_num(!as_bool(current)),
                    "bnot" | "~" => (!current_i64) as f64,
                    "set" | "=" => operand,
                    _ => {
                        return Err(CommandFlowError::Validation(format!(
                            "node '{}' has unsupported varMath operation '{}'",
                            node.id, operation
                        )));
                    }
                };

                if !result.is_finite() {
                    return Err(CommandFlowError::Validation(format!(
                        "node '{}' varMath result is not finite",
                        node.id
                    )));
                }

                let result_value = Number::from_f64(result).ok_or_else(|| {
                    CommandFlowError::Validation(format!(
                        "node '{}' varMath failed to serialize numeric result",
                        node.id
                    ))
                })?;

                let result_json = Value::Number(result_value.clone());
                if assign_to_variable {
                    ctx.variables.insert(name.clone(), Value::Number(result_value));
                }
                set_node_output(ctx, node, "result", result_json.clone());

                on_log(
                    "info",
                    format!(
                        "变量运算节点 '{}' 详情：变量='{}'，操作='{}'，当前值={}，操作数={}，结果={}，是否赋值={}{}",
                        node.label,
                        name,
                        operation,
                        current,
                        operand,
                        result,
                        if assign_to_variable { "是" } else { "否" },
                        if assign_to_variable {
                            format!("，已写回变量快照值={}", result_json)
                        } else {
                            "，未写回变量".to_string()
                        }
                    ),
                );
                Ok(NextDirective::Default)
            }
            NodeKind::VarGet => {
                let name = get_string(node, "name", "");
                let value = if name.trim().is_empty() {
                    Value::Null
                } else {
                    ctx.variables.get(&name).cloned().unwrap_or(Value::Null)
                };
                set_node_output(ctx, node, "value", value.clone());

                on_log(
                    "info",
                    format!(
                        "纯输出节点 '{}' 已读取变量 '{}'，当前值={}。",
                        node.label,
                        name,
                        stringify_value(&value)
                    ),
                );

                Ok(NextDirective::Default)
            }
            NodeKind::ConstValue => {
                let value = resolve_typed_param_value(node, "value");
                set_node_output(ctx, node, "value", value.clone());
                on_log(
                    "info",
                    format!(
                        "纯输出节点 '{}' 输出常量值={}。",
                        node.label,
                        stringify_value(&value)
                    ),
                );
                Ok(NextDirective::Default)
            }
        }
    }
}

fn is_trigger(kind: &NodeKind) -> bool {
    matches!(
        kind,
        NodeKind::HotkeyTrigger
            | NodeKind::TimerTrigger
            | NodeKind::ManualTrigger
            | NodeKind::WindowTrigger
    )
}

fn is_control_source_handle(handle: Option<&str>) -> bool {
    match handle {
        None => true,
        Some("next") | Some("true") | Some("false") | Some("loop") | Some("done") => true,
        _ => false,
    }
}

fn is_control_target_handle(handle: Option<&str>) -> bool {
    match handle {
        None => true,
        Some("in") => true,
        _ => false,
    }
}

fn is_param_handle(handle: Option<&str>) -> bool {
    handle
        .map(|value| value.starts_with("param:"))
        .unwrap_or(false)
}

fn is_control_flow_edge(source_handle: Option<&str>, target_handle: Option<&str>) -> bool {
    !is_param_handle(source_handle)
        && !is_param_handle(target_handle)
        && is_control_source_handle(source_handle)
        && is_control_target_handle(target_handle)
}

fn is_param_input_handle(handle: Option<&str>) -> bool {
    handle
        .map(|value| value.starts_with(PARAM_INPUT_PREFIX) && value.ends_with(PARAM_INPUT_SUFFIX))
        .unwrap_or(false)
}

fn extract_param_key_from_input_handle(handle: &str) -> Option<String> {
    if !handle.starts_with(PARAM_INPUT_PREFIX) || !handle.ends_with(PARAM_INPUT_SUFFIX) {
        return None;
    }

    let key_start = PARAM_INPUT_PREFIX.len();
    let key_end = handle.len().saturating_sub(PARAM_INPUT_SUFFIX.len());
    if key_end <= key_start {
        return None;
    }

    Some(handle[key_start..key_end].to_string())
}

fn resolve_edge_source_value(
    edge_source: &str,
    source_handle: Option<&str>,
    graph: &WorkflowGraph,
    ctx: &ExecutionContext,
) -> Option<Value> {
    let handle = source_handle?;

    if let Some(node_outputs) = ctx.node_outputs.get(edge_source) {
        if let Some(value) = node_outputs.get(handle) {
            return Some(value.clone());
        }
    }

    let source_node = graph.nodes.iter().find(|node| node.id == edge_source)?;
    resolve_source_fallback_value(source_node, handle, ctx)
}

fn resolve_node_with_data_inputs(
    node: &WorkflowNode,
    graph: &WorkflowGraph,
    ctx: &ExecutionContext,
) -> WorkflowNode {
    let mut resolved = node.clone();

    for edge in graph.edges.iter().filter(|edge| edge.target == node.id) {
        if !is_param_input_handle(edge.target_handle.as_deref()) {
            continue;
        }

        let Some(target_handle) = edge.target_handle.as_deref() else {
            continue;
        };
        let Some(field_key) = extract_param_key_from_input_handle(target_handle) else {
            continue;
        };

        let source_value = resolve_edge_source_value(
            &edge.source,
            edge.source_handle.as_deref(),
            graph,
            ctx,
        );
        if let Some(value) = source_value {
            resolved.params.insert(field_key, value);
        }
    }

    resolved
}

fn resolve_source_fallback_value(
    source_node: &WorkflowNode,
    source_handle: &str,
    ctx: &ExecutionContext,
) -> Option<Value> {
    if source_handle == "value" {
        match source_node.kind {
            NodeKind::ConstValue | NodeKind::VarDefine | NodeKind::VarSet => {
                return Some(resolve_typed_param_value(source_node, "value"));
            }
            NodeKind::VarGet => {
                let name = get_string(source_node, "name", "");
                if name.trim().is_empty() {
                    return Some(Value::Null);
                }
                return Some(ctx.variables.get(&name).cloned().unwrap_or(Value::Null));
            }
            _ => {}
        }
    }

    source_node.params.get(source_handle).cloned()
}

fn set_node_output(ctx: &mut ExecutionContext, node: &WorkflowNode, handle: &str, value: Value) {
    let outputs = ctx
        .node_outputs
        .entry(node.id.clone())
        .or_insert_with(HashMap::new);
    outputs.insert(handle.to_string(), value);
}

fn value_from_i32(value: i32) -> Value {
    Value::Number(Number::from(value as i64))
}

fn value_from_u64(value: u64) -> Value {
    Value::Number(Number::from(value))
}

fn value_from_f64(value: f64) -> Value {
    Number::from_f64(value)
        .map(Value::Number)
        .unwrap_or(Value::Null)
}

async fn run_python_code(
    node: &WorkflowNode,
    on_log: &mut impl FnMut(&str, String),
) -> CommandResult<()> {
    let code = get_string(node, "code", "");
    if code.trim().is_empty() {
        on_log(
            "warn",
            format!("Python 节点 '{}' 代码为空，已自动跳过。", node.label),
        );
        return Ok(());
    }

    #[cfg(target_os = "windows")]
    let candidates: &[(&str, &[&str])] = &[
        ("python", &[]),
        ("py", &["-3"]),
        ("python3", &[]),
    ];

    #[cfg(not(target_os = "windows"))]
    let candidates: &[(&str, &[&str])] = &[("python3", &[]), ("python", &[])];

    for (program, prefix_args) in candidates {
        let mut command = Command::new(program);
        for arg in *prefix_args {
            command.arg(arg);
        }

        let output = command.arg("-c").arg(&code).output().await;
        match output {
            Ok(output) => {
                emit_process_output("Python", &output.stdout, &output.stderr, on_log);
                if output.status.success() {
                    return Ok(());
                }

                let stderr_text = String::from_utf8_lossy(&output.stderr).trim().to_string();
                let status = output.status.code().map(|code| code.to_string()).unwrap_or_else(|| "unknown".to_string());
                return Err(CommandFlowError::Automation(if stderr_text.is_empty() {
                    format!(
                        "python 节点执行失败：{} 返回非零退出码 {}",
                        program, status
                    )
                } else {
                    format!(
                        "python 节点执行失败：{} 返回非零退出码 {}，stderr: {}",
                        program, status, stderr_text
                    )
                }));
            }
            Err(error) if error.kind() == ErrorKind::NotFound => {
                continue;
            }
            Err(error) => {
                return Err(CommandFlowError::Automation(format!(
                    "调用系统 Python 失败：{}",
                    error
                )));
            }
        }
    }

    on_log(
        "warn",
        format!(
            "Python 节点 '{}'：未检测到系统 Python，已自动跳过该节点。",
            node.label
        ),
    );
    Ok(())
}

fn emit_process_output(
    prefix: &str,
    stdout: &[u8],
    stderr: &[u8],
    on_log: &mut impl FnMut(&str, String),
) {
    let stdout_text = String::from_utf8_lossy(stdout);
    for line in stdout_text.lines() {
        let trimmed = line.trim();
        if !trimmed.is_empty() {
            on_log("info", format!("{} stdout: {}", prefix, trimmed));
        }
    }

    let stderr_text = String::from_utf8_lossy(stderr);
    for line in stderr_text.lines() {
        let trimmed = line.trim();
        if !trimmed.is_empty() {
            on_log("warn", format!("{} stderr: {}", prefix, trimmed));
        }
    }
}

fn is_manual_trigger(kind: &NodeKind) -> bool {
    matches!(kind, NodeKind::ManualTrigger)
}

async fn run_system_command(command: &str, use_shell: bool) -> CommandResult<()> {
    let output = if use_shell {
        #[cfg(target_os = "windows")]
        {
            if should_spawn_terminal_window(command) {
                spawn_windows_terminal(command).await?;
                return Ok(());
            }

            Command::new("cmd")
                .arg("/C")
                .arg(command)
                .output()
                .await
                .map_err(|error| CommandFlowError::Automation(error.to_string()))?
        }

        #[cfg(not(target_os = "windows"))]
        {
            Command::new("sh")
                .arg("-c")
                .arg(command)
                .output()
                .await
                .map_err(|error| CommandFlowError::Automation(error.to_string()))?
        }
    } else {
        let mut parts = command.split_whitespace();
        let program = parts.next().ok_or_else(|| {
            CommandFlowError::Validation("runCommand node missing executable".to_string())
        })?;
        Command::new(program)
            .args(parts)
            .output()
            .await
            .map_err(|error| CommandFlowError::Automation(error.to_string()))?
    };

    if output.status.success() {
        Ok(())
    } else {
        Err(CommandFlowError::Automation(
            String::from_utf8_lossy(&output.stderr).to_string(),
        ))
    }
}

#[cfg(target_os = "windows")]
fn should_spawn_terminal_window(command: &str) -> bool {
    let normalized = command.trim().to_lowercase();
    normalized == "cmd"
        || normalized == "cmd.exe"
        || normalized.starts_with("cmd ")
        || normalized.starts_with("cmd.exe ")
        || normalized == "powershell"
        || normalized == "powershell.exe"
        || normalized.starts_with("powershell ")
        || normalized.starts_with("powershell.exe ")
        || normalized == "pwsh"
        || normalized == "pwsh.exe"
        || normalized.starts_with("pwsh ")
        || normalized.starts_with("pwsh.exe ")
}

#[cfg(target_os = "windows")]
async fn spawn_windows_terminal(command: &str) -> CommandResult<()> {
    let status = Command::new("cmd")
        .arg("/C")
        .arg("start")
        .arg("")
        .arg(command)
        .status()
        .await
        .map_err(|error| CommandFlowError::Automation(error.to_string()))?;

    if status.success() {
        Ok(())
    } else {
        Err(CommandFlowError::Automation(format!(
            "failed to launch terminal window for command: {}",
            command
        )))
    }
}

fn get_i32(node: &WorkflowNode, key: &str, default: i32) -> i32 {
    node.params
        .get(key)
        .and_then(|value| value.as_i64())
        .map(|value| value as i32)
        .unwrap_or(default)
}

fn get_u32(node: &WorkflowNode, key: &str, default: u32) -> u32 {
    node.params
        .get(key)
        .and_then(|value| value.as_u64())
        .map(|value| value as u32)
        .unwrap_or(default)
}

fn get_u64(node: &WorkflowNode, key: &str, default: u64) -> u64 {
    node.params
        .get(key)
        .and_then(|value| value.as_u64())
        .unwrap_or(default)
}

fn get_f32(node: &WorkflowNode, key: &str, default: f32) -> f32 {
    node.params
        .get(key)
        .and_then(|value| value.as_f64())
        .map(|value| value as f32)
        .unwrap_or(default)
}

fn get_f64(node: &WorkflowNode, key: &str, default: f64) -> f64 {
    node.params
        .get(key)
        .and_then(|value| value.as_f64())
        .unwrap_or(default)
}

fn get_bool(node: &WorkflowNode, key: &str, default: bool) -> bool {
    node.params
        .get(key)
        .and_then(|value| value.as_bool())
        .unwrap_or(default)
}

fn get_string(node: &WorkflowNode, key: &str, default: &str) -> String {
    node.params
        .get(key)
        .and_then(|value| value.as_str())
        .unwrap_or(default)
        .to_string()
}

fn get_string_array(node: &WorkflowNode, key: &str, default: Vec<String>) -> Vec<String> {
    node.params
        .get(key)
        .and_then(|value| value.as_array())
        .map(|values| {
            values
                .iter()
                .filter_map(|item| item.as_str().map(ToString::to_string))
                .collect::<Vec<_>>()
        })
        .filter(|values| !values.is_empty())
        .unwrap_or(default)
}

fn resolve_text_input(node: &WorkflowNode, variables: &HashMap<String, Value>) -> String {
    let input_mode = get_string(node, "inputMode", "literal").to_lowercase();
    if input_mode == "var" {
        let var_name = get_string(node, "inputVar", "").trim().to_string();
        if var_name.is_empty() {
            return String::new();
        }
        return variables
            .get(&var_name)
            .map(stringify_value)
            .unwrap_or_default();
    }

    let raw = get_string(node, "inputText", "");
    resolve_text_template(&raw, variables)
}

fn resolve_text_template(raw: &str, variables: &HashMap<String, Value>) -> String {
    let mut result = String::with_capacity(raw.len());
    let mut cursor = 0usize;

    while let Some(open_rel) = raw[cursor..].find("{{") {
        let open = cursor + open_rel;
        result.push_str(&raw[cursor..open]);

        let body_start = open + 2;
        if let Some(close_rel) = raw[body_start..].find("}}") {
            let close = body_start + close_rel;
            let key = raw[body_start..close].trim();
            if !key.is_empty() {
                if let Some(value) = variables.get(key) {
                    result.push_str(&stringify_value(value));
                }
            }
            cursor = close + 2;
        } else {
            result.push_str(&raw[open..]);
            cursor = raw.len();
            break;
        }
    }

    if cursor < raw.len() {
        result.push_str(&raw[cursor..]);
    }

    result
}

fn stringify_value(value: &Value) -> String {
    match value {
        Value::String(text) => text.clone(),
        Value::Number(number) => number.to_string(),
        Value::Bool(flag) => flag.to_string(),
        Value::Null => String::new(),
        _ => serde_json::to_string(value).unwrap_or_default(),
    }
}

fn write_text_file(path: &str, text: &str, append: bool, create_parent_dir: bool) -> CommandResult<()> {
    let target = Path::new(path);

    if create_parent_dir {
        if let Some(parent) = target.parent() {
            if !parent.as_os_str().is_empty() {
                fs::create_dir_all(parent)
                    .map_err(|error| CommandFlowError::Io(format!("创建目录失败 '{}': {}", parent.display(), error)))?;
            }
        }
    }

    if append {
        let mut file = fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(target)
            .map_err(|error| CommandFlowError::Io(format!("打开文件失败 '{}': {}", path, error)))?;
        file.write_all(text.as_bytes())
            .map_err(|error| CommandFlowError::Io(format!("写入文件失败 '{}': {}", path, error)))?;
        return Ok(());
    }

    fs::write(target, text)
        .map_err(|error| CommandFlowError::Io(format!("写入文件失败 '{}': {}", path, error)))
}

fn show_message_dialog(title: &str, message: &str, level: &str) -> CommandResult<()> {
    let message_level = match level.to_lowercase().as_str() {
        "warning" | "warn" => MessageLevel::Warning,
        "error" => MessageLevel::Error,
        _ => MessageLevel::Info,
    };

    let shown = MessageDialog::new()
        .set_level(message_level)
        .set_title(title)
        .set_description(message)
        .set_buttons(MessageButtons::Ok)
        .show();

    if matches!(shown, MessageDialogResult::Ok | MessageDialogResult::Yes) {
        Ok(())
    } else {
        Err(CommandFlowError::Automation(
            "弹窗显示失败或被系统阻止。".to_string(),
        ))
    }
}

fn evaluate_condition(node: &WorkflowNode, variables: &HashMap<String, Value>) -> bool {
    let left_type = get_string(node, "leftType", "var");
    let right_type = get_string(node, "rightType", "literal");
    let operator = get_string(node, "operator", "==");
    let left_raw = get_string(node, "left", "");
    let right_raw = get_string(node, "right", "");

    let left = resolve_operand(&left_type, &left_raw, variables);
    let right = resolve_operand(&right_type, &right_raw, variables);

    match operator.as_str() {
        "==" => values_equal(&left, &right),
        "!=" => !values_equal(&left, &right),
        ">" => as_f64(&left) > as_f64(&right),
        ">=" => as_f64(&left) >= as_f64(&right),
        "<" => as_f64(&left) < as_f64(&right),
        "<=" => as_f64(&left) <= as_f64(&right),
        _ => false,
    }
}

fn resolve_operand(kind: &str, raw: &str, variables: &HashMap<String, Value>) -> Value {
    if kind == "var" {
        return variables.get(raw).cloned().unwrap_or(Value::Null);
    }

    if let Ok(number) = raw.parse::<f64>() {
        if let Some(n) = Number::from_f64(number) {
            return Value::Number(n);
        }
    }

    if raw.eq_ignore_ascii_case("true") {
        return Value::Bool(true);
    }
    if raw.eq_ignore_ascii_case("false") {
        return Value::Bool(false);
    }

    Value::String(raw.to_string())
}

fn as_f64(value: &Value) -> f64 {
    value
        .as_f64()
        .or_else(|| value.as_i64().map(|n| n as f64))
        .or_else(|| value.as_u64().map(|n| n as f64))
        .or_else(|| value.as_str().and_then(|s| s.parse::<f64>().ok()))
        .unwrap_or(0.0)
}

fn values_equal(left: &Value, right: &Value) -> bool {
    let left_num = as_optional_f64(left);
    let right_num = as_optional_f64(right);
    if let (Some(a), Some(b)) = (left_num, right_num) {
        return (a - b).abs() < f64::EPSILON;
    }

    left == right
}

fn as_optional_f64(value: &Value) -> Option<f64> {
    value
        .as_f64()
        .or_else(|| value.as_i64().map(|n| n as f64))
        .or_else(|| value.as_u64().map(|n| n as f64))
        .or_else(|| value.as_str().and_then(|s| s.parse::<f64>().ok()))
}

fn resolve_typed_param_value(node: &WorkflowNode, base_key: &str) -> Value {
    let type_key = format!("{}Type", base_key);
    let selected_type = node
        .params
        .get(&type_key)
        .and_then(|value| value.as_str())
        .unwrap_or("");

    if selected_type.is_empty() {
        return node.params.get(base_key).cloned().unwrap_or(Value::Null);
    }

    match selected_type {
        "string" => {
            let key = format!("{}String", base_key);
            Value::String(get_string(node, &key, ""))
        }
        "number" => {
            let key = format!("{}Number", base_key);
            let numeric = get_f64(node, &key, 0.0);
            Number::from_f64(numeric)
                .map(Value::Number)
                .unwrap_or(Value::Null)
        }
        "boolean" => {
            let key = format!("{}Boolean", base_key);
            let raw = get_string(node, &key, "false");
            Value::Bool(raw.eq_ignore_ascii_case("true"))
        }
        "json" => {
            let key = format!("{}Json", base_key);
            let raw = get_string(node, &key, "null");
            serde_json::from_str::<Value>(&raw).unwrap_or(Value::Null)
        }
        _ => node.params.get(base_key).cloned().unwrap_or(Value::Null),
    }
}

async fn sleep_after_node(
    node: &WorkflowNode,
    should_cancel: &impl Fn() -> bool,
) -> CommandResult<()> {
    let post_delay_ms = get_u64(node, "postDelayMs", DEFAULT_POST_DELAY_MS);
    if post_delay_ms > 0 {
        interruptible_sleep(Duration::from_millis(post_delay_ms), should_cancel).await?;
    }
    Ok(())
}

async fn interruptible_sleep(
    duration: Duration,
    should_cancel: &impl Fn() -> bool,
) -> CommandResult<()> {
    const SLEEP_SLICE: Duration = Duration::from_millis(25);

    let deadline = tokio::time::Instant::now() + duration;
    loop {
        if should_cancel() {
            return Err(CommandFlowError::Canceled);
        }

        let now = tokio::time::Instant::now();
        if now >= deadline {
            return Ok(());
        }

        let remaining = deadline.saturating_duration_since(now);
        sleep(remaining.min(SLEEP_SLICE)).await;
    }
}

fn prepare_image_match_debug_dir(node: &WorkflowNode) -> CommandResult<PathBuf> {
    let mut base = std::env::temp_dir();
    base.push("commandflow-image-match-debug");

    fs::create_dir_all(&base).map_err(|error| CommandFlowError::Io(error.to_string()))?;

    let unix_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or_default();
    let safe_label = node
        .label
        .chars()
        .map(|ch| if ch.is_alphanumeric() { ch } else { '_' })
        .collect::<String>();
    let run_dir = base.join(format!("{}-{}-{}", safe_label, node.id, unix_ms));
    fs::create_dir_all(&run_dir).map_err(|error| CommandFlowError::Io(error.to_string()))?;

    Ok(run_dir)
}

fn path_to_string(path: &Path) -> CommandResult<&str> {
    path.to_str()
        .ok_or_else(|| CommandFlowError::Validation("invalid debug path".to_string()))
}

#[derive(Debug, Clone)]
enum GuiAgentAction {
    Click { point: (f64, f64) },
    LeftDouble { point: (f64, f64) },
    RightSingle { point: (f64, f64) },
    Drag { start: (f64, f64), end: (f64, f64) },
    Hotkey { key: String },
    Type { content: String },
    Scroll { point: (f64, f64), direction: String },
    Wait,
    Finished { content: String },
}

async fn execute_gui_agent_action(
    node: &WorkflowNode,
    should_cancel: &impl Fn() -> bool,
    on_log: &mut impl FnMut(&str, String),
) -> CommandResult<()> {
    if should_cancel() {
        return Err(CommandFlowError::Canceled);
    }

    let base_url = get_string(node, "baseUrl", "https://api.openai.com/v1/chat/completions");
    let api_key = get_string(node, "apiKey", "");
    let model = get_string(node, "model", "gpt-4.1-mini");
    let instruction = get_string(node, "instruction", "");
    let image_input = get_string(node, "imageInput", "");
    let image_format = get_string(node, "imageFormat", "png").to_lowercase();
    let max_tokens = get_u64(node, "maxTokens", 512);
    let strip_think = get_bool(node, "stripThink", true);
    let system_prompt_template = get_string(node, "systemPrompt", "{instruction}");

    if base_url.trim().is_empty() {
        return Err(CommandFlowError::Validation(format!(
            "node '{}' GUI Agent baseUrl cannot be empty",
            node.id
        )));
    }

    if api_key.trim().is_empty() {
        return Err(CommandFlowError::Validation(format!(
            "node '{}' GUI Agent apiKey cannot be empty",
            node.id
        )));
    }

    if model.trim().is_empty() {
        return Err(CommandFlowError::Validation(format!(
            "node '{}' GUI Agent model cannot be empty",
            node.id
        )));
    }

    if image_input.trim().is_empty() {
        return Err(CommandFlowError::Validation(format!(
            "node '{}' GUI Agent imageInput cannot be empty",
            node.id
        )));
    }

    let cleaned_base64 = normalize_base64_input(&image_input);
    let (image_width, image_height) = decode_base64_image_dimensions(&cleaned_base64, &image_format)?;
    let system_prompt = system_prompt_template.replace("{instruction}", &instruction);
    let endpoint = resolve_chat_endpoint(&base_url);

    let messages = serde_json::json!([
        {
            "role": "user",
            "content": system_prompt
        },
        {
            "role": "user",
            "content": [
                {
                    "type": "image_url",
                    "image_url": {
                        "url": format!("data:image/{};base64,{}", image_format, cleaned_base64)
                    }
                }
            ]
        }
    ]);

    let payload = serde_json::json!({
        "model": model,
        "temperature": 0,
        "max_tokens": max_tokens,
        "messages": messages,
    });

    let client = reqwest::Client::new();
    let response = client
        .post(endpoint)
        .header(CONTENT_TYPE, "application/json")
        .header(AUTHORIZATION, format!("Bearer {}", api_key))
        .json(&payload)
        .send()
        .await
        .map_err(|error| CommandFlowError::Automation(format!("GUI Agent 请求失败: {}", error)))?;

    let status = response.status();
    let raw_response = response
        .text()
        .await
        .map_err(|error| CommandFlowError::Automation(format!("GUI Agent 响应读取失败: {}", error)))?;

    if !status.is_success() {
        return Err(CommandFlowError::Automation(format!(
            "GUI Agent 请求返回非 2xx（{}）：{}",
            status, raw_response
        )));
    }

    let response_json: Value = serde_json::from_str(&raw_response)
        .map_err(|error| CommandFlowError::Automation(format!("GUI Agent 响应 JSON 解析失败: {}", error)))?;

    let content = extract_llm_message_content(&response_json)?;
    let normalized_content = if strip_think {
        strip_think_sections(&content)
    } else {
        content
    };

    let action_expr = extract_action_expression(&normalized_content)?;
    let action = parse_gui_agent_action(&action_expr)?;

    on_log(
        "info",
        format!(
            "GUI Agent 节点 '{}' 模型输出动作：{}（图像尺寸={}x{}）",
            node.label, action_expr, image_width, image_height
        ),
    );

    apply_gui_agent_action(action, image_width, image_height, should_cancel, on_log).await
}

fn normalize_base64_input(raw: &str) -> String {
    let trimmed = raw.trim();
    if let Some(index) = trimmed.find(",") {
        let prefix = &trimmed[..index];
        if prefix.contains("base64") {
            return trimmed[index + 1..].trim().to_string();
        }
    }
    trimmed.to_string()
}

fn decode_base64_image_dimensions(base64_image: &str, image_format: &str) -> CommandResult<(u32, u32)> {
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(base64_image)
        .map_err(|error| CommandFlowError::Validation(format!("GUI Agent 图片 base64 解码失败: {}", error)))?;

    let format = match image_format.to_lowercase().as_str() {
        "png" => image::ImageFormat::Png,
        "jpg" | "jpeg" => image::ImageFormat::Jpeg,
        "webp" => image::ImageFormat::WebP,
        "bmp" => image::ImageFormat::Bmp,
        other => {
            return Err(CommandFlowError::Validation(format!(
                "GUI Agent 不支持的 imageFormat: {}",
                other
            )))
        }
    };

    let image = image::load_from_memory_with_format(&bytes, format)
        .map_err(|error| CommandFlowError::Validation(format!("GUI Agent 图片解析失败: {}", error)))?;

    Ok((image.width(), image.height()))
}

fn ends_with_version_segment(url: &str) -> bool {
    let Some(segment) = url.rsplit('/').next() else {
        return false;
    };

    if !segment.starts_with('v') || segment.len() < 2 {
        return false;
    }

    segment[1..].chars().all(|ch| ch.is_ascii_digit())
}

fn resolve_chat_endpoint(base_url: &str) -> String {
    let trimmed = base_url.trim().trim_end_matches('/');

    if trimmed.ends_with("/chat/completions") {
        return trimmed.to_string();
    }

    if trimmed.ends_with("/models") {
        let root = trimmed.trim_end_matches("/models");
        if ends_with_version_segment(root) {
            return format!("{}/chat/completions", root);
        }
        return format!("{}/v1/chat/completions", root);
    }

    if ends_with_version_segment(trimmed) {
        format!("{}/chat/completions", trimmed)
    } else {
        format!("{}/v1/chat/completions", trimmed)
    }
}

fn extract_llm_message_content(response_json: &Value) -> CommandResult<String> {
    let message_content = response_json
        .get("choices")
        .and_then(|choices| choices.as_array())
        .and_then(|choices| choices.first())
        .and_then(|first| first.get("message"))
        .and_then(|message| message.get("content"))
        .ok_or_else(|| CommandFlowError::Automation("GUI Agent 响应缺少 choices[0].message.content".to_string()))?;

    if let Some(text) = message_content.as_str() {
        return Ok(text.to_string());
    }

    if let Some(parts) = message_content.as_array() {
        let merged = parts
            .iter()
            .filter_map(|part| {
                if let Some(text) = part.get("text").and_then(|v| v.as_str()) {
                    return Some(text.to_string());
                }
                part.get("content").and_then(|v| v.as_str()).map(ToString::to_string)
            })
            .collect::<Vec<_>>()
            .join("\n");
        if !merged.trim().is_empty() {
            return Ok(merged);
        }
    }

    Err(CommandFlowError::Automation(
        "GUI Agent 无法解析 message.content 文本".to_string(),
    ))
}

fn strip_think_sections(content: &str) -> String {
    static THINK_RE: OnceLock<Regex> = OnceLock::new();
    let regex = THINK_RE.get_or_init(|| Regex::new(r"(?is)<think>.*?</think>").expect("valid think regex"));
    regex.replace_all(content, "").to_string()
}

fn extract_action_expression(content: &str) -> CommandResult<String> {
    static ACTION_RE: OnceLock<Regex> = OnceLock::new();
    let regex = ACTION_RE.get_or_init(|| Regex::new(r"(?im)Action:\s*(.+)").expect("valid action regex"));

    let expression = regex
        .captures(content)
        .and_then(|caps| caps.get(1))
        .map(|m| m.as_str().trim().to_string())
        .filter(|line| !line.is_empty())
        .ok_or_else(|| CommandFlowError::Automation("GUI Agent 未返回可解析的 Action 行".to_string()))?;

    Ok(expression.trim_matches('`').trim().to_string())
}

fn parse_gui_agent_action(expression: &str) -> CommandResult<GuiAgentAction> {
    if let Some(point) = parse_single_point_action(expression, "click")? {
        return Ok(GuiAgentAction::Click { point });
    }
    if let Some(point) = parse_single_point_action(expression, "left_double")? {
        return Ok(GuiAgentAction::LeftDouble { point });
    }
    if let Some(point) = parse_single_point_action(expression, "right_single")? {
        return Ok(GuiAgentAction::RightSingle { point });
    }

    if let Some((start, end)) = parse_drag_action(expression)? {
        return Ok(GuiAgentAction::Drag { start, end });
    }

    if let Some(key) = parse_string_arg_action(expression, "hotkey", "key")? {
        return Ok(GuiAgentAction::Hotkey { key });
    }

    if let Some(content) = parse_string_arg_action(expression, "type", "content")? {
        return Ok(GuiAgentAction::Type {
            content: unescape_agent_string(&content),
        });
    }

    if let Some((point, direction)) = parse_scroll_action(expression)? {
        return Ok(GuiAgentAction::Scroll { point, direction });
    }

    if expression.trim().eq_ignore_ascii_case("wait()") {
        return Ok(GuiAgentAction::Wait);
    }

    if let Some(content) = parse_string_arg_action(expression, "finished", "content")? {
        return Ok(GuiAgentAction::Finished {
            content: unescape_agent_string(&content),
        });
    }

    Err(CommandFlowError::Automation(format!(
        "GUI Agent 返回了不支持的动作: {}",
        expression
    )))
}

fn parse_single_point_action(expression: &str, action_name: &str) -> CommandResult<Option<(f64, f64)>> {
    let pattern = format!(
        r"(?i)^{}\s*\(\s*point\s*=\s*'\s*<point>\s*([+-]?\d+(?:\.\d+)?)\s+([+-]?\d+(?:\.\d+)?)\s*</point>\s*'\s*\)\s*$",
        regex::escape(action_name)
    );
    let regex = Regex::new(&pattern)
        .map_err(|error| CommandFlowError::Automation(format!("动作正则构建失败: {}", error)))?;

    let Some(captures) = regex.captures(expression.trim()) else {
        return Ok(None);
    };

    let x = captures
        .get(1)
        .and_then(|m| m.as_str().parse::<f64>().ok())
        .ok_or_else(|| CommandFlowError::Automation("GUI Agent 点位 X 解析失败".to_string()))?;
    let y = captures
        .get(2)
        .and_then(|m| m.as_str().parse::<f64>().ok())
        .ok_or_else(|| CommandFlowError::Automation("GUI Agent 点位 Y 解析失败".to_string()))?;

    Ok(Some((x, y)))
}

fn parse_drag_action(expression: &str) -> CommandResult<Option<((f64, f64), (f64, f64))>> {
    let regex = Regex::new(
        r"(?i)^drag\s*\(\s*start_point\s*=\s*'\s*<point>\s*([+-]?\d+(?:\.\d+)?)\s+([+-]?\d+(?:\.\d+)?)\s*</point>\s*'\s*,\s*end_point\s*=\s*'\s*<point>\s*([+-]?\d+(?:\.\d+)?)\s+([+-]?\d+(?:\.\d+)?)\s*</point>\s*'\s*\)\s*$",
    )
    .map_err(|error| CommandFlowError::Automation(format!("动作正则构建失败: {}", error)))?;

    let Some(captures) = regex.captures(expression.trim()) else {
        return Ok(None);
    };

    let sx = captures
        .get(1)
        .and_then(|m| m.as_str().parse::<f64>().ok())
        .ok_or_else(|| CommandFlowError::Automation("GUI Agent 拖拽起点 X 解析失败".to_string()))?;
    let sy = captures
        .get(2)
        .and_then(|m| m.as_str().parse::<f64>().ok())
        .ok_or_else(|| CommandFlowError::Automation("GUI Agent 拖拽起点 Y 解析失败".to_string()))?;
    let ex = captures
        .get(3)
        .and_then(|m| m.as_str().parse::<f64>().ok())
        .ok_or_else(|| CommandFlowError::Automation("GUI Agent 拖拽终点 X 解析失败".to_string()))?;
    let ey = captures
        .get(4)
        .and_then(|m| m.as_str().parse::<f64>().ok())
        .ok_or_else(|| CommandFlowError::Automation("GUI Agent 拖拽终点 Y 解析失败".to_string()))?;

    Ok(Some(((sx, sy), (ex, ey))))
}

fn parse_scroll_action(expression: &str) -> CommandResult<Option<((f64, f64), String)>> {
    let regex = Regex::new(
        r"(?i)^scroll\s*\(\s*point\s*=\s*'\s*<point>\s*([+-]?\d+(?:\.\d+)?)\s+([+-]?\d+(?:\.\d+)?)\s*</point>\s*'\s*,\s*direction\s*=\s*'\s*(down|up|right|left)\s*'\s*\)\s*$",
    )
    .map_err(|error| CommandFlowError::Automation(format!("动作正则构建失败: {}", error)))?;

    let Some(captures) = regex.captures(expression.trim()) else {
        return Ok(None);
    };

    let x = captures
        .get(1)
        .and_then(|m| m.as_str().parse::<f64>().ok())
        .ok_or_else(|| CommandFlowError::Automation("GUI Agent 滚动点 X 解析失败".to_string()))?;
    let y = captures
        .get(2)
        .and_then(|m| m.as_str().parse::<f64>().ok())
        .ok_or_else(|| CommandFlowError::Automation("GUI Agent 滚动点 Y 解析失败".to_string()))?;
    let direction = captures
        .get(3)
        .map(|m| m.as_str().to_lowercase())
        .ok_or_else(|| CommandFlowError::Automation("GUI Agent 滚动方向解析失败".to_string()))?;

    Ok(Some(((x, y), direction)))
}

fn parse_string_arg_action(expression: &str, action_name: &str, arg_name: &str) -> CommandResult<Option<String>> {
    let pattern = format!(
        r"(?is)^{}\s*\(\s*{}\s*=\s*'(.*)'\s*\)\s*$",
        regex::escape(action_name),
        regex::escape(arg_name)
    );
    let regex = Regex::new(&pattern)
        .map_err(|error| CommandFlowError::Automation(format!("动作正则构建失败: {}", error)))?;

    let Some(captures) = regex.captures(expression.trim()) else {
        return Ok(None);
    };

    let content = captures
        .get(1)
        .map(|m| m.as_str().to_string())
        .ok_or_else(|| CommandFlowError::Automation("GUI Agent 字符串参数解析失败".to_string()))?;

    Ok(Some(content))
}

fn unescape_agent_string(content: &str) -> String {
    let mut output = String::with_capacity(content.len());
    let mut chars = content.chars().peekable();

    while let Some(ch) = chars.next() {
        if ch == '\\' {
            if let Some(next) = chars.next() {
                match next {
                    'n' => output.push('\n'),
                    '\\' => output.push('\\'),
                    '\'' => output.push('\''),
                    '"' => output.push('"'),
                    other => {
                        output.push('\\');
                        output.push(other);
                    }
                }
            } else {
                output.push('\\');
            }
        } else {
            output.push(ch);
        }
    }

    output
}

fn relative_to_absolute(point: (f64, f64), image_width: u32, image_height: u32) -> (i32, i32) {
    let x = (point.0 / 1000.0) * image_width as f64;
    let y = (point.1 / 1000.0) * image_height as f64;
    (x.round() as i32, y.round() as i32)
}

async fn apply_gui_agent_action(
    action: GuiAgentAction,
    image_width: u32,
    image_height: u32,
    should_cancel: &impl Fn() -> bool,
    on_log: &mut impl FnMut(&str, String),
) -> CommandResult<()> {
    match action {
        GuiAgentAction::Click { point } => {
            let abs = relative_to_absolute(point, image_width, image_height);
            mouse::click(abs.0, abs.1, 1)?;
            on_log(
                "info",
                format!(
                    "GUI Agent 执行 click: 相对坐标=({:.2}, {:.2}) -> 绝对坐标=({}, {})",
                    point.0, point.1, abs.0, abs.1
                ),
            );
        }
        GuiAgentAction::LeftDouble { point } => {
            let abs = relative_to_absolute(point, image_width, image_height);
            mouse::click(abs.0, abs.1, 2)?;
            on_log(
                "info",
                format!(
                    "GUI Agent 执行 left_double: 相对坐标=({:.2}, {:.2}) -> 绝对坐标=({}, {})",
                    point.0, point.1, abs.0, abs.1
                ),
            );
        }
        GuiAgentAction::RightSingle { point } => {
            let abs = relative_to_absolute(point, image_width, image_height);
            mouse::button_down(abs.0, abs.1, "right")?;
            mouse::button_up(abs.0, abs.1, "right")?;
            on_log(
                "info",
                format!(
                    "GUI Agent 执行 right_single: 相对坐标=({:.2}, {:.2}) -> 绝对坐标=({}, {})",
                    point.0, point.1, abs.0, abs.1
                ),
            );
        }
        GuiAgentAction::Drag { start, end } => {
            let abs_start = relative_to_absolute(start, image_width, image_height);
            let abs_end = relative_to_absolute(end, image_width, image_height);
            mouse::drag(abs_start.0, abs_start.1, abs_end.0, abs_end.1)?;
            on_log(
                "info",
                format!(
                    "GUI Agent 执行 drag: 起点相对=({:.2}, {:.2}) -> 绝对=({}, {}), 终点相对=({:.2}, {:.2}) -> 绝对=({}, {})",
                    start.0,
                    start.1,
                    abs_start.0,
                    abs_start.1,
                    end.0,
                    end.1,
                    abs_end.0,
                    abs_end.1
                ),
            );
        }
        GuiAgentAction::Hotkey { key } => {
            let tokens = key
                .split_whitespace()
                .map(|token| token.trim())
                .filter(|token| !token.is_empty())
                .collect::<Vec<_>>();

            if tokens.is_empty() {
                return Err(CommandFlowError::Validation("GUI Agent hotkey 为空".to_string()));
            }

            if tokens.len() > 3 {
                return Err(CommandFlowError::Validation(
                    "GUI Agent hotkey 超过 3 个键，拒绝执行".to_string(),
                ));
            }

            if tokens.len() == 1 {
                keyboard::key_tap_by_name(tokens[0])?;
            } else {
                let main_key = tokens[tokens.len() - 1].to_string();
                let modifiers = tokens[..tokens.len() - 1]
                    .iter()
                    .map(|item| item.to_string())
                    .collect::<Vec<_>>();
                keyboard::shortcut(&modifiers, &main_key)?;
            }

            on_log("info", format!("GUI Agent 执行 hotkey: {}", key));
        }
        GuiAgentAction::Type { content } => {
            keyboard::text_input(&content)?;
            on_log(
                "info",
                format!(
                    "GUI Agent 执行 type: 内容长度={}{}",
                    content.chars().count(),
                    if content.ends_with('\n') { "（末尾含换行提交）" } else { "" }
                ),
            );
        }
        GuiAgentAction::Scroll { point, direction } => {
            let abs = relative_to_absolute(point, image_width, image_height);
            mouse::move_to(abs.0, abs.1)?;

            match direction.as_str() {
                "up" => mouse::wheel(1)?,
                "down" => mouse::wheel(-1)?,
                "right" => {
                    return Err(CommandFlowError::Validation(
                        "GUI Agent scroll direction=right 当前实现暂不支持（仅支持 up/down）"
                            .to_string(),
                    ));
                }
                "left" => {
                    return Err(CommandFlowError::Validation(
                        "GUI Agent scroll direction=left 当前实现暂不支持（仅支持 up/down）"
                            .to_string(),
                    ));
                }
                _ => {
                    return Err(CommandFlowError::Validation(format!(
                        "GUI Agent scroll direction 非法: {}",
                        direction
                    )));
                }
            }

            on_log(
                "info",
                format!(
                    "GUI Agent 执行 scroll: 方向={}，相对坐标=({:.2}, {:.2}) -> 绝对坐标=({}, {})",
                    direction, point.0, point.1, abs.0, abs.1
                ),
            );
        }
        GuiAgentAction::Wait => {
            interruptible_sleep(Duration::from_secs(5), should_cancel).await?;
            let (_rgba, width, height) = screenshot::capture_fullscreen_rgba()?;
            on_log(
                "info",
                format!(
                    "GUI Agent 执行 wait: 已等待 5s，并重新截取屏幕（{}x{}）用于后续判断。",
                    width, height
                ),
            );
        }
        GuiAgentAction::Finished { content } => {
            on_log(
                "info",
                format!(
                    "GUI Agent 执行 finished: {}",
                    content
                ),
            );
        }
    }

    Ok(())
}

fn resolve_screenshot_output_path(node: &WorkflowNode) -> CommandResult<Option<String>> {
    let should_save = get_bool(node, "shouldSave", true);
    if !should_save {
        return Ok(None);
    }

    let mut save_dir = get_string(node, "saveDir", "").trim().to_string();

    if save_dir.is_empty() {
        let legacy_path = get_string(node, "path", "");
        let legacy_trimmed = legacy_path.trim();
        if !legacy_trimmed.is_empty() {
            let legacy = Path::new(legacy_trimmed);
            if legacy.extension().is_some() {
                if let Some(parent) = legacy.parent() {
                    if !parent.as_os_str().is_empty() {
                        save_dir = parent.to_string_lossy().to_string();
                    }
                }
            } else {
                save_dir = legacy.to_string_lossy().to_string();
            }
        }
    }

    let mut directory = if save_dir.is_empty() {
        let mut fallback = std::env::temp_dir();
        fallback.push("commandflow");
        fallback.push("screenshots");
        fallback
    } else {
        PathBuf::from(save_dir)
    };

    let file_name = build_screenshot_file_name(node);
    directory.push(file_name);

    let full_path = directory
        .to_str()
        .ok_or_else(|| CommandFlowError::Validation("invalid screenshot output path".to_string()))?
        .to_string();

    Ok(Some(full_path))
}

fn build_screenshot_file_name(node: &WorkflowNode) -> String {
    let unix_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or_default();

    let safe_label = sanitize_file_segment(&node.label);
    let safe_id = sanitize_file_segment(&node.id);

    format!(
        "commandflow_screenshot_{}_{}_{}.png",
        safe_label,
        safe_id,
        unix_ms
    )
}

fn sanitize_file_segment(value: &str) -> String {
    let trimmed = value.trim();
    let mut sanitized = String::with_capacity(trimmed.len());

    for ch in trimmed.chars() {
        if ch.is_ascii_alphanumeric() {
            sanitized.push(ch.to_ascii_lowercase());
        } else if ch == '-' || ch == '_' {
            sanitized.push(ch);
        } else {
            sanitized.push('_');
        }
    }

    let compact = sanitized
        .trim_matches('_')
        .split('_')
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join("_");

    if compact.is_empty() {
        "node".to_string()
    } else {
        compact
    }
}
