/** 探活設定 */
export interface LivenessOptions {
  /** ping 間隔（毫秒） */
  intervalMs: number;
  /** 等待 pong 逾時（毫秒） */
  timeoutMs: number;
  /** ping 內容；函式則每次動態產生 */
  ping: unknown | (() => unknown);
  /** 判定傳入資料是否為 pong */
  isPong: (data: unknown) => boolean;
}
