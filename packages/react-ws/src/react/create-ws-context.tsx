import { useEffect, useLayoutEffect, useMemo, useState, type PropsWithChildren } from "react";
import {
  createWsSession,
  type WsActions,
  type WsSession,
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

// 父層 layout 晚於子元件。這個節點排在 children 前面，layout 才會先跑。
function SessionMount({ attach, detach }: Pick<WsSession, "attach" | "detach">) {
  useLayoutEffect(() => {
    attach();
    return () => detach();
  }, [attach, detach]);
  return null;
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
            <SessionMount attach={session.attach} detach={session.detach} />
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
