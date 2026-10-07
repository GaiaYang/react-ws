import { createEmitter, type Emitter } from "./emitter";
import { livenessDelaysOk } from "./liveness/controller";
import { resolveLiveness } from "./liveness/liveness";
import type { LivenessOptions } from "./liveness/types";
import { resolveMaybeGetter, type MaybeGetter } from "./maybe-getter";
import {
  createReconnect,
  resolveReconnectOptions,
  type ReconnectOptions,
} from "./reconnect";
import {
  MAX_TIMEOUT_MS,
  READY_CONNECTING,
  READY_OPEN,
  clientCloseEvent,
  detachAndClose,
  stringifyJson,
} from "./socket";
import { createWsStore, type WsState, type WsStoreApi } from "./ws-state";

/** 連線設定 */
export interface WsSessionOptions extends ReconnectOptions {
  /**
   * WebSocket URL
   *
   * 同步 getter 會在每次 `connect()` 開始時呼叫。
   *
   * getter 必須同步執行，不可 `await`，也不可呼叫 hooks。
   *
   * 若 getter 同步呼叫 `disconnect()` 或 `connect()`，以那次呼叫為準，外層這次 `connect()` 不會再蓋掉它。
   *
   * 空字串視為建立失敗：觸發 `"failure"`，保留既有連線，`connect()` 本身不會 throw。
   */
  url: MaybeGetter<string>;
  /**
   * 傳入 `new WebSocket(url, protocols)`
   *
   * 未設定時不傳入第二個參數。
   *
   * getter 回傳空字串時會原樣傳入，不會改成省略。
   */
  protocols?: MaybeGetter<string | string[]>;
  /**
   * 將原始 `MessageEvent.data` 轉換為應用程式資料
   *
   * 擲出例外時觸發 `"failure"`，不會觸發 `"message"`，也不會關閉 WebSocket。
   *
   * 預設會把字串交給 `JSON.parse`。
   *
   * 解析失敗時回傳原始字串，非字串資料則原樣回傳。
   */
  parse?: (data: MessageEvent["data"]) => unknown;
  /**
   * 應用層心跳機制
   *
   * 未設定時不會啟用。
   *
   * @default undefined
   */
  liveness?: LivenessOptions;
  /**
   * 握手停在 `CONNECTING` 超過這個時間（毫秒）就關閉
   *
   * reason 為 `"connect timeout"`，之後與其他非主動斷線走同一條關閉路徑。
   *
   * `0`、非有限數、負數都代表關閉，與 `reconnectMs` 的 `0` 相同。
   *
   * @default 0
   */
  connectTimeoutMs?: number;
}

/** 事件名稱與回呼的對應型別 */
export interface WsEvents {
  /**
   * 收到訊息
   *
   * @param parsed 經過 `parse` 處理後的資料。`parse` 擲出時觸發 `"failure"`，不會觸發 `"message"`，也不會關閉 WebSocket。`parse` 或 `isPong` 若同步 `disconnect()` 或 `connect()`，這顆 socket 已不是現役時不會再觸發 `"message"`。斷線後沒有新 socket 接手時，接著擲出仍會觸發 `"failure"`。`parse` 在 `connect()` 已換線之後的擲出，不會算到新 socket 的 `"failure"`。`isPong` 擲出一律觸發 `"failure"`，`source` 為 `"isPong"`。
   * @param event 這次的 `MessageEvent`。
   */
  message: (parsed: unknown, event: MessageEvent) => void;
  /** 原生 WebSocket 的 `"open"`，原樣轉發 `ws.onopen` 的 `Event`。 */
  open: (event: Event) => void;
  /** 原生 WebSocket 的 `"error"`，原樣轉發 `ws.onerror` 的 `Event`。 */
  error: (event: Event) => void;
  /**
   * WebSocket 連線關閉
   *
   * `disconnect()`、Provider 卸載，以及成功替換舊連線時也會觸發。
   */
  close: (event: CloseEvent) => void;
  /**
   * 不是 socket 事件的失敗。`cause` 是擲出的值（或套件建立的 `Error`）。
   *
   * - `"construct"`：空 URL、`url`／`protocols` 取值失敗、`new WebSocket()` 失敗，或沒有 `WebSocket`。
   *   - 空 URL 的 `cause` 是 `Error`，其 `message` 為 `"empty url"`。
   *   - 沒有 `WebSocket` 的 `cause` 是 `Error`，其 `message` 為 `"WebSocket is undefined"`。
   * - `"parse"`：`parse` 擲出。
   * - `"isPong"`：`isPong` 擲出。
   * - `"liveness"`：`intervalMs`／`timeoutMs` 無效。`cause` 是 `Error`，其 `message` 為 `"invalid liveness"`。
   * - `"ping"`：`ping` 擲出，或這次 ping 的 `WebSocket.send` 擲出。該次不會送出，等待仍會開始。同步 `disconnect()` 或 `connect()` 之後的擲出仍會觸發。
   */
  failure: (detail: {
    source: "construct" | "parse" | "isPong" | "liveness" | "ping";
    cause: unknown;
  }) => void;
}

