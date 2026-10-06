import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createWsSession } from "./session";

class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  static instances: MockWebSocket[] = [];
  readyState = MockWebSocket.CONNECTING;
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;

  constructor(public url: string) {
    MockWebSocket.instances.push(this);
  }

  close(): void {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.({
      type: "close",
      code: 1000,
      reason: "",
      wasClean: true,
    } as CloseEvent);
  }

  send(): void {}

  open(): void {
    this.readyState = MockWebSocket.OPEN;
    this.onopen?.({ type: "open" } as Event);
  }
}

function latestSocket(): MockWebSocket {
  const ws = MockWebSocket.instances.at(-1);
  if (!ws) throw new Error("no socket");
  return ws;
}

describe("createWsSession", () => {
  beforeEach(() => {
    MockWebSocket.instances = [];
    vi.stubGlobal("WebSocket", MockWebSocket);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("connect → open → disconnect 更新 store，不經 React", () => {
    const session = createWsSession({ url: "ws://example.test" });
    expect(session.store.getState()).toMatchObject({
      status: "idle",
      phase: "idle",
    });

    session.connect();
    expect(session.store.getState()).toMatchObject({
      status: "connecting",
      phase: "connecting",
    });
    expect(MockWebSocket.instances).toHaveLength(1);

    MockWebSocket.instances[0]!.open();
    expect(session.store.getState()).toMatchObject({
      status: "open",
      phase: "open",
    });
    expect(session.getState()).toMatchObject({
      status: "open",
      phase: "open",
    });

    session.disconnect();
    expect(session.store.getState()).toMatchObject({
      status: "closed",
      phase: "idle",
    });
    expect(session.getState()).toMatchObject({
      status: "closed",
      phase: "idle",
    });
  });

  it("omitted reconnect fields back off, cap, jitter, then reset after 5s", () => {
    vi.useFakeTimers();
    // random() 不含 1；mock 1 讓預設 jitter 0.5 把等待縮到一半
    vi.spyOn(Math, "random").mockReturnValue(1);
    const session = createWsSession({
      url: "ws://example.test",
      reconnectMs: 100,
    });
    session.connect();

    const waits: number[] = [];
    const readWait = () => {
      latestSocket().close();
      return session.store.getState().nextReconnectAt - Date.now();
    };
    waits.push(readWait());
    for (let i = 0; i < 9; i++) {
      vi.advanceTimersByTime(
        session.store.getState().nextReconnectAt - Date.now(),
      );
      waits.push(readWait());
    }

    expect(waits[0]).toBe(50);
    expect(waits[1]).toBe(100);
    expect(waits[8]).toBe(12_800);
    expect(waits[9]).toBe(15_000);

    vi.advanceTimersByTime(15_000);
    latestSocket().open();
    expect(session.store.getState().reconnectAttempt).toBe(10);
    vi.advanceTimersByTime(4999);
    expect(session.store.getState().reconnectAttempt).toBe(10);
    vi.advanceTimersByTime(1);
    expect(session.store.getState().reconnectAttempt).toBe(0);
  });

  it("NaN backoff stays a fixed interval", () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0);
    const session = createWsSession({
      url: "ws://example.test",
      reconnectMs: 100,
      reconnectBackoff: Number.NaN,
      reconnectJitter: 0,
    });
    session.connect();
    latestSocket().close();
    expect(session.store.getState().nextReconnectAt - Date.now()).toBe(100);
    vi.advanceTimersByTime(100);
    latestSocket().close();
    expect(session.store.getState().nextReconnectAt - Date.now()).toBe(100);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY])(
    "non-finite reconnectMinUptimeMs (%s) resets at 5s",
    (reconnectMinUptimeMs) => {
      vi.useFakeTimers();
      const session = createWsSession({
        url: "ws://example.test",
        reconnectMs: 100,
        reconnectBackoff: 1,
        reconnectJitter: 0,
        reconnectMinUptimeMs,
      });
      session.connect();
      latestSocket().open();
      latestSocket().close();
      expect(session.store.getState().reconnectAttempt).toBe(1);
      vi.advanceTimersByTime(100);
      latestSocket().open();
      vi.advanceTimersByTime(4999);
      expect(session.store.getState().reconnectAttempt).toBe(1);
      vi.advanceTimersByTime(1);
      expect(session.store.getState().reconnectAttempt).toBe(0);
    },
  );

  it("NaN reconnectDelayMaxMs does not apply the 30s cap", () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0);
    const session = createWsSession({
      url: "ws://example.test",
      reconnectMs: 100,
      reconnectBackoff: 2,
      reconnectJitter: 0,
      reconnectDelayMaxMs: Number.NaN,
    });
    session.connect();
    latestSocket().close();
    for (let i = 0; i < 9; i++) {
      vi.advanceTimersByTime(
        session.store.getState().nextReconnectAt - Date.now(),
      );
      latestSocket().close();
    }
    expect(session.store.getState().nextReconnectAt - Date.now()).toBe(51_200);
  });

  it("NaN jitter does not shorten the wait", () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(1);
    const session = createWsSession({
      url: "ws://example.test",
      reconnectMs: 100,
      reconnectBackoff: 1,
      reconnectJitter: Number.NaN,
    });
    session.connect();
    latestSocket().close();
    expect(session.store.getState().nextReconnectAt - Date.now()).toBe(100);
  });

  it("replacement close handler does not observe an open socket", () => {
    const session = createWsSession({ url: "ws://example.test" });
    const during: Array<{ status: string; phase: string; sent: boolean }> = [];
    session.emitter.on("close", (event) => {
      if (event.reason !== "reconnect") return;
      during.push({
        status: session.getState().status,
        phase: session.getState().phase,
        sent: session.send("late"),
      });
    });

    session.connect();
    latestSocket().open();
    session.connect();

    expect(during).toEqual([
      { status: "closed", phase: "connecting", sent: false },
    ]);
    expect(session.getState()).toMatchObject({
      status: "connecting",
      phase: "connecting",
    });
    expect(latestSocket().readyState).toBe(MockWebSocket.CONNECTING);
  });

  it("failed connect inside replacement close keeps the socket already built", () => {
    let fail = false;
    const session = createWsSession({
      url: () => {
        if (fail) throw new Error("no token");
        return "ws://example.test";
      },
    });
    const errors: string[] = [];
    session.emitter.on("failure", (detail) => {
      if (detail.cause instanceof Error) errors.push(detail.cause.message);
    });
    session.emitter.on("close", (event) => {
      if (event.reason === "reconnect") {
        fail = true;
        session.connect();
      }
    });

    session.connect();
    latestSocket().open();
    session.connect();

    expect(errors).toEqual(["no token"]);
    expect(session.getState()).toMatchObject({
      status: "connecting",
      phase: "connecting",
    });
    expect(
      MockWebSocket.instances.filter(
        (ws) => ws.readyState === MockWebSocket.CONNECTING,
      ),
    ).toHaveLength(1);
    expect(session.send("late")).toBe(false);
  });

  it("connect without WebSocket leaves a visible failure", () => {
    vi.stubGlobal("WebSocket", undefined);
    const session = createWsSession({ url: "ws://example.test" });
    const errors: string[] = [];
    session.emitter.on("failure", (detail) => {
      if (detail.source === "construct" && detail.cause instanceof Error) {
        errors.push(detail.cause.message);
      }
    });

    session.connect();

    expect(errors).toEqual(["WebSocket is undefined"]);
    expect(session.getState()).toMatchObject({
      status: "closed",
      phase: "stopped",
      reconnectExhausted: false,
    });
  });

  it("connect without WebSocket keeps an open socket and reports the failure", () => {
    const session = createWsSession({ url: "ws://example.test" });
    session.connect();
    latestSocket().open();
    const errors: string[] = [];
    session.emitter.on("failure", (detail) => {
      if (detail.source === "construct" && detail.cause instanceof Error) {
        errors.push(detail.cause.message);
      }
    });

    vi.stubGlobal("WebSocket", undefined);
    session.connect();

    expect(errors).toEqual(["WebSocket is undefined"]);
    expect(session.getState()).toMatchObject({
      status: "open",
      phase: "open",
    });
    expect(latestSocket().readyState).toBe(MockWebSocket.OPEN);
  });

  it("connect without WebSocket while waiting stops instead of leaving the timer", () => {
    vi.useFakeTimers();
    const session = createWsSession({
      url: "ws://example.test",
      reconnectMs: 100,
      reconnectBackoff: 1,
      reconnectJitter: 0,
    });
    session.connect();
    latestSocket().open();
    latestSocket().close();
    expect(session.getState().phase).toBe("reconnecting");

    vi.stubGlobal("WebSocket", undefined);
    session.connect();

    expect(session.getState()).toMatchObject({
      status: "closed",
      phase: "stopped",
    });
    vi.advanceTimersByTime(1_000);
    expect(session.getState().phase).toBe("stopped");
  });

  it("getter that disconnects and throws still reports the failure", () => {
    const session = createWsSession({
      url: () => {
        session.disconnect();
        throw new Error("no token");
      },
    });
    const failures: Array<{ source: string; cause: unknown }> = [];
    const errors: Event[] = [];
    session.emitter.on("failure", (detail) => {
      failures.push(detail);
    });
    session.emitter.on("error", (event) => {
      errors.push(event);
    });

    session.connect();

    expect(failures).toEqual([
      {
        source: "construct",
        cause: expect.objectContaining({ message: "no token" }),
      },
    ]);
    expect(errors).toEqual([]);
    expect(session.getState()).toMatchObject({
      status: "closed",
      phase: "idle",
    });
    expect(MockWebSocket.instances).toHaveLength(0);
  });

  it("getter that disconnects and returns an empty url still reports the failure", () => {
    const session = createWsSession({
      url: () => {
        session.disconnect();
        return "";
      },
    });
    const failures: Array<{ source: string; cause: unknown }> = [];
    session.emitter.on("failure", (detail) => {
      failures.push(detail);
    });

    session.connect();

    expect(failures).toEqual([
      {
        source: "construct",
        cause: expect.objectContaining({ message: "empty url" }),
      },
    ]);
    expect(session.getState()).toMatchObject({
      status: "closed",
      phase: "idle",
    });
    expect(MockWebSocket.instances).toHaveLength(0);
  });

  it("getter that connects and then throws does not report on the new socket", () => {
    let nested = false;
    const session = createWsSession({
      url: () => {
        if (!nested) {
          nested = true;
          session.connect();
          throw new Error("outer");
        }
        return "ws://example.test";
      },
    });
    const failures: Array<{ source: string; cause: unknown }> = [];
    session.emitter.on("failure", (detail) => {
      failures.push(detail);
    });

    session.connect();

    expect(failures).toEqual([]);
    expect(session.getState()).toMatchObject({
      status: "connecting",
      phase: "connecting",
    });
    expect(MockWebSocket.instances).toHaveLength(1);
  });

  it("parse that disconnects does not deliver the message", () => {
    const session = createWsSession({
      url: "ws://example.test",
      parse: () => {
        session.disconnect();
        return { ok: true };
      },
    });
    const messages: unknown[] = [];
    session.emitter.on("message", (data) => {
      messages.push(data);
    });

    session.connect();
    latestSocket().open();
    latestSocket().onmessage?.({ data: "hi" } as MessageEvent);

    expect(messages).toEqual([]);
    expect(session.getState()).toMatchObject({
      status: "closed",
      phase: "idle",
    });
  });

  it("parse that disconnects and throws still reports the parse failure", () => {
    const session = createWsSession({
      url: "ws://example.test",
      parse: () => {
        session.disconnect();
        throw new Error("bad payload");
      },
    });
    const messages: unknown[] = [];
    const errors: string[] = [];
    session.emitter.on("message", (data) => {
      messages.push(data);
    });
    session.emitter.on("failure", (detail) => {
      if (detail.source === "parse" && detail.cause instanceof Error) {
        errors.push(detail.cause.message);
      }
    });

    session.connect();
    latestSocket().open();
    latestSocket().onmessage?.({ data: "hi" } as MessageEvent);

    expect(messages).toEqual([]);
    expect(errors).toEqual(["bad payload"]);
    expect(session.getState()).toMatchObject({
      status: "closed",
      phase: "idle",
    });
  });

  it("parse that replaces the socket and throws does not report on the new socket", () => {
    const session = createWsSession({
      url: "ws://example.test",
      parse: (data) => {
        if (data === "swap") {
          session.connect();
          throw new Error("bad payload");
        }
        return data;
      },
    });
    const messages: unknown[] = [];
    const errors: string[] = [];
    session.emitter.on("message", (data) => {
      messages.push(data);
    });
    session.emitter.on("failure", (detail) => {
      if (detail.source === "parse" && detail.cause instanceof Error) {
        errors.push(detail.cause.message);
      }
    });

    session.connect();
    latestSocket().open();
    latestSocket().onmessage?.({ data: "swap" } as MessageEvent);

    expect(messages).toEqual([]);
    expect(errors).toEqual([]);
    expect(session.getState()).toMatchObject({
      status: "connecting",
      phase: "connecting",
    });
  });

  it("parse that replaces the socket does not deliver the old message", () => {
    const session = createWsSession({
      url: "ws://example.test",
      parse: (data) => {
        if (data === "swap") session.connect();
        return data;
      },
    });
    const messages: unknown[] = [];
    session.emitter.on("message", (data) => {
      messages.push(data);
    });

    session.connect();
    latestSocket().open();
    latestSocket().onmessage?.({ data: "swap" } as MessageEvent);

    expect(messages).toEqual([]);
    expect(session.getState()).toMatchObject({
      status: "connecting",
      phase: "connecting",
    });
  });

  it("handshake close after a manual connect while waiting reuses the attempt", () => {
    vi.useFakeTimers();
    const session = createWsSession({
      url: "ws://example.test",
      reconnectMs: 100,
      reconnectMax: 1,
      reconnectBackoff: 1,
      reconnectJitter: 0,
      reconnectMinUptimeMs: 5_000,
    });

    session.connect();
    latestSocket().open();
    latestSocket().close();
    expect(session.getState()).toMatchObject({
      phase: "reconnecting",
      reconnectAttempt: 1,
      reconnectExhausted: false,
    });

    session.connect();
    expect(session.getState()).toMatchObject({
      phase: "connecting",
      reconnectAttempt: 1,
    });

    latestSocket().close();

    expect(session.getState()).toMatchObject({
      status: "closed",
      phase: "reconnecting",
      reconnectAttempt: 1,
      reconnectExhausted: false,
    });
    expect(session.getState().nextReconnectAt).toBeGreaterThan(Date.now());
  });

  it("invalid liveness does not ping and reports the failure after open", () => {
    vi.useFakeTimers();
    const session = createWsSession({
      url: "ws://example.test",
      liveness: {
        intervalMs: 0,
        timeoutMs: Number.NaN,
        ping: "ping",
        isPong: () => false,
      },
    });
    const failures: Array<{ source: string; cause: unknown }> = [];
    session.emitter.on("failure", (detail) => {
      failures.push(detail);
    });

    session.connect();
    const socket = latestSocket();
    const sent: unknown[] = [];
    socket.send = (data?: unknown) => {
      sent.push(data);
    };
    socket.open();

    expect(session.getState()).toMatchObject({ status: "open", phase: "open" });
    expect(failures).toEqual([
      {
        source: "construct",
        cause: expect.objectContaining({ message: "invalid liveness" }),
      },
    ]);
    vi.advanceTimersByTime(10_000);
    expect(sent).toEqual([]);
    expect(session.getState().status).toBe("open");
    expect(socket.readyState).toBe(MockWebSocket.OPEN);
  });

  it("invalid liveness disconnect inside open still reports the failure", () => {
    const session = createWsSession({
      url: "ws://example.test",
      liveness: {
        intervalMs: 0,
        timeoutMs: 0,
        ping: "ping",
        isPong: () => false,
      },
    });
    const failures: Array<{ source: string; cause: unknown }> = [];
    session.emitter.on("open", () => {
      session.disconnect();
    });
    session.emitter.on("failure", (detail) => {
      failures.push(detail);
    });

    session.connect();
    const socket = latestSocket();
    socket.open();

    expect(failures).toEqual([
      {
        source: "construct",
        cause: expect.objectContaining({ message: "invalid liveness" }),
      },
    ]);
    expect(session.getState()).toMatchObject({
      status: "closed",
      phase: "idle",
    });
    expect(socket.readyState).toBe(MockWebSocket.CLOSED);
  });

  it("invalid liveness connect inside open reports on the new socket", () => {
    let swapped = false;
    const session = createWsSession({
      url: "ws://example.test",
      liveness: {
        intervalMs: 0,
        timeoutMs: 0,
        ping: "ping",
        isPong: () => false,
      },
    });
    const failures: Array<{ source: string; cause: unknown }> = [];
    session.emitter.on("open", () => {
      if (swapped) return;
      swapped = true;
      session.connect();
    });
    session.emitter.on("failure", (detail) => {
      failures.push(detail);
    });

    session.connect();
    latestSocket().open();

    expect(failures).toEqual([]);
    expect(session.getState()).toMatchObject({
      status: "connecting",
      phase: "connecting",
    });

    latestSocket().open();

    expect(failures).toEqual([
      {
        source: "construct",
        cause: expect.objectContaining({ message: "invalid liveness" }),
      },
    ]);
    expect(session.getState()).toMatchObject({
      status: "open",
      phase: "open",
    });
    expect(MockWebSocket.instances).toHaveLength(2);
  });
});
