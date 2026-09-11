import { MAX_TIMEOUT_MS } from "../socket";
import type { LivenessOptions } from "./types";

export interface LivenessController {
  start: (sendPing: () => void) => void;
  stop: () => void;
  onMessage: (data: unknown) => void;
}

export function createLivenessController(
  options: LivenessOptions,
  onTimeout: () => void,
): LivenessController {
  const { intervalMs, timeoutMs, isPong } = options;

  let intervalId: ReturnType<typeof setInterval> | null = null;
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  let sendPingRef: (() => void) | null = null;

  function clearTimeoutTimer(): void {
    if (timeoutId != null) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
  }

  function armTimeout(): void {
    // 已在等 pong 就不要重設，否則 timeoutMs > intervalMs 時逾時永遠不到
    if (timeoutId != null) return;
    if (!Number.isFinite(timeoutMs) || timeoutMs < 0) return;
    timeoutId = setTimeout(() => {
      timeoutId = null;
      if (intervalId != null) {
        clearInterval(intervalId);
        intervalId = null;
      }
      sendPingRef = null;
      onTimeout();
    }, Math.min(timeoutMs, MAX_TIMEOUT_MS));
  }

  function tick(): void {
    try {
      sendPingRef?.();
    } catch {
      void 0;
    }
    // 不論 ping 成敗都掛逾時，否則死線永遠偵測不到
    armTimeout();
  }

  return {
    start(sendPing) {
      sendPingRef = sendPing;
      // setInterval 不會立刻跑；否則要等滿一個 interval 才有第一次 ping
      tick();
      if (!Number.isFinite(intervalMs) || intervalMs < 0) return;
      intervalId = setInterval(tick, Math.min(intervalMs, MAX_TIMEOUT_MS));
    },

    stop() {
      if (intervalId != null) {
        clearInterval(intervalId);
        intervalId = null;
      }
      clearTimeoutTimer();
      sendPingRef = null;
    },

    onMessage(data) {
      try {
        if (isPong(data)) clearTimeoutTimer();
      } catch {
        void 0;
      }
    },
  };
}
