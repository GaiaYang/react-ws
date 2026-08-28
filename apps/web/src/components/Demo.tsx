"use client";

import { useState } from "react";
import {
  WsProvider,
  useWsActions,
  useWsStore,
  useWsEvents,
} from "@/components/demo-ws";
import { createStallMessage } from "react-ws-context/stall";

function DemoPanel() {
  const { sendJson, connect, disconnect } = useWsActions();
  const status = useWsStore((state) => state.status);
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
