import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLiveness } from "./liveness";
import { createLivenessController } from "./controller";

describe("liveness", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("sends ping on interval and times out without pong", () => {
    const pings: number[] = [];
    const onTimeout = vi.fn();

    const controller = createLivenessController(
      {
        intervalMs: 1_000,
        timeoutMs: 500,
        ping: { type: "PING" },
        isPong: (data) =>
          typeof data === "object" &&
          data != null &&
          (data as { type?: string }).type === "PONG",
      },
      onTimeout,
    );

    controller.start(() => pings.push(Date.now()));
    expect(pings).toHaveLength(1);

    vi.advanceTimersByTime(500);
    expect(onTimeout).toHaveBeenCalledTimes(1);

    controller.stop();
    vi.advanceTimersByTime(2_000);
    expect(pings).toHaveLength(1);
  });

  it("pong clears timeout until next ping", () => {
    const onTimeout = vi.fn();

    const controller = createLivenessController(
      {
        intervalMs: 1_000,
        timeoutMs: 500,
        ping: { type: "PING" },
        isPong: (data) =>
          typeof data === "object" &&
          data != null &&
          (data as { type?: string }).type === "PONG",
      },
      onTimeout,
    );

    controller.start(() => {});
    vi.advanceTimersByTime(400);
    controller.onMessage({ type: "PONG" });

    vi.advanceTimersByTime(400);
    expect(onTimeout).not.toHaveBeenCalled();

    controller.stop();
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
    const session = createLiveness({
      intervalMs: 100,
      timeoutMs: 50,
      ping: { type: "PING" },
      isPong: () => false,
    });

    session.start(a);
    session.start(b);
    vi.advanceTimersByTime(50);
    expect(closeA).not.toHaveBeenCalled();
    expect(closeB).toHaveBeenCalledTimes(1);
    session.stop();
  });

  it("createLiveness closes active socket on timeout", () => {
    vi.useFakeTimers();
    const close = vi.fn();
    const ws = { readyState: 1, close, send: vi.fn() } as unknown as WebSocket;

    const session = createLiveness({
      intervalMs: 100,
      timeoutMs: 50,
      ping: { type: "PING" },
      isPong: () => false,
    });

    session.start(ws);
    vi.advanceTimersByTime(50);
    expect(close).toHaveBeenCalledTimes(1);
    session.stop();
    vi.useRealTimers();
  });

  it("does not defer timeout when later pings arrive before pong", () => {
    const pings: number[] = [];
    const onTimeout = vi.fn();
    const controller = createLivenessController(
      {
        intervalMs: 1_000,
        timeoutMs: 2_500,
        ping: { type: "PING" },
        isPong: () => false,
      },
      onTimeout,
    );

    controller.start(() => pings.push(Date.now()));
    expect(pings).toHaveLength(1);

    vi.advanceTimersByTime(1_000);
    expect(pings).toHaveLength(2);
    vi.advanceTimersByTime(1_000);
    expect(pings).toHaveLength(3);

    vi.advanceTimersByTime(499);
    expect(onTimeout).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onTimeout).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(2_000);
    expect(onTimeout).toHaveBeenCalledTimes(1);
    controller.stop();
  });

  it("stops pinging after timeout even if stop() is never called", () => {
    const pings: number[] = [];
    const onTimeout = vi.fn();
    const controller = createLivenessController(
      {
        intervalMs: 1_000,
        timeoutMs: 2_500,
        ping: { type: "PING" },
        isPong: () => false,
      },
      onTimeout,
    );

    controller.start(() => pings.push(Date.now()));
    vi.advanceTimersByTime(2_500);
    expect(onTimeout).toHaveBeenCalledTimes(1);
    expect(pings).toHaveLength(3);

    vi.advanceTimersByTime(1_000);
    expect(pings).toHaveLength(3);
    expect(onTimeout).toHaveBeenCalledTimes(1);
  });

  it("createLiveness timeout stops pings even when close() does not stop()", () => {
    const send = vi.fn();
    const close = vi.fn();
    const ws = { readyState: 1, close, send } as unknown as WebSocket;
    const session = createLiveness({
      intervalMs: 1_000,
      timeoutMs: 2_500,
      ping: { type: "PING" },
      isPong: () => false,
    });

    session.start(ws);
    vi.advanceTimersByTime(2_500);
    expect(close).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledTimes(3);

    vi.advanceTimersByTime(1_000);
    expect(send).toHaveBeenCalledTimes(3);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("does not arm a wait between pong and the next ping", () => {
    const pings: number[] = [];
    const onTimeout = vi.fn();
    const controller = createLivenessController(
      {
        intervalMs: 1_000,
        timeoutMs: 500,
        ping: { type: "PING" },
        isPong: (data) =>
          typeof data === "object" &&
          data != null &&
          (data as { type?: string }).type === "PONG",
      },
      onTimeout,
    );

    controller.start(() => pings.push(Date.now()));
    expect(pings).toHaveLength(1);

    vi.advanceTimersByTime(200);
    controller.onMessage({ type: "PONG" });

    vi.advanceTimersByTime(600);
    expect(onTimeout).not.toHaveBeenCalled();
    expect(pings).toHaveLength(1);

    vi.advanceTimersByTime(200);
    expect(pings).toHaveLength(2);

    vi.advanceTimersByTime(499);
    expect(onTimeout).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onTimeout).toHaveBeenCalledTimes(1);
  });

  it("ping throw still arms timeout", () => {
    const onTimeout = vi.fn();
    const controller = createLivenessController(
      {
        intervalMs: 1_000,
        timeoutMs: 500,
        ping: { type: "PING" },
        isPong: () => false,
      },
      onTimeout,
    );

    expect(() => {
      controller.start(() => {
        throw new Error("ping");
      });
    }).not.toThrow();

    vi.advanceTimersByTime(499);
    expect(onTimeout).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onTimeout).toHaveBeenCalledTimes(1);
  });

  it("isPong throw does not clear timeout", () => {
    const onTimeout = vi.fn();
    const controller = createLivenessController(
      {
        intervalMs: 1_000,
        timeoutMs: 500,
        ping: { type: "PING" },
        isPong: () => {
          throw new Error("isPong");
        },
      },
      onTimeout,
    );

    controller.start(() => {});
    expect(() => controller.onMessage({ type: "PONG" })).not.toThrow();

    vi.advanceTimersByTime(500);
    expect(onTimeout).toHaveBeenCalledTimes(1);
  });

  it("createLiveness ping throw still times out the socket", () => {
    const close = vi.fn();
    const ws = { readyState: 1, close, send: vi.fn() } as unknown as WebSocket;
    const session = createLiveness({
      intervalMs: 1_000,
      timeoutMs: 500,
      ping: () => {
        throw new Error("ping");
      },
      isPong: () => false,
    });

    expect(() => session.start(ws)).not.toThrow();
    vi.advanceTimersByTime(500);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("non-finite timeoutMs does not close immediately", () => {
    const close = vi.fn();
    const send = vi.fn();
    const ws = { readyState: 1, close, send } as unknown as WebSocket;
    const session = createLiveness({
      intervalMs: 1_000,
      timeoutMs: Number.NaN,
      ping: { type: "PING" },
      isPong: () => false,
    });

    session.start(ws);
    vi.advanceTimersByTime(1);
    expect(close).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("non-finite intervalMs does not ping in a tight loop", () => {
    const close = vi.fn();
    const send = vi.fn();
    const ws = { readyState: 1, close, send } as unknown as WebSocket;
    const session = createLiveness({
      intervalMs: Number.NaN,
      timeoutMs: 10_000,
      ping: { type: "PING" },
      isPong: () => false,
    });

    session.start(ws);
    vi.advanceTimersByTime(1_000);
    expect(send).toHaveBeenCalledTimes(1);
    expect(close).not.toHaveBeenCalled();
  });
});
