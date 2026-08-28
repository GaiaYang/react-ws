/** 協議字串須與 react-ws-context/stall/constants.ts 一致（mock 不依賴 react-ws-context） */
const STALL_MESSAGE_TYPE = "STALL";
const STALL_ACK_TYPE = "STALL_ACK";

/**
 * 停滯控制行為
 *
 * - `stall`：進入停滯；
 * - `release`：恢復正常
 */
type StallAction = "stall" | "release";

/** 停滯狀態 */
interface StallState {
  /** 是否處於停滯中 */
  active: boolean;
}

/** 解析停滯控制訊息 */
function parseStallMessage(data: unknown): { action: StallAction } | null {
  if (typeof data !== "object" || data == null) return null;
  const msg = data as Record<string, unknown>;
  if (msg.type !== STALL_MESSAGE_TYPE) return null;
  if (msg.action === "stall" || msg.action === "release") {
    return { action: msg.action };
  }
  return null;
}

/** 建立停滯狀態 */
export function createStallState(): StallState {
  return { active: false };
}

/** WebSocket 接口 */
interface StallAckSocket {
  send(data: string): void;
}

/**
 * message handler 開頭呼叫。
 * - `"handled"`：停滯控制訊息已處理
 * - `"suppressed"`：停滯中，略過業務邏輯
 * - `false`：交給業務 handler
 */
export function interceptStallMessage(
  socket: StallAckSocket,
  state: StallState,
  raw: string,
): false | "handled" | "suppressed" {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return false;
  }

  const message = parseStallMessage(parsed);
  if (message) {
    state.active = message.action === "stall";
    socket.send(
      JSON.stringify({
        type: STALL_ACK_TYPE,
        action: message.action,
        active: state.active,
      }),
    );
    return "handled";
  }

  if (state.active) return "suppressed";
  return false;
}
