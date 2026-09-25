import type { ReconnectState } from "./reconnect";
import { createStore, type StoreApi } from "./store";

/**
 * WebSocket 連線狀態。
 *
 * - `idle` — 僅初始值；之後斷線為 `closed`，不會回到 `idle`
 * - `connecting`／`open`／`closed` — 對應當下連線
 *
 * 錯誤走事件 `"error"`，不是一種 status。
 */
export type WsStatus = "idle" | "connecting" | "open" | "closed";

/**
 * 連線階段（含重連），與 `status` 分開。
 *
 * - `idle` — 未連線、未排程重連（初始或 `disconnect()`）
 * - `connecting` — 首次或手動 `connect()` 進行中
 * - `open` — 已連線
 * - `reconnecting` — 自動重連（等計時器或連線中）
 * - `stopped` — 不再自動重連；是否因達 `reconnectMax` 見 `reconnectExhausted`
 */
export type WsPhase =
  "idle" | "connecting" | "open" | "reconnecting" | "stopped";

/** 可訂閱的連線層 state */
export interface WsState extends ReconnectState {
  /** WebSocket 連線狀態。 */
  status: WsStatus;
  /** 連線階段 */
  phase: WsPhase;
}

export type WsStoreApi = StoreApi<WsState>;

export function createWsStore(): WsStoreApi {
  return createStore<WsState>({
    status: "idle",
    phase: "idle",
    reconnectAttempt: 0,
    reconnectExhausted: false,
    nextReconnectAt: 0,
  });
}
