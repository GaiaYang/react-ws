// 訂閱外部 store（selector + useSyncExternalStore）。
// 靈感來自 zustand/react 的 useStore（非完整搬移；本層 selector 必填、無 useDebugValue）。
// Project: zustand — https://github.com/pmndrs/zustand
// Author: pmndrs (Poimandres) — https://github.com/pmndrs
// License: MIT — https://github.com/pmndrs/zustand/blob/main/LICENSE
// Source: https://github.com/pmndrs/zustand/blob/main/src/react.ts
// Modifications: 內嵌以達成零 runtime 依賴。
// 用途：訂閱 WsState（連線健康／重連）；訊息不走此 store。

import { useSyncExternalStore } from "react";
import type { StoreApi } from "./store";

export function useStore<State, Selected>(
  store: StoreApi<State>,
  selector: (state: State) => Selected,
): Selected {
  return useSyncExternalStore(
    store.subscribe,
    () => selector(store.getState()),
    () => selector(store.getInitialState()),
  );
}
