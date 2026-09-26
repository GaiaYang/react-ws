import { describe, expect, it, vi } from "vitest";
import { createStore } from "./store";

describe("store", () => {
  it("setState skips notify only when the same state reference is returned", () => {
    const store = createStore({ status: "open" as "open" | "closed", n: 1 });
    const listener = vi.fn();
    store.subscribe(listener);

    store.setState((state) => state);
    expect(listener).not.toHaveBeenCalled();
    expect(store.getState()).toEqual({ status: "open", n: 1 });

    store.setState({ status: "open" });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(store.getState()).toEqual({ status: "open", n: 1 });

    store.setState({ status: "closed" });
    expect(listener).toHaveBeenCalledTimes(2);
    expect(store.getState()).toEqual({ status: "closed", n: 1 });
  });
});
