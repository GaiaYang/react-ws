import { useEffect, useMemo, useState, type PropsWithChildren } from "react";
import {
  createWsSession,
  type WsContextValue,
  type WsSessionOptions,
} from "../core/session";
import { createUseWsEvents, createWsEventsContext } from "./ws-events";
import { createUseWsStore, createWsStoreContext } from "./ws-store";
import { createUseWsActions, createWsActionsContext } from "./ws-actions";

/**
 * `createWsContext` 的設定選項。
 *
 * 建立後設定即固定。`url` 與 `protocols` 若為 getter，會在每次 `connect()` 開始時同步呼叫。
 */
export interface CreateWsContextOptions extends WsSessionOptions {
  /**
   * `WsProvider` 掛載時是否自動建立連線。
   *
   * @default true
   */
  autoConnect?: boolean;
}

export function createWsContext(options: CreateWsContextOptions) {
  const { autoConnect = true, ...sessionOptions } = options;

  const StoreCtx = createWsStoreContext();
  const useWsStore = createUseWsStore(StoreCtx);
  const ActionsCtx = createWsActionsContext();
  const useWsActions = createUseWsActions(ActionsCtx);
  const EventsCtx = createWsEventsContext();
  const useWsEvents = createUseWsEvents(EventsCtx);

  function WsProvider({ children }: PropsWithChildren) {
    const [session] = useState(() => createWsSession(sessionOptions));

    useEffect(() => {
      if (autoConnect) session.connect();
      return () => session.teardown("provider unmount");
    }, [session]);

    const actions = useMemo<WsContextValue>(
      () => ({
        send: session.send,
        sendJson: session.sendJson,
        connect: session.connect,
        disconnect: session.disconnect,
        getStatus: session.getStatus,
      }),
      [session],
    );

    return (
      <ActionsCtx.Provider value={actions}>
        <StoreCtx.Provider value={session.store}>
          <EventsCtx.Provider value={session.emitter}>
            {children}
          </EventsCtx.Provider>
        </StoreCtx.Provider>
      </ActionsCtx.Provider>
    );
  }

  return {
    WsProvider,
    useWsActions,
    useWsStore,
    useWsEvents,
  };
}