export type WsEventsEmitter = Emitter<WsEvents>;

/** WebSocket 操作 */
export interface WsActions {
  /**
   * WebSocket 已連線時送出資料
   *
   * 已連線時回傳 `true`。
   *
   * 尚未連線時回傳 `false`，不會暫存。
   *
   * 已連線時若 `WebSocket.send` 擲出例外，例外會往外拋出。
   *
   * @returns 已送出為 `true`；尚未連線為 `false`。
   */
  send: (data: Parameters<WebSocket["send"]>[0]) => boolean;
  /**
   * 先用 `JSON.stringify` 序列化，再呼叫 `send`
   *
   * 無法序列化時回傳 `false`，序列化成功後的傳送行為與 `send` 相同。
   */
  sendJson: (data: unknown) => boolean;
  /**
   * 取得設定後建立 WebSocket
   *
   * 新的 WebSocket 建構成功後才關閉舊連線，這個方法不會 throw。
   *
   * URL 為空、getter 擲出，或 `new WebSocket()` 失敗時，觸發 `"failure"`，並保留既有連線。
   *
   * 若這次呼叫來自已觸發的自動重連計時器，這次嘗試算失敗，並沿用自動重連的排程。
   *
   * 未達 `reconnectMax` 時 `phase` 維持 `reconnecting`。`reconnectMax` 為 `0` 時會一直排。
   *
   * 已達 `reconnectMax` 時狀態變成 `status: "closed"`、`phase: "stopped"`，且 `reconnectExhausted` 為 `true`。
   *
   * 若仍在等待自動重連計時器，會取消目前的等待，並以同一個 `reconnectAttempt` 重新排程。
   *
   * 提前呼叫 `connect()` 失敗後，這一輪自動重連仍會繼續，且不計入 `reconnectMax`。
   *
   * 沒有 `WebSocket` 時不沿用上面的排程：沒有現役 socket 就變成 `phase: "stopped"`，不再排下一次。已有 socket 則維持不變。
   */
  connect: () => void;
  /**
   * 主動關閉 WebSocket，不會觸發自動重連
   *
   * 狀態變成 `phase: "idle"`、`status: "closed"`。
   */
  disconnect: () => void;
  /** 取得呼叫當下的連線狀態，不會建立訂閱。 */
  getState: () => WsState;
}

export interface WsSession extends WsActions {
  store: WsStoreApi;
  emitter: WsEventsEmitter;
  /** `disconnect` 與 Provider 卸載共用，避免兩處漏清 timer */
  teardown: (reason: string) => void;
  /** Provider 的 effect 再次掛上時呼叫，卸載期間的 `connect()` 才會恢復 */
  attach: () => void;
}

function defaultParse(data: MessageEvent["data"]): unknown {
  if (typeof data !== "string") return data;
  try {
    return JSON.parse(data) as unknown;
  } catch {
    return data;
  }
}

/** 非有限數、負數、`0` 都關閉。超過平台上限會溢位成立刻觸發，夾回上限 */
function resolveConnectTimeoutMs(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return 0;
  }
  return Math.min(value, MAX_TIMEOUT_MS);
}

/**
 * 純 JS 連線 session，擁有一條 WebSocket 的生命週期
 *
 * React 或其他框架只負責建立、掛載時 `connect`、卸載時 `teardown`。
 */
