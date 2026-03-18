use crate::automation::{file_ops, image_match, keyboard, mouse, ocr_match, power, screenshot, start_menu, system_settings, uia, window};
use crate::secure_settings::{load_input_recording_presets, InputRecordingAction, InputRecordingPreset, RecordedCursorPoint};
use arboard::{Clipboard, ImageData};
use base64::Engine as _;
use base64::engine::general_purpose;
use regex::Regex;
use reqwest::header::{AUTHORIZATION, CONTENT_TYPE};
use rfd::{MessageButtons, MessageDialog, MessageDialogResult, MessageLevel};
use crate::error::{CommandFlowError, CommandResult};
use crate::workflow::graph::WorkflowGraph;
use crate::workflow::node::{NodeKind, WorkflowNode};
use image::{ImageBuffer, Rgba, RgbaImage};
use serde_json::{Map, Number, Value};
use std::backtrace::Backtrace;
use std::borrow::Cow;
use std::collections::{HashMap, HashSet, VecDeque};
use std::fs;
use std::io::ErrorKind;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use std::time::{SystemTime, UNIX_EPOCH};
use tokio::process::Command;
use tokio::time::{sleep, Duration};

const DEFAULT_POST_DELAY_MS: u64 = 1000;
const IMAGE_MATCH_DEBUG_SAVE_EVERY: u64 = 15;
const OCR_MATCH_DEBUG_SAVE_EVERY: u64 = 5;
const GUI_AGENT_MAX_SCREENSHOTS: usize = 5;
const GUI_AGENT_DEFAULT_MAX_STEPS: u64 = 20;
const GUI_AGENT_ACTION_PARSE_RETRIES: u64 = 3;
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

struct CommandExecutionResult {
    stdout: String,
    stderr: String,
    exit_code: i32,
}

struct ClipboardImageContent {
    data_url: String,
    width: u32,
    height: u32,
}

struct ClipboardWriteImage {
    rgba: Vec<u8>,
    width: usize,
    height: usize,
}

impl WorkflowExecutor {
    pub async fn execute(&self, graph: &WorkflowGraph) -> CommandResult<()> {
        let mut noop = |_node: &WorkflowNode| {};
        let mut noop_vars = |_variables: &HashMap<String, Value>| {};
        let mut noop_log = |_level: &str, _message: String| {};
        let mut noop_complete =
            |_node: &WorkflowNode,
             _outputs: &HashMap<String, Value>,
             _selected_control_output: Option<&str>| {};
        let never_cancel = || false;
        self.execute_with_progress(
            graph,
            &mut noop,
            &mut noop_vars,
            &mut noop_log,
            &mut noop_complete,
            &never_cancel,
        )
            .await
    }

    pub async fn execute_with_progress<F, G, H, J, I>(
        &self,
        graph: &WorkflowGraph,
        on_node_start: &mut F,
        on_variables_update: &mut G,
        on_log: &mut H,
        on_node_complete: &mut J,
        should_cancel: &I,
    ) -> CommandResult<()>
    where
        F: FnMut(&WorkflowNode),
        G: FnMut(&HashMap<String, Value>),
        H: FnMut(&str, String),
        J: FnMut(&WorkflowNode, &HashMap<String, Value>, Option<&str>),
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
            .filter(|node| is_manual_trigger_node(node))
            .map(|node| node.id.as_str())
            .collect();

