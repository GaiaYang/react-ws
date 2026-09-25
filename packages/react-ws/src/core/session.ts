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

/** 一條連線的選項 */
export interface WsSessionOptions extends ReconnectOptions {
  /**
   * WebSocket URL。
   *
   * getter 須同步（不可 `await`、不可呼叫 hooks）。
   *
   * 空字串視為建構失敗：發 `"error"`，保留既有連線，不 throw。
   */
  url: MaybeGetter<string>;
  /**
   * 傳給 `new WebSocket` 的第二參數。
   *
   * 省略則不傳。getter 回傳空字串會原樣傳入，不會改成省略。
   */
  protocols?: MaybeGetter<string | string[]>;
  /**
   * 將 `MessageEvent.data` 轉成業務資料。
   *
   * 擲出時發 `"error"`，不發 `"message"`，不關線。
   *
   * 預設行為：字串嘗試 `JSON.parse`；解析失敗或者非字串則原樣回傳
   */
  parse?: (data: MessageEvent["data"]) => unknown;
  /**
   * 應用層心跳選項，省略則不啟用。
   *
   * @default undefined
   */
  liveness?: LivenessOptions;
}

/** `useWsEvents` 可訂閱的事件。 */
export interface WsEvents {
  /**
   * 收到訊息。
   *
   * @param parsed `parse` 後的資料。`parse` 擲出時改發 `"error"`，不發 `"message"`，不關線。
   * @param event 這次的 `MessageEvent`。
   */
  message: (parsed: unknown, event: MessageEvent) => void;
  /** 連線建立。 */
  open: (event: Event) => void;
  /**
   * 連線錯誤。
   *
   * 來自 socket，或來自握手失敗、`url`／`protocols` 取值失敗、`parse` 擲出。後三者的參數是 `{ type: "error" }`，不是 `Error`。
   */
  error: (event: Event) => void;
  /**
   * 連線關閉。
   *
   * 也包含 `disconnect()`、Provider 卸載，以及成功換掉舊連線。有 socket 時才會收到；`reason` 分別是 `"client disconnect"`、`"provider unmount"`、`"reconnect"`。
   */
  close: (event: CloseEvent) => void;
}

export type WsEventsEmitter = Emitter<WsEvents>;

/** `useWsActions()` 回傳值。連線狀態請用 `useWsStore`。 */
export interface WsContextValue {
  /**
   * 僅在連線開啟時送出。
   *
   * 未開啟回傳 `false`，不暫存。已開啟時直接呼叫 `WebSocket.send`；其擲出不會改成 `false`，會往外傳。
   *
   * @returns 已送出為 `true`；未開啟為 `false`
   */
  send: (data: Parameters<WebSocket["send"]>[0]) => boolean;
  /**
   * `JSON.stringify` 後呼叫 `send`。
   *
   * 無法序列化時回傳 `false`。序列化成功後的送出行為同 `send`（含 `WebSocket.send` 擲出）。
   */
  sendJson: (data: unknown) => boolean;
  /**
   * 取值後建構 socket；成功才關閉舊線。
   *
   * 本身不 throw。握手失敗發 `"error"` 並保留既有連線。
   *
   * 握手失敗且重連計時器已觸發時：進入 `closed` 與 `stopped`，停止自動重試。
   *
   * 握手失敗且仍在等待重連時：取消該次倒數並再排下一次，提前試失敗仍繼續這一輪。
   */
  connect: () => void;
  /** 主動斷線；不自動重連。 */
  disconnect: () => void;
  /** 讀取當下 `status`，不訂閱。 */
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
