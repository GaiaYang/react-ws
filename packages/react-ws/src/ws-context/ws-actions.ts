import { createContext, useContext, type Context } from "react";
import type { WsContextValue } from "./types";

export function createWsActionsContext() {
  return createContext<WsContextValue | null>(null);
}

export function createUseWsActions(ActionsCtx: Context<WsContextValue | null>) {
  function useWsActions(): WsContextValue {
    const value = useContext(ActionsCtx);
    if (!value) {
      throw new Error("useWsActions 必須包在對應的 WsProvider 內");
    }
    return value;
  }

  return useWsActions;
}
