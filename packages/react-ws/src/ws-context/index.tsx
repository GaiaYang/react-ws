import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  type PropsWithChildren,
} from "react";
import {
  createUseWsEvents,
  createWsEventsContext,
  useWsEventsApi,
} from "./ws-events";
import type { CreateWsContextOptions, WsContextValue } from "./types";
import { useLiveness } from "./liveness/liveness";
import { useOutgoingQueue } from "./outgoing-queue";
import {
  createUseWsStore,
  createWsStoreContext,
  useWsStoreApi,
  type WsPhase,
} from "./ws-store";
import { createUseWsActions, createWsActionsContext } from "./ws-actions";
import { useReconnect } from "./reconnect";
import { clientCloseEvent, detachAndClose } from "./socket";

export type { CreateWsContextOptions, WsContextValue, WsEvents } from "./types";
export type { LivenessOptions } from "./liveness/types";

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

  const StoreCtx = createWsStoreContext();
  const useWsStore = createUseWsStore(StoreCtx);
  const ActionsCtx = createWsActionsContext();
  const useWsActions = createUseWsActions(ActionsCtx);
  const EventsCtx = createWsEventsContext();
  const useWsEvents = createUseWsEvents(EventsCtx);

  function WsProvider({ children }: PropsWithChildren) {
    const wsRef = useRef<WebSocket | null>(null);
    const store = useWsStoreApi();
    const emitter = useWsEventsApi();
    const reconnect = useReconnect(reconnectMs, reconnectMax, {
      getAttempt: () => store.getState().reconnectAttempt,
      setAttempt: (reconnectAttempt) => store.setState({ reconnectAttempt }),
      setExhausted: (reconnectExhausted) =>
        store.setState({ reconnectExhausted }),
    });
    const outgoingQueue = useOutgoingQueue(outgoingQueueMax);
    const livenessSession = useLiveness(liveness, () => wsRef.current);

    const getStatus = useCallback<WsContextValue["getStatus"]>(
      () => store.getState().status,
      [store],
    );

    /**
     * 主動斷線與 Provider unmount 共用 cleanup。
     *
     * 關閉 socket 時以 `reason` 寫入 synthetic `close` 事件：
     * - `"client disconnect"` — `disconnect()`
     * - `"provider unmount"` — `WsProvider` unmount
     */
    const teardown = useCallback(
      (reason: string) => {
        reconnect.cancel();
        livenessSession.stop();
        outgoingQueue.clear();
        store.setState({ phase: "idle", status: "closed" });
        const ws = wsRef.current;
        wsRef.current = null;
        if (ws) {
          detachAndClose(ws);
          emitter.emit("close", clientCloseEvent(reason));
        }
      },
      [store, emitter, outgoingQueue, livenessSession, reconnect],
    );

    const disconnect = useCallback<WsContextValue["disconnect"]>(
      () => teardown("client disconnect"),
      [teardown],
    );

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

      store.setState({
        status: "connecting",
        phase: fromReconnect ? "reconnecting" : "connecting",
      });

      const ws = protocols ? new WebSocket(url, protocols) : new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = (event) => {
        if (wsRef.current !== ws) return;
        reconnect.onOpen();
        store.setState({ status: "open", phase: "open" });
        outgoingQueue.flush((data) => ws.send(data));
        livenessSession.start();
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
        const scheduled = reconnect.scheduleAfterClose();
        // 意外斷線：先更新 store，再 emit close（handler 可讀到一致的 status / phase）
        const patch: { status: "closed"; phase?: WsPhase } = {
          status: "closed",
        };
        if (scheduled) {
          patch.phase = "reconnecting";
        } else if (store.getState().phase !== "idle") {
          patch.phase = "stopped";
        }
        store.setState(patch);
        emitter.emit("close", event);
      };
    }, [store, emitter, outgoingQueue, livenessSession, reconnect]);

    reconnect.bindOnReconnect(connect);

    useEffect(() => {
      if (autoConnect) connect();
      return () => teardown("provider unmount");
    }, [connect, teardown]);

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
      (data) => {
        try {
          return send(JSON.stringify(data));
        } catch {
          return false;
        }
      },
      [send],
    );

    const actions = useMemo<WsContextValue>(
      () => ({ send, sendJson, connect, disconnect, getStatus }),
      [send, sendJson, connect, disconnect, getStatus],
    );

    return (
      <ActionsCtx.Provider value={actions}>
        <StoreCtx.Provider value={store}>
          <EventsCtx.Provider value={emitter}>{children}</EventsCtx.Provider>
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
