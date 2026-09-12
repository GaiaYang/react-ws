import type { LivenessOptions } from "./liveness/types";
import type { WsStatus } from "./ws-store";

/** 靜態值，或每次同步呼叫的 getter */
export type MaybeGetter<T> = T | (() => T);

/**
 * `createWsContext` 選項。建立後固定；`url`／`protocols` 若為 getter，每次 `connect()` 開頭同步取值。
 */
export interface CreateWsContextOptions {
  /** WebSocket URL。getter 須同步（不可 `await`、不可呼叫 hooks）。 */
  url: MaybeGetter<string>;
  /**
   * 傳給 `new WebSocket` 的第二參數；省略則不傳。
   *
   * getter 回傳空字串會原樣傳入，不會改成省略。
   */
  protocols?: MaybeGetter<string | string[]>;
  /**
   * `WsProvider` 掛載時是否自動連線。
   *
   * @default true
   */
  autoConnect?: boolean;
  /**
   * 非主動斷線後第一次重連等待（毫秒）。`0` 關閉重連。
   *
   * @default 0
   */
  reconnectMs?: number;
  /**
   * 自動重連次數上限。`0` 不限制（仍需 `reconnectMs > 0`）。
   *
   * @default 0
   */
  reconnectMax?: number;
  /**
   * 下次等待的倍率。`1` 固定間隔；小於 `1` 夾回 `1`。
   *
   * @default 2
   */
  reconnectBackoff?: number;
  /**
   * 單次等待硬上限（毫秒），含抖動。`0` 不設上限。
   *
   * @default 30000
   */
  reconnectDelayMaxMs?: number;
  /**
   * 將每次等待隨機縮短的幅度，取值 `[0, 1]`。`0` 不抖動；`1` 為 full jitter。
   *
   * @default 0.2
   */
  reconnectJitter?: number;
  /**
   * 連線需維持多久（毫秒）才歸零重連週期。`0` 表示 `open` 即歸零。
   *
   * 設 `0` 時，短命連線會讓退避與 `reconnectMax` 停在第一階。
   *
   * @default 5000
   */
  reconnectMinUptimeMs?: number;
  /**
   * 將 `MessageEvent.data` 轉成業務資料。
   *
   * 擲出時發 `"error"`，不發 `"message"`，不關線。
   *
   * @default 字串嘗試 JSON.parse（失敗則原樣）；非字串原樣回傳
   */
  parse?: (data: MessageEvent["data"]) => unknown;
  /** 應用層心跳。省略則不啟用。 */
  liveness?: LivenessOptions;
}

export interface WsEvents {
  /** `data` 為 `parse` 後結果 */
  message: (data: unknown, event: MessageEvent) => void;
  open: (event: Event) => void;
  /** 原生錯誤，或握手／取值／`parse` 失敗時的 `{ type: "error" }`（不是 `Error`） */
  error: (event: Event) => void;
  close: (event: CloseEvent) => void;
}

/** `useWsActions()` 回傳值。連線狀態請用 `useWsStore`。 */
export interface WsContextValue {
  /**
   * 僅在連線開啟時送出。未開啟回傳 `false`，不暫存。
   *
   * @returns 已送出為 `true`；未開啟為 `false`
   */
  send: (data: Parameters<WebSocket["send"]>[0]) => boolean;
  /** `JSON.stringify` 後呼叫 `send`。無法序列化時回傳 `false`。 */
  sendJson: (data: unknown) => boolean;
  /**
   * 取值後建構 socket；成功才關閉舊線。本身不 throw。
   *
   * 握手失敗發 `"error"` 並保留既有連線。
   *
   * 若來自已觸發的重連計時器：進入 `closed`／`stopped`，停止自動重試。
   */
  connect: () => void;
  /** 主動斷線；不自動重連。 */
  disconnect: () => void;
  /** 讀取當下 `status`，不訂閱。 */
  getStatus: () => WsStatus;
}
