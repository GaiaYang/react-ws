/**
 * 應用層心跳（非 WebSocket 控制幀）。
 *
 * ping 以 JSON 直接寫入已開啟的 socket，不經待送佇列。
 */
export interface LivenessOptions {
  /** ping 間隔（毫秒） */
  intervalMs: number;
  /** 等待 pong 逾時（毫秒） */
  timeoutMs: number;
  /**
   * ping 內容；函式則每次呼叫。
   *
   * 無法 JSON 序列化時略過該次送出，仍開始等 pong；逾時一樣關線。
   */
  ping: unknown | (() => unknown);
  /**
   * 判定 parse 後資料是否為 pong。符合則清逾時；該筆仍發 `"message"`。
   *
   * 擲出視為不是 pong，該筆仍發 `"message"`。
   */
  isPong: (data: unknown) => boolean;
}
