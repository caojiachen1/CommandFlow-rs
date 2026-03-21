import { ext } from "./compat";

const endpointInput = document.getElementById("endpoint") as HTMLInputElement;
const tokenInput = document.getElementById("token") as HTMLInputElement;
const saveBtn = document.getElementById("save") as HTMLButtonElement;
const statusEl = document.getElementById("status") as HTMLDivElement;

async function refreshStatus(): Promise<void> {
  const cfg = await ext.storage.local.get(["bridgeConfig", "bridgeStatus"]);
  const bridgeConfig = (cfg.bridgeConfig ?? {}) as { endpoint?: string; token?: string };
  const bridgeStatus = (cfg.bridgeStatus ?? {}) as {
    connectionStatus?: string;
    sessions?: unknown[];
  };

  endpointInput.value = bridgeConfig.endpoint ?? "ws://127.0.0.1:17324/bridge";
  tokenInput.value = bridgeConfig.token ?? "CHANGE_ME_TOKEN";

  const status = bridgeStatus.connectionStatus ?? "unknown";
  const sessions = Array.isArray(bridgeStatus.sessions) ? bridgeStatus.sessions.length : 0;
  statusEl.textContent = `状态: ${status} | 会话数: ${sessions}`;
}

saveBtn.addEventListener("click", async () => {
  const config = {
    endpoint: endpointInput.value.trim(),
    token: tokenInput.value.trim()
  };

  const response = await ext.runtime.sendMessage({
    type: "SET_BRIDGE_CONFIG",
    config
  });

  if (!response?.ok) {
    statusEl.textContent = `状态: 保存失败 (${response?.error ?? "unknown"})`;
    return;
  }

  await refreshStatus();
});

void refreshStatus();
