/** 平台 `setTimeout`／`setInterval` 延遲上限；超過會溢位成立即觸發 */
export const MAX_TIMEOUT_MS = 2 ** 31 - 1;

/** JSON.stringify 得不到字串時（undefined／function／symbol／circular）回 `null` */
export function stringifyJson(data: unknown): string | null {
  try {
    const json = JSON.stringify(data);
    return typeof json === "string" ? json : null;
  } catch {
    return null;
  }
}

export function detachAndClose(ws: WebSocket): void {
  // 不先清掉 handler 的話，原生 onclose 會再排重連、改 store
  ws.onopen = null;
  ws.onmessage = null;
  ws.onerror = null;
  ws.onclose = null;
  if (ws.readyState < WebSocket.CLOSING) ws.close();
}

/** 原生 `onclose` 已被卸掉，需自行發事件。*/
export function clientCloseEvent(reason: string): CloseEvent {
  return {
    type: "close",
    code: 1000,
    reason,
    wasClean: true,
  } as CloseEvent;
}
