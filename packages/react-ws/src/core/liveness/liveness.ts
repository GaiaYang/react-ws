import { resolveMaybeGetter } from "../maybe-getter";
import { READY_OPEN } from "../socket";
import {
  createLivenessController,
  type LivenessController,
} from "./controller";
import type { LivenessOptions } from "./types";

export interface Liveness {
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
  onTimeout?: (socket: WebSocket) => void,
  onPingFailure?: (cause: unknown) => void,
): Liveness {
  let controller: LivenessController | null = null;

  return {
    start(socket) {
      controller?.stop();
      // 逾時只處理這顆 socket。有 onTimeout 時由 session 立刻收線，
      // 即使握手已開始、readyState 已離開 OPEN、onclose 還沒到，也不再等
      controller = createLivenessController(options, () => {
        if (onTimeout) {
          onTimeout(socket);
          return;
        }
        if (socket.readyState !== READY_OPEN) return;
        socket.close();
      });
      controller.start(() => {
        if (socket.readyState !== READY_OPEN) return;
        try {
          const data = resolveMaybeGetter(options.ping);
          // ping 可能同步斷線或換線，不能再送到舊 socket
          if (socket.readyState !== READY_OPEN) return;
          socket.send(data);
        } catch (cause) {
          // 等待已由 controller 掛上。這裡吞掉，避免 tick 變成未處理例外
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
  onTimeout?: (socket: WebSocket) => void,
  onPingFailure?: (cause: unknown) => void,
): Liveness {
  return options
    ? createLiveness(options, onTimeout, onPingFailure)
    : DISABLED_LIVENESS;
}
