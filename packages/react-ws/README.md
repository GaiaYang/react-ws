# react-ws-context

[![npm version](https://img.shields.io/npm/v/react-ws-context.svg)](https://www.npmjs.com/package/react-ws-context)
[![npm downloads](https://img.shields.io/npm/dm/react-ws-context.svg)](https://www.npmjs.com/package/react-ws-context)

> **繁體中文：** [README.zh-TW.md](./README.zh-TW.md)

A React **WebSocket connection-layer** package. It separates connection lifecycle, subscribable state, and message events so connection status or high-frequency messages do not re-render your entire component tree.

> **Maintainer:** [GaiaYang](https://github.com/GaiaYang)  
> **Source:** [github.com/GaiaYang/react-ws](https://github.com/GaiaYang/react-ws) (package path: `packages/react-ws`)

## Features

- **Zero runtime dependencies** — only `react >= 18` as a peer dependency
- **Frozen strategy** — the `url` / `protocols` getter (or static value) and other options are fixed at `createWsContext`; each handshake resolves getters. Runtime API is still only `connect` / `disconnect`
- **Render isolation** — connection-layer state (health / reconnect) is subscribed via `useWsStore`; messages via `useWsEvents` (not written into React state)
- **Optional liveness** — periodic ping / pong; closes the socket on timeout (may trigger reconnect if enabled)
- **Optional outbound queue** — buffers messages while not connected; sends the queue in order on connect

## Requirements

| Item        | Version                                           |
| ----------- | ------------------------------------------------- |
| React       | >= 18 (`useSyncExternalStore`)                    |
| Environment | Browser Client Component (native `WebSocket` API) |

The package entry is marked `"use client"`. Modules that call `createWsContext` and components that use its hooks must live inside a Client boundary.

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

`url` / `protocols` may be a static value or a **sync getter** (`MaybeGetter<T>`). The function is fixed at `createWsContext` and is called synchronously at the start of each `connect()` (manual, `autoConnect`, and the reconnect timer share that path). Do not `await` and do not call hooks inside the getter. The caller owns the source (e.g. `localStorage`); this package does not handle auth — the app decides when to `connect()` / `disconnect()`.

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

If the getter throws, the resolved URL is `""`, or `new WebSocket` throws (invalid URL), `connect()` emits `"error"`, does not open a socket, and does not close an existing one. If a reconnect timer had already fired, the store goes to `status: "closed"`, `phase: "stopped"` (no further auto-retries). Fix the sync source and call `connect()` again. To replace the getter or switch back to a static string, call `createWsContext` again.

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
        ├── useWsStore()    connection-layer state: health / reconnect
        └── useWsEvents()   open / message / error / close
```

- **Call `createWsContext` multiple times** for independent connections (e.g. app WS + notification WS).
- **`WsState` holds low-frequency connection data only** — health (`status`, `phase`) and reconnect progress (`reconnectAttempt`, `reconnectExhausted`). **Not** message payloads or app data.
- **Messages and errors** — use `useWsEvents`; keep message history in your own state, cache, or store.
- **Connection errors are not a `WsStatus`** — use `useWsEvents("error")`; native `error` is usually followed by `close`.

---

## API reference

### `createWsContext(options)`

Creates a `WsProvider` and hooks bound to the same connection config.

#### `CreateWsContextOptions`

| Field              | Type                                      | Default    | Description                                                                                                                             |
| ------------------ | ----------------------------------------- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `url`              | `MaybeGetter<string>`                     | (required) | WebSocket URL; sync getter is called at the start of each `connect()`                                                                   |
| `protocols`        | `MaybeGetter<string \| string[]>`         | —          | Passed to `new WebSocket(url, protocols)`; omit the option to skip the second argument. An empty string from a getter is passed through |
| `autoConnect`      | `boolean`                                 | `true`     | Auto-connect when `WsProvider` loads                                                                                                    |
| `reconnectMs`      | `number`                                  | `0`        | Reconnect delay (ms) after unintentional close; `0` disables reconnect                                                                  |
| `reconnectMax`     | `number`                                  | `0`        | Max auto-reconnects after unintentional close; `0` unlimited (requires `reconnectMs > 0`)                                               |
| `outgoingQueueMax` | `number`                                  | `0`        | Max outbound queue size while not connected; `0` disables the queue                                                                     |
| `parse`            | `(data: MessageEvent["data"]) => unknown` | see below  | Transform raw `MessageEvent.data`                                                                                                       |
| `liveness`         | `LivenessOptions`                         | —          | Liveness / heartbeat config; omit to disable                                                                                            |

**Default `parse`:**

- string → try `JSON.parse`, return raw string on failure
- otherwise → return as-is

#### Returns

| Name           | Type                                 | Description                                  |
| -------------- | ------------------------------------ | -------------------------------------------- |
| `WsProvider`   | `React.FC<{ children }>`             | Wraps the subtree that needs this connection |
| `useWsActions` | `() => WsContextValue`               | Connection actions                           |
| `useWsStore`   | `() => WsState` or `(selector) => T` | Subscribe to connection-layer state          |
| `useWsEvents`  | `(type, handler) => void`            | Subscribe to WebSocket events                |

---

### `WsProvider`

Creates, owns, and tears down the native `WebSocket`.

| Behavior                                            | Description                                                                                                                                                                                                                                        |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `WsProvider` loads + `autoConnect: true`            | Auto-connects                                                                                                                                                                                                                                      |
| unmount                                             | Cancels reconnect (`reconnectAttempt` and `reconnectExhausted` reset), stops liveness, clears outbound queue; syncs store to `status: "closed"`, `phase: "idle"`; closes the socket and fires `close` if one exists (reason: `"provider unmount"`) |
| `disconnect()`                                      | Same cleanup and store reset as unmount, no auto-reconnect; fires `close` if a socket exists (reason: `"client disconnect"`)                                                                                                                       |
| reconnect                                           | Fixed interval when `reconnectMs > 0` and close was not intentional (no exponential backoff); stops after `reconnectMax` if `> 0`                                                                                                                  |
| `connect()` with existing socket                    | Constructs the new socket first; on success, closes the previous one and fires `close` (reason: `"reconnect"`). If construction fails, the existing socket is left as-is                                                                           |
| getter throws, empty URL, or `new WebSocket` throws | Emits `"error"`; does not open a socket or close an existing one; `connect()` does not throw. If the reconnect timer had already fired: `status: "closed"`, `phase: "stopped"`, no further auto-retries                                            |

---

### `useWsActions(): WsContextValue`

Must be used inside the matching `WsProvider`. Returned actions keep a stable reference and **do not** re-render on store or message updates.

| Method       | Signature                    | Description                                                                                                                      |
| ------------ | ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `send`       | `(data) => boolean`          | Send raw data (`string`, `ArrayBuffer`, `Blob`, etc.). Sends immediately when connected; otherwise enqueues if configured        |
| `sendJson`   | `(data: unknown) => boolean` | `JSON.stringify` then `send`; same return semantics as `send`; `false` if not serializable                                       |
| `connect`    | `() => void`                 | Resolve `url` / `protocols` and construct the socket; on success, close any existing socket. Handshake failure: see `WsProvider` |
| `disconnect` | `() => void`                 | Intentional close; sets store to `phase: "idle"`, `status: "closed"`; no auto-reconnect; clears outbound queue                   |
| `getStatus`  | `() => WsStatus`             | Read current status; no subscription, no re-render                                                                               |

**`send` / `sendJson` return value:**

- `true` — sent or enqueued
- `false` — not sent: queue full, queue disabled, or `sendJson` could not serialize

---

### `useWsStore()`

Must be used inside the matching `WsProvider`. Subscribes via `useSyncExternalStore`; **re-renders are skipped when field values are unchanged**.

`WsState` is for **connection health / reconnect** — low-frequency lifecycle data. For high-frequency messages, use `useWsEvents("message", …)`, not the store.

**Tip:** use a selector to subscribe only to the fields you need (e.g. `(s) => s.phase`). `useWsStore()` without a selector subscribes to the full state — any field change triggers a re-render.

```ts
useWsStore(): WsState
useWsStore<T>(selector: (state: WsState) => T): T
```

#### `WsState`

```ts
interface WsState {
  status: WsStatus;
  /** Provider connection intent and reconnect strategy; separate from `status` in meaning */
  phase: WsPhase;
  /**
   * Reconnects scheduled this cycle (+1 on unintentional close, not on success).
   * Displayed as `n` means the nth reconnect is scheduled or in progress.
   * Reset on successful `open` and intentional `disconnect()`.
   * Manual `connect()` resets immediately when not waiting on a reconnect timer;
   * if a timer is pending, wait for successful `open`.
   */
  reconnectAttempt: number;
  /** `true` when `reconnectMax` is hit and the final attempt failed; cleared by `connect()` / `disconnect()` */
  reconnectExhausted: boolean;
}
```

| Belongs in store                                            | Does not belong                              |
| ----------------------------------------------------------- | -------------------------------------------- |
| `status`, `phase`, `reconnectAttempt`, `reconnectExhausted` | `lastMessage`, message history, app payloads |

Options like `reconnectMax` are fixed at `createWsContext` and are **not** in `WsState`. Resolved URL strings are not stored either. To show UI like "attempt n of m", keep those config values alongside your component state.

#### `WsStatus`

| Value        | Meaning       |
| ------------ | ------------- |
| `idle`       | Not connected |
| `connecting` | Connecting    |
| `open`       | Connected     |
| `closed`     | Disconnected  |

Maps to the current WebSocket connection state (similar to readyState). Does **not** express provider intent such as “in an auto-reconnect cycle” or “user disconnected” — use `phase` for that.

#### `WsPhase`

| Value          | Meaning                                                                                                                                                                                    |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `idle`         | Not connected, no reconnect scheduled (initial or manual `disconnect()`)                                                                                                                   |
| `connecting`   | First connect or manual `connect()` in progress                                                                                                                                            |
| `open`         | Connected                                                                                                                                                                                  |
| `reconnecting` | Auto-reconnect cycle (waiting for timer or connecting)                                                                                                                                     |
| `stopped`      | Will not auto-reconnect. `reconnectExhausted === true`: `reconnectMax` was hit. `false`: reconnect disabled (`reconnectMs === 0`), or the handshake failed after the reconnect timer fired |

`status` and `phase` often change together but mean different things. For example, `phase === "reconnecting"` with `status === "closed"` means waiting for the reconnect timer; `status === "connecting"` means the timer fired and a connect attempt is in progress.

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

Must be used inside the matching `WsProvider`. Subscribes on mount and unsubscribes on unmount.

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
- If the getter throws, the URL is empty, or `new WebSocket` throws, emits `"error"` (synthetic `Event`) without `close` and without replacing an existing socket
- When `connect()` replaces an existing socket (after a successful construct), `close` fires on the previous socket (reason: `"reconnect"`), then the store moves to `connecting`
- For multiple events, call `useWsEvents` multiple times

---

### Liveness

Enable via `createWsContext({ liveness: { … } })`. Once connected, sends periodic application-layer pings (JSON written directly to the socket — not WebSocket control frames, and not through the outbound queue); if no matching pong arrives within `timeoutMs`, closes the socket (which may trigger reconnect if enabled).

Shape of the `liveness` option:

```ts
interface LivenessOptions {
  intervalMs: number; // ping interval (ms)
  timeoutMs: number; // wait for pong (ms)
  ping: unknown | (() => unknown); // ping payload; function for dynamic values
  isPong: (data: unknown) => boolean; // whether parsed data is a pong
}
```

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

Every incoming message is checked with `isPong`; a pong clears the timeout timer and still fires `"message"`. Ping payloads are always sent via `JSON.stringify` (JSON only).

---

### Outbound queue

When `outgoingQueueMax > 0`:

| When                       | Behavior                                                       |
| -------------------------- | -------------------------------------------------------------- |
| `send` while not connected | Enqueue (first in, first out)                                  |
| Queue full                 | Returns `false`; does **not** drop older messages              |
| Socket connected           | Sends the entire queue in order                                |
| `disconnect()`             | Clear queue; store set to `idle` / `closed` (see `WsProvider`) |
| `WsProvider` unmount       | Clear queue; store synced (see `WsProvider`)                   |
| Waiting for auto-reconnect | **Keep** queue                                                 |

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
| `WsPhase`                | Provider connection intent / reconnect phase (`WsState`) |
| `WsState`                | Subscribable store shape (health / reconnect)            |

---

## Design trade-offs

| Topic           | Notes                                                                                                                                                                  |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Frozen strategy | Getter functions / static values are fixed at create time; getters re-resolve on each handshake. To change how URL / protocols are built, call `createWsContext` again |
| Reconnect       | Fixed interval only; no exponential backoff; optional cap via `reconnectMax`                                                                                           |
| SSR             | No `WebSocket` on the server; `connect()` is a no-op without `window`                                                                                                  |
| Error status    | No `"error"` in `WsStatus`; use `useWsEvents("error")`                                                                                                                 |
| `WsState` scope | Health / reconnect only — not messages or app data                                                                                                                     |
| Rendering       | Components that only call `useWsActions` do not re-render on store or messages                                                                                         |
| Store updates   | Unchanged field values skip re-renders; prefer selectors for the fields you need                                                                                       |

---

## License

[MIT License](./LICENSE). Copyright (c) 2026 [GaiaYang](https://github.com/GaiaYang).

---

## Acknowledgments

This package does **not** list zustand or nanoevents as npm dependencies. It inlines minimal subsets for zero runtime deps. Source files include attribution headers.

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
- **Adapted from:** [`createNanoEvents`](https://github.com/ai/nanoevents/blob/main/index.js); React hook wrapper added in this package
- **Files:** `src/ws-context/emitter.ts`, `src/ws-context/ws-events.ts`
