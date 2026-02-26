use crate::automation::{file_ops, image_match, keyboard, mouse, screenshot, window};
use crate::error::{CommandFlowError, CommandResult};
use crate::workflow::graph::WorkflowGraph;
use crate::workflow::node::{NodeKind, WorkflowNode};
use serde_json::{Number, Value};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::ErrorKind;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use tokio::process::Command;
use tokio::time::{sleep, Duration};

const DEFAULT_POST_DELAY_MS: u64 = 50;
const IMAGE_MATCH_DEBUG_SAVE_EVERY: u64 = 15;

#[derive(Debug, Default)]
pub struct WorkflowExecutor;

#[derive(Debug, Default)]
struct ExecutionContext {
    variables: HashMap<String, Value>,
    loop_remaining: HashMap<String, u64>,
    while_iterations: HashMap<String, u64>,
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

            on_node_start(node);

            if matches!(node.kind, NodeKind::Loop | NodeKind::WhileLoop) {
                let outgoing: Vec<_> = graph
                    .edges
                    .iter()
                    .filter(|edge| edge.source == current_id)
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

                match node.kind {
                    NodeKind::Loop => {
                        let times = get_u64(node, "times", 1);
                        let remaining = ctx.loop_remaining.entry(node.id.clone()).or_insert(times);

                        if *remaining > 0 {
                            if let Some(edge) = loop_edge {
                                *remaining -= 1;

                                if loop_stack.last().map(String::as_str) != Some(node.id.as_str()) {
                                    loop_stack.push(node.id.clone());
                                }

                                sleep_after_node(node, should_cancel).await?;
                                current_id = edge.target.clone();
                                continue;
                            }

                            *remaining = 0;
                        }

                        ctx.loop_remaining.remove(&node.id);
                        if loop_stack.last().map(String::as_str) == Some(node.id.as_str()) {
                            loop_stack.pop();
                        }

                        if let Some(edge) = done_edge {
                            sleep_after_node(node, should_cancel).await?;
                            current_id = edge.target.clone();
                            continue;
                        }

                        if let Some(parent_loop_id) = loop_stack.last() {
                            sleep_after_node(node, should_cancel).await?;
                            current_id = parent_loop_id.clone();
                            continue;
                        }

                        sleep_after_node(node, should_cancel).await?;
                        return Ok(());
                    }
                    NodeKind::WhileLoop => {
                        let max_iterations = get_u64(node, "maxIterations", 1000).max(1);
                        let condition_true = evaluate_condition(node, &ctx.variables);
                        let iterations = ctx.while_iterations.entry(node.id.clone()).or_insert(0);

                        if condition_true && *iterations < max_iterations {
                            if let Some(edge) = loop_edge {
                                *iterations += 1;

                                if loop_stack.last().map(String::as_str) != Some(node.id.as_str()) {
                                    loop_stack.push(node.id.clone());
                                }

                                sleep_after_node(node, should_cancel).await?;
                                current_id = edge.target.clone();
                                continue;
                            }
                        } else if condition_true && *iterations >= max_iterations {
                            on_log(
                                "warn",
                                format!(
                                    "while 节点 '{}' 达到最大循环次数 {}，已自动切换 done 分支。",
                                    node.label, max_iterations
                                ),
                            );
                        }

                        ctx.while_iterations.remove(&node.id);
                        if loop_stack.last().map(String::as_str) == Some(node.id.as_str()) {
                            loop_stack.pop();
                        }

                        if let Some(edge) = done_edge {
                            sleep_after_node(node, should_cancel).await?;
                            current_id = edge.target.clone();
                            continue;
                        }

                        if let Some(parent_loop_id) = loop_stack.last() {
                            sleep_after_node(node, should_cancel).await?;
                            current_id = parent_loop_id.clone();
                            continue;
                        }

                        sleep_after_node(node, should_cancel).await?;
                        return Ok(());
                    }
                    _ => {}
                }
            }

            let directive = self
                .execute_single_node(node, ctx, on_log, should_cancel)
                .await?;
            sleep_after_node(node, should_cancel).await?;
            on_variables_update(&ctx.variables);

