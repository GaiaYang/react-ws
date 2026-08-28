import type { WebSocket } from "ws";
import type { MockMessage } from "./types.ts";

export function handleMessage(ws: WebSocket, data: WebSocket.RawData): void {
  try {
    const message: MockMessage = JSON.parse(data.toString());
    console.log("收到前端資料:", message);

    if (message.type === "CHAT") {
      ws.send(
        JSON.stringify({
          status: "success",
          reply: `伺服器已收到你的聊天訊息: ${message.payload}`,
        }),
      );
    }
  } catch {
    ws.send(JSON.stringify({ error: "不合法的 JSON 格式" }));
  }
}
