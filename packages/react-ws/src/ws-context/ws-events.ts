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

/** 每個 `WsProvider` 各有一份 event emitter */
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

    // 否則每次 handler 變動都會拆掉訂閱，中間的事件會漏掉
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
