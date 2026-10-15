import { resolveMaybeGetter, type MaybeGetter } from "./maybe-getter";
import { MAX_TIMEOUT_MS, READY_OPEN } from "./socket";

/** `liveness` 的設定 */
export interface LivenessOptions {
  /**
   * Ping 的發送間隔（毫秒）
   *
   * 必須是大於 `0` 的有限數。`0`、負數、非有限數會在建立 session 時擲出。
   */
  intervalMs: number;
  /**
   * 等待 Pong 的時間（毫秒）
   *
   * 必須是大於 `0` 的有限數。`0`、負數、非有限數會在建立 session 時擲出。
   */
  timeoutMs: number;
  /**
   * 要送出的 Ping
   *
   * 若為函式，每次送出前都會呼叫。
   *
   * 函式擲出，或這次 `WebSocket.send` 擲出時，該次 ping 不會送出，並觸發 `"failure"`，`source` 為 `"ping"`。等待 pong 仍會開始。
   *
   * 同步 `disconnect()` 或 `connect()` 之後的擲出仍會觸發 `"failure"`。
   */
  ping: MaybeGetter<Parameters<WebSocket["send"]>[0]>;
  /**
   * 判斷 `parse` 後的資料是否為 Pong
   *
   * 只有回傳 `true` 才視為 Pong，並結束這次等待。
   *
   * 擲出例外時視為不是 Pong，並觸發 `"failure"`，`source` 為 `"isPong"`。這顆 socket 仍是現役時，該則訊息仍會觸發 `"message"`。
   *
   * 同步 `disconnect()` 或 `connect()` 後，這顆 socket 已不是現役時不會再觸發 `"message"`。擲出仍會觸發 `"failure"`。
   */
  isPong: (data: unknown) => boolean;
}

interface LivenessController {
  start: (sendPing: () => void) => void;
  stop: () => void;
  onMessage: (data: unknown) => void;
}

function createLivenessController(
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
    sendPingRef?.();
  }

  return {
    start(sendPing) {
      stopped = false;
      sendPingRef = sendPing;
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

interface Liveness {
  start: (socket: WebSocket) => void;
  stop: () => void;
  onMessage: (data: unknown) => void;
}

const DISABLED_LIVENESS: Liveness = {
  start() {},
  stop() {},
  onMessage() {},
};

export function createLiveness(
  options: LivenessOptions,
  onTimeout: (socket: WebSocket) => void,
  onPingFailure?: (cause: unknown) => void,
): Liveness {
  const { intervalMs, timeoutMs } = options;
  if (
    !Number.isFinite(intervalMs) ||
    intervalMs <= 0 ||
    !Number.isFinite(timeoutMs) ||
    timeoutMs <= 0
  ) {
    throw new Error("invalid liveness");
  }

  let controller: LivenessController | null = null;

  return {
    start(socket) {
      controller?.stop();
      // 逾時只通知這次 start 的 socket。關線由 onTimeout 決定
      controller = createLivenessController(options, () => {
        onTimeout(socket);
      });
      controller.start(() => {
        if (socket.readyState !== READY_OPEN) return;
        try {
          const data = resolveMaybeGetter(options.ping);
          // ping 可能同步斷線或換線，不能再送到舊 socket
          if (socket.readyState !== READY_OPEN) return;
          socket.send(data);
        } catch (cause) {
          // 等待已由 controller 掛上。例外交給 onPingFailure
          onPingFailure?.(cause);
        }
      });
    },

    stop() {
      controller?.stop();
      controller = null;
    },

    onMessage(data) {
      controller?.onMessage(data);
    },
  };
}

export function resolveLiveness(
  options: LivenessOptions | undefined,
  onTimeout: (socket: WebSocket) => void,
  onPingFailure?: (cause: unknown) => void,
): Liveness {
  return options
    ? createLiveness(options, onTimeout, onPingFailure)
    : DISABLED_LIVENESS;
}
