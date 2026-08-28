export function detachAndClose(ws: WebSocket): void {
  ws.onopen = null;
  ws.onmessage = null;
  ws.onerror = null;
  ws.onclose = null;
  if (ws.readyState < WebSocket.CLOSING) ws.close();
}

export function clientCloseEvent(reason: string): CloseEvent {
  return new CloseEvent("close", {
    code: 1000,
    reason,
    wasClean: true,
  });
}
