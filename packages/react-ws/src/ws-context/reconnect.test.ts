import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createReconnect,
  reconnectDelay,
  type ReconnectPatch,
} from "./reconnect";

function createApply() {
  let attempt = 0;
  let exhausted = false;
  let nextAt = 0;
  return {
    refs: {
      get attempt() {
        return attempt;
      },
      get exhausted() {
        return exhausted;
      },
      get nextAt() {
        return nextAt;
      },
    },
    apply: (patch: ReconnectPatch) => {
      if (patch.reconnectAttempt !== undefined) {
        attempt = patch.reconnectAttempt;
      }
      if (patch.reconnectExhausted !== undefined) {
        exhausted = patch.reconnectExhausted;
      }
      if (patch.nextReconnectAt !== undefined) {
        nextAt = patch.nextReconnectAt;
      }
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
    const { refs, apply } = createApply();
    const onReconnect = vi.fn();

    const reconnect = createReconnect(
      { reconnectMs: 100, reconnectMax: 0 },
      apply,
    );
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
    const { refs, apply } = createApply();
    const onReconnect = vi.fn();

    const reconnect = createReconnect(
      { reconnectMs: 100, reconnectMax: 2 },
      apply,
    );
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
    const { refs, apply } = createApply();

    const reconnect = createReconnect(
      { reconnectMs: 100, reconnectMax: 0 },
      apply,
    );
    reconnect.bindOnReconnect(vi.fn());

    reconnect.scheduleAfterClose();
    expect(refs.attempt).toBe(1);

    reconnect.cancel();
    expect(reconnect.scheduleAfterClose()).toBe(false);
    expect(refs.attempt).toBe(0);
    expect(refs.exhausted).toBe(false);
    expect(refs.nextAt).toBe(0);
  });

  it("exposes the scheduled reconnect time only while waiting", () => {
    const { refs, apply } = createApply();
    const onReconnect = vi.fn();

    const reconnect = createReconnect(
      { reconnectMs: 100, reconnectMax: 0 },
      apply,
    );
    reconnect.bindOnReconnect(onReconnect);

    reconnect.onConnectBegin();
    expect(refs.nextAt).toBe(0);

    expect(reconnect.scheduleAfterClose()).toBe(true);
    expect(refs.nextAt - Date.now()).toBe(100);

    vi.advanceTimersByTime(100);
    reconnect.onConnectBegin();
    expect(refs.nextAt).toBe(0);
  });

  it("clearTimerTrigger only after the timer has fired", () => {
    const { refs, apply } = createApply();
    const onReconnect = vi.fn();

    const reconnect = createReconnect(
      { reconnectMs: 100, reconnectMax: 0 },
      apply,
    );
    reconnect.bindOnReconnect(onReconnect);

    reconnect.onConnectBegin();
    expect(reconnect.scheduleAfterClose()).toBe(true);
    expect(reconnect.clearTimerTrigger()).toBe(false);
    // 計時器還在跑：clear 必須失敗，否則 UI 會以為已經不在等
    expect(refs.nextAt).not.toBe(0);

    vi.advanceTimersByTime(100);
    expect(onReconnect).toHaveBeenCalledTimes(1);
    expect(reconnect.clearTimerTrigger()).toBe(true);
    expect(refs.attempt).toBe(1);
    expect(refs.nextAt).toBe(0);

    reconnect.onConnectBegin();
    expect(refs.attempt).toBe(0);
  });

  it("reconnectMs 0 disables scheduling", () => {
    const { apply } = createApply();

    const reconnect = createReconnect(
      { reconnectMs: 0, reconnectMax: 5 },
      apply,
    );
    reconnect.bindOnReconnect(vi.fn());

    expect(reconnect.scheduleAfterClose()).toBe(false);
  });

  it("waits with exponential backoff, capped by reconnectDelayMaxMs", () => {
    const { apply } = createApply();
    const onReconnect = vi.fn();

    const reconnect = createReconnect(
      {
        reconnectMs: 100,
        reconnectMax: 0,
        reconnectBackoff: 2,
        reconnectDelayMaxMs: 300,
      },
      apply,
    );
    reconnect.bindOnReconnect(onReconnect);

    for (const expected of [100, 200, 300]) {
      reconnect.onConnectBegin();
      expect(reconnect.scheduleAfterClose()).toBe(true);
      vi.advanceTimersByTime(expected - 1);
      expect(onReconnect).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(onReconnect).toHaveBeenCalledTimes(1);
      onReconnect.mockClear();
    }
  });

  it("keeps the cycle when the connection dies before reconnectMinUptimeMs", () => {
    const { refs, apply } = createApply();

    const reconnect = createReconnect(
      { reconnectMs: 100, reconnectMax: 0, reconnectMinUptimeMs: 5000 },
      apply,
    );
    reconnect.bindOnReconnect(vi.fn());

    // flapping：open 後隨即斷線，退避計數必須繼續累加
    for (const expected of [1, 2, 3]) {
      reconnect.onConnectBegin();
      reconnect.onOpen();
      vi.advanceTimersByTime(4999);
      expect(reconnect.scheduleAfterClose()).toBe(true);
      expect(refs.attempt).toBe(expected);
      vi.advanceTimersByTime(100);
    }
  });

  it("resets the cycle once the connection survives reconnectMinUptimeMs", () => {
    const { refs, apply } = createApply();

    const reconnect = createReconnect(
      { reconnectMs: 100, reconnectMax: 0, reconnectMinUptimeMs: 5000 },
      apply,
    );
    reconnect.bindOnReconnect(vi.fn());

    reconnect.onConnectBegin();
    expect(reconnect.scheduleAfterClose()).toBe(true);
    vi.advanceTimersByTime(100);
    reconnect.onConnectBegin();
    reconnect.onOpen();
    expect(refs.attempt).toBe(1);

    vi.advanceTimersByTime(5000);
    expect(refs.attempt).toBe(0);
    expect(refs.exhausted).toBe(false);
  });
});

