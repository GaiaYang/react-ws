import { createContext, useContext, useState, type Context } from "react";
import { createStore, type StoreApi } from "./store";
import { useStore } from "./use-store";

/**
 * 連線生命週期狀態（`WsState` 的一環）。
 *
 * - `idle` — 僅初始 store；之後斷線為 `closed`（`disconnect()` 不會回到 `idle`）
 * - `connecting`／`open`／`closed` — 對應 WebSocket 當下狀態
 *
 * 錯誤走 `useWsEvents("error")`，不另設 error status，以免和 `closed` 搶同一瞬間的語意。
 */
export type WsStatus = "idle" | "connecting" | "open" | "closed";

/**
 * Provider 連線意圖與重連策略階段（`WsState` 的一環）。
 *
 * 與 `status` 分開：`status` 是 WebSocket 當下狀態，無法表達「正在等重連」或「已放棄」。
 *
 * - `idle` — 未連線、未排程重連（初始或手動 `disconnect()`）
 * - `connecting` — 首次或手動 `connect()` 連線中
 * - `open` — 已連線
 * - `reconnecting` — 自動重連週期（等待計時器或連線中）
 * - `stopped` — 不會再自動重連；`reconnectExhausted === true` 表示已達 `reconnectMax`；`false` 表示未啟用重連，或握手在計時器已觸發後失敗
 */
export type WsPhase =
  "idle" | "connecting" | "open" | "reconnecting" | "stopped";

/**
 * 可訂閱的連線層 state（低頻更新）。
 *
 * 只放連線健康與重連等生命週期；訊息 payload 請用 `useWsEvents`，以免每則訊息都重渲染。
 *
 * 欄位限原始值，避免訂閱時因新物件／陣列而誤判變更。
 */
export type WsState = {
  /** 連線生命週期狀態 */
  status: WsStatus;
  /** Provider 連線意圖與重連策略階段 */
  phase: WsPhase;
  /**
   * 本輪已排程的自動重連次數（意外斷線當下 +1，不是重連成功才 +1）。
   *
   * 撐滿 `reconnectMinUptimeMs` 才歸零，避免短命連線把退避打回第一階。
   *
   * 計時器等待中的手動 `connect()` 不算新一輪，否則退避會被打斷。
   */
  reconnectAttempt: number;
  /**
   * 本輪自動重連已達 `reconnectMax` 且最後一次也失敗。
   *
   * 手動 `connect()`／`disconnect()` 清掉，好讓 UI 能再試。
   */
  reconnectExhausted: boolean;
  /**
   * 下次自動重連的預定時間（`Date.now()` 時間軸的毫秒數）。
   *
   * 未在等待時為 `0`。退避與抖動後，這是唯一能得知本次要等多久的來源。
   */
  nextReconnectAt: number;
};

export type WsStoreApi = StoreApi<WsState>;

export function createWsStore(init: WsStatus = "idle"): WsStoreApi {
  // closed 可能是 idle 或 stopped，init 只給 status 時無法獨推 phase
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

export function createWsStoreContext() {
  return createContext<WsStoreApi | null>(null);
}

export function useWsStoreApi(): WsStoreApi {
  const [store] = useState(() => createWsStore());
  return store;
}

/** 訂閱 {@link WsState}；建議以 selector 只取需要的欄位，避免無關欄位更新也重渲染 */
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
