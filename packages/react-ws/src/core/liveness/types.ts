import type { MaybeGetter } from "../types";

/**
 * 應用層心跳（非 WebSocket 控制幀）。
 *
 * 省略則不啟用。ping 內容由呼叫端自行準備，套件不序列化。
 */
export interface LivenessOptions {
  /** ping 間隔（毫秒） */
  intervalMs: number;
  /** 等待 pong 逾時（毫秒） */
  timeoutMs: number;
  /** 要送出的 ping；函式則每次呼叫。 */
  ping: MaybeGetter<Parameters<WebSocket["send"]>[0]>;
  /**
   * 判定 parse 後是否為 pong。符合則清逾時。
   *
   * 擲出視為不是 pong；該筆仍發 `"message"`。
   */
  isPong: (data: unknown) => boolean;
}