export function createWsSession(options: WsSessionOptions): WsSession {
  const {
    url,
    protocols,
    parse = defaultParse,
    liveness: livenessOptions,
    connectTimeoutMs: connectTimeoutOption,
  } = options;
  const connectTimeoutMs = resolveConnectTimeoutMs(connectTimeoutOption);

  const store = createWsStore();
  const emitter = createEmitter<WsEvents>();
  const reconnect = createReconnect(
    resolveReconnectOptions(options),
    store.setState,
  );

  let wsCurrent: WebSocket | null = null;
  let connectGeneration = 0;
  /** 只有 Provider 卸載會關掉。`disconnect()` 之後仍可再 `connect()` */
  let providerAttached = true;
  let connectTimer: ReturnType<typeof setTimeout> | null = null;

  function settleClose(ws: WebSocket, event: CloseEvent): void {
    if (wsCurrent !== ws) return;
    clearConnectTimer();
    wsCurrent = null;
    liveness.stop();
    detachAndClose(ws);
    const scheduled = reconnect.scheduleAfterClose();
    // teardown 已是 idle；勿蓋成 stopped，否則刻意斷線像放棄重連
    store.setState((state) => ({
      status: "closed",
      phase: scheduled
        ? "reconnecting"
        : state.phase === "idle"
          ? "idle"
          : "stopped",
    }));
    emitter.emit("close", event);
  }

  const liveness = resolveLiveness(
    livenessOptions,
    (socket) => {
      if (wsCurrent !== socket) {
        detachAndClose(socket);
        return;
      }
      settleClose(socket, clientCloseEvent("liveness timeout", 1006, false));
    },
    (cause) => {
      // ping 不是 socket 事件。斷線或換線之後仍要讓開發者看到
      emitter.emit("failure", { source: "ping", cause });
    },
  );

  function clearConnectTimer(): void {
    if (connectTimer != null) {
      clearTimeout(connectTimer);
      connectTimer = null;
    }
  }

  function armConnectTimer(ws: WebSocket): void {
    clearConnectTimer();
    if (connectTimeoutMs <= 0 || ws.readyState !== READY_CONNECTING) return;
    connectTimer = setTimeout(() => {
      connectTimer = null;
      settleClose(ws, clientCloseEvent("connect timeout", 1006, false));
    }, connectTimeoutMs);
  }

  function attach(): void {
    providerAttached = true;
  }

  function teardown(reason: string): void {
    if (reason === "provider unmount") providerAttached = false;
    connectGeneration += 1;
    clearConnectTimer();
    reconnect.cancel();
    liveness.stop();
    const ws = wsCurrent;
    wsCurrent = null;
    // 還沒連過就寫成 closed，StrictMode 的假卸載會把仍掛著的 session 看成主動斷線
    if (ws || store.getState().phase !== "idle") {
      store.setState({ phase: "idle", status: "closed" });
    }
    if (ws) {
      detachAndClose(ws);
      emitter.emit("close", clientCloseEvent(reason));
    }
  }

  function disconnect(): void {
    teardown("client disconnect");
    if (store.getState().status === "idle") {
      store.setState({ phase: "idle", status: "closed" });
    }
  }

  function connect(): void {
    if (!providerAttached) return;
    const socketAtStart = wsCurrent;
    // 建構失敗不會走到 onConnectBegin，次數仍要在這裡歸零
    reconnect.prepareManualConnect();
    if (typeof globalThis.WebSocket === "undefined") {
      // 外層 connect 還在 getter 裡。不推進的話，外層會再把留下的舊線換掉。
      connectGeneration += 1;
      const fired = reconnect.clearTimerTrigger();
      const detail = {
        source: "construct" as const,
        cause: new Error("WebSocket is undefined"),
      };
      // 現役 socket 還在就留著。沒有的話不能停在 idle，否則和「還沒 connect」一樣。
      if (wsCurrent != null && !fired) {
        emitter.emit("failure", detail);
        return;
      }
      // 沒有 WebSocket 就不要再排。只清掉還在等的那次。
      // 換線 close 回呼裡呼叫時，onConnectBegin 已把 nextReconnectAt 歸零，不能 cancel()，
      // 否則外層留下的 socket 之後不會再重連。
      if (!fired && store.getState().nextReconnectAt > 0) {
        reconnect.cancel();
      }
      store.setState({ status: "closed", phase: "stopped" });
      emitter.emit("failure", detail);
      return;
    }

    const generation = ++connectGeneration;
    let resolvedUrl: string;
    let resolvedProtocols: string | string[] | undefined;
    let ws: WebSocket;
    // 建構失敗保留舊線與 store（與 getter 失敗同一路）
    try {
      resolvedUrl = resolveMaybeGetter(url);
      if (resolvedUrl === "") throw new Error("empty url");
      // getter 裡的 connect 已接管。這裡再 new WebSocket 會多開一條立刻關掉的線。
      if (generation !== connectGeneration) return;
      if (protocols !== undefined) {
        resolvedProtocols = resolveMaybeGetter(protocols);
      }
      if (generation !== connectGeneration) return;
      ws =
        resolvedProtocols == null
          ? new WebSocket(resolvedUrl)
          : new WebSocket(resolvedUrl, resolvedProtocols);
    } catch (cause) {
      // getter 裡的 disconnect／connect 已經收斂，外層不可再改 store。
      // 新 socket 已接手時，這次失敗不能算到它頭上。
      // 舊線還在，或斷線後沒有接手者，失敗仍要送出。
      if (generation !== connectGeneration) {
        if (wsCurrent == null || wsCurrent === socketAtStart) {
          emitter.emit("failure", { source: "construct", cause });
        }
        return;
      }
      // 先 store 再 emit，避免 handler 擲出／disconnect 讓這次排程沒寫進去
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
      emitter.emit("failure", { source: "construct", cause });
      return;
    }

    if (generation !== connectGeneration) {
      detachAndClose(ws);
      return;
    }

    const fromReconnect = reconnect.onConnectBegin();
    liveness.stop();

    const prev = wsCurrent;
    if (prev) {
      clearConnectTimer();
      wsCurrent = null;
      detachAndClose(prev);
      // 舊線已死。status 先離開 open，close 回呼才不會用 status === "open" 去送。
      // phase 用這次嘗試自己的：手動是 connecting，已觸發的自動重連維持 reconnecting。
      store.setState({
        status: "closed",
        phase: fromReconnect ? "reconnecting" : "connecting",
      });
      emitter.emit("close", clientCloseEvent("reconnect"));
    }

    // disconnect 或已接上的 connect 才算接管。建構失敗沒有 socket，這顆要留著。
    if (
      generation !== connectGeneration &&
      (wsCurrent != null || store.getState().phase === "idle")
    ) {
      detachAndClose(ws);
      return;
    }

    store.setState({
      status: "connecting",
      phase: fromReconnect ? "reconnecting" : "connecting",
    });
    wsCurrent = ws;
    armConnectTimer(ws);

    ws.onopen = (event) => {
      if (wsCurrent !== ws) return;
      clearConnectTimer();
      reconnect.onOpen();
      store.setState({ status: "open", phase: "open" });
      // 已經 open 的這顆先通知，第一個 ping 不得早於訂閱者
      emitter.emit("open", event);
      // 新 socket 已接手時，這次 liveness 失敗不能算到它頭上。
      // 斷線後沒有接手者，無效 liveness 仍要送出，且不能啟動心跳。
      if (wsCurrent !== ws && wsCurrent != null) return;
      if (
        livenessOptions &&
        !livenessDelaysOk(livenessOptions.intervalMs, livenessOptions.timeoutMs)
      ) {
        emitter.emit("failure", {
          source: "liveness",
          cause: new Error("invalid liveness"),
        });
        return;
      }
      if (wsCurrent !== ws) return;
      liveness.start(ws);
    };

    ws.onmessage = (event) => {
      if (wsCurrent !== ws) return;
      let data: unknown;
      try {
        data = parse(event.data);
      } catch (cause) {
        // 新 socket 已接手時，這顆舊訊息的失敗不能算到它頭上。
        // 斷線後沒有接手者，parse 的失敗仍要送出去。
        if (wsCurrent !== ws && wsCurrent != null) return;
        emitter.emit("failure", { source: "parse", cause });
        return;
      }
      // parse 可能已斷線或換線，舊訊息不能再送
      if (wsCurrent !== ws) return;
      try {
        liveness.onMessage(data);
      } catch (cause) {
        // isPong 不是 socket 事件，換線之後也要讓開發者看到
        emitter.emit("failure", { source: "isPong", cause });
      }
      if (wsCurrent !== ws) return;
      emitter.emit("message", data, event);
    };

    ws.onerror = (event) => {
      if (wsCurrent !== ws) return;
      emitter.emit("error", event);
    };

    ws.onclose = (event) => {
      settleClose(ws, event);
    };
  }

  reconnect.bindOnReconnect(connect);

  function send(data: Parameters<WebSocket["send"]>[0]): boolean {
    const ws = wsCurrent;
    if (ws && ws.readyState === READY_OPEN) {
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
    getState: store.getState,
    teardown,
    attach,
  };
}
