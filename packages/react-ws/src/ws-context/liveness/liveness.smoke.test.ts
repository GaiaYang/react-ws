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

  it("createLiveness closes active socket on timeout", () => {
    vi.useFakeTimers();
    const close = vi.fn();
    const ws = { readyState: 1, close, send: vi.fn() } as unknown as WebSocket;
    const active: WebSocket | null = ws;

    const session = createLiveness(
      {
        intervalMs: 100,
        timeoutMs: 50,
        ping: { type: "PING" },
        isPong: () => false,
      },
      () => active,
    );

    session.start(ws);
    vi.advanceTimersByTime(50);
    expect(close).toHaveBeenCalledTimes(1);
    session.stop();
    vi.useRealTimers();
  });
});
