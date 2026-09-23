import { createEmitter, type Emitter } from "./emitter";
import { resolveLiveness } from "./liveness/liveness";
import { createReconnect, type ReconnectOptions } from "./reconnect";
import { clientCloseEvent, detachAndClose, stringifyJson } from "./socket";
import type {
  CreateWsContextOptions,
  MaybeGetter,
  WsContextValue,
  WsEvents,
} from "./types";
import { createWsStore, type WsStoreApi } from "./ws-state";

export type WsEventsEmitter = Emitter<WsEvents>;

export interface WsSession extends WsContextValue {
  store: WsStoreApi;
  emitter: WsEventsEmitter;
  /** `disconnect` 與宿主 unmount 共用，避免兩處漏清 timer */
  teardown: (reason: string) => void;
}

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

/**
 * 純 JS 連線 session：擁有一條 WebSocket 的生命週期。
 * React 或其他宿主只負責建立、掛載時 `connect`、卸載時 `teardown`。
 */
export function createWsSession(options: CreateWsContextOptions): WsSession {
  const {
    url,
    protocols,
    reconnectMs = 0,
    reconnectMax = 0,
    reconnectBackoff = 2,
    reconnectDelayMaxMs = 30_000,
    reconnectJitter = 0.2,
    reconnectMinUptimeMs = 5000,
    parse = defaultParse,
    liveness: livenessOptions,
  } = options;

  const store = createWsStore();
  const emitter = createEmitter<WsEvents>();
  const reconnectOptions: ReconnectOptions = {
    reconnectMs,
    reconnectMax,
    reconnectBackoff,
    reconnectDelayMaxMs,
    reconnectJitter,
    reconnectMinUptimeMs,
  };
  const reconnect = createReconnect(reconnectOptions, store.setState);
  const liveness = resolveLiveness(livenessOptions);

  let wsCurrent: WebSocket | null = null;
  let connectGeneration = 0;

  function getStatus(): ReturnType<WsContextValue["getStatus"]> {
    return store.getState().status;
  }

  function teardown(reason: string): void {
    connectGeneration += 1;
    reconnect.cancel();
    liveness.stop();
    store.setState({ phase: "idle", status: "closed" });
    const ws = wsCurrent;
    wsCurrent = null;
    if (ws) {
      detachAndClose(ws);
      emitSafe(emitter, "close", clientCloseEvent(reason));
    }
  }

  function disconnect(): void {
    teardown("client disconnect");
  }

  function connect(): void {
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
      const outcome = reconnect.onConstructFailure();
      if (outcome === "stopped") {
        store.setState({ status: "closed", phase: "stopped" });
      } else if (outcome === "reconnecting") {
        store.setState({ status: "closed", phase: "reconnecting" });
      }
      emitSafe(emitter, "error", { type: "error" } as Event);
      return;
    }

    const generation = ++connectGeneration;
    const fromReconnect = reconnect.onConnectBegin();
    liveness.stop();

    const prev = wsCurrent;
    if (prev) {
      wsCurrent = null;
      detachAndClose(prev);
      // close 仍屬舊線；若先 set connecting，handler 會當成新握手的 close
      emitSafe(emitter, "close", clientCloseEvent("reconnect"));
    }

    // close handler 可能已 disconnect／再次 connect，這一輪 socket 不能再掛
    if (generation !== connectGeneration) {
      detachAndClose(ws);
      return;
    }

    store.setState({
      status: "connecting",
      phase: fromReconnect ? "reconnecting" : "connecting",
    });
    wsCurrent = ws;

    ws.onopen = (event) => {
      if (wsCurrent !== ws) return;
      reconnect.onOpen();
      store.setState({ status: "open", phase: "open" });
      liveness.start(ws);
      // ping 可能同步 disconnect／connect，這次握手已不是現役
      if (wsCurrent !== ws) return;
      emitSafe(emitter, "open", event);
    };

    ws.onmessage = (event) => {
      if (wsCurrent !== ws) return;
      let data: unknown;
      try {
        data = parse(event.data);
      } catch {
        emitSafe(emitter, "error", { type: "error" } as Event);
        return;
      }
      liveness.onMessage(data);
      emitSafe(emitter, "message", data, event);
    };

    ws.onerror = (event) => {
      if (wsCurrent !== ws) return;
      emitSafe(emitter, "error", event);
    };

    ws.onclose = (event) => {
      if (wsCurrent !== ws) return;
      wsCurrent = null;
      liveness.stop();
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
  }

  reconnect.bindOnReconnect(connect);

  function send(data: Parameters<WebSocket["send"]>[0]): boolean {
    const ws = wsCurrent;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(data);
      return true;
    }
    return false;
  }

  function sendJson(data: unknown): boolean {
    const json = stringifyJson(data);
    return json === null ? false : send(json);
  }

  return {
    store,
    emitter,
    send,
    sendJson,
    connect,
    disconnect,
    getStatus,
    teardown,
  };
}
