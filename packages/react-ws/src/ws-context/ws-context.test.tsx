import { act, cleanup, render } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createWsContext } from "./index";

type WsListener = ((ev: Event) => void) | null;

class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  static instances: MockWebSocket[] = [];

  readonly url: string;
  readonly protocols: string | string[] | undefined;
  readyState = MockWebSocket.CONNECTING;
  sent: Array<string | ArrayBufferLike | Blob | ArrayBufferView> = [];
  onopen: WsListener = null;
  onmessage: WsListener = null;
  onerror: WsListener = null;
  onclose: WsListener = null;

  constructor(url: string, protocols?: string | string[]) {
    // 非法 URL 必須在 push 前進 throw，否則 instances 會留下一顆建失敗的 socket
    if (!/^wss?:\/\//i.test(url)) {
      throw new SyntaxError("invalid WebSocket url");
    }
    this.url = url;
    this.protocols = protocols;
    MockWebSocket.instances.push(this);
  }

  send(data: string | ArrayBufferLike | Blob | ArrayBufferView): void {
    this.sent.push(data);
  }

  close(): void {
    if (this.readyState >= MockWebSocket.CLOSING) return;
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.(new CloseEvent("close", { code: 1000, wasClean: true }));
  }

  open(): void {
    this.readyState = MockWebSocket.OPEN;
    this.onopen?.(new Event("open"));
  }

  message(data: unknown): void {
    const payload = typeof data === "string" ? data : JSON.stringify(data);
    this.onmessage?.(new MessageEvent("message", { data: payload }));
  }

  /** 走 onclose，不是 `disconnect()`，才能測到自動重連 */
  drop(): void {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.(
      new CloseEvent("close", { code: 1006, wasClean: false, reason: "drop" }),
    );
  }
}

function latestWs(): MockWebSocket {
  const ws = MockWebSocket.instances.at(-1);
  if (!ws) throw new Error("no MockWebSocket");
  return ws;
}

