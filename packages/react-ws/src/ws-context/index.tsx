import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  type PropsWithChildren,
} from "react";
import { useEmitter } from "./emitter";
import { createUseWsEvents, createWsEventsContext } from "./ws-events";
import type { CreateWsContextOptions, WsContextValue, WsEvents } from "./types";
import { useLiveness } from "./liveness/liveness";
import { useOutgoingQueue } from "./outgoing-queue";
import {
  createUseWsStore,
  createWsStoreContext,
  useWsStoreApi,
  type WsPhase,
  type WsStatus,
} from "./ws-store";
import { createUseWsActions, createWsActionsContext } from "./ws-actions";
import { useReconnect } from "./reconnect";
import { clientCloseEvent, detachAndClose } from "./socket";

export type { CreateWsContextOptions, WsContextValue, WsEvents } from "./types";

function defaultParse(data: MessageEvent["data"]): unknown {
  if (typeof data !== "string") return data;
  try {
    return JSON.parse(data) as unknown;
  } catch {
    return data;
  }
}

/**
 * @example
 * ```ts
 * export const { WsProvider, useWsActions, useWsStore, useWsEvents } =
 *   createWsContext({ url: "ws://localhost:8080" });
 * ```
 */
export function createWsContext(options: CreateWsContextOptions) {
  const {
    url,
    protocols,
    autoConnect = true,
    reconnectMs = 0,
    reconnectMax = 0,
    outgoingQueueMax = 0,
    parse = defaultParse,
    liveness,
  } = options;

  const ActionsCtx = createWsActionsContext();
  const useWsActions = createUseWsActions(ActionsCtx);
  const StoreCtx = createWsStoreContext();
  const useWsStore = createUseWsStore(StoreCtx);
  const EmitterCtx = createWsEventsContext();
  const useWsEvents = createUseWsEvents(EmitterCtx);

  function WsProvider({ children }: PropsWithChildren) {
    const wsRef = useRef<WebSocket | null>(null);
    const store = useWsStoreApi();
    const emitter = useEmitter<WsEvents>();
    const reconnect = useReconnect(reconnectMs, reconnectMax, {
      getAttempt: () => store.getState().reconnectAttempt,
      setAttempt: (reconnectAttempt) => store.setState({ reconnectAttempt }),
      setExhausted: (reconnectExhausted) =>
        store.setState({ reconnectExhausted }),
    });
    const outgoingQueue = useOutgoingQueue(outgoingQueueMax);
    const livenessSession = useLiveness(liveness, () => wsRef.current);

    const setStatus = useCallback(
      (status: WsStatus) => {
        store.setState({ status });
      },
      [store],
    );

    const setPhase = useCallback(
      (phase: WsPhase) => {
        store.setState({ phase });
      },
      [store],
    );

    const getStatus = useCallback<WsContextValue["getStatus"]>(
      () => store.getState().status,
      [store],
    );

    const disconnect = useCallback<WsContextValue["disconnect"]>(() => {
      reconnect.cancel();
      livenessSession.stop();
      outgoingQueue.clear();
      setPhase("idle");
      const ws = wsRef.current;
      wsRef.current = null;
      if (ws) {
        detachAndClose(ws);
        setStatus("closed");
        emitter.emit("close", clientCloseEvent("client disconnect"));
      } else {
        setStatus("closed");
      }
    }, [setStatus, setPhase, emitter, outgoingQueue, livenessSession, reconnect]);

    const connect = useCallback<WsContextValue["connect"]>(() => {
      if (typeof window === "undefined") return;

      const fromReconnect = reconnect.onConnectBegin();
      livenessSession.stop();

      const prev = wsRef.current;
      if (prev) {
        wsRef.current = null;
        detachAndClose(prev);
        emitter.emit("close", clientCloseEvent("reconnect"));
      }

      setStatus("connecting");
      setPhase(fromReconnect ? "reconnecting" : "connecting");

      const ws = protocols ? new WebSocket(url, protocols) : new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = (event) => {
        if (wsRef.current !== ws) return;
        reconnect.onOpen();
        setStatus("open");
        setPhase("open");
        outgoingQueue.flush((data) => ws.send(data));
        livenessSession.start(ws);
        emitter.emit("open", event);
      };

      ws.onmessage = (event) => {
        if (wsRef.current !== ws) return;
        const data = parse(event.data);
        livenessSession.onMessage(data);
        emitter.emit("message", data, event);
      };

      ws.onerror = (event) => {
        if (wsRef.current !== ws) return;
        emitter.emit("error", event);
      };

      ws.onclose = (event) => {
        if (wsRef.current === ws) wsRef.current = null;
        livenessSession.stop();
        setStatus("closed");
        emitter.emit("close", event);
        const scheduled = reconnect.scheduleAfterClose();
        if (scheduled) {
          setPhase("reconnecting");
        } else if (store.getState().phase !== "idle") {
          setPhase("stopped");
        }
      };
    }, [setStatus, setPhase, emitter, outgoingQueue, livenessSession, reconnect, store]);

    reconnect.bindOnReconnect(connect);

    useEffect(() => {
      if (autoConnect) connect();
      return () => {
        reconnect.cancel();
        livenessSession.stop();
        outgoingQueue.clear();
        const ws = wsRef.current;
        wsRef.current = null;
        if (ws) {
          detachAndClose(ws);
          emitter.emit("close", clientCloseEvent("provider unmount"));
        }
      };
    }, [connect, emitter, outgoingQueue, livenessSession, reconnect]);

    const send = useCallback<WsContextValue["send"]>(
      (data) => {
        const ws = wsRef.current;
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(data);
          return true;
        }
        return outgoingQueue.enqueue(data);
      },
      [outgoingQueue],
    );

    const sendJson = useCallback<WsContextValue["sendJson"]>(
      (data) => send(JSON.stringify(data)),
      [send],
    );

    const actions = useMemo<WsContextValue>(
      () => ({
        send,
        sendJson,
        connect,
        disconnect,
        getStatus,
      }),
      [send, sendJson, connect, disconnect, getStatus],
    );

    return (
      <ActionsCtx.Provider value={actions}>
        <StoreCtx.Provider value={store}>
          <EmitterCtx.Provider value={emitter}>{children}</EmitterCtx.Provider>
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
