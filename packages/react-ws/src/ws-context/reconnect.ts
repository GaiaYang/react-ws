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
  /** 開始連線時呼叫 */
  onConnectBegin: () => void;
  /** 連線成功時呼叫 */
  onOpen: () => void;
  /** 意外斷線後嘗試重連；有排重連回 `true` */
  scheduleAfterClose: () => boolean;
  /** 主動斷線或元件卸載時呼叫 */
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
      if (!fromTimer) resetCycle();
      fromTimer = false;
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
      // 固定間隔重連，無 backoff；之後可換成指數退避
      timer = setTimeout(() => {
        timer = null;
        onReconnect();
      }, reconnectMs);
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