beforeEach(() => {
  MockWebSocket.instances = [];
  vi.stubGlobal("WebSocket", MockWebSocket);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("createWsContext", () => {
  it("sendJson returns false when the value is not JSON", async () => {
    const { WsProvider, useWsActions } = createWsContext({
      url: "ws://test",
      autoConnect: true,
    });

    let api!: ReturnType<typeof useWsActions>;
    function Probe() {
      api = useWsActions();
      return null;
    }

    render(createElement(WsProvider, null, createElement(Probe)));
    await act(async () => {
      latestWs().open();
    });

    const cycle: { self?: unknown } = {};
    cycle.self = cycle;
    expect(api.sendJson(undefined)).toBe(false);
    expect(api.sendJson(() => {})).toBe(false);
    expect(api.sendJson(Symbol("x"))).toBe(false);
    expect(api.sendJson(cycle)).toBe(false);
    expect(latestWs().sent).toEqual([]);
  });

  it("send throws when the open socket send throws", async () => {
    const { WsProvider, useWsActions } = createWsContext({
      url: "ws://test",
      autoConnect: true,
    });

    let api!: ReturnType<typeof useWsActions>;
    function Probe() {
      api = useWsActions();
      return null;
    }

    render(createElement(WsProvider, null, createElement(Probe)));
    await act(async () => {
      latestWs().open();
    });

    const ws = latestWs();
    const err = new Error("send x");
    ws.send = () => {
      throw err;
    };
    expect(() => api.send("x")).toThrow(err);
    expect(ws.sent).toEqual([]);
  });

  it("connect → message → disconnect", async () => {
    const { WsProvider, useWsActions, useWsStore, useWsEvents } =
      createWsContext({
        url: "ws://test",
        autoConnect: true,
      });

    const messages: unknown[] = [];
    const closes: string[] = [];

    function Probe() {
      const { status } = useWsStore();
      const phase = useWsStore((s) => s.phase);
      const { sendJson, disconnect, getStatus } = useWsActions();
      useWsEvents("message", (data) => {
        messages.push(data);
      });
      useWsEvents("close", (ev) => {
        closes.push(ev.reason || "close");
      });
      return createElement(
        "div",
        {
          "data-status": status,
          "data-phase": phase,
          "data-get": getStatus(),
          onClick: () => {
            sendJson({ type: "ping" });
            disconnect();
          },
        },
        status,
      );
    }

    const { getByText, container } = render(
      createElement(WsProvider, null, createElement(Probe)),
    );

    expect(MockWebSocket.instances).toHaveLength(1);
    expect(getByText("connecting")).toBeTruthy();

    await act(async () => {
      latestWs().open();
    });
    expect(getByText("open")).toBeTruthy();

    await act(async () => {
      latestWs().message({ hello: 1 });
    });
    expect(messages).toEqual([{ hello: 1 }]);

    await act(async () => {
      getByText("open").click();
    });

    expect(latestWs().sent).toEqual([JSON.stringify({ type: "ping" })]);
    expect(getByText("closed")).toBeTruthy();
    expect(
      container.querySelector("[data-phase]")?.getAttribute("data-phase"),
    ).toBe("idle");
    expect(closes.some((r) => r === "client disconnect")).toBe(true);
    expect(MockWebSocket.instances).toHaveLength(1);
  });

  it("unexpected close → reconnect", async () => {
    vi.useFakeTimers();

    const { WsProvider, useWsStore } = createWsContext({
      url: "ws://test",
      autoConnect: true,
      reconnectMs: 100,
      // 固定間隔、open 即歸零：這裡只驗 provider 的重連流程，退避數學看 reconnect.test.ts
      reconnectBackoff: 1,
      reconnectJitter: 0,
      reconnectMinUptimeMs: 0,
    });

    function Probe() {
      const status = useWsStore((s) => s.status);
      const phase = useWsStore((s) => s.phase);
      const reconnectAttempt = useWsStore((s) => s.reconnectAttempt);
      return createElement(
        "div",
        {
          "data-status": status,
          "data-phase": phase,
          "data-attempt": reconnectAttempt,
        },
        status,
      );
    }

    const { container, getByText } = render(
      createElement(WsProvider, null, createElement(Probe)),
    );
    const attempt = () =>
      container.querySelector("[data-attempt]")?.getAttribute("data-attempt");
    const phase = () =>
      container.querySelector("[data-phase]")?.getAttribute("data-phase");

    await act(async () => {
      latestWs().open();
    });
    expect(getByText("open")).toBeTruthy();
    expect(phase()).toBe("open");
    expect(attempt()).toBe("0");

    await act(async () => {
      latestWs().drop();
    });
    expect(getByText("closed")).toBeTruthy();
    expect(phase()).toBe("reconnecting");
    expect(attempt()).toBe("1");
    expect(MockWebSocket.instances).toHaveLength(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(MockWebSocket.instances).toHaveLength(2);
    expect(phase()).toBe("reconnecting");

    await act(async () => {
      latestWs().open();
    });
    expect(getByText("open")).toBeTruthy();
    expect(phase()).toBe("open");
    expect(attempt()).toBe("0");
  });

  it("default reconnect options keep backoff across a short-lived open", async () => {
    vi.useFakeTimers();
    const random = vi.spyOn(Math, "random").mockReturnValue(1);

    try {
      const { WsProvider, useWsStore } = createWsContext({
        url: "ws://test",
        autoConnect: true,
        reconnectMs: 100,
      });

      function Probe() {
        const status = useWsStore((s) => s.status);
        const reconnectAttempt = useWsStore((s) => s.reconnectAttempt);
        return createElement(
          "div",
          {
            "data-status": status,
            "data-attempt": reconnectAttempt,
          },
          status,
        );
      }

      const { container, getByText } = render(
        createElement(WsProvider, null, createElement(Probe)),
      );
      const attempt = () =>
        container.querySelector("[data-attempt]")?.getAttribute("data-attempt");

      await act(async () => {
        latestWs().open();
      });
      await act(async () => {
        latestWs().drop();
      });
      expect(attempt()).toBe("1");

      await act(async () => {
        await vi.advanceTimersByTimeAsync(79);
      });
      expect(MockWebSocket.instances).toHaveLength(1);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1);
      });
      expect(MockWebSocket.instances).toHaveLength(2);

      await act(async () => {
        latestWs().open();
      });
      expect(getByText("open")).toBeTruthy();
      await act(async () => {
        latestWs().drop();
      });
      expect(attempt()).toBe("2");

      await act(async () => {
        await vi.advanceTimersByTimeAsync(159);
      });
      expect(MockWebSocket.instances).toHaveLength(2);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1);
      });
      expect(MockWebSocket.instances).toHaveLength(3);
    } finally {
      random.mockRestore();
    }
  });

  it("stops after reconnectMax and connect() retries", async () => {
    vi.useFakeTimers();

    const { WsProvider, useWsActions, useWsStore } = createWsContext({
      url: "ws://test",
      autoConnect: true,
      reconnectMs: 100,
      reconnectMax: 2,
      reconnectBackoff: 1,
      reconnectJitter: 0,
      reconnectMinUptimeMs: 0,
    });

    let api!: ReturnType<typeof useWsActions>;

    function Probe() {
      api = useWsActions();
      const status = useWsStore((s) => s.status);
      const phase = useWsStore((s) => s.phase);
      const reconnectAttempt = useWsStore((s) => s.reconnectAttempt);
      const reconnectExhausted = useWsStore((s) => s.reconnectExhausted);
      return createElement(
        "div",
        {
          "data-status": status,
          "data-phase": phase,
          "data-attempt": reconnectAttempt,
          "data-exhausted": reconnectExhausted,
        },
        status,
      );
    }

    const { container, getByText } = render(
      createElement(WsProvider, null, createElement(Probe)),
    );
    const attempt = () =>
      container.querySelector("[data-attempt]")?.getAttribute("data-attempt");
    const phase = () =>
      container.querySelector("[data-phase]")?.getAttribute("data-phase");
    const exhausted = () =>
      container
        .querySelector("[data-exhausted]")
        ?.getAttribute("data-exhausted");

    await act(async () => {
      latestWs().open();
    });

    await act(async () => {
      latestWs().drop();
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(MockWebSocket.instances).toHaveLength(2);
    expect(attempt()).toBe("1");

    await act(async () => {
      latestWs().drop();
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(MockWebSocket.instances).toHaveLength(3);
    expect(attempt()).toBe("2");

    await act(async () => {
      latestWs().drop();
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(MockWebSocket.instances).toHaveLength(3);
    expect(getByText("closed")).toBeTruthy();
    expect(phase()).toBe("stopped");
    expect(attempt()).toBe("2");
    expect(exhausted()).toBe("true");

    await act(async () => {
      api.connect();
    });
    expect(MockWebSocket.instances).toHaveLength(4);
    expect(phase()).toBe("connecting");
    expect(attempt()).toBe("0");
    expect(exhausted()).toBe("false");
  });

  it("nested providers isolate events", async () => {
    const { WsProvider, useWsEvents } = createWsContext({
      url: "ws://test",
      autoConnect: true,
    });

    const innerOpens: number[] = [];

    function Inner() {
      useWsEvents("open", () => {
        innerOpens.push(1);
      });
      return null;
    }

    function Nested() {
      return createElement(
        WsProvider,
        null,
        createElement(WsProvider, null, createElement(Inner)),
      );
    }

    render(createElement(Nested));

    // useEffect：子先於父 → instances[0]=內層、instances[1]=外層
    expect(MockWebSocket.instances).toHaveLength(2);
    const innerWs = MockWebSocket.instances[0]!;
    const outerWs = MockWebSocket.instances[1]!;

    await act(async () => {
      outerWs.open();
    });
    expect(innerOpens).toHaveLength(0);

    await act(async () => {
      innerWs.open();
    });
    expect(innerOpens).toHaveLength(1);
  });

  it("send returns false when socket is not OPEN", async () => {
    vi.useFakeTimers();

    const { WsProvider, useWsActions, useWsStore } = createWsContext({
      url: "ws://test",
      autoConnect: true,
      reconnectMs: 100,
      reconnectBackoff: 1,
      reconnectJitter: 0,
      reconnectMinUptimeMs: 0,
    });

    let api!: ReturnType<typeof useWsActions>;

    function Probe() {
      api = useWsActions();
      const { status } = useWsStore();
      return createElement("div", null, status);
    }

    const { getByText } = render(
      createElement(WsProvider, null, createElement(Probe)),
    );

    expect(api.send("a")).toBe(false);
    expect(api.sendJson({ n: 1 })).toBe(false);

    await act(async () => {
      latestWs().open();
    });
    expect(getByText("open")).toBeTruthy();
    expect(api.send("b")).toBe(true);
    expect(api.sendJson({ n: 2 })).toBe(true);
    expect(latestWs().sent).toEqual(["b", JSON.stringify({ n: 2 })]);

    await act(async () => {
      latestWs().drop();
    });
    expect(api.send("c")).toBe(false);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
      latestWs().open();
    });
    expect(latestWs().sent).toEqual([]);

    await act(async () => {
      api.disconnect();
    });
    expect(api.send("d")).toBe(false);
    expect(api.sendJson({ n: 3 })).toBe(false);

    await act(async () => {
      api.connect();
      latestWs().open();
    });
    expect(latestWs().sent).toEqual([]);
  });

  it("liveness sends ping on interval when open", async () => {
    vi.useFakeTimers();

    const { WsProvider } = createWsContext({
      url: "ws://test",
      autoConnect: true,
      liveness: {
        intervalMs: 3_000,
        timeoutMs: 2_000,
        ping: JSON.stringify({ type: "PING" }),
        isPong: (data) =>
          typeof data === "object" &&
          data != null &&
          (data as { type?: string }).type === "PONG",
      },
    });

    render(createElement(WsProvider, null, createElement("div")));

    await act(async () => {
      latestWs().open();
    });
    expect(latestWs().sent).toEqual([JSON.stringify({ type: "PING" })]);

    await act(async () => {
      latestWs().message({ type: "PONG" });
      await vi.advanceTimersByTimeAsync(3_000);
    });
    expect(latestWs().sent).toEqual([
      JSON.stringify({ type: "PING" }),
      JSON.stringify({ type: "PING" }),
    ]);
  });

  it("url getter is resolved on each handshake", async () => {
    vi.useFakeTimers();
    let token = "a";

    const { WsProvider } = createWsContext({
      url: () => `ws://test/${token}`,
      autoConnect: true,
      reconnectMs: 100,
    });

    render(createElement(WsProvider, null, createElement("div")));
    expect(latestWs().url).toBe("ws://test/a");

    await act(async () => {
      latestWs().open();
    });
    await act(async () => {
      latestWs().drop();
    });
    token = "b";
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(MockWebSocket.instances).toHaveLength(2);
    expect(latestWs().url).toBe("ws://test/b");
  });

  it("getter throw before connect emits error and stays idle", async () => {
    const errors: Event[] = [];

    const { WsProvider, useWsStore, useWsEvents } = createWsContext({
      url: () => {
        throw new Error("no token");
      },
      autoConnect: true,
    });

    function Probe() {
      const status = useWsStore((s) => s.status);
      const phase = useWsStore((s) => s.phase);
      useWsEvents("error", (event) => {
        errors.push(event);
      });
      return createElement(
        "div",
        { "data-status": status, "data-phase": phase },
        status,
      );
    }

    const { container, getByText } = render(
      createElement(WsProvider, null, createElement(Probe)),
    );

    expect(MockWebSocket.instances).toHaveLength(0);
    expect(getByText("idle")).toBeTruthy();
    expect(
      container.querySelector("[data-phase]")?.getAttribute("data-phase"),
    ).toBe("idle");
    expect(errors).toHaveLength(1);
    expect(errors[0]?.type).toBe("error");
  });

  it("empty url is the same as getter throw", async () => {
    const errors: Event[] = [];
    const { WsProvider, useWsStore, useWsEvents } = createWsContext({
      url: () => "",
      autoConnect: true,
    });

    function Probe() {
      const status = useWsStore((s) => s.status);
      const phase = useWsStore((s) => s.phase);
      useWsEvents("error", (event) => {
        errors.push(event);
      });
      return createElement(
        "div",
        { "data-status": status, "data-phase": phase },
        status,
      );
    }

    const { container, getByText } = render(
      createElement(WsProvider, null, createElement(Probe)),
    );

    expect(MockWebSocket.instances).toHaveLength(0);
    expect(getByText("idle")).toBeTruthy();
    expect(
      container.querySelector("[data-phase]")?.getAttribute("data-phase"),
    ).toBe("idle");
    expect(errors).toHaveLength(1);
    expect(errors[0]?.type).toBe("error");
  });

  it("getter throw while open keeps the current socket", async () => {
    let shouldThrow = false;

    const { WsProvider, useWsActions } = createWsContext({
      url: () => {
        if (shouldThrow) throw new Error("no token");
        return "ws://test";
      },
      autoConnect: true,
    });

    let api!: ReturnType<typeof useWsActions>;

    function Probe() {
      api = useWsActions();
      return null;
    }

    render(createElement(WsProvider, null, createElement(Probe)));
    const first = latestWs();
    await act(async () => {
      first.open();
    });
    expect(first.readyState).toBe(MockWebSocket.OPEN);

    shouldThrow = true;
    await act(async () => {
      api.connect();
    });
    expect(MockWebSocket.instances).toHaveLength(1);
    expect(MockWebSocket.instances[0]).toBe(first);
    expect(first.readyState).toBe(MockWebSocket.OPEN);
  });

  it("getter throw while open keeps liveness pinging", async () => {
    vi.useFakeTimers();
    let shouldThrow = false;

    const { WsProvider, useWsActions } = createWsContext({
      url: () => {
        if (shouldThrow) throw new Error("no token");
        return "ws://test";
      },
      autoConnect: true,
      liveness: {
        intervalMs: 3_000,
        timeoutMs: 10_000,
        ping: JSON.stringify({ type: "PING" }),
        isPong: () => false,
      },
    });

    let api!: ReturnType<typeof useWsActions>;

    function Probe() {
      api = useWsActions();
      return null;
    }

    render(createElement(WsProvider, null, createElement(Probe)));
    const first = latestWs();
    await act(async () => {
      first.open();
    });
    expect(first.sent).toEqual([JSON.stringify({ type: "PING" })]);

    shouldThrow = true;
    await act(async () => {
      api.connect();
    });
    expect(MockWebSocket.instances[0]).toBe(first);
    expect(first.readyState).toBe(MockWebSocket.OPEN);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000);
    });
    expect(first.sent).toEqual([
      JSON.stringify({ type: "PING" }),
      JSON.stringify({ type: "PING" }),
    ]);
  });

  it("invalid url while open keeps the current socket", async () => {
    let nextUrl = "ws://test";

    const { WsProvider, useWsActions } = createWsContext({
      url: () => nextUrl,
      autoConnect: true,
    });

    let api!: ReturnType<typeof useWsActions>;

    function Probe() {
      api = useWsActions();
      return null;
    }

    render(createElement(WsProvider, null, createElement(Probe)));
    const first = latestWs();
    await act(async () => {
      first.open();
    });

    nextUrl = "not-a-url";
    await act(async () => {
      api.connect();
    });
    expect(MockWebSocket.instances).toHaveLength(1);
    expect(MockWebSocket.instances[0]).toBe(first);
    expect(first.readyState).toBe(MockWebSocket.OPEN);
  });

  it("protocols getter is passed to WebSocket", () => {
    const { WsProvider } = createWsContext({
      url: "ws://test",
      protocols: () => "chat",
      autoConnect: true,
    });

    render(createElement(WsProvider, null, createElement("div")));
    expect(latestWs().protocols).toBe("chat");
  });

  it("getter throw on reconnect stops without retrying", async () => {
    vi.useFakeTimers();
    let shouldThrow = false;

    const { WsProvider, useWsStore } = createWsContext({
      url: () => {
        if (shouldThrow) throw new Error("no token");
        return "ws://test";
      },
      autoConnect: true,
      reconnectMs: 100,
    });

    function Probe() {
      const phase = useWsStore((s) => s.phase);
      return createElement("div", { "data-phase": phase }, phase);
    }

    const { container } = render(
      createElement(WsProvider, null, createElement(Probe)),
    );
    const phase = () =>
      container.querySelector("[data-phase]")?.getAttribute("data-phase");

    await act(async () => {
      latestWs().open();
    });
    await act(async () => {
      latestWs().drop();
    });
    expect(phase()).toBe("reconnecting");
    expect(MockWebSocket.instances).toHaveLength(1);

    shouldThrow = true;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(MockWebSocket.instances).toHaveLength(1);
    expect(phase()).toBe("stopped");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(MockWebSocket.instances).toHaveLength(1);
    expect(phase()).toBe("stopped");
  });

  it("invalid url on reconnect stops without retrying", async () => {
    vi.useFakeTimers();
    let nextUrl = "ws://test";

    const { WsProvider, useWsStore } = createWsContext({
      url: () => nextUrl,
      autoConnect: true,
      reconnectMs: 100,
    });

    function Probe() {
      const phase = useWsStore((s) => s.phase);
      return createElement("div", { "data-phase": phase }, phase);
    }

    const { container } = render(
      createElement(WsProvider, null, createElement(Probe)),
    );
    const phase = () =>
      container.querySelector("[data-phase]")?.getAttribute("data-phase");

    await act(async () => {
      latestWs().open();
    });
    await act(async () => {
      latestWs().drop();
    });
    nextUrl = "not-a-url";
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(MockWebSocket.instances).toHaveLength(1);
    expect(phase()).toBe("stopped");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(MockWebSocket.instances).toHaveLength(1);
    expect(phase()).toBe("stopped");
  });

  it("connect is a no-op without WebSocket", async () => {
    vi.stubGlobal("WebSocket", undefined);

    const errors: Event[] = [];
    const { WsProvider, useWsActions, useWsStore, useWsEvents } =
      createWsContext({
        url: "ws://test",
        autoConnect: true,
      });

    let api!: ReturnType<typeof useWsActions>;

    function Probe() {
      api = useWsActions();
      const status = useWsStore((s) => s.status);
      useWsEvents("error", (event) => {
        errors.push(event);
      });
      return createElement("div", null, status);
    }

    const { getByText } = render(
      createElement(WsProvider, null, createElement(Probe)),
    );

    expect(MockWebSocket.instances).toHaveLength(0);
    expect(getByText("idle")).toBeTruthy();
    expect(errors).toHaveLength(0);

    await act(async () => {
      api.connect();
    });
    expect(MockWebSocket.instances).toHaveLength(0);
    expect(getByText("idle")).toBeTruthy();
    expect(errors).toHaveLength(0);
  });

  it("synthetic close and error work without Event/CloseEvent constructors", async () => {
    const errors: Event[] = [];
    const closes: CloseEvent[] = [];
    let shouldThrow = false;

    const { WsProvider, useWsActions, useWsEvents } = createWsContext({
      url: () => {
        if (shouldThrow) throw new Error("no token");
        return "ws://test";
      },
      autoConnect: true,
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
    const first = latestWs();
    await act(async () => {
      first.open();
    });

    vi.stubGlobal("Event", undefined);
    vi.stubGlobal("CloseEvent", undefined);

    shouldThrow = true;
    await act(async () => {
      api.connect();
    });
    expect(errors).toHaveLength(1);
    expect(errors[0]?.type).toBe("error");
    expect(first.readyState).toBe(MockWebSocket.OPEN);

    await act(async () => {
      api.disconnect();
    });
    const clientClose = closes.find((ev) => ev.reason === "client disconnect");
    expect(clientClose?.type).toBe("close");
    expect(clientClose?.code).toBe(1000);
    expect(clientClose?.wasClean).toBe(true);
  });

  it("pong still emits message", async () => {
    const messages: unknown[] = [];
    const { WsProvider, useWsEvents } = createWsContext({
      url: "ws://test",
      autoConnect: true,
      liveness: {
        intervalMs: 3_000,
        timeoutMs: 2_000,
        ping: JSON.stringify({ type: "PING" }),
        isPong: (data) =>
          typeof data === "object" &&
          data != null &&
          (data as { type?: string }).type === "PONG",
      },
    });

    function Probe() {
      useWsEvents("message", (data) => {
        messages.push(data);
      });
      return null;
    }

    render(createElement(WsProvider, null, createElement(Probe)));
    await act(async () => {
      latestWs().open();
    });
    await act(async () => {
      latestWs().message({ type: "PONG" });
    });
    expect(messages).toEqual([{ type: "PONG" }]);
  });

  it("parse throw emits error, skips message, and keeps the socket", async () => {
    vi.useFakeTimers();
    const messages: unknown[] = [];
    const errors: Event[] = [];
    const { WsProvider, useWsStore, useWsEvents } = createWsContext({
      url: "ws://test",
      autoConnect: true,
      reconnectMs: 0,
      parse: () => {
        throw new Error("parse");
      },
      liveness: {
        intervalMs: 3_000,
        timeoutMs: 2_000,
        ping: JSON.stringify({ type: "PING" }),
        isPong: () => true,
      },
    });

    function Probe() {
      const status = useWsStore((s) => s.status);
      useWsEvents("message", (data) => {
        messages.push(data);
      });
      useWsEvents("error", (event) => {
        errors.push(event);
      });
      return createElement("div", { "data-status": status }, status);
    }

    const { container } = render(
      createElement(WsProvider, null, createElement(Probe)),
    );
    const status = () =>
      container.querySelector("[data-status]")?.getAttribute("data-status");

    await act(async () => {
      latestWs().open();
    });
    await act(async () => {
      latestWs().message({ type: "PONG" });
    });
    expect(messages).toEqual([]);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.type).toBe("error");
    expect(status()).toBe("open");
    expect(latestWs().readyState).toBe(MockWebSocket.OPEN);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });
    expect(latestWs().readyState).toBe(MockWebSocket.CLOSED);
    expect(status()).toBe("closed");
  });

  it("isPong throw still emits message and does not clear timeout", async () => {
    vi.useFakeTimers();
    const messages: unknown[] = [];
    const errors: Event[] = [];
    const { WsProvider, useWsStore, useWsEvents } = createWsContext({
      url: "ws://test",
      autoConnect: true,
      reconnectMs: 0,
      liveness: {
        intervalMs: 3_000,
        timeoutMs: 2_000,
        ping: JSON.stringify({ type: "PING" }),
        isPong: () => {
          throw new Error("isPong");
        },
      },
    });

    function Probe() {
      const status = useWsStore((s) => s.status);
      useWsEvents("message", (data) => {
        messages.push(data);
      });
      useWsEvents("error", (event) => {
        errors.push(event);
      });
      return createElement("div", { "data-status": status }, status);
    }

    const { container } = render(
      createElement(WsProvider, null, createElement(Probe)),
    );
    const status = () =>
      container.querySelector("[data-status]")?.getAttribute("data-status");

    await act(async () => {
      latestWs().open();
    });
    await act(async () => {
      latestWs().message({ hello: 1 });
    });
    expect(messages).toEqual([{ hello: 1 }]);
    expect(errors).toHaveLength(0);
    expect(status()).toBe("open");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });
    expect(latestWs().readyState).toBe(MockWebSocket.CLOSED);
    expect(status()).toBe("closed");
  });

  it("open still fires when liveness ping throws", async () => {
    vi.useFakeTimers();
    const opens: Event[] = [];
    const { WsProvider, useWsStore, useWsEvents } = createWsContext({
      url: "ws://test",
      autoConnect: true,
      reconnectMs: 100,
      reconnectBackoff: 1,
      reconnectJitter: 0,
      reconnectMinUptimeMs: 0,
      liveness: {
        intervalMs: 3_000,
        timeoutMs: 2_000,
        ping: () => {
          throw new Error("ping");
        },
        isPong: () => false,
      },
    });

    function Probe() {
      const status = useWsStore((s) => s.status);
      useWsEvents("open", (event) => {
        opens.push(event);
      });
      return createElement("div", { "data-status": status }, status);
    }

    const { container } = render(
      createElement(WsProvider, null, createElement(Probe)),
    );
    const status = () =>
      container.querySelector("[data-status]")?.getAttribute("data-status");

    await act(async () => {
      latestWs().open();
    });
    expect(status()).toBe("open");
    expect(opens).toHaveLength(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });
    expect(latestWs().readyState).toBe(MockWebSocket.CLOSED);
  });

  it("liveness timeout follows unintentional-close reconnect", async () => {
    vi.useFakeTimers();
    const { WsProvider, useWsStore } = createWsContext({
      url: "ws://test",
      autoConnect: true,
      reconnectMs: 100,
      reconnectBackoff: 1,
      reconnectJitter: 0,
      reconnectMinUptimeMs: 0,
      liveness: {
        intervalMs: 3_000,
        timeoutMs: 2_000,
        ping: JSON.stringify({ type: "PING" }),
        isPong: () => false,
      },
    });

    function Probe() {
      const status = useWsStore((s) => s.status);
      const phase = useWsStore((s) => s.phase);
      return createElement("div", {
        "data-status": status,
        "data-phase": phase,
      });
    }

    const { container } = render(
      createElement(WsProvider, null, createElement(Probe)),
    );
    const status = () =>
      container.querySelector("[data-status]")?.getAttribute("data-status");
    const phase = () =>
      container.querySelector("[data-phase]")?.getAttribute("data-phase");

    await act(async () => {
      latestWs().open();
    });
    expect(status()).toBe("open");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });
    expect(latestWs().readyState).toBe(MockWebSocket.CLOSED);
    expect(status()).toBe("closed");
    expect(phase()).toBe("reconnecting");
    expect(MockWebSocket.instances).toHaveLength(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(MockWebSocket.instances).toHaveLength(2);
    expect(phase()).toBe("reconnecting");
  });

  it("stale onclose does not mutate the current socket", async () => {
    vi.useFakeTimers();
    const closes: string[] = [];
    const { WsProvider, useWsActions, useWsStore, useWsEvents } =
      createWsContext({
        url: "ws://test",
        autoConnect: true,
        reconnectMs: 100,
        reconnectBackoff: 1,
        reconnectJitter: 0,
        reconnectMinUptimeMs: 0,
      });

    let api!: ReturnType<typeof useWsActions>;
    function Probe() {
      api = useWsActions();
      const status = useWsStore((s) => s.status);
      const phase = useWsStore((s) => s.phase);
      const reconnectAttempt = useWsStore((s) => s.reconnectAttempt);
      const nextReconnectAt = useWsStore((s) => s.nextReconnectAt);
      useWsEvents("close", (event) => {
        closes.push(event.reason || "close");
      });
      return createElement("div", {
        "data-status": status,
        "data-phase": phase,
        "data-attempt": reconnectAttempt,
        "data-next": nextReconnectAt,
      });
    }

    const { container } = render(
      createElement(WsProvider, null, createElement(Probe)),
    );
    const status = () =>
      container.querySelector("[data-status]")?.getAttribute("data-status");
    const phase = () =>
      container.querySelector("[data-phase]")?.getAttribute("data-phase");
    const attempt = () =>
      container.querySelector("[data-attempt]")?.getAttribute("data-attempt");
    const nextAt = () =>
      Number(container.querySelector("[data-next]")?.getAttribute("data-next"));

    const socketA = latestWs();
    await act(async () => {
      socketA.open();
    });
    const staleOnClose = socketA.onclose;
    expect(staleOnClose).toEqual(expect.any(Function));

    await act(async () => {
      api.connect();
    });
    const socketB = latestWs();
    expect(socketB).not.toBe(socketA);
    expect(socketA.onopen).toBeNull();
    expect(socketA.onmessage).toBeNull();
    expect(socketA.onerror).toBeNull();
    expect(socketA.onclose).toBeNull();
    expect(status()).toBe("connecting");
    expect(phase()).toBe("connecting");
    const closesAfterSwap = closes.length;
    const attemptAfterSwap = attempt();
    expect(nextAt()).toBe(0);

    await act(async () => {
      staleOnClose?.(
        new CloseEvent("close", {
          code: 1006,
          wasClean: false,
          reason: "stale",
        }),
      );
    });
    expect(status()).toBe("connecting");
    expect(phase()).toBe("connecting");
    expect(phase()).not.toBe("closed");
    expect(phase()).not.toBe("stopped");
    expect(phase()).not.toBe("reconnecting");
    expect(attempt()).toBe(attemptAfterSwap);
    expect(nextAt()).toBe(0);
    expect(closes).toHaveLength(closesAfterSwap);
    expect(closes).not.toContain("stale");
    expect(MockWebSocket.instances).toHaveLength(2);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(MockWebSocket.instances).toHaveLength(2);
    expect(status()).toBe("connecting");
    expect(phase()).toBe("connecting");
  });

  it("current socket onclose still schedules reconnect", async () => {
    vi.useFakeTimers();
    const { WsProvider, useWsStore } = createWsContext({
      url: "ws://test",
      autoConnect: true,
      reconnectMs: 100,
      reconnectBackoff: 1,
      reconnectJitter: 0,
      reconnectMinUptimeMs: 0,
    });

    function Probe() {
      const phase = useWsStore((s) => s.phase);
      const reconnectAttempt = useWsStore((s) => s.reconnectAttempt);
      return createElement("div", {
        "data-phase": phase,
        "data-attempt": reconnectAttempt,
      });
    }

    const { container } = render(
      createElement(WsProvider, null, createElement(Probe)),
    );
    const phase = () =>
      container.querySelector("[data-phase]")?.getAttribute("data-phase");
    const attempt = () =>
      container.querySelector("[data-attempt]")?.getAttribute("data-attempt");

    const socketA = latestWs();
    await act(async () => {
      socketA.open();
    });
    const onClose = socketA.onclose;
    expect(onClose).toEqual(expect.any(Function));

    await act(async () => {
      socketA.readyState = MockWebSocket.CLOSED;
      onClose?.(
        new CloseEvent("close", {
          code: 1006,
          wasClean: false,
          reason: "drop",
        }),
      );
    });
    expect(phase()).toBe("reconnecting");
    expect(attempt()).toBe("1");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(MockWebSocket.instances).toHaveLength(2);
  });

  it("fired reconnect without WebSocket becomes stopped", async () => {
    vi.useFakeTimers();
    const { WsProvider, useWsStore } = createWsContext({
      url: "ws://test",
      autoConnect: true,
      reconnectMs: 100,
      reconnectBackoff: 1,
      reconnectJitter: 0,
      reconnectMinUptimeMs: 0,
    });

    function Probe() {
      const status = useWsStore((s) => s.status);
      const phase = useWsStore((s) => s.phase);
      const nextReconnectAt = useWsStore((s) => s.nextReconnectAt);
      return createElement("div", {
        "data-status": status,
        "data-phase": phase,
        "data-next": nextReconnectAt,
      });
    }

    const { container } = render(
      createElement(WsProvider, null, createElement(Probe)),
    );
    const status = () =>
      container.querySelector("[data-status]")?.getAttribute("data-status");
    const phase = () =>
      container.querySelector("[data-phase]")?.getAttribute("data-phase");
    const nextAt = () =>
      Number(container.querySelector("[data-next]")?.getAttribute("data-next"));

    await act(async () => {
      latestWs().open();
    });
    await act(async () => {
      latestWs().drop();
    });
    expect(phase()).toBe("reconnecting");
    expect(nextAt()).toBeGreaterThan(Date.now());

    vi.stubGlobal("WebSocket", undefined);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(status()).toBe("closed");
    expect(phase()).toBe("stopped");
    expect(phase()).not.toBe("reconnecting");
    expect(nextAt()).toBe(0);
    expect(MockWebSocket.instances).toHaveLength(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(MockWebSocket.instances).toHaveLength(1);
    expect(phase()).toBe("stopped");
  });

  it("manual connect without WebSocket leaves the store unchanged", async () => {
    const { WsProvider, useWsActions, useWsStore } = createWsContext({
      url: "ws://test",
      autoConnect: true,
    });

    let api!: ReturnType<typeof useWsActions>;
    function Probe() {
      api = useWsActions();
      const status = useWsStore((s) => s.status);
      const phase = useWsStore((s) => s.phase);
      const reconnectAttempt = useWsStore((s) => s.reconnectAttempt);
      const reconnectExhausted = useWsStore((s) => s.reconnectExhausted);
      const nextReconnectAt = useWsStore((s) => s.nextReconnectAt);
      return createElement("div", {
        "data-status": status,
        "data-phase": phase,
        "data-attempt": reconnectAttempt,
        "data-exhausted": String(reconnectExhausted),
        "data-next": nextReconnectAt,
      });
    }

    const { container } = render(
      createElement(WsProvider, null, createElement(Probe)),
    );
    const snapshot = () => ({
      status: container
        .querySelector("[data-status]")
        ?.getAttribute("data-status"),
      phase: container
        .querySelector("[data-phase]")
        ?.getAttribute("data-phase"),
      attempt: container
        .querySelector("[data-attempt]")
        ?.getAttribute("data-attempt"),
      exhausted: container
        .querySelector("[data-exhausted]")
        ?.getAttribute("data-exhausted"),
      next: container.querySelector("[data-next]")?.getAttribute("data-next"),
    });

    await act(async () => {
      latestWs().open();
    });
    const before = snapshot();
    expect(before.status).toBe("open");

    vi.stubGlobal("WebSocket", undefined);
    await act(async () => {
      api.connect();
    });
    expect(snapshot()).toEqual(before);
    expect(MockWebSocket.instances).toHaveLength(1);
    expect(MockWebSocket.instances[0]?.readyState).toBe(MockWebSocket.OPEN);
    vi.stubGlobal("WebSocket", MockWebSocket);
  });

  it("getter throw after fired reconnect does not schedule another timer", async () => {
    vi.useFakeTimers();
    let shouldThrow = false;
    const { WsProvider, useWsStore } = createWsContext({
      url: () => {
        if (shouldThrow) throw new Error("no token");
        return "ws://test";
      },
      autoConnect: true,
      reconnectMs: 100,
      reconnectBackoff: 1,
      reconnectJitter: 0,
      reconnectMinUptimeMs: 0,
    });

    function Probe() {
      const phase = useWsStore((s) => s.phase);
      const nextReconnectAt = useWsStore((s) => s.nextReconnectAt);
      return createElement("div", {
        "data-phase": phase,
        "data-next": nextReconnectAt,
      });
    }

    const { container } = render(
      createElement(WsProvider, null, createElement(Probe)),
    );
    const phase = () =>
      container.querySelector("[data-phase]")?.getAttribute("data-phase");
    const nextAt = () =>
      Number(container.querySelector("[data-next]")?.getAttribute("data-next"));

    await act(async () => {
      latestWs().open();
    });
    await act(async () => {
      latestWs().drop();
    });
    expect(phase()).toBe("reconnecting");

    shouldThrow = true;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(phase()).toBe("stopped");
    expect(nextAt()).toBe(0);
    expect(MockWebSocket.instances).toHaveLength(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(MockWebSocket.instances).toHaveLength(1);
    expect(phase()).toBe("stopped");
    expect(nextAt()).toBe(0);
  });

  it("disconnect while waiting then connect is connecting", async () => {
    vi.useFakeTimers();
    const { WsProvider, useWsActions, useWsStore } = createWsContext({
      url: "ws://test",
      autoConnect: true,
      reconnectMs: 100,
      reconnectBackoff: 1,
      reconnectJitter: 0,
      reconnectMinUptimeMs: 0,
    });

    let api!: ReturnType<typeof useWsActions>;
    function Probe() {
      api = useWsActions();
      const phase = useWsStore((s) => s.phase);
      return createElement("div", { "data-phase": phase });
    }

    const { container } = render(
      createElement(WsProvider, null, createElement(Probe)),
    );
    const phase = () =>
      container.querySelector("[data-phase]")?.getAttribute("data-phase");

    await act(async () => {
      latestWs().open();
    });
    await act(async () => {
      latestWs().drop();
    });
    expect(phase()).toBe("reconnecting");

    await act(async () => {
      api.disconnect();
    });
    expect(phase()).toBe("idle");

    await act(async () => {
      api.connect();
    });
    expect(phase()).toBe("connecting");
    expect(MockWebSocket.instances).toHaveLength(2);
  });

  it("handshake error handler disconnect stays idle", async () => {
    vi.useFakeTimers();
    let shouldThrow = false;
    const { WsProvider, useWsActions, useWsStore, useWsEvents } =
      createWsContext({
        url: () => {
          if (shouldThrow) throw new Error("no token");
          return "ws://test";
        },
        autoConnect: true,
        reconnectMs: 100,
        reconnectBackoff: 1,
        reconnectJitter: 0,
        reconnectMinUptimeMs: 0,
      });

    let api!: ReturnType<typeof useWsActions>;
    function Probe() {
      api = useWsActions();
      const status = useWsStore((s) => s.status);
      const phase = useWsStore((s) => s.phase);
      useWsEvents("error", () => {
        api.disconnect();
      });
      return createElement("div", {
        "data-status": status,
        "data-phase": phase,
      });
    }

    const { container } = render(
      createElement(WsProvider, null, createElement(Probe)),
    );
    const status = () =>
      container.querySelector("[data-status]")?.getAttribute("data-status");
    const phase = () =>
      container.querySelector("[data-phase]")?.getAttribute("data-phase");

    await act(async () => {
      latestWs().open();
    });
    await act(async () => {
      latestWs().drop();
    });
    expect(phase()).toBe("reconnecting");

    shouldThrow = true;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(status()).toBe("closed");
    expect(phase()).toBe("idle");
  });

  it("handshake error handler throw still stops auto-retry", async () => {
    vi.useFakeTimers();
    let shouldThrow = false;
    const { WsProvider, useWsStore, useWsEvents } = createWsContext({
      url: () => {
        if (shouldThrow) throw new Error("no token");
        return "ws://test";
      },
      autoConnect: true,
      reconnectMs: 100,
      reconnectBackoff: 1,
      reconnectJitter: 0,
      reconnectMinUptimeMs: 0,
    });

    function Probe() {
      const status = useWsStore((s) => s.status);
      const phase = useWsStore((s) => s.phase);
      useWsEvents("error", () => {
        throw new Error("handler");
      });
      return createElement("div", {
        "data-status": status,
        "data-phase": phase,
      });
    }

    const { container } = render(
      createElement(WsProvider, null, createElement(Probe)),
    );
    const status = () =>
      container.querySelector("[data-status]")?.getAttribute("data-status");
    const phase = () =>
      container.querySelector("[data-phase]")?.getAttribute("data-phase");

    await act(async () => {
      latestWs().open();
    });
    await act(async () => {
      latestWs().drop();
    });
    expect(phase()).toBe("reconnecting");

    shouldThrow = true;
    await act(async () => {
      try {
        await vi.advanceTimersByTimeAsync(100);
      } catch {
        // error handler 擲出不該擋住連線層停重試
      }
    });
    expect(status()).toBe("closed");
    expect(phase()).toBe("stopped");
    expect(phase()).not.toBe("reconnecting");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(MockWebSocket.instances).toHaveLength(1);
    expect(phase()).toBe("stopped");
  });

  it("close handler throw still takes over the new socket", async () => {
    const { WsProvider, useWsActions, useWsStore, useWsEvents } =
      createWsContext({
        url: "ws://test",
        autoConnect: true,
      });

    let api!: ReturnType<typeof useWsActions>;
    function Probe() {
      api = useWsActions();
      const status = useWsStore((s) => s.status);
      const phase = useWsStore((s) => s.phase);
      useWsEvents("close", (event) => {
        if (event.reason === "reconnect") {
          throw new Error("handler");
        }
      });
      return createElement(
        "div",
        { "data-status": status, "data-phase": phase },
        status,
      );
    }

    const { container, getByText } = render(
      createElement(WsProvider, null, createElement(Probe)),
    );
    const status = () =>
      container.querySelector("[data-status]")?.getAttribute("data-status");
    const phase = () =>
      container.querySelector("[data-phase]")?.getAttribute("data-phase");

    await act(async () => {
      latestWs().open();
    });
    expect(getByText("open")).toBeTruthy();

    await act(async () => {
      try {
        api.connect();
      } catch {
        // close handler 擲出不該擋住改用新 socket
      }
    });
    expect(MockWebSocket.instances).toHaveLength(2);
    expect(status()).toBe("connecting");
    expect(phase()).toBe("connecting");

    await act(async () => {
      latestWs().open();
    });
    expect(status()).toBe("open");
    expect(phase()).toBe("open");
  });

  it("close handler disconnect stays idle", async () => {
    const { WsProvider, useWsActions, useWsStore, useWsEvents } =
      createWsContext({
        url: "ws://test",
        autoConnect: true,
      });

    let api!: ReturnType<typeof useWsActions>;
    function Probe() {
      api = useWsActions();
      const status = useWsStore((s) => s.status);
      const phase = useWsStore((s) => s.phase);
      useWsEvents("close", (event) => {
        if (event.reason === "reconnect") {
          api.disconnect();
        }
      });
      return createElement(
        "div",
        { "data-status": status, "data-phase": phase },
        status,
      );
    }

    const { container, getByText } = render(
      createElement(WsProvider, null, createElement(Probe)),
    );
    const status = () =>
      container.querySelector("[data-status]")?.getAttribute("data-status");
    const phase = () =>
      container.querySelector("[data-phase]")?.getAttribute("data-phase");

    await act(async () => {
      latestWs().open();
    });
    expect(getByText("open")).toBeTruthy();

    await act(async () => {
      api.connect();
    });
    expect(MockWebSocket.instances).toHaveLength(2);
    expect(status()).toBe("closed");
    expect(phase()).toBe("idle");
    expect(latestWs().readyState).toBe(MockWebSocket.CLOSED);

    await act(async () => {
      latestWs().open();
    });
    expect(status()).toBe("closed");
    expect(phase()).toBe("idle");
  });

  it("close handler connect takes over the nested socket", async () => {
    const { WsProvider, useWsActions, useWsStore, useWsEvents } =
      createWsContext({
        url: "ws://test",
        autoConnect: true,
      });

    let api!: ReturnType<typeof useWsActions>;
    function Probe() {
      api = useWsActions();
      const status = useWsStore((s) => s.status);
      const phase = useWsStore((s) => s.phase);
      useWsEvents("close", (event) => {
        if (event.reason === "reconnect") {
          api.connect();
        }
      });
      return createElement(
        "div",
        { "data-status": status, "data-phase": phase },
        status,
      );
    }

    const { container, getByText } = render(
      createElement(WsProvider, null, createElement(Probe)),
    );
    const status = () =>
      container.querySelector("[data-status]")?.getAttribute("data-status");
    const phase = () =>
      container.querySelector("[data-phase]")?.getAttribute("data-phase");

    await act(async () => {
      latestWs().open();
    });
    expect(getByText("open")).toBeTruthy();

    await act(async () => {
      api.connect();
    });
    expect(MockWebSocket.instances).toHaveLength(3);
    const nested = latestWs();
    const abandoned = MockWebSocket.instances[1]!;
    expect(abandoned.readyState).toBe(MockWebSocket.CLOSED);
    expect(nested.readyState).toBe(MockWebSocket.CONNECTING);
    expect(status()).toBe("connecting");
    expect(phase()).toBe("connecting");

    await act(async () => {
      nested.open();
    });
    expect(status()).toBe("open");
    expect(phase()).toBe("open");
  });
});
