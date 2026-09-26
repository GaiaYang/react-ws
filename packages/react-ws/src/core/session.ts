import { createEmitter, type Emitter } from "./emitter";
import { resolveLiveness } from "./liveness/liveness";
import type { LivenessOptions } from "./liveness/types";
import { resolveMaybeGetter, type MaybeGetter } from "./maybe-getter";
import {
  createReconnect,
  resolveReconnectOptions,
  type ReconnectOptions,
} from "./reconnect";
import { clientCloseEvent, detachAndClose, stringifyJson } from "./socket";
import { createWsStore, type WsStatus, type WsStoreApi } from "./ws-state";

/** 連線設定。 */
export interface WsSessionOptions extends ReconnectOptions {
  /**
   * WebSocket URL。同步 getter 會在每次 `connect()` 開始時呼叫。
   *
   * getter 必須同步執行，不可 `await`，也不可呼叫 hooks。
   *
   * 空字串視為建立失敗：觸發 `"error"`，保留既有連線，`connect()` 本身不會 throw。
   */
  url: MaybeGetter<string>;
  /**
   * 傳入 `new WebSocket(url, protocols)`。
   *
   * 未設定時不傳入第二個參數。getter 回傳空字串時會原樣傳入，不會改成省略。
   */
  protocols?: MaybeGetter<string | string[]>;
  /**
   * 將原始 `MessageEvent.data` 轉換為應用程式資料。
   *
   * 擲出例外時觸發 `"error"`，不會觸發 `"message"`，也不會關閉 WebSocket。
   *
   * 預設會把字串交給 `JSON.parse`。解析失敗時回傳原始字串，非字串資料則原樣回傳。
   */
  parse?: (data: MessageEvent["data"]) => unknown;
  /**
   * 應用層心跳機制。未設定時不會啟用。
   *
   * @default undefined
   */
  liveness?: LivenessOptions;
}

/** 事件名稱與回呼的對應型別。 */
export interface WsEvents {
  /**
   * 收到訊息。
   *
   * @param parsed 經過 `parse` 處理後的資料。`parse` 擲出時觸發 `"error"`，不會觸發 `"message"`，也不會關閉 WebSocket。
   * @param event 這次的 `MessageEvent`。
   */
  message: (parsed: unknown, event: MessageEvent) => void;
  /** WebSocket 連線建立成功。 */
  open: (event: Event) => void;
  /**
   * WebSocket、握手、設定值取得或 `parse` 發生錯誤。
   *
   * 握手失敗、`url`／`protocols` 取值失敗，或 `parse` 擲出時，參數是 `{ type: "error" }`，不是 `Error`。原生 WebSocket 的 `"error"` 則傳入原本的事件。
   */
  error: (event: Event) => void;
  /**
   * WebSocket 連線關閉。
   *
   * `disconnect()`、Provider 卸載，以及成功替換舊連線時也會觸發。有 WebSocket 時才會收到。`reason` 分別是 `"client disconnect"`、`"provider unmount"`、`"reconnect"`。
   */
  close: (event: CloseEvent) => void;
}

export type WsEventsEmitter = Emitter<WsEvents>;

/** `useWsActions()` 的回傳型別。連線狀態請用 `useWsStore`。 */
export interface WsContextValue {
  /**
   * WebSocket 已連線時送出資料。
   *
   * 已連線時回傳 `true`。尚未連線時回傳 `false`，不會暫存。已連線時若 `WebSocket.send` 擲出例外，例外會往外拋出。
   *
   * @returns 已送出為 `true`；尚未連線為 `false`
   */
  send: (data: Parameters<WebSocket["send"]>[0]) => boolean;
  /**
   * 先用 `JSON.stringify` 序列化，再呼叫 `send`。
   *
   * 無法序列化時回傳 `false`。序列化成功後的傳送行為與 `send` 相同。
   */
  sendJson: (data: unknown) => boolean;
  /**
   * 取得設定後建立 WebSocket。新的 WebSocket 建構成功後，才關閉舊連線。
   *
   * 這個方法不會 throw。URL 為空、getter 擲出，或 `new WebSocket()` 失敗時，觸發 `"error"`，並保留既有連線。
   *
   * 若這次呼叫來自已觸發的自動重連計時器，會停止自動重連，狀態變成 `status: "closed"`、`phase: "stopped"`。
   *
   * 若仍在等待自動重連計時器，會取消目前的等待並重新排程。提前呼叫 `connect()` 失敗後，這一輪自動重連仍會繼續。
   */
  connect: () => void;
  /**
   * 主動關閉 WebSocket，不會觸發自動重連。
   *
   * 狀態變成 `phase: "idle"`、`status: "closed"`。
   */
  disconnect: () => void;
  /** 取得目前的 `status`，不會建立訂閱。 */
  getStatus: () => WsStatus;
}

export interface WsSession extends WsContextValue {
  store: WsStoreApi;
  emitter: WsEventsEmitter;
  /** `disconnect` 與 Provider 卸載共用，避免兩處漏清 timer */
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
 *
 * React 或其他框架只負責建立、掛載時 `connect`、卸載時 `teardown`。
 */
export function createWsSession(options: WsSessionOptions): WsSession {
  const {
    url,
    protocols,
    parse = defaultParse,
    liveness: livenessOptions,
  } = options;

  const store = createWsStore();
  const emitter = createEmitter<WsEvents>();
  const reconnect = createReconnect(
    resolveReconnectOptions(options),
    store.setState,
  );
  const liveness = resolveLiveness(livenessOptions);

  let wsCurrent: WebSocket | null = null;
  let connectGeneration = 0;

  function getStatus(): WsStatus {
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
      switch (outcome) {
        case "stopped":
          store.setState({ status: "closed", phase: "stopped" });
          break;
        case "reconnecting":
          store.setState({ status: "closed", phase: "reconnecting" });
          break;
        default:
          break;
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
