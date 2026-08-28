import { STALL_MESSAGE_TYPE } from "./constants";
import type { StallAction, StallMessage } from "./types";

/** 建立可 `sendJson` 的停滯控制訊息 */
export function createStallMessage(action: StallAction): StallMessage {
  return { type: STALL_MESSAGE_TYPE, action };
}

/**
 * 從 `useWsEvents("message", …)` 的 `data` 解析停滯訊息。
 * 格式不符回傳 `null`。
 */
export function parseStallMessage(data: unknown): StallMessage | null {
  if (typeof data !== "object" || data == null) return null;
  const msg = data as Record<string, unknown>;
  if (msg.type !== STALL_MESSAGE_TYPE) return null;
  if (msg.action === "stall" || msg.action === "release") {
    return { type: STALL_MESSAGE_TYPE, action: msg.action };
  }
  return null;
}
