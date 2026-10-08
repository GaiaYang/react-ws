import { useEffect, useLayoutEffect, useMemo, useState, type PropsWithChildren } from "react";
import {
  createWsSession,
  type WsActions,
  type WsSessionOptions,
} from "../core/session";
import { createUseWsEvents, createWsEventsContext } from "./ws-events";
import { createUseWsState, createWsStoreContext } from "./ws-store";
import { createUseWsActions, createWsActionsContext } from "./ws-actions";

/** `createWsContext` 的設定選項 */
export interface CreateWsContextOptions extends WsSessionOptions {
  /**
   * `WsProvider` 掛載時是否自動建立連線
   *
   * @default true
   */
  autoConnect?: boolean;
}

export function createWsContext(options: CreateWsContextOptions) {
  const { autoConnect = true, ...sessionOptions } = options;

  const StoreCtx = createWsStoreContext();
  const useWsState = createUseWsState(StoreCtx);
  const ActionsCtx = createWsActionsContext();
  const useWsActions = createUseWsActions(ActionsCtx);
  const EventsCtx = createWsEventsContext();
  const useWsEvents = createUseWsEvents(EventsCtx);

  function WsProvider({ children }: PropsWithChildren) {
    const [session] = useState(() => createWsSession(sessionOptions));

    // StrictMode 重掛時，layout 早於子元件的 passive effect，connect() 才不會在 attach 之前被丟掉。
    useLayoutEffect(() => {
      session.attach();
    }, [session]);

    useEffect(() => {
      if (autoConnect) session.connect();
      return () => session.teardown("provider unmount");
    }, [session]);

    const actions = useMemo<WsActions>(
      () => ({
        send: session.send,
        sendJson: session.sendJson,
        connect: session.connect,
        disconnect: session.disconnect,
        getState: session.getState,
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
    useWsState,
    useWsEvents,
  };
}
