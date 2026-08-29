import type { LivenessOptions } from "./liveness/types";
import type { WsStatus } from "./ws-store";

/** `createWsContext` 連線設定；建立時固定 */
export interface CreateWsContextOptions {
  /** 連線 URL */
  url: string;
  /** 連線協定 */
  protocols?: string | string[];
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
  /** 連線錯誤 */
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
  /** 建立連線 */
  connect: () => void;
  /** 主動斷開連線 */
  disconnect: () => void;
  /** 讀取當下 `status`；不訂閱、不觸發渲染 */
  getStatus: () => WsStatus;
}
