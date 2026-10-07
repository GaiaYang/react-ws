import { createContext, useContext, type Context } from "react";
import type { WsState, WsStoreApi } from "../core/ws-state";
import { useStore } from "./use-store";

export function createWsStoreContext() {
  return createContext<WsStoreApi | null>(null);
}

export function createUseWsState(StoreCtx: Context<WsStoreApi | null>) {
  function useWsState(): WsState;
  function useWsState<T>(selector: (state: WsState) => T): T;
  function useWsState<T>(selector?: (state: WsState) => T): T {
    const store = useContext(StoreCtx);
    if (!store) {
      throw new Error(
        "useWsState must be used within the corresponding WsProvider",
      );
    }
    const select = selector ?? ((state: WsState) => state as T);
    return useStore(store, select);
  }

  return useWsState;
}
