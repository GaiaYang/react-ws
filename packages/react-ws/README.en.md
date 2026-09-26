# react-ws-context

[![npm version](https://img.shields.io/npm/v/react-ws-context.svg)](https://www.npmjs.com/package/react-ws-context)
[![npm downloads](https://img.shields.io/npm/dm/react-ws-context.svg)](https://www.npmjs.com/package/react-ws-context)

> [繁體中文](./README.zh-TW.md)

`react-ws-context` manages the lifecycle of a single WebSocket connection in React, and keeps **connection state** and **WebSocket events** separate.

- Opening and closing the connection
- Auto-reconnect
- Connection state
- Reconnect progress
- Application-layer liveness checks

## Install

```bash
pnpm add react-ws-context react
# or: npm install react-ws-context react
# or: yarn add react-ws-context react
```

Requires React 18+.

For runtime and Next.js notes, see [Next.js and runtime](#nextjs-and-runtime).

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
    console.log("received message", data);
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

## Core concepts

Each call to `createWsContext` creates a `WsProvider` and three hooks bound to that WebSocket connection.

To manage two WebSockets, call `createWsContext` twice.

These hooks must be used inside the matching `WsProvider`.

```text
                       react-ws-context

WebSocket ──→ Events ─────────────→ Event handlers
    │
    └──────→ Connection state ────→ External store ──→ React
```

| Need                                        | API            |
| ------------------------------------------- | -------------- |
| Send messages, open or close the connection | `useWsActions` |
| Subscribe to connection state               | `useWsStore`   |
| Listen for WebSocket events                 | `useWsEvents`  |

- `useWsActions`: run WebSocket operations (`connect` / `send` / `disconnect`)
- `useWsStore`: read connection state
- `useWsEvents`: receive WebSocket event notifications

### What this package handles

- WebSocket lifecycle (connect on mount, close on unmount)
- Connection state (`status` / `phase`) and reconnect progress
- Auto-reconnect after an unintentional close (backoff, cap, jitter)
- Application-layer liveness (optional)
- Dispatch of `"message"` / `"error"` after `parse`

### What this package does not handle

- Message protocol and business payload semantics
- Message history. Incoming messages are not stored in `WsState`. Keep them in your own state or store, according to what the application needs
- Buffering outgoing messages while disconnected (`send` / `sendJson` return `false` when not connected, and do not buffer)
- Authentication. The application supplies the token

## Connection state

`useWsStore` subscribes to `WsState`, which has these fields:

- `status`
- `phase`
- `reconnectAttempt`
- `reconnectExhausted`
- `nextReconnectAt`

Reconnect fields are covered in [Reconnect → Store fields](#store-fields).

`status` and `phase` describe different layers of state:

| Field    | Description                                                       |
| -------- | ----------------------------------------------------------------- |
| `status` | The WebSocket's own connection state (similar to `readyState`)    |
| `phase`  | The connection phase the Provider is in, including auto-reconnect |

For example:

```ts
{
  status: "closed",
  phase: "reconnecting",
}
```

The WebSocket is closed, but the Provider is waiting for the next auto-reconnect, or is about to open a new connection.

### Common state combinations

| `status`     | `phase`        | Meaning                                     |
| ------------ | -------------- | ------------------------------------------- |
| `idle`       | `idle`         | Not connected yet                           |
| `connecting` | `connecting`   | First connect or manual connect in progress |
| `open`       | `open`         | Connected                                   |
| `closed`     | `reconnecting` | Waiting for or preparing an auto-reconnect  |
| `connecting` | `reconnecting` | Auto-reconnect in progress                  |
| `closed`     | `stopped`      | Will not auto-reconnect again               |
| `closed`     | `idle`         | Intentional close                           |

When `phase === "reconnecting"` and `status === "connecting"`, the reconnect timer has fired and a new WebSocket is being opened.

For example:

```tsx
const canConnect = useWsStore(
  (s) => s.phase === "idle" || s.phase === "stopped",
);
```

### `WsStatus`

| Value        | Meaning                                                                                       |
| ------------ | --------------------------------------------------------------------------------------------- |
| `idle`       | Not connected yet. Appears only in the initial state, and does not return after a disconnect. |
| `connecting` | Connecting.                                                                                   |
| `open`       | The WebSocket is open.                                                                        |
| `closed`     | The WebSocket is closed.                                                                      |

After `disconnect()`, the state becomes:

```ts
{
  status: "closed",
  phase: "idle",
}
```

`status` does not return to `idle`.

Connection errors are not a `WsStatus`. They are reported through `useWsEvents("error")`.

After a native WebSocket `"error"`, a `"close"` usually follows.

### `WsPhase`

| Value          | Meaning                                                                                                            |
| -------------- | ------------------------------------------------------------------------------------------------------------------ |
| `idle`         | Not connected, and no reconnect is scheduled. Also the initial state, and the state after a manual `disconnect()`. |
| `connecting`   | First connect or a manual `connect()` is opening the socket.                                                       |
| `open`         | The WebSocket is open.                                                                                              |
| `reconnecting` | Auto-reconnect is in progress, including waiting for the timer or opening a new connection.                         |
| `stopped`      | Will not auto-reconnect again.                                                                                      |

When `phase` is `stopped` and `reconnectMax` has been reached, `reconnectExhausted` is `true`.

`reconnectExhausted` is `true` only when `reconnectMax` has been reached and the last auto-reconnect also failed. Otherwise it is `false`.

## Sending messages

This package does not buffer outgoing messages while the WebSocket is not connected.

```text
send() / sendJson()
        │
        ├── socket open → send → true
        │
        └── socket not open → false
```

| Method     | Behavior                                                                                                                                                                           |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `send`     | When the WebSocket is open, sends and returns `true`. When it is not open, returns `false` and does not buffer. If `WebSocket.send` throws while open, the exception propagates. |
| `sendJson` | Calls `JSON.stringify`, then `send`. Returns `false` when the value cannot be serialized. After a successful stringify, sending matches `send`.                                    |

## Events

### Message parsing

Each `MessageEvent` is passed to `parse` first:

```text
MessageEvent
    │
    ▼
  parse()
    │
    ├── throw ──→ "error"
    │              │
    │              ├── do not fire "message"
    │              └── do not close the WebSocket
    │
    └── success
          │
          ▼
      "message"
```

Default `parse` behavior:

- Strings are passed to `JSON.parse`
- If JSON parsing fails, the raw string is returned
- Non-string data is returned as-is

### Event types

| `type`      | Handler                                        | Description                                                                                                               |
| ----------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `"message"` | `(data: unknown, event: MessageEvent) => void` | `data` is the result after `parse`.                                                                                       |
| `"open"`    | `(event: Event) => void`                       | The WebSocket connection opened.                                                                                          |
| `"error"`   | `(event: Event) => void`                       | A WebSocket, handshake, or `parse` error. Handshake or option-resolution failures pass `{ type: "error" }`, not an `Error`. |
| `"close"`   | `(event: CloseEvent) => void`                  | The WebSocket connection closed.                                                                                          |

### Subscription behavior

`useWsEvents(type, handler)` behaves as follows:

- Subscribes when the component mounts
- Unsubscribes when the component unmounts
- Updating `handler` does not re-subscribe
- Changing `type` re-subscribes
- Each call listens to one event type

If a handler throws, the exception does not propagate, and it does not interrupt later connection-layer work, such as replacing the WebSocket or starting liveness.

If several handlers listen to the same event and one throws, later handlers in that same notification may not run.

### Ordering and failure behavior

| Case                                          | `"error"`                                                    | `"close"`                        | WebSocket / store                                                                                                                                                                                                                          |
| --------------------------------------------- | ------------------------------------------------------------ | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Unintentional close                           | May fire. A native WebSocket usually fires `"error"` first. | Fires                            | Update `status: "closed"` and the matching `phase` first, then run the `"close"` handler                                                                                                                                                   |
| `disconnect()` / Provider unmount             | Does not fire                                                | Fires when a WebSocket exists    | Update the store first, then close the WebSocket                                                                                                                                                                                           |
| Handshake / resolve / `new WebSocket` failure | Fires `{ type: "error" }`                                    | Does not fire                    | Does not replace the existing WebSocket. A failure from an already-fired auto-reconnect timer sets `closed` / `stopped`. If the timer is still waiting, the current wait is cancelled and rescheduled. See [Reconnect](#reconnect). |
| `parse` throws                                | Fires                                                        | Does not fire                    | Does not fire `"message"`, and does not close the WebSocket                                                                                                                                                                                |
| `connect()` replaces an old connection        | Does not fire                                                | Fires, with reason `"reconnect"` | Close the old WebSocket first, then enter the new `connecting` state. See [Reconnect → `connect()` replacement rules](#connect-replacement-rules).                                                                                            |

## Reconnect

After an unintentional close, if auto-reconnect is enabled, a new connection is opened automatically. You do not need to remount `WsProvider`.

### Basic behavior

When `reconnectMs > 0`, an unintentional close schedules an auto-reconnect, applying backoff, a retry cap, and jitter from the options.

`reconnectMs: 0` disables auto-reconnect.

A manual `disconnect()` or unmounting `WsProvider` does not trigger auto-reconnect.

`reconnectMax: 3` means at most 3 auto-reconnects. That does not include the initial `connect()`, and does not include a later manual `connect()`.

`reconnectMax: 0` means there is no cap on auto-reconnects.

```text
connect()
   │
   ▼
connecting
   │
   ├── success ──→ open
   │
   └── failure (see connect() replacement rules / construct failure)

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

These options take effect only when `reconnectMs > 0`.

| Field                  |   Default | Description                                                                                                                           |
| ---------------------- | --------: | ------------------------------------------------------------------------------------------------------------------------------------- |
| `reconnectBackoff`     |       `2` | Multiplier for the next wait. `1` keeps a fixed interval.                                                                             |
| `reconnectMax`         |       `0` | Cap on auto-reconnects. `0` means no cap.                                                                                              |
| `reconnectDelayMaxMs`  |   `30000` | Cap for one wait, including jitter. `0` means no cap.                                                                                  |
| `reconnectJitter`      |     `0.2` | How much to randomly shorten the wait, in `[0, 1]`. `0` means no jitter.                                                               |
| `reconnectMinUptimeMs` |    `5000` | How long the WebSocket must stay open before the reconnect cycle resets. `0` resets as soon as the connection opens.                  |

### Reconnect wait

The base wait for the nth auto-reconnect is:

```text
reconnectMs * reconnectBackoff ** (n - 1)
```

Then apply `reconnectDelayMaxMs`.

If `reconnectDelayMaxMs` is `0`, there is no cap on the wait.

Then apply jitter:

```text
(1 - random * reconnectJitter)
```

For example:

```ts
reconnectMs: 1000;
```

With the defaults, the waits are about:

```text
1s → 2s → 4s → ...
```

Each wait is at most 30 seconds, and is shortened by a random 0% to 20%.

`0` means something different for each option:

| Setting                | Meaning of `0`                                  |
| ---------------------- | ----------------------------------------------- |
| `reconnectMs`          | Disables auto-reconnect                         |
| `reconnectMax`         | No cap on auto-reconnects                       |
| `reconnectDelayMaxMs`  | No cap on the wait                              |
| `reconnectMinUptimeMs` | Reset the cycle as soon as the connection opens |
| `reconnectJitter`      | No jitter                                       |

For a fixed interval, no jitter, and a reset as soon as each connection opens:

```tsx
createWsContext({
  url: "ws://localhost:8080",
  reconnectMs: 2000,
  reconnectBackoff: 1,
  reconnectJitter: 0,
  reconnectMinUptimeMs: 0,
});
```

### `connect()` replacement rules

Auto-reconnect and a manual `connect()` use the same socket replacement rule:

```text
existing socket
      │
      │ connect() / reconnect
      ▼
create new socket
      │
      ├── failure → keep the existing socket
      │
      └── success → replace the existing socket
```

The new WebSocket is created first.

Only after the new WebSocket is constructed successfully is the old one closed. That fires `"close"` on the old socket (reason `"reconnect"`).

Then `status` is set to `"connecting"`.

If `connect()` was run by an already-fired auto-reconnect timer, `phase` stays `"reconnecting"`.

A manual `connect()` sets `phase` to `"connecting"`. Even if an auto-reconnect wait is in progress, the flow switches to a manual connect.

If creating the WebSocket fails, for example:

- The URL getter throws
- The URL is empty
- `new WebSocket()` throws

an `"error"` event fires, and `connect()` itself does not throw.

The existing WebSocket stays as it is.

If that call came from an **already-fired auto-reconnect timer**, auto-reconnect stops and the store becomes:

```ts
{
  status: "closed",
  phase: "stopped",
}
```

If an auto-reconnect timer is still waiting, that timer is cancelled and the next reconnect is scheduled again.

An early `connect()` that fails does not end the current auto-reconnect cycle.

When `reconnectMax` is reached, `phase` becomes `stopped`.

You can still call `connect()` to try again manually.

For event payloads, and the order of store updates and the `"close"` event, see [Events → Ordering and failure behavior](#ordering-and-failure-behavior).

### Store fields

#### `reconnectAttempt`

`n` means the nth auto-reconnect is already scheduled or in progress.

It increments when an unintentional close decides to reconnect, not when that reconnect succeeds.

#### `nextReconnectAt`

The time the next auto-reconnect is due, as a `Date.now()` millisecond timestamp.

`0` when no reconnect is waiting.

Remaining wait:

```text
nextReconnectAt - Date.now()
```

#### `reconnectExhausted`

`true` when `reconnectMax` has been reached and the last auto-reconnect also failed.

A later `connect()` or `disconnect()` resets this field to `false`.

### Cycle reset

After the WebSocket stays open for `reconnectMinUptimeMs`, the reconnect cycle resets.

The default is `5000` ms.

With `reconnectMinUptimeMs: 0`, the cycle resets as soon as the WebSocket fires `open`.

If the server accepts the connection and then closes it immediately, keep `reconnectMinUptimeMs > 0`.

If the WebSocket closes soon after, the next reconnect starts again from the first wait, and `reconnectMax` starts counting again.

`disconnect()` resets the cycle immediately.

A manual `connect()` also resets the cycle immediately when no auto-reconnect timer is waiting.

If an auto-reconnect is waiting, the cycle resets only after that connection succeeds and stays open for `reconnectMinUptimeMs`.

## Liveness

`liveness` is an **application-layer heartbeat**, not a WebSocket protocol ping/pong.

It detects a WebSocket whose `readyState` is still open, but that no longer responds at the application layer.

When `liveness` is enabled, the Provider sends an application-layer ping on the given interval.

If no matching pong arrives within `timeoutMs`, it closes the WebSocket.

When `reconnectMs > 0`, that close is treated as an unintentional close and triggers auto-reconnect.

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

The application supplies `ping`. This package does not call `JSON.stringify` for you.

`isPong` checks the `parse` result. Only `true` counts as a pong.

A message still fires `"message"` when it is recognized as a pong.

If `ping` throws, that ping is not sent, but the pong wait still starts.

If no matching pong arrives before `timeoutMs`, the WebSocket is closed anyway.

If `ping` synchronously calls `disconnect()` or a successful `connect()`, the abandoned connection attempt does not fire `"open"`.

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

For the full `LivenessOptions` description, see [`createWsContext`](#createwscontext).

## API reference

### `createWsContext`

`createWsContext(options)` returns a `WsProvider` and three hooks bound to the same options.

Options stay fixed after creation.

To use different options, call `createWsContext` again and create another context.

#### Options

`CreateWsContextOptions`

| Field                  | Type                                      | Default                        | Description                                                                                                                                                          |
| ---------------------- | ----------------------------------------- | ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `url`                  | `MaybeGetter<string>`                     | required                       | WebSocket URL. A sync getter runs at the start of each `connect()`.                                                                                                  |
| `protocols`            | `MaybeGetter<string \| string[]>`         | none                           | Passed to `new WebSocket(url, protocols)`. When omitted, the second argument is not passed. An empty string from a getter is passed through.                         |
| `autoConnect`          | `boolean`                                 | `true`                         | Whether `WsProvider` connects on mount.                                                                                                                               |
| `reconnectMs`          | `number`                                  | `0`                            | First auto-reconnect wait in milliseconds after an unintentional close. `0` disables auto-reconnect. See [Reconnect](#reconnect).                                    |
| `reconnectMax`         | `number`                                  | `0`                            | Cap on auto-reconnects. `0` means no cap. Takes effect only when `reconnectMs > 0`.                                                                                   |
| `reconnectBackoff`     | `number`                                  | `2`                            | Multiplier for the next wait. `2` doubles it, `1` keeps a fixed interval, and values below `1` are clamped to `1`.                                                   |
| `reconnectDelayMaxMs`  | `number`                                  | `30000`                        | Cap in milliseconds for one wait, including jitter. `0` means no cap.                                                                                                |
| `reconnectJitter`      | `number`                                  | `0.2`                          | How much to randomly shorten the wait, in `[0, 1]`. By default the actual wait is shortened by a random 0% to 20%. `1` is full jitter, and `0` means no jitter.     |
| `reconnectMinUptimeMs` | `number`                                  | `5000`                         | How long the WebSocket must stay open, in milliseconds, before the reconnect cycle resets. `0` resets immediately after `open`.                                      |
| `parse`                | `(data: MessageEvent["data"]) => unknown` | see [Message parsing](#message-parsing) | Maps raw `MessageEvent.data` to application data. A throw fires `"error"`, does not fire `"message"`, and does not close the WebSocket.                       |
| `liveness`             | `LivenessOptions`                         | none                           | Application-layer heartbeat. Disabled when omitted.                                                                                                                   |

Getters for `url` and `protocols` must run synchronously. Do not `await` or call hooks inside them.

This package does not handle authentication. The application supplies the token.

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

For `connect()` construct failure, see [Reconnect → `connect()` replacement rules](#connect-replacement-rules).

#### `LivenessOptions`

| Field        | Type                                                             | Description                                                                                      |
| ------------ | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `intervalMs` | `number`                                                         | Ping interval in milliseconds.                                                                   |
| `timeoutMs`  | `number`                                                         | How long to wait for a pong, in milliseconds.                                                    |
| `ping`       | a value `WebSocket.send` accepts, or a function that returns one | The ping to send. A function is called before each send.                                         |
| `isPong`     | `(data: unknown) => boolean`                                     | Whether data after `parse` is a pong. A throw counts as not a pong, but `"message"` still fires. |

#### Returns

| Name           | Type                                 | Description                                |
| -------------- | ------------------------------------ | ------------------------------------------ |
| `WsProvider`   | `React.FC<{ children }>`             | Manages the WebSocket used by its subtree. |
| `useWsActions` | `() => WsContextValue`               | WebSocket operations.                      |
| `useWsStore`   | `() => WsState` or `(selector) => T` | Subscribe to WebSocket connection state.   |
| `useWsEvents`  | `(type, handler) => void`            | Subscribe to WebSocket events.             |

### `WsProvider`

`WsProvider` manages the native `WebSocket` used by its subtree.

| When                                      | What happens                                                                                                                                                                                                                            |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Mount and `autoConnect: true`             | Opens the WebSocket.                                                                                                                                                                                                                     |
| Unmount                                   | Cancels auto-reconnect, resets reconnect progress, and stops `liveness`. Sets the store to `status: "closed"`, `phase: "idle"`. If a WebSocket exists, closes it with close reason `"provider unmount"`.                               |
| `disconnect()`                            | Same cleanup and store reset as unmount. Does not trigger auto-reconnect. If a WebSocket exists, the close reason is `"client disconnect"`.                                                                                             |
| Unintentional close and `reconnectMs > 0` | Schedules auto-reconnect (backoff / cap / jitter). See [Reconnect](#reconnect).                                                                                                                                                          |
| `connect()` with or without a WebSocket   | Follows [Reconnect → `connect()` replacement rules](#connect-replacement-rules).                                                                                                                                                         |

### `useWsActions`

`useWsActions(): WsContextValue`

Calling it outside the matching `WsProvider` throws:

```text
"useWsActions 必須包在對應的 WsProvider 內"
```

Method references stay stable.

A component that only uses `useWsActions` does not re-render on store or message updates.

| Method       | Signature                    | Description                                                                                                                     |
| ------------ | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `send`       | `(data) => boolean`          | When the WebSocket is open, sends and returns `true`. When it is not open, returns `false`. See [Sending messages](#sending-messages). |
| `sendJson`   | `(data: unknown) => boolean` | Serializes with `JSON.stringify`, then calls `send`. See [Sending messages](#sending-messages).                                 |
| `connect`    | `() => void`                 | Reads the options, then opens the WebSocket. See [Reconnect → `connect()` replacement rules](#connect-replacement-rules).       |
| `disconnect` | `() => void`                 | Closes the WebSocket on purpose. The state becomes `phase: "idle"`, `status: "closed"`, and auto-reconnect does not run.        |
| `getStatus`  | `() => WsStatus`             | Reads the current `status` without a subscription.                                                                              |

### `useWsStore`

`useWsStore(): WsState`, or with a selector:

```ts
useWsStore(): WsState
useWsStore<T>(selector: (state: WsState) => T): T
```

Calling it outside the matching `WsProvider` throws:

```text
"useWsStore 必須包在對應的 WsProvider 內"
```

This hook uses React's `useSyncExternalStore`.

Without a selector, it subscribes to the whole `WsState`. Prefer a selector, and subscribe only to the fields the component actually needs.

The selector's return value is compared with the previous result using `Object.is`.

Return a primitive, or keep the same reference on every call.

A new object or array on every call makes React treat the value as different and re-render, and the component can get stuck updating forever.

This package does not shallow-compare selector results.

Incoming messages are not stored in this store.

#### `WsState`

| Field                | Type       | Description                                                                                                         |
| -------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------- |
| `status`             | `WsStatus` | The WebSocket's own connection state. See [Connection state](#connection-state).                                    |
| `phase`              | `WsPhase`  | The Provider's current connection phase. See [Connection state](#connection-state).                                 |
| `reconnectAttempt`   | `number`   | Auto-reconnects already scheduled in this cycle. See [Reconnect → Store fields](#store-fields).                     |
| `reconnectExhausted` | `boolean`  | Whether `reconnectMax` was reached and the last reconnect failed. See [Reconnect → Store fields](#store-fields).    |
| `nextReconnectAt`    | `number`   | When the next auto-reconnect is due (`Date.now()` milliseconds). `0` when no reconnect is waiting.                  |

Options such as `reconnectMax`, and the WebSocket URL, are not in `WsState`.

If the UI needs to show "attempt n of m", keep those options yourself when you create the context.

### `useWsEvents`

`useWsEvents(type, handler)`

Calling it outside the matching `WsProvider` throws:

```text
"useWsEvents 必須包在對應的 WsProvider 內"
```

For event types and subscription behavior, see [Events](#events).

## Next.js and runtime

- Requires React 18+ and `useSyncExternalStore`.
- No runtime npm dependencies.
- Needs `globalThis.WebSocket`.
- Without `WebSocket`, `connect()` does not open a connection.
- If that `connect()` was run by an already-fired auto-reconnect timer, the store becomes `status: "closed"`, `phase: "stopped"`.
- The package entry includes `"use client"`, for the Next.js App Router. A regular SPA ignores the directive.

## Exported types

The main `react-ws-context` entry exports these types:

| Type                     | Description                                        |
| ------------------------ | -------------------------------------------------- |
| `CreateWsContextOptions` | Options for `createWsContext`.                     |
| `MaybeGetter<T>`         | `T \| (() => T)`. A static value or a sync getter. |
| `LivenessOptions`        | Options for `liveness`.                            |
| `WsContextValue`         | Return type of `useWsActions()`.                   |
| `WsEvents`               | Map from event name to handler.                    |
| `WsStatus`               | WebSocket connection state.                        |
| `WsPhase`                | The Provider's connection phase.                   |
| `WsState`                | Subscribable connection state.                     |

## Demo

Next.js demo: [apps/web](https://github.com/GaiaYang/react-ws/tree/main/apps/web).

## License

[MIT License](./LICENSE).

Copyright (c) 2026 [GaiaYang](https://github.com/GaiaYang).

Source: [github.com/GaiaYang/react-ws](https://github.com/GaiaYang/react-ws)

The package lives in `packages/react-ws`.

## Sources and acknowledgments

This package does not list zustand or nanoevents as runtime npm dependencies. It inlines only the parts it actually uses.

Related files have attribution notes at the top.

- [zustand](https://github.com/pmndrs/zustand) (MIT, [pmndrs](https://github.com/pmndrs)): the external store follows [`vanilla.ts`](https://github.com/pmndrs/zustand/blob/main/src/vanilla.ts); the React subscription follows `useStore` in [`react.ts`](https://github.com/pmndrs/zustand/blob/main/src/react.ts). Related files: `src/core/store.ts`, `src/react/use-store.ts`.
- [nanoevents](https://github.com/ai/nanoevents) (MIT, [Andrey Sitnik](https://github.com/ai/nanoevents)): the event system follows [`createNanoEvents`](https://github.com/ai/nanoevents). Related files: `src/core/emitter.ts`, `src/react/ws-events.ts`.
