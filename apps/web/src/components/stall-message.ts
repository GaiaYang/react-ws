const STALL_MESSAGE_TYPE = "STALL" as const;
type StallAction = "stall" | "release";

/** Demo 停滯控制訊息；字串須與 `apps/mock-ws/src/stall.ts` 一致 */
export function createStallMessage(action: StallAction) {
  return { type: STALL_MESSAGE_TYPE, action };
}
