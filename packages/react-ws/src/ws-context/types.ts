import type { LivenessOptions } from "./liveness/types";
import type { WsStatus } from "./ws-store";

/** 值，或每次取值時同步呼叫的 getter */
export type MaybeGetter<T> = T | (() => T);

/**
 * `createWsContext` 連線設定。
 *
 * 策略（含 getter 本身）在 create 時固定；`url`／`protocols` 若為 getter，每次 `connect()` 開頭同步取值。
 */
export interface CreateWsContextOptions {
  /**
   * WebSocket URL。
   *
   * 可為字串或同步 getter。每次建立 socket 前同步呼叫；不要 `await`、不要在裡頭用 hook。
   *
   * 來源由呼叫端提供（例如 `localStorage`、store `getState()`）。
   */
  url: MaybeGetter<string>;
  /**
   * 連線協定。可為值或同步 getter；語意同 `url`。
   *
   * getter 回傳的空字串會原樣傳給 `new WebSocket`（第二參數），不會改成省略。
   */
  protocols?: MaybeGetter<string | string[]>;
  /**
   * 是否在 WsProvider 載入時自動連線。
   *
   * @default true
   */
  autoConnect?: boolean;
  /**
   * 非主動斷線後，自動重連的間隔（毫秒）。
   *
   * `0` 表示不重連。
   *
   * @default 0
   */
  reconnectMs?: number;
  /**
   * 非主動斷線後，最多自動重連幾次。
   *
   * `0` 表示不限制；需搭配 `reconnectMs > 0` 才會重連。
   *
   * @default 0
   */
  reconnectMax?: number;
  /**
   * 未連線時，待送訊息的佇列上限。
   *
   * `0` 表示關閉佇列。
   *
   * @default 0
   */
  outgoingQueueMax?: number;
  /**
   * 將原始 `MessageEvent.data` 轉成業務資料。
   *
   * 預設：字串嘗試 `JSON.parse`，失敗則原樣回傳；非字串原樣回傳。
   */
  parse?: (data: MessageEvent["data"]) => unknown;
  /** 探活設定；省略則不啟用 */
  liveness?: LivenessOptions;
}

export interface WsEvents {
  /**
   * 收到訊息
   *
   * @param data 經 `parse` 處理後的資料
   * @param event 原始 `MessageEvent`
   */
  message: (data: unknown, event: MessageEvent) => void;
  /** 連線建立 */
  open: (event: Event) => void;
  /** 原生 socket 或握手失敗 */
  error: (event: Event) => void;
  /** 連線關閉 */
  close: (event: CloseEvent) => void;
}

/** 連線操作 API；連線層 state 請用 `useWsStore` 訂閱 */
export interface WsContextValue {
  /**
   * 傳送原始資料。
   *
   * @returns `true` 表示已送出或已入隊；`false` 表示未送出
   */
  send: (data: Parameters<WebSocket["send"]>[0]) => boolean;
  /**
   * 以 JSON 傳送資料。
   *
   * @returns 同 `send`；無法序列化時為 `false`
   */
  sendJson: (data: unknown) => boolean;
  /**
   * 建立連線。每次會重新取值（`url`／`protocols`），先建新 socket，成功後才關閉舊連線。
   *
   * 取值失敗、網址為空、或網址不合法時會發出 `"error"`，既有連線不受影響；`connect()` 本身不會 throw。
   *
   * 若這次是自動重連已經開始（等待時間已到）才失敗：進入 `status: "closed"`、`phase: "stopped"`，不再自動重試。
   */
  connect: () => void;
  /** 主動斷線；不觸發自動重連，清空待送佇列 */
  disconnect: () => void;
  /** 讀取當下 `status`；不訂閱、不觸發渲染 */
  getStatus: () => WsStatus;
}
