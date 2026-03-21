import { ext, getLastError } from "./compat";
import {
  type AutomationCommand,
  type BridgeConfig,
  type BridgeEnvelope,
  type CommandResult,
  type NetworkMockRule,
  type TabSessionState
} from "./types";

const DEFAULT_CONFIG: BridgeConfig = {
  endpoint: "ws://127.0.0.1:17324/bridge",
  token: "CHANGE_ME_TOKEN",
  reconnectMinMs: 1000,
  reconnectMaxMs: 15000,
  heartbeatMs: 15000
};

const HEARTBEAT_ALARM = "edge-automation-heartbeat";
const KEEP_ALIVE_ALARM = "edge-automation-keepalive";

const state = {
  config: { ...DEFAULT_CONFIG },
  socket: null as WebSocket | null,
  reconnectAttempt: 0,
  reconnectTimer: null as number | null,
  sessions: new Map<number, TabSessionState>(),
  pendingQueue: [] as BridgeEnvelope[],
  networkMocks: new Map<string, NetworkMockRule>(),
  debuggerAttachedTabs: new Set<number>(),
  lastHeartbeatAt: 0,
  connectionStatus: "disconnected"
};

function jitter(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function backoff(attempt: number): number {
  const exp = Math.min(state.config.reconnectMaxMs, state.config.reconnectMinMs * (2 ** attempt));
  return Math.min(state.config.reconnectMaxMs, exp + jitter(50, 400));
}

async function loadConfig(): Promise<void> {
  const data = await ext.storage.local.get(["bridgeConfig"]);
  const incoming = data.bridgeConfig as Partial<BridgeConfig> | undefined;
  if (!incoming) {
    return;
  }
  state.config = {
    ...state.config,
    ...incoming
  };
}

async function persistStatus(): Promise<void> {
  await ext.storage.local.set({
    bridgeStatus: {
      connectionStatus: state.connectionStatus,
      endpoint: state.config.endpoint,
      lastHeartbeatAt: state.lastHeartbeatAt,
      sessions: Array.from(state.sessions.values()).map((s) => ({
        sessionId: s.sessionId,
        tabId: s.tabId,
        frameCount: s.frameIds.size,
        connectedAt: s.connectedAt,
        lastSeenAt: s.lastSeenAt
      }))
    }
  });
}

function setConnectionStatus(status: string): void {
  state.connectionStatus = status;
  void persistStatus();
}

function sendEnvelope(envelope: BridgeEnvelope): void {
  if (!state.socket || state.socket.readyState !== WebSocket.OPEN) {
    state.pendingQueue.push(envelope);
    return;
  }

  try {
    state.socket.send(JSON.stringify(envelope));
  } catch (error) {
    console.error("[bridge] send failed", error);
    state.pendingQueue.push(envelope);
  }
}

function flushQueue(): void {
  if (!state.socket || state.socket.readyState !== WebSocket.OPEN) {
    return;
  }

  const queue = [...state.pendingQueue];
  state.pendingQueue = [];
  queue.forEach((item) => sendEnvelope(item));
}

function makeEnvelope(kind: BridgeEnvelope["kind"], data?: Record<string, unknown>): BridgeEnvelope {
  return {
    kind,
    timestamp: Date.now(),
    data
  };
}

function scheduleReconnect(): void {
  if (state.reconnectTimer !== null) {
    return;
  }

  const delay = backoff(state.reconnectAttempt++);
  state.reconnectTimer = self.setTimeout(() => {
    state.reconnectTimer = null;
    void connectBridge();
  }, delay);
}

function clearReconnect(): void {
  if (state.reconnectTimer !== null) {
    clearTimeout(state.reconnectTimer);
    state.reconnectTimer = null;
  }
}

async function connectBridge(): Promise<void> {
  clearReconnect();

  if (
    state.socket
    && (state.socket.readyState === WebSocket.OPEN
      || state.socket.readyState === WebSocket.CONNECTING)
  ) {
    return;
  }

  setConnectionStatus("connecting");

  const url = new URL(state.config.endpoint);
  if (state.config.token?.trim()) {
    url.searchParams.set("token", state.config.token.trim());
  }

  const ws = new WebSocket(url.toString());
  state.socket = ws;

  ws.onopen = () => {
    state.reconnectAttempt = 0;
    setConnectionStatus("connected");
    sendEnvelope(makeEnvelope("HELLO", {
      extension: "edge-automation-bridge",
      version: "0.1.0",
      capabilities: [
        "selector:css",
        "selector:xpath",
        "selector:text-fuzzy",
        "wait:element",
        "wait:visible",
        "wait:text",
        "shadow-dom",
        "iframe",
        "network-mock",
        "screenshot",
        "download-watch",
        "human-sim"
      ]
    }));
    flushQueue();
  };

  ws.onmessage = (event) => {
    let envelope: BridgeEnvelope | null = null;
    try {
      envelope = JSON.parse(event.data) as BridgeEnvelope;
    } catch (error) {
      console.error("[bridge] invalid message", error);
      return;
    }

    if (!envelope) {
      return;
    }

    void handleEnvelope(envelope);
  };

  ws.onclose = () => {
    setConnectionStatus("disconnected");
    scheduleReconnect();
  };

  ws.onerror = (error) => {
    console.error("[bridge] websocket error", error);
    setConnectionStatus("error");
  };
}

async function handleEnvelope(envelope: BridgeEnvelope): Promise<void> {
  switch (envelope.kind) {
    case "PING":
      state.lastHeartbeatAt = Date.now();
      sendEnvelope(makeEnvelope("PONG", { at: state.lastHeartbeatAt }));
      return;
    case "COMMAND": {
      const command = envelope.data as unknown as AutomationCommand;
      if (!command || !command.action || !command.commandId || !command.sessionId) {
        sendEnvelope(makeEnvelope("ERROR", { message: "Invalid COMMAND payload" }));
        return;
      }
      const result = await executeCommand(command);
      sendEnvelope(makeEnvelope("COMMAND_RESULT", result as unknown as Record<string, unknown>));
      return;
    }
    default:
      return;
  }
}

function getTabsBySession(sessionId: string): number[] {
  return Array.from(state.sessions.values())
    .filter((item) => item.sessionId === sessionId)
    .map((item) => item.tabId);
}

async function executeCommand(command: AutomationCommand): Promise<CommandResult> {
  try {
    if (command.action === "PING") {
      return {
        commandId: command.commandId,
        sessionId: command.sessionId,
        status: "ok",
        action: command.action,
        data: {
          connectionStatus: state.connectionStatus,
          sessions: Array.from(state.sessions.values()).length
        }
      };
    }

    if (command.action === "SET_NETWORK_MOCK") {
      await enableNetworkMock(command);
      return {
        commandId: command.commandId,
        sessionId: command.sessionId,
        tabId: command.tabId,
        status: "ok",
        action: command.action,
        data: { enabled: true }
      };
    }

    if (command.action === "CLEAR_NETWORK_MOCK") {
      await clearNetworkMock(command);
      return {
        commandId: command.commandId,
        sessionId: command.sessionId,
        tabId: command.tabId,
        status: "ok",
        action: command.action,
        data: { cleared: true }
      };
    }

    if (command.action === "SCREENSHOT_VISIBLE_TAB") {
      const image = await ext.tabs.captureVisibleTab({ format: "png" });
      return {
        commandId: command.commandId,
        sessionId: command.sessionId,
        tabId: command.tabId,
        status: "ok",
        action: command.action,
        data: { base64PngDataUrl: image }
      };
    }

    const targetTabs = resolveTargetTabs(command);
    if (targetTabs.length === 0) {
      throw new Error(`No target tab resolved for session ${command.sessionId}`);
    }

    for (const tabId of targetTabs) {
      const result = await sendCommandToTab(tabId, command);
      if (result.status === "ok") {
        return {
          ...result,
          commandId: command.commandId,
          sessionId: command.sessionId,
          tabId
        };
      }
    }

    throw new Error(`Command ${command.action} failed in all target tabs/frames`);
  } catch (error) {
    return {
      commandId: command.commandId,
      sessionId: command.sessionId,
      tabId: command.tabId,
      action: command.action,
      status: "error",
      message: error instanceof Error ? error.message : String(error)
    };
  }
}

function resolveTargetTabs(command: AutomationCommand): number[] {
  if (typeof command.tabId === "number") {
    return [command.tabId];
  }

  const bySession = getTabsBySession(command.sessionId);
  if (bySession.length > 0) {
    return bySession;
  }

  return Array.from(state.sessions.values()).map((item) => item.tabId);
}

async function sendCommandToTab(tabId: number, command: AutomationCommand): Promise<CommandResult> {
  const session = state.sessions.get(tabId);
  const frameIds = session ? Array.from(session.frameIds) : [0];

  const candidates = command.frameId !== undefined ? [command.frameId] : frameIds;
  for (const frameId of candidates) {
    try {
      const response = await ext.tabs.sendMessage(tabId, {
        type: "AUTOMATION_COMMAND",
        command
      }, { frameId });

      if (response && response.status === "ok") {
        return {
          commandId: command.commandId,
          sessionId: command.sessionId,
          tabId,
          frameId,
          action: command.action,
          status: "ok",
          data: response.data ?? {}
        };
      }
    } catch (error) {
      console.debug("[bridge] frame command failed", { tabId, frameId, error });
    }
  }

  return {
    commandId: command.commandId,
    sessionId: command.sessionId,
    tabId,
    action: command.action,
    status: "error",
    message: `No frame could handle action ${command.action}`
  };
}

async function ensureDebuggerAttached(tabId: number): Promise<void> {
  if (state.debuggerAttachedTabs.has(tabId)) {
    return;
  }

  await ext.debugger.attach({ tabId }, "1.3");
  await ext.debugger.sendCommand({ tabId }, "Fetch.enable", {
    patterns: [{ urlPattern: "*", requestStage: "Request" }, { urlPattern: "*", requestStage: "Response" }]
  });

  state.debuggerAttachedTabs.add(tabId);
}

async function enableNetworkMock(command: AutomationCommand): Promise<void> {
  if (typeof command.tabId !== "number") {
    throw new Error("SET_NETWORK_MOCK requires tabId");
  }

  const payload = command.payload ?? {};
  const rule: NetworkMockRule = {
    id: String(payload.ruleId ?? crypto.randomUUID()),
    tabId: command.tabId,
    urlPattern: String(payload.urlPattern ?? "*"),
    method: payload.method ? String(payload.method) : undefined,
    responseStatus: payload.responseStatus ? Number(payload.responseStatus) : 200,
    responseHeaders: Array.isArray(payload.responseHeaders)
      ? (payload.responseHeaders as Array<{ name: string; value: string }>)
      : [{ name: "content-type", value: "application/json" }],
    responseBodyBase64: payload.responseBodyBase64 ? String(payload.responseBodyBase64) : undefined
  };

  await ensureDebuggerAttached(command.tabId);
  state.networkMocks.set(rule.id, rule);
}

async function clearNetworkMock(command: AutomationCommand): Promise<void> {
  const payload = command.payload ?? {};
  const ruleId = payload.ruleId ? String(payload.ruleId) : undefined;

  if (ruleId) {
    state.networkMocks.delete(ruleId);
  } else if (typeof command.tabId === "number") {
    for (const [id, rule] of state.networkMocks.entries()) {
      if (rule.tabId === command.tabId) {
        state.networkMocks.delete(id);
      }
    }
  } else {
    state.networkMocks.clear();
  }
}

function matchesMockRule(tabId: number, url: string, method: string): NetworkMockRule | null {
  for (const rule of state.networkMocks.values()) {
    if (rule.tabId !== tabId) {
      continue;
    }

    const methodMatched = !rule.method || rule.method.toUpperCase() === method.toUpperCase();
    const urlMatched = rule.urlPattern === "*" || url.includes(rule.urlPattern.replaceAll("*", ""));

    if (methodMatched && urlMatched) {
      return rule;
    }
  }

  return null;
}

ext.debugger.onEvent.addListener(async (
  source: { tabId?: number },
  method: string,
  params?: unknown
) => {
  if (method !== "Fetch.requestPaused" || source.tabId === undefined) {
    return;
  }

  const tabId = source.tabId;
  const raw = (params ?? {}) as Record<string, unknown>;
  const request = (raw.request ?? {}) as { method: string; url: string };
  const requestId = String(raw.requestId ?? "");
  const stage = raw.responseStatusCode ? "Response" : "Request";

  const matchedRule = matchesMockRule(tabId, request.url, request.method);
  if (!matchedRule) {
    await ext.debugger.sendCommand({ tabId }, "Fetch.continueRequest", { requestId });
    return;
  }

  if (stage === "Request" && matchedRule.responseBodyBase64) {
    await ext.debugger.sendCommand({ tabId }, "Fetch.fulfillRequest", {
      requestId,
      responseCode: matchedRule.responseStatus ?? 200,
      responseHeaders: matchedRule.responseHeaders,
      body: matchedRule.responseBodyBase64
    });
    return;
  }

  await ext.debugger.sendCommand({ tabId }, "Fetch.continueRequest", { requestId });
});

ext.runtime.onMessage.addListener((
  message: unknown,
  sender: { tab?: { id?: number }; frameId?: number },
  sendResponse: (response?: unknown) => void
) => {
  void (async () => {
    const msg = (message ?? {}) as Record<string, unknown>;

    if (msg.type === "FRAME_READY" && sender.tab?.id !== undefined && sender.frameId !== undefined) {
      const tabId = sender.tab.id;
      const sessionId = String(msg.sessionId ?? `tab-${tabId}`);
      const current = state.sessions.get(tabId) ?? {
        tabId,
        sessionId,
        frameIds: new Set<number>(),
        connectedAt: Date.now(),
        lastSeenAt: Date.now()
      };
      current.frameIds.add(sender.frameId);
      current.lastSeenAt = Date.now();
      current.sessionId = sessionId;
      state.sessions.set(tabId, current);
      await persistStatus();
    }

    if (msg.type === "SET_BRIDGE_CONFIG") {
      const next = (msg.config ?? {}) as Partial<BridgeConfig>;
      state.config = {
        ...state.config,
        ...next
      };
      await ext.storage.local.set({ bridgeConfig: state.config });
      await connectBridge();
      sendResponse({ ok: true, config: state.config });
      return;
    }

    if (msg.type === "GET_BRIDGE_STATUS") {
      sendResponse({
        ok: true,
        status: state.connectionStatus,
        endpoint: state.config.endpoint,
        sessions: Array.from(state.sessions.values()).map((s) => ({
          tabId: s.tabId,
          sessionId: s.sessionId,
          frames: s.frameIds.size,
          lastSeenAt: s.lastSeenAt
        }))
      });
      return;
    }

    sendResponse({ ok: true });
  })().catch((error) => {
    sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) });
  });

  return true;
});

ext.tabs.onRemoved.addListener((tabId: number) => {
  state.sessions.delete(tabId);
  void persistStatus();
});

ext.downloads.onChanged.addListener((delta: { state?: { current?: string }; id?: number }) => {
  if (!delta.state || !delta.id) {
    return;
  }

  sendEnvelope(makeEnvelope("EVENT", {
    event: "DOWNLOAD_STATE_CHANGED",
    downloadId: delta.id,
    state: delta.state.current
  }));
});

ext.alarms.onAlarm.addListener((alarm: { name: string }) => {
  if (alarm.name === HEARTBEAT_ALARM) {
    sendEnvelope(makeEnvelope("PING", { from: "extension" }));
    return;
  }

  if (alarm.name === KEEP_ALIVE_ALARM) {
    ext.runtime.getPlatformInfo(() => {
      const err = getLastError();
      if (err) {
        console.debug("[bridge] keepalive check", err);
      }
    });
  }
});

async function bootstrap(): Promise<void> {
  await loadConfig();
  await ext.alarms.create(HEARTBEAT_ALARM, { periodInMinutes: 0.5 });
  await ext.alarms.create(KEEP_ALIVE_ALARM, { periodInMinutes: 0.5 });
  await connectBridge();
}

void bootstrap();
