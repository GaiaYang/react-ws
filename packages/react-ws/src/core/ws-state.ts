import type { ReconnectState } from "./reconnect";
import { createStore, type StoreApi } from "./store";

/**
 * WebSocket 連線狀態。
 *
 * - `idle` — 尚未建立連線。只會出現在初始狀態，斷線後不會回到此狀態。
 * - `connecting` — 正在建立連線。
 * - `open` — WebSocket 已連線。
 * - `closed` — WebSocket 已關閉。
 *
 * 連線錯誤不是一種 `WsStatus`，而是透過 `useWsEvents("error")` 通知。
 */
export type WsStatus = "idle" | "connecting" | "open" | "closed";

/**
 * Provider 的連線階段，包含自動重連，與 `status` 分開。
 *
 * - `idle` — 尚未建立連線，且沒有排程中的重連。也是初始狀態，以及手動 `disconnect()` 後的狀態。
 * - `connecting` — 首次連線或手動 `connect()` 正在建立連線。
 * - `open` — WebSocket 已連線。
 * - `reconnecting` — 正在進行自動重連，包括等待計時器到期或正在建立新的連線。
 * - `stopped` — 不會再進行自動重連。已達 `reconnectMax` 且最後一次也失敗時，`reconnectExhausted` 為 `true`。
 */
export type WsPhase =
  "idle" | "connecting" | "open" | "reconnecting" | "stopped";

/** 可訂閱的連線狀態。 */
export interface WsState extends ReconnectState {
  /** WebSocket 本身的連線狀態。 */
  status: WsStatus;
  /** Provider 目前的連線階段。 */
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
