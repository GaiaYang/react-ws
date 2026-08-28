import type { LivenessOptions } from "./liveness/types";
import type { WsStatus } from "./ws-store";

/** `createWsContext` 連線設定；建立時固定 */
export interface CreateWsContextOptions {
  /** 連線 URL */
  url: string;
  /** 連線協定 */
  protocols?: string | string[];
  /**
   * 是否自動重新連線。
   *
   *  @default true
   */
  autoConnect?: boolean;
  /**
   * 自動重連間隔（ms）；`0` 不重連。
   *
   * @default 0
   */
  reconnectMs?: number;
  /**
   * 非主動斷線後最多自動重連幾次（不含首次 `autoConnect`）。
   * `reconnectAttempt` 於成功 `open`、手動 `connect()` 或 `disconnect()` 歸零。
   *
   * `0` 不限制（只要 `reconnectMs > 0`）。
   *
   * @default 0
   */
  reconnectMax?: number;
  /**
   * 未連線時發送訊息的佇列上限；`0` 關閉。
   *
   * @default 0
   */
  outgoingQueueMax?: number;
  /**
   * 資料解析函數。
   *
   * 預設處理方式：如果資料為字串，嘗試 `JSON.parse`，否則原樣返回。
   */
  parse?: (data: MessageEvent["data"]) => unknown;
  /** 探活 */
  liveness?: LivenessOptions;
}

export interface WsEvents {
  /**
   * 收到訊息
   *
   * @param data 訊息內容，已經過 `parse` 處理
   * @param event 原始事件物件
   */
  message: (data: unknown, event: MessageEvent) => void;
  /** 連線建立 */
  open: (event: Event) => void;
  /** 發生錯誤 */
  error: (event: Event) => void;
  /** 連線斷開 */
  close: (event: CloseEvent) => void;
}

/** 連線操作 API；可訂閱的連線層 state（健康／佇列／重連）請用 `useWsStore` */
export interface WsContextValue {
  /**
   * 傳送訊息
   *
   * @param data 訊息內容
   * @returns 是否已送出或已入隊
   */
  send: (data: Parameters<WebSocket["send"]>[0]) => boolean;
  /**
   * 傳送 JSON 資料
   *
   * @param data 資料
   * @returns 是否已送出或已入隊
   */
  sendJson: (data: unknown) => boolean;
  /** 建立連線 */
  connect: () => void;
  /** 斷開連線 */
  disconnect: () => void;
  /** 讀取當下 `status`；不訂閱 store、不觸發渲染 */
  getStatus: () => WsStatus;
}
