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

describe("createWsSession", () => {
  beforeEach(() => {
    MockWebSocket.instances = [];
    vi.stubGlobal("WebSocket", MockWebSocket);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("connect → open → disconnect 更新 store，不經 React", () => {
    const session = createWsSession({ url: "ws://example.test" });
    expect(session.store.getState().status).toBe("idle");

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
});
