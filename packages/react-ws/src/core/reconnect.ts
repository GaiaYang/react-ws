import { MAX_TIMEOUT_MS } from "./socket";

/** 自動重連的設定 */
export interface ReconnectOptions {
  /**
   * 非主動斷線後，第一次自動重連的等待時間（毫秒）
   *
   * `0`、負數、非有限數都代表停用，與省略相同。
   *
   * @default 0
   */
  reconnectMs?: number;
  /**
   * 自動重連次數上限
   *
   * 不包含最初的 `connect()`，也不包含手動呼叫的 `connect()`。
   *
   * `0`、負數、非有限數都代表不限制，與省略相同。只有在 `reconnectMs > 0` 時才會生效。
   *
   * @default 0
   */
  reconnectMax?: number;
  /**
   * 下一次等待時間的倍率
   *
   * `1` 代表固定間隔。小於 `1`、`0`、負數、非有限數都用預設 `2`。
   *
   * @default 2
   */
  reconnectBackoff?: number;
  /**
   * 單次等待時間的上限（毫秒），包含抖動
   *
   * 抖動只會縮短等待，不會超過這個上限。
   *
   * `0`、負數、非有限數都用預設 `30000`。
   *
   * @default 30000
   */
  reconnectDelayMaxMs?: number;
  /**
   * 隨機縮短等待時間的幅度，範圍為 `[0, 1]`
   *
   * `0` 代表不使用抖動，`1` 代表 full jitter。大於 `1` 會夾成 `1`。
   *
   * 負數與非有限數用預設 `0.5`。預設是 equal jitter：等待落在計算值的 50%～100%。
   *
   * @default 0.5
   */
  reconnectJitter?: number;
  /**
   * WebSocket 要維持開啟多久（毫秒），才會將重連週期歸零
   *
   * `0` 代表連線 `open` 後立即歸零，這時即使很快斷線，下一次重連也會從第一次等待起算，`reconnectMax` 也不容易累加。
   *
   * 負數與非有限數用預設 `5000`，不會立刻歸零，也不會永遠不歸零。
   *
   * @default 5000
   */
  reconnectMinUptimeMs?: number;
}

const DEFAULT_RECONNECT_MIN_UPTIME_MS = 5000;

/**
 * 省略、非有限數、負數用該欄位的預設。
 *
 * `reconnectMs`／`reconnectMax` 的預設就是 `0`。
 * `reconnectJitter: 0` 與 `reconnectMinUptimeMs: 0` 是有效端點，不收成預設。
 * `reconnectBackoff` 須 `>= 1`，`reconnectDelayMaxMs` 須 `> 0`，否則用預設。
 */
function pickReconnectNumber(
  value: number | undefined,
  fallback: number,
  accept: (n: number) => boolean,
): number {
  if (typeof value !== "number" || !Number.isFinite(value) || !accept(value)) {
    return fallback;
  }
  return value;
}

