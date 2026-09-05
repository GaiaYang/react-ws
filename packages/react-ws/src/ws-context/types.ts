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
   * 非主動斷線後，第一次自動重連要等多久（毫秒）。
   *
   * `0` 表示不自動重連。之後每次的等待預設會逐次加倍並隨機錯開，見 `reconnectBackoff`。
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
   * 每重連一次，下次要等的時間放大幾倍。
   *
   * 預設 `2` 表示等待逐次加倍，讓 server 有時間恢復：`reconnectMs: 1000` 時依序等 1、2、4、8 秒。
   * 設 `1` 則每次都等 `reconnectMs`（固定間隔）；小於 `1` 會夾回 `1`。
   *
   * 成長的天花板用 `reconnectDelayMaxMs` 控制。
   *
   * @default 2
   */
  reconnectBackoff?: number;
  /**
   * 單次重連最多等多久（毫秒）。
   *
   * 等待再怎麼放大都不會超過這個值，抖動後也不會，預設 30 秒表示等到 30 秒就不再往上長。
   *
   * `0` 表示不設天花板：搭配 `reconnectBackoff > 1` 時等待會一路加倍，通常不建議。
   *
   * @default 30000
   */
  reconnectDelayMaxMs?: number;
  /**
   * 把每個 client 的等待時間隨機錯開的幅度，取值 `[0, 1]`（超出會夾回）。
   *
   * 預設 `0.2` 表示實際只等預定時間的 80% 到 100%（預定 10 秒 → 隨機等 8 到 10 秒），
   * 避免 server 重啟後所有 client 在同一瞬間湧入。
   *
   * 要錯得更開就調高，`1` 是完全隨機（0 到預定時間之間）；`0` 則每次都等足預定時間。
   *
   * @default 0.2
   */
  reconnectJitter?: number;
  /**
   * 連線要撐多久（毫秒）才算真的連上。
   *
   * 撐過這段時間才會把 `reconnectAttempt`、`reconnectExhausted` 歸零，下次斷線也才從
   * `reconnectMs` 重新開始等。
   *
   * 預設 5 秒是為了應付 server 收下連線後立刻又斷開的情況：設 `0` 會讓每個短命連線都清掉
   * 重連進度，等待永遠停在最短的第一階，`reconnectMax` 也永遠算不完。
   *
   * @default 5000
   */
  reconnectMinUptimeMs?: number;
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
