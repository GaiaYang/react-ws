import { MAX_TIMEOUT_MS } from "./socket";

/** 自動重連的設定。 */
export interface ReconnectOptions {
  /**
   * 非主動斷線後，第一次自動重連的等待時間（毫秒）。
   *
   * `0` 代表停用自動重連。
   *
   * @default 0
   */
  reconnectMs?: number;
  /**
   * 自動重連次數上限。不包含最初的 `connect()`，也不包含手動呼叫的 `connect()`。
   *
   * `0` 代表不限制。只有在 `reconnectMs > 0` 時才會生效。
   *
   * @default 0
   */
  reconnectMax?: number;
  /**
   * 下一次等待時間的倍率。
   *
   * `1` 代表固定間隔。小於 `1` 的值會限制為 `1`。
   *
   * @default 2
   */
  reconnectBackoff?: number;
  /**
   * 單次等待時間的上限（毫秒），包含抖動。抖動只會縮短等待，不會超過這個上限。
   *
   * `0` 代表不設上限。
   *
   * @default 30000
   */
  reconnectDelayMaxMs?: number;
  /**
   * 隨機縮短等待時間的幅度，範圍為 `[0, 1]`。
   *
   * `0` 代表不使用抖動，`1` 代表 full jitter。預設會將等待時間隨機縮短 0%～20%。
   *
   * @default 0.2
   */
  reconnectJitter?: number;
  /**
   * WebSocket 要維持開啟多久（毫秒），才會將重連週期歸零。
   *
   * `0` 代表連線 `open` 後立即歸零。這時即使很快斷線，下一次重連也會從第一次等待起算，`reconnectMax` 也不容易累加。
   *
   * @default 5000
   */
  reconnectMinUptimeMs?: number;
}

/** 省略的欄位填產品預設。已傳入的值（含 `NaN`）原樣保留。 */
export function resolveReconnectOptions(
  options: ReconnectOptions,
): Required<ReconnectOptions> {
  const {
    reconnectMs = 0,
    reconnectMax = 0,
    reconnectBackoff = 2,
    reconnectDelayMaxMs = 30_000,
    reconnectJitter = 0.2,
    reconnectMinUptimeMs = 5000,
  } = options;
  return {
    reconnectMs,
    reconnectMax,
    reconnectBackoff,
    reconnectDelayMaxMs,
    reconnectJitter,
    reconnectMinUptimeMs,
  };
}

/**
 * 順序是「退避 → 套上限 → 向下抖動」：
 * 先上限再抖動，`reconnectDelayMaxMs` 才是真正上限；
 *
 * 只往下扣，頂到上限後各 client 仍會錯開（上下對稱再夾回會讓半數樣本卡在上限）。
 *
 * `reconnectJitter: 1` 即 AWS full jitter：
 * https://aws.amazon.com/blogs/architecture/exponential-backoff-and-jitter/
 */
export function reconnectDelay(
  attempt: number,
  options: Required<ReconnectOptions>,
): number {
  const {
    reconnectMs,
    reconnectBackoff,
    reconnectDelayMaxMs,
    reconnectJitter,
  } = options;

  // 非有限數會產出 NaN；setTimeout(fn, NaN) 等於立刻觸發
  const factor = Math.max(
    Number.isFinite(reconnectBackoff) ? reconnectBackoff : 1,
    1,
  );
  const ms = Number.isFinite(reconnectMs) ? reconnectMs : 0;
  const backoff = ms * factor ** Math.max(attempt - 1, 0);
  // NaN、Infinity、負數都過不了 > 0，等同不設上限
  const capped =
    reconnectDelayMaxMs > 0 ? Math.min(backoff, reconnectDelayMaxMs) : backoff;
  const jitterRatio = Number.isFinite(reconnectJitter) ? reconnectJitter : 0;
  const jitter = Math.min(Math.max(jitterRatio, 0), 1);
  const jittered = capped * (1 - Math.random() * jitter);
  const rounded = Math.round(jittered);
  const clamped = Math.min(Math.max(rounded, 0), MAX_TIMEOUT_MS);
  // Infinity 已被夾住；NaN 會穿過 Math.min / Math.max
  return Number.isFinite(clamped) ? clamped : MAX_TIMEOUT_MS;
}

/** `WsState` 裡的自動重連欄位。 */
export interface ReconnectState {
  /**
   * 本輪已排程的自動重連次數。
   *
   * 非主動斷線並決定重連時就會加一，不是連上之後才加一。連線撐滿 `reconnectMinUptimeMs` 才會歸零。正在等待自動重連時手動呼叫 `connect()`，不會把這一輪的次數歸零。
   */
  reconnectAttempt: number;
  /**
   * 已達 `reconnectMax`，且最後一次自動重連也失敗。
   *
   * 之後呼叫 `connect()` 或 `disconnect()` 會重設為 `false`。
   */
  reconnectExhausted: boolean;
  /**
   * 下一次自動重連的預定時間（`Date.now()` 毫秒時間戳）。
   *
   * 沒有等待中的重連時為 `0`。
   */
  nextReconnectAt: number;
}

