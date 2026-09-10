import { useState } from "react";

export type OutgoingData = Parameters<WebSocket["send"]>[0];

export interface OutgoingQueue {
  /** 關或滿時回 `false`：丟新的、不丟舊的，避免後到的蓋掉還在等的 */
  enqueue: (data: OutgoingData) => boolean;
  clear: () => void;
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
