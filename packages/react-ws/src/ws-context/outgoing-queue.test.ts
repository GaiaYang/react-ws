import { describe, expect, it } from "vitest";
import { createOutgoingQueue, type OutgoingData } from "./outgoing-queue";

function drain(queue: ReturnType<typeof createOutgoingQueue>): OutgoingData[] {
  const out: OutgoingData[] = [];
  queue.flush((data) => out.push(data));
  return out;
}

describe("createOutgoingQueue", () => {
  it("puts unsent items back in order when send throws", () => {
    const queue = createOutgoingQueue(10);
    expect(queue.enqueue("a")).toBe(true);
    expect(queue.enqueue("b")).toBe(true);
    expect(queue.enqueue("c")).toBe(true);

    const sent: OutgoingData[] = [];
    const err = new Error("send b");
    expect(() => {
      queue.flush((data) => {
        if (data === "b") throw err;
        sent.push(data);
      });
    }).toThrow(err);

    expect(sent).toEqual(["a"]);
    expect(drain(queue)).toEqual(["b", "c"]);
  });

  it("keeps items enqueued during flush behind the unsent prefix", () => {
    const queue = createOutgoingQueue(10);
    queue.enqueue("a");
    queue.enqueue("b");
    queue.enqueue("c");

    const sent: OutgoingData[] = [];
    expect(() => {
      queue.flush((data) => {
        if (data === "a") queue.enqueue("d");
        if (data === "b") throw new Error("send b");
        sent.push(data);
      });
    }).toThrow("send b");

    expect(sent).toEqual(["a"]);
    expect(drain(queue)).toEqual(["b", "c", "d"]);
  });

  it("does not restore items after clear() during flush", () => {
    const queue = createOutgoingQueue(10);
    queue.enqueue("a");
    queue.enqueue("b");
    queue.enqueue("c");

    expect(() => {
      queue.flush((data) => {
        if (data === "a") queue.clear();
        if (data === "b") throw new Error("send b");
      });
    }).toThrow("send b");

    expect(drain(queue)).toEqual([]);
  });

  it("keeps items enqueued after clear() during a throwing flush", () => {
    const queue = createOutgoingQueue(10);
    queue.enqueue("a");
    queue.enqueue("b");
    queue.enqueue("c");

    expect(() => {
      queue.flush((data) => {
        if (data === "a") {
          queue.clear();
          queue.enqueue("e");
        }
        if (data === "b") throw new Error("send b");
      });
    }).toThrow("send b");

    expect(drain(queue)).toEqual(["e"]);
  });

  it("empties the queue when every send succeeds", () => {
    const queue = createOutgoingQueue(10);
    queue.enqueue("a");
    queue.enqueue("b");
    queue.enqueue("c");

    const sent: OutgoingData[] = [];
    queue.flush((data) => sent.push(data));
    expect(sent).toEqual(["a", "b", "c"]);
    expect(drain(queue)).toEqual([]);
  });

  it("non-finite max disables the queue", () => {
    for (const max of [Number.NaN, Number.POSITIVE_INFINITY]) {
      const queue = createOutgoingQueue(max);
      expect(queue.enqueue("a")).toBe(false);
      expect(drain(queue)).toEqual([]);
    }
  });
});
