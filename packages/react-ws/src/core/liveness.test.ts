import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLiveness } from "./liveness";

describe("liveness", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("timeout does not close a newer socket", () => {
    const closeA = vi.fn();
    const closeB = vi.fn();
    const a = {
      readyState: 1,
      close: closeA,
      send: vi.fn(),
    } as unknown as WebSocket;
    const b = {
      readyState: 1,
      close: closeB,
      send: vi.fn(),
    } as unknown as WebSocket;
    const session = createLiveness(
      {
        intervalMs: 100,
        timeoutMs: 50,
        ping: JSON.stringify({ type: "PING" }),
        isPong: () => false,
      },
      (socket) => {
        socket.close();
      },
    );

    session.start(a);
    session.start(b);
    vi.advanceTimersByTime(50);
    expect(closeA).not.toHaveBeenCalled();
    expect(closeB).toHaveBeenCalledTimes(1);
    session.stop();
  });

  it("createLiveness timeout stops pings even when close() does not stop()", () => {
    const send = vi.fn();
    const close = vi.fn();
    const ws = { readyState: 1, close, send } as unknown as WebSocket;
    const session = createLiveness(
      {
        intervalMs: 1_000,
        timeoutMs: 2_500,
        ping: JSON.stringify({ type: "PING" }),
        isPong: () => false,
      },
      (socket) => {
        socket.close();
      },
    );

    session.start(ws);
    vi.advanceTimersByTime(2_500);
    expect(close).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledTimes(3);

    vi.advanceTimersByTime(1_000);
    expect(send).toHaveBeenCalledTimes(3);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("does not arm a wait between pong and the next ping", () => {
    const send = vi.fn();
    const onTimeout = vi.fn();
    const ws = { readyState: 1, close: vi.fn(), send } as unknown as WebSocket;
    const session = createLiveness(
      {
        intervalMs: 1_000,
        timeoutMs: 500,
        ping: "ping",
        isPong: (data) =>
          typeof data === "object" &&
          data != null &&
          (data as { type?: string }).type === "PONG",
      },
      onTimeout,
    );

    session.start(ws);
    expect(send).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(200);
    session.onMessage({ type: "PONG" });

    vi.advanceTimersByTime(600);
    expect(onTimeout).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(200);
    expect(send).toHaveBeenCalledTimes(2);

    vi.advanceTimersByTime(499);
    expect(onTimeout).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onTimeout).toHaveBeenCalledTimes(1);
  });

  it("createLiveness stop during the first ping does not close the socket later", () => {
    const close = vi.fn();
    const send = vi.fn();
    const ws = { readyState: 1, close, send } as unknown as WebSocket;
    const session = createLiveness(
      {
        intervalMs: 1_000,
        timeoutMs: 500,
        ping: () => {
          session.stop();
          return "ping";
        },
        isPong: () => false,
      },
      (socket) => {
        socket.close();
      },
    );

    session.start(ws);
    vi.advanceTimersByTime(10_000);
    expect(close).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("sync pong during ping send does not time out that wait", () => {
    const onTimeout = vi.fn();
    const ws = {
      readyState: 1,
      close: vi.fn(),
      send: vi.fn(),
    } as unknown as WebSocket;
    const session = createLiveness(
      {
        intervalMs: 10_000,
        timeoutMs: 1_000,
        ping: () => {
          session.onMessage("PONG");
          return "ping";
        },
        isPong: (data) => data === "PONG",
      },
      onTimeout,
    );

    session.start(ws);
    vi.advanceTimersByTime(1_000);
    expect(onTimeout).not.toHaveBeenCalled();
  });

  it("isPong throw does not clear timeout", () => {
    const onTimeout = vi.fn();
    const ws = {
      readyState: 1,
      close: vi.fn(),
      send: vi.fn(),
    } as unknown as WebSocket;
    const session = createLiveness(
      {
        intervalMs: 1_000,
        timeoutMs: 500,
        ping: "ping",
        isPong: () => {
          throw new Error("isPong");
        },
      },
      onTimeout,
    );

    session.start(ws);
    expect(() => session.onMessage({ type: "PONG" })).toThrow("isPong");

    vi.advanceTimersByTime(500);
    expect(onTimeout).toHaveBeenCalledTimes(1);
  });

  it("sends each ping getter result without JSON.stringify", () => {
    const send = vi.fn();
    const ws = { readyState: 1, close: vi.fn(), send } as unknown as WebSocket;
    const bytes = new Uint8Array([1, 2, 3]);
    let n = 0;
    const session = createLiveness(
      {
        intervalMs: 1_000,
        timeoutMs: 10_000,
        ping: () => {
          n += 1;
          return n === 1 ? "raw-ping" : bytes;
        },
        isPong: () => false,
      },
      () => {},
    );

    session.start(ws);
    vi.advanceTimersByTime(1_000);
    expect(send).toHaveBeenNthCalledWith(1, "raw-ping");
    expect(send).toHaveBeenNthCalledWith(2, bytes);
    expect(send.mock.calls[1]?.[0]).toBe(bytes);
    session.stop();
  });

  it("createLiveness ping throw still times out the socket", () => {
    const close = vi.fn();
    const ws = { readyState: 1, close, send: vi.fn() } as unknown as WebSocket;
    const session = createLiveness(
      {
        intervalMs: 1_000,
        timeoutMs: 500,
        ping: () => {
          throw new Error("ping");
        },
        isPong: () => false,
      },
      (socket) => {
        socket.close();
      },
    );

    expect(() => session.start(ws)).not.toThrow();
    vi.advanceTimersByTime(500);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it.each([
    { intervalMs: 1_000, timeoutMs: Number.NaN },
    { intervalMs: 1_000, timeoutMs: Number.POSITIVE_INFINITY },
    { intervalMs: 1_000, timeoutMs: -1 },
    { intervalMs: 1_000, timeoutMs: 0 },
    { intervalMs: Number.NaN, timeoutMs: 10_000 },
    { intervalMs: Number.POSITIVE_INFINITY, timeoutMs: 10_000 },
    { intervalMs: -1, timeoutMs: 10_000 },
    { intervalMs: 0, timeoutMs: 10_000 },
  ])(
    "invalid liveness delays throw at creation ($intervalMs / $timeoutMs)",
    ({ intervalMs, timeoutMs }) => {
      expect(() =>
        createLiveness(
          {
            intervalMs,
            timeoutMs,
            ping: JSON.stringify({ type: "PING" }),
            isPong: () => false,
          },
          () => {},
        ),
      ).toThrow("invalid liveness");
    },
  );
});
