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
