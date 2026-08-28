// 最小 smoke：MockWebSocket + RTL，覆蓋連線層主路徑。
// 跑：pnpm test（在 packages/react-ws）

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
  readyState = MockWebSocket.CONNECTING;
  sent: Array<string | ArrayBufferLike | Blob | ArrayBufferView> = [];
  onopen: WsListener = null;
  onmessage: WsListener = null;
  onerror: WsListener = null;
  onclose: WsListener = null;

  constructor(url: string, _protocols?: string | string[]) {
    this.url = url;
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

  /** 測試用：模擬伺服器開通 */
  open(): void {
    this.readyState = MockWebSocket.OPEN;
    this.onopen?.(new Event("open"));
  }

  /** 測試用：模擬收到訊息 */
  message(data: unknown): void {
    const payload = typeof data === "string" ? data : JSON.stringify(data);
    this.onmessage?.(new MessageEvent("message", { data: payload }));
  }

  /** 測試用：模擬非預期斷線（可觸發重連） */
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

describe("createWsContext smoke", () => {
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
          "data-get": getStatus(),
          onClick: () => {
            sendJson({ type: "ping" });
            disconnect();
          },
        },
        status,
      );
    }

    const { getByText } = render(
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
    expect(closes.some((r) => r === "client disconnect")).toBe(true);
    // intentional disconnect 不排程重連
    expect(MockWebSocket.instances).toHaveLength(1);
  });

  it("unexpected close → reconnect", async () => {
    vi.useFakeTimers();

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
    expect(getByText("open")).toBeTruthy();
    expect(attempt()).toBe("0");

    await act(async () => {
      latestWs().drop();
    });
    expect(getByText("closed")).toBeTruthy();
    expect(attempt()).toBe("1");
    expect(MockWebSocket.instances).toHaveLength(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(MockWebSocket.instances).toHaveLength(2);

    await act(async () => {
      latestWs().open();
    });
    expect(getByText("open")).toBeTruthy();
    expect(attempt()).toBe("0");
  });

  it("stops after reconnectMax and connect() retries", async () => {
    vi.useFakeTimers();

    const { WsProvider, useWsActions, useWsStore } = createWsContext({
      url: "ws://test",
      autoConnect: true,
      reconnectMs: 100,
      reconnectMax: 2,
    });

    let api!: ReturnType<typeof useWsActions>;

    function Probe() {
      api = useWsActions();
      const status = useWsStore((s) => s.status);
      const reconnectAttempt = useWsStore((s) => s.reconnectAttempt);
      const reconnectExhausted = useWsStore((s) => s.reconnectExhausted);
      return createElement(
        "div",
        {
          "data-status": status,
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
    expect(attempt()).toBe("2");
    expect(exhausted()).toBe("true");

    await act(async () => {
      api.connect();
    });
    expect(MockWebSocket.instances).toHaveLength(4);
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

  it("outgoing queue flushes on open, clears on disconnect", async () => {
    vi.useFakeTimers();

    const { WsProvider, useWsActions, useWsStore } = createWsContext({
      url: "ws://test",
      autoConnect: true,
      reconnectMs: 100,
      outgoingQueueMax: 2,
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

    expect(api.sendJson({ n: 1 })).toBe(true);
    expect(api.sendJson({ n: 2 })).toBe(true);
    expect(api.sendJson({ n: 3 })).toBe(false); // 滿

    await act(async () => {
      latestWs().open();
    });
    expect(getByText("open")).toBeTruthy();
    expect(latestWs().sent).toEqual([
      JSON.stringify({ n: 1 }),
      JSON.stringify({ n: 2 }),
    ]);

    await act(async () => {
      latestWs().drop();
    });
    expect(api.sendJson({ n: 4 })).toBe(true);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
      latestWs().open();
    });
    expect(latestWs().sent).toEqual([JSON.stringify({ n: 4 })]);

    await act(async () => {
      api.sendJson({ n: 5 });
      api.disconnect();
    });
    // disconnect 清空佇列；已送出的仍在上一顆 socket 的 sent 裡
    expect(api.sendJson({ n: 6 })).toBe(true); // 未連線但佇列空，可再入隊
    expect(MockWebSocket.instances).toHaveLength(2); // 無重連
  });

  it("liveness sends ping on interval when open", async () => {
    vi.useFakeTimers();

    const { WsProvider } = createWsContext({
      url: "ws://test",
      autoConnect: true,
      liveness: {
        intervalMs: 3_000,
        timeoutMs: 2_000,
        ping: { type: "PING" },
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
});
