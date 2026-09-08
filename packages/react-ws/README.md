# react-ws-context

[![npm version](https://img.shields.io/npm/v/react-ws-context.svg)](https://www.npmjs.com/package/react-ws-context)
[![npm downloads](https://img.shields.io/npm/dm/react-ws-context.svg)](https://www.npmjs.com/package/react-ws-context)

> **繁體中文：** [README.zh-TW.md](./README.zh-TW.md)

A React **WebSocket connection-layer** package.
It separates connection lifecycle, subscribable state, and message events so connection status or high-frequency messages do not re-render your entire component tree.

> **Maintainer:** [GaiaYang](https://github.com/GaiaYang)  
> **Source:** [github.com/GaiaYang/react-ws](https://github.com/GaiaYang/react-ws) (package path: `packages/react-ws`)

## Features

- **Zero runtime dependencies** — only `react >= 18` as a peer dependency
- **Frozen strategy** — the `url` / `protocols` getter (or static value) and other options are fixed at `createWsContext`; each handshake resolves getters.
  Those options cannot be changed later; use `connect` / `disconnect` to control the connection
- **Render isolation** — connection state is subscribed via `useWsStore`; messages via `useWsEvents` (not written into React state)
- **Optional reconnect** — off by default; set `reconnectMs` to retry with exponential backoff and jitter
- **Optional liveness** — periodic ping / pong; closes the socket on timeout (may trigger reconnect if enabled)
- **Optional outbound queue** — buffers messages while not connected; sends the queue in order on connect

## Requirements

| Item        | Requirement                                      |
| ----------- | ------------------------------------------------ |
| React       | >= 18 (`useSyncExternalStore`)                   |
| Environment | A standard `WebSocket` (`globalThis.WebSocket`)  |

The connection layer does not use `window` or DOM `Event` / `CloseEvent` constructors.
Call `createWsContext` and its hooks where `WebSocket` is available.
Without `WebSocket` (for example SSR), `connect()` is a no-op.

The package entry is marked `"use client"` so it can be imported in Next.js App Router and similar setups.
A SPA ignores the directive.

## Install

```bash
pnpm add react-ws-context react
# or: npm install react-ws-context react
# or: yarn add react-ws-context react
```

## Quick start

**1. Create a connection context (usually once, in its own module)**

```tsx
"use client";

import { createWsContext } from "react-ws-context";

export const { WsProvider, useWsActions, useWsStore, useWsEvents } =
  createWsContext({
    url: "ws://localhost:8080",
    reconnectMs: 2000,
  });
```

`url` / `protocols` may be a static value or a **sync getter** (`MaybeGetter<T>`), resolved at the start of each `connect()`.
Do not `await` or call hooks inside it.
The app provides the source (e.g. `localStorage`); this package does not handle auth.
To replace the getter or switch back to a static string, call `createWsContext` again.

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

If the getter throws, the URL is empty, or `new WebSocket` throws, `connect()` emits `"error"` and leaves any existing connection as-is.
`connect()` itself does not throw.
If this happened after a reconnect timer had already fired, auto-retry stops (`phase: "stopped"`).
Fix the source and call `connect()` again.

**2. Use it in your app**

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

## Core concepts

```
createWsContext(options)
        │
        ├── WsProvider      WebSocket instance, reconnect, liveness, outbound queue
        ├── useWsActions()  send / connect / disconnect / getStatus — no re-renders
        ├── useWsStore()    connection state
        └── useWsEvents()   open / message / error / close
```

- **Call `createWsContext` multiple times** for independent connections (e.g. app WS + notification WS).
  Each call returns its own Provider and hooks.
- **Messages and errors** — use `useWsEvents`; keep message history in your own React state, cache, or state library.
- **Connection errors are not a `WsStatus`** — use `useWsEvents("error")`; native `error` is usually followed by `close`.

---

## API reference

### `createWsContext(options)`

Creates a `WsProvider` and hooks bound to the same connection config.

#### `CreateWsContextOptions`

| Field                  | Type                                      | Default    | Description                                                                                                                             |
| ---------------------- | ----------------------------------------- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `url`                  | `MaybeGetter<string>`                     | (required) | WebSocket URL; sync getter is called at the start of each `connect()`                                                                   |
| `protocols`            | `MaybeGetter<string \| string[]>`         | —          | Passed to `new WebSocket(url, protocols)`; omit the option to skip the second argument. An empty string from a getter is passed through |
| `autoConnect`          | `boolean`                                 | `true`     | Auto-connect when `WsProvider` loads                                                                                                    |
| `reconnectMs`          | `number`                                  | `0`        | Base reconnect delay (ms) after unintentional close, i.e. the first retry; `0` disables reconnect                                       |
| `reconnectMax`         | `number`                                  | `0`        | Max auto-reconnects after unintentional close; `0` unlimited (requires `reconnectMs > 0`)                                               |
| `reconnectBackoff`     | `number`                                  | `2`        | How much the wait grows each attempt. Default `2` doubles it (1s → 2s → 4s…); `1` does not grow the wait; below `1` is clamped to `1` |
| `reconnectDelayMaxMs`  | `number`                                  | `30000`    | Hard cap (ms) for a single delay, jitter included; `0` uncapped                                                                         |
| `reconnectJitter`      | `number`                                  | `0.2`      | How much to randomize each wait, in `[0, 1]`. Default `0.2` waits 80%–100% of the scheduled delay; `1` is full jitter; `0` disables jitter         |
| `reconnectMinUptimeMs` | `number`                                  | `5000`     | How long a connection must stay open (ms) before the reconnect cycle resets; `0` resets on `open`                                       |
| `outgoingQueueMax`     | `number`                                  | `0`        | Max outbound queue size while not connected; `0` disables the queue                                                                     |
| `parse`                | `(data: MessageEvent["data"]) => unknown` | see below  | Turn raw `MessageEvent.data` into app data                                                                                              |
| `liveness`             | `LivenessOptions`                         | —          | Liveness / heartbeat config; omit to disable                                                                                            |

**Default `parse`:**

- string → try `JSON.parse`, return raw string on failure
- otherwise → return as-is

**Backoff defaults:** backoff and jitter apply as soon as `reconnectMs > 0`.

```ts
// 1s, then double each attempt, capped at 30s (1s, 2s, 4s…), each delay
// shortened by a random 0% to 20%; a connection counts as stable after 5s
createWsContext({ url: "ws://localhost:8080", reconnectMs: 1000 });
```

`reconnectMinUptimeMs` is what makes backoff effective.
If the server accepts a connection and closes it right away (flapping), `0` resets the cycle on every `open`, so backoff and `reconnectMax` never move past the first step.

To use a fixed interval with no jitter, and reset the reconnect cycle on `open`:

```ts
createWsContext({
  url: "ws://localhost:8080",
  reconnectMs: 2000,
  reconnectBackoff: 1,
  reconnectJitter: 0,
  reconnectMinUptimeMs: 0,
});
```

#### Returns

| Name           | Type                                 | Description                                  |
| -------------- | ------------------------------------ | -------------------------------------------- |
| `WsProvider`   | `React.FC<{ children }>`             | Wraps the subtree that needs this connection |
| `useWsActions` | `() => WsContextValue`               | Connection actions                           |
| `useWsStore`   | `() => WsState` or `(selector) => T` | Subscribe to connection state                |
| `useWsEvents`  | `(type, handler) => void`            | Subscribe to WebSocket events                |

---

### `WsProvider`

Creates, owns, and tears down the native `WebSocket`.

| Behavior                                            | Description                                                                                                                                                                                                                                                                                                                                                                                       |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `WsProvider` loads + `autoConnect: true`            | Auto-connects                                                                                                                                                                                                                                                                                                                                                                                     |
| unmount                                             | Cancels reconnect and resets reconnect progress, stops liveness, clears outbound queue; syncs store to `status: "closed"`, `phase: "idle"`; closes the socket and fires `close` if one exists (reason: `"provider unmount"`)                                                                                                                                                |
| `disconnect()`                                      | Same cleanup and store reset as unmount, no auto-reconnect; fires `close` if a socket exists (reason: `"client disconnect"`)                                                                                                                                                                                                                                                                      |
| reconnect                                           | Runs after an unintentional close when `reconnectMs > 0`. Wait grows with backoff, a delay cap, and jitter (see options above); stops after `reconnectMax` if `> 0`. The cycle resets once a connection stays open for `reconnectMinUptimeMs`. While waiting, the due time is in `nextReconnectAt` |
| `connect()` with existing socket                    | Constructs the new socket first; on success, closes the previous one and fires `close` (reason: `"reconnect"`). If construction fails, the existing socket is left as-is                                                                                                                                                                                                                          |
| getter throws, empty URL, or `new WebSocket` throws | Emits `"error"`; does not open a socket or close an existing one; store is left as-is; `connect()` does not throw. If the reconnect timer had already fired: `status: "closed"`, `phase: "stopped"`, no further auto-retries                                                                                                                                                                                           |

---

### `useWsActions(): WsContextValue`

Must be used inside the matching `WsProvider`.
Returned actions keep a stable reference and **do not** re-render on store or message updates.

| Method       | Signature                    | Description                                                                                                                      |
| ------------ | ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `send`       | `(data) => boolean`          | Send raw data (`string`, `ArrayBuffer`, `Blob`, etc.). Sends immediately when connected; otherwise enqueues if configured        |
| `sendJson`   | `(data: unknown) => boolean` | `JSON.stringify` then `send`; same return semantics as `send`; `false` if not serializable                                       |
| `connect`    | `() => void`                 | Resolve `url` / `protocols` and construct the socket; on success, close any existing socket. Handshake failure: see `WsProvider` |
| `disconnect` | `() => void`                 | Intentional close; sets store to `phase: "idle"`, `status: "closed"`; no auto-reconnect; clears outbound queue                   |
| `getStatus`  | `() => WsStatus`             | Read current `status` (`WsStatus`); no subscription, no re-render                                                                |

**`send` / `sendJson` return value:**

- `true` — sent or enqueued
- `false` — not sent: queue full, queue disabled, or `sendJson` could not serialize

---

### `useWsStore()`

Must be used inside the matching `WsProvider`.
Subscribes via `useSyncExternalStore`; **re-renders are skipped when field values are unchanged**.

For high-frequency messages, use `useWsEvents("message", …)`.

**Tip:** use a selector to subscribe only to the fields you need (e.g. `(s) => s.phase`).
`useWsStore()` without a selector subscribes to the full state — any field change triggers a re-render.

```ts
useWsStore(): WsState
useWsStore<T>(selector: (state: WsState) => T): T
```

#### `WsState`

| Field                | Type       | Description                                                                                                                                                                                                                                                                                                                                 |
| -------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `status`             | `WsStatus` | Current WebSocket connection state. See `WsStatus` below.                                                                                                                                                                                                                                                                                   |
| `phase`              | `WsPhase`  | Provider connection phase. Separate from `status`; see `WsPhase` below.                                                                                                                                                                                                     |
| `reconnectAttempt`   | `number`   | How many auto-reconnects have been scheduled in the current cycle. A value of `n` means the nth reconnect is scheduled or in progress (increments when an unintentional close queues a retry, not when the retry succeeds). Resets after the connection has stayed open for `reconnectMinUptimeMs` (default 5s; `0` resets on `open`). `disconnect()` resets immediately. A manual `connect()` resets immediately unless a reconnect timer is already waiting; then it resets once that connection survives `reconnectMinUptimeMs`. |
| `reconnectExhausted` | `boolean`  | Auto-reconnect hit `reconnectMax` and the last attempt also failed. Cleared back to `false` by a later `connect()` / `disconnect()`.                                                                                                                                                                                                        |
| `nextReconnectAt`    | `number`   | When the next auto-reconnect is due (`Date.now()` milliseconds). `0` while not waiting. Use `nextReconnectAt - Date.now()` for a countdown — with backoff and jitter, this is the only way to know how long the current wait is.                                                                                                            |

Options like `reconnectMax` are fixed at `createWsContext` and are **not** in `WsState`.
The URL used for a handshake is not stored either.
To show UI like "attempt n of m", keep those config values alongside your component state.

#### `WsStatus`

| Value        | Meaning                                |
| ------------ | -------------------------------------- |
| `idle`       | Not connected yet (initial value only; does not return after a disconnect) |
| `connecting` | Connecting                             |
| `open`       | Connected                              |
| `closed`     | Disconnected                           |

Maps to the current WebSocket connection state (similar to readyState).
`disconnect()` sets `status: "closed"` and `phase: "idle"` — `status` does not return to `idle`.
Does **not** express provider intent such as “in an auto-reconnect cycle” or “user disconnected” — use `phase` for that.

#### `WsPhase`

| Value          | Meaning                                                                                                                                                                                    |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `idle`         | Not connected, no reconnect scheduled (initial or manual `disconnect()`)                                                                                                                   |
| `connecting`   | First connect or manual `connect()` in progress                                                                                                                                            |
| `open`         | Connected                                                                                                                                                                                  |
| `reconnecting` | Auto-reconnect cycle (waiting for timer or connecting)                                                                                                                                     |
| `stopped`      | Will not auto-reconnect. `reconnectExhausted` is `true` when the attempt cap was hit; `false` when reconnect is off, or the handshake failed after the reconnect timer fired |

`status` and `phase` often change together but mean different things.
For example, `phase === "reconnecting"` with `status === "closed"` means waiting for the reconnect timer; `status === "connecting"` means the timer fired and a connect attempt is in progress.

**Example:**

```tsx
const phase = useWsStore((s) => s.phase);
const status = useWsStore((s) => s.status);

// Manual connect: only when idle or stopped
const canConnect = phase === "idle" || phase === "stopped";
// Intentional disconnect: while connected or in a connect/reconnect attempt
const canDisconnect =
  phase === "open" || phase === "connecting" || phase === "reconnecting";
```

---

### `useWsEvents(type, handler)`

Must be used inside the matching `WsProvider`.
Subscribes on mount and unsubscribes on unmount.

| `type`      | Handler                                        | Description                  |
| ----------- | ---------------------------------------------- | ---------------------------- |
| `"message"` | `(data: unknown, event: MessageEvent) => void` | `data` is the parsed payload |
| `"open"`    | `(event: Event) => void`                       | Connection open              |
| `"error"`   | `(event: Event) => void`                       | Socket or handshake error    |
| `"close"`   | `(event: CloseEvent) => void`                  | Connection closed            |

**Details:**

- Updating the callback does **not** re-subscribe
- Changing `type` **does** re-subscribe
- On unintentional disconnect, the store is updated to `status: "closed"` and the appropriate `phase` before your `close` handler runs
- Intentional `disconnect()` or provider unmount follows the same order: store first, then `close` fires (when a socket exists)
- If the getter throws, the URL is empty, or `new WebSocket` throws, emits `"error"` (`{ type: "error" }`) without `close` and without replacing an existing socket
- When `connect()` replaces an existing socket (after a successful construct): `close` fires first (reason: `"reconnect"`), then `status` and `phase` become `"connecting"`
- For multiple events, call `useWsEvents` multiple times

---

### Liveness

Enable via `createWsContext({ liveness: { … } })`.
Once connected, sends periodic application-layer pings (written directly to the socket — not WebSocket control frames, and not through the outbound queue).
If no matching pong arrives within `timeoutMs`, closes the socket (which may trigger reconnect if enabled).

The `liveness` option:

| Field        | Type                         | Description                                          |
| ------------ | ---------------------------- | ---------------------------------------------------- |
| `intervalMs` | `number`                     | Ping interval (ms)                                   |
| `timeoutMs`  | `number`                     | Wait for pong (ms)                                   |
| `ping`       | `unknown \| (() => unknown)` | Ping payload; function for dynamic values            |
| `isPong`     | `(data: unknown) => boolean` | Whether parsed data is a pong                        |

**Example:**

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

Every incoming message is checked with `isPong`; a pong clears the timeout timer and still fires `"message"`.
Ping payloads are always sent via `JSON.stringify` (JSON only).

---

### Outbound queue

When `outgoingQueueMax > 0`:

| When                       | Behavior                                              |
| -------------------------- | ----------------------------------------------------- |
| `send` while not connected | Enqueue (first in, first out)                         |
| Queue full                 | Returns `false`; does **not** drop older messages     |
| On `open`                  | Sends the entire queue in order                       |
| `disconnect()`             | Clear queue; store reset matches `WsProvider`         |
| `WsProvider` unmount       | Clear queue; store reset matches `WsProvider`         |
| Waiting for auto-reconnect | **Keep** queue                                        |

---

### Exported types

From the main `react-ws-context` entry:

| Type                     | Description                                              |
| ------------------------ | -------------------------------------------------------- |
| `CreateWsContextOptions` | Options for `createWsContext`                            |
| `MaybeGetter<T>`         | `T \| (() => T)` — static value or sync getter           |
| `LivenessOptions`        | Options for `liveness` in `createWsContext`              |
| `WsContextValue`         | Return type of `useWsActions()`                          |
| `WsEvents`               | Event name → handler map                                 |
| `WsStatus`               | WebSocket connection state (`WsState`)                   |
| `WsPhase`                | Connection phase                                         |
| `WsState`                | Subscribable connection state                        |

---

## License

[MIT License](./LICENSE). Copyright (c) 2026 [GaiaYang](https://github.com/GaiaYang).

---

## Acknowledgments

This package does **not** list zustand or nanoevents as npm dependencies.
It inlines minimal subsets for zero runtime deps.
Source files include attribution headers.

### [zustand](https://github.com/pmndrs/zustand)

- **Maintainer:** [pmndrs](https://github.com/pmndrs) (Poimandres)
- **License:** [MIT](https://github.com/pmndrs/zustand/blob/main/LICENSE)
- **Adapted from:**
  - External store API — aligned with [`vanilla.ts`](https://github.com/pmndrs/zustand/blob/main/src/vanilla.ts) (subset only; no middleware, replace, or initializer factory); `setState` skips notification when field values are unchanged
  - React subscription — inspired by [`react.ts`](https://github.com/pmndrs/zustand/blob/main/src/react.ts) `useStore` (no `useDebugValue`); this package adds an optional selector overload for `useWsStore`
- **Files:** `src/ws-context/store.ts`, `src/ws-context/use-store.ts`

### [nanoevents](https://github.com/ai/nanoevents)

- **Author:** [Andrey Sitnik](https://github.com/ai) (`ai`)
- **License:** [MIT](https://github.com/ai/nanoevents/blob/main/LICENSE)
- **Adapted from:**
  - Typed event dispatch — runtime nearly aligned with [`createNanoEvents`](https://github.com/ai/nanoevents/blob/main/index.js); types are this package's subset
  - React subscription wrapper — added in this package
- **Files:** `src/ws-context/emitter.ts`, `src/ws-context/ws-events.ts`
