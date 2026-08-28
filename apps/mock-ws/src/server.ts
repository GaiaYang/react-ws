import { WebSocketServer, type WebSocket } from "ws";
import { handleMessage } from "./handlers.ts";
import { tryHandleLiveness } from "./liveness.ts";
import { createStallState, interceptStallMessage } from "./stall.ts";

/** 預設 port */
const DEFAULT_PORT = 8080;

/** 啟動 WebSocket 模擬伺服器 */
export function startServer(port = DEFAULT_PORT): WebSocketServer {
  const wss = new WebSocketServer({ port });

  console.log(`🚀 WebSocket 模擬伺服器已在 ws://localhost:${port} 啟動`);

  wss.on("connection", (ws: WebSocket) => {
    console.log("✅ 前端已成功連線");
    const stallState = createStallState();

    ws.on("message", (data) => {
      const raw = data.toString();
      if (interceptStallMessage(ws, stallState, raw)) return;

      try {
        const parsed = JSON.parse(raw) as unknown;
        if (tryHandleLiveness(ws, parsed)) return;
      } catch {
        // 交給 handleMessage 回傳格式錯誤
      }

      handleMessage(ws, data);
    });

    ws.on("close", () =>
      console.log("❌ 前端已斷開連線", { stalled: stallState.active }),
    );
  });

  return wss;
}
