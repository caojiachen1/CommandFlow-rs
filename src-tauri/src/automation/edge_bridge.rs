use crate::error::{CommandFlowError, CommandResult};
use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, OnceLock};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tokio::net::TcpListener;
use tokio::sync::{mpsc, oneshot, watch, Mutex};
use tokio::task::JoinHandle;
use tokio_tungstenite::tungstenite::handshake::server::{Request, Response};
use tokio_tungstenite::tungstenite::protocol::Message;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BridgeServerConfig {
    pub host: String,
    pub port: u16,
    pub token: String,
    pub command_timeout_ms: u64,
}

impl Default for BridgeServerConfig {
    fn default() -> Self {
        Self {
            host: "127.0.0.1".to_string(),
            port: 17324,
            token: "CHANGE_ME_TOKEN".to_string(),
            command_timeout_ms: 30_000,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutomationDslNode {
    pub id: String,
    #[serde(rename = "type")]
    pub node_type: String,
    #[serde(default)]
    pub payload: HashMap<String, Value>,
    #[serde(default)]
    pub timeout_ms: Option<u64>,
    #[serde(default)]
    pub retry_count: Option<u32>,
    #[serde(default)]
    pub retry_delay_ms: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutomationExecutionPlan {
    pub session_id: String,
    #[serde(default)]
    pub tab_id: Option<u32>,
    pub nodes: Vec<AutomationDslNode>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BridgeCommandResult {
    pub command_id: String,
    pub session_id: String,
    #[serde(default)]
    pub tab_id: Option<u32>,
    #[serde(default)]
    pub frame_id: Option<u32>,
    pub action: String,
    pub status: String,
    #[serde(default)]
    pub message: Option<String>,
    #[serde(default)]
    pub data: Option<HashMap<String, Value>>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NodeExecutionReport {
    pub node_id: String,
    pub node_type: String,
    pub status: String,
    pub attempts: u32,
    pub result: Option<BridgeCommandResult>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecutionPlanReport {
    pub session_id: String,
    pub success: bool,
    pub completed_nodes: usize,
    pub reports: Vec<NodeExecutionReport>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BridgeRuntimeStatus {
    pub running: bool,
    pub endpoint: String,
    pub extension_connected: bool,
    pub command_seq: u64,
}

#[derive(Debug)]
struct BridgeRuntime {
    config: BridgeServerConfig,
    extension_sender: Option<mpsc::UnboundedSender<Message>>,
    pending_waiters: HashMap<String, oneshot::Sender<BridgeCommandResult>>,
    command_seq: AtomicU64,
    running: bool,
    shutdown: Option<watch::Sender<bool>>,
    server_task: Option<JoinHandle<()>>,
}

impl Default for BridgeRuntime {
    fn default() -> Self {
        Self {
            config: BridgeServerConfig::default(),
            extension_sender: None,
            pending_waiters: HashMap::new(),
            command_seq: AtomicU64::new(1),
            running: false,
            shutdown: None,
            server_task: None,
        }
    }
}

fn runtime() -> &'static Arc<Mutex<BridgeRuntime>> {
    static RUNTIME: OnceLock<Arc<Mutex<BridgeRuntime>>> = OnceLock::new();
    RUNTIME.get_or_init(|| Arc::new(Mutex::new(BridgeRuntime::default())))
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn next_command_id(state: &BridgeRuntime) -> String {
    let seq = state.command_seq.fetch_add(1, Ordering::Relaxed);
    format!("edge-cmd-{}-{}", now_ms(), seq)
}

fn parse_query_token(request: &Request) -> Option<String> {
    let query = request.uri().query()?;
    query.split('&').find_map(|pair| {
        let mut split = pair.splitn(2, '=');
        let key = split.next()?.trim();
        let value = split.next()?.trim();
        if key.eq_ignore_ascii_case("token") {
            Some(value.to_string())
        } else {
            None
        }
    })
}

async fn server_loop(shared: Arc<Mutex<BridgeRuntime>>, shutdown_rx: watch::Receiver<bool>) {
    let listener = {
        let state = shared.lock().await;
        let addr = format!("{}:{}", state.config.host, state.config.port);
        match TcpListener::bind(&addr).await {
            Ok(listener) => listener,
            Err(error) => {
                eprintln!("[edge-bridge] failed to bind {}: {}", addr, error);
                return;
            }
        }
    };

    loop {
        if *shutdown_rx.borrow() {
            break;
        }

        let accepted = tokio::time::timeout(Duration::from_millis(500), listener.accept()).await;
        let Ok(Ok((stream, _addr))) = accepted else {
            continue;
        };

        let expected_token = {
            let state = shared.lock().await;
            state.config.token.clone()
        };

        let callback = move |req: &Request, response: Response| {
            let ok = parse_query_token(req)
                .map(|incoming| incoming == expected_token)
                .unwrap_or(false);

            if !ok {
                return Err(tokio_tungstenite::tungstenite::handshake::server::ErrorResponse::new(
                    Some("Invalid token".to_string()),
                ));
            }

            Ok(response)
        };

        let ws = match tokio_tungstenite::accept_hdr_async(stream, callback).await {
            Ok(ws) => ws,
            Err(error) => {
                eprintln!("[edge-bridge] websocket handshake failed: {}", error);
                continue;
            }
        };

        let (mut sink, mut stream) = ws.split();
        let (tx, mut rx) = mpsc::unbounded_channel::<Message>();

        {
            let mut state = shared.lock().await;
            state.extension_sender = Some(tx.clone());
        }

        let writer = tokio::spawn(async move {
            while let Some(msg) = rx.recv().await {
                if sink.send(msg).await.is_err() {
                    break;
                }
            }
        });

        while let Some(message) = stream.next().await {
            let Ok(message) = message else {
                break;
            };

            if !message.is_text() {
                continue;
            }

            let payload = match message.to_text() {
                Ok(text) => text,
                Err(_) => continue,
            };

            let parsed = serde_json::from_str::<Value>(payload);
            let Ok(envelope) = parsed else {
                continue;
            };

            let kind = envelope
                .get("kind")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string();

            if kind == "PING" {
                let pong = json!({
                    "kind": "PONG",
                    "timestamp": now_ms(),
                    "data": {"at": now_ms()}
                });
                let _ = tx.send(Message::Text(pong.to_string()));
                continue;
            }

            if kind == "COMMAND_RESULT" {
                let data = envelope.get("data").cloned().unwrap_or(Value::Null);
                if let Ok(result) = serde_json::from_value::<BridgeCommandResult>(data) {
                    let mut state = shared.lock().await;
                    if let Some(waiter) = state.pending_waiters.remove(&result.command_id) {
                        let _ = waiter.send(result);
                    }
                }
            }
        }

        {
            let mut state = shared.lock().await;
            state.extension_sender = None;
        }

        let _ = writer.await;
    }
}

pub async fn start_server(config: Option<BridgeServerConfig>) -> CommandResult<BridgeRuntimeStatus> {
    let shared = runtime().clone();

    {
        let mut state = shared.lock().await;
        if state.running {
            return Ok(BridgeRuntimeStatus {
                running: true,
                endpoint: format!("ws://{}:{}/bridge", state.config.host, state.config.port),
                extension_connected: state.extension_sender.is_some(),
                command_seq: state.command_seq.load(Ordering::Relaxed),
            });
        }

        if let Some(next) = config {
            state.config = next;
        }

        let (shutdown_tx, shutdown_rx) = watch::channel(false);
        state.shutdown = Some(shutdown_tx);
        state.running = true;

        let task_shared = shared.clone();
        let handle = tokio::spawn(async move {
            server_loop(task_shared, shutdown_rx).await;
        });

        state.server_task = Some(handle);
    }

    status().await
}

pub async fn stop_server() -> CommandResult<BridgeRuntimeStatus> {
    let shared = runtime().clone();

    let task = {
        let mut state = shared.lock().await;
        if let Some(shutdown) = state.shutdown.take() {
            let _ = shutdown.send(true);
        }

        state.running = false;
        state.extension_sender = None;
        state.pending_waiters.clear();
        state.server_task.take()
    };

    if let Some(handle) = task {
        let _ = tokio::time::timeout(Duration::from_secs(2), handle).await;
    }

    status().await
}

pub async fn status() -> CommandResult<BridgeRuntimeStatus> {
    let shared = runtime().clone();
    let state = shared.lock().await;

    Ok(BridgeRuntimeStatus {
        running: state.running,
        endpoint: format!("ws://{}:{}/bridge", state.config.host, state.config.port),
        extension_connected: state.extension_sender.is_some(),
        command_seq: state.command_seq.load(Ordering::Relaxed),
    })
}

pub async fn execute_plan(plan: AutomationExecutionPlan) -> CommandResult<ExecutionPlanReport> {
    if plan.nodes.is_empty() {
        return Err(CommandFlowError::Validation(
            "edge automation plan must contain at least one node".to_string(),
        ));
    }

    let mut reports = Vec::<NodeExecutionReport>::new();

    for node in &plan.nodes {
        let max_retry = node.retry_count.unwrap_or(0);
        let retry_delay = node.retry_delay_ms.unwrap_or(1000);

        let mut attempts: u32 = 0;
        let mut last_error: Option<String> = None;
        let mut final_result: Option<BridgeCommandResult> = None;

        while attempts <= max_retry {
            attempts += 1;
            match send_command_to_extension(&plan, node, attempts).await {
                Ok(result) if result.status.eq_ignore_ascii_case("ok") => {
                    final_result = Some(result.clone());
                    reports.push(NodeExecutionReport {
                        node_id: node.id.clone(),
                        node_type: node.node_type.clone(),
                        status: "ok".to_string(),
                        attempts,
                        result: Some(result),
                        error: None,
                    });
                    break;
                }
                Ok(result) => {
                    let message = result
                        .message
                        .clone()
                        .unwrap_or_else(|| "extension returned non-ok status".to_string());
                    last_error = Some(message);
                    final_result = Some(result);
                }
                Err(error) => {
                    last_error = Some(error.to_string());
                }
            }

            if attempts <= max_retry {
                tokio::time::sleep(Duration::from_millis(retry_delay)).await;
            }
        }

        if final_result
            .as_ref()
            .map(|item| item.status.eq_ignore_ascii_case("ok"))
            .unwrap_or(false)
        {
            continue;
        }

        reports.push(NodeExecutionReport {
            node_id: node.id.clone(),
            node_type: node.node_type.clone(),
            status: "error".to_string(),
            attempts,
            result: final_result,
            error: last_error.clone(),
        });

        return Ok(ExecutionPlanReport {
            session_id: plan.session_id.clone(),
            success: false,
            completed_nodes: reports.len().saturating_sub(1),
            reports,
        });
    }

    Ok(ExecutionPlanReport {
        session_id: plan.session_id,
        success: true,
        completed_nodes: reports.len(),
        reports,
    })
}

async fn send_command_to_extension(
    plan: &AutomationExecutionPlan,
    node: &AutomationDslNode,
    attempt: u32,
) -> CommandResult<BridgeCommandResult> {
    let shared = runtime().clone();

    let (tx, rx) = oneshot::channel::<BridgeCommandResult>();
    let (sender, command_id, timeout_ms) = {
        let mut state = shared.lock().await;
        let Some(sender) = state.extension_sender.clone() else {
            return Err(CommandFlowError::Automation(
                "edge bridge extension is not connected".to_string(),
            ));
        };

        let command_id = next_command_id(&state);
        let timeout_ms = node.timeout_ms.unwrap_or(state.config.command_timeout_ms).max(200);
        state.pending_waiters.insert(command_id.clone(), tx);
        (sender, command_id, timeout_ms)
    };

    let command_payload = json!({
        "kind": "COMMAND",
        "timestamp": now_ms(),
        "data": {
            "commandId": command_id,
            "sessionId": plan.session_id,
            "tabId": plan.tab_id,
            "action": node.node_type,
            "payload": node.payload,
            "timeoutMs": timeout_ms,
            "attempt": attempt,
        }
    });

    sender
        .send(Message::Text(command_payload.to_string()))
        .map_err(|_| CommandFlowError::Automation("failed to send command to extension".to_string()))?;

    let result = tokio::time::timeout(Duration::from_millis(timeout_ms + 1000), rx)
        .await
        .map_err(|_| {
            CommandFlowError::Automation(format!(
                "command '{}' timeout after {}ms",
                node.id, timeout_ms
            ))
        })?
        .map_err(|_| CommandFlowError::Automation("command waiter dropped".to_string()))?;

    Ok(result)
}
