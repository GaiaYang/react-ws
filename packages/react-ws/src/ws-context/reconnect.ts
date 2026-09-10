import { useState } from "react";

/** `setTimeout` 延遲上限；超過會溢位成立即觸發 */
const MAX_TIMEOUT_MS = 2 ** 31 - 1;

/**
 * 欄位語意見 `CreateWsContextOptions`。
 *
 * 退避相關欄位可省略；預設值由 `createWsContext` 決定，這一層不重複定義。
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
 * 順序刻意是「退避 → 套上限 → 向下抖動」：
 * - 先套上限再抖動，`reconnectDelayMaxMs` 才是真正的上限
 * - 抖動只往下扣，等待頂到上限後各 client 仍會錯開；若改成上下對稱再夾回上限，
 *   會有一半樣本剛好落在上限值上，抖動就失效了
 *
 * `reconnectJitter: 1` 時即 AWS Exponential Backoff And Jitter 的 full jitter：
 * https://aws.amazon.com/blogs/architecture/exponential-backoff-and-jitter/
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

/** 一次呼叫可帶多欄，避免拆成多次 `setState` 讓訂閱者看到半套狀態 */
export interface ReconnectPatch {
  reconnectAttempt?: number;
  reconnectExhausted?: boolean;
  nextReconnectAt?: number;
}

export interface Reconnect {
  /** 計時器觸發的那次不能歸零 attempt，否則退避從頭來 */
  onConnectBegin: () => boolean;
  onOpen: () => void;
  scheduleAfterClose: () => boolean;
  /** 只清 `fromTimer`：這次排程已消耗，但不是使用者主動放棄 */
  clearTimerTrigger: () => boolean;
  cancel: () => void;
  bindOnReconnect: (fn: () => void) => void;
}

export function createReconnect(
  options: ReconnectOptions,
  apply: (patch: ReconnectPatch) => void,
): Reconnect {
  let intentionalClose = false;
  let fromTimer = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  /** 撐不滿要在斷線時清掉，否則之後還是會把 attempt 歸零 */
  let uptimeTimer: ReturnType<typeof setTimeout> | null = null;
  let onReconnect = () => {};
  /** 本輪計數以這裡為準；store 是給訂閱者看的，不回讀以免拿到半套狀態 */
  let attempt = 0;

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
    attempt = 0;
    apply({ reconnectAttempt: 0, reconnectExhausted: false });
  };

  return {
    onConnectBegin() {
      clearTimer();
      clearUptimeTimer();
      intentionalClose = false;
      const reconnecting = fromTimer;
      fromTimer = false;
      if (reconnecting) {
        apply({ nextReconnectAt: 0 });
      } else {
        attempt = 0;
        apply({
          nextReconnectAt: 0,
          reconnectAttempt: 0,
          reconnectExhausted: false,
        });
      }
      return reconnecting;
    },

    onOpen() {
      const minUptime = options.reconnectMinUptimeMs ?? 0;
      if (minUptime <= 0) {
        resetCycle();
        return;
      }
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
      if (options.reconnectMax > 0 && attempt >= options.reconnectMax) {
        apply({ reconnectExhausted: true });
        return false;
      }
      attempt += 1;
      fromTimer = true;
      const delay = reconnectDelay(attempt, options);
      apply({
        reconnectAttempt: attempt,
        nextReconnectAt: Date.now() + delay,
      });
      timer = setTimeout(() => {
        timer = null;
        onReconnect();
      }, delay);
      return true;
    },

    clearTimerTrigger() {
      if (!fromTimer || timer != null) return false;
      fromTimer = false;
      // 計時器已觸發但沒開成線：這個時間點已經過去，清掉以免 UI 還在倒數
      apply({ nextReconnectAt: 0 });
      return true;
    },

    cancel() {
      intentionalClose = true;
      clearTimer();
      clearUptimeTimer();
      attempt = 0;
      apply({
        nextReconnectAt: 0,
        reconnectAttempt: 0,
        reconnectExhausted: false,
      });
    },

    bindOnReconnect(fn) {
      onReconnect = fn;
    },
  };
}

export function useReconnect(
  options: ReconnectOptions,
  apply: (patch: ReconnectPatch) => void,
): Reconnect {
  const [session] = useState(() => createReconnect(options, apply));
  return session;
}
