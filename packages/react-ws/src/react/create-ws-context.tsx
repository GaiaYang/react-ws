import { useEffect, useMemo, useState, type PropsWithChildren } from "react";
import { createWsSession } from "../core/session";
import type { CreateWsContextOptions, WsContextValue } from "../core/types";
import { createUseWsEvents, createWsEventsContext } from "./ws-events";
import { createUseWsStore, createWsStoreContext } from "./ws-store";
import { createUseWsActions, createWsActionsContext } from "./ws-actions";

export function createWsContext(options: CreateWsContextOptions) {
  const { autoConnect = true } = options;

  const StoreCtx = createWsStoreContext();
  const useWsStore = createUseWsStore(StoreCtx);
  const ActionsCtx = createWsActionsContext();
  const useWsActions = createUseWsActions(ActionsCtx);
  const EventsCtx = createWsEventsContext();
  const useWsEvents = createUseWsEvents(EventsCtx);

  function WsProvider({ children }: PropsWithChildren) {
    const [session] = useState(() => createWsSession(options));

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
