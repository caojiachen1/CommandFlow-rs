use crate::automation::{keyboard, mouse, screenshot, window};
use crate::error::{CommandFlowError, CommandResult};
use crate::workflow::graph::WorkflowGraph;
use crate::workflow::node::{NodeKind, WorkflowNode};
use serde_json::{Number, Value};
use std::collections::{HashMap, HashSet};
use tokio::process::Command;
use tokio::time::{sleep, Duration};

#[derive(Debug, Default)]
pub struct WorkflowExecutor;

#[derive(Debug, Default)]
struct ExecutionContext {
    variables: HashMap<String, Value>,
    loop_remaining: HashMap<String, u64>,
}

enum NextDirective {
    Default,
    Branch(&'static str),
}

impl WorkflowExecutor {
    pub async fn execute(&self, graph: &WorkflowGraph) -> CommandResult<()> {
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

        let trigger_starts: Vec<&str> = graph
            .nodes
            .iter()
            .filter(|node| is_trigger(&node.kind))
            .map(|node| node.id.as_str())
            .collect();

        let starts: Vec<&str> = if !trigger_starts.is_empty() {
            trigger_starts
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
                self.execute_from_node(start, graph, &node_map, &mut ctx).await?;
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
    ) -> CommandResult<()> {
        let mut current_id = start_id.to_string();
        let mut guard_steps = 0usize;

        while guard_steps < 10_000 {
            guard_steps += 1;
            let node = node_map.get(current_id.as_str()).ok_or_else(|| {
                CommandFlowError::Validation(format!("node '{}' not found", current_id))
            })?;

            let directive = self.execute_single_node(node, ctx).await?;

            let outgoing = graph.edges.iter().filter(|edge| edge.source == current_id);
            let next = match directive {
                NextDirective::Default => outgoing.into_iter().next(),
                NextDirective::Branch(handle) => {
                    let mut chosen = None;
                    for edge in graph.edges.iter().filter(|edge| edge.source == current_id) {
                        if edge.source_handle.as_deref() == Some(handle) {
                            chosen = Some(edge);
                            break;
                        }
                        if chosen.is_none() {
                            chosen = Some(edge);
                        }
                    }
                    chosen
                }
            };

            match next {
                Some(edge) => current_id = edge.target.clone(),
                None => return Ok(()),
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
    ) -> CommandResult<NextDirective> {
        match node.kind {
            NodeKind::HotkeyTrigger => Ok(NextDirective::Default),
            NodeKind::TimerTrigger => {
                let interval_ms = get_u64(node, "intervalMs", 1000);
                sleep(Duration::from_millis(interval_ms)).await;
                Ok(NextDirective::Default)
            }
            NodeKind::ManualTrigger => Ok(NextDirective::Default),
            NodeKind::WindowTrigger => Ok(NextDirective::Default),
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
            NodeKind::Shortcut => {
                let key = get_string(node, "key", "S");
                let modifiers = get_string_array(node, "modifiers", vec!["Ctrl".to_string()]);
                keyboard::shortcut(&modifiers, &key)?;
                Ok(NextDirective::Default)
            }
            NodeKind::Screenshot => {
                let path = get_string(node, "path", "capture.png");
                let width = get_u32(node, "width", 320);
                let height = get_u32(node, "height", 240);
                screenshot::capture_region(&path, width.max(1), height.max(1))?;
                Ok(NextDirective::Default)
            }
            NodeKind::WindowActivate => {
                let title = get_string(node, "title", "");
                window::activate_window(&title)?;
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
            NodeKind::Delay => {
                let duration = get_u64(node, "ms", 100);
                sleep(Duration::from_millis(duration)).await;
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
            NodeKind::ErrorHandler => Ok(NextDirective::Default),
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

async fn run_system_command(command: &str, use_shell: bool) -> CommandResult<()> {
    let output = if use_shell {
        #[cfg(target_os = "windows")]
        {
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
        "==" => left == right,
        "!=" => left != right,
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