/** 省略與無效值收成產品預設。`createReconnect` 與 `reconnectDelay` 都走這裡 */
export function resolveReconnectOptions(
  options: ReconnectOptions,
): Required<ReconnectOptions> {
  const jitter = pickReconnectNumber(
    options.reconnectJitter,
    0.5,
    (n) => n >= 0,
  );
  return {
    reconnectMs: pickReconnectNumber(options.reconnectMs, 0, (n) => n > 0),
    reconnectMax: pickReconnectNumber(options.reconnectMax, 0, (n) => n > 0),
    reconnectBackoff: pickReconnectNumber(
      options.reconnectBackoff,
      2,
      (n) => n >= 1,
    ),
    reconnectDelayMaxMs: pickReconnectNumber(
      options.reconnectDelayMaxMs,
      30_000,
      (n) => n > 0,
    ),
    reconnectJitter: Math.min(jitter, 1),
    reconnectMinUptimeMs: pickReconnectNumber(
      options.reconnectMinUptimeMs,
      DEFAULT_RECONNECT_MIN_UPTIME_MS,
      (n) => n >= 0,
    ),
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
  options: ReconnectOptions,
): number {
  const resolved = resolveReconnectOptions(options);
  const backoff =
    resolved.reconnectMs *
    resolved.reconnectBackoff ** Math.max(attempt - 1, 0);
  const capped = Math.min(backoff, resolved.reconnectDelayMaxMs);
  const jittered = capped * (1 - Math.random() * resolved.reconnectJitter);
  const rounded = Math.round(jittered);
  const clamped = Math.min(Math.max(rounded, 0), MAX_TIMEOUT_MS);
  // 指數溢位會變成 Infinity，夾回平台上限
  return Number.isFinite(clamped) ? clamped : MAX_TIMEOUT_MS;
}

/** 自動重連狀態 */
export interface ReconnectState {
  /**
   * 本輪已排程的自動重連次數
   *
   * 非主動斷線並決定重連時就會加一，不是連上之後才加一。
   *
   * 連線撐滿 `reconnectMinUptimeMs` 才會歸零。
   *
   * 正在等待自動重連時手動呼叫 `connect()`，不會把這一輪的次數歸零。
   */
  reconnectAttempt: number;
  /**
   * 已達 `reconnectMax`，且最後一次自動重連也失敗
   *
   * 之後呼叫 `connect()` 或 `disconnect()` 會重設為 `false`。
   */
  reconnectExhausted: boolean;
  /**
   * 下一次自動重連的預定時間（`Date.now()` 毫秒時間戳）
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
  /**
   * 沒有進行中的自動重連時，手動 `connect()` 立刻把週期歸零。
   *
   * 等待中、計時器已觸發，或這次手動連線已取消等待但握手尚未 `open` 時不動。
   */
  prepareManualConnect: () => void;
  onOpen: () => void;
  scheduleAfterClose: () => boolean;
  /**
   * 計時器已觸發、這次排程已消耗，但不是使用者主動放棄。
   *
   * `attempt` 已達 `reconnectMax` 時，一併把 `reconnectExhausted` 設為 `true`。
   */
  clearTimerTrigger: () => boolean;
  /**
   * 建構失敗時。
   * - 計時器已觸發 → 這次嘗試算失敗，接著 `schedule()`。未達上限則再排；達到上限則停，且 `reconnectExhausted` 為 `true`
   * - 仍在等待 → 取消倒數，以同一個 `attempt` 再排（手動失敗不計次）
   * - 否則不動
   */
  onConstructFailure: () => "stopped" | "reconnecting" | "noop";
  cancel: () => void;
  bindOnReconnect: (fn: () => void) => void;
}

/**
 * 這一輪自動重連的階段。有沒有計時器由階段決定。
 *
 * - `idle`：沒有進行中的自動重連。`attempt` 仍可能大於 0，要等最短在線時間才歸零
 * - `waiting`：倒數中
 * - `fired`：倒數已結束，這次連線還沒開始，或還沒判定建構失敗
 * - `reuse`：手動連線取消了還沒跑的倒數。`open` 前失敗時，用同一個 `attempt` 再排
 */
type Step =
  | { kind: "idle" }
  | { kind: "waiting"; timer: ReturnType<typeof setTimeout> }
  | { kind: "fired" }
  | { kind: "reuse" };

export function createReconnect(
  input: ReconnectOptions,
  apply: (patch: ReconnectPatch) => void,
): Reconnect {
  const options = resolveReconnectOptions(input);
  // cancel() 之後、下一次 onConnectBegin 之前，schedule 直接拒絕
  let intentionalClose = false;
  let step: Step = { kind: "idle" };
  let uptimeTimer: ReturnType<typeof setTimeout> | null = null;
  let onReconnect = () => {};
  // 本輪計數以這裡為準；不回讀 store，避免拿到半套狀態
  let attempt = 0;

  const attemptReachedMax = () =>
    typeof options.reconnectMax === "number" &&
    options.reconnectMax > 0 &&
    attempt >= options.reconnectMax;

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

  const armTimer = () => {
    // 同一輪只留一顆倒數。再排時取消上一顆，避免兩次 onReconnect
    if (step.kind === "waiting") clearTimeout(step.timer);
    const delay = reconnectDelay(attempt, options);
    apply({
      reconnectAttempt: attempt,
      nextReconnectAt: Date.now() + delay,
    });
    const timer = setTimeout(() => {
      if (step.kind !== "waiting" || step.timer !== timer) return;
      // 先標成 fired，onReconnect 裡的 connect 才分得出這次是計時器觸發
      step = { kind: "fired" };
      onReconnect();
    }, delay);
    step = { kind: "waiting", timer };
  };

  const clearTimerTrigger = (): boolean => {
    if (step.kind !== "fired") return false;
    step = { kind: "idle" };
    // 時間點已過，清掉倒數。這次已達上限時不再重試
    apply(
      attemptReachedMax()
        ? { nextReconnectAt: 0, reconnectExhausted: true }
        : { nextReconnectAt: 0 },
    );
    return true;
  };

  const schedule = (): boolean => {
    // 沒撐滿 minUptime：清掉待跑的歸零，讓退避沿用本輪計數
    clearUptimeTimer();
    if (intentionalClose || options.reconnectMs <= 0) {
      if (step.kind === "reuse") step = { kind: "idle" };
      return false;
    }
    if (step.kind === "reuse") {
      armTimer();
      return true;
    }
    if (attemptReachedMax()) {
      // 關閉路徑的倒數在連線開始時已歸零。建構失敗達上限時，這次一併清掉已到期的時間戳
      apply({ reconnectExhausted: true, nextReconnectAt: 0 });
      return false;
    }
    attempt += 1;
    armTimer();
    return true;
  };

  return {
    prepareManualConnect() {
      if (step.kind !== "idle") return;
      attempt = 0;
      apply({
        nextReconnectAt: 0,
        reconnectAttempt: 0,
        reconnectExhausted: false,
      });
    },
    onConnectBegin() {
      if (step.kind === "waiting") clearTimeout(step.timer);
      clearUptimeTimer();
      intentionalClose = false;
      switch (step.kind) {
        case "fired":
          step = { kind: "idle" };
          apply({ nextReconnectAt: 0 });
          return true;
        case "waiting":
          step = { kind: "reuse" };
          apply({ nextReconnectAt: 0 });
          return false;
        default:
          step = { kind: "idle" };
          attempt = 0;
          apply({
            nextReconnectAt: 0,
            reconnectAttempt: 0,
            reconnectExhausted: false,
          });
          return false;
      }
    },
    onOpen() {
      if (step.kind === "reuse") step = { kind: "idle" };
      const delay = options.reconnectMinUptimeMs;
      if (delay <= 0) {
        resetCycle();
        return;
      }
      uptimeTimer = setTimeout(
        () => {
          uptimeTimer = null;
          resetCycle();
        },
        Math.min(delay, MAX_TIMEOUT_MS),
      );
    },
    scheduleAfterClose: schedule,
    clearTimerTrigger,
    onConstructFailure() {
      switch (step.kind) {
        case "fired":
          // 次數在排這次等待時已經加過。先離開 fired，再讓 schedule 寫下一次；不要先把倒數寫成 0
          step = { kind: "idle" };
          return schedule() ? "reconnecting" : "stopped";
        case "waiting":
          armTimer();
          return "reconnecting";
        default:
          return "noop";
      }
    },
    cancel() {
      intentionalClose = true;
      if (step.kind === "waiting") clearTimeout(step.timer);
      step = { kind: "idle" };
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
