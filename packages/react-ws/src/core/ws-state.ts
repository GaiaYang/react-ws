import type { ReconnectState } from "./reconnect";
import { createStore, type StoreApi } from "./store";

/**
 * WebSocket 連線狀態。
 *
 * - `idle`: 尚未建立連線，只會出現在初始狀態，斷線後不會回到此狀態。
 * - `connecting`: 正在建立連線。
 * - `open`: WebSocket 已連線。
 * - `closed`: WebSocket 已關閉。
 *
 * 連線錯誤由 `useWsEvents("error")` 送出。
 */
export type WsStatus = "idle" | "connecting" | "open" | "closed";

/**
 * Provider 的連線階段。
 *
 * - `idle`: 尚未建立連線且沒有排程中的重連。這是初始狀態，也是手動 `disconnect()` 之後的狀態。
 * - `connecting`: 首次連線，或手動 `connect()` 正在建立連線。
 * - `open`: WebSocket 已連線。
 * - `reconnecting`: 正在自動重連，包括等待計時器到期，或正在建立新的連線。
 * - `stopped`: 不會再自動重連。已達 `reconnectMax` 且最後一次也失敗時，`reconnectExhausted` 為 `true`。
 */
export type WsPhase =
  "idle" | "connecting" | "open" | "reconnecting" | "stopped";

/** 連線狀態 */
export interface WsState extends ReconnectState {
  /** WebSocket 本身的連線狀態 */
  status: WsStatus;
  /** Provider 目前的連線階段 */
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
