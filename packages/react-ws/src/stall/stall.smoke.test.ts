import { describe, expect, it } from "vitest";
import { createStallMessage, parseStallMessage } from "./index";

describe("停滯訊息", () => {
  it("createStallMessage round-trips through parseStallMessage", () => {
    for (const action of ["stall", "release"] as const) {
      const msg = createStallMessage(action);
      expect(parseStallMessage(msg)).toEqual(msg);
    }
    expect(parseStallMessage({ type: "CHAT" })).toBeNull();
  });
});
