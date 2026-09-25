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
    expect(session.getStatus()).toBe("open");

    session.disconnect();
    expect(session.store.getState()).toMatchObject({
      status: "closed",
      phase: "idle",
    });
    expect(session.getStatus()).toBe("closed");
  });

  it("omitted reconnect fields back off, cap, jitter, then reset after 5s", () => {
    vi.useFakeTimers();
    // random() 不含 1；mock 1 讓預設 jitter 0.2 把等待縮到 8 成
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

    expect(waits[0]).toBe(80);
    expect(waits[1]).toBe(160);
    expect(waits[8]).toBe(20_480);
    expect(waits[9]).toBe(24_000);

    vi.advanceTimersByTime(24_000);
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

  it("NaN reconnectMinUptimeMs does not reset after 5s", () => {
    vi.useFakeTimers();
    const session = createWsSession({
      url: "ws://example.test",
      reconnectMs: 100,
      reconnectBackoff: 1,
      reconnectJitter: 0,
      reconnectMinUptimeMs: Number.NaN,
    });
    session.connect();
    latestSocket().open();
    latestSocket().close();
    expect(session.store.getState().reconnectAttempt).toBe(1);
    vi.advanceTimersByTime(100);
    latestSocket().open();
    vi.advanceTimersByTime(5000);
    expect(session.store.getState().reconnectAttempt).toBe(1);
  });

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
});
