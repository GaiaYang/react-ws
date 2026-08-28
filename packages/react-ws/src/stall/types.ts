import type { STALL_ACK_TYPE, STALL_MESSAGE_TYPE } from "./constants";

/**
 * 停滯控制
 *
 * - `stall` 進入停滯
 * - `release` 恢復正常
 */
export type StallAction = "stall" | "release";

/** 客戶端經 WebSocket 送出的停滯控制訊息 */
export interface StallMessage {
  type: typeof STALL_MESSAGE_TYPE;
  /** 控制動作 */
  action: StallAction;
}

/** 伺服器回覆的停滯狀態確認 */
export interface StallAck {
  type: typeof STALL_ACK_TYPE;
  /** 本次 ack 對應的控制動作 */
  action: StallAction;
  /** 回覆當下是否處於停滯中 */
  active: boolean;
}
