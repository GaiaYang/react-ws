import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type Context,
} from "react";
import { createEmitter, type Emitter } from "./emitter";
import type { WsEvents } from "./types";

export type WsEventsEmitter = Emitter<WsEvents>;

export function createWsEventsContext() {
  return createContext<WsEventsEmitter | null>(null);
}

export function useWsEventsApi(): WsEventsEmitter {
  const [emitter] = useState(() => createEmitter<WsEvents>());
  return emitter;
}

export function createUseWsEvents(EventsCtx: Context<WsEventsEmitter | null>) {
  function useWsEvents<E extends keyof WsEvents>(
    type: E,
    handler: WsEvents[E],
  ): void {
    const emitter = useContext(EventsCtx);
    if (!emitter) {
      throw new Error("useWsEvents 必須包在對應的 WsProvider 內");
    }

    const handlerRef = useRef(handler);

    // handler 放 ref，避免每次變動都重訂閱而漏事件
    useEffect(() => {
      handlerRef.current = handler;
    });

    useEffect(() => {
      return emitter.on(type, ((...args: never[]) => {
        (handlerRef.current as (...a: never[]) => void)(...args);
      }) as WsEvents[E]);
    }, [type, emitter]);
  }

  return useWsEvents;
}