export type ReconnectPatch = Partial<ReconnectState>;

export interface Reconnect {
  /**
   * `true` 只表示重連計時器已經觸發。
   *
   * 等待中的手動 `connect()` 回 `false`（phase 用），attempt 仍不歸零。
   */
  onConnectBegin: () => boolean;
  onOpen: () => void;
  scheduleAfterClose: () => boolean;
  /** 計時器已觸發、這次排程已消耗，但不是使用者主動放棄 */
  clearTimerTrigger: () => boolean;
  /**
   * 建構失敗時。
   * - 計時器已觸發 → 停自動重試
   * - 仍在等待 → 取消倒數並再排下一次（提前試失敗仍繼續這一輪）
   * - 否則不動
   */
  onConstructFailure: () => "stopped" | "reconnecting" | "noop";
  cancel: () => void;
  bindOnReconnect: (fn: () => void) => void;
}

export function createReconnect(
  options: Required<ReconnectOptions>,
  apply: (patch: ReconnectPatch) => void,
): Reconnect {
  let intentionalClose = false;
  let fromTimer = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let uptimeTimer: ReturnType<typeof setTimeout> | null = null;
  let onReconnect = () => {};
  // 本輪計數以這裡為準；不回讀 store，避免拿到半套狀態
  let attempt = 0;

  const clearTimer = () => {
    if (timer != null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  const clearUptimeTimer = () => {
    if (uptimeTimer != null) {
      clearTimeout(uptimeTimer);
      uptimeTimer = null;
    }
  };

  const resetCycle = () => {
    attempt = 0;
    apply({ reconnectAttempt: 0, reconnectExhausted: false });
  };

  const clearTimerTrigger = (): boolean => {
    if (!fromTimer || timer != null) return false;
    fromTimer = false;
    // 時間點已過，清掉以免 UI 還在倒數
    apply({ nextReconnectAt: 0 });
    return true;
  };

  const schedule = (): boolean => {
    // 沒撐滿 minUptime：清掉待跑的歸零，讓退避沿用本輪計數
    clearUptimeTimer();
    const reconnectMs = options.reconnectMs;
    const reconnectMax = options.reconnectMax;
    if (
      intentionalClose ||
      typeof reconnectMs !== "number" ||
      !Number.isFinite(reconnectMs) ||
      reconnectMs <= 0
    ) {
      return false;
    }
    if (
      typeof reconnectMax === "number" &&
      reconnectMax > 0 &&
      attempt >= reconnectMax
    ) {
      apply({ reconnectExhausted: true });
      return false;
    }
    attempt += 1;
    fromTimer = true;
    const delay = reconnectDelay(attempt, options);
    apply({
      reconnectAttempt: attempt,
      nextReconnectAt: Date.now() + delay,
    });
    timer = setTimeout(() => {
      timer = null;
      onReconnect();
    }, delay);
    return true;
  };

  return {
    onConnectBegin() {
      // clearTimer 之後分不出「還在等」和「已經觸發」
      const fired = fromTimer && timer == null;
      const inCycle = fromTimer;
      clearTimer();
      clearUptimeTimer();
      intentionalClose = false;
      fromTimer = false;
      if (inCycle) {
        apply({ nextReconnectAt: 0 });
      } else {
        attempt = 0;
        apply({
          nextReconnectAt: 0,
          reconnectAttempt: 0,
          reconnectExhausted: false,
        });
      }
      return fired;
    },
    onOpen() {
      const minUptime = options.reconnectMinUptimeMs;
      // NaN 會讓 setTimeout 立刻觸發，短命連線保護就沒了
      if (!Number.isFinite(minUptime)) return;
      if (minUptime <= 0) {
        resetCycle();
        return;
      }
      uptimeTimer = setTimeout(
        () => {
          uptimeTimer = null;
          resetCycle();
        },
        Math.min(minUptime, MAX_TIMEOUT_MS),
      );
    },
    scheduleAfterClose: schedule,
    clearTimerTrigger,
    onConstructFailure() {
      if (clearTimerTrigger()) return "stopped";
      if (fromTimer && timer != null) {
        clearTimer();
        if (schedule()) return "reconnecting";
        fromTimer = false;
        apply({ nextReconnectAt: 0 });
        return "stopped";
      }
      return "noop";
    },
    cancel() {
      intentionalClose = true;
      fromTimer = false;
      clearTimer();
      clearUptimeTimer();
      attempt = 0;
      apply({
        nextReconnectAt: 0,
        reconnectAttempt: 0,
        reconnectExhausted: false,
      });
    },
    bindOnReconnect(fn) {
      onReconnect = fn;
    },
  };
}
