# react-ws-context

[![npm version](https://img.shields.io/npm/v/react-ws-context.svg)](https://www.npmjs.com/package/react-ws-context)
[![npm downloads](https://img.shields.io/npm/dm/react-ws-context.svg)](https://www.npmjs.com/package/react-ws-context)

> [繁體中文](./README.zh-TW.md)

`react-ws-context` manages one WebSocket's lifecycle in React. Connection state and events stay separate.

```text
                       react-ws-context

WebSocket ──→ Events ─────────────→ Event handlers
    │
    └──────→ Connection state ────→ External store ──→ React
```

## What is this?

This package is a connection layer. It manages one WebSocket's lifecycle: connect, disconnect, reconnect, liveness, and connection state.

It does not define the message protocol, keep message history, or queue outgoing messages. Incoming messages are not in `WsState`. Keep them in your own state or store.

## Core concepts

| Need                          | API            |
| ----------------------------- | -------------- |
| Send, connect, disconnect     | `useWsActions` |
| Subscribe to connection state | `useWsStore`   |
| Listen to WebSocket events    | `useWsEvents`  |

```text
                    WsProvider
                         │
              ┌──────────┼──────────┐
              │          │          │
           Actions      Store      Events
              │          │          │
           commands     state    notifications
              │          │          │
           connect      status      message
           send         phase       open
           disconnect   reconnect   error
                                  close
```

- `useWsActions`: commands on the socket (`connect` / `send` / `disconnect`)
- `useWsStore`: read connection state
- `useWsEvents`: receive WebSocket events

### One context = one WebSocket

One `createWsContext` call is one WebSocket. It returns a `WsProvider` and three hooks bound to that connection. Two sockets need two calls. Hooks must run under the matching `WsProvider`.

### What this package manages

- WebSocket lifecycle (connect on mount, close on unmount)
- Connection state (`status` / `phase`) and reconnect progress fields
- Auto-reconnect after an unintentional close (backoff, cap, jitter)
- Application-layer liveness (optional)
- Dispatch of `"message"` / `"error"` after `parse`

### What this package does not manage

- Message protocol and business payload semantics
- Message history (incoming messages are not in `WsState`)
- Buffering outgoing messages while disconnected (`send` / `sendJson` return `false` when not open. No buffer.)
- Auth. Your app supplies the token.

## Install

```bash
pnpm add react-ws-context react
# or: npm install react-ws-context react
# or: yarn add react-ws-context react
```

Requires React 18+. See [Next.js / runtime](#nextjs--runtime) for the runtime notes.

## Quick start

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
  const phase = useWsStore((s) => s.phase);

  useWsEvents("message", (data) => {
    // Keep message history in your own state or store
    console.log("message", data);
  });

  return (
    <button
      disabled={status !== "open"}
      onClick={() => sendJson({ type: "chat", text: "hi" })}
    >
      Send ({status} / {phase})
    </button>
  );
}
```

## Connection state

`status` and `phase` are separate:

| Field    | Describes                                           |
| -------- | --------------------------------------------------- |
| `status` | WebSocket connection state, similar to `readyState` |
| `phase`  | Provider connection phase, including reconnect      |

For example:

```ts
{
  status: "closed",
  phase: "reconnecting",
}
```

The socket is closed. The Provider is waiting for or running the next auto-reconnect.

When `phase === "reconnecting"` and `status === "connecting"`, the reconnect timer has fired and a connect attempt is in progress.

### Common state combinations

| `status`     | `phase`        | Meaning                                   |
| ------------ | -------------- | ----------------------------------------- |
| `idle`       | `idle`         | Not connected yet                         |
| `connecting` | `connecting`   | First or manual connect in progress       |
| `open`       | `open`         | Connected                                 |
| `closed`     | `reconnecting` | Waiting for or preparing auto-reconnect   |
| `connecting` | `reconnecting` | Auto-reconnect is constructing the socket |
| `closed`     | `stopped`      | Will not auto-reconnect                   |
| `closed`     | `idle`         | Intentional disconnect                    |

```tsx
const canConnect = useWsStore(
  (s) => s.phase === "idle" || s.phase === "stopped",
);
```

### `WsStatus`

| Value        | Meaning                                                                    |
| ------------ | -------------------------------------------------------------------------- |
| `idle`       | Not connected yet. Initial value only. Does not return after a disconnect. |
| `connecting` | Connecting.                                                                |
| `open`       | Connected.                                                                 |
| `closed`     | Disconnected.                                                              |

`disconnect()` sets `status: "closed"` and `phase: "idle"`. `status` does not return to `idle`.

Connection errors are not a `WsStatus`. They arrive through `useWsEvents("error")`. A native `error` is usually followed by `close`.

### `WsPhase`

| Value          | Meaning                                                                               |
| -------------- | ------------------------------------------------------------------------------------- |
| `idle`         | Not connected, no reconnect scheduled. Initial value, or after manual `disconnect()`. |
| `connecting`   | First connect or manual `connect()` in progress.                                      |
| `open`         | Connected.                                                                            |
| `reconnecting` | Auto-reconnect cycle. Waiting for the timer, or connecting.                           |
| `stopped`      | Will not auto-reconnect.                                                              |

When `phase` is `stopped`, `reconnectExhausted` is `true` if `reconnectMax` was hit.

It is `false` when reconnect is off, or when handshake failed after the reconnect timer fired.

## Reconnect

Reconnect reopens the socket after an unintentional close without remounting the Provider.

### Basic behavior

When `reconnectMs > 0`, an unintentional close schedules reconnect (backoff / cap / jitter).

`reconnectMs: 0` turns reconnect off.

Manual `disconnect()` or Provider unmount does not auto-reconnect.

`reconnectMax: 3` means at most 3 auto-reconnects. It does not include the initial `connect()` or a later manual `connect()`.

`reconnectMax: 0` means no cap.

```text
connect()
   │
   ▼
connecting
   │
   ├── success ──→ open
   │
   └── failure (see connect() replacement / construct failure)

non-active close
   │
   ▼
reconnecting
   │
   ├── retry ──→ connecting (phase stays reconnecting)
   │
   └── exhausted / no more retries ──→ stopped
```

### Options

These apply when `reconnectMs > 0`.

| Field                  | Default | Notes                                                                              |
| ---------------------- | ------- | ---------------------------------------------------------------------------------- |
| `reconnectBackoff`     | `2`     | Multiplier for the next wait. `1` keeps a fixed interval                           |
| `reconnectMax`         | `0`     | Cap on auto-reconnects. `0` means no cap                                           |
| `reconnectDelayMaxMs`  | `30000` | Hard cap for one wait, including jitter. `0` removes the cap                       |
| `reconnectJitter`      | `0.2`   | Random shorten in `[0, 1]`. `0` disables jitter                                    |
| `reconnectMinUptimeMs` | `5000`  | How long a connection must stay open before the cycle resets. `0` resets on `open` |

### Retry timing

Wait for attempt `n`:

```text
reconnectMs * reconnectBackoff ** (n - 1)
```

Then apply `reconnectDelayMaxMs` when greater than `0`, then multiply by:

```text
(1 - random * reconnectJitter)
```

Default schedule with `reconnectMs: 1000`: about 1s, then 2s, then 4s, capped at 30s, each delay shortened by a random 0% to 20%.

The cycle resets after the socket stays open for `reconnectMinUptimeMs`.

If the server accepts then closes right away, keep `reconnectMinUptimeMs > 0`. With `0`, every `open` resets the reconnect cycle.

If the socket closes soon after, the next reconnect starts again from the first wait, and `reconnectMax` recounts from zero.

`0` means different things by field:

| Setting                | Meaning of `0`      |
| ---------------------- | ------------------- |
| `reconnectMs`          | Turns reconnect off |
| `reconnectMax`         | No cap on retries   |
| `reconnectDelayMaxMs`  | No wait cap         |
| `reconnectMinUptimeMs` | Reset on `open`     |
| `reconnectJitter`      | No jitter           |

Fixed interval, no jitter, reset on every `open`:

```tsx
createWsContext({
  url: "ws://localhost:8080",
  reconnectMs: 2000,
  reconnectBackoff: 1,
  reconnectJitter: 0,
  reconnectMinUptimeMs: 0,
});
```

### `connect()` replacement

Reconnect and manual `connect()` share the same rule:

```text
existing socket
      │
      │ connect() / reconnect
      ▼
create new socket
      │
      ├── failure → keep existing socket
      │
      └── success → replace existing socket
```

Construct the new socket first. On success, close the old one, fire `close` with reason `"reconnect"`, then set `status` to `"connecting"`.

When the call came from an already-fired reconnect timer, `phase` is `"reconnecting"`.

A manual `connect()` uses `"connecting"`. That includes a connect issued while the wait is still counting down.

If construct fails because the getter throws, the URL is empty, or `new WebSocket` throws, emit `"error"`, keep any existing socket, and do not throw from `connect()`.

If the call came from an already-fired reconnect timer, stop auto-retry and set the store to:

```ts
{
  status: "closed",
  phase: "stopped",
}
```

If a reconnect wait is still pending, cancel that timer and schedule the next wait. An early failed try continues the cycle.

Hitting `reconnectMax` sets `phase` to `stopped`. Call `connect()` to try again.

For event payloads and store / `close` order, see [Events → Ordering and failure behavior](#ordering-and-failure-behavior).

### Store fields

#### `reconnectAttempt`

`n` means the nth reconnect is scheduled or in progress.

It increments when an unintentional close queues a retry, not when the retry succeeds.

#### `nextReconnectAt`

Due time while waiting, in `Date.now()` milliseconds.

`0` while not waiting.

Actual remaining wait:

```text
nextReconnectAt - Date.now()
```

#### `reconnectExhausted`

Hit `reconnectMax` and the last attempt also failed.

A later `connect()` or `disconnect()` clears it to `false`.

### Cycle reset

The reconnect cycle resets after the socket stays open for `reconnectMinUptimeMs`.

Default is `5000` ms.

With `reconnectMinUptimeMs: 0`, reset happens on `open`.

`disconnect()` resets immediately.

A manual `connect()` resets immediately if no reconnect timer is waiting. If a timer is waiting, the cycle resets only after that connection stays open for `reconnectMinUptimeMs`.

## Liveness

`liveness` is an application-layer heartbeat, not a WebSocket protocol ping/pong.

It detects a socket whose `readyState` is still open but that no longer responds at the application layer.

When you enable `liveness`, the Provider sends application-layer pings on an interval. If no matching pong arrives within `timeoutMs`, it closes the socket.

When `reconnectMs > 0`, that close is treated as an unintentional close and schedules reconnect.

```text
ping
  ↓
WebSocket.send()
  ↓
server response
  ↓
parse()
  ↓
isPong()
```

`ping` comes from the application. This package does not auto-`JSON.stringify` it.

`isPong` inspects the `parse` result. Only `true` counts as a pong. A pong still fires `"message"`.

If `ping` throws, that send is skipped, but the pong wait still starts. Without a pong the socket still closes after `timeoutMs`.

If `ping` synchronously calls `disconnect()` or a successful `connect()`, the abandoned handshake does not emit `"open"`.

```tsx
createWsContext({
  url: "ws://localhost:8080",
  reconnectMs: 3000,
  liveness: {
    intervalMs: 30_000,
    timeoutMs: 10_000,
    ping: JSON.stringify({ type: "ping" }),
    isPong: (data) =>
      typeof data === "object" &&
      data != null &&
      (data as { type?: string }).type === "pong",
  },
});
```

See [`LivenessOptions`](#livenessoptions) under `createWsContext`.

## Sending messages

This package does not buffer outgoing messages while disconnected.

```text
send() / sendJson()
        │
        ├── socket open → send → true
        │
        └── socket not open → false
```

| Method     | Behavior                                                                                                                               |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `send`     | When open, sends and returns `true`. When not open, returns `false` with no buffer. If open, a throw from `WebSocket.send` propagates. |
| `sendJson` | `JSON.stringify` then `send`. Returns `false` when not serializable; send-time behavior matches `send`.                                |

## Events

### Message parsing

Each `MessageEvent` runs through `parse` first:

```text
MessageEvent
    │
    ▼
  parse()
    │
    ├── throw ──→ "error"
    │              │
    │              ├── skip "message"
    │              └── do not close
    │
    └── success
          │
          ▼
      "message"
```

Default `parse` tries `JSON.parse` on strings and returns the raw string on failure. Non-strings return as-is.

### Event types

| `type`      | Handler                                        | Description                                                                                                |
| ----------- | ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `"message"` | `(data: unknown, event: MessageEvent) => void` | `data` is the `parse` result.                                                                              |
| `"open"`    | `(event: Event) => void`                       | Connection open.                                                                                           |
| `"error"`   | `(event: Event) => void`                       | Socket, handshake, or `parse` error. Handshake / resolve failures are `{ type: "error" }`, not an `Error`. |
| `"close"`   | `(event: CloseEvent) => void`                  | Connection closed.                                                                                         |

### Subscription behavior

`useWsEvents(type, handler)`:

- Subscribes on mount
- Unsubscribes on unmount
- Updating the handler does not re-subscribe
- Changing `type` re-subscribes
- Each call listens to one event type

A throwing handler does not propagate. It also does not interrupt connection-layer work such as switching sockets or starting liveness.

If several handlers listen to the same event, a throw in one may skip later handlers in that same emit.

### Ordering and failure behavior

| Case                                            | `"error"`                                     | `"close"`               | Socket / store                                                                                                                                      |
| ----------------------------------------------- | --------------------------------------------- | ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unintentional close                             | May fire. A native `error` often comes first. | Yes                     | Write `status: "closed"` and matching `phase`, then run the `close` handler                                                                         |
| `disconnect()` / Provider unmount               | none                                          | Only if a socket exists | Update store first, then `close`                                                                                                                    |
| Handshake / resolve / `new WebSocket` fail      | `{ type: "error" }` (no `message`)            | No                      | Do not replace existing socket. Fired reconnect timer sets `closed` / `stopped`. Still waiting cancels and reschedules. See [Reconnect](#reconnect) |
| `parse` throws                                  | Yes                                           | No                      | Skip `"message"`, do not close                                                                                                                      |
| `connect()` replaces after successful construct | No                                            | Reason `"reconnect"`    | `close` first, then `status: "connecting"`. See `phase` under [Reconnect](#reconnect)                                                               |

## API reference

### `createWsContext`

`createWsContext(options)` returns a `WsProvider` and hooks bound to the same config.

Options stay fixed after creation. Call again for different options.

#### Options

`CreateWsContextOptions`

| Field                  | Type                                      | Default                        | Description                                                                                                                                  |
| ---------------------- | ----------------------------------------- | ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `url`                  | `MaybeGetter<string>`                     | required                       | WebSocket URL. A sync getter runs at the start of each `connect()`.                                                                          |
| `protocols`            | `MaybeGetter<string \| string[]>`         | none                           | Passed to `new WebSocket(url, protocols)`. When omitted, the second argument is not passed. An empty string from a getter is passed through. |
| `autoConnect`          | `boolean`                                 | `true`                         | Connect when `WsProvider` mounts.                                                                                                            |
| `reconnectMs`          | `number`                                  | `0`                            | First wait in ms after an unintentional close. `0` disables reconnect. See [Reconnect](#reconnect).                                          |
| `reconnectMax`         | `number`                                  | `0`                            | Cap on auto-reconnects. `0` means no cap. Still requires `reconnectMs > 0`.                                                                  |
| `reconnectBackoff`     | `number`                                  | `2`                            | Multiplier for the next wait. `2` doubles; `1` keeps wait unchanged; values below `1` clamp to `1`.                                          |
| `reconnectDelayMaxMs`  | `number`                                  | `30000`                        | Hard cap in ms for one wait, jitter included. `0` removes the cap.                                                                           |
| `reconnectJitter`      | `number`                                  | `0.2`                          | Random shorten in `[0, 1]`. Default waits 80% to 100% of the scheduled delay. `1` is full jitter; `0` disables.                              |
| `reconnectMinUptimeMs` | `number`                                  | `5000`                         | How long a connection must stay open, in ms, before the reconnect cycle resets. `0` resets on `open`.                                        |
| `parse`                | `(data: MessageEvent["data"]) => unknown` | see [Events](#message-parsing) | Maps raw `MessageEvent.data` to app data. A throw emits `"error"`, skips `"message"`, and does not close the socket.                         |
| `liveness`             | `LivenessOptions`                         | none                           | Application-layer heartbeat. Disabled when omitted.                                                                                          |

Getters for `url` and `protocols` must be synchronous. Do not `await` or call hooks inside them.

This package does not handle auth. Your app supplies the token.

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

For `connect()` construct failure, see [Reconnect → `connect()` replacement](#connect-replacement).

#### `LivenessOptions`

| Field        | Type                                                                 | Description                                                                      |
| ------------ | -------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `intervalMs` | `number`                                                             | Ping interval in ms.                                                             |
| `timeoutMs`  | `number`                                                             | Wait for pong in ms.                                                             |
| `ping`       | payload accepted by `WebSocket.send`, or a function that returns one | Ping to send. A function is called each time.                                    |
| `isPong`     | `(data: unknown) => boolean`                                         | Whether the `parse` result is a pong. A throw means no; `"message"` still fires. |

#### Returns

| Name           | Type                                 | Description                             |
| -------------- | ------------------------------------ | --------------------------------------- |
| `WsProvider`   | `React.FC<{ children }>`             | Manages the WebSocket for its children. |
| `useWsActions` | `() => WsContextValue`               | Connection actions.                     |
| `useWsStore`   | `() => WsState` or `(selector) => T` | Connection state.                       |
| `useWsEvents`  | `(type, handler) => void`            | WebSocket events.                       |

### `WsProvider`

Manages the native `WebSocket` for its subtree. Closes it on unmount.

| When                                      | What happens                                                                                                                                                                |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Mount and `autoConnect: true`             | Connects.                                                                                                                                                                   |
| Unmount                                   | Cancels reconnect, resets reconnect progress, stops `liveness`. Sets store to `status: "closed"`, `phase: "idle"`. Existing socket closes with reason `"provider unmount"`. |
| `disconnect()`                            | Same cleanup and store reset as unmount. No auto-reconnect. Existing socket fires `close` with reason `"client disconnect"`.                                                |
| Unintentional close and `reconnectMs > 0` | Schedules reconnect (backoff / cap / jitter). See [Reconnect](#reconnect).                                                                                                  |
| `connect()` with or without a socket      | See [Reconnect → `connect()` replacement](#connect-replacement).                                                                                                            |

### `useWsActions`

`useWsActions(): WsContextValue`

Throws outside the matching `WsProvider`:

```text
"useWsActions 必須包在對應的 WsProvider 內"
```

Method references are stable. A component that only calls it does not re-render on store or message updates.

| Method       | Signature                    | Description                                                                                                     |
| ------------ | ---------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `send`       | `(data) => boolean`          | When open, sends and returns `true`. When not open, returns `false`. See [Sending messages](#sending-messages). |
| `sendJson`   | `(data: unknown) => boolean` | `JSON.stringify` then `send`. See [Sending messages](#sending-messages).                                        |
| `connect`    | `() => void`                 | Resolves options and constructs the socket. See [Reconnect](#reconnect).                                        |
| `disconnect` | `() => void`                 | Intentional close. `phase: "idle"`, `status: "closed"`. No auto-reconnect.                                      |
| `getStatus`  | `() => WsStatus`             | Reads current `status` without a subscription.                                                                  |

### `useWsStore`

`useWsStore(): WsState` or with a selector.

Throws outside the matching `WsProvider`:

```text
"useWsStore 必須包在對應的 WsProvider 內"
```

```ts
useWsStore(): WsState
useWsStore<T>(selector: (state: WsState) => T): T
```

This hook uses `useSyncExternalStore`.

Without a selector it subscribes to the whole `WsState`. Prefer a selector.

The selector result is compared with `Object.is` to the previous result. If equal, other store field changes do not re-render this component.

A new object or array each time is never equal, so the component still re-renders.

Incoming messages are not in this store.

#### `WsState`

| Field                | Type       | Description                                                                                    |
| -------------------- | ---------- | ---------------------------------------------------------------------------------------------- |
| `status`             | `WsStatus` | WebSocket connection state. See [Connection state](#connection-state).                         |
| `phase`              | `WsPhase`  | Provider connection phase. See [Connection state](#connection-state).                          |
| `reconnectAttempt`   | `number`   | Auto-reconnects scheduled in the current cycle. See [Reconnect → Store fields](#store-fields). |
| `reconnectExhausted` | `boolean`  | Hit `reconnectMax` and the last attempt also failed. See above.                                |
| `nextReconnectAt`    | `number`   | When the next auto-reconnect is due (`Date.now()` ms). `0` while not waiting.                  |

Options such as `reconnectMax` and the handshake URL are not in `WsState`.

To show "attempt n of m" in the UI, keep those config values next to the component.

### `useWsEvents`

`useWsEvents(type, handler)`

Throws outside the matching `WsProvider`:

```text
"useWsEvents 必須包在對應的 WsProvider 內"
```

For event types and subscription behavior, see [Events](#events).

## Next.js / runtime

- Requires React 18+ and `useSyncExternalStore`.
- No runtime npm dependencies.
- Needs `globalThis.WebSocket`. Without it, `connect()` does not open a socket. If that call comes from an already-fired reconnect timer, the store becomes `status: "closed"`, `phase: "stopped"`.
- The package entry is marked `"use client"` for Next.js App Router. A SPA ignores the directive.

## Exported types

From the main `react-ws-context` entry:

| Type                     | Description                                    |
| ------------------------ | ---------------------------------------------- |
| `CreateWsContextOptions` | Options for `createWsContext`.                 |
| `MaybeGetter<T>`         | `T \| (() => T)`. Static value or sync getter. |
| `LivenessOptions`        | Options for `liveness`.                        |
| `WsContextValue`         | Return type of `useWsActions()`.               |
| `WsEvents`               | Event name to handler map.                     |
| `WsStatus`               | WebSocket connection state.                    |
| `WsPhase`                | Connection phase.                              |
| `WsState`                | Subscribable connection state.                 |

## Demo

Next.js demo: [`apps/web`](https://github.com/GaiaYang/react-ws/tree/main/apps/web).

## License

[MIT License](./LICENSE). Copyright (c) 2026 [GaiaYang](https://github.com/GaiaYang).

Source: [github.com/GaiaYang/react-ws](https://github.com/GaiaYang/react-ws), package path `packages/react-ws`.

## Sources and acknowledgments

This package does not list zustand or nanoevents as runtime npm dependencies. It inlines the subsets it uses. Related source files have attribution headers.

- [zustand](https://github.com/pmndrs/zustand) (MIT, [pmndrs](https://github.com/pmndrs)): external store follows [`vanilla.ts`](https://github.com/pmndrs/zustand/blob/main/src/vanilla.ts). React subscription follows [`react.ts`](https://github.com/pmndrs/zustand/blob/main/src/react.ts) `useStore`. Files: `src/ws-context/store.ts`, `src/ws-context/use-store.ts`.
- [nanoevents](https://github.com/ai/nanoevents) (MIT, [Andrey Sitnik](https://github.com/ai)): runtime follows [`createNanoEvents`](https://github.com/ai/nanoevents/blob/main/index.js). Files: `src/ws-context/emitter.ts`, `src/ws-context/ws-events.ts`.
