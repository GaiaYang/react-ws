"use client";

import { useEffect, useState } from "react";
import {
  WsProvider,
  useWsActions,
  useWsStore,
  useWsEvents,
  DEMO_WS_RECONNECT_MAX,
} from "@/components/demo-ws";
import { createStallMessage } from "@/components/stall-message";
import type { WsPhase, WsStatus } from "react-ws-context";

const PHASE_BADGE: Record<WsPhase, { label: string; className: string }> = {
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
          ? `第 ${attempt} / ${max} 次自動重連，正在嘗試連線…`
          : `第 ${attempt} 次自動重連，正在嘗試連線…`;
      }
      return max > 0
        ? `第 ${attempt} / ${max} 次自動重連，等待計時器觸發…`
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

/** 各自訂閱需要的欄位；倒數的 100ms tick 留在 `ReconnectCountdownRow`，才不會拖著整個面板重繪。 */
function PhaseHeader() {
  const phase = useWsStore((state) => state.phase);
  const status = useWsStore((state) => state.status);
  const reconnectAttempt = useWsStore((state) => state.reconnectAttempt);
  const reconnectExhausted = useWsStore((state) => state.reconnectExhausted);
  const badge = PHASE_BADGE[phase];

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <span className="text-base-content/70 text-sm">Provider</span>
        <span className={`badge badge-sm ${badge.className}`}>
          {badge.label}
        </span>
        <span className="text-base-content/50 font-mono text-xs">{phase}</span>
      </div>
      <p className="text-sm">
        {formatPhaseDetail(
          phase,
          status,
          reconnectAttempt,
          DEMO_WS_RECONNECT_MAX,
          reconnectExhausted,
        )}
      </p>
    </div>
  );
}

function StatusRow() {
  const status = useWsStore((state) => state.status);

  return (
    <>
      <dt className="text-base-content/60">socket status</dt>
      <dd className="font-mono">{status}</dd>
    </>
  );
}

function ReconnectAttemptRow() {
  const reconnectAttempt = useWsStore((state) => state.reconnectAttempt);
  const reconnectExhausted = useWsStore((state) => state.reconnectExhausted);

  return (
    <>
      <dt className="text-base-content/60">重連次數</dt>
      <dd className="font-mono">
        {`${reconnectAttempt} / ${DEMO_WS_RECONNECT_MAX}`}
        {reconnectExhausted ? "（已達上限）" : ""}
      </dd>
    </>
  );
}

const formatSeconds = (ms: number) => `${(ms / 1000).toFixed(1)}s`;

/** 每 100ms 更新，隔離在自己的元件裡，其餘 UI 不受影響 */
function ReconnectCountdownRow() {
  const nextReconnectAt = useWsStore((state) => state.nextReconnectAt);
  const [tick, setTick] = useState({ at: 0, startedAt: 0, now: 0 });

  useEffect(() => {
    if (nextReconnectAt === 0) return;
    // 排程當下到 nextReconnectAt 的距離就是這次退避＋抖動算出的等待長度
    const startedAt = Date.now();
    const id = setInterval(
      () => setTick({ at: nextReconnectAt, startedAt, now: Date.now() }),
      100,
    );
    return () => clearInterval(id);
  }, [nextReconnectAt]);

  const countdown =
    tick.at === nextReconnectAt
      ? {
          totalMs: nextReconnectAt - tick.startedAt,
          remainingMs: Math.max(nextReconnectAt - tick.now, 0),
        }
      : null;

  return (
    <>
      <dt className="text-base-content/60">重連倒數</dt>
      <dd className="font-mono">
        {countdown
          ? `${formatSeconds(countdown.remainingMs)} / ${formatSeconds(countdown.totalMs)}`
          : "—"}
      </dd>
    </>
  );
}

function ConnectionButtons() {
  const { connect, disconnect } = useWsActions();
  const phase = useWsStore((state) => state.phase);
  const canConnect = phase === "idle" || phase === "stopped";
  const canDisconnect =
    phase === "open" || phase === "connecting" || phase === "reconnecting";

  return (
    <div className="flex gap-2">
      <button
        type="button"
        className="btn btn-sm"
        disabled={!canConnect}
        title={canConnect ? "手動建立連線" : "連線中或已連線時無法再次連線"}
        onClick={connect}
      >
        連線
      </button>
      <button
        type="button"
        className="btn btn-sm"
        disabled={!canDisconnect}
        title={canDisconnect ? "主動斷線並取消自動重連" : "尚未連線，無法斷線"}
        onClick={disconnect}
      >
        斷線
      </button>
    </div>
  );
}

/** 輸入框的 state 留在這裡，打字不會重繪狀態面板 */
function ChatSender() {
  const { sendJson } = useWsActions();
  const phase = useWsStore((state) => state.phase);
  const [text, setText] = useState("hello");

  return (
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
  );
}

/** 訊息走 event，不進 store：只有這個元件會隨訊息重繪 */
function LastMessage() {
  const [lastMessage, setLastMessage] = useState<unknown>(null);

  useWsEvents("message", (data) => setLastMessage(data));

  return (
    <pre className="bg-base-200 overflow-auto rounded p-2 text-xs">
      {lastMessage == null ? "尚無訊息" : JSON.stringify(lastMessage, null, 2)}
    </pre>
  );
}

function StallControls() {
  const { sendJson } = useWsActions();
  const phase = useWsStore((state) => state.phase);

  return (
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
  );
}

/** 只負責版面與事件記錄，沒有訂閱任何 store 欄位，因此掛載後不再重繪 */
function DemoPanel() {
  useWsEvents("open", () => console.log("open"));
  useWsEvents("error", () => console.log("error"));
  useWsEvents("close", () => console.log("close"));

  return (
    <div className="flex max-w-md flex-col gap-3">
      <PhaseHeader />

      <dl className="bg-base-200 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded p-2 text-xs">
        <StatusRow />
        <ReconnectAttemptRow />
        <ReconnectCountdownRow />
      </dl>

      <ConnectionButtons />
      <ChatSender />
      <LastMessage />
      <StallControls />
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
