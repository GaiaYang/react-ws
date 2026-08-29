import { useState } from "react";
import {
  createLivenessController,
  createPingSender,
  type LivenessController,
} from "./controller";
import type { LivenessOptions } from "./types";

export interface Liveness {
  /** 開始探活（socket 由 {@link createLiveness} 的 `getActiveSocket` 取得） */
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
      controller = createLivenessController(options, () => {
        const current = getActiveSocket();
        if (current?.readyState === WebSocket.OPEN) current.close();
      });
      const sendPing = createPingSender(options.ping, (data) => {
        const current = getActiveSocket();
        if (!current || current.readyState !== WebSocket.OPEN) return false;
        current.send(JSON.stringify(data));
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
