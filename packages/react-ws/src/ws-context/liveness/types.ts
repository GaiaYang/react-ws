/**
 * 探活設定；省略 `liveness` 則不啟用。
 *
 * ping 以 `JSON.stringify` 直接寫入 socket（非 WebSocket 控制幀，也不經待送佇列）。
 */
export interface LivenessOptions {
  /** ping 間隔（毫秒） */
  intervalMs: number;
  /** 等待 pong 逾時（毫秒） */
  timeoutMs: number;
  /** ping 內容；函式則每次動態產生（一律 JSON） */
  ping: unknown | (() => unknown);
  /**
   * 判定傳入資料是否為 pong。
   *
   * 符合則清除逾時計時；該筆仍會觸發 `"message"`。
   *
   * 擲出視為不是 pong（不清逾時），該筆仍發 `"message"`。
   */
  isPong: (data: unknown) => boolean;
}