        let auto_trigger_starts: Vec<&str> = graph
            .nodes
            .iter()
            .filter(|node| is_trigger_node(node) && !is_manual_trigger_node(node))
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
                    on_node_complete,
                    should_cancel,
                )
                    .await?;
            }
        }

        Ok(())
    }

    async fn execute_targets(
        &self,
        targets: &[String],
        graph: &WorkflowGraph,
        node_map: &HashMap<&str, &WorkflowNode>,
        ctx: &mut ExecutionContext,
        on_node_start: &mut impl FnMut(&WorkflowNode),
        on_variables_update: &mut impl FnMut(&HashMap<String, Value>),
        on_log: &mut impl FnMut(&str, String),
        on_node_complete: &mut impl FnMut(&WorkflowNode, &HashMap<String, Value>, Option<&str>),
        should_cancel: &impl Fn() -> bool,
    ) -> CommandResult<()> {
        for target in targets {
            Box::pin(self.execute_from_node(
                target,
                graph,
                node_map,
                ctx,
                on_node_start,
                on_variables_update,
                on_log,
                on_node_complete,
                should_cancel,
            ))
            .await?;
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
        on_node_complete: &mut impl FnMut(&WorkflowNode, &HashMap<String, Value>, Option<&str>),
        should_cancel: &impl Fn() -> bool,
    ) -> CommandResult<()> {
        let mut current_id = start_id.to_string();
        let mut guard_steps = 0usize;
        let mut loop_stack: Vec<String> = Vec::new();
        let mut pending_branch_targets: VecDeque<String> = VecDeque::new();

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
                ctx.node_outputs
                    .insert(effective_node.id.clone(), HashMap::<String, Value>::new());

                let outgoing: Vec<_> = graph
                    .edges
                    .iter()
                    .filter(|edge| {
                        edge.source == current_id
                            && is_control_flow_edge(edge.source_handle.as_deref(), edge.target_handle.as_deref())
                    })
                    .collect();

                let loop_edges: Vec<_> = if outgoing
                    .iter()
                    .any(|edge| edge.source_handle.as_deref() == Some("loop"))
                {
                    outgoing
                        .iter()
                        .filter(|edge| edge.source_handle.as_deref() == Some("loop"))
                        .copied()
                        .collect()
                } else {
                    outgoing.first().copied().into_iter().collect()
                };

                let done_edges: Vec<_> = if outgoing
                    .iter()
                    .any(|edge| edge.source_handle.as_deref() == Some("done"))
                {
                    outgoing
                        .iter()
                        .filter(|edge| edge.source_handle.as_deref() == Some("done"))
                        .copied()
                        .collect()
                } else {
                    outgoing
                        .iter()
                        .filter(|edge| edge.source_handle.as_deref() != Some("loop"))
                        .copied()
                        .collect()
                };

                on_variables_update(&ctx.variables);

                match effective_node.kind {
                    NodeKind::Loop => {
                        let times = get_u64(&effective_node, "times", 1);
                        let remaining = ctx
                            .loop_remaining
                            .entry(effective_node.id.clone())
                            .or_insert(times);

                        if *remaining > 0 {
                            if let Some(edge) = loop_edges.first().copied() {
                                *remaining -= 1;

                                if loop_stack.last().map(String::as_str) != Some(effective_node.id.as_str()) {
                                    loop_stack.push(effective_node.id.clone());
                                }

                                let outputs_snapshot = ctx
                                    .node_outputs
                                    .get(&effective_node.id)
                                    .cloned()
                                    .unwrap_or_default();
                                on_node_complete(&effective_node, &outputs_snapshot, Some("loop"));

                                sleep_after_node(&effective_node, should_cancel).await?;
                                for branch_edge in loop_edges.iter().skip(1) {
                                    pending_branch_targets.push_back(branch_edge.target.clone());
                                }
                                current_id = edge.target.clone();
                                continue;
                            }

                            *remaining = 0;
                        }

                        ctx.loop_remaining.remove(&effective_node.id);
                        if loop_stack.last().map(String::as_str) == Some(effective_node.id.as_str()) {
                            loop_stack.pop();
                        }

                        if let Some(edge) = done_edges.first().copied() {
                            let outputs_snapshot = ctx
                                .node_outputs
                                .get(&effective_node.id)
                                .cloned()
                                .unwrap_or_default();
                            on_node_complete(&effective_node, &outputs_snapshot, Some("done"));

                            sleep_after_node(&effective_node, should_cancel).await?;
                            for branch_edge in done_edges.iter().skip(1) {
                                pending_branch_targets.push_back(branch_edge.target.clone());
                            }
                            current_id = edge.target.clone();
                            continue;
                        }

                        if let Some(parent_loop_id) = loop_stack.last() {
                            let outputs_snapshot = ctx
                                .node_outputs
                                .get(&effective_node.id)
                                .cloned()
                                .unwrap_or_default();
                            on_node_complete(&effective_node, &outputs_snapshot, Some("done"));

                            sleep_after_node(&effective_node, should_cancel).await?;
                            current_id = parent_loop_id.clone();
                            continue;
                        }

                        let outputs_snapshot = ctx
                            .node_outputs
                            .get(&effective_node.id)
                            .cloned()
                            .unwrap_or_default();
                        on_node_complete(&effective_node, &outputs_snapshot, Some("done"));

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
                            if let Some(edge) = loop_edges.first().copied() {
                                *iterations += 1;

                                if loop_stack.last().map(String::as_str) != Some(effective_node.id.as_str()) {
                                    loop_stack.push(effective_node.id.clone());
                                }

                                let outputs_snapshot = ctx
                                    .node_outputs
                                    .get(&effective_node.id)
                                    .cloned()
                                    .unwrap_or_default();
                                on_node_complete(&effective_node, &outputs_snapshot, Some("loop"));

                                sleep_after_node(&effective_node, should_cancel).await?;
                                for branch_edge in loop_edges.iter().skip(1) {
                                    pending_branch_targets.push_back(branch_edge.target.clone());
                                }
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

                        if let Some(edge) = done_edges.first().copied() {
                            let outputs_snapshot = ctx
                                .node_outputs
                                .get(&effective_node.id)
                                .cloned()
                                .unwrap_or_default();
                            on_node_complete(&effective_node, &outputs_snapshot, Some("done"));

                            sleep_after_node(&effective_node, should_cancel).await?;
                            for branch_edge in done_edges.iter().skip(1) {
                                pending_branch_targets.push_back(branch_edge.target.clone());
                            }
                            current_id = edge.target.clone();
                            continue;
                        }

                        if let Some(parent_loop_id) = loop_stack.last() {
                            let outputs_snapshot = ctx
                                .node_outputs
                                .get(&effective_node.id)
                                .cloned()
                                .unwrap_or_default();
                            on_node_complete(&effective_node, &outputs_snapshot, Some("done"));

                            sleep_after_node(&effective_node, should_cancel).await?;
                            current_id = parent_loop_id.clone();
                            continue;
                        }

                        let outputs_snapshot = ctx
                            .node_outputs
                            .get(&effective_node.id)
                            .cloned()
                            .unwrap_or_default();
                        on_node_complete(&effective_node, &outputs_snapshot, Some("done"));

                        sleep_after_node(&effective_node, should_cancel).await?;
                        return Ok(());
                    }
                    _ => {}
                }
            }

            if matches!(effective_node.kind, NodeKind::TryCatch) {
                ctx.node_outputs
                    .insert(effective_node.id.clone(), HashMap::<String, Value>::new());

                let outgoing: Vec<_> = graph
                    .edges
                    .iter()
                    .filter(|edge| {
                        edge.source == current_id
                            && is_control_flow_edge(edge.source_handle.as_deref(), edge.target_handle.as_deref())
                    })
                    .collect();

                let branch_targets = |handle: &str| {
                    outgoing
                        .iter()
                        .filter(|edge| edge.source_handle.as_deref() == Some(handle))
                        .map(|edge| edge.target.clone())
                        .collect::<Vec<_>>()
                };

                let next_targets = {
                    let explicit = branch_targets("next");
                    if explicit.is_empty() {
                        outgoing
                            .iter()
                            .filter(|edge| edge.source_handle.is_none())
                            .map(|edge| edge.target.clone())
                            .collect::<Vec<_>>()
                    } else {
                        explicit
                    }
                };
                let success_targets = branch_targets("success");
                let error_targets = branch_targets("error");
                let finally_targets = branch_targets("finally");

                on_variables_update(&ctx.variables);

                let mut primary_error: Option<CommandFlowError> = None;
                let mut unresolved_error: Option<CommandFlowError> = None;

                if let Err(error) = self
                    .execute_targets(
                        &next_targets,
                        graph,
                        node_map,
                        ctx,
                        on_node_start,
                        on_variables_update,
                        on_log,
                        on_node_complete,
                        should_cancel,
                    )
                    .await
                {
                    primary_error = Some(error);
                }

                if primary_error.is_none() {
                    if let Err(error) = self
                        .execute_targets(
                            &success_targets,
                            graph,
                            node_map,
                            ctx,
                            on_node_start,
                            on_variables_update,
                            on_log,
                            on_node_complete,
                            should_cancel,
                        )
                        .await
                    {
                        primary_error = Some(error);
                    }
                }

                if let Some(error) = primary_error.take() {
                    set_try_catch_error_outputs(ctx, &effective_node, &error);

                    if error_targets.is_empty() {
                        unresolved_error = Some(error);
                    } else if let Err(catch_error) = self
                        .execute_targets(
                            &error_targets,
                            graph,
                            node_map,
                            ctx,
                            on_node_start,
                            on_variables_update,
                            on_log,
                            on_node_complete,
                            should_cancel,
                        )
                        .await
                    {
                        unresolved_error = Some(catch_error);
                    }
                } else {
                    clear_try_catch_error_outputs(ctx, &effective_node);
                }

                if let Err(finally_error) = self
                    .execute_targets(
                        &finally_targets,
                        graph,
                        node_map,
                        ctx,
                        on_node_start,
                        on_variables_update,
                        on_log,
                        on_node_complete,
                        should_cancel,
                    )
                    .await
                {
                    unresolved_error = Some(finally_error);
                }

                let outputs_snapshot = ctx
                    .node_outputs
                    .get(&effective_node.id)
                    .cloned()
                    .unwrap_or_default();
                let selected_control_output = if unresolved_error.is_some() {
                    Some("error")
                } else {
                    Some("success")
                };
                on_node_complete(&effective_node, &outputs_snapshot, selected_control_output);
                sleep_after_node(&effective_node, should_cancel).await?;
                on_variables_update(&ctx.variables);

                if let Some(error) = unresolved_error {
                    return Err(error);
                }

                if let Some(next_pending) = pending_branch_targets.pop_front() {
                    current_id = next_pending;
                    continue;
                }

                if let Some(active_loop_id) = loop_stack.last() {
                    current_id = active_loop_id.clone();
                    continue;
                }

                return Ok(());
            }

            let directive = self
                .execute_single_node(&effective_node, node, graph, ctx, on_log, should_cancel)
                .await?;
            let outputs_snapshot = ctx
                .node_outputs
                .get(&effective_node.id)
                .cloned()
                .unwrap_or_default();
            let selected_control_output = match &directive {
                NextDirective::Default => Some("next"),
                NextDirective::Branch(handle) => Some(*handle),
            };
            on_node_complete(&effective_node, &outputs_snapshot, selected_control_output);
            sleep_after_node(&effective_node, should_cancel).await?;
            on_variables_update(&ctx.variables);

            let next_edges: Vec<_> = match directive {
                NextDirective::Default => graph
                    .edges
                    .iter()
                    .filter(|edge| {
                        edge.source == current_id
                            && is_control_flow_edge(edge.source_handle.as_deref(), edge.target_handle.as_deref())
                    })
                    .collect(),
                NextDirective::Branch(handle) => graph
                    .edges
                    .iter()
                    .filter(|edge| {
                        edge.source == current_id
                            && edge.source_handle.as_deref() == Some(handle)
                            && is_control_flow_edge(edge.source_handle.as_deref(), edge.target_handle.as_deref())
                    })
                    .collect(),
            };

            match next_edges.first().copied() {
                Some(edge) => {
                    for branch_edge in next_edges.iter().skip(1) {
                        pending_branch_targets.push_back(branch_edge.target.clone());
                    }
                    current_id = edge.target.clone();
                }
                None => {
                    if let Some(next_pending) = pending_branch_targets.pop_front() {
                        current_id = next_pending;
                        continue;
                    }
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
        original_node: &WorkflowNode,
        graph: &WorkflowGraph,
        ctx: &mut ExecutionContext,
        on_log: &mut impl FnMut(&str, String),
        should_cancel: &impl Fn() -> bool,
    ) -> CommandResult<NextDirective> {
        ctx.node_outputs
            .insert(node.id.clone(), HashMap::<String, Value>::new());

        match node.kind {
            NodeKind::Trigger => execute_trigger_node(node, ctx, should_cancel, None).await,
            NodeKind::HotkeyTrigger => execute_trigger_node(node, ctx, should_cancel, Some("hotkey")).await,
            NodeKind::TimerTrigger => execute_trigger_node(node, ctx, should_cancel, Some("timer")).await,
            NodeKind::ManualTrigger => execute_trigger_node(node, ctx, should_cancel, Some("manual")).await,
            NodeKind::WindowTrigger => execute_trigger_node(node, ctx, should_cancel, Some("window")).await,
            NodeKind::UiaElement => execute_uia_element(node, ctx),
            NodeKind::MouseOperation => execute_mouse_operation(node, ctx, None),
            NodeKind::MouseClick => {
                execute_mouse_operation(node, ctx, Some("click"))
            }
            NodeKind::MouseMove => {
                execute_mouse_operation(node, ctx, Some("move"))
            }
            NodeKind::MouseDrag => {
                execute_mouse_operation(node, ctx, Some("drag"))
            }
            NodeKind::MouseWheel => {
                execute_mouse_operation(node, ctx, Some("wheel"))
            }
            NodeKind::MouseDown => {
                execute_mouse_operation(node, ctx, Some("down"))
            }
            NodeKind::MouseUp => {
                execute_mouse_operation(node, ctx, Some("up"))
            }
            NodeKind::KeyboardOperation => execute_keyboard_operation(node, ctx, should_cancel, None).await,
            NodeKind::KeyboardKey => {
                execute_keyboard_operation(node, ctx, should_cancel, Some("key")).await
            }
            NodeKind::KeyboardInput => {
                execute_keyboard_operation(node, ctx, should_cancel, Some("input")).await
            }
            NodeKind::KeyboardDown => {
                execute_keyboard_operation(node, ctx, should_cancel, Some("down")).await
            }
            NodeKind::KeyboardUp => {
                execute_keyboard_operation(node, ctx, should_cancel, Some("up")).await
            }
            NodeKind::Shortcut => {
                execute_keyboard_operation(node, ctx, should_cancel, Some("shortcut")).await
            }
            NodeKind::InputPresetReplay => {
                execute_input_preset_replay(node, ctx, should_cancel).await
            }
            NodeKind::Screenshot => {
                let output_path = resolve_screenshot_output_path(node)?;
                let fullscreen = get_bool(node, "fullscreen", false);

                let (rgba, width, height) = if fullscreen {
                    screenshot::capture_fullscreen_rgba()?
                } else {
                    let start_x = get_u32(node, "startX", 0);
                    let start_y = get_u32(node, "startY", 0);
                    let width = get_u32(node, "width", 320);
                    let height = get_u32(node, "height", 240);
                    screenshot::capture_region_rgba(start_x, start_y, width.max(1), height.max(1))?
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
                let metadata = execute_gui_agent_action(node, should_cancel, on_log).await?;
                set_node_output(ctx, node, "metadata", metadata);
                Ok(NextDirective::Default)
            }
            NodeKind::GuiAgentActionParser => {
                execute_gui_agent_action_parser(node, ctx, on_log)?;
                Ok(NextDirective::Default)
            }
            NodeKind::WindowActivate => {
                let connected_window_inputs = connected_window_input_keys(&original_node.id, graph);
                let has_connected_window_inputs = !connected_window_inputs.is_empty();
                let switch_mode = get_string(node, "switchMode", "title");
                if !has_connected_window_inputs && switch_mode.eq_ignore_ascii_case("shortcut") {
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
                    set_node_output(ctx, node, "program", Value::String(String::new()));
                    set_node_output(ctx, node, "programPath", Value::String(String::new()));
                    set_node_output(ctx, node, "className", Value::String(String::new()));
                    set_node_output(ctx, node, "processId", value_from_u64(0));
                } else {
                    let query = build_window_activate_query(node, &connected_window_inputs, has_connected_window_inputs)?;
                    let activated_window = window::activate_window(&query)?;
                    set_node_output(ctx, node, "title", Value::String(activated_window.title));
                    set_node_output(ctx, node, "program", Value::String(activated_window.program_name));
                    set_node_output(ctx, node, "programPath", Value::String(activated_window.program_path));
                    set_node_output(ctx, node, "className", Value::String(activated_window.class_name));
                    set_node_output(ctx, node, "processId", value_from_u64(activated_window.process_id as u64));
                }
                Ok(NextDirective::Default)
            }
            NodeKind::LaunchApplication => execute_launch_application(node, ctx, on_log),
            NodeKind::FileOperation => execute_file_operation(node, ctx, None, on_log),
            NodeKind::FileCopy => execute_file_operation(node, ctx, Some("copy"), on_log),
            NodeKind::FileMove => execute_file_operation(node, ctx, Some("move"), on_log),
            NodeKind::FileDelete => execute_file_operation(node, ctx, Some("delete"), on_log),
            NodeKind::RunCommand => execute_system_operation(node, ctx, Some("runCommand")).await,
            NodeKind::PythonCode => {
                run_python_code(node, on_log).await?;
                Ok(NextDirective::Default)
            }
            NodeKind::ClipboardRead => {
                let mut clipboard = Clipboard::new()
                    .map_err(|error| CommandFlowError::Automation(format!("初始化系统剪贴板失败：{}", error)))?;
                let read_mode_raw = get_string(node, "readMode", "auto");
                let read_mode = normalize_system_operation_name(&read_mode_raw);

                let text = match read_mode.as_str() {
                    "text" => Some(read_clipboard_text_required(&mut clipboard)?),
                    "image" => None,
                    _ => read_clipboard_text(&mut clipboard, false)?,
                };
                let image = match read_mode.as_str() {
                    "image" => Some(read_clipboard_image_required(&mut clipboard)?),
                    "text" => None,
                    _ => read_clipboard_image(&mut clipboard, false)?,
                };

                let has_text = text.is_some();
                let has_image = image.is_some();

                if !has_text && !has_image {
                    return Err(CommandFlowError::Automation(format!(
                        "剪贴板读取节点 '{}' 未读取到可用内容（模式：{}）",
                        node.label, read_mode_raw
                    )));
                }

                let content_type = match (has_text, has_image) {
                    (true, true) => "mixed",
                    (true, false) => "text",
                    (false, true) => "image",
                    (false, false) => "",
                };

                let text_value = text.clone().unwrap_or_default();
                let image_value = image
                    .as_ref()
                    .map(|content| content.data_url.clone())
                    .unwrap_or_default();
                let image_width = image.as_ref().map(|content| content.width).unwrap_or(0);
                let image_height = image.as_ref().map(|content| content.height).unwrap_or(0);

                set_node_output(ctx, node, "contentType", Value::String(content_type.to_string()));
                set_node_output(ctx, node, "text", Value::String(text_value.clone()));
                set_node_output(ctx, node, "image", Value::String(image_value.clone()));
                set_node_output(ctx, node, "imageWidth", value_from_u64(image_width as u64));
                set_node_output(ctx, node, "imageHeight", value_from_u64(image_height as u64));

                let mut structured = Map::new();
                structured.insert("contentType".to_string(), Value::String(content_type.to_string()));
                structured.insert(
                    "text".to_string(),
                    text.clone().map(Value::String).unwrap_or(Value::Null),
                );
                structured.insert(
                    "image".to_string(),
                    image
                        .as_ref()
                        .map(|content| Value::String(content.data_url.clone()))
                        .unwrap_or(Value::Null),
                );
                structured.insert(
                    "imageWidth".to_string(),
                    if has_image {
                        value_from_u64(image_width as u64)
                    } else {
                        Value::Null
                    },
                );
                structured.insert(
                    "imageHeight".to_string(),
                    if has_image {
                        value_from_u64(image_height as u64)
                    } else {
                        Value::Null
                    },
                );
                let structured_value = Value::Object(structured);
                set_node_output(ctx, node, "content", structured_value.clone());

                let output_var = get_string(node, "outputVar", "clipboardContent").trim().to_string();
                if !output_var.is_empty() {
                    ctx.variables.insert(output_var, structured_value);
                }

                if let Some(text) = text {
                    let output_text_var = get_string(node, "outputTextVar", "clipboardText").trim().to_string();
                    if !output_text_var.is_empty() {
                        ctx.variables.insert(output_text_var, Value::String(text));
                    }
                }

                if let Some(image) = image {
                    let output_image_var = get_string(node, "outputImageVar", "clipboardImage").trim().to_string();
                    if !output_image_var.is_empty() {
                        ctx.variables
                            .insert(output_image_var, Value::String(image.data_url));
                    }
                }

                on_log(
                    "info",
                    format!(
                        "剪贴板读取节点 '{}' 完成：contentType={}{}{}。",
                        node.label,
                        content_type,
                        if has_text {
                            format!("，文本 {} 字符", text_value.chars().count())
                        } else {
                            String::new()
                        },
                        if has_image {
                            format!("，图片 {}x{}", image_width, image_height)
                        } else {
                            String::new()
                        }
                    ),
                );

                Ok(NextDirective::Default)
            }
            NodeKind::ClipboardWrite => {
                let mut clipboard = Clipboard::new()
                    .map_err(|error| CommandFlowError::Automation(format!("初始化系统剪贴板失败：{}", error)))?;
                let content_type_raw = get_string(node, "contentType", "text");
                let content_type = normalize_system_operation_name(&content_type_raw);

                match content_type.as_str() {
                    "text" => {
                        let text = resolve_text_input(node, &ctx.variables);
                        clipboard
                            .set_text(text.clone())
                            .map_err(|error| CommandFlowError::Automation(format!("写入系统剪贴板文本失败：{}", error)))?;
                        on_log(
                            "info",
                            format!(
                                "剪贴板写入节点 '{}' 已写入 {} 字符文本。",
                                node.label,
                                text.chars().count()
                            ),
                        );
                    }
                    "image" => {
                        let image = resolve_clipboard_write_image(node, &ctx.variables)?;
                        clipboard
                            .set_image(ImageData {
                                width: image.width,
                                height: image.height,
                                bytes: Cow::Owned(image.rgba),
                            })
                            .map_err(|error| CommandFlowError::Automation(format!("写入系统剪贴板图片失败：{}", error)))?;
                        on_log(
                            "info",
                            format!(
                                "剪贴板写入节点 '{}' 已写入图片 {}x{}。",
                                node.label,
                                image.width,
                                image.height
                            ),
                        );
                    }
                    _ => {
                        return Err(CommandFlowError::Validation(format!(
                            "node '{}' has unsupported clipboard content type '{}'",
                            node.id, content_type_raw
                        )));
                    }
                }

                Ok(NextDirective::Default)
            }
            NodeKind::FileReadText => execute_file_operation(node, ctx, Some("readText"), on_log),
            NodeKind::FileWriteText => execute_file_operation(node, ctx, Some("writeText"), on_log),
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
            NodeKind::SystemOperation => execute_system_operation(node, ctx, None).await,
            NodeKind::PowerShutdown => execute_system_operation(node, ctx, Some("shutdown")).await,
            NodeKind::PowerRestart => execute_system_operation(node, ctx, Some("restart")).await,
            NodeKind::PowerSleep => execute_system_operation(node, ctx, Some("sleep")).await,
            NodeKind::PowerHibernate => execute_system_operation(node, ctx, Some("hibernate")).await,
            NodeKind::PowerLock => execute_system_operation(node, ctx, Some("lock")).await,
            NodeKind::PowerSignOut => execute_system_operation(node, ctx, Some("signOut")).await,
            NodeKind::SystemVolumeMute => execute_system_operation(node, ctx, Some("volumeMute")).await,
            NodeKind::SystemVolumeSet => execute_system_operation(node, ctx, Some("volumeSet")).await,
            NodeKind::SystemVolumeAdjust => execute_system_operation(node, ctx, Some("volumeAdjust")).await,
            NodeKind::SystemBrightnessSet => execute_system_operation(node, ctx, Some("brightnessSet")).await,
            NodeKind::SystemWifiSwitch => execute_system_operation(node, ctx, Some("wifiSwitch")).await,
            NodeKind::SystemBluetoothSwitch => execute_system_operation(node, ctx, Some("bluetoothSwitch")).await,
            NodeKind::SystemNetworkAdapterSwitch => execute_system_operation(node, ctx, Some("networkAdapterSwitch")).await,
            NodeKind::SystemTheme => execute_system_operation(node, ctx, Some("theme")).await,
            NodeKind::SystemPowerPlan => execute_system_operation(node, ctx, Some("powerPlan")).await,
            NodeKind::SystemOpenSettings => execute_system_operation(node, ctx, Some("openSettings")).await,
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
            NodeKind::TryCatch => Ok(NextDirective::Default),
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
            NodeKind::OcrMatch => execute_ocr_match(node, ctx, on_log, should_cancel).await,
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
            NodeKind::JsonExtract => {
                let source = parse_json_extract_source(node)?;
                let key_path = get_string(node, "keyPath", "");
                let value = extract_json_value_by_path(&source, &key_path).unwrap_or(Value::Null);
                set_node_output(ctx, node, "value", value);
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

fn is_trigger_node(node: &WorkflowNode) -> bool {
    matches!(
        node.kind,
        NodeKind::Trigger
            | NodeKind::HotkeyTrigger
            | NodeKind::TimerTrigger
            | NodeKind::ManualTrigger
            | NodeKind::WindowTrigger
    )
}

fn is_control_source_handle(handle: Option<&str>) -> bool {
    match handle {
        None => true,
        Some("next")
        | Some("true")
        | Some("false")
        | Some("loop")
        | Some("done")
        | Some("success")
        | Some("error")
        | Some("finally") => true,
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

fn error_kind_label(error: &CommandFlowError) -> &'static str {
    match error {
        CommandFlowError::Io(_) => "io",
        CommandFlowError::Validation(_) => "validation",
        CommandFlowError::Automation(_) => "automation",
        CommandFlowError::Canceled => "canceled",
    }
}

fn clear_try_catch_error_outputs(ctx: &mut ExecutionContext, node: &WorkflowNode) {
    set_node_output(ctx, node, "errorType", Value::String(String::new()));
    set_node_output(ctx, node, "errorMessage", Value::String(String::new()));
    set_node_output(ctx, node, "errorDebug", Value::String(String::new()));
}

fn set_try_catch_error_outputs(
    ctx: &mut ExecutionContext,
    node: &WorkflowNode,
    error: &CommandFlowError,
) {
    set_node_output(
        ctx,
        node,
        "errorType",
        Value::String(error_kind_label(error).to_string()),
    );
    set_node_output(
        ctx,
        node,
        "errorMessage",
        Value::String(error.to_string()),
    );
    set_node_output(
        ctx,
        node,
        "errorDebug",
        Value::String(format!("{:?}", error)),
    );
}

fn optional_string_param(node: &WorkflowNode, key: &str) -> Option<String> {
    let value = get_string(node, key, "");
    let trimmed = value.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

fn optional_process_id_param(node: &WorkflowNode, key: &str) -> Option<u32> {
    node.params
        .get(key)
        .and_then(|value| value.as_u64())
        .map(|value| value as u32)
        .filter(|value| *value > 0)
}

const WINDOW_LOOKUP_PARAM_KEYS: [&str; 5] = ["title", "program", "programPath", "className", "processId"];

fn connected_window_input_keys(node_id: &str, graph: &WorkflowGraph) -> HashSet<String> {
    graph
        .edges
        .iter()
        .filter(|edge| edge.target == node_id)
        .filter_map(|edge| edge.target_handle.as_deref())
        .filter_map(extract_param_key_from_input_handle)
        .filter(|field_key| WINDOW_LOOKUP_PARAM_KEYS.contains(&field_key.as_str()))
        .collect()
}

fn required_connected_string_param(
    node: &WorkflowNode,
    connected_inputs: &HashSet<String>,
    key: &str,
    display_name: &str,
) -> CommandResult<Option<String>> {
    if !connected_inputs.contains(key) {
        return Ok(None);
    }

    let value = get_string(node, key, "");
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(CommandFlowError::Validation(format!(
            "切换窗口节点 '{}' 的已连接输入 {} 为空",
            node.label, display_name
        )));
    }

    Ok(Some(trimmed.to_string()))
}

fn required_connected_process_id_param(
    node: &WorkflowNode,
    connected_inputs: &HashSet<String>,
) -> CommandResult<Option<u32>> {
    if !connected_inputs.contains("processId") {
        return Ok(None);
    }

    let process_id = optional_process_id_param(node, "processId").ok_or_else(|| {
        CommandFlowError::Validation(format!(
            "切换窗口节点 '{}' 的已连接输入 PID 无效",
            node.label
        ))
    })?;

    Ok(Some(process_id))
}

fn build_single_window_filter_query(key: &str, query: &window::WindowMatchQuery) -> window::WindowMatchQuery {
    let mut single = window::WindowMatchQuery::new(&query.match_mode);
    match key {
        "title" => single.title = query.title.clone(),
        "program" => single.program = query.program.clone(),
        "programPath" => single.program_path = query.program_path.clone(),
        "className" => single.class_name = query.class_name.clone(),
        "processId" => single.process_id = query.process_id,
        _ => {}
    }
    single
}

fn describe_connected_window_inputs(query: &window::WindowMatchQuery, connected_inputs: &HashSet<String>) -> Vec<String> {
    let mut descriptions = Vec::new();

    if connected_inputs.contains("title") {
        if let Some(title) = query.title.as_deref() {
            descriptions.push(format!("标题='{}'", title));
        }
    }
    if connected_inputs.contains("program") {
        if let Some(program) = query.program.as_deref() {
            descriptions.push(format!("程序='{}'", program));
        }
    }
    if connected_inputs.contains("programPath") {
        if let Some(program_path) = query.program_path.as_deref() {
            descriptions.push(format!("程序路径='{}'", program_path));
        }
    }
    if connected_inputs.contains("className") {
        if let Some(class_name) = query.class_name.as_deref() {
            descriptions.push(format!("类名='{}'", class_name));
        }
    }
    if connected_inputs.contains("processId") {
        if let Some(process_id) = query.process_id {
            descriptions.push(format!("PID={} ", process_id).trim().to_string());
        }
    }

    descriptions
}

fn validate_connected_window_activate_query(
    node: &WorkflowNode,
    query: &window::WindowMatchQuery,
    connected_inputs: &HashSet<String>,
) -> CommandResult<()> {
    let matched = window::list_matching_windows(query)?;
    if !matched.is_empty() {
        return Ok(());
    }

    let descriptions = describe_connected_window_inputs(query, connected_inputs);
    let mut matched_individually = Vec::new();
    let mut missing_individually = Vec::new();

    for key in WINDOW_LOOKUP_PARAM_KEYS {
        if !connected_inputs.contains(key) {
            continue;
        }

        let single_query = build_single_window_filter_query(key, query);
        let single_matches = window::list_matching_windows(&single_query)?;
        let description = descriptions
            .iter()
            .find(|item| match key {
                "title" => item.starts_with("标题="),
                "program" => item.starts_with("程序='"),
                "programPath" => item.starts_with("程序路径='"),
                "className" => item.starts_with("类名='"),
                "processId" => item.starts_with("PID="),
                _ => false,
            })
            .cloned()
            .unwrap_or_else(|| key.to_string());

        if single_matches.is_empty() {
            missing_individually.push(description);
        } else {
            matched_individually.push(description);
        }
    }

    if matched_individually.len() > 1 && missing_individually.is_empty() {
        return Err(CommandFlowError::Validation(format!(
            "切换窗口节点 '{}' 的多个已连接输入互相冲突：{}。请确保这些输入指向同一个窗口程序。",
            node.label,
            matched_individually.join("、")
        )));
    }

    if !missing_individually.is_empty() {
        return Err(CommandFlowError::Automation(format!(
            "切换窗口节点 '{}' 未找到匹配的输入条件：{}",
            node.label,
            missing_individually.join("、")
        )));
    }

    Err(CommandFlowError::Automation(format!(
        "切换窗口节点 '{}' 未找到同时满足以下条件的窗口：{}",
        node.label,
        descriptions.join("、")
    )))
}

fn build_window_activate_query(
    node: &WorkflowNode,
    connected_inputs: &HashSet<String>,
    has_connected_window_inputs: bool,
) -> CommandResult<window::WindowMatchQuery> {
    let match_mode = get_string(node, "matchMode", "contains");

    if has_connected_window_inputs {
        let mut query = window::WindowMatchQuery::new(&match_mode);
        query.title = required_connected_string_param(node, connected_inputs, "title", "标题")?;
        query.program = required_connected_string_param(node, connected_inputs, "program", "程序")?;
        query.program_path = required_connected_string_param(node, connected_inputs, "programPath", "程序路径")?;
        query.class_name = required_connected_string_param(node, connected_inputs, "className", "类名")?;
        query.process_id = required_connected_process_id_param(node, connected_inputs)?;

        validate_connected_window_activate_query(node, &query, connected_inputs)?;
        return Ok(query);
    }

    let switch_mode = get_string(node, "switchMode", "title");
    let title = get_string(node, "title", "");
    let program = get_string(node, "program", "");
    Ok(build_window_match_query(node, &switch_mode, &title, &program, &match_mode))
}

fn build_window_match_query(
    node: &WorkflowNode,
    primary_target: &str,
    title: &str,
    program: &str,
    match_mode: &str,
) -> window::WindowMatchQuery {
    let mut query = window::WindowMatchQuery::new(match_mode);
    if primary_target.eq_ignore_ascii_case("program") {
        if !program.trim().is_empty() {
            query.program = Some(program.trim().to_string());
        }
    } else if !title.trim().is_empty() {
        query.title = Some(title.trim().to_string());
    }

    query.program_path = optional_string_param(node, "programPath");
    query.class_name = optional_string_param(node, "className");
    query.process_id = optional_process_id_param(node, "processId");
    query
}

fn describe_window_query(primary_target: &str, match_value: &str, query: &window::WindowMatchQuery) -> String {
    let mut parts = vec![format!(
        "{} '{}'",
        if primary_target.eq_ignore_ascii_case("program") { "program" } else { "title" },
        match_value
    )];

    if let Some(program_path) = query.program_path.as_deref() {
        parts.push(format!("programPath '{}'", program_path));
    }
    if let Some(class_name) = query.class_name.as_deref() {
        parts.push(format!("className '{}'", class_name));
    }
    if let Some(process_id) = query.process_id {
        parts.push(format!("pid {}", process_id));
    }

    parts.join(", ")
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

fn is_manual_trigger_node(node: &WorkflowNode) -> bool {
    match node.kind {
        NodeKind::Trigger => normalize_trigger_mode_name(&get_string(node, "triggerType", "manual")) == "manual",
        NodeKind::ManualTrigger => true,
        _ => false,
    }
}

fn normalize_trigger_mode_name(value: &str) -> String {
    value
        .chars()
        .filter(|ch| *ch != '-' && *ch != '_' && !ch.is_whitespace())
        .flat_map(|ch| ch.to_lowercase())
        .collect()
}

async fn execute_trigger_node(
    node: &WorkflowNode,
    ctx: &mut ExecutionContext,
    should_cancel: &impl Fn() -> bool,
    trigger_mode_override: Option<&str>,
) -> CommandResult<NextDirective> {
    let requested = trigger_mode_override
        .map(ToString::to_string)
        .unwrap_or_else(|| get_string(node, "triggerType", "manual"));
    let trigger_mode = normalize_trigger_mode_name(&requested);

    match trigger_mode.as_str() {
        "hotkey" => {
            let hotkey = get_string(node, "hotkey", "Ctrl+Shift+R");
            let timeout_ms = get_u64(node, "timeoutMs", 30_000);
            let poll_ms = get_u64(node, "pollMs", 50);
            keyboard::wait_for_hotkey(&hotkey, timeout_ms, poll_ms).await?;
            Ok(NextDirective::Default)
        }
        "timer" => {
            let interval_ms = get_u64(node, "intervalMs", 1000);
            interruptible_sleep(Duration::from_millis(interval_ms), should_cancel).await?;
            Ok(NextDirective::Default)
        }
        "manual" => Ok(NextDirective::Default),
        "window" => {
            let match_target = get_string(node, "matchTarget", "title");
            let title = get_string(node, "title", "");
            let program = get_string(node, "program", "");
            let match_mode = get_string(node, "matchMode", "contains");
            let timeout_ms = get_u64(node, "timeoutMs", 30_000);
            let poll_ms = get_u64(node, "pollMs", 250);

            let waiting_for_program = match_target.eq_ignore_ascii_case("program");
            let match_value = if waiting_for_program {
                program.trim()
            } else {
                title.trim()
            };

            if match_value.is_empty() {
                return Err(CommandFlowError::Validation(format!(
                    "node '{}' window trigger {} is empty",
                    node.id,
                    if waiting_for_program { "program" } else { "title" }
                )));
            }

            let query = build_window_match_query(node, &match_target, &title, &program, &match_mode);
            let query_description = describe_window_query(&match_target, match_value, &query);

            let poll_interval = Duration::from_millis(poll_ms.max(10));
            let deadline = Duration::from_millis(timeout_ms);
            let started = tokio::time::Instant::now();
            let matched_window = loop {
                if should_cancel() {
                    return Err(CommandFlowError::Canceled);
                }

                let matched = window::foreground_window_matches(&query)?;

                if let Some(window) = matched {
                    break window;
                }

                if started.elapsed() >= deadline {
                    return Err(CommandFlowError::Automation(format!(
                        "window trigger timed out after {} ms waiting for foreground window {}",
                        timeout_ms, query_description
                    )));
                }

                interruptible_sleep(poll_interval, should_cancel).await?;
            };

            set_node_output(ctx, node, "title", Value::String(matched_window.title));
            set_node_output(ctx, node, "program", Value::String(matched_window.program_name));
            set_node_output(ctx, node, "programPath", Value::String(matched_window.program_path));
            set_node_output(ctx, node, "className", Value::String(matched_window.class_name));
            set_node_output(ctx, node, "processId", value_from_u64(matched_window.process_id as u64));

            Ok(NextDirective::Default)
        }
        _ => Err(CommandFlowError::Validation(format!(
            "node '{}' has unsupported trigger type '{}'",
            node.id, requested
        ))),
    }
}

fn normalize_system_operation_name(value: &str) -> String {
    value
        .chars()
        .filter(|ch| *ch != '-' && *ch != '_' && !ch.is_whitespace())
        .flat_map(|ch| ch.to_lowercase())
        .collect()
}

fn execute_launch_application(
    node: &WorkflowNode,
    ctx: &mut ExecutionContext,
    on_log: &mut impl FnMut(&str, String),
) -> CommandResult<NextDirective> {
    let launch_mode = start_menu::ApplicationLaunchMode::from_param(&get_string(node, "launchMode", "auto"));
    let selected_app = get_string(node, "selectedApp", "");
    let app_name = get_string(node, "appName", "");
    let target_path = get_string(node, "targetPath", "");
    let source_path = get_string(node, "sourcePath", "");
    let icon_path = get_string(node, "iconPath", "");

    if selected_app.trim().is_empty() && target_path.trim().is_empty() && source_path.trim().is_empty() {
        return Err(CommandFlowError::Validation(format!(
            "node '{}' 尚未选择要启动的应用",
            node.id
        )));
    }

    let entry = start_menu::resolve_launch_application_entry(
        &target_path,
        Some(&source_path),
        Some(&app_name),
        Some(&icon_path),
    )?;

    let pid = start_menu::launch_application(&entry, launch_mode)?;

    set_node_output(ctx, node, "appName", Value::String(entry.app_name.clone()));
    set_node_output(ctx, node, "targetPath", Value::String(entry.target_path.clone()));
    set_node_output(ctx, node, "sourcePath", Value::String(entry.source_path.clone()));
    set_node_output(ctx, node, "iconPath", Value::String(entry.icon_path.clone()));
    if let Some(pid) = pid {
        set_node_output(ctx, node, "pid", value_from_u64(pid as u64));
    }

    on_log(
        "info",
        format!(
            "启动应用节点 '{}' 已启动 '{}'（target='{}'{}）。",
            node.label,
            entry.app_name,
            entry.target_path,
            pid.map(|value| format!(", pid={}", value)).unwrap_or_default()
        ),
    );

    Ok(NextDirective::Default)
}

async fn execute_ocr_match(
    node: &WorkflowNode,
    ctx: &mut ExecutionContext,
    on_log: &mut impl FnMut(&str, String),
    should_cancel: &impl Fn() -> bool,
) -> CommandResult<NextDirective> {
    let target_text = get_string(node, "targetText", "");
    if target_text.trim().is_empty() {
        return Err(CommandFlowError::Validation(format!(
            "node '{}' targetText cannot be empty",
            node.id
        )));
    }

    let source_path = get_string(node, "sourcePath", "");
    let match_mode = get_string(node, "matchMode", "contains");
    let case_sensitive = get_bool(node, "caseSensitive", false);
    let use_regex = get_bool(node, "useRegex", false);
    let min_confidence = get_f32(node, "minConfidence", 0.5).clamp(0.0, 1.0);
    let timeout_ms = get_u64(node, "timeoutMs", 10_000);
    let poll_ms = get_u64(node, "pollMs", 120).max(1);
    let confirm_frames = get_u64(node, "confirmFrames", 2).max(1);
    let click_on_match = get_bool(node, "clickOnMatch", false);
    let click_times = get_u64(node, "clickTimes", 1).max(1) as usize;
    let debug_dir = prepare_ocr_match_debug_dir(node)?;

    on_log(
        "info",
        format!(
            "OCR 匹配节点 '{}' 调试文件将写入：{}",
            node.label,
            debug_dir.display()
        ),
    );

    if !source_path.trim().is_empty() {
        let evaluation = evaluate_ocr_path_blocking(
            &source_path,
            &target_text,
            &match_mode,
            case_sensitive,
            use_regex,
            min_confidence,
        )
        .await?;

        if let Err(error) = save_ocr_static_debug_artifacts(
            &debug_dir,
            &source_path,
            &evaluation,
            &target_text,
            &match_mode,
            case_sensitive,
            use_regex,
            min_confidence,
            node,
        ) {
            on_log(
                "warn",
                format!("OCR 匹配节点 '{}' 写入调试文件失败：{}", node.label, error),
            );
        }

        set_node_output(
            ctx,
            node,
            "confidence",
            value_from_f64(evaluation.peak_confidence as f64),
        );

        if let Some(candidate) = evaluation.matched {
            set_node_output(ctx, node, "matchX", value_from_i32(candidate.x));
            set_node_output(ctx, node, "matchY", value_from_i32(candidate.y));
            set_node_output(ctx, node, "matchedText", Value::String(candidate.text.clone()));
            set_node_output(
                ctx,
                node,
                "confidence",
                value_from_f64(candidate.confidence as f64),
            );

            on_log(
                "info",
                format!(
                    "OCR 匹配节点 '{}' 命中，text='{}'，confidence={:.4}，坐标=({}, {})。",
                    node.label, candidate.text, candidate.confidence, candidate.x, candidate.y
                ),
            );

            if click_on_match && candidate.x >= 0 && candidate.y >= 0 {
                mouse::click(candidate.x, candidate.y, click_times)?;
            }

            return Ok(NextDirective::Branch("true"));
        }

        on_log(
            "warn",
            format!(
                "OCR 匹配节点 '{}' 静态源图未命中（peakConfidence={:.4}，peakText='{}'），已走 false 分支。",
                node.label, evaluation.peak_confidence, evaluation.peak_text
            ),
        );
        return Ok(NextDirective::Branch("false"));
    }

    let started = tokio::time::Instant::now();
    let deadline = Duration::from_millis(timeout_ms);
    let poll_interval = Duration::from_millis(poll_ms);
    let mut attempts: u64 = 0;
    let mut matched_streak: u64 = 0;
    let mut best_confidence_seen = 0.0_f32;
    let mut best_text_seen = String::new();

    loop {
        if should_cancel() {
            return Err(CommandFlowError::Canceled);
        }

        let (rgba, width, height) = screenshot::capture_fullscreen_rgba()?;
        attempts += 1;
        let debug_rgba = rgba.clone();

        let evaluation = evaluate_ocr_rgba_blocking(
            rgba,
            width,
            height,
            &target_text,
            &match_mode,
            case_sensitive,
            use_regex,
            min_confidence,
        )
        .await?;

        if evaluation.peak_confidence > best_confidence_seen {
            best_confidence_seen = evaluation.peak_confidence;
            best_text_seen = evaluation.peak_text.clone();
        }

        set_node_output(
            ctx,
            node,
            "confidence",
            value_from_f64(evaluation.peak_confidence as f64),
        );

        let is_timeout_now = started.elapsed() >= deadline;
        let should_save_debug = attempts == 1
            || attempts % OCR_MATCH_DEBUG_SAVE_EVERY == 0
            || evaluation.matched.is_some()
            || is_timeout_now;
        if should_save_debug {
            if let Err(error) = save_ocr_frame_debug_artifacts(
                &debug_dir,
                attempts,
                &debug_rgba,
                width,
                height,
                &evaluation,
                &target_text,
                &match_mode,
                case_sensitive,
                use_regex,
                min_confidence,
                node,
            ) {
                on_log(
                    "warn",
                    format!("OCR 匹配节点 '{}' 写入调试文件失败：{}", node.label, error),
                );
            }
        }

        if let Some(candidate) = evaluation.matched {
            matched_streak += 1;

            on_log(
                "info",
                format!(
                    "OCR 匹配节点 '{}' 第 {} 帧命中，text='{}'，confidence={:.4}，confirm={}/{}。",
                    node.label,
                    attempts,
                    candidate.text,
                    candidate.confidence,
                    matched_streak,
                    confirm_frames
                ),
            );

            if matched_streak >= confirm_frames {
                set_node_output(ctx, node, "matchX", value_from_i32(candidate.x));
                set_node_output(ctx, node, "matchY", value_from_i32(candidate.y));
                set_node_output(ctx, node, "matchedText", Value::String(candidate.text.clone()));
                set_node_output(
                    ctx,
                    node,
                    "confidence",
                    value_from_f64(candidate.confidence as f64),
                );

                on_log(
                    "info",
                    format!(
                        "OCR 匹配节点 '{}' 连续命中 {} 帧，text='{}'，坐标=({}, {})，置信度={:.4}。",
                        node.label,
                        confirm_frames,
                        candidate.text,
                        candidate.x,
                        candidate.y,
                        candidate.confidence
                    ),
                );

                if click_on_match && candidate.x >= 0 && candidate.y >= 0 {
                    mouse::click(candidate.x, candidate.y, click_times)?;
                }

                return Ok(NextDirective::Branch("true"));
            }
        } else {
            matched_streak = 0;
        }

        if is_timeout_now {
            on_log(
                "warn",
                format!(
                    "OCR 匹配节点 '{}' 在 {}ms 内未命中（peakConfidence={:.4}，peakText='{}'），已走 false 分支。",
                    node.label, timeout_ms, best_confidence_seen, best_text_seen
                ),
            );
            return Ok(NextDirective::Branch("false"));
        }

        interruptible_sleep(poll_interval, should_cancel).await?;
    }
}

async fn evaluate_ocr_path_blocking(
    source_path: &str,
    target_text: &str,
    match_mode: &str,
    case_sensitive: bool,
    use_regex: bool,
    min_confidence: f32,
) -> CommandResult<ocr_match::OcrMatchEvaluation> {
    let source_path = source_path.to_string();
    let target_text = target_text.to_string();
    let match_mode = match_mode.to_string();

    tokio::task::spawn_blocking(move || {
        ocr_match::evaluate_path(
            &source_path,
            &target_text,
            &match_mode,
            case_sensitive,
            use_regex,
            min_confidence,
        )
    })
    .await
    .map_err(|error| CommandFlowError::Automation(format!("OCR 任务线程执行失败：{}", error)))?
}

async fn evaluate_ocr_rgba_blocking(
    rgba: Vec<u8>,
    width: u32,
    height: u32,
    target_text: &str,
    match_mode: &str,
    case_sensitive: bool,
    use_regex: bool,
    min_confidence: f32,
) -> CommandResult<ocr_match::OcrMatchEvaluation> {
    let target_text = target_text.to_string();
    let match_mode = match_mode.to_string();

    tokio::task::spawn_blocking(move || {
        ocr_match::evaluate_rgba(
            rgba,
            width,
            height,
            &target_text,
            &match_mode,
            case_sensitive,
            use_regex,
            min_confidence,
        )
    })
    .await
    .map_err(|error| CommandFlowError::Automation(format!("OCR 任务线程执行失败：{}", error)))?
}

fn execute_file_operation(
    node: &WorkflowNode,
    ctx: &mut ExecutionContext,
    operation_override: Option<&str>,
    on_log: &mut impl FnMut(&str, String),
) -> CommandResult<NextDirective> {
    let requested = operation_override
        .map(ToString::to_string)
        .unwrap_or_else(|| get_string(node, "operation", "copy"));
    let operation = normalize_system_operation_name(&requested);

    set_node_output(ctx, node, "operation", Value::String(requested.clone()));

    match operation.as_str() {
        "copy" => {
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
            set_node_output(ctx, node, "action", Value::String("copy".to_string()));
        }
        "move" => {
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
            set_node_output(ctx, node, "action", Value::String("move".to_string()));
        }
        "delete" => {
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
            set_node_output(ctx, node, "action", Value::String("delete".to_string()));
        }
        "readtext" => {
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
            set_node_output(ctx, node, "action", Value::String("readText".to_string()));
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
        }
        "writetext" => {
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
            set_node_output(ctx, node, "action", Value::String("writeText".to_string()));

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
        }
        _ => {
            return Err(CommandFlowError::Validation(format!(
                "node '{}' has unsupported file operation '{}'",
                node.id, requested
            )));
        }
    }

    Ok(NextDirective::Default)
}

async fn execute_system_operation(
    node: &WorkflowNode,
    ctx: &mut ExecutionContext,
    operation_override: Option<&str>,
) -> CommandResult<NextDirective> {
    let requested = operation_override
        .map(ToString::to_string)
        .unwrap_or_else(|| get_string(node, "operation", "shutdown"));
    let operation = normalize_system_operation_name(&requested);

    set_node_output(ctx, node, "operation", Value::String(requested.clone()));

    match operation.as_str() {
        "shutdown" => {
            let timeout_sec = get_u64(node, "timeoutSec", 0);
            let force = get_bool(node, "force", false);
            power::shutdown(timeout_sec, force).await?;
            set_node_output(ctx, node, "action", Value::String("shutdown".to_string()));
        }
        "restart" => {
            let timeout_sec = get_u64(node, "timeoutSec", 0);
            let force = get_bool(node, "force", false);
            power::restart(timeout_sec, force).await?;
            set_node_output(ctx, node, "action", Value::String("restart".to_string()));
        }
        "sleep" => {
            power::sleep().await?;
            set_node_output(ctx, node, "action", Value::String("sleep".to_string()));
        }
        "hibernate" => {
            power::hibernate().await?;
            set_node_output(ctx, node, "action", Value::String("hibernate".to_string()));
        }
        "lock" => {
            power::lock_screen().await?;
            set_node_output(ctx, node, "action", Value::String("lock".to_string()));
        }
        "signout" => {
            let force = get_bool(node, "force", false);
            power::sign_out(force).await?;
            set_node_output(ctx, node, "action", Value::String("signOut".to_string()));
        }
        "volumemute" => {
            let mode = get_string(node, "mode", "toggle");
            system_settings::set_volume_mute(&mode).await?;
            set_node_output(ctx, node, "mode", Value::String(mode));
        }
        "volumeset" => {
            let percent = get_u64(node, "percent", 50).min(100) as u8;
            system_settings::set_volume_percent(percent).await?;
            set_node_output(ctx, node, "percent", value_from_u64(percent as u64));
        }
        "volumeadjust" => {
            let delta = get_i32(node, "delta", 10);
            system_settings::adjust_volume(delta).await?;
            set_node_output(ctx, node, "delta", value_from_i32(delta));
        }
        "brightnessset" => {
            let percent = get_u64(node, "percent", 60).min(100) as u8;
            system_settings::set_brightness_percent(percent).await?;
            set_node_output(ctx, node, "percent", value_from_u64(percent as u64));
        }
        "wifiswitch" => {
            let state = get_string(node, "state", "toggle");
            system_settings::switch_wifi(&state).await?;
            set_node_output(ctx, node, "state", Value::String(state));
        }
        "bluetoothswitch" => {
            let state = get_string(node, "state", "toggle");
            system_settings::switch_bluetooth(&state).await?;
            set_node_output(ctx, node, "state", Value::String(state));
        }
        "networkadapterswitch" => {
            let adapter_name = get_string(node, "adapterName", "");
            let state = get_string(node, "state", "toggle");
            let adapter_name_opt = if adapter_name.trim().is_empty() {
                None
            } else {
                Some(adapter_name.as_str())
            };
            system_settings::switch_network_adapter(adapter_name_opt, &state).await?;
            set_node_output(ctx, node, "adapterName", Value::String(adapter_name));
            set_node_output(ctx, node, "state", Value::String(state));
        }
        "theme" => {
            let mode = get_string(node, "mode", "dark");
            system_settings::set_theme(&mode).await?;
            set_node_output(ctx, node, "mode", Value::String(mode));
        }
        "powerplan" => {
            let plan = get_string(node, "plan", "balanced");
            system_settings::set_power_plan(&plan).await?;
            set_node_output(ctx, node, "plan", Value::String(plan));
        }
        "opensettings" => {
            let page = get_string(node, "page", "system");
            system_settings::open_settings_page(&page).await?;
            set_node_output(ctx, node, "page", Value::String(page));
        }
        "runcommand" => {
            let command = get_string(node, "command", "");
            if command.trim().is_empty() {
                return Err(CommandFlowError::Validation(format!(
                    "node '{}' command is empty",
                    node.id
                )));
            }

            let use_shell = get_bool(node, "shell", true);
            let shell_type = get_string(node, "shellType", "cmd");
            let result = run_system_command(&command, use_shell, &shell_type).await?;
            set_node_output(ctx, node, "action", Value::String("runCommand".to_string()));
            set_node_output(ctx, node, "command", Value::String(command));
            set_node_output(ctx, node, "shellType", Value::String(shell_type));
            set_node_output(ctx, node, "stdout", Value::String(result.stdout));
            set_node_output(ctx, node, "stderr", Value::String(result.stderr));
            set_node_output(ctx, node, "exitCode", value_from_i32(result.exit_code));
        }
        _ => {
            return Err(CommandFlowError::Validation(format!(
                "node '{}' has unsupported system operation '{}'",
                node.id, requested
            )));
        }
    }

    Ok(NextDirective::Default)
}

fn execute_mouse_operation(
    node: &WorkflowNode,
    ctx: &mut ExecutionContext,
    operation_override: Option<&str>,
) -> CommandResult<NextDirective> {
    let requested = operation_override
        .map(ToString::to_string)
        .unwrap_or_else(|| get_string(node, "operation", "click"));
    let operation = normalize_system_operation_name(&requested);

    set_node_output(ctx, node, "operation", Value::String(requested.clone()));

    let target_mode = normalize_system_operation_name(&get_string(node, "targetMode", "coordinate"));

    match operation.as_str() {
        "click" => {
            let (x, y) = resolve_mouse_target_point(node, &target_mode)?;
            let times = get_u64(node, "times", 1) as usize;
            mouse::click(x, y, times.max(1))?;
            set_node_output(ctx, node, "x", value_from_i32(x));
            set_node_output(ctx, node, "y", value_from_i32(y));
        }
        "move" => {
            let (x, y) = resolve_mouse_target_point(node, &target_mode)?;
            mouse::move_to(x, y)?;
            set_node_output(ctx, node, "x", value_from_i32(x));
            set_node_output(ctx, node, "y", value_from_i32(y));
        }
        "drag" => {
            let from_x = get_i32(node, "fromX", 0);
            let from_y = get_i32(node, "fromY", 0);
            let to_x = get_i32(node, "toX", 0);
            let to_y = get_i32(node, "toY", 0);
            mouse::drag(from_x, from_y, to_x, to_y)?;
            set_node_output(ctx, node, "toX", value_from_i32(to_x));
            set_node_output(ctx, node, "toY", value_from_i32(to_y));
        }
        "wheel" => {
            let vertical = get_i32(node, "vertical", -1);
            mouse::wheel(vertical)?;
            set_node_output(ctx, node, "vertical", value_from_i32(vertical));
        }
        "down" => {
            let (x, y) = resolve_mouse_target_point(node, &target_mode)?;
            let button = get_string(node, "button", "left");
            mouse::button_down(x, y, &button)?;
            set_node_output(ctx, node, "x", value_from_i32(x));
            set_node_output(ctx, node, "y", value_from_i32(y));
            set_node_output(ctx, node, "button", Value::String(button));
        }
        "up" => {
            let (x, y) = resolve_mouse_target_point(node, &target_mode)?;
            let button = get_string(node, "button", "left");
            mouse::button_up(x, y, &button)?;
            set_node_output(ctx, node, "x", value_from_i32(x));
            set_node_output(ctx, node, "y", value_from_i32(y));
            set_node_output(ctx, node, "button", Value::String(button));
        }
        _ => {
            return Err(CommandFlowError::Validation(format!(
                "node '{}' has unsupported mouse operation '{}'",
                node.id, requested
            )));
        }
    }

    Ok(NextDirective::Default)
}

fn execute_uia_element(node: &WorkflowNode, ctx: &mut ExecutionContext) -> CommandResult<NextDirective> {
    let locator = parse_ui_element_locator_param(node, "elementLocator")?;
    let preview = uia::resolve_locator(&locator)?;

    set_node_output(ctx, node, "centerX", value_from_i32(preview.center_x));
    set_node_output(ctx, node, "centerY", value_from_i32(preview.center_y));
    set_node_output(ctx, node, "name", Value::String(preview.name.clone()));
    set_node_output(ctx, node, "className", Value::String(preview.class_name.clone()));
    set_node_output(ctx, node, "automationId", Value::String(preview.automation_id.clone()));
    set_node_output(ctx, node, "controlType", value_from_i32(preview.control_type));
    set_node_output(ctx, node, "processId", value_from_u64(preview.process_id as u64));
    set_node_output(
        ctx,
        node,
        "rect",
        serde_json::to_value(&preview.rect)
            .map_err(|error| CommandFlowError::Automation(format!("序列化 UIA rect 失败：{}", error)))?,
    );
    set_node_output(
        ctx,
        node,
        "elementLocator",
        serde_json::to_value(&preview.locator)
            .map_err(|error| CommandFlowError::Automation(format!("序列化 UIA locator 失败：{}", error)))?,
    );
    set_node_output(ctx, node, "summary", Value::String(preview.summary.clone()));
    set_node_output(
        ctx,
        node,
        "fingerprint",
        Value::String(preview.locator.fingerprint.clone()),
    );

    Ok(NextDirective::Default)
}

fn resolve_mouse_target_point(node: &WorkflowNode, target_mode: &str) -> CommandResult<(i32, i32)> {
    if target_mode == "uielement" {
        let locator = parse_ui_element_locator_param(node, "elementLocator")?;
        return uia::resolve_locator_center(&locator);
    }

    Ok((get_i32(node, "x", 0), get_i32(node, "y", 0)))
}

fn parse_ui_element_locator_param(
    node: &WorkflowNode,
    param_key: &str,
) -> CommandResult<uia::UiElementLocator> {
    let value = node.params.get(param_key).ok_or_else(|| {
        CommandFlowError::Validation(format!(
            "node '{}' 缺少 {}，无法进行 UIA 元素定位",
            node.id, param_key
        ))
    })?;

    match value {
        Value::Object(_) => serde_json::from_value::<uia::UiElementLocator>(value.clone()).map_err(|error| {
            CommandFlowError::Validation(format!(
                "node '{}' {} 格式无效：{}",
                node.id, param_key, error
            ))
        }),
        Value::String(text) => {
            let trimmed = text.trim();
            if trimmed.is_empty() {
                return Err(CommandFlowError::Validation(format!(
                    "node '{}' {} 为空字符串",
                    node.id, param_key
                )));
            }

            serde_json::from_str::<uia::UiElementLocator>(trimmed).map_err(|error| {
                CommandFlowError::Validation(format!(
                    "node '{}' {} JSON 解析失败：{}",
                    node.id, param_key, error
                ))
            })
        }
        _ => Err(CommandFlowError::Validation(format!(
            "node '{}' {} 必须是对象或 JSON 字符串",
            node.id, param_key
        ))),
    }
}

async fn execute_keyboard_operation(
    node: &WorkflowNode,
    ctx: &mut ExecutionContext,
    should_cancel: &impl Fn() -> bool,
    operation_override: Option<&str>,
) -> CommandResult<NextDirective> {
    let requested = operation_override
        .map(ToString::to_string)
        .unwrap_or_else(|| get_string(node, "operation", "key"));
    let operation = normalize_system_operation_name(&requested);

    set_node_output(ctx, node, "operation", Value::String(requested.clone()));

    match operation.as_str() {
        "key" => {
            let key = get_string(node, "key", "Enter");
            keyboard::key_tap_by_name(&key)?;
            set_node_output(ctx, node, "key", Value::String(key));
        }
        "input" => {
            let text = get_string(node, "text", "");
            keyboard::text_input(&text)?;
            set_node_output(ctx, node, "text", Value::String(text));
        }
        "down" => {
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
        }
        "up" => {
            let key = get_string(node, "key", "Shift");
            keyboard::key_up_by_name(&key)?;
            set_node_output(ctx, node, "key", Value::String(key));
        }
        "shortcut" => {
            let key = get_string(node, "key", "S");
            let modifiers = get_string_array(node, "modifiers", vec!["Ctrl".to_string()]);
            keyboard::shortcut(&modifiers, &key)?;
            set_node_output(ctx, node, "key", Value::String(key));
        }
        _ => {
            return Err(CommandFlowError::Validation(format!(
                "node '{}' has unsupported keyboard operation '{}'",
                node.id, requested
            )));
        }
    }

    Ok(NextDirective::Default)
}

async fn execute_input_preset_replay(
    node: &WorkflowNode,
    ctx: &mut ExecutionContext,
    should_cancel: &impl Fn() -> bool,
) -> CommandResult<NextDirective> {
    let preset_id = get_string(node, "presetId", "").trim().to_string();
    if preset_id.is_empty() {
        return Err(CommandFlowError::Validation(format!(
            "node '{}' 尚未选择要回放的键鼠预设",
            node.id
        )));
    }

    let replay_mode_raw = get_string(node, "replayMode", "originalTiming");
    let replay_mode = normalize_system_operation_name(&replay_mode_raw);
    let delay_scale = get_f64(node, "delayScale", 1.0).clamp(0.0, 10.0);
    let min_delay_ms = get_u64(node, "minDelayMs", 8);
    let max_delay_ms = get_u64(node, "maxDelayMs", 250).max(min_delay_ms.max(1));

    let presets = load_input_recording_presets()
        .map_err(|error| CommandFlowError::Automation(format!("加载键鼠预设失败：{}", error)))?;
    let preset = presets
        .into_iter()
        .find(|item| item.id == preset_id)
        .ok_or_else(|| {
            CommandFlowError::Automation(format!(
                "未找到键鼠预设 '{}'，请确认该预设仍然存在。",
                preset_id
            ))
        })?;

    if preset.actions.is_empty() {
        return Err(CommandFlowError::Automation(format!(
            "键鼠预设 '{}' 暂无可回放的操作。",
            preset.name
        )));
    }

    let replay_result = replay_input_preset_actions(
        &preset,
        replay_mode.as_str(),
        delay_scale,
        min_delay_ms,
        max_delay_ms,
        should_cancel,
    )
    .await;

    let reset_result = keyboard::reset_state();
    replay_result?;
    reset_result?;

    set_node_output(ctx, node, "presetName", Value::String(preset.name.clone()));
    set_node_output(ctx, node, "operationCount", value_from_u64(preset.actions.len() as u64));

    Ok(NextDirective::Default)
}

async fn replay_input_preset_actions(
    preset: &InputRecordingPreset,
    replay_mode: &str,
    delay_scale: f64,
    min_delay_ms: u64,
    max_delay_ms: u64,
    should_cancel: &impl Fn() -> bool,
) -> CommandResult<()> {
    let mut previous_end_timestamp = None;

    for action in &preset.actions {
        let wait_ms = previous_end_timestamp
            .map(|prev_end| {
                compute_replay_delay_ms(
                    action_start_timestamp(action).saturating_sub(prev_end),
                    replay_mode,
                    delay_scale,
                    min_delay_ms,
                    max_delay_ms,
                )
            })
            .unwrap_or(0);

        if wait_ms > 0 {
            interruptible_sleep(Duration::from_millis(wait_ms), should_cancel).await?;
        }

        replay_input_action(action, replay_mode, delay_scale, min_delay_ms, max_delay_ms, should_cancel).await?;
        previous_end_timestamp = Some(action_end_timestamp(action));
    }

    Ok(())
}

fn action_start_timestamp(action: &InputRecordingAction) -> u64 {
    match action {
        InputRecordingAction::KeyDown { timestamp_ms, .. }
        | InputRecordingAction::KeyUp { timestamp_ms, .. }
        | InputRecordingAction::MouseDown { timestamp_ms, .. }
        | InputRecordingAction::MouseUp { timestamp_ms, .. }
        | InputRecordingAction::MouseWheel { timestamp_ms, .. }
        | InputRecordingAction::MouseMovePath { timestamp_ms, .. } => *timestamp_ms,
    }
}

fn action_end_timestamp(action: &InputRecordingAction) -> u64 {
    match action {
        InputRecordingAction::MouseMovePath {
            points,
            duration_ms,
            timestamp_ms,
            ..
        } => points
            .last()
            .map(|point| point.timestamp_ms)
            .unwrap_or_else(|| timestamp_ms.saturating_add(*duration_ms)),
        _ => action_start_timestamp(action),
    }
}

fn compute_replay_delay_ms(
    raw_delay_ms: u64,
    replay_mode: &str,
    delay_scale: f64,
    min_delay_ms: u64,
    max_delay_ms: u64,
) -> u64 {
    if raw_delay_ms == 0 {
        return 0;
    }

    let scaled = match replay_mode {
        "step" => min_delay_ms.max(1) as f64,
        "compressed" => raw_delay_ms.min(max_delay_ms.saturating_mul(3).max(1)) as f64 * delay_scale,
        _ => raw_delay_ms as f64 * delay_scale,
    };

    let clamped = scaled.round() as u64;
    clamped.clamp(min_delay_ms.min(max_delay_ms), max_delay_ms.max(min_delay_ms))
}

async fn replay_input_action(
    action: &InputRecordingAction,
    replay_mode: &str,
    delay_scale: f64,
    min_delay_ms: u64,
    max_delay_ms: u64,
    should_cancel: &impl Fn() -> bool,
) -> CommandResult<()> {
    match action {
        InputRecordingAction::KeyDown { key, .. } => keyboard::key_down_by_name(key)?,
        InputRecordingAction::KeyUp { key, .. } => keyboard::key_up_by_name(key)?,
        InputRecordingAction::MouseDown { button, x, y, .. } => mouse::button_down(*x, *y, button)?,
        InputRecordingAction::MouseUp { button, x, y, .. } => mouse::button_up(*x, *y, button)?,
        InputRecordingAction::MouseWheel { x, y, vertical, .. } => mouse::wheel_exact_at(*x, *y, *vertical)?,
        InputRecordingAction::MouseMovePath {
            points,
            duration_ms,
            ..
        } => {
            replay_mouse_move_path(
                points,
                *duration_ms,
                replay_mode,
                delay_scale,
                min_delay_ms,
                max_delay_ms,
                should_cancel,
            )
            .await?
        }
    }

    Ok(())
}

async fn replay_mouse_move_path(
    points: &[RecordedCursorPoint],
    duration_ms: u64,
    replay_mode: &str,
    delay_scale: f64,
    min_delay_ms: u64,
    max_delay_ms: u64,
    should_cancel: &impl Fn() -> bool,
) -> CommandResult<()> {
    let Some(first) = points.first() else {
        return Ok(());
    };

    mouse::move_to(first.x, first.y)?;
    if points.len() == 1 {
        return Ok(());
    }

    let total_span = points
        .last()
        .map(|point| point.timestamp_ms.saturating_sub(first.timestamp_ms))
        .unwrap_or(duration_ms);
    let segment_fallback = if points.len() > 1 {
        total_span / (points.len() as u64 - 1)
    } else {
        duration_ms
    };

    for pair in points.windows(2) {
        if should_cancel() {
            return Err(CommandFlowError::Canceled);
        }

        let current = &pair[0];
        let next = &pair[1];
        let raw_delay = next
            .timestamp_ms
            .saturating_sub(current.timestamp_ms)
            .max(segment_fallback.min(1));
        let wait_ms = if replay_mode == "step" {
            0
        } else {
            compute_replay_delay_ms(raw_delay, replay_mode, delay_scale, min_delay_ms, max_delay_ms)
        };

        if wait_ms > 0 {
            interruptible_sleep(Duration::from_millis(wait_ms), should_cancel).await?;
        }
        mouse::move_to(next.x, next.y)?;
    }

    Ok(())
}

#[cfg(target_os = "windows")]
#[derive(Debug, Clone, Copy)]
enum WindowsShellType {
    Cmd,
    PowerShell,
    Pwsh,
}

#[cfg(target_os = "windows")]
fn resolve_windows_shell_type(shell_type: &str) -> WindowsShellType {
    match normalize_system_operation_name(shell_type).as_str() {
        "powershell" => WindowsShellType::PowerShell,
        "pwsh" => WindowsShellType::Pwsh,
        _ => WindowsShellType::Cmd,
    }
}

#[cfg(target_os = "windows")]
fn build_windows_shell_command(shell_type: WindowsShellType, command: &str) -> Command {
    let process = match shell_type {
        WindowsShellType::Cmd => {
            let mut cmd = Command::new("cmd");
            cmd.arg("/C").arg(command);
            cmd
        }
        WindowsShellType::PowerShell => {
            let mut ps = Command::new("powershell");
            ps.arg("-NoProfile")
                .arg("-ExecutionPolicy")
                .arg("Bypass")
                .arg("-Command")
                .arg(command);
            ps
        }
        WindowsShellType::Pwsh => {
            let mut pwsh = Command::new("pwsh");
            pwsh.arg("-NoProfile")
                .arg("-Command")
                .arg(command);
            pwsh
        }
    };

    process
}

async fn run_system_command(command: &str, use_shell: bool, shell_type: &str) -> CommandResult<CommandExecutionResult> {
    let output = if use_shell {
        #[cfg(target_os = "windows")]
        {
            if should_spawn_terminal_window(command) {
                spawn_windows_terminal(command).await?;
                return Ok(CommandExecutionResult {
                    stdout: String::new(),
                    stderr: String::new(),
                    exit_code: 0,
                });
            }

            let shell_type = resolve_windows_shell_type(shell_type);
            build_windows_shell_command(shell_type, command)
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

    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    let exit_code = output.status.code().unwrap_or(-1);

    if output.status.success() {
        Ok(CommandExecutionResult {
            stdout,
            stderr,
            exit_code,
        })
    } else {
        Err(CommandFlowError::Automation(if stderr.is_empty() {
            format!("命令执行失败，退出码 {}", exit_code)
        } else {
            format!("命令执行失败，退出码 {}：{}", exit_code, stderr)
        }))
    }
}

fn read_clipboard_text(clipboard: &mut Clipboard, required: bool) -> CommandResult<Option<String>> {
    match clipboard.get_text() {
        Ok(text) => Ok(Some(text)),
        Err(_error) if !required => Ok(None),
        Err(error) => Err(CommandFlowError::Automation(format!("读取系统剪贴板文本失败：{}", error))),
    }
}

fn read_clipboard_text_required(clipboard: &mut Clipboard) -> CommandResult<String> {
    read_clipboard_text(clipboard, true)?.ok_or_else(|| {
        CommandFlowError::Automation("系统剪贴板当前不包含文本内容".to_string())
    })
}

fn read_clipboard_image(
    clipboard: &mut Clipboard,
    required: bool,
) -> CommandResult<Option<ClipboardImageContent>> {
    match clipboard.get_image() {
        Ok(image) => {
            let width = u32::try_from(image.width).map_err(|_| {
                CommandFlowError::Automation("剪贴板图片宽度超出支持范围".to_string())
            })?;
            let height = u32::try_from(image.height).map_err(|_| {
                CommandFlowError::Automation("剪贴板图片高度超出支持范围".to_string())
            })?;
            let data_url = rgba_to_png_data_url(image.bytes.as_ref(), width, height)?;
            Ok(Some(ClipboardImageContent {
                data_url,
                width,
                height,
            }))
        }
        Err(_error) if !required => Ok(None),
        Err(error) => Err(CommandFlowError::Automation(format!("读取系统剪贴板图片失败：{}", error))),
    }
}

fn read_clipboard_image_required(clipboard: &mut Clipboard) -> CommandResult<ClipboardImageContent> {
    read_clipboard_image(clipboard, true)?.ok_or_else(|| {
        CommandFlowError::Automation("系统剪贴板当前不包含图片内容".to_string())
    })
}

fn rgba_to_png_data_url(rgba: &[u8], width: u32, height: u32) -> CommandResult<String> {
    let encoded = screenshot::encode_rgba_to_png_base64(rgba, width, height)?;
    Ok(format!("data:image/png;base64,{}", encoded))
}

fn resolve_clipboard_write_image(
    node: &WorkflowNode,
    variables: &HashMap<String, Value>,
) -> CommandResult<ClipboardWriteImage> {
    let image_source_raw = get_string(node, "imageSource", "literal");
    let image_source = normalize_system_operation_name(&image_source_raw);

    match image_source.as_str() {
        "literal" => {
            let raw = resolve_text_template(&get_string(node, "imageData", ""), variables);
            load_clipboard_image_from_string(&raw, false)
        }
        "var" => {
            let var_name = get_string(node, "imageVar", "").trim().to_string();
            if var_name.is_empty() {
                return Err(CommandFlowError::Validation(format!(
                    "node '{}' clipboard image variable is empty",
                    node.id
                )));
            }

            let value = variables.get(&var_name).ok_or_else(|| {
                CommandFlowError::Automation(format!("变量 '{}' 不存在，无法写入剪贴板图片", var_name))
            })?;
            load_clipboard_image_from_value(value)
        }
        "file" => {
            let path = resolve_text_template(&get_string(node, "imagePath", ""), variables);
            load_clipboard_image_from_file(&path)
        }
        _ => Err(CommandFlowError::Validation(format!(
            "node '{}' has unsupported clipboard image source '{}'",
            node.id, image_source_raw
        ))),
    }
}

fn load_clipboard_image_from_value(value: &Value) -> CommandResult<ClipboardWriteImage> {
    match value {
        Value::String(text) => load_clipboard_image_from_string(text, true),
        Value::Object(object) => {
            if let Some(image) = object.get("image") {
                return load_clipboard_image_from_value(image);
            }
            if let Some(path) = object.get("path").and_then(|item| item.as_str()) {
                if Path::new(path).exists() {
                    return load_clipboard_image_from_file(path);
                }
            }

            Err(CommandFlowError::Automation(
                "变量中的 JSON 对象不包含可识别的图片数据(image/path)".to_string(),
            ))
        }
        _ => Err(CommandFlowError::Automation(
            "图片变量内容不是字符串或结构化图片对象".to_string(),
        )),
    }
}

fn load_clipboard_image_from_string(
    raw: &str,
    allow_path_fallback: bool,
) -> CommandResult<ClipboardWriteImage> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err(CommandFlowError::Validation("剪贴板图片数据不能为空".to_string()));
    }

    if allow_path_fallback && Path::new(trimmed).exists() {
        return load_clipboard_image_from_file(trimmed);
    }

    let bytes = decode_base64_image_payload(trimmed)?;
    load_clipboard_image_from_memory(&bytes)
}

fn load_clipboard_image_from_file(path: &str) -> CommandResult<ClipboardWriteImage> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err(CommandFlowError::Validation("剪贴板图片文件路径不能为空".to_string()));
    }

    let image = image::open(trimmed).map_err(|error| {
        CommandFlowError::Automation(format!("读取剪贴板图片文件失败 '{}': {}", trimmed, error))
    })?;
    Ok(dynamic_image_to_clipboard_write_image(image))
}

fn load_clipboard_image_from_memory(bytes: &[u8]) -> CommandResult<ClipboardWriteImage> {
    let image = image::load_from_memory(bytes)
        .map_err(|error| CommandFlowError::Automation(format!("解析剪贴板图片数据失败：{}", error)))?;
    Ok(dynamic_image_to_clipboard_write_image(image))
}

fn dynamic_image_to_clipboard_write_image(image: image::DynamicImage) -> ClipboardWriteImage {
    let rgba = image.to_rgba8();
    let (width, height) = rgba.dimensions();
    ClipboardWriteImage {
        rgba: rgba.into_raw(),
        width: width as usize,
        height: height as usize,
    }
}

fn decode_base64_image_payload(raw: &str) -> CommandResult<Vec<u8>> {
    let payload = if raw.starts_with("data:") {
        raw.split_once(',')
            .map(|(_, data)| data)
            .ok_or_else(|| CommandFlowError::Validation("图片 Data URL 缺少 base64 数据段".to_string()))?
    } else {
        raw
    };

    general_purpose::STANDARD
        .decode(payload.trim())
        .map_err(|error| CommandFlowError::Automation(format!("解析图片 base64 失败：{}", error)))
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

fn parse_json_extract_source(node: &WorkflowNode) -> CommandResult<Value> {
    let raw = node.params.get("sourceJson").cloned().unwrap_or(Value::Null);

    match raw {
        Value::String(text) => {
            let trimmed = text.trim();
            if trimmed.is_empty() {
                return Ok(Value::Null);
            }

            serde_json::from_str::<Value>(trimmed).map_err(|error| {
                CommandFlowError::Validation(format!(
                    "node '{}' sourceJson 解析失败：{}",
                    node.id, error
                ))
            })
        }
        other => Ok(other),
    }
}

fn normalize_json_path_segments(path: &str) -> Vec<String> {
    let mut normalized = String::with_capacity(path.len());
    let mut chars = path.chars().peekable();

    while let Some(ch) = chars.next() {
        if ch == '[' {
            normalized.push('.');
            while let Some(inner) = chars.peek() {
                if *inner == ']' {
                    chars.next();
                    break;
                }
                normalized.push(*inner);
                chars.next();
            }
            continue;
        }

        normalized.push(ch);
    }

    normalized
        .split('.')
        .map(str::trim)
        .filter(|segment| !segment.is_empty())
        .map(ToString::to_string)
        .collect()
}

fn extract_json_value_by_path(source: &Value, path: &str) -> Option<Value> {
    let segments = normalize_json_path_segments(path);
    if segments.is_empty() {
        return Some(source.clone());
    }

    let mut current = source;
    for segment in segments {
        match current {
            Value::Object(map) => {
                current = map.get(&segment)?;
            }
            Value::Array(array) => {
                let idx = segment.parse::<usize>().ok()?;
                current = array.get(idx)?;
            }
            _ => {
                return None;
            }
        }
    }

    Some(current.clone())
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

fn prepare_ocr_match_debug_dir(node: &WorkflowNode) -> CommandResult<PathBuf> {
    let mut base = std::env::temp_dir();
    base.push("commandflow-ocr-match-debug");

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

fn save_ocr_static_debug_artifacts(
    debug_dir: &Path,
    source_path: &str,
    evaluation: &ocr_match::OcrMatchEvaluation,
    target_text: &str,
    match_mode: &str,
    case_sensitive: bool,
    use_regex: bool,
    min_confidence: f32,
    node: &WorkflowNode,
) -> CommandResult<()> {
    let source = Path::new(source_path);
    let extension = source
        .extension()
        .and_then(|value| value.to_str())
        .filter(|value| !value.trim().is_empty())
        .map(|value| format!(".{}", value))
        .unwrap_or_else(|| ".png".to_string());
    let input_path = debug_dir.join(format!("static-input{}", extension));

    fs::copy(source, &input_path)
        .map_err(|error| CommandFlowError::Io(format!("复制 OCR 静态源图到 debug 目录失败: {}", error)))?;

    if let Ok(decoded) = image::open(source_path) {
        let rgba = decoded.to_rgba8();
        let (width, height) = rgba.dimensions();
        let overlay = render_ocr_debug_overlay(rgba.into_raw(), width, height, evaluation)?;
        let overlay_path = debug_dir.join("static-overlay.png");
        overlay
            .save(&overlay_path)
            .map_err(|error| CommandFlowError::Automation(format!("保存 OCR 静态标注图失败: {}", error)))?;
    }

    let metadata_path = debug_dir.join("static-metadata.json");
    write_ocr_debug_metadata(
        &metadata_path,
        evaluation,
        target_text,
        match_mode,
        case_sensitive,
        use_regex,
        min_confidence,
        node,
    )
}

fn save_ocr_frame_debug_artifacts(
    debug_dir: &Path,
    frame: u64,
    rgba: &[u8],
    width: u32,
    height: u32,
    evaluation: &ocr_match::OcrMatchEvaluation,
    target_text: &str,
    match_mode: &str,
    case_sensitive: bool,
    use_regex: bool,
    min_confidence: f32,
    node: &WorkflowNode,
) -> CommandResult<()> {
    let input_path = debug_dir.join(format!("frame-{:04}-input.png", frame));
    screenshot::save_rgba_image(path_to_string(&input_path)?, rgba.to_vec(), width, height)?;

    let overlay = render_ocr_debug_overlay(rgba.to_vec(), width, height, evaluation)?;
    let overlay_path = debug_dir.join(format!("frame-{:04}-overlay.png", frame));
    overlay
        .save(&overlay_path)
        .map_err(|error| CommandFlowError::Automation(format!("保存 OCR 帧标注图失败: {}", error)))?;

    let metadata_path = debug_dir.join(format!("frame-{:04}-metadata.json", frame));
    write_ocr_debug_metadata(
        &metadata_path,
        evaluation,
        target_text,
        match_mode,
        case_sensitive,
        use_regex,
        min_confidence,
        node,
    )
}

fn render_ocr_debug_overlay(
    rgba: Vec<u8>,
    width: u32,
    height: u32,
    evaluation: &ocr_match::OcrMatchEvaluation,
) -> CommandResult<RgbaImage> {
    let mut image = ImageBuffer::<Rgba<u8>, Vec<u8>>::from_vec(width, height, rgba)
        .ok_or_else(|| CommandFlowError::Automation("failed to build OCR debug overlay image".to_string()))?;

    draw_border(&mut image, Rgba([64, 180, 255, 255]));

    for entry in &evaluation.debug_entries {
        let stroke = if entry.is_text_match && entry.is_confidence_passed {
            Rgba([64, 255, 96, 255])
        } else if entry.is_text_match {
            Rgba([255, 200, 0, 255])
        } else {
            Rgba([255, 80, 80, 220])
        };

        if let Some(quad) = entry.quad {
            let points = [
                (quad[0][0].round() as i32, quad[0][1].round() as i32),
                (quad[1][0].round() as i32, quad[1][1].round() as i32),
                (quad[2][0].round() as i32, quad[2][1].round() as i32),
                (quad[3][0].round() as i32, quad[3][1].round() as i32),
            ];
            for i in 0..4 {
                let start = points[i];
                let end = points[(i + 1) % 4];
                draw_line(&mut image, start.0, start.1, end.0, end.1, stroke);
            }
        }

        if entry.center_x >= 0 && entry.center_y >= 0 {
            draw_crosshair(&mut image, entry.center_x, entry.center_y, 8, stroke);
        }
    }

    if let Some(matched) = evaluation.matched.as_ref() {
        if matched.x >= 0 && matched.y >= 0 {
            draw_circle_outline(&mut image, matched.x, matched.y, 16, Rgba([255, 255, 0, 255]));
            draw_crosshair(&mut image, matched.x, matched.y, 18, Rgba([255, 255, 0, 255]));
        }
    }

    Ok(image)
}

fn write_ocr_debug_metadata(
    output_path: &Path,
    evaluation: &ocr_match::OcrMatchEvaluation,
    target_text: &str,
    match_mode: &str,
    case_sensitive: bool,
    use_regex: bool,
    min_confidence: f32,
    node: &WorkflowNode,
) -> CommandResult<()> {
    let entries = evaluation
        .debug_entries
        .iter()
        .enumerate()
        .map(|(index, entry)| {
            let quad = entry.quad.map(|points| {
                points
                    .iter()
                    .map(|point| {
                        serde_json::json!({
                            "x": point[0],
                            "y": point[1],
                        })
                    })
                    .collect::<Vec<_>>()
            });

            serde_json::json!({
                "index": index,
                "text": &entry.text,
                "confidence": entry.confidence,
                "center": {
                    "x": entry.center_x,
                    "y": entry.center_y,
                },
                "quad": quad,
                "isTextMatch": entry.is_text_match,
                "isConfidencePassed": entry.is_confidence_passed,
            })
        })
        .collect::<Vec<_>>();

    let matched = evaluation.matched.as_ref().map(|item| {
        serde_json::json!({
            "x": item.x,
            "y": item.y,
            "text": &item.text,
            "confidence": item.confidence,
        })
    });

    let payload = serde_json::json!({
        "node": {
            "id": &node.id,
            "label": &node.label,
            "kind": "ocrMatch",
        },
        "query": {
            "targetText": target_text,
            "matchMode": match_mode,
            "caseSensitive": case_sensitive,
            "useRegex": use_regex,
            "minConfidence": min_confidence,
        },
        "summary": {
            "peakText": &evaluation.peak_text,
            "peakConfidence": evaluation.peak_confidence,
            "entryCount": entries.len(),
            "matched": matched,
        },
        "entries": entries,
    });

    let text = serde_json::to_string_pretty(&payload)
        .map_err(|error| CommandFlowError::Automation(format!("序列化 OCR debug metadata 失败: {}", error)))?;
    fs::write(output_path, text)
        .map_err(|error| CommandFlowError::Io(format!("写入 OCR debug metadata 失败: {}", error)))
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

#[derive(Debug, Clone)]
struct GuiAgentHistoryTurn {
    image_data_url: String,
    assistant_output: String,
}

async fn execute_gui_agent_action(
    node: &WorkflowNode,
    should_cancel: &impl Fn() -> bool,
    on_log: &mut impl FnMut(&str, String),
) -> CommandResult<Value> {
    if should_cancel() {
        return Err(CommandFlowError::Canceled);
    }

    let base_url = get_string(node, "baseUrl", "https://api.openai.com");
    let api_key = get_string(node, "apiKey", "");
    let model = get_string(node, "model", "gpt-5");
    let instruction = get_string(node, "instruction", "");
    let continuous_mode = get_bool(node, "continuousMode", true);
    let max_steps = get_u64(node, "maxSteps", GUI_AGENT_DEFAULT_MAX_STEPS).max(1);
    let history_screenshots = GUI_AGENT_MAX_SCREENSHOTS;
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

    if !continuous_mode && image_input.trim().is_empty() {
        return Err(CommandFlowError::Validation(format!(
            "node '{}' GUI Agent imageInput cannot be empty",
            node.id
        )));
    }

    let system_prompt = render_gui_agent_initial_prompt(&system_prompt_template, &instruction);
    let endpoint = resolve_chat_endpoint(&base_url);

    let client = reqwest::Client::new();
    let debug_dir = if continuous_mode {
        Some(prepare_gui_agent_debug_dir(node)?)
    } else {
        None
    };
    let mut history = VecDeque::<GuiAgentHistoryTurn>::new();
    let mut last_metadata = serde_json::json!({});
    let max_parse_attempts = if continuous_mode {
        GUI_AGENT_ACTION_PARSE_RETRIES + 1
    } else {
        1
    };

    for step in 1..=max_steps {
        if should_cancel() {
            return Err(CommandFlowError::Canceled);
        }

        let (_cleaned_base64, image_width, image_height, data_url, debug_rgba) = if continuous_mode {
            let (rgba, width, height) = screenshot::capture_fullscreen_rgba()?;
            let base64 = screenshot::encode_rgba_to_png_base64(&rgba, width, height)?;
            let data_url = format!("data:image/png;base64,{}", base64);
            (base64, width, height, data_url, Some(rgba))
        } else {
            let base64 = normalize_base64_input(&image_input);
            let (width, height) = decode_base64_image_dimensions(&base64, &image_format)?;
            let data_url = format!("data:image/{};base64,{}", image_format, base64);
            (base64, width, height, data_url, None)
        };

        if let (true, Some(dir), Some(rgba)) = (continuous_mode, debug_dir.as_ref(), debug_rgba.as_ref()) {
            let input_path = dir.join(format!("step-{:03}-input.png", step));
            let _ = screenshot::save_rgba_image(path_to_string(&input_path)?, rgba.clone(), image_width, image_height);
        }

        while history.len() > history_screenshots.saturating_sub(1) {
            history.pop_front();
        }

        let (action, thought, action_expr, normalized_content) = {
            let mut parsed_result: Option<(GuiAgentAction, String, String, String)> = None;
            let mut last_parse_error: Option<CommandFlowError> = None;

            for parse_attempt in 1..=max_parse_attempts {
                if should_cancel() {
                    return Err(CommandFlowError::Canceled);
                }

                let messages = build_gui_agent_messages(&system_prompt, &history, &data_url);
                let payload = serde_json::json!({
                    "model": model,
                    "temperature": 0,
                    "top_p": 0.7,
                    "max_tokens": max_tokens,
                    "messages": messages,
                });

                let response = client
                    .post(&endpoint)
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
                let thought = extract_thought_expression(&normalized_content).unwrap_or_default();

                let action_expr = match extract_action_expression(&normalized_content) {
                    Ok(expr) => expr,
                    Err(error) => {
                        on_log(
                            "warn",
                            format!(
                                "GUI Agent 节点 '{}' 输出（解析失败回显）：{}",
                                node.label,
                                truncate_for_log(&normalized_content, 4000)
                            ),
                        );

                        if continuous_mode && parse_attempt < max_parse_attempts {
                            on_log(
                                "warn",
                                format!(
                                    "GUI Agent 节点 '{}' 第 {} 轮 Action 提取失败（尝试 {}/{}），将自动重试。",
                                    node.label, step, parse_attempt, max_parse_attempts
                                ),
                            );
                            last_parse_error = Some(error);
                            continue;
                        }

                        return Err(error);
                    }
                };

                let action = match parse_gui_agent_action(&action_expr) {
                    Ok(action) => action,
                    Err(error) => {
                        on_log(
                            "warn",
                            format!(
                                "GUI Agent 节点 '{}' 输出（解析失败回显）：{}",
                                node.label,
                                truncate_for_log(&normalized_content, 4000)
                            ),
                        );

                        if continuous_mode && parse_attempt < max_parse_attempts {
                            on_log(
                                "warn",
                                format!(
                                    "GUI Agent 节点 '{}' 第 {} 轮 Action 语法解析失败（尝试 {}/{}），将自动重试。",
                                    node.label, step, parse_attempt, max_parse_attempts
                                ),
                            );
                            last_parse_error = Some(error);
                            continue;
                        }

                        return Err(error);
                    }
                };

                parsed_result = Some((action, thought, action_expr, normalized_content));
                break;
            }

            if let Some(result) = parsed_result {
                result
            } else {
                return Err(last_parse_error.unwrap_or_else(|| {
                    CommandFlowError::Automation("GUI Agent Action 解析失败（未知错误）".to_string())
                }));
            }
        };

        on_log(
            "info",
            format!(
                "GUI Agent 节点 '{}' 第 {} 轮输出：Thought={} | Action={}（图像尺寸={}x{}）",
                node.label,
                step,
                truncate_for_log(&thought, 500),
                action_expr,
                image_width,
                image_height
            ),
        );
        on_log(
            "info",
            format!(
                "GUI Agent 节点 '{}' 第 {} 轮 思考内容：{}",
                node.label,
                step,
                if thought.trim().is_empty() {
                    "（空）".to_string()
                } else {
                    truncate_for_log(&thought, 2000)
                }
            ),
        );

        let mut metadata = apply_gui_agent_action(
            action.clone(),
            image_width,
            image_height,
            should_cancel,
            on_log,
        )
        .await?;

        if let Some(object) = metadata.as_object_mut() {
            object.insert("thought".to_string(), Value::String(thought.clone()));
            object.insert("actionExpression".to_string(), Value::String(action_expr.clone()));
            object.insert("round".to_string(), value_from_u64(step));
        }

        if let (true, Some(dir), Some(rgba)) = (continuous_mode, debug_dir.as_ref(), debug_rgba.as_ref()) {
            save_gui_agent_debug_overlay(dir, step, rgba, image_width, image_height, &action)?;
            let response_path = dir.join(format!("step-{:03}-response.txt", step));
            fs::write(&response_path, normalized_content.as_bytes())
                .map_err(|error| CommandFlowError::Io(format!("写入 GUI Agent debug 响应失败: {}", error)))?;

            let metadata_path = dir.join(format!("step-{:03}-metadata.json", step));
            let metadata_text = serde_json::to_string_pretty(&metadata)
                .map_err(|error| CommandFlowError::Automation(format!("序列化 GUI Agent metadata 失败: {}", error)))?;
            fs::write(&metadata_path, metadata_text.as_bytes())
                .map_err(|error| CommandFlowError::Io(format!("写入 GUI Agent debug metadata 失败: {}", error)))?;
        }

        if continuous_mode {
            history.push_back(GuiAgentHistoryTurn {
                image_data_url: data_url,
                assistant_output: normalized_content,
            });
            while history.len() > history_screenshots.saturating_sub(1) {
                history.pop_front();
            }
        }

        let is_finished = matches!(action, GuiAgentAction::Finished { .. });
        last_metadata = metadata;

        if !continuous_mode || is_finished {
            return Ok(last_metadata);
        }
    }

    on_log(
        "warn",
        format!(
            "GUI Agent 节点 '{}' 达到最大连续步数 {}，已自动停止。",
            node.label, max_steps
        ),
    );

    if let Some(object) = last_metadata.as_object_mut() {
        object.insert(
            "autoStopReason".to_string(),
            Value::String("maxStepsReached".to_string()),
        );
    }

    Ok(last_metadata)
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

fn render_gui_agent_initial_prompt(template: &str, instruction: &str) -> String {
    let rendered = template
        .replace("{instruction}", instruction)
        .replace("{language}", "Chinese");
    if instruction.trim().is_empty() || template.contains("{instruction}") {
        return rendered;
    }

    format!("{}\n\nTask:\n{}", rendered, instruction)
}

fn build_gui_agent_messages(
    initial_prompt: &str,
    history: &VecDeque<GuiAgentHistoryTurn>,
    current_image_data_url: &str,
) -> Value {
    let mut messages = vec![serde_json::json!({
        "role": "user",
        "content": initial_prompt,
    })];

    for turn in history {
        messages.push(serde_json::json!({
            "role": "user",
            "content": [{
                "type": "image_url",
                "image_url": { "url": &turn.image_data_url }
            }]
        }));
        messages.push(serde_json::json!({
            "role": "assistant",
            "content": &turn.assistant_output,
        }));
    }

    messages.push(serde_json::json!({
        "role": "user",
        "content": [{
            "type": "image_url",
            "image_url": { "url": current_image_data_url }
        }]
    }));

    Value::Array(messages)
}

fn extract_thought_expression(content: &str) -> Option<String> {
    static THOUGHT_RE: OnceLock<Regex> = OnceLock::new();
    let regex = THOUGHT_RE.get_or_init(|| {
        Regex::new(r"(?is)Thought:\s*(.*?)\s*Action:").expect("valid thought regex")
    });

    regex
        .captures(content)
        .and_then(|caps| caps.get(1))
        .map(|m| m.as_str().trim().trim_matches('`').trim().to_string())
        .filter(|text| !text.is_empty())
}

fn prepare_gui_agent_debug_dir(node: &WorkflowNode) -> CommandResult<PathBuf> {
    let mut base = std::env::temp_dir();
    base.push("commandflow-gui-agent-debug");

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

fn save_gui_agent_debug_overlay(
    debug_dir: &Path,
    step: u64,
    rgba: &[u8],
    image_width: u32,
    image_height: u32,
    action: &GuiAgentAction,
) -> CommandResult<()> {
    let mut image = ImageBuffer::<Rgba<u8>, Vec<u8>>::from_vec(image_width, image_height, rgba.to_vec())
        .ok_or_else(|| CommandFlowError::Automation("failed to build GUI Agent debug overlay image".to_string()))?;

    let accent = Rgba([255, 128, 0, 255]);
    draw_border(&mut image, accent);

    match action {
        GuiAgentAction::Click { point }
        | GuiAgentAction::LeftDouble { point }
        | GuiAgentAction::RightSingle { point }
        | GuiAgentAction::Scroll { point, .. } => {
            let abs = relative_to_absolute(*point, image_width, image_height);
            draw_circle_outline(&mut image, abs.0, abs.1, 16, Rgba([255, 64, 64, 255]));
            draw_crosshair(&mut image, abs.0, abs.1, 20, Rgba([255, 255, 0, 255]));
        }
        GuiAgentAction::Drag { start, end } => {
            let abs_start = relative_to_absolute(*start, image_width, image_height);
            let abs_end = relative_to_absolute(*end, image_width, image_height);
            draw_circle_outline(&mut image, abs_start.0, abs_start.1, 12, Rgba([80, 255, 120, 255]));
            draw_circle_outline(&mut image, abs_end.0, abs_end.1, 12, Rgba([255, 80, 80, 255]));
            draw_line(&mut image, abs_start.0, abs_start.1, abs_end.0, abs_end.1, Rgba([255, 230, 0, 255]));
            draw_arrow_head(&mut image, abs_start.0, abs_start.1, abs_end.0, abs_end.1, Rgba([255, 230, 0, 255]));
        }
        GuiAgentAction::Hotkey { .. } => {
            draw_border(&mut image, Rgba([90, 180, 255, 255]));
        }
        GuiAgentAction::Type { .. } => {
            draw_border(&mut image, Rgba([200, 120, 255, 255]));
        }
        GuiAgentAction::Wait => {
            draw_border(&mut image, Rgba([120, 220, 255, 255]));
        }
        GuiAgentAction::Finished { .. } => {
            draw_border(&mut image, Rgba([90, 255, 90, 255]));
        }
    }

    let output_path = debug_dir.join(format!("step-{:03}-overlay.png", step));
    image
        .save(&output_path)
        .map_err(|error| CommandFlowError::Automation(format!("保存 GUI Agent debug 标注图失败: {}", error)))?;

    Ok(())
}

fn set_pixel_safe(image: &mut RgbaImage, x: i32, y: i32, color: Rgba<u8>) {
    if x < 0 || y < 0 {
        return;
    }
    let (x_u, y_u) = (x as u32, y as u32);
    if x_u >= image.width() || y_u >= image.height() {
        return;
    }
    image.put_pixel(x_u, y_u, color);
}

fn draw_circle_outline(image: &mut RgbaImage, cx: i32, cy: i32, radius: i32, color: Rgba<u8>) {
    if radius <= 0 {
        return;
    }

    let mut x = radius;
    let mut y = 0;
    let mut decision = 1 - x;

    while y <= x {
        for (dx, dy) in [
            (x, y),
            (y, x),
            (-y, x),
            (-x, y),
            (-x, -y),
            (-y, -x),
            (y, -x),
            (x, -y),
        ] {
            set_pixel_safe(image, cx + dx, cy + dy, color);
        }

        y += 1;
        if decision <= 0 {
            decision += 2 * y + 1;
        } else {
            x -= 1;
            decision += 2 * (y - x) + 1;
        }
    }
}

fn draw_line(image: &mut RgbaImage, x0: i32, y0: i32, x1: i32, y1: i32, color: Rgba<u8>) {
    let dx = (x1 - x0).abs();
    let sx = if x0 < x1 { 1 } else { -1 };
    let dy = -(y1 - y0).abs();
    let sy = if y0 < y1 { 1 } else { -1 };
    let mut err = dx + dy;

    let mut x = x0;
    let mut y = y0;
    loop {
        set_pixel_safe(image, x, y, color);
        if x == x1 && y == y1 {
            break;
        }
        let e2 = 2 * err;
        if e2 >= dy {
            err += dy;
            x += sx;
        }
        if e2 <= dx {
            err += dx;
            y += sy;
        }
    }
}

fn draw_arrow_head(image: &mut RgbaImage, x0: i32, y0: i32, x1: i32, y1: i32, color: Rgba<u8>) {
    let vx = (x1 - x0) as f64;
    let vy = (y1 - y0) as f64;
    let length = (vx * vx + vy * vy).sqrt();
    if length < 1.0 {
        return;
    }

    let ux = vx / length;
    let uy = vy / length;
    let arrow_len = 12.0;
    let angle = std::f64::consts::PI / 6.0;

    let left_x = x1 as f64 - arrow_len * (ux * angle.cos() + uy * angle.sin());
    let left_y = y1 as f64 - arrow_len * (uy * angle.cos() - ux * angle.sin());
    let right_x = x1 as f64 - arrow_len * (ux * angle.cos() - uy * angle.sin());
    let right_y = y1 as f64 - arrow_len * (uy * angle.cos() + ux * angle.sin());

    draw_line(image, x1, y1, left_x.round() as i32, left_y.round() as i32, color);
    draw_line(image, x1, y1, right_x.round() as i32, right_y.round() as i32, color);
}

fn draw_crosshair(image: &mut RgbaImage, x: i32, y: i32, radius: i32, color: Rgba<u8>) {
    draw_line(image, x - radius, y, x + radius, y, color);
    draw_line(image, x, y - radius, x, y + radius, color);
}

fn draw_border(image: &mut RgbaImage, color: Rgba<u8>) {
    if image.width() == 0 || image.height() == 0 {
        return;
    }
    let max_x = image.width() as i32 - 1;
    let max_y = image.height() as i32 - 1;
    draw_line(image, 0, 0, max_x, 0, color);
    draw_line(image, 0, max_y, max_x, max_y, color);
    draw_line(image, 0, 0, 0, max_y, color);
    draw_line(image, max_x, 0, max_x, max_y, color);
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

fn truncate_for_log(content: &str, max_chars: usize) -> String {
    if max_chars == 0 {
        return "...(truncated)".to_string();
    }

    let total = content.chars().count();
    if total <= max_chars {
        return content.to_string();
    }

    let head = content.chars().take(max_chars).collect::<String>();
    format!("{}...(truncated, total_chars={})", head, total)
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
    let Some(call) = parse_named_action_call(expression)? else {
        return Err(CommandFlowError::Automation(format!(
            "GUI Agent 返回了不支持的动作: {}",
            expression
        )));
    };

    match call.name.as_str() {
        "click" => {
            let point = parse_required_point_arg(&call.args, "point", "GUI Agent click")?;
            Ok(GuiAgentAction::Click { point })
        }
        "left_double" => {
            let point = parse_required_point_arg(&call.args, "point", "GUI Agent left_double")?;
            Ok(GuiAgentAction::LeftDouble { point })
        }
        "right_single" => {
            let point = parse_required_point_arg(&call.args, "point", "GUI Agent right_single")?;
            Ok(GuiAgentAction::RightSingle { point })
        }
        "drag" => {
            let start = parse_required_point_arg(&call.args, "start_point", "GUI Agent drag")?;
            let end = parse_required_point_arg(&call.args, "end_point", "GUI Agent drag")?;
            Ok(GuiAgentAction::Drag { start, end })
        }
        "hotkey" => {
            let key = parse_required_string_arg(&call.args, "key", "GUI Agent hotkey")?;
            Ok(GuiAgentAction::Hotkey { key })
        }
        "type" => {
            let content = parse_required_string_arg(&call.args, "content", "GUI Agent type")?;
            Ok(GuiAgentAction::Type {
                content: unescape_agent_string(&content),
            })
        }
        "scroll" => {
            let point = parse_required_point_arg(&call.args, "point", "GUI Agent scroll")?;
            let direction = parse_required_direction_arg(&call.args, "direction")?;
            Ok(GuiAgentAction::Scroll { point, direction })
        }
        "wait" => Ok(GuiAgentAction::Wait),
        "finished" => {
            let content = parse_required_string_arg(&call.args, "content", "GUI Agent finished")?;
            Ok(GuiAgentAction::Finished {
                content: unescape_agent_string(&content),
            })
        }
        _ => Err(CommandFlowError::Automation(format!(
            "GUI Agent 返回了不支持的动作: {}",
            expression
        ))),
    }
}

#[derive(Debug)]
struct ParsedNamedAction {
    name: String,
    args: HashMap<String, String>,
}

fn parse_named_action_call(expression: &str) -> CommandResult<Option<ParsedNamedAction>> {
    static CALL_RE: OnceLock<Regex> = OnceLock::new();
    let regex = CALL_RE.get_or_init(|| {
        Regex::new(r"(?is)^\s*([a-z_][a-z0-9_]*)\s*\((.*)\)\s*$")
            .expect("valid named action regex")
    });

    let Some(captures) = regex.captures(expression.trim()) else {
        return Ok(None);
    };

    let action_name = captures
        .get(1)
        .map(|m| m.as_str().to_lowercase())
        .ok_or_else(|| CommandFlowError::Automation("GUI Agent 动作名解析失败".to_string()))?;
    let args_raw = captures
        .get(2)
        .map(|m| m.as_str())
        .ok_or_else(|| CommandFlowError::Automation("GUI Agent 参数区解析失败".to_string()))?;

    let args = parse_named_args(args_raw)?;

    Ok(Some(ParsedNamedAction {
        name: action_name,
        args,
    }))
}

fn parse_named_args(raw: &str) -> CommandResult<HashMap<String, String>> {
    let mut args = HashMap::<String, String>::new();
    let chars: Vec<char> = raw.chars().collect();
    let mut index = 0usize;

    while index < chars.len() {
        while index < chars.len() && (chars[index].is_whitespace() || chars[index] == ',') {
            index += 1;
        }
        if index >= chars.len() {
            break;
        }

        if !(chars[index].is_ascii_alphabetic() || chars[index] == '_') {
            return Err(CommandFlowError::Automation(
                "GUI Agent 参数名格式非法".to_string(),
            ));
        }

        let key_start = index;
        index += 1;
        while index < chars.len() && (chars[index].is_ascii_alphanumeric() || chars[index] == '_') {
            index += 1;
        }
        let key = chars[key_start..index]
            .iter()
            .collect::<String>()
            .to_lowercase();

        while index < chars.len() && chars[index].is_whitespace() {
            index += 1;
        }
        if index >= chars.len() || chars[index] != '=' {
            return Err(CommandFlowError::Automation(format!(
                "GUI Agent 参数 '{}' 缺少 '='",
                key
            )));
        }
        index += 1;

        while index < chars.len() && chars[index].is_whitespace() {
            index += 1;
        }
        if index >= chars.len() {
            return Err(CommandFlowError::Automation(format!(
                "GUI Agent 参数 '{}' 缺少值",
                key
            )));
        }

        let quote = chars[index];
        if quote != '\'' && quote != '"' {
            return Err(CommandFlowError::Automation(format!(
                "GUI Agent 参数 '{}' 需要使用引号包裹",
                key
            )));
        }
        index += 1;

        let mut value = String::new();
        while index < chars.len() {
            let ch = chars[index];
            if ch == '\\' {
                if index + 1 >= chars.len() {
                    value.push(ch);
                    index += 1;
                    continue;
                }

                value.push(ch);
                value.push(chars[index + 1]);
                index += 2;
                continue;
            }

            if ch == quote {
                index += 1;
                break;
            }

            value.push(ch);
            index += 1;
        }

        args.insert(key, value);

        while index < chars.len() && chars[index].is_whitespace() {
            index += 1;
        }
        if index < chars.len() {
            if chars[index] != ',' {
                return Err(CommandFlowError::Automation(
                    "GUI Agent 参数分隔符非法（应为逗号）".to_string(),
                ));
            }
            index += 1;
        }
    }

    Ok(args)
}

fn parse_required_string_arg(
    args: &HashMap<String, String>,
    key: &str,
    action_name: &str,
) -> CommandResult<String> {
    args.get(key)
        .cloned()
        .ok_or_else(|| CommandFlowError::Automation(format!("{} 缺少参数 '{}'", action_name, key)))
}

fn parse_required_point_arg(
    args: &HashMap<String, String>,
    key: &str,
    action_name: &str,
) -> CommandResult<(f64, f64)> {
    let raw = parse_required_string_arg(args, key, action_name)?;

    static POINT_RE: OnceLock<Regex> = OnceLock::new();
    let regex = POINT_RE.get_or_init(|| {
        Regex::new(r"(?is)^\s*<point>\s*([+-]?\d+(?:\.\d+)?)\s+([+-]?\d+(?:\.\d+)?)\s*</point>\s*$")
            .expect("valid point regex")
    });

    let captures = regex
        .captures(raw.trim())
        .ok_or_else(|| CommandFlowError::Automation(format!("{} 参数 '{}' 点位格式非法", action_name, key)))?;

    let x = captures
        .get(1)
        .and_then(|m| m.as_str().parse::<f64>().ok())
        .ok_or_else(|| CommandFlowError::Automation(format!("{} 参数 '{}' X 解析失败", action_name, key)))?;
    let y = captures
        .get(2)
        .and_then(|m| m.as_str().parse::<f64>().ok())
        .ok_or_else(|| CommandFlowError::Automation(format!("{} 参数 '{}' Y 解析失败", action_name, key)))?;

    Ok((x, y))
}

fn parse_required_direction_arg(args: &HashMap<String, String>, key: &str) -> CommandResult<String> {
    let direction = parse_required_string_arg(args, key, "GUI Agent scroll")?.to_lowercase();
    match direction.as_str() {
        "down" | "up" | "right" | "left" => Ok(direction),
        _ => Err(CommandFlowError::Automation(format!(
            "GUI Agent scroll 参数 '{}' 非法: {}",
            key, direction
        ))),
    }
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
) -> CommandResult<Value> {
    let metadata = match action {
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
            serde_json::json!({
                "action": "click",
                "relative": { "x": point.0, "y": point.1 },
                "absolute": { "x": abs.0, "y": abs.1 },
                "image": { "width": image_width, "height": image_height }
            })
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
            serde_json::json!({
                "action": "left_double",
                "relative": { "x": point.0, "y": point.1 },
                "absolute": { "x": abs.0, "y": abs.1 },
                "image": { "width": image_width, "height": image_height }
            })
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
            serde_json::json!({
                "action": "right_single",
                "relative": { "x": point.0, "y": point.1 },
                "absolute": { "x": abs.0, "y": abs.1 },
                "image": { "width": image_width, "height": image_height }
            })
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
            serde_json::json!({
                "action": "drag",
                "relative": {
                    "start": { "x": start.0, "y": start.1 },
                    "end": { "x": end.0, "y": end.1 }
                },
                "absolute": {
                    "start": { "x": abs_start.0, "y": abs_start.1 },
                    "end": { "x": abs_end.0, "y": abs_end.1 }
                },
                "image": { "width": image_width, "height": image_height }
            })
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
            serde_json::json!({
                "action": "hotkey",
                "key": key,
                "image": { "width": image_width, "height": image_height }
            })
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
            serde_json::json!({
                "action": "type",
                "content": content,
                "image": { "width": image_width, "height": image_height }
            })
        }
        GuiAgentAction::Scroll { point, direction } => {
            let abs = relative_to_absolute(point, image_width, image_height);
            mouse::move_to(abs.0, abs.1)?;

            match direction.as_str() {
                "up" => mouse::wheel(-1)?,
                "down" => mouse::wheel(1)?,
                "right" => mouse::wheel_horizontal(1)?,
                "left" => mouse::wheel_horizontal(-1)?,
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
            serde_json::json!({
                "action": "scroll",
                "direction": direction,
                "relative": { "x": point.0, "y": point.1 },
                "absolute": { "x": abs.0, "y": abs.1 },
                "image": { "width": image_width, "height": image_height }
            })
        }
        GuiAgentAction::Wait => {
            interruptible_sleep(Duration::from_secs(5), should_cancel).await?;
            on_log(
                "info",
                "GUI Agent 执行 wait: 已等待 5s。".to_string(),
            );
            serde_json::json!({
                "action": "wait",
                "waitSeconds": 5,
                "image": { "width": image_width, "height": image_height }
            })
        }
        GuiAgentAction::Finished { content } => {
            on_log(
                "info",
                format!(
                    "GUI Agent 执行 finished: {}",
                    content
                ),
            );
            serde_json::json!({
                "action": "finished",
                "content": content,
                "image": { "width": image_width, "height": image_height }
            })
        }
    };

    Ok(metadata)
}

fn read_metadata_object(node: &WorkflowNode) -> CommandResult<serde_json::Map<String, Value>> {
    let raw = node.params.get("metadata").cloned().unwrap_or(Value::Null);

    if let Some(object) = raw.as_object() {
        return Ok(object.clone());
    }

    if let Some(text) = raw.as_str() {
        let parsed: Value = serde_json::from_str(text).map_err(|error| {
            CommandFlowError::Validation(format!(
                "node '{}' metadata 不是合法 JSON: {}",
                node.id, error
            ))
        })?;
        if let Some(object) = parsed.as_object() {
            return Ok(object.clone());
        }
    }

    Ok(serde_json::Map::new())
}

fn extract_xy(object: &serde_json::Map<String, Value>, key: &str) -> (Option<i32>, Option<i32>) {
    let point = object
        .get(key)
        .and_then(|value| value.as_object())
        .cloned()
        .unwrap_or_default();

    let x = point.get("x").and_then(|value| value.as_i64()).map(|value| value as i32);
    let y = point.get("y").and_then(|value| value.as_i64()).map(|value| value as i32);
    (x, y)
}

fn execute_gui_agent_action_parser(
    node: &WorkflowNode,
    ctx: &mut ExecutionContext,
    on_log: &mut impl FnMut(&str, String),
) -> CommandResult<()> {
    let operation = get_string(node, "operation", "click").to_lowercase();
    let metadata = read_metadata_object(node)?;
    let metadata_action = metadata
        .get("action")
        .and_then(|value| value.as_str())
        .unwrap_or("")
        .to_lowercase();

    if !metadata_action.is_empty() && metadata_action != operation {
        on_log(
            "warn",
            format!(
                "GUI Agent 元数据解析节点 '{}' 选择动作='{}'，但 metadata.action='{}'。",
                node.label, operation, metadata_action
            ),
        );
    }

    match operation.as_str() {
        "click" | "left_double" | "right_single" => {
            let absolute = metadata
                .get("absolute")
                .and_then(|value| value.as_object())
                .cloned()
                .unwrap_or_default();
            let x = absolute.get("x").and_then(|value| value.as_i64()).map(|value| value as i32);
            let y = absolute.get("y").and_then(|value| value.as_i64()).map(|value| value as i32);
            set_node_output(ctx, node, "x", value_from_i32(x.unwrap_or_default()));
            set_node_output(ctx, node, "y", value_from_i32(y.unwrap_or_default()));
        }
        "drag" => {
            let absolute = metadata
                .get("absolute")
                .and_then(|value| value.as_object())
                .cloned()
                .unwrap_or_default();
            let (start_x, start_y) = extract_xy(&absolute, "start");
            let (end_x, end_y) = extract_xy(&absolute, "end");
            set_node_output(ctx, node, "startX", value_from_i32(start_x.unwrap_or_default()));
            set_node_output(ctx, node, "startY", value_from_i32(start_y.unwrap_or_default()));
            set_node_output(ctx, node, "endX", value_from_i32(end_x.unwrap_or_default()));
            set_node_output(ctx, node, "endY", value_from_i32(end_y.unwrap_or_default()));
        }
        "hotkey" => {
            let key = metadata
                .get("key")
                .and_then(|value| value.as_str())
                .unwrap_or_default()
                .to_string();
            set_node_output(ctx, node, "key", Value::String(key));
        }
        "type" | "finished" => {
            let content = metadata
                .get("content")
                .and_then(|value| value.as_str())
                .unwrap_or_default()
                .to_string();
            set_node_output(ctx, node, "content", Value::String(content));
        }
        "scroll" => {
            let absolute = metadata
                .get("absolute")
                .and_then(|value| value.as_object())
                .cloned()
                .unwrap_or_default();
            let x = absolute.get("x").and_then(|value| value.as_i64()).map(|value| value as i32);
            let y = absolute.get("y").and_then(|value| value.as_i64()).map(|value| value as i32);
            let direction = metadata
                .get("direction")
                .and_then(|value| value.as_str())
                .unwrap_or_default()
                .to_string();
            set_node_output(ctx, node, "x", value_from_i32(x.unwrap_or_default()));
            set_node_output(ctx, node, "y", value_from_i32(y.unwrap_or_default()));
            set_node_output(ctx, node, "direction", Value::String(direction));
        }
        "wait" => {
            let seconds = metadata
                .get("waitSeconds")
                .and_then(|value| value.as_u64())
                .unwrap_or(5);
            set_node_output(ctx, node, "waitSeconds", value_from_u64(seconds));
        }
        _ => {
            return Err(CommandFlowError::Validation(format!(
                "node '{}' unsupported parser operation '{}'",
                node.id, operation
            )));
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
