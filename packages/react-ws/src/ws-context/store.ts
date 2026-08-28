// 精簡外部 store：只保留本套件需要的 getState / setState / subscribe / getInitialState。
// 靈感與行為對齊 zustand/vanilla（非完整搬移；無 middleware、無 replace、無 initializer factory）。
// Project: zustand — https://github.com/pmndrs/zustand
// Author: pmndrs (Poimandres) — https://github.com/pmndrs
// License: MIT — https://github.com/pmndrs/zustand/blob/main/LICENSE
// Source: https://github.com/pmndrs/zustand/blob/main/src/vanilla.ts
// Modifications: 內嵌子集以達成零 runtime 依賴。

export type StoreApi<State> = {
  getState: () => State;
  getInitialState: () => State;
  setState: (
    partial: Partial<State> | ((state: State) => Partial<State>),
  ) => void;
  subscribe: (listener: (state: State, prev: State) => void) => () => void;
};

export function createStore<State extends object>(
  initialState: State,
): StoreApi<State> {
  let state = initialState;
  const listeners = new Set<(state: State, prev: State) => void>();

  return {
    getState: () => state,
    getInitialState: () => initialState,
    setState: (partial) => {
      const nextPartial =
        typeof partial === "function" ? partial(state) : partial;
      if (Object.is(nextPartial, state)) return;
      const prev = state;
      state = Object.assign({}, state, nextPartial);
      for (const listener of listeners) listener(state, prev);
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
