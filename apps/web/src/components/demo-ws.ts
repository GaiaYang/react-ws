"use client";

import { createWsContext } from "react-ws-context";

/** Demo 重連上限（與下方 `reconnectMax` 同步） */
export const DEMO_WS_RECONNECT_MAX = 3;

/** Demo 用實例；設定在 create 時固定 */
export const { WsProvider, useWsActions, useWsStore, useWsEvents } =
  createWsContext({
    url: "ws://localhost:8080",
    reconnectMs: 2000,
    autoConnect: true,
    reconnectMax: DEMO_WS_RECONNECT_MAX,
    outgoingQueueMax: 5,
    liveness: {
      intervalMs: 10_000,
      timeoutMs: 5_000,
      ping: { type: "PING" },
      // DEMO 探活回應協議（須與 mock-ws/src/liveness.ts 對齊）
      // 實際這裡要跟正式環境的探活回應協議對齊
      isPong: (data) =>
        typeof data === "object" &&
        data != null &&
        (data as { type?: string }).type === "PONG",
    },
  });
