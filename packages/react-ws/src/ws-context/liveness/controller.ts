import { resolvePingPayload } from "./resolve-ping";
import type { LivenessOptions } from "./types";

export interface LivenessController {
  /** 開始探活 */
  start: (sendPing: () => void) => void;
  /** 停止探活 */
  stop: () => void;
  /** 收到訊息 */
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
    clearTimeoutTimer();
    timeoutId = setTimeout(onTimeout, timeoutMs);
  }

  function tick(): void {
    sendPingRef?.();
    armTimeout();
  }

  return {
    start(sendPing) {
      sendPingRef = sendPing;
      tick(); // setInterval 不會立刻跑，否則要等滿一個 interval 才有第一次 ping
      intervalId = setInterval(tick, intervalMs);
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
      if (isPong(data)) clearTimeoutTimer();
    },
  };
}

export function createPingSender(
  ping: LivenessOptions["ping"],
  sendJson: (data: unknown) => boolean,
): () => void {
  return () => {
    sendJson(resolvePingPayload(ping));
  };
}
