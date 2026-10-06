import { MAX_TIMEOUT_MS } from "../socket";
import type { LivenessOptions } from "./types";

/** `0`、負數、非有限數都不是有效的 ping／pong 間隔 */
export function livenessDelaysOk(
  intervalMs: number,
  timeoutMs: number,
): boolean {
  return (
    Number.isFinite(intervalMs) &&
    intervalMs > 0 &&
    Number.isFinite(timeoutMs) &&
    timeoutMs > 0
  );
}

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
  // ping 可能同步 stop；進行中的 tick／start 不能再把 timer 掛回去
  let stopped = false;

  function clearTimeoutTimer(): void {
    if (timeoutId != null) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
  }

  function armTimeout(): void {
    if (stopped) return;
    // 已在等 pong 勿重設，否則 timeoutMs > intervalMs 時逾時永遠不到
    if (timeoutId != null) return;
    // 0、負數、非有限數不是「立刻判死」，也不是靜默關掉後還繼續 ping
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return;
    timeoutId = setTimeout(
      () => {
        timeoutId = null;
        if (intervalId != null) {
          clearInterval(intervalId);
          intervalId = null;
        }
        sendPingRef = null;
        onTimeout();
      },
      Math.min(timeoutMs, MAX_TIMEOUT_MS),
    );
  }

  function tick(): void {
    // 先掛逾時。send 同步送進的 pong 才清得掉這次等待；ping 擲出也仍在等
    armTimeout();
    try {
      sendPingRef?.();
    } catch {
      void 0;
    }
  }

  return {
    start(sendPing) {
      stopped = false;
      sendPingRef = sendPing;
      // 無效間隔不送第一次 ping，否則看起來像心跳還在，其實沒有判死
      if (!livenessDelaysOk(intervalMs, timeoutMs)) return;
      // setInterval 不會立刻跑，需先 tick 一次
      tick();
      if (stopped) return;
      intervalId = setInterval(tick, Math.min(intervalMs, MAX_TIMEOUT_MS));
    },
    stop() {
      stopped = true;
      if (intervalId != null) {
        clearInterval(intervalId);
        intervalId = null;
      }
      clearTimeoutTimer();
      sendPingRef = null;
    },
    onMessage(data) {
      if (isPong(data)) clearTimeoutTimer();
    },
  };
}
