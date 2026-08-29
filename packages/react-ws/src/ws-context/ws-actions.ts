import { createContext, useContext, type Context } from "react";
import type { WsContextValue } from "./types";

/** actions 無獨立 instance；由 WsProvider 以 useMemo 組裝後注入 Context */
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
