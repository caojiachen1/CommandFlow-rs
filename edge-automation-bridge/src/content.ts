import { ext } from "./compat";

type SelectorType = "css" | "xpath" | "text";

interface CommandPayload {
  commandId: string;
  sessionId: string;
  action: string;
  payload?: Record<string, unknown>;
  timeoutMs?: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isVisible(element: Element | null): boolean {
  if (!element || !(element instanceof HTMLElement)) {
    return false;
  }
  const style = getComputedStyle(element);
  const rect = element.getBoundingClientRect();
  return style.visibility !== "hidden" && style.display !== "none" && rect.width > 0 && rect.height > 0;
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

function fuzzyIncludes(target: string, query: string): boolean {
  const t = normalizeText(target);
  const q = normalizeText(query);
  if (!q) {
    return false;
  }
  if (t.includes(q)) {
    return true;
  }

  let cursor = 0;
  for (const ch of t) {
    if (ch === q[cursor]) {
      cursor += 1;
      if (cursor === q.length) {
        return true;
      }
    }
  }
  return false;
}

function queryDeepCss(selector: string, root: Document | ShadowRoot = document): Element[] {
  const hits = Array.from(root.querySelectorAll(selector));
  const allElements = root.querySelectorAll("*");
  allElements.forEach((el) => {
    if ((el as HTMLElement).shadowRoot) {
      hits.push(...queryDeepCss(selector, (el as HTMLElement).shadowRoot!));
    }
  });
  return hits;
}

function queryXPath(xpath: string): Element[] {
  const snapshot = document.evaluate(xpath, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
  const results: Element[] = [];
  for (let i = 0; i < snapshot.snapshotLength; i += 1) {
    const node = snapshot.snapshotItem(i);
    if (node instanceof Element) {
      results.push(node);
    }
  }
  return results;
}

function queryByText(text: string): Element[] {
  const walker = document.createTreeWalker(document, NodeFilter.SHOW_ELEMENT);
  const matched: Element[] = [];
  let current: Node | null = walker.nextNode();
  while (current) {
    const el = current as Element;
    if (fuzzyIncludes(el.textContent ?? "", text)) {
      matched.push(el);
    }
    current = walker.nextNode();
  }
  return matched;
}

function resolveElements(selector: string, selectorType: SelectorType): Element[] {
  switch (selectorType) {
    case "xpath":
      return queryXPath(selector);
    case "text":
      return queryByText(selector);
    case "css":
    default:
      return queryDeepCss(selector);
  }
}

async function waitFor(
  predicate: () => Element | null,
  timeoutMs: number,
  pollMs = 120
): Promise<Element> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const found = predicate();
    if (found) {
      return found;
    }
    await sleep(pollMs);
  }
  throw new Error(`Timeout after ${timeoutMs}ms`);
}

function pickFirst(selector: string, selectorType: SelectorType): Element | null {
  const matched = resolveElements(selector, selectorType);
  return matched[0] ?? null;
}

async function waitForElement(payload: Record<string, unknown>): Promise<Element> {
  const selector = String(payload.selector ?? "");
  const selectorType = String(payload.selectorType ?? "css") as SelectorType;
  const timeoutMs = Number(payload.timeoutMs ?? 5000);
  if (!selector.trim()) {
    throw new Error("selector is required");
  }
  return waitFor(() => pickFirst(selector, selectorType), timeoutMs);
}

async function waitForVisible(payload: Record<string, unknown>): Promise<Element> {
  const selector = String(payload.selector ?? "");
  const selectorType = String(payload.selectorType ?? "css") as SelectorType;
  const timeoutMs = Number(payload.timeoutMs ?? 5000);
  if (!selector.trim()) {
    throw new Error("selector is required");
  }
  return waitFor(() => {
    const found = pickFirst(selector, selectorType);
    return isVisible(found) ? found : null;
  }, timeoutMs);
}

async function waitForText(payload: Record<string, unknown>): Promise<Element> {
  const selector = String(payload.selector ?? "body");
  const text = String(payload.text ?? "");
  const selectorType = String(payload.selectorType ?? "css") as SelectorType;
  const timeoutMs = Number(payload.timeoutMs ?? 5000);
  if (!text.trim()) {
    throw new Error("text is required");
  }
  return waitFor(() => {
    const found = pickFirst(selector, selectorType);
    if (found && fuzzyIncludes(found.textContent ?? "", text)) {
      return found;
    }
    return null;
  }, timeoutMs);
}

function smoothMousePath(from: { x: number; y: number }, to: { x: number; y: number }, steps = 12): Array<{ x: number; y: number }> {
  const points: Array<{ x: number; y: number }> = [];
  for (let i = 1; i <= steps; i += 1) {
    const t = i / steps;
    const ease = t * t * (3 - 2 * t);
    points.push({
      x: from.x + (to.x - from.x) * ease,
      y: from.y + (to.y - from.y) * ease
    });
  }
  return points;
}

async function humanLikeHover(element: Element): Promise<void> {
  const rect = element.getBoundingClientRect();
  const target = {
    x: rect.left + rect.width / 2,
    y: rect.top + rect.height / 2
  };

  const start = { x: target.x - 80, y: target.y - 40 };
  const path = smoothMousePath(start, target, 10 + Math.floor(Math.random() * 7));

  for (const point of path) {
    const evt = new MouseEvent("mousemove", {
      bubbles: true,
      clientX: point.x,
      clientY: point.y
    });
    element.dispatchEvent(evt);
    await sleep(8 + Math.floor(Math.random() * 20));
  }
}

async function humanLikeType(input: HTMLInputElement | HTMLTextAreaElement, value: string): Promise<void> {
  input.focus();
  input.value = "";
  for (const ch of value) {
    input.value += ch;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await sleep(35 + Math.floor(Math.random() * 120));
  }
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

async function execute(command: CommandPayload): Promise<Record<string, unknown>> {
  const payload = command.payload ?? {};
  switch (command.action) {
    case "WAIT_FOR_ELEMENT": {
      const element = await waitForElement(payload);
      return { found: true, tagName: element.tagName };
    }
    case "WAIT_FOR_VISIBLE": {
      const element = await waitForVisible(payload);
      return { visible: true, tagName: element.tagName };
    }
    case "WAIT_FOR_TEXT": {
      const element = await waitForText(payload);
      return { matched: true, text: element.textContent ?? "" };
    }
    case "CLICK": {
      const element = await waitForVisible(payload);
      await humanLikeHover(element);
      (element as HTMLElement).click();
      return { clicked: true };
    }
    case "HOVER": {
      const element = await waitForVisible(payload);
      await humanLikeHover(element);
      return { hovered: true };
    }
    case "TYPE": {
      const element = await waitForVisible(payload);
      const value = String(payload.value ?? "");
      if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement)) {
        throw new Error("TYPE target must be input or textarea");
      }
      await humanLikeType(element, value);
      return { typedLength: value.length };
    }
    case "EXTRACT_TEXT": {
      const element = await waitForElement(payload);
      return { text: (element.textContent ?? "").trim() };
    }
    case "UPLOAD_FILE_DIALOG": {
      const element = await waitForVisible(payload);
      if (!(element instanceof HTMLInputElement) || element.type !== "file") {
        throw new Error("UPLOAD_FILE_DIALOG target must be input[type=file]");
      }
      element.click();
      return { dialogTriggered: true };
    }
    case "SCREENSHOT_DOM_HINT": {
      const body = document.body;
      return {
        viewport: {
          width: window.innerWidth,
          height: window.innerHeight,
          scrollX: window.scrollX,
          scrollY: window.scrollY
        },
        bodySize: {
          width: body?.scrollWidth ?? 0,
          height: body?.scrollHeight ?? 0
        }
      };
    }
    default:
      throw new Error(`Unsupported action: ${command.action}`);
  }
}

const sessionId = crypto.randomUUID();

ext.runtime.sendMessage({
  type: "FRAME_READY",
  sessionId,
  href: location.href,
  top: window.top === window
}).catch(() => undefined);

ext.runtime.onMessage.addListener((
  message: unknown,
  _sender: unknown,
  sendResponse: (response?: unknown) => void
) => {
  const msg = (message ?? {}) as Record<string, unknown>;
  if (msg.type !== "AUTOMATION_COMMAND") {
    return;
  }

  const command = msg.command as CommandPayload;
  void (async () => {
    try {
      const data = await execute(command);
      sendResponse({ status: "ok", data });
    } catch (error) {
      sendResponse({
        status: "error",
        message: error instanceof Error ? error.message : String(error)
      });
    }
  })();

  return true;
});
