import { useState } from "react";

export interface ReconnectCallbacks {
  /** 讀取 store 的 `reconnectAttempt` */
  getAttempt: () => number;
  /** 寫入 store 的 `reconnectAttempt` */
  setAttempt: (attempt: number) => void;
  /** 寫入 store 的 `reconnectExhausted` */
  setExhausted: (exhausted: boolean) => void;
}

export interface Reconnect {
  /**
   * 開始連線時呼叫；回傳 `true` 表示由重連計時器觸發。
   *
   * 非計時器觸發時歸零本輪 `reconnectAttempt`；計時器等待中或剛觸發則不歸零。
   */
  onConnectBegin: () => boolean;
  /** 連線成功；歸零本輪重連計數 */
  onOpen: () => void;
  /** 意外斷線後嘗試重連；有排重連回 `true` */
  scheduleAfterClose: () => boolean;
  /**
   * 重連計時器已觸發、但本次 connect 未能開線時呼叫。
   *
   * 只清 `fromTimer`，不當作主動斷線、不歸零 `reconnectAttempt`。
   *
   * @returns 是否確為計時器已觸發（尚有待跑的 timer 則為 `false`）
   */
  clearTimerTrigger: () => boolean;
  /** 主動斷線或元件卸載：取消計時器並歸零本輪計數 */
  cancel: () => void;
  /** 設定重連時要執行的 connect */
  bindOnReconnect: (fn: () => void) => void;
}

export function createReconnect(
  reconnectMs: number,
  reconnectMax: number,
  callbacks: ReconnectCallbacks,
): Reconnect {
  let intentionalClose = false;
  let fromTimer = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let onReconnect = () => {};

  const clearTimer = () => {
    if (timer != null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  const resetCycle = () => {
    if (callbacks.getAttempt() !== 0) callbacks.setAttempt(0);
    callbacks.setExhausted(false);
  };

  return {
    onConnectBegin() {
      clearTimer();
      intentionalClose = false;
      const reconnecting = fromTimer;
      if (!fromTimer) resetCycle();
      fromTimer = false;
      return reconnecting;
    },

    onOpen() {
      resetCycle();
    },

    scheduleAfterClose() {
      if (intentionalClose || reconnectMs <= 0) return false;
      const attempt = callbacks.getAttempt();
      if (reconnectMax > 0 && attempt >= reconnectMax) {
        callbacks.setExhausted(true);
        return false;
      }
      callbacks.setAttempt(attempt + 1);
      fromTimer = true;
      timer = setTimeout(() => {
        timer = null;
        onReconnect();
      }, reconnectMs);
      return true;
    },

    clearTimerTrigger() {
      if (!fromTimer || timer != null) return false;
      fromTimer = false;
      return true;
    },

    cancel() {
      intentionalClose = true;
      clearTimer();
      resetCycle();
    },

    bindOnReconnect(fn) {
      onReconnect = fn;
    },
  };
}

export function useReconnect(
  reconnectMs: number,
  reconnectMax: number,
  callbacks: ReconnectCallbacks,
): Reconnect {
  const [session] = useState(() =>
    createReconnect(reconnectMs, reconnectMax, callbacks),
  );
  return session;
}
