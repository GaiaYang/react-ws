/** 平台 timer 延遲上限；超過會溢位，變成立刻觸發 */
export const MAX_TIMEOUT_MS = 2 ** 31 - 1;

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
  if (ws.readyState < WebSocket.CLOSING) ws.close();
}

/** 原生 `onclose` 已卸掉時，自行補發 close */
export function clientCloseEvent(reason: string): CloseEvent {
  return {
    type: "close",
    code: 1000,
    reason,
    wasClean: true,
  } as CloseEvent;
}
