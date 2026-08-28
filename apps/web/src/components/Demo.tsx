"use client";

import { useState } from "react";
import {
  WsProvider,
  useWsActions,
  useWsStore,
  useWsEvents,
  DEMO_WS_RECONNECT_MAX,
} from "@/components/demo-ws";
import { createStallMessage } from "react-ws-context/stall";
import type { WsStatus } from "react-ws-context";

function formatReconnectLabel(
  attempt: number,
  max: number,
  status: WsStatus,
  exhausted: boolean,
): string {
  if (max <= 0) return attempt > 0 ? `${attempt}（不限）` : "—";
  const base = `${attempt}/${max}`;
  if (exhausted) return `${max}/${max}（已達上限）`;
  if (attempt === 0) return base;
  if (status === "connecting") return `${base}（重連中）`;
  return base;
}

function DemoPanel() {
  const { sendJson, connect, disconnect } = useWsActions();
  const status = useWsStore((state) => state.status);
  const reconnectAttempt = useWsStore((state) => state.reconnectAttempt);
  const reconnectExhausted = useWsStore((state) => state.reconnectExhausted);
  const reconnectLabel = formatReconnectLabel(
    reconnectAttempt,
    DEMO_WS_RECONNECT_MAX,
    status,
    reconnectExhausted,
  );
  const [lastMessage, setLastMessage] = useState<unknown>(null);
  const [text, setText] = useState("hello");

  useWsEvents("message", (data) => setLastMessage(data));
  useWsEvents("open", () => console.log("open"));
  useWsEvents("error", () => console.log("error"));
  useWsEvents("close", () => console.log("close"));

  return (
    <div className="flex max-w-md flex-col gap-3">
      <p>
        狀態：<span className="font-mono">{status}</span>
      </p>
      <p>
        重連：<span className="font-mono">{reconnectLabel}</span>
      </p>
      <div className="flex gap-2">
        <button type="button" className="btn btn-sm" onClick={connect}>
          連線
        </button>
        <button type="button" className="btn btn-sm" onClick={disconnect}>
          斷線
        </button>
      </div>
      <div className="flex gap-2">
        <input
          className="input input-bordered input-sm flex-1"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <button
          type="button"
          className="btn btn-primary btn-sm"
          disabled={status !== "open"}
          onClick={() => sendJson({ type: "CHAT", payload: text })}
        >
          送 CHAT
        </button>
      </div>
      <pre className="bg-base-200 overflow-auto rounded p-2 text-xs">
        {lastMessage == null
          ? "尚無訊息"
          : JSON.stringify(lastMessage, null, 2)}
      </pre>
      <div className="border-base-300 flex flex-col gap-2 border-t pt-3">
        <p className="text-sm font-semibold">停滯（測試過期連線）</p>
        <div className="flex gap-2">
          <button
            type="button"
            className="btn btn-outline btn-xs"
            disabled={status !== "open"}
            onClick={() => sendJson(createStallMessage("stall"))}
          >
            停滯
          </button>
          <button
            type="button"
            className="btn btn-outline btn-xs"
            disabled={status !== "open"}
            onClick={() => sendJson(createStallMessage("release"))}
          >
            恢復
          </button>
        </div>
      </div>
    </div>
  );
}

export default function Demo() {
  return (
    <WsProvider>
      <DemoPanel />
    </WsProvider>
  );
}
