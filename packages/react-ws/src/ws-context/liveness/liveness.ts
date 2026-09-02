import { useState } from "react";
import {
  createLivenessController,
  createPingSender,
  type LivenessController,
} from "./controller";
import type { LivenessOptions } from "./types";

export interface Liveness {
  /** 開始探活；socket 取自此次 `start` 當下的 `getActiveSocket` */
  start: () => void;
  /** 停止探活 */
  stop: () => void;
  /** 收到訊息 */
  onMessage: (data: unknown) => void;
}

const DISABLED_LIVENESS: Liveness = {
  start() {},
  stop() {},
  onMessage() {},
};

export function createLiveness(
  options: LivenessOptions,
  getActiveSocket: () => WebSocket | null,
): Liveness {
  let controller: LivenessController | null = null;

  return {
    start() {
      controller?.stop();
      const sessionSocket = getActiveSocket();
      // 逾時不可關掉之後重連的新線
      controller = createLivenessController(options, () => {
        if (sessionSocket?.readyState === WebSocket.OPEN) sessionSocket.close();
      });
      const sendPing = createPingSender(options.ping, (data) => {
        if (!sessionSocket || sessionSocket.readyState !== WebSocket.OPEN) {
          return false;
        }
        sessionSocket.send(JSON.stringify(data));
        return true;
      });
      controller.start(sendPing);
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

export function useLiveness(
  options: LivenessOptions | undefined,
  getActiveSocket: () => WebSocket | null,
): Liveness {
  const [session] = useState(() =>
    options ? createLiveness(options, getActiveSocket) : DISABLED_LIVENESS,
  );
  return session;
}
