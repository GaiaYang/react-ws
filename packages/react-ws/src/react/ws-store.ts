import { createContext, useContext, type Context } from "react";
import type { WsState, WsStoreApi } from "../core/ws-state";
import { useStore } from "./use-store";

export function createWsStoreContext() {
  return createContext<WsStoreApi | null>(null);
}

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
