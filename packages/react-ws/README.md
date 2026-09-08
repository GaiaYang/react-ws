# react-ws-context

[![npm version](https://img.shields.io/npm/v/react-ws-context.svg)](https://www.npmjs.com/package/react-ws-context)
[![npm downloads](https://img.shields.io/npm/dm/react-ws-context.svg)](https://www.npmjs.com/package/react-ws-context)

> [繁體中文](./README.zh-TW.md)

`react-ws-context` is WebSocket for React.

- Messages never enter React state, so they do not re-render the tree.
- Reconnect builds the new socket first and closes the old one only after that succeeds.
- A failed handshake leaves the existing socket open.
- Application-layer ping and a queue for sends while disconnected.

The Next.js demo is in [`apps/web`](https://github.com/GaiaYang/react-ws/tree/main/apps/web). The steps are in [Run the demo](https://github.com/GaiaYang/react-ws#run-the-demo).

## Requirements

| Item                     | Requirement                    |
| ------------------------ | ------------------------------ |
| React                    | >= 18 (`useSyncExternalStore`) |
| Runtime npm dependencies | none                           |
| Environment              | `globalThis.WebSocket`         |

## Installation

```bash
pnpm add react-ws-context react
# or: npm install react-ws-context react
# or: yarn add react-ws-context react
```

The package entry is marked `"use client"`. Next.js App Router can import it. A SPA ignores the directive.

## First create a context

One `createWsContext` call returns a Provider and hooks.

```tsx
"use client";

import { createWsContext } from "react-ws-context";

export const { WsProvider, useWsActions, useWsStore, useWsEvents } =
  createWsContext({
    url: "ws://localhost:8080",
    reconnectMs: 2000,
  });
```

Each `createWsContext` call returns its own Provider and hooks. Two sockets need two calls, for example one for app traffic and one for notifications.

## Then use the hooks

```tsx
"use client";

import { WsProvider, useWsActions, useWsStore, useWsEvents } from "./ws";

export function App({ children }: { children: React.ReactNode }) {
  return <WsProvider>{children}</WsProvider>;
}

function Chat() {
  const { sendJson } = useWsActions();
  const status = useWsStore((s) => s.status);

  useWsEvents("message", (data) => {
    console.log("message", data);
  });

  return (
    <button
      disabled={status !== "open"}
      onClick={() => sendJson({ type: "ping" })}
    >
      Send ({status})
    </button>
  );
}
```

In the `message` handler, write the payload into your own store.

This page documents [`createWsContext`](#createwscontext), [`WsProvider`](#wsprovider), [`useWsActions`](#usewsactions), [`useWsStore`](#usewsstore), [`useWsEvents`](#usewsevents), [`liveness`](#liveness), the [outgoing queue](#outgoing-queue), and the [exported types](#exported-types).

## `createWsContext`

`createWsContext(options)` returns a `WsProvider` and hooks bound to the same connection config. The getter or static value for `url` and `protocols`, and every other option, stays fixed for that call. After that, only `connect` and `disconnect` change the connection. A new getter or a static string needs a new `createWsContext` call.

### Options

`CreateWsContextOptions`

| Field                  | Type                                      | Default   | Description                                                                                                                                     |
| ---------------------- | ----------------------------------------- | --------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `url`                  | `MaybeGetter<string>`                     | required  | WebSocket URL. A sync getter runs at the start of each `connect()`.                                                                             |
| `protocols`            | `MaybeGetter<string \| string[]>`         | none      | Passed to `new WebSocket(url, protocols)`. When omitted, the second argument is not passed. An empty string from a getter is passed through.    |
| `autoConnect`          | `boolean`                                 | `true`    | Connect when `WsProvider` mounts.                                                                                                               |
| `reconnectMs`          | `number`                                  | `0`       | First wait in ms after an unintentional close. `0` disables reconnect.                                                                          |
| `reconnectMax`         | `number`                                  | `0`       | Max auto-reconnects after an unintentional close. `0` means no cap. Reconnect still requires `reconnectMs > 0`.                                 |
| `reconnectBackoff`     | `number`                                  | `2`       | Multiplier for the next wait. Default `2` doubles it, so 1s then 2s then 4s. `1` keeps the wait unchanged. Values below `1` are clamped to `1`. |
| `reconnectDelayMaxMs`  | `number`                                  | `30000`   | Hard cap in ms for one wait, jitter included. `0` removes the cap.                                                                              |
| `reconnectJitter`      | `number`                                  | `0.2`     | Random shorten of each wait, in `[0, 1]`. Default `0.2` waits 80% to 100% of the scheduled delay. `1` is full jitter. `0` disables jitter.      |
| `reconnectMinUptimeMs` | `number`                                  | `5000`    | How long a connection must stay open, in ms, before the reconnect cycle resets. `0` resets on `open`.                                           |
| `outgoingQueueMax`     | `number`                                  | `0`       | Max outgoing queue size while not connected. `0` disables the queue.                                                                            |
| `parse`                | `(data: MessageEvent["data"]) => unknown` | see below | Turns raw `MessageEvent.data` into app data.                                                                                                    |
| `liveness`             | `LivenessOptions`                         | none      | Application-layer ping and pong. Disabled when omitted.                                                                                         |

Default `parse` runs `JSON.parse` on a string and returns the raw string if parse fails. It returns non-strings as-is.

`url` and `protocols` may be a static value or a sync getter (`MaybeGetter<T>`). The getter runs at the start of each `connect()` and must be synchronous. `await` and hooks are not valid inside it. The app supplies the source, such as `localStorage`. This package does not handle auth.

```tsx
createWsContext({
  url: () => {
    const token = localStorage.getItem("accessToken");
    if (!token) throw new Error("no token");
    return `wss://api.example.com/ws?token=${encodeURIComponent(token)}`;
  },
  autoConnect: false,
  reconnectMs: 2000,
});
```

Handshake fails when the getter throws, the URL is empty, or `new WebSocket` throws. `connect()` then emits `"error"` and leaves any existing connection as-is. `connect()` itself does not throw. If the reconnect timer had already fired, auto-retry stops and `phase` becomes `"stopped"`. Auto-retry does not resume after that. A later `connect()` starts a new attempt.

Backoff and jitter apply as soon as `reconnectMs > 0`.

```ts
// 1s, then double each attempt, capped at 30s.
// Each delay is shortened by a random 0% to 20%.
// reconnectAttempt resets after the socket stays open for 5s.
createWsContext({ url: "ws://localhost:8080", reconnectMs: 1000 });
```

If the server accepts a connection and closes it right away, `reconnectMinUptimeMs: 0` resets the cycle on every `open`. Backoff and `reconnectMax` then stay on the first step.

This configuration waits the same interval every time, with no jitter, and resets the cycle on `open`.

```ts
createWsContext({
  url: "ws://localhost:8080",
  reconnectMs: 2000,
  reconnectBackoff: 1,
  reconnectJitter: 0,
  reconnectMinUptimeMs: 0,
});
```

### Returns

| Name           | Type                                 | Description                                   |
| -------------- | ------------------------------------ | --------------------------------------------- |
| `WsProvider`   | `React.FC<{ children }>`             | Holds the WebSocket for the subtree it wraps. |
| `useWsActions` | `() => WsContextValue`               | Connection actions.                           |
| `useWsStore`   | `() => WsState` or `(selector) => T` | Connection state.                             |
| `useWsEvents`  | `(type, handler) => void`            | WebSocket events.                             |

## `WsProvider`

`WsProvider` creates the native `WebSocket` and closes it when the Provider unmounts.

| When                                      | What happens                                                                                                                                                                                                                                       |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Mount and `autoConnect: true`             | Connects.                                                                                                                                                                                                                                          |
| Unmount                                   | Cancels reconnect and resets reconnect progress, stops `liveness`, and clears the outgoing queue. The store becomes `status: "closed"`, `phase: "idle"`. An existing socket is closed and `close` fires with reason `"provider unmount"`.          |
| `disconnect()`                            | Same cleanup and store reset as unmount. No auto-reconnect. An existing socket fires `close` with reason `"client disconnect"`.                                                                                                                    |
| Unintentional close and `reconnectMs > 0` | Reconnect waits with backoff, a delay cap, and jitter. Stops after `reconnectMax` when that value is greater than `0`. The cycle resets once a connection stays open for `reconnectMinUptimeMs`. While waiting, the due time is `nextReconnectAt`. |
| `connect()` with an existing socket       | Constructs the new socket first. On success, closes the previous one and fires `close` with reason `"reconnect"`. If construction fails, the existing socket is left as-is.                                                                        |
| Handshake failure                         | Emits `"error"`. Does not open a socket or close an existing one. The store is left as-is. If the reconnect timer had already fired, the store becomes `status: "closed"`, `phase: "stopped"`, and auto-retry stops.                               |

## `useWsActions`

`useWsActions(): WsContextValue`

The hook throws `"useWsActions 必須包在對應的 WsProvider 內"` when called outside the matching `WsProvider`. Returned methods keep a stable reference. A component that only calls this hook does not re-render on store updates or messages.

| Method       | Signature                    | Description                                                                                                                                                                              |
| ------------ | ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `send`       | `(data) => boolean`          | Sends raw data (`string`, `ArrayBuffer`, `Blob`, and other `WebSocket.send` payloads). Sends immediately when the socket is open. Otherwise enqueues when the outgoing queue is enabled. |
| `sendJson`   | `(data: unknown) => boolean` | `JSON.stringify` then `send`. Same return as `send`. Returns `false` when the value is not serializable.                                                                                 |
| `connect`    | `() => void`                 | Resolves `url` and `protocols` and constructs the socket. On success, closes any existing socket. Handshake failure is described under [`createWsContext`](#createwscontext).            |
| `disconnect` | `() => void`                 | Intentional close. Store becomes `phase: "idle"`, `status: "closed"`. No auto-reconnect. Clears the outgoing queue.                                                                      |
| `getStatus`  | `() => WsStatus`             | Reads the current `status` without a subscription, so the calling component does not re-render.                                                                                          |

`send` and `sendJson` return `true` when the payload was sent or enqueued. They return `false` when the queue is full, the queue is disabled, or `sendJson` could not serialize.

## `useWsStore`

The hook throws `"useWsStore 必須包在對應的 WsProvider 內"` when called outside the matching `WsProvider`. It subscribes with `useSyncExternalStore`. It skips a re-render when the selected value is unchanged.

```ts
useWsStore(): WsState
useWsStore<T>(selector: (state: WsState) => T): T
```

A call with no selector subscribes to the whole `WsState`, so a change to `nextReconnectAt` re-renders a component that only displays `status`. A selector subscribes to the selected value only.

Incoming messages are not in this store. They arrive through `useWsEvents("message", ...)`.

### `WsState`

| Field                | Type       | Description                                                                               |
| -------------------- | ---------- | ----------------------------------------------------------------------------------------- |
| `status`             | `WsStatus` | Current WebSocket connection state.                                                       |
| `phase`              | `WsPhase`  | Provider connection phase. Separate from `status`.                                        |
| `reconnectAttempt`   | `number`   | Auto-reconnects scheduled in the current cycle.                                           |
| `reconnectExhausted` | `boolean`  | Auto-reconnect hit `reconnectMax` and the last attempt also failed.                       |
| `nextReconnectAt`    | `number`   | When the next auto-reconnect is due, as `Date.now()` milliseconds. `0` while not waiting. |

`reconnectAttempt` is `n` when the nth reconnect is scheduled or in progress. It increments when an unintentional close queues a retry, not when the retry succeeds. It resets after the connection has stayed open for `reconnectMinUptimeMs`. The default is 5s. When that option is `0`, it resets on `open`. `disconnect()` resets it immediately. A manual `connect()` resets it immediately unless a reconnect timer is already waiting. Then it resets once that connection stays open for `reconnectMinUptimeMs`.

A later `connect()` or `disconnect()` sets `reconnectExhausted` back to `false`.

With backoff and jitter, `nextReconnectAt - Date.now()` is the wait that is actually scheduled.

Options such as `reconnectMax` are fixed at `createWsContext` and are not in `WsState`. The URL used for a handshake is not stored either. A label such as "attempt n of m" needs those config values kept beside the component.

### `WsStatus`

| Value        | Meaning                                                                    |
| ------------ | -------------------------------------------------------------------------- |
| `idle`       | Not connected yet. Initial value only. Does not return after a disconnect. |
| `connecting` | Connecting.                                                                |
| `open`       | Connected.                                                                 |
| `closed`     | Disconnected.                                                              |

`status` maps to the current WebSocket connection state, similar to `readyState`. `disconnect()` sets `status: "closed"` and `phase: "idle"`. `status` does not return to `idle`. Connection errors are not a `WsStatus`. They arrive through `useWsEvents("error")`. A native `error` is usually followed by `close`.

`status` does not say whether the Provider is in an auto-reconnect cycle or the user disconnected. Read `phase` for that.

### `WsPhase`

| Value          | Meaning                                                                               |
| -------------- | ------------------------------------------------------------------------------------- |
| `idle`         | Not connected, no reconnect scheduled. Initial value, or after manual `disconnect()`. |
| `connecting`   | First connect or manual `connect()` in progress.                                      |
| `open`         | Connected.                                                                            |
| `reconnecting` | Auto-reconnect cycle. Waiting for the timer, or connecting.                           |
| `stopped`      | Will not auto-reconnect.                                                              |

When `phase` is `stopped`, `reconnectExhausted` is `true` if the attempt cap was hit. It is `false` when reconnect is off, or when handshake failed after the reconnect timer fired.

`status` and `phase` often change together and mean different things. `phase === "reconnecting"` with `status === "closed"` is waiting for the reconnect timer. `status === "connecting"` in that phase means the timer fired and a connect attempt is in progress.

```tsx
const phase = useWsStore((s) => s.phase);
const status = useWsStore((s) => s.status);

const canConnect = phase === "idle" || phase === "stopped";
const canDisconnect =
  phase === "open" || phase === "connecting" || phase === "reconnecting";
```

## `useWsEvents`

`useWsEvents(type, handler)`

The hook throws `"useWsEvents 必須包在對應的 WsProvider 內"` when called outside the matching `WsProvider`. It subscribes on mount and unsubscribes on unmount.

| `type`      | Handler                                        | Description                   |
| ----------- | ---------------------------------------------- | ----------------------------- |
| `"message"` | `(data: unknown, event: MessageEvent) => void` | `data` is the parsed payload. |
| `"open"`    | `(event: Event) => void`                       | Connection open.              |
| `"error"`   | `(event: Event) => void`                       | Socket or handshake error.    |
| `"close"`   | `(event: CloseEvent) => void`                  | Connection closed.            |

Updating the callback does not re-subscribe. Changing `type` does re-subscribe.

On an unintentional close, the Provider writes `status: "closed"` and the matching `phase` before it runs the `close` handler. Intentional `disconnect()` and Provider unmount use the same order. The Provider updates the store first, then fires `close` when a socket exists.

Handshake failure emits `"error"` as `{ type: "error" }`, without `close` and without replacing an existing socket.

When `connect()` replaces an existing socket after a successful construct, `close` fires first with reason `"reconnect"`, then `status` and `phase` become `"connecting"`.

Each call subscribes to one `type`.

## `liveness`

Set `liveness` on `createWsContext` to enable it. Once connected, the Provider sends periodic application-layer pings. It writes them directly to the socket. They are not WebSocket control frames, and they do not use the outgoing queue. If no matching pong arrives within `timeoutMs`, the Provider closes the socket. That close may trigger reconnect when reconnect is enabled.

`LivenessOptions`

| Field        | Type                         | Description                                   |
| ------------ | ---------------------------- | --------------------------------------------- |
| `intervalMs` | `number`                     | Ping interval in ms.                          |
| `timeoutMs`  | `number`                     | Wait for pong in ms.                          |
| `ping`       | `unknown \| (() => unknown)` | Ping payload. A function is called each time. |
| `isPong`     | `(data: unknown) => boolean` | Whether parsed data is a pong.                |

```tsx
createWsContext({
  url: "ws://localhost:8080",
  reconnectMs: 3000,
  liveness: {
    intervalMs: 30_000,
    timeoutMs: 10_000,
    ping: { type: "ping" },
    isPong: (data) =>
      typeof data === "object" &&
      data != null &&
      (data as { type?: string }).type === "pong",
  },
});
```

Every incoming message is checked with `isPong`. A pong clears the timeout timer and still fires `"message"`. The Provider sends ping payloads with `JSON.stringify`, so the ping body must be JSON-serializable.

## Outgoing queue

When `outgoingQueueMax > 0`:

| When                       | Behavior                                            |
| -------------------------- | --------------------------------------------------- |
| `send` while not connected | Enqueue, first in, first out.                       |
| Queue full                 | Returns `false`. Does not drop older messages.      |
| On `open`                  | Sends the entire queue in order.                    |
| `disconnect()`             | Clears the queue. Store reset matches `WsProvider`. |
| `WsProvider` unmount       | Clears the queue. Store reset matches `WsProvider`. |
| Waiting for auto-reconnect | Keeps the queue.                                    |

## Exported types

From the main `react-ws-context` entry:

| Type                     | Description                                     |
| ------------------------ | ----------------------------------------------- |
| `CreateWsContextOptions` | Options for `createWsContext`.                  |
| `MaybeGetter<T>`         | `T \| (() => T)`. Static value or sync getter.  |
| `LivenessOptions`        | Options for `liveness` in `createWsContext`.    |
| `WsContextValue`         | Return type of `useWsActions()`.                |
| `WsEvents`               | Event name to handler map.                      |
| `WsStatus`               | WebSocket connection state. Field of `WsState`. |
| `WsPhase`                | Connection phase.                               |
| `WsState`                | Subscribable connection state.                  |

## License

[MIT License](./LICENSE). Copyright (c) 2026 [GaiaYang](https://github.com/GaiaYang). Source is [github.com/GaiaYang/react-ws](https://github.com/GaiaYang/react-ws), package path `packages/react-ws`.

## Acknowledgments

This package does not list zustand or nanoevents as npm dependencies. It inlines the subsets it uses. Source files include attribution headers.

[zustand](https://github.com/pmndrs/zustand) is MIT-licensed, maintained by [pmndrs](https://github.com/pmndrs) (Poimandres). The external store API follows [`vanilla.ts`](https://github.com/pmndrs/zustand/blob/main/src/vanilla.ts) without middleware, replace, or an initializer factory. `setState` skips notification when field values are unchanged. The React subscription follows [`react.ts`](https://github.com/pmndrs/zustand/blob/main/src/react.ts) `useStore` without `useDebugValue`. This package adds an optional selector overload for `useWsStore`. The files are `src/ws-context/store.ts` and `src/ws-context/use-store.ts`.

[nanoevents](https://github.com/ai/nanoevents) is MIT-licensed, written by [Andrey Sitnik](https://github.com/ai) (`ai`). Typed event dispatch at runtime follows [`createNanoEvents`](https://github.com/ai/nanoevents/blob/main/index.js). Types are this package's subset. The React subscription wrapper is new here. The files are `src/ws-context/emitter.ts` and `src/ws-context/ws-events.ts`.
