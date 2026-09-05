import { useState } from "react";

/** `setTimeout` 延遲上限；超過會溢位成立即觸發 */
const MAX_TIMEOUT_MS = 2 ** 31 - 1;

/**
 * 重連排程設定；欄位語意見 `CreateWsContextOptions`。
 *
 * 退避相關欄位可省略，省略即為「固定間隔、無上限、不抖動、open 即歸零」；
 * 預設值由 `createWsContext` 決定，這一層不重複定義。
 */
export interface ReconnectOptions {
  reconnectMs: number;
  reconnectMax: number;
  reconnectBackoff?: number;
  reconnectDelayMaxMs?: number;
  reconnectJitter?: number;
  reconnectMinUptimeMs?: number;
}

/**
 * 第 `attempt` 次（1 起算）自動重連要等待的毫秒數。
 *
 * 順序刻意是「退避 → 套上限 → 向下抖動」：
 * - 先套上限再抖動，`reconnectDelayMaxMs` 才是真正的上限
 * - 抖動只往下扣，等待頂到上限後各 client 仍會錯開；若改成上下對稱再夾回上限，
 *   會有一半樣本剛好落在上限值上，抖動就失效了
 *
 * `reconnectJitter: 1` 時即 AWS 那篇退避文章的 full jitter。
 */
export function reconnectDelay(
  attempt: number,
  options: ReconnectOptions,
): number {
  const {
    reconnectMs,
    reconnectBackoff = 1,
    reconnectDelayMaxMs = 0,
    reconnectJitter = 0,
  } = options;

  // 倍率小於 1 會讓等待越重試越短，退避就失去意義
  const factor = Math.max(reconnectBackoff, 1);
  const backoff = reconnectMs * factor ** Math.max(attempt - 1, 0);
  const capped =
    reconnectDelayMaxMs > 0 ? Math.min(backoff, reconnectDelayMaxMs) : backoff;
  const jitter = Math.min(Math.max(reconnectJitter, 0), 1);
  // Math.random() 不含 1，倍率落在 (0, 1]，不必再夾負值
  const jittered = capped * (1 - Math.random() * jitter);
  // 未設上限時退避會一路放大到 Infinity，仍要壓回平台能用的延遲
  return Math.min(Math.round(jittered), MAX_TIMEOUT_MS);
}

export interface ReconnectCallbacks {
  /** 讀取 store 的 `reconnectAttempt` */
  getAttempt: () => number;
  /** 寫入 store 的 `reconnectAttempt` */
  setAttempt: (attempt: number) => void;
  /** 寫入 store 的 `reconnectExhausted` */
  setExhausted: (exhausted: boolean) => void;
}

export interface Reconnect {
  /**
   * 開始連線時呼叫；回傳 `true` 表示由重連計時器觸發。
   *
   * 非計時器觸發時歸零本輪 `reconnectAttempt`；計時器等待中或剛觸發則不歸零。
   */
  onConnectBegin: () => boolean;
  /**
   * 連線成功；歸零本輪重連計數。
   *
   * `reconnectMinUptimeMs > 0` 時改為排一個計時器，連線撐滿該時間才歸零。
   */
  onOpen: () => void;
  /** 意外斷線後嘗試重連；有排重連回 `true` */
  scheduleAfterClose: () => boolean;
  /**
   * 重連計時器已觸發、但本次 connect 未能開線時呼叫。
   *
   * 只清 `fromTimer`，不當作主動斷線、不歸零 `reconnectAttempt`。
   *
   * @returns 是否確為計時器已觸發（尚有待跑的 timer 則為 `false`）
   */
  clearTimerTrigger: () => boolean;
  /** 主動斷線或元件卸載：取消計時器並歸零本輪計數 */
  cancel: () => void;
  /** 設定重連時要執行的 connect */
  bindOnReconnect: (fn: () => void) => void;
}

export function createReconnect(
  options: ReconnectOptions,
  callbacks: ReconnectCallbacks,
): Reconnect {
  let intentionalClose = false;
  let fromTimer = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  /** minUptime 計時器：連線撐滿才歸零本輪計數，撐不滿就會被清掉 */
  let uptimeTimer: ReturnType<typeof setTimeout> | null = null;
  let onReconnect = () => {};

  const clearTimer = () => {
    if (timer != null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  const clearUptimeTimer = () => {
    if (uptimeTimer != null) {
      clearTimeout(uptimeTimer);
      uptimeTimer = null;
    }
  };

  const resetCycle = () => {
    if (callbacks.getAttempt() !== 0) callbacks.setAttempt(0);
    callbacks.setExhausted(false);
  };

  return {
    onConnectBegin() {
      clearTimer();
      clearUptimeTimer();
      intentionalClose = false;
      const reconnecting = fromTimer;
      if (!fromTimer) resetCycle();
      fromTimer = false;
      return reconnecting;
    },

    onOpen() {
      const minUptime = options.reconnectMinUptimeMs ?? 0;
      if (minUptime <= 0) {
        resetCycle();
        return;
      }
      // 上一輪的計時器已由 onConnectBegin 清掉，這裡直接接手
      uptimeTimer = setTimeout(
        () => {
          uptimeTimer = null;
          resetCycle();
        },
        Math.min(minUptime, MAX_TIMEOUT_MS),
      );
    },

    scheduleAfterClose() {
      // 連線沒撐滿 minUptime 就斷了，這次不算穩定：清掉待跑的歸零，讓退避沿用本輪計數
      clearUptimeTimer();
      if (intentionalClose || options.reconnectMs <= 0) return false;
      const attempt = callbacks.getAttempt();
      if (options.reconnectMax > 0 && attempt >= options.reconnectMax) {
        callbacks.setExhausted(true);
        return false;
      }
      const next = attempt + 1;
      callbacks.setAttempt(next);
      fromTimer = true;
      timer = setTimeout(
        () => {
          timer = null;
          onReconnect();
        },
        reconnectDelay(next, options),
      );
      return true;
    },

    clearTimerTrigger() {
      if (!fromTimer || timer != null) return false;
      fromTimer = false;
      return true;
    },

    cancel() {
      intentionalClose = true;
      clearTimer();
      clearUptimeTimer();
      resetCycle();
    },

    bindOnReconnect(fn) {
      onReconnect = fn;
    },
  };
}

export function useReconnect(
  options: ReconnectOptions,
  callbacks: ReconnectCallbacks,
): Reconnect {
  const [session] = useState(() => createReconnect(options, callbacks));
  return session;
}
