type BrowserLike = typeof chrome;

const resolved = (globalThis as { browser?: BrowserLike; chrome?: BrowserLike }).browser
  ?? (globalThis as { browser?: BrowserLike; chrome?: BrowserLike }).chrome;

export const ext: BrowserLike = resolved as BrowserLike;

if (!ext) {
  throw new Error("Neither chrome nor browser namespace is available.");
}

export function getLastError(): string | null {
  const err = ext.runtime.lastError;
  return err?.message ?? null;
}
