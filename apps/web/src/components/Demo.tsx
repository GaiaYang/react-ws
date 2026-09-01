"use client";

import { useState } from "react";
import {
  WsProvider,
  useWsActions,
  useWsStore,
  useWsEvents,
  DEMO_WS_RECONNECT_MAX,
} from "@/components/demo-ws";
import { createStallMessage } from "@/components/stall-message";
import type { WsPhase, WsStatus } from "react-ws-context";

const PHASE_BADGE: Record<
  WsPhase,
  { label: string; className: string }
> = {
  idle: { label: "閒置", className: "badge-ghost" },
  connecting: { label: "連線中", className: "badge-info" },
  open: { label: "已連線", className: "badge-success" },
  reconnecting: { label: "重連中", className: "badge-warning" },
  stopped: { label: "已停止", className: "badge-error" },
};

function formatPhaseDetail(
  phase: WsPhase,
  status: WsStatus,
  attempt: number,
  max: number,
  exhausted: boolean,
): string {
  switch (phase) {
    case "idle":
      return "Provider 未連線，也未排程自動重連。";
    case "connecting":
      return "正在建立連線（首次或手動 connect）。";
    case "open":
      return "連線已建立，可收發訊息。";
    case "reconnecting":
      if (status === "connecting") {
        return max > 0
          ? `第 ${attempt}/${max} 次自動重連，正在嘗試連線…`
          : `第 ${attempt} 次自動重連，正在嘗試連線…`;
      }
      return max > 0
        ? `第 ${attempt}/${max} 次自動重連，等待計時器觸發…`
        : `第 ${attempt} 次自動重連，等待計時器觸發…`;
    case "stopped":
      if (exhausted) {
        return `自動重連已達上限（${max} 次），需手動 connect 重試。`;
      }
      return "不會再自動重連（未啟用重連，或握手失敗）。需手動 connect。";
    default: {
      const _exhaustive: never = phase;
      return _exhaustive;
    }
  }
}

function DemoPanel() {
  const { sendJson, connect, disconnect } = useWsActions();
  const phase = useWsStore((state) => state.phase);
  const status = useWsStore((state) => state.status);
  const reconnectAttempt = useWsStore((state) => state.reconnectAttempt);
  const reconnectExhausted = useWsStore((state) => state.reconnectExhausted);
  const phaseDetail = formatPhaseDetail(
    phase,
    status,
    reconnectAttempt,
    DEMO_WS_RECONNECT_MAX,
    reconnectExhausted,
  );
  const badge = PHASE_BADGE[phase];
  const canConnect = phase === "idle" || phase === "stopped";
  const canDisconnect =
    phase === "open" || phase === "connecting" || phase === "reconnecting";
  const [lastMessage, setLastMessage] = useState<unknown>(null);
  const [text, setText] = useState("hello");

  useWsEvents("message", (data) => setLastMessage(data));
  useWsEvents("open", () => console.log("open"));
  useWsEvents("error", () => console.log("error"));
  useWsEvents("close", () => console.log("close"));

  return (
    <div className="flex max-w-md flex-col gap-3">
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <span className="text-sm text-base-content/70">Provider</span>
          <span className={`badge badge-sm ${badge.className}`}>
            {badge.label}
          </span>
          <span className="font-mono text-xs text-base-content/50">
            {phase}
          </span>
        </div>
        <p className="text-sm">{phaseDetail}</p>
      </div>

      <dl className="bg-base-200 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded p-2 text-xs">
        <dt className="text-base-content/60">socket status</dt>
        <dd className="font-mono">{status}</dd>
        <dt className="text-base-content/60">重連次數</dt>
        <dd className="font-mono">
          {reconnectAttempt}/{DEMO_WS_RECONNECT_MAX}
          {reconnectExhausted ? "（已達上限）" : ""}
        </dd>
      </dl>

      <div className="flex gap-2">
        <button
          type="button"
          className="btn btn-sm"
          disabled={!canConnect}
          title={
            canConnect
              ? "手動建立連線"
              : "連線中或已連線時無法再次連線"
          }
          onClick={connect}
        >
          連線
        </button>
        <button
          type="button"
          className="btn btn-sm"
          disabled={!canDisconnect}
          title={
            canDisconnect
              ? "主動斷線並取消自動重連"
              : "尚未連線，無法斷線"
          }
          onClick={disconnect}
        >
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
          disabled={phase !== "open"}
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
            disabled={phase !== "open"}
            onClick={() => sendJson(createStallMessage("stall"))}
          >
            停滯
          </button>
          <button
            type="button"
            className="btn btn-outline btn-xs"
            disabled={phase !== "open"}
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
