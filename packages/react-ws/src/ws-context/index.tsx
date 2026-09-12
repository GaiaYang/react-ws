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
  type WsEventsEmitter,
} from "./ws-events";
import type {
  CreateWsContextOptions,
  MaybeGetter,
  WsContextValue,
  WsEvents,
} from "./types";
import { useLiveness } from "./liveness/liveness";
import {
  createUseWsStore,
  createWsStoreContext,
  useWsStoreApi,
} from "./ws-store";
import { createUseWsActions, createWsActionsContext } from "./ws-actions";
import { type ReconnectOptions, useReconnect } from "./reconnect";
import { clientCloseEvent, detachAndClose, stringifyJson } from "./socket";

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

/** handler 擲出不可打斷改用新 socket／liveness */
function emitSafe<E extends keyof WsEvents>(
  emitter: WsEventsEmitter,
  event: E,
  ...args: Parameters<WsEvents[E]>
): void {
  try {
    emitter.emit(event, ...args);
  } catch {
    void 0;
  }
}

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
    parse = defaultParse,
    liveness,
  } = options;

  const StoreCtx = createWsStoreContext();
  const useWsStore = createUseWsStore(StoreCtx);
  const ActionsCtx = createWsActionsContext();
  const useWsActions = createUseWsActions(ActionsCtx);
  const EventsCtx = createWsEventsContext();
  const useWsEvents = createUseWsEvents(EventsCtx);
  const reconnectOptions: ReconnectOptions = {
    reconnectMs,
    reconnectMax,
    reconnectBackoff,
    reconnectDelayMaxMs,
    reconnectJitter,
    reconnectMinUptimeMs,
  };

  function WsProvider({ children }: PropsWithChildren) {
    const wsRef = useRef<WebSocket | null>(null);
    const connectGenerationRef = useRef(0);
    const store = useWsStoreApi();
    const emitter = useWsEventsApi();
    const reconnect = useReconnect(reconnectOptions, store.setState);
    const livenessSession = useLiveness(liveness);

    const getStatus = useCallback<WsContextValue["getStatus"]>(
      () => store.getState().status,
      [store],
    );

    /** `disconnect` 與 unmount 共用，避免兩處漏清 timer */
    const teardown = useCallback(
      (reason: string) => {
        connectGenerationRef.current += 1;
        reconnect.cancel();
        livenessSession.stop();
        store.setState({ phase: "idle", status: "closed" });
        const ws = wsRef.current;
        wsRef.current = null;
        if (ws) {
          detachAndClose(ws);
          emitSafe(emitter, "close", clientCloseEvent(reason));
        }
      },
      [store, emitter, livenessSession, reconnect],
    );

    const disconnect = useCallback<WsContextValue["disconnect"]>(
      () => teardown("client disconnect"),
      [teardown],
    );

    const connect = useCallback<WsContextValue["connect"]>(() => {
      if (typeof globalThis.WebSocket === "undefined") {
        if (reconnect.clearTimerTrigger()) {
          store.setState({ status: "closed", phase: "stopped" });
        }
        return;
      }

      let resolvedUrl: string;
      let resolvedProtocols: string | string[] | undefined;
      let ws: WebSocket;
      // 建構失敗保留舊線與 store（與 getter 失敗同一路）
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
        // 先 store 再 emit，避免 handler 擲出／disconnect 卡住停重試
        if (reconnect.clearTimerTrigger()) {
          store.setState({ status: "closed", phase: "stopped" });
        }
        emitSafe(emitter, "error", { type: "error" } as Event);
        return;
      }

      const generation = ++connectGenerationRef.current;
      const fromReconnect = reconnect.onConnectBegin();
      livenessSession.stop();

      const prev = wsRef.current;
      if (prev) {
        wsRef.current = null;
        detachAndClose(prev);
        // close 仍屬舊線；若先 set connecting，handler 會當成新握手的 close
        emitSafe(emitter, "close", clientCloseEvent("reconnect"));
      }

      // close handler 可能已 disconnect／再次 connect，這一輪 socket 不能再掛
      if (generation !== connectGenerationRef.current) {
        detachAndClose(ws);
        return;
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
        livenessSession.start(ws);
        emitSafe(emitter, "open", event);
      };

      ws.onmessage = (event) => {
        if (wsRef.current !== ws) return;
        let data: unknown;
        try {
          data = parse(event.data);
        } catch {
          emitSafe(emitter, "error", { type: "error" } as Event);
          return;
        }
        livenessSession.onMessage(data);
        emitSafe(emitter, "message", data, event);
      };

      ws.onerror = (event) => {
        if (wsRef.current !== ws) return;
        emitSafe(emitter, "error", event);
      };

      ws.onclose = (event) => {
        if (wsRef.current !== ws) return;
        wsRef.current = null;
        livenessSession.stop();
        const scheduled = reconnect.scheduleAfterClose();
        store.setState((state) => ({
          status: "closed",
          // teardown 已是 idle；勿蓋成 stopped，否則刻意斷線像放棄重連
          phase: scheduled
            ? "reconnecting"
            : state.phase === "idle"
              ? "idle"
              : "stopped",
        }));
        emitSafe(emitter, "close", event);
      };
    }, [store, emitter, livenessSession, reconnect]);

    useEffect(() => {
      reconnect.bindOnReconnect(connect);
      if (autoConnect) connect();
      return () => teardown("provider unmount");
    }, [connect, teardown, reconnect]);

    const send = useCallback<WsContextValue["send"]>((data) => {
      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(data);
        return true;
      }
      return false;
    }, []);

    const sendJson = useCallback<WsContextValue["sendJson"]>(
      (data) => {
        const json = stringifyJson(data);
        return json === null ? false : send(json);
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
