export type NodeResultStatus = "ok" | "error" | "retrying";

export interface BridgeConfig {
  endpoint: string;
  token: string;
  reconnectMinMs: number;
  reconnectMaxMs: number;
  heartbeatMs: number;
}

export interface AutomationCommand {
  commandId: string;
  sessionId: string;
  tabId?: number;
  frameId?: number;
  action: string;
  payload?: Record<string, unknown>;
  timeoutMs?: number;
  attempt?: number;
}

export interface BridgeEnvelope {
  kind:
    | "HELLO"
    | "PING"
    | "PONG"
    | "COMMAND"
    | "COMMAND_RESULT"
    | "STATUS"
    | "ERROR"
    | "EVENT";
  timestamp: number;
  data?: Record<string, unknown>;
}

export interface CommandResult {
  commandId: string;
  sessionId: string;
  tabId?: number;
  frameId?: number;
  action: string;
  status: NodeResultStatus;
  message?: string;
  data?: Record<string, unknown>;
}

export interface TabSessionState {
  sessionId: string;
  tabId: number;
  frameIds: Set<number>;
  connectedAt: number;
  lastSeenAt: number;
}

export interface NetworkMockRule {
  id: string;
  tabId: number;
  urlPattern: string;
  method?: string;
  responseStatus?: number;
  responseHeaders?: Array<{ name: string; value: string }>;
  responseBodyBase64?: string;
}
