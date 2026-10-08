import {
  createContext,
  useContext,
  useLayoutEffect,
  useRef,
  type Context,
} from "react";
import type { WsEvents, WsEventsEmitter } from "../core/session";

export function createWsEventsContext() {
  return createContext<WsEventsEmitter | null>(null);
}

export function createUseWsEvents(EventsCtx: Context<WsEventsEmitter | null>) {
  function useWsEvents<E extends keyof WsEvents>(
    type: E,
    handler: WsEvents[E],
  ): void {
    const emitter = useContext(EventsCtx);
    if (!emitter) {
      throw new Error(
        "useWsEvents must be used within the corresponding WsProvider",
      );
    }

    const handlerRef = useRef(handler);

    // 訂閱與 handler 都在繪製前。被動 effect 才訂閱的話，這個 commit 的訊息沒人收。
    useLayoutEffect(() => {
      handlerRef.current = handler;
    }, [handler]);

    useLayoutEffect(() => {
      return emitter.on(type, ((...args: never[]) => {
        (handlerRef.current as (...a: never[]) => void)(...args);
      }) as WsEvents[E]);
    }, [type, emitter]);
  }

  return useWsEvents;
}
