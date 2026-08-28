/** 協議字串須與 demo-ws liveness 設定一致（mock 不依賴 react-ws-context） */
const PING_MESSAGE_TYPE = "PING";
const PONG_MESSAGE_TYPE = "PONG";

/** 若為 PING 則回 PONG；已處理回傳 true */
export function tryHandleLiveness(
  ws: { send(data: string): void },
  data: unknown,
): boolean {
  if (typeof data !== "object" || data == null) return false;
  const msg = data as Record<string, unknown>;
  if (msg.type !== PING_MESSAGE_TYPE) return false;
  console.log("💓 收到探活 PING");
  ws.send(JSON.stringify({ type: PONG_MESSAGE_TYPE }));
  console.log("📤 回覆 PONG");
  return true;
}
