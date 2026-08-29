import { describe, expect, it, vi } from "vitest";
import { createStore } from "./store";

describe("store", () => {
  it("setState skips notify when partial values unchanged", () => {
    const store = createStore({ status: "open" as "open" | "closed", n: 1 });
    const listener = vi.fn();
    store.subscribe(listener);

    store.setState({ status: "open" });
    expect(listener).not.toHaveBeenCalled();

    store.setState({ status: "closed" });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(store.getState().status).toBe("closed");
  });
});
