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
  let epoch = 0;

  return {
    enqueue(data) {
      if (!Number.isFinite(max) || max <= 0 || items.length >= max) return false;
      items.push(data);
      return true;
    },
    clear() {
      items = [];
      epoch += 1;
    },
    flush(send) {
      const queued = items;
      const started = epoch;
      items = [];
      let i = 0;
      try {
        for (; i < queued.length; i++) send(queued[i]!);
      } catch (err) {
        // clear() 過就不要把舊項目救回；其後才 enqueue 的留在 items
        if (epoch === started) items = queued.slice(i).concat(items);
        throw err;
      }
    },
  };
}

export function useOutgoingQueue(max: number): OutgoingQueue {
  const [queue] = useState(() => createOutgoingQueue(max));
  return queue;
}
