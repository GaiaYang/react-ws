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
import type {
  CreateWsContextOptions,
  MaybeGetter,
  WsContextValue,
} from "./types";
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

function defaultParse(data: MessageEvent["data"]): unknown {
  if (typeof data !== "string") return data;
  try {
    return JSON.parse(data) as unknown;
  } catch {
    return data;
  }
}

function resolveMaybeGetter<T>(value: MaybeGetter<T>): T {
  return typeof value === "function" ? (value as () => T)() : value;
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
    reconnectBackoff = 2,
    reconnectDelayMaxMs = 30_000,
    reconnectJitter = 0.2,
    reconnectMinUptimeMs = 5000,
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
    const reconnect = useReconnect(
      {
        reconnectMs,
        reconnectMax,
        reconnectBackoff,
        reconnectDelayMaxMs,
        reconnectJitter,
        reconnectMinUptimeMs,
      },
      {
        getAttempt: () => store.getState().reconnectAttempt,
        setAttempt: (reconnectAttempt) => store.setState({ reconnectAttempt }),
        setExhausted: (reconnectExhausted) =>
          store.setState({ reconnectExhausted }),
      },
    );
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

      let resolvedUrl: string;
      let resolvedProtocols: string | string[] | undefined;
      let ws: WebSocket;
      // 建構失敗必須保留舊線與 store（與 getter 失敗同一條路）
      try {
        resolvedUrl = resolveMaybeGetter(url);
        if (resolvedUrl === "") throw new Error("empty url");
        if (protocols !== undefined) {
          resolvedProtocols = resolveMaybeGetter(protocols);
        }
        ws =
          resolvedProtocols == null
            ? new WebSocket(resolvedUrl)
            : new WebSocket(resolvedUrl, resolvedProtocols);
      } catch {
        emitter.emit("error", new Event("error"));
        if (reconnect.clearTimerTrigger()) {
          store.setState({ status: "closed", phase: "stopped" });
        }
        return;
      }

      const fromReconnect = reconnect.onConnectBegin();
      livenessSession.stop();

      const prev = wsRef.current;
      if (prev) {
        wsRef.current = null;
        detachAndClose(prev);
        // close 仍屬舊線；若先 set connecting，handler 會把這次 close 當成新握手
        emitter.emit("close", clientCloseEvent("reconnect"));
      }

      store.setState({
        status: "connecting",
        phase: fromReconnect ? "reconnecting" : "connecting",
      });

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
        // 讓 close handler 讀到已更新的 status／phase
        const patch: { status: "closed"; phase?: WsPhase } = {
          status: "closed",
        };
        if (scheduled) {
          patch.phase = "reconnecting";
        } else if (store.getState().phase !== "idle") {
          // 主動 disconnect 已是 idle，不要蓋成 stopped
          patch.phase = "stopped";
        }
        store.setState(patch);
        emitter.emit("close", event);
      };
    }, [store, emitter, outgoingQueue, livenessSession, reconnect]);

    useEffect(() => {
      reconnect.bindOnReconnect(connect);
      if (autoConnect) connect();
      return () => teardown("provider unmount");
    }, [connect, teardown, reconnect]);

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
