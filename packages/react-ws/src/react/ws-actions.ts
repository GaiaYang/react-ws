import { createContext, useContext, type Context } from "react";
import type { WsActions } from "../core/session";

export function createWsActionsContext() {
  return createContext<WsActions | null>(null);
}

export function createUseWsActions(ActionsCtx: Context<WsActions | null>) {
  function useWsActions(): WsActions {
    const value = useContext(ActionsCtx);
    if (!value) {
      throw new Error(
        "useWsActions must be used within the corresponding WsProvider",
      );
    }
    return value;
  }

  return useWsActions;
}
