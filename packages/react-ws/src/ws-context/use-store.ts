// 對齊 zustand/react 的 useStore 子集；本層 selector 必填、無 useDebugValue。
// Project: zustand — https://github.com/pmndrs/zustand
// Author: pmndrs (Poimandres) — https://github.com/pmndrs
// License: MIT — https://github.com/pmndrs/zustand/blob/main/LICENSE
// Source: https://github.com/pmndrs/zustand/blob/main/src/react.ts
// Modifications: 內嵌以達成零 runtime 依賴。

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
