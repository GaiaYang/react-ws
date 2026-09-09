# react-ws-context

[![npm version](https://img.shields.io/npm/v/react-ws-context.svg)](https://www.npmjs.com/package/react-ws-context)
[![npm downloads](https://img.shields.io/npm/dm/react-ws-context.svg)](https://www.npmjs.com/package/react-ws-context)

> [繁體中文](./README.zh-TW.md)

`react-ws-context` is a WebSocket connection layer for React that keeps connection lifecycle, connection state, and WebSocket events separate. It is designed for applications that need reconnect, liveness, and an outgoing queue without putting WebSocket message traffic into React state.

```text
                       react-ws-context

WebSocket ──→ Events ─────────────→ Event handlers
    │
    └──────→ Connection state ────→ External store ──→ React
```

## Why this split

A common pattern opens a socket and stores each message in `useState` or React context. Message updates then follow that React update path, so UI that only needs connection status can still re-render when traffic arrives.

Separate hooks cover each job:

- Connection health and reconnect progress go through `useWsStore`.
- Incoming messages and socket events go through `useWsEvents`.
- Send, connect, and disconnect go through `useWsActions`, with no store subscription.

If your app needs message history, write the payload into your own state or store inside the `message` handler.

## Install

```bash
pnpm add react-ws-context react
# or: npm install react-ws-context react
# or: yarn add react-ws-context react
```

Requires React 18 or newer (`useSyncExternalStore`). No runtime npm dependencies. Needs `globalThis.WebSocket`. The package entry is marked `"use client"`, so Next.js App Router can import it. A SPA ignores the directive.

## Quick start

One `createWsContext` call is one WebSocket connection. It returns a Provider and three hooks bound to that connection.

```tsx
"use client";

import { createWsContext } from "react-ws-context";

export const { WsProvider, useWsActions, useWsStore, useWsEvents } =
  createWsContext({
    url: "ws://localhost:8080",
    reconnectMs: 2000,
  });
```

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
    // Keep history in your own state or store.
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

Two sockets need two `createWsContext` calls, for example one for app traffic and one for notifications. Hooks must run under the matching `WsProvider`.

## How it works

`WsProvider` owns the native `WebSocket`. The three hooks are three channels into that same connection.

| Hook           | Job                                                      | How you use it              |
| -------------- | -------------------------------------------------------- | --------------------------- |
| `useWsActions` | `send`, `sendJson`, `connect`, `disconnect`, `getStatus` | Call actions                |
| `useWsStore`   | Connection state via selector                            | Subscribe to external store |
| `useWsEvents`  | `"message"`, `"open"`, `"error"`, `"close"`              | Subscribe to WebSocket events |

`useWsActions` returns stable method references. A component that only calls it does not re-render on store updates or messages.

`useWsStore` uses `useSyncExternalStore`. Prefer a selector so a change to `nextReconnectAt` does not re-render a component that only shows `status`.

`useWsEvents` subscribes on mount and unsubscribes on unmount. Updating the callback does not re-subscribe. Changing `type` re-subscribes. Each call listens to one event type.

Connection state has two fields that often move together but mean different things:

- `status` is the WebSocket connection state (similar to `readyState`).
- `phase` is the Provider connection phase, including reconnect.

Example: `phase === "reconnecting"` and `status === "closed"` means the socket is closed and the Provider is waiting for the next auto-reconnect.

```tsx
const phase = useWsStore((s) => s.phase);
const status = useWsStore((s) => s.status);

const canConnect = phase === "idle" || phase === "stopped";
const canDisconnect =
  phase === "open" || phase === "connecting" || phase === "reconnecting";
```

## Configuration

Full types and defaults are in [API reference](#api-reference).

### Connection

| Field         | Default  | Notes                                                                 |
| ------------- | -------- | --------------------------------------------------------------------- |
| `url`         | required | Static string or sync getter, resolved at the start of each `connect()` |
| `protocols`   | none     | Same getter rules as `url`                                            |
| `autoConnect` | `true`   | Connect when `WsProvider` mounts                                      |
| `reconnectMs` | `0`      | First wait after an unintentional close. `0` turns reconnect off      |

`url` and `protocols` may be sync getters. The getter runs at the start of each `connect()`. It must be synchronous. Do not `await` or call hooks inside it. This package does not handle auth. Your app supplies the token source.

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

If the getter throws, the URL is empty, or `new WebSocket` throws, `connect()` emits `"error"` and leaves any existing socket as-is. `connect()` itself does not throw. If this `connect()` was run by an already-fired auto-reconnect timer, handshake failure stops auto-retry and the store becomes `status: "closed"`, `phase: "stopped"`.

### Reconnect schedule

These apply when `reconnectMs > 0`.

| Field                  | Default | Notes                                                                 |
| ---------------------- | ------- | --------------------------------------------------------------------- |
| `reconnectBackoff`     | `2`     | Multiplier for the next wait. `1` keeps a fixed interval              |
| `reconnectMax`         | `0`     | Cap on auto-reconnects. `0` means no cap                              |
| `reconnectDelayMaxMs`  | `30000` | Hard cap for one wait, including jitter. `0` removes the cap          |
| `reconnectJitter`      | `0.2`   | Random shorten in `[0, 1]`. `0` disables jitter                       |
| `reconnectMinUptimeMs` | `5000`  | How long a connection must stay open before the cycle resets. `0` resets on `open` |

Default schedule with `reconnectMs: 1000`: wait about 1s, then 2s, then 4s, capped at 30s, each delay shortened by a random 0% to 20%. The cycle resets after the socket stays open for 5s.

Fixed interval, no jitter, reset on every `open`:

```ts
createWsContext({
  url: "ws://localhost:8080",
  reconnectMs: 2000,
  reconnectBackoff: 1,
  reconnectJitter: 0,
  reconnectMinUptimeMs: 0,
});
```

### Optional behavior

| Field              | Default | Notes                                              |
| ------------------ | ------- | -------------------------------------------------- |
| `parse`            | see API | Turns raw `MessageEvent.data` into app data        |
| `liveness`         | none    | Application-layer ping and pong. Omitted means off |
| `outgoingQueueMax` | `0`     | Max queued sends while disconnected. `0` means off |

See [Reconnect](#reconnect), [Liveness](#liveness), and [Outgoing queue](#outgoing-queue).

## API reference

### `createWsContext`

`createWsContext(options)` returns a `WsProvider` and hooks bound to the same connection config. Those options are fixed when the context is created. To use different options, call `createWsContext` again.

#### Options

`CreateWsContextOptions`

| Field                  | Type                                      | Default   | Description                                                                                                                                     |
| ---------------------- | ----------------------------------------- | --------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `url`                  | `MaybeGetter<string>`                     | required  | WebSocket URL. A sync getter runs at the start of each `connect()`.                                                                             |
| `protocols`            | `MaybeGetter<string \| string[]>`         | none      | Passed to `new WebSocket(url, protocols)`. When omitted, the second argument is not passed. An empty string from a getter is passed through.    |
| `autoConnect`          | `boolean`                                 | `true`    | Connect when `WsProvider` mounts.                                                                                                               |
| `reconnectMs`          | `number`                                  | `0`       | First wait in ms after an unintentional close. `0` disables reconnect.                                                                          |
| `reconnectMax`         | `number`                                  | `0`       | Max auto-reconnects after an unintentional close. `0` means no cap. Reconnect still requires `reconnectMs > 0`.                                 |
| `reconnectBackoff`     | `number`                                  | `2`       | Multiplier for the next wait. Default `2` doubles it. `1` keeps the wait unchanged. Values below `1` are clamped to `1`.                        |
| `reconnectDelayMaxMs`  | `number`                                  | `30000`   | Hard cap in ms for one wait, jitter included. `0` removes the cap.                                                                              |
| `reconnectJitter`      | `number`                                  | `0.2`     | Random shorten of each wait, in `[0, 1]`. Default `0.2` waits 80% to 100% of the scheduled delay. `1` is full jitter. `0` disables jitter.      |
| `reconnectMinUptimeMs` | `number`                                  | `5000`    | How long a connection must stay open, in ms, before the reconnect cycle resets. `0` resets on `open`.                                           |
| `outgoingQueueMax`     | `number`                                  | `0`       | Max outgoing queue size while not connected. `0` disables the queue.                                                                            |
| `parse`                | `(data: MessageEvent["data"]) => unknown` | see below | Turns raw `MessageEvent.data` into app data.                                                                                                    |
| `liveness`             | `LivenessOptions`                         | none      | Application-layer heartbeat. Disabled when omitted.                                                                                             |

Default `parse` runs `JSON.parse` on a string and returns the raw string if parse fails. It returns non-strings as-is.

#### Returns

| Name           | Type                                 | Description                                   |
| -------------- | ------------------------------------ | --------------------------------------------- |
| `WsProvider`   | `React.FC<{ children }>`             | Holds the WebSocket for the subtree it wraps. |
| `useWsActions` | `() => WsContextValue`               | Connection actions.                           |
| `useWsStore`   | `() => WsState` or `(selector) => T` | Connection state.                             |
| `useWsEvents`  | `(type, handler) => void`            | WebSocket events.                             |

### `WsProvider`

`WsProvider` creates the native `WebSocket` and closes it when the Provider unmounts.

| When                                      | What happens                                                                                                                                                                                                                              |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Mount and `autoConnect: true`             | Connects.                                                                                                                                                                                                                                 |
| Unmount                                   | Cancels reconnect and resets reconnect progress, stops `liveness`, and clears the outgoing queue. The store becomes `status: "closed"`, `phase: "idle"`. An existing socket is closed and `close` fires with reason `"provider unmount"`. |
| `disconnect()`                            | Same cleanup and store reset as unmount. No auto-reconnect. An existing socket fires `close` with reason `"client disconnect"`.                                                                                                           |
| Unintentional close and `reconnectMs > 0` | Schedules reconnect with backoff, delay cap, and jitter. Stops after `reconnectMax` when that value is greater than `0`. While waiting, the due time is `nextReconnectAt`.                                                                |
| `connect()` with an existing socket       | Constructs the new socket first. On success, closes the previous one and fires `close` with reason `"reconnect"`. If construction fails, the existing socket is left as-is.                                                               |
| Handshake failure                         | Emits `"error"`. Does not open a socket or close an existing one. The store is left as-is. If the reconnect timer had already fired, the store becomes `status: "closed"`, `phase: "stopped"`, and auto-retry stops.                      |

### `useWsActions`

`useWsActions(): WsContextValue`

Throws `"useWsActions 必須包在對應的 WsProvider 內"` outside the matching `WsProvider`.

| Method       | Signature                    | Description                                                                                                                                                                   |
| ------------ | ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `send`       | `(data) => boolean`          | Sends raw data accepted by `WebSocket.send`. Sends immediately when open. Otherwise enqueues when the outgoing queue is enabled.                                              |
| `sendJson`   | `(data: unknown) => boolean` | `JSON.stringify` then `send`. Returns `false` when the value is not serializable.                                                                                             |
| `connect`    | `() => void`                 | Resolves `url` and `protocols` and constructs the socket. On success, closes any existing socket. Handshake failure is described under [Connection](#connection). |
| `disconnect` | `() => void`                 | Intentional close. Store becomes `phase: "idle"`, `status: "closed"`. No auto-reconnect. Clears the outgoing queue.                                                           |
| `getStatus`  | `() => WsStatus`             | Reads the current `status` without a subscription.                                                                                                                            |

`send` and `sendJson` return `true` when the payload was sent or enqueued. They return `false` when the queue is full, the queue is disabled, or `sendJson` could not serialize.

### `useWsStore`

Throws `"useWsStore 必須包在對應的 WsProvider 內"` outside the matching `WsProvider`.

```ts
useWsStore(): WsState
useWsStore<T>(selector: (state: WsState) => T): T
```

A call with no selector subscribes to the whole `WsState`. Incoming messages are not in this store.

#### `WsState`

| Field                | Type       | Description                                                                               |
| -------------------- | ---------- | ----------------------------------------------------------------------------------------- |
| `status`             | `WsStatus` | Current WebSocket connection state.                                                       |
| `phase`              | `WsPhase`  | Provider connection phase.                                                                |
| `reconnectAttempt`   | `number`   | Auto-reconnects scheduled in the current cycle.                                           |
| `reconnectExhausted` | `boolean`  | Auto-reconnect hit `reconnectMax` and the last attempt also failed.                       |
| `nextReconnectAt`    | `number`   | When the next auto-reconnect is due, as `Date.now()` milliseconds. `0` while not waiting. |

`reconnectAttempt` is `n` when the nth reconnect is scheduled or in progress. It increments when an unintentional close queues a retry, not when the retry succeeds. It resets after the connection has stayed open for `reconnectMinUptimeMs` (default 5s). When that option is `0`, it resets on `open`. `disconnect()` resets it immediately. A manual `connect()` resets it immediately unless a reconnect timer is already waiting. Then it resets once that connection stays open for `reconnectMinUptimeMs`.

A later `connect()` or `disconnect()` sets `reconnectExhausted` back to `false`.

With backoff and jitter, `nextReconnectAt - Date.now()` is the wait that is actually scheduled.

Options such as `reconnectMax` are fixed at `createWsContext` and are not in `WsState`. The URL used for a handshake is not stored either. A label such as "attempt n of m" needs those config values kept beside the component.

#### `WsStatus`

| Value        | Meaning                                                                    |
| ------------ | -------------------------------------------------------------------------- |
| `idle`       | Not connected yet. Initial value only. Does not return after a disconnect. |
| `connecting` | Connecting.                                                                |
| `open`       | Connected.                                                                 |
| `closed`     | Disconnected.                                                              |

`disconnect()` sets `status: "closed"` and `phase: "idle"`. `status` does not return to `idle`. Connection errors are not a `WsStatus`. They arrive through `useWsEvents("error")`. A native `error` is usually followed by `close`.

#### `WsPhase`

| Value          | Meaning                                                                               |
| -------------- | ------------------------------------------------------------------------------------- |
| `idle`         | Not connected, no reconnect scheduled. Initial value, or after manual `disconnect()`. |
| `connecting`   | First connect or manual `connect()` in progress.                                      |
| `open`         | Connected.                                                                            |
| `reconnecting` | Auto-reconnect cycle. Waiting for the timer, or connecting.                           |
| `stopped`      | Will not auto-reconnect.                                                              |

When `phase` is `stopped`, `reconnectExhausted` is `true` if the attempt cap was hit. It is `false` when reconnect is off, or when handshake failed after the reconnect timer fired.

`phase === "reconnecting"` with `status === "connecting"` means the reconnect timer fired and a connect attempt is in progress.

### `useWsEvents`

`useWsEvents(type, handler)`

Throws `"useWsEvents 必須包在對應的 WsProvider 內"` outside the matching `WsProvider`.

| `type`      | Handler                                        | Description                   |
| ----------- | ---------------------------------------------- | ----------------------------- |
| `"message"` | `(data: unknown, event: MessageEvent) => void` | `data` is the parsed payload. |
| `"open"`    | `(event: Event) => void`                       | Connection open.              |
| `"error"`   | `(event: Event) => void`                       | Socket or handshake error.    |
| `"close"`   | `(event: CloseEvent) => void`                  | Connection closed.            |

On an unintentional close, the Provider writes `status: "closed"` and the matching `phase` before it runs the `close` handler. Intentional `disconnect()` and Provider unmount use the same order: store first, then `close` when a socket exists.

Handshake failure emits `"error"` as `{ type: "error" }`, without `close` and without replacing an existing socket.

When `connect()` replaces an existing socket after a successful construct, `close` fires first with reason `"reconnect"`, then `status` becomes `"connecting"`. `phase` becomes `"reconnecting"` when this `connect()` came from the reconnect timer, otherwise `"connecting"`.

## Reconnect

Reconnect reopens the socket after an unintentional close without remounting the Provider. It is off while `reconnectMs` is `0`.

- A reconnect attempt constructs the new socket first and closes the old one only after that succeeds. Handshake failure leaves an existing socket alone (same rule as a manual `connect()`).
- If handshake fails after the reconnect timer has already fired, auto-retry stops and `phase` becomes `"stopped"`. Call `connect()` to try again.
- If the server accepts a connection and closes it right away, keep `reconnectMinUptimeMs` above `0` (default `5000`). With `0`, each short-lived `open` resets the cycle, so backoff and `reconnectMax` stay on the first step.

## Liveness

Liveness is an optional application-layer heartbeat used to detect a WebSocket that still looks open but no longer responds normally at the application layer. It is not a WebSocket control-frame ping.

When `liveness` is set, the Provider sends periodic application-layer pings directly to the open socket. Those pings skip the outgoing queue. If no matching pong arrives within `timeoutMs`, the Provider closes the socket. That close can trigger reconnect when `reconnectMs > 0`.

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

Incoming messages are checked with `isPong`. A pong clears the timeout timer and still fires `"message"`. The Provider sends ping payloads with `JSON.stringify`, so the ping body must be JSON-serializable.

## Outgoing queue

The outgoing queue holds sends while the socket is not open. Use it when a brief disconnect should not drop outbound work. It is off while `outgoingQueueMax` is `0`.

When `outgoingQueueMax > 0`:

| When                       | Behavior                                            |
| -------------------------- | --------------------------------------------------- |
| `send` while not connected | Enqueue, first in, first out.                       |
| Queue full                 | Returns `false`. Does not drop older messages.      |
| On `open`                  | Sends the entire queue in order.                    |
| `disconnect()`             | Clears the queue.                                   |
| `WsProvider` unmount       | Clears the queue.                                   |
| Waiting for auto-reconnect | Keeps the queue.                                    |

## Demo

The Next.js demo is in [`apps/web`](https://github.com/GaiaYang/react-ws/tree/main/apps/web). Setup steps are in [Run the demo](https://github.com/GaiaYang/react-ws#run-the-demo).

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
