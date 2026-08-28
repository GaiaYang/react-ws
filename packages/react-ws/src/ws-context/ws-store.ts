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
 * 可訂閱的連線層 state（低頻更新）。
 *
 * 只放：**連線健康**、**outbound 佇列**、**重連** 等連線生命週期資訊。
 * 不放：訊息 payload、訊息歷史、業務資料（請用 `useWsEvents` 或自行管理 state）。
 *
 * 未來可能擴充例如 `reconnectAttempt`、`pendingCount`；新增欄位時請維持低頻、可 selector 訂閱。
 */
export type WsState = {
  /** 連線生命週期狀態 */
  status: WsStatus;
};

export type WsStoreApi = StoreApi<WsState>;

export function createWsStore(init: WsStatus = "idle"): WsStoreApi {
  return createStore<WsState>({ status: init });
}

/** 每個 `WsProvider` 各有一份 {@link WsState} store */
export function useWsStoreApi(): WsStoreApi {
  const [store] = useState(() => createWsStore());
  return store;
}

export function createWsStoreContext() {
  return createContext<WsStoreApi | null>(null);
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
