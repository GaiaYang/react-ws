/** 探活選項 */
export interface LivenessOptions {
  /** 探活間隔（ms） */
  intervalMs: number;
  /** 探活超時（ms） */
  timeoutMs: number;
  /** 探活訊息 */
  ping: unknown | (() => unknown);
  /** 探活回應判定 */
  isPong: (data: unknown) => boolean;
}
