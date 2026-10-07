import {
  createContext,
  useContext,
  useEffect,
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

    // 繪製前換上最新 handler。被動 effect 晚於繪製，中間的訊息會打到舊的。
    useLayoutEffect(() => {
      handlerRef.current = handler;
    }, [handler]);

    useEffect(() => {
      return emitter.on(type, ((...args: never[]) => {
        (handlerRef.current as (...a: never[]) => void)(...args);
      }) as WsEvents[E]);
    }, [type, emitter]);
  }

  return useWsEvents;
}
