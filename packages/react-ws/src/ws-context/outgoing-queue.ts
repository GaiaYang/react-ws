import { useState } from "react";

export type OutgoingData = Parameters<WebSocket["send"]>[0];

export interface OutgoingQueue {
  /** 關或滿時回 `false`：寧可丟新訊息，也不擠掉還在等的舊訊息 */
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
        // clear() 後勿救回舊項目；其後才 enqueue 的留在 items
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
