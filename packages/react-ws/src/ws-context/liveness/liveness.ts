import { useState } from "react";
import { stringifyJson } from "../socket";
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
      // 逾時不可關掉之後重連的新線
      controller = createLivenessController(options, () => {
        if (socket.readyState === WebSocket.OPEN) socket.close();
      });
      controller.start(() => {
        if (socket.readyState !== WebSocket.OPEN) return;
        const ping = options.ping;
        const json = stringifyJson(typeof ping === "function" ? ping() : ping);
        if (json === null) return;
        socket.send(json);
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

export function useLiveness(options: LivenessOptions | undefined): Liveness {
  const [session] = useState(() =>
    options ? createLiveness(options) : DISABLED_LIVENESS,
  );
  return session;
}
