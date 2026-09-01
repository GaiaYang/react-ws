import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createReconnect } from "./reconnect";

function createCallbacks() {
  let attempt = 0;
  let exhausted = false;
  return {
    refs: {
      get attempt() {
        return attempt;
      },
      get exhausted() {
        return exhausted;
      },
    },
    callbacks: {
      getAttempt: () => attempt,
      setAttempt: (n: number) => {
        attempt = n;
      },
      setExhausted: (v: boolean) => {
        exhausted = v;
      },
    },
  };
}

describe("reconnect", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("schedules reconnect and resets attempt on open", () => {
    const { refs, callbacks } = createCallbacks();
    const onReconnect = vi.fn();

    const reconnect = createReconnect(100, 0, callbacks);
    reconnect.bindOnReconnect(onReconnect);

    reconnect.onConnectBegin();
    expect(refs.attempt).toBe(0);
    expect(reconnect.scheduleAfterClose()).toBe(true);
    expect(refs.attempt).toBe(1);

    vi.advanceTimersByTime(100);
    expect(onReconnect).toHaveBeenCalledTimes(1);

    reconnect.onConnectBegin();
    expect(refs.attempt).toBe(1);
    reconnect.onOpen();
    expect(refs.attempt).toBe(0);
    expect(refs.exhausted).toBe(false);
  });

  it("stops after reconnectMax, sets exhausted, manual connect resets", () => {
    const { refs, callbacks } = createCallbacks();
    const onReconnect = vi.fn();

    const reconnect = createReconnect(100, 2, callbacks);
    reconnect.bindOnReconnect(onReconnect);

    reconnect.onConnectBegin();
    expect(reconnect.scheduleAfterClose()).toBe(true);
    vi.advanceTimersByTime(100);
    reconnect.onConnectBegin();
    expect(reconnect.scheduleAfterClose()).toBe(true);
    vi.advanceTimersByTime(100);
    reconnect.onConnectBegin();
    expect(reconnect.scheduleAfterClose()).toBe(false);
    expect(refs.attempt).toBe(2);
    expect(refs.exhausted).toBe(true);
    expect(onReconnect).toHaveBeenCalledTimes(2);

    reconnect.onConnectBegin();
    expect(refs.attempt).toBe(0);
    expect(refs.exhausted).toBe(false);
  });

  it("cancel prevents schedules and resets attempt", () => {
    const { refs, callbacks } = createCallbacks();

    const reconnect = createReconnect(100, 0, callbacks);
    reconnect.bindOnReconnect(vi.fn());

    reconnect.scheduleAfterClose();
    expect(refs.attempt).toBe(1);

    reconnect.cancel();
    expect(reconnect.scheduleAfterClose()).toBe(false);
    expect(refs.attempt).toBe(0);
    expect(refs.exhausted).toBe(false);
  });

  it("clearTimerTrigger only after the timer has fired", () => {
    const { refs, callbacks } = createCallbacks();
    const onReconnect = vi.fn();

    const reconnect = createReconnect(100, 0, callbacks);
    reconnect.bindOnReconnect(onReconnect);

    reconnect.onConnectBegin();
    expect(reconnect.scheduleAfterClose()).toBe(true);
    expect(reconnect.clearTimerTrigger()).toBe(false);

    vi.advanceTimersByTime(100);
    expect(onReconnect).toHaveBeenCalledTimes(1);
    expect(reconnect.clearTimerTrigger()).toBe(true);
    expect(refs.attempt).toBe(1);

    reconnect.onConnectBegin();
    expect(refs.attempt).toBe(0);
  });

  it("reconnectMs 0 disables scheduling", () => {
    const { callbacks } = createCallbacks();

    const reconnect = createReconnect(0, 5, callbacks);
    reconnect.bindOnReconnect(vi.fn());

    expect(reconnect.scheduleAfterClose()).toBe(false);
  });
});
