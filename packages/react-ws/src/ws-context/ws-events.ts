import {
  createContext,
  useContext,
  useEffect,
  useRef,
  type Context,
} from "react";
import type { Emitter } from "./emitter";
import type { WsEvents } from "./types";

export function createWsEventsContext() {
  return createContext<Emitter<WsEvents> | null>(null);
}

export function createUseWsEvents(
  EmitterCtx: Context<Emitter<WsEvents> | null>,
) {
  function useWsEvents<E extends keyof WsEvents>(
    type: E,
    handler: WsEvents[E],
  ): void {
    const emitter = useContext(EmitterCtx);
    if (!emitter) {
      throw new Error("useWsEvents 必須包在對應的 WsProvider 內");
    }

    const handlerRef = useRef(handler);
    handlerRef.current = handler;

    useEffect(() => {
      return emitter.on(type, ((...args: never[]) => {
        (handlerRef.current as (...a: never[]) => void)(...args);
      }) as WsEvents[E]);
    }, [type, emitter]);
  }

  return useWsEvents;
}
