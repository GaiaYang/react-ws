import type { LivenessOptions } from "./liveness/types";
import type { WsStatus } from "./ws-state";

/** 靜態值，或每次同步呼叫的 getter。 */
export type MaybeGetter<T> = T | (() => T);

/**
 * `createWsContext` 選項。
 *
 * 建立後固定。`url`／`protocols` 若為 getter，每次 `connect()` 開頭同步取值。
 */
export interface CreateWsContextOptions {
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
   * `WsProvider` 掛載時是否自動連線。
   *
   * @default true
   */
  autoConnect?: boolean;
  /**
   * 非主動斷線後，第一次重連等待（毫秒）。
   *
   * `0` 關閉重連。
   *
   * @default 0
   */
  reconnectMs?: number;
  /**
   * 自動重連次數上限。
   *
   * `0` 不限制（仍需 `reconnectMs > 0`）。
   *
   * @default 0
   */
  reconnectMax?: number;
  /**
   * 下次等待的倍率。
   *
   * `1` 固定間隔；小於 `1` 夾回 `1`。
   *
   * @default 2
   */
  reconnectBackoff?: number;
  /**
   * 單次等待硬上限（毫秒）。先套上限，再向下抖動。
   *
   * `0` 不設上限。
   *
   * @default 30000
   */
  reconnectDelayMaxMs?: number;
  /**
   * 將每次等待隨機縮短的幅度，取值 `[0, 1]`。
   *
   * `0` 不抖動；`1` 可把延遲縮到接近 0。
   *
   * @default 0.2
   */
  reconnectJitter?: number;
  /**
   * 連線需維持多久（毫秒）才歸零重連週期。
   *
   * `0` 表示 `open` 即歸零；短命連線下次重連仍從第一次等待起算，`reconnectMax` 也不易累加。
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
  /**
   * 應用層心跳（非 WebSocket 控制幀）。
   *
   * 省略則不啟用。需自備 `ping` 與 `isPong`；套件不序列化 ping。
   */
  liveness?: LivenessOptions;
}

/** `useWsEvents` 可訂閱的事件。 */
export interface WsEvents {
  /**
   * 收到訊息。
   *
   * @param parsed 為 `parse` 後結果。`parse` 擲出時改發 `"error"`，不關線。
   * @param event 原生訊息。
   */
  message: (parsed: unknown, event: MessageEvent) => void;
  /** 握手成功。 */
  open: (event: Event) => void;
  /**
   * 錯誤。
   *
   * 原生錯誤，或握手／取值／`parse` 失敗時的 `{ type: "error" }`（不是 `Error`）。
   */
  error: (event: Event) => void;
  /**
   * 關閉。
   *
   * 原生關閉，或客戶端 teardown／換線時的合成 `CloseEvent`。
   */
  close: (event: CloseEvent) => void;
}

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
