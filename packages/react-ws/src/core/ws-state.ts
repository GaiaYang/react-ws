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

/** 可訂閱的連線層 state。不含訊息 payload（請用事件）。 */
export interface WsState {
  /** WebSocket 連線狀態。 */
  status: WsStatus;
  /** 連線階段 */
  phase: WsPhase;
  /**
   * 本輪已排程的自動重連次數（決定重試時 +1，不是連上才 +1）。
   *
   * 撐滿 `reconnectMinUptimeMs` 才歸零；等待重連計時器時的手動 `connect()` 不算新一輪。
   */
  reconnectAttempt: number;
  /**
   * 已達 `reconnectMax` 且最後一次也失敗。
   *
   * 之後的 `connect()`／`disconnect()` 清回 `false`。
   */
  reconnectExhausted: boolean;
  /** 下次自動重連到期時間（`Date.now()` 毫秒）。未在等待時為 `0`。 */
  nextReconnectAt: number;
}

export type WsStoreApi = StoreApi<WsState>;

export function createWsStore(init: WsStatus = "idle"): WsStoreApi {
  // closed 可能對應 idle 或 stopped；只給 status 時無法獨推 phase
  const phase: WsPhase =
    init === "open" || init === "idle" ? init : "connecting";
  return createStore<WsState>({
    status: init,
    phase,
    reconnectAttempt: 0,
    reconnectExhausted: false,
    nextReconnectAt: 0,
  });
}
