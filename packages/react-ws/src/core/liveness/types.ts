import type { MaybeGetter } from "../maybe-getter";

/**
 * `liveness` 的設定。
 *
 * 要送出的內容由應用程式準備，套件不會呼叫 `JSON.stringify`。
 */
export interface LivenessOptions {
  /** Ping 的發送間隔（毫秒）。 */
  intervalMs: number;
  /** 等待 Pong 的時間（毫秒）。 */
  timeoutMs: number;
  /** 要送出的 Ping。若為函式，每次送出前都會呼叫。 */
  ping: MaybeGetter<Parameters<WebSocket["send"]>[0]>;
  /**
   * 判斷 `parse` 後的資料是否為 Pong。只有回傳 `true` 才視為 Pong，並結束這次等待。
   *
   * 擲出例外時視為不是 Pong，該則訊息仍會觸發 `"message"`。
   */
  isPong: (data: unknown) => boolean;
}
