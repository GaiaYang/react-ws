import type { MaybeGetter } from "../maybe-getter";

/** `liveness` 的設定 */
export interface LivenessOptions {
  /**
   * Ping 的發送間隔（毫秒）
   *
   * 必須是大於 `0` 的有限數。`0`、負數、非有限數不會啟動 liveness。
   */
  intervalMs: number;
  /**
   * 等待 Pong 的時間（毫秒）
   *
   * 必須是大於 `0` 的有限數。`0`、負數、非有限數不會啟動 liveness。
   */
  timeoutMs: number;
  /**
   * 要送出的 Ping
   *
   * 若為函式，每次送出前都會呼叫。
   */
  ping: MaybeGetter<Parameters<WebSocket["send"]>[0]>;
  /**
   * 判斷 `parse` 後的資料是否為 Pong
   *
   * 只有回傳 `true` 才視為 Pong，並結束這次等待。
   *
   * 擲出例外時視為不是 Pong，並觸發 `"failure"`，`source` 為 `"isPong"`。這顆 socket 仍是現役時，該則訊息仍會觸發 `"message"`。
   *
   * 同步 `disconnect()` 或 `connect()` 後，這顆 socket 已不是現役時不會再觸發 `"message"`。擲出仍會觸發 `"failure"`。
   */
  isPong: (data: unknown) => boolean;
}
