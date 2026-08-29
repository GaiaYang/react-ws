import { createContext, useContext, useState, type Context } from "react";
import { createStore, type StoreApi } from "./store";
import { useStore } from "./use-store";

/**
 * 連線生命週期狀態（`WsState` 的一環）。
 *
 * - `idle` — 尚未連線
 * - `connecting` — 連線中
 * - `open` — 已連線
 * - `closed` — 已斷線
 *
 * 錯誤用 `useWsEvents("error")`；不另設 error status。
 */
export type WsStatus = "idle" | "connecting" | "open" | "closed";

/**
 * Provider 連線意圖與重連策略階段（`WsState` 的一環）。
 *
 * 與 `status`（WebSocket readyState 映射）正交，補足 UI 無法單靠 `status` 判斷的情境。
 *
 * - `idle` — 未連線、未排程重連（初始或手動 `disconnect()`）
 * - `connecting` — 首次或手動 `connect()` 連線中
 * - `open` — 已連線
 * - `reconnecting` — 自動重連週期（等待計時器或連線中）；細節搭配 `status`、`reconnectAttempt`
 * - `stopped` — 不會再自動重連；`reconnectExhausted` 區分達上限或未啟用重連
 */
export type WsPhase =
  "idle" | "connecting" | "open" | "reconnecting" | "stopped";

/**
 * 可訂閱的連線層 state（低頻更新）。
 *
 * 只放：**連線健康**、**outbound 佇列**、**重連** 等連線生命週期資訊。
 *
 * 不放：訊息 payload、訊息歷史、業務資料（請用 `useWsEvents` 或自行管理 state）。
 *
 * 未來可能擴充例如 `pendingCount`；新增欄位時請維持低頻、可 selector 訂閱。
 */
export type WsState = {
  /** 連線生命週期狀態 */
  status: WsStatus;
  /** Provider 連線意圖與重連策略階段 */
  phase: WsPhase;
  /**
   * 本輪已排程的自動重連次數（意外斷線當下 +1，非重連成功才 +1）。
   *
   * 顯示為 `n` 時，代表第 `n` 次重連已排程或進行中。
   *
   * 成功 `open`、手動 `connect()` 或主動 `disconnect()` 歸零。
   */
  reconnectAttempt: number;
  /**
   * 本輪自動重連已達 `reconnectMax` 且最後一次也失敗。
   *
   * 手動 `connect()` 或 `disconnect()` 設定為 `false`
   */
  reconnectExhausted: boolean;
};

export type WsStoreApi = StoreApi<WsState>;

export function createWsStore(init: WsStatus = "idle"): WsStoreApi {
  const phase: WsPhase =
    init === "open" || init === "idle" ? init : "connecting";
  return createStore<WsState>({
    status: init,
    phase,
    reconnectAttempt: 0,
    reconnectExhausted: false,
  });
}

export function createWsStoreContext() {
  return createContext<WsStoreApi | null>(null);
}

/** 每個 `WsProvider` 各有一份 {@link WsState} store */
export function useWsStoreApi(): WsStoreApi {
  const [store] = useState(() => createWsStore());
  return store;
}

/** 訂閱 {@link WsState}；建議以 selector 只取需要的連線層欄位。 */
export function createUseWsStore(StoreCtx: Context<WsStoreApi | null>) {
  function useWsStore(): WsState;
  function useWsStore<T>(selector: (state: WsState) => T): T;
  function useWsStore<T>(selector?: (state: WsState) => T): T {
    const store = useContext(StoreCtx);
    if (!store) {
      throw new Error("useWsStore 必須包在對應的 WsProvider 內");
    }
    const select = selector ?? ((state: WsState) => state as T);
    return useStore(store, select);
  }

  return useWsStore;
}
