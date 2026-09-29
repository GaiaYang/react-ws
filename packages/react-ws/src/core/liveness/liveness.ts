import { resolveMaybeGetter } from "../maybe-getter";
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
): Liveness {
  let controller: LivenessController | null = null;

  return {
    start(socket) {
      controller?.stop();
      // 逾時只處理這顆 socket。有 onTimeout 時由 session 立刻收線，不等瀏覽器 onclose
      controller = createLivenessController(options, () => {
        if (socket.readyState !== WebSocket.OPEN) return;
        if (onTimeout) {
          onTimeout(socket);
          return;
        }
        socket.close();
      });
      controller.start(() => {
        if (socket.readyState !== WebSocket.OPEN) return;
        const data = resolveMaybeGetter(options.ping);
        // ping 可能同步斷線或換線，不能再送到舊 socket
        if (socket.readyState !== WebSocket.OPEN) return;
        socket.send(data);
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
): Liveness {
  return options ? createLiveness(options, onTimeout) : DISABLED_LIVENESS;
}
