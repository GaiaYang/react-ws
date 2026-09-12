import { useState } from "react";
import { MAX_TIMEOUT_MS } from "./socket";

/** 欄位語意見 `CreateWsContextOptions`；退避預設由 `createWsContext` 帶入。 */
export interface ReconnectOptions {
  reconnectMs: number;
  reconnectMax: number;
  reconnectBackoff?: number;
  reconnectDelayMaxMs?: number;
  reconnectJitter?: number;
  reconnectMinUptimeMs?: number;
}

/**
 * 順序是「退避 → 套上限 → 向下抖動」：
 * 先上限再抖動，`reconnectDelayMaxMs` 才是真正上限；
 * 只往下扣，頂到上限後各 client 仍會錯開（上下對稱再夾回會讓半數樣本卡在上限）。
 *
 * `reconnectJitter: 1` 即 AWS full jitter：
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

  // 非有限數會產出 NaN；setTimeout(fn, NaN) 等於立刻觸發
  const factor = Math.max(
    Number.isFinite(reconnectBackoff) ? reconnectBackoff : 1,
    1,
  );
  const ms = Number.isFinite(reconnectMs) ? reconnectMs : 0;
  const backoff = ms * factor ** Math.max(attempt - 1, 0);
  const delayMax = Number.isFinite(reconnectDelayMaxMs)
    ? reconnectDelayMaxMs
    : 0;
  const capped = delayMax > 0 ? Math.min(backoff, delayMax) : backoff;
  const jitterRatio = Number.isFinite(reconnectJitter) ? reconnectJitter : 0;
  const jitter = Math.min(Math.max(jitterRatio, 0), 1);
  const jittered = capped * (1 - Math.random() * jitter);
  const rounded = Math.round(jittered);
  if (!Number.isFinite(rounded)) return MAX_TIMEOUT_MS;
  // 未設上限時退避可到 Infinity，仍要壓回平台能用的延遲
  return Math.min(Math.max(rounded, 0), MAX_TIMEOUT_MS);
}

export interface ReconnectPatch {
  reconnectAttempt?: number;
  reconnectExhausted?: boolean;
  nextReconnectAt?: number;
}

export interface Reconnect {
  /** `true` 表示來自重連計時器；此時不可歸零 attempt */
  onConnectBegin: () => boolean;
  onOpen: () => void;
  scheduleAfterClose: () => boolean;
  /** 計時器已觸發、這次排程已消耗，但不是使用者主動放棄 */
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
  let uptimeTimer: ReturnType<typeof setTimeout> | null = null;
  let onReconnect = () => {};
  // 本輪計數以這裡為準；不回讀 store，避免拿到半套狀態
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
      // NaN 會讓 setTimeout 立刻觸發，短命連線保護就沒了
      if (!Number.isFinite(minUptime)) return;
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
      // 沒撐滿 minUptime：清掉待跑的歸零，讓退避沿用本輪計數
      clearUptimeTimer();
      if (
        intentionalClose ||
        !Number.isFinite(options.reconnectMs) ||
        options.reconnectMs <= 0
      ) {
        return false;
      }
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
      // 時間點已過，清掉以免 UI 還在倒數
      apply({ nextReconnectAt: 0 });
      return true;
    },

    cancel() {
      intentionalClose = true;
      fromTimer = false;
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
