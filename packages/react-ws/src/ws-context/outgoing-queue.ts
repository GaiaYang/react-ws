import { useState } from "react";

export type OutgoingData = Parameters<WebSocket["send"]>[0];

export interface OutgoingQueue {
  /** 列隊 */
  enqueue: (data: OutgoingData) => boolean;
  /** 清空 */
  clear: () => void;
  /** 依序送出後清空 */
  flush: (send: (data: OutgoingData) => void) => void;
}

export function createOutgoingQueue(max: number): OutgoingQueue {
  let items: OutgoingData[] = [];

  return {
    enqueue(data) {
      if (max <= 0 || items.length >= max) return false;
      items.push(data);
      return true;
    },
    clear() {
      items = [];
    },
    flush(send) {
      const queued = items;
      items = [];
      for (const data of queued) send(data);
    },
  };
}

export function useOutgoingQueue(max: number): OutgoingQueue {
  const [queue] = useState(() => createOutgoingQueue(max));
  return queue;
}