            let outgoing = graph.edges.iter().filter(|edge| edge.source == current_id);
            let next = match directive {
                NextDirective::Default => outgoing.into_iter().next(),
                NextDirective::Branch(handle) => graph
                    .edges
                    .iter()
                    .find(|edge| edge.source == current_id && edge.source_handle.as_deref() == Some(handle)),
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

                Ok(NextDirective::Default)
            }
            NodeKind::MouseClick => {
                let x = get_i32(node, "x", 0);
                let y = get_i32(node, "y", 0);
                let times = get_u64(node, "times", 1) as usize;
                mouse::click(x, y, times.max(1))?;
                Ok(NextDirective::Default)
            }
            NodeKind::MouseMove => {
                let x = get_i32(node, "x", 0);
                let y = get_i32(node, "y", 0);
                mouse::move_to(x, y)?;
                Ok(NextDirective::Default)
            }
            NodeKind::MouseDrag => {
                let from_x = get_i32(node, "fromX", 0);
                let from_y = get_i32(node, "fromY", 0);
                let to_x = get_i32(node, "toX", 0);
                let to_y = get_i32(node, "toY", 0);
                mouse::drag(from_x, from_y, to_x, to_y)?;
                Ok(NextDirective::Default)
            }
            NodeKind::MouseWheel => {
                let vertical = get_i32(node, "vertical", -1);
                mouse::wheel(vertical)?;
                Ok(NextDirective::Default)
            }
            NodeKind::MouseDown => {
                let x = get_i32(node, "x", 0);
                let y = get_i32(node, "y", 0);
                let button = get_string(node, "button", "left");
                mouse::button_down(x, y, &button)?;
                Ok(NextDirective::Default)
            }
            NodeKind::MouseUp => {
                let x = get_i32(node, "x", 0);
                let y = get_i32(node, "y", 0);
                let button = get_string(node, "button", "left");
                mouse::button_up(x, y, &button)?;
                Ok(NextDirective::Default)
            }
            NodeKind::KeyboardKey => {
                let key = get_string(node, "key", "Enter");
                keyboard::key_tap_by_name(&key)?;
                Ok(NextDirective::Default)
            }
            NodeKind::KeyboardInput => {
                let text = get_string(node, "text", "");
                keyboard::text_input(&text)?;
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

                Ok(NextDirective::Default)
            }
            NodeKind::KeyboardUp => {
                let key = get_string(node, "key", "Shift");
                keyboard::key_up_by_name(&key)?;
                Ok(NextDirective::Default)
            }
            NodeKind::Shortcut => {
                let key = get_string(node, "key", "S");
                let modifiers = get_string_array(node, "modifiers", vec!["Ctrl".to_string()]);
                keyboard::shortcut(&modifiers, &key)?;
                Ok(NextDirective::Default)
            }
            NodeKind::Screenshot => {
                let path = get_string(node, "path", "capture.png");
                let fullscreen = get_bool(node, "fullscreen", false);
                if fullscreen {
                    screenshot::capture_fullscreen(&path)?;
                } else {
                    let width = get_u32(node, "width", 320);
                    let height = get_u32(node, "height", 240);
                    screenshot::capture_region(&path, width.max(1), height.max(1))?;
                }
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
                } else {
                    let title = get_string(node, "title", "");
                    window::activate_window(&title)?;
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
                Ok(NextDirective::Default)
            }
            NodeKind::PythonCode => {
                run_python_code(node, on_log).await?;
                Ok(NextDirective::Default)
            }
            NodeKind::Delay => {
                let duration = get_u64(node, "ms", 100);
                interruptible_sleep(Duration::from_millis(duration), should_cancel).await?;
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
                let debug_dir = Some(prepare_image_match_debug_dir(node)?);

                if let Some(dir) = &debug_dir {
                    on_log(
                        "info",
                        format!(
                            "图像匹配节点 '{}' 调试缓存目录：{}",
                            node.label,
                            dir.display()
                        ),
                    );
                }

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
                    on_log(
                        "info",
                        format!(
                            "图像匹配节点 '{}'：静态源图匹配，bestSimilarity={:.4}，threshold={:.2}。",
                            node.label, evaluation.best_similarity, threshold
                        ),
                    );

                    if let Some((x, y)) = evaluation.matched_point {
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

                    if let Some(dir) = &debug_dir {
                        let debug_path = dir.join("static-source-gray.png");
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
                    }

                    on_log(
                        "warn",
                        format!(
                            "图像匹配节点 '{}' 静态源图未命中（bestSimilarity={:.4}），已走 false 分支。",
                            node.label, best_similarity_seen
                        ),
                    );
                    return Ok(NextDirective::Branch("false"));
                }

                let mut stream_mode = true;
                let mut stream = match screenshot::start_primary_frame_stream() {
                    Ok(s) => {
                        on_log(
                            "info",
                            format!(
                                "图像匹配节点 '{}' 已启用 xcap 实时帧流匹配。",
                                node.label
                            ),
                        );
                        Some(s)
                    }
                    Err(error) => {
                        stream_mode = false;
                        on_log(
                            "warn",
                            format!(
                                "图像匹配节点 '{}' 启动帧流失败，将降级为单帧抓取轮询：{}",
                                node.label, error
                            ),
                        );
                        None
                    }
                };

                loop {
                    if should_cancel() {
                        return Err(CommandFlowError::Canceled);
                    }

                    let fast_confirm_mode = matched_streak > 0 && matched_streak < confirm_frames;
                    let frame = if stream_mode {
                        let stream_recv_timeout = if fast_confirm_mode {
                            fast_confirm_interval
                        } else {
                            poll_interval
                        };

                        let recv_result = tokio::task::block_in_place(|| {
                            stream
                                .as_mut()
                                .expect("stream should exist in stream mode")
                                .recv_gray_timeout(stream_recv_timeout)
                        });

                        match recv_result {
                            Ok(frame) => frame,
                            Err(error) => {
                                stream_mode = false;
                                stream = None;
                                on_log(
                                    "warn",
                                    format!(
                                        "图像匹配节点 '{}' 帧流接收异常，已降级为单帧抓取轮询：{}",
                                        node.label, error
                                    ),
                                );
                                continue;
                            }
                        }
                    } else {
                        Some(screenshot::capture_fullscreen_gray().map_err(|error| {
                            CommandFlowError::Automation(format!(
                                "imageMatch snapshot capture failed at node '{}': {}",
                                node.label, error
                            ))
                        })?)
                    };

                    let Some(frame) = frame else {
                        if started.elapsed() >= deadline {
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

                    if let Some(dir) = &debug_dir {
                        if attempts % debug_save_every == 0 {
                            let frame_path = dir.join(format!(
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

                    if matched_streak >= confirm_frames {
                        let (x, y) = evaluation
                            .matched_point
                            .ok_or_else(|| CommandFlowError::Automation("matched point missing".to_string()))?;
                        on_log(
                            "info",
                            format!(
                                "图像匹配节点 '{}' 连续命中 {} 帧，坐标=({}, {})，阈值={}，已确认通过。",
                                node.label, confirm_frames, x, y, threshold
                            ),
                        );

                        if let Some(dir) = &debug_dir {
                            let frame_path = dir.join(format!(
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
                        }

                        if click_on_match {
                            mouse::click(x, y, click_times)?;
                        }
                        return Ok(NextDirective::Branch("true"));
                    }

                    if started.elapsed() >= deadline {
                        on_log(
                            "warn",
                            format!(
                                "图像匹配节点 '{}' 在 {}ms 内未命中（peakSimilarity={:.4}），已走 false 分支。",
                                node.label, timeout_ms, best_similarity_seen
                            ),
                        );
                        return Ok(NextDirective::Branch("false"));
                    }

                    if !stream_mode {
                        if !fast_confirm_mode {
                            interruptible_sleep(poll_interval, should_cancel).await?;
                        }
                    }
                }
            }
            NodeKind::VarDefine => {
                let name = get_string(node, "name", "");
                if !name.trim().is_empty() {
                    let value = node.params.get("value").cloned().unwrap_or(Value::Null);
                    ctx.variables.entry(name).or_insert(value);
                }
                Ok(NextDirective::Default)
            }
            NodeKind::VarSet => {
                let name = get_string(node, "name", "");
                if !name.trim().is_empty() {
                    let value = node.params.get("value").cloned().unwrap_or(Value::Null);
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
                let operand = get_f64(node, "operand", 1.0);
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
