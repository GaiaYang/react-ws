// Typed event emitter。
// 執行期邏輯對齊 nanoevents 的 createNanoEvents（幾乎逐行相同）；型別為本套件收斂版。
// Project: nanoevents — https://github.com/ai/nanoevents
// Author: Andrey Sitnik — https://github.com/ai
// License: MIT — https://github.com/ai/nanoevents/blob/main/LICENSE
// Source:
//   - https://github.com/ai/nanoevents/blob/main/index.js
//   - https://github.com/ai/nanoevents/blob/main/index.d.ts
// Modifications: 內嵌以達成零 runtime 依賴；新增 useEmitter（React useState 包裝）。

import { useState } from "react";

export interface Emitter<
  Events extends { [E in keyof Events]: (...args: never[]) => void },
> {
  events: { [E in keyof Events]?: Array<Events[E]> };
  emit<E extends keyof Events>(event: E, ...args: Parameters<Events[E]>): void;
  on<E extends keyof Events>(event: E, cb: Events[E]): () => void;
}

export function createEmitter<
  Events extends { [E in keyof Events]: (...args: never[]) => void },
>(): Emitter<Events> {
  return {
    events: {},
    emit(event, ...args) {
      const callbacks = this.events[event] || [];
      for (let i = 0, len = callbacks.length; i < len; i++) {
        callbacks[i]!(...args);
      }
    },
    on(event, cb) {
      (this.events[event] ||= []).push(cb);
      return () => {
        this.events[event] = this.events[event]?.filter((fn) => fn !== cb);
      };
    },
  };
}

export function useEmitter<
  Events extends { [E in keyof Events]: (...args: never[]) => void },
>(): Emitter<Events> {
  const [emitter] = useState(() => createEmitter<Events>());
  return emitter;
}
