// 页面上下文桥接占位：用于将来接入 fetch/XHR 级别增强采样。
// MV3 下多数自动化能力优先由 background + content script 实现。

(() => {
  const marker = "__EDGE_AUTOMATION_BRIDGE_INJECTED__";
  const win = window as unknown as Record<string, unknown>;
  if (win[marker]) {
    return;
  }
  win[marker] = true;
})();
