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

export function createLiveness(options: LivenessOptions): Liveness {
  let controller: LivenessController | null = null;

  return {
    start(socket) {
      controller?.stop();
      // 逾時只關這顆 socket，不可碰到之後重連的新線
      controller = createLivenessController(options, () => {
        if (socket.readyState === WebSocket.OPEN) socket.close();
      });
      controller.start(() => {
        if (socket.readyState !== WebSocket.OPEN) return;
        const ping = options.ping;
        const data = typeof ping === "function" ? ping() : ping;
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
): Liveness {
  return options ? createLiveness(options) : DISABLED_LIVENESS;
}
