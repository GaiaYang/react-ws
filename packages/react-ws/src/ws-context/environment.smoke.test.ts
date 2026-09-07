// 有 WebSocket、沒有 window／DOM Event 建構子時，連線層仍要能跑。
import { act, cleanup, render } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createWsContext } from "./index";
import { clientCloseEvent } from "./socket";

class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  static instances: MockWebSocket[] = [];
  readyState = MockWebSocket.CONNECTING;
  onopen = null;
  onmessage = null;
  onerror = null;
  onclose = null;

  constructor(url: string) {
    if (!/^wss?:\/\//i.test(url)) throw new SyntaxError("invalid WebSocket url");
    MockWebSocket.instances.push(this);
  }

  close(): void {
    this.readyState = MockWebSocket.CLOSED;
  }

  send(): void {}
}

beforeEach(() => {
  MockWebSocket.instances = [];
  vi.stubGlobal("WebSocket", MockWebSocket);
});

afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

function hideBrowserGlobals(): void {
  vi.stubGlobal("window", undefined);
  vi.stubGlobal("document", undefined);
  vi.stubGlobal("Event", undefined);
  vi.stubGlobal("CloseEvent", undefined);
}

describe("environment: WebSocket-only runtime", () => {
  it("connect() works without window when WebSocket exists", async () => {
    const { WsProvider, useWsActions } = createWsContext({
      url: "ws://test",
      autoConnect: false,
    });

    let api!: ReturnType<typeof useWsActions>;
    function Probe() {
      api = useWsActions();
      return null;
    }

    render(createElement(WsProvider, null, createElement(Probe)));
    hideBrowserGlobals();

    await act(async () => {
      api.connect();
    });
    expect(MockWebSocket.instances).toHaveLength(1);
  });

  it("synthetic error and close work without Event/CloseEvent constructors", async () => {
    const errors: Event[] = [];
    const closes: CloseEvent[] = [];
    let shouldThrow = false;

    const { WsProvider, useWsActions, useWsEvents } = createWsContext({
      url: () => {
        if (shouldThrow) throw new Error("no token");
        return "ws://test";
      },
      autoConnect: false,
    });

    let api!: ReturnType<typeof useWsActions>;
    function Probe() {
      api = useWsActions();
      useWsEvents("error", (event) => {
        errors.push(event);
      });
      useWsEvents("close", (event) => {
        closes.push(event);
      });
      return null;
    }

    render(createElement(WsProvider, null, createElement(Probe)));

    await act(async () => {
      api.connect();
    });
    expect(MockWebSocket.instances).toHaveLength(1);

    hideBrowserGlobals();
    shouldThrow = true;
    await act(async () => {
      api.connect();
    });
    expect(errors).toHaveLength(1);
    expect(errors[0]?.type).toBe("error");

    await act(async () => {
      api.disconnect();
    });
    expect(closes.some((ev) => ev.reason === "client disconnect")).toBe(true);
  });

  it("clientCloseEvent works without CloseEvent", () => {
    vi.stubGlobal("CloseEvent", undefined);
    expect(clientCloseEvent("client disconnect")).toEqual({
      type: "close",
      code: 1000,
      reason: "client disconnect",
      wasClean: true,
    });
  });
});