describe("reconnectDelay", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("defaults to a fixed interval", () => {
    const options = { reconnectMs: 100, reconnectMax: 0 };
    expect(reconnectDelay(1, options)).toBe(100);
    expect(reconnectDelay(5, options)).toBe(100);
  });

  it("jitters downward from the backoff result", () => {
    const options = {
      reconnectMs: 100,
      reconnectMax: 0,
      reconnectBackoff: 2,
      reconnectJitter: 0.5,
    };
    vi.spyOn(Math, "random").mockReturnValue(0);
    expect(reconnectDelay(2, options)).toBe(200);
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    expect(reconnectDelay(2, options)).toBe(150);
    // random() 不含 1；mock 1 是為了碰到開區間下界
    vi.spyOn(Math, "random").mockReturnValue(1);
    expect(reconnectDelay(2, options)).toBe(100);
  });

  it("treats reconnectDelayMaxMs as a hard cap even with jitter", () => {
    const options = {
      reconnectMs: 100,
      reconnectMax: 0,
      reconnectBackoff: 2,
      reconnectDelayMaxMs: 300,
      reconnectJitter: 0.5,
    };
    vi.spyOn(Math, "random").mockReturnValue(0);
    expect(reconnectDelay(9, options)).toBe(300);
    vi.spyOn(Math, "random").mockReturnValue(1);
    expect(reconnectDelay(9, options)).toBe(150);
  });

  it("clamps a shrinking backoff factor to 1", () => {
    const options = { reconnectMs: 100, reconnectMax: 0, reconnectBackoff: 0 };
    // 未夾回時 0 ** 1 會讓第 2 次起等待變成 0ms，變相連續重連
    expect(reconnectDelay(2, options)).toBe(100);
    expect(reconnectDelay(5, { ...options, reconnectBackoff: 0.5 })).toBe(100);
  });

  it("clamps jitter to [0, 1]", () => {
    const options = { reconnectMs: 100, reconnectMax: 0, reconnectJitter: 5 };
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    expect(reconnectDelay(1, options)).toBe(50);
    vi.spyOn(Math, "random").mockReturnValue(1);
    expect(reconnectDelay(1, options)).toBe(0);
  });

  it("keeps an uncapped backoff within the setTimeout limit", () => {
    expect(
      reconnectDelay(2000, {
        reconnectMs: 100,
        reconnectMax: 0,
        reconnectBackoff: 2,
      }),
    ).toBe(2 ** 31 - 1);
  });
});
