/** 平台 timer 延遲上限；超過會溢位，變成立刻觸發 */
export const MAX_TIMEOUT_MS = 2 ** 31 - 1;

// 規格上的 `readyState`。
// 不讀全域 `WebSocket`：建構子被拿掉後，既有 socket 仍要能送出與關閉。
export const READY_CONNECTING = 0;
export const READY_OPEN = 1;
export const READY_CLOSING = 2;

/** 無法得到字串時回 `null`，呼叫端應略過送出 */
export function stringifyJson(data: unknown): string | null {
  try {
    const json = JSON.stringify(data);
    return typeof json === "string" ? json : null;
  } catch {
    return null;
  }
}

export function detachAndClose(ws: WebSocket): void {
  // 不先清 handler，原生 onclose 會再排重連、改 store
  ws.onopen = null;
  ws.onmessage = null;
  ws.onerror = null;
  ws.onclose = null;
  if (ws.readyState < READY_CLOSING) ws.close();
}

/** 原生 `onclose` 已卸掉時，自行補發 close。有 `CloseEvent` 才用它，否則退回同樣欄位 */
export function clientCloseEvent(
  reason: string,
  code = 1000,
  wasClean = true,
): CloseEvent {
  const CloseEventCtor = globalThis.CloseEvent;
  if (typeof CloseEventCtor === "function") {
    return new CloseEventCtor("close", { code, reason, wasClean });
  }
  return { type: "close", code, reason, wasClean } as CloseEvent;
}
