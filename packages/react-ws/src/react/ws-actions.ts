import { createContext, useContext, type Context } from "react";
import type { WsActions } from "../core/session";

export function createWsActionsContext() {
  return createContext<WsActions | null>(null);
}

export function createUseWsActions(ActionsCtx: Context<WsActions | null>) {
  function useWsActions(): WsActions {
    const value = useContext(ActionsCtx);
    if (!value) {
      throw new Error("useWsActions 必須在對應的 WsProvider 內");
    }
    return value;
  }

  return useWsActions;
}
