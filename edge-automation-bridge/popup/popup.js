// src/compat.ts
var resolved = globalThis.browser ?? globalThis.chrome;
var ext = resolved;
if (!ext) {
  throw new Error("Neither chrome nor browser namespace is available.");
}

// src/popup.ts
var endpointInput = document.getElementById("endpoint");
var tokenInput = document.getElementById("token");
var saveBtn = document.getElementById("save");
var statusEl = document.getElementById("status");
async function refreshStatus() {
  const cfg = await ext.storage.local.get(["bridgeConfig", "bridgeStatus"]);
  const bridgeConfig = cfg.bridgeConfig ?? {};
  const bridgeStatus = cfg.bridgeStatus ?? {};
  endpointInput.value = bridgeConfig.endpoint ?? "ws://127.0.0.1:17324/bridge";
  tokenInput.value = bridgeConfig.token ?? "CHANGE_ME_TOKEN";
  const status = bridgeStatus.connectionStatus ?? "unknown";
  const sessions = Array.isArray(bridgeStatus.sessions) ? bridgeStatus.sessions.length : 0;
  statusEl.textContent = `\u72B6\u6001: ${status} | \u4F1A\u8BDD\u6570: ${sessions}`;
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
    statusEl.textContent = `\u72B6\u6001: \u4FDD\u5B58\u5931\u8D25 (${response?.error ?? "unknown"})`;
    return;
  }
  await refreshStatus();
});
void refreshStatus();
//# sourceMappingURL=popup.js.map
