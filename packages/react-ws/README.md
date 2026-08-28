# react-ws-context

> **繁體中文：** [README.zh-TW.md](./README.zh-TW.md)

A React **WebSocket connection layer**. It separates connection lifecycle, subscribable state, and message events so status updates or high-frequency messages do not re-render your entire component tree.

> **Maintainer:** [GaiaYang](https://github.com/GaiaYang)  
> **Source:** [github.com/GaiaYang/react-ws](https://github.com/GaiaYang/react-ws) (package path: `packages/react-ws`)

## Features

- **Zero runtime dependencies** — only `react >= 18` as a peer dependency
- **Frozen config** — `url`, `reconnectMs`, etc. are fixed at `createWsContext`; use `connect` / `disconnect` at runtime
- **Render isolation** — connection-layer state (health / queue / reconnect) lives in an external store; messages go through an event emitter, not React Context
- **Optional liveness** — periodic ping / pong; closes the socket on timeout to trigger reconnect
- **Optional outbound queue** — buffers messages while not OPEN, flushes on connect

## Requirements

| Item        | Version                                           |
| ----------- | ------------------------------------------------- |
| React       | >= 18 (`useSyncExternalStore`)                    |
| Environment | Browser Client Component (native `WebSocket` API) |

The package entry is marked `"use client"`. Modules that call `createWsContext` and components that use its hooks must live inside a Client boundary.

## Install

```bash
pnpm add react-ws-context react
# npm install react-ws-context react
# yarn add react-ws-context react
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
        ├── useWsActions()  send / connect / disconnect — no re-renders
        ├── useWsStore()    connection-layer state: health / queue / reconnect
        └── useWsEvents()   open / message / error / close
```

- **Call `createWsContext` multiple times** for independent connections (e.g. app WS + notification WS).
- **`WsState` holds low-frequency connection data only** — health (`status`), outbound queue (e.g. future `pendingCount`), reconnect (e.g. future `reconnectAttempt`). **Not** message payloads or app data.
- **Messages and errors** — use `useWsEvents`; keep message history in your own state, cache, or store.
- **Connection errors are not a `WsStatus`** — use `useWsEvents("error")`; native `error` is usually followed by `close`.

---

## API reference

### `createWsContext(options)`

Creates a `WsProvider` and hooks bound to the same connection config.

#### `CreateWsContextOptions`

| Field              | Type                                      | Default    | Description                                                            |
| ------------------ | ----------------------------------------- | ---------- | ---------------------------------------------------------------------- |
| `url`              | `string`                                  | (required) | WebSocket URL                                                          |
| `protocols`        | `string \| string[]`                      | —          | Passed to `new WebSocket(url, protocols)`                              |
| `autoConnect`      | `boolean`                                 | `true`     | Call `connect()` after `WsProvider` mounts                             |
| `reconnectMs`      | `number`                                  | `0`        | Reconnect delay (ms) after unintentional close; `0` disables reconnect |
| `outgoingQueueMax` | `number`                                  | `0`        | Max outbound queue size while not OPEN; `0` disables the queue         |
| `parse`            | `(data: MessageEvent["data"]) => unknown` | see below  | Transform raw `MessageEvent.data`                                      |
| `liveness`         | `LivenessOptions`                         | —          | Liveness / heartbeat config; omit to disable                           |

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

| Behavior                    | Description                                                                                  |
| --------------------------- | -------------------------------------------------------------------------------------------- |
| mount + `autoConnect: true` | Calls `connect()`                                                                            |
| unmount                     | Closes connection, stops liveness, clears outbound queue, emits `close`                      |
| reconnect                   | Fixed interval when `reconnectMs > 0` and close was not intentional (no exponential backoff) |
| before reconnect            | Closes existing socket and emits `close` (reason: `"reconnect"`)                             |

---

### `useWsActions(): WsContextValue`

Must be used inside the matching `WsProvider`. Return value is memoized and **does not** re-render on store or message updates.

| Method       | Signature                    | Description                                                                  |
| ------------ | ---------------------------- | ---------------------------------------------------------------------------- |
| `send`       | `(data) => boolean`          | Send raw data. Sends immediately when OPEN; otherwise enqueues if configured |
| `sendJson`   | `(data: unknown) => boolean` | `JSON.stringify` then `send`                                                 |
| `connect`    | `() => void`                 | Open connection; closes any existing socket first                            |
| `disconnect` | `() => void`                 | Intentional close; no auto-reconnect; clears outbound queue                  |
| `getStatus`  | `() => WsStatus`             | Read current status; no subscription, no re-render                           |

**`send` / `sendJson` return value:**

- `true` — sent or enqueued
- `false` — not OPEN and queue full (`outgoingQueueMax > 0`), or queue disabled (`outgoingQueueMax === 0`)

---

### `useWsStore()`

Must be used inside the matching `WsProvider`. Uses `useSyncExternalStore` under the hood.

`WsState` is for **connection health / outbound queue / reconnect** — low-frequency lifecycle data. For high-frequency messages, use `useWsEvents("message", …)`, not the store.

```ts
useWsStore(): WsState
useWsStore<T>(selector: (state: WsState) => T): T
```

#### `WsState`

```ts
interface WsState {
  status: WsStatus;
  // Possible future fields (all low-frequency, connection-layer):
  // reconnectAttempt?: number;
  // pendingCount?: number;
}
```

| Belongs in store                                                          | Does not belong                              |
| ------------------------------------------------------------------------- | -------------------------------------------- |
| `status`, reconnect count, pending queue size, liveness / stall summaries | `lastMessage`, message history, app payloads |

#### `WsStatus`

| Value        | Meaning       |
| ------------ | ------------- |
| `idle`       | Not connected |
| `connecting` | Connecting    |
| `open`       | Connected     |
| `closed`     | Disconnected  |

**Tip:** use a selector to subscribe to only the fields you need.

```tsx
const status = useWsStore((s) => s.status);
```

---

### `useWsEvents(type, handler)`

Must be used inside the matching `WsProvider`. Registers in `useEffect` and unsubscribes on unmount.

| `type`      | Handler                                        | Description                  |
| ----------- | ---------------------------------------------- | ---------------------------- |
| `"message"` | `(data: unknown, event: MessageEvent) => void` | `data` is the parsed payload |
| `"open"`    | `(event: Event) => void`                       | Connection open              |
| `"error"`   | `(event: Event) => void`                       | Connection error             |
| `"close"`   | `(event: CloseEvent) => void`                  | Connection closed            |

**Details:**

- Handler is kept in a ref — changing the callback does **not** re-subscribe
- Changing `type` **does** re-subscribe
- For multiple events, call `useWsEvents` multiple times

---

### Liveness: `LivenessOptions`

Enable via `createWsContext({ liveness: { … } })`. After OPEN, sends periodic pings; if no matching pong within `timeoutMs`, closes the socket (which can trigger reconnect).

```ts
interface LivenessOptions {
  intervalMs: number;
  timeoutMs: number;
  ping: unknown | (() => unknown);
  isPong: (data: unknown) => boolean;
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

Every incoming message is checked with `isPong`; a pong resets the timeout timer and still emits `"message"`.

---

### Outbound queue

When `outgoingQueueMax > 0`:

| When                       | Behavior                                          |
| -------------------------- | ------------------------------------------------- |
| `send` while not OPEN      | Enqueue (FIFO)                                    |
| Queue full                 | Returns `false`; does **not** drop older messages |
| Socket OPEN                | Flush entire queue in order                       |
| `disconnect()`             | Clear queue                                       |
| `WsProvider` unmount       | Clear queue                                       |
| Waiting for auto-reconnect | **Keep** queue                                    |

---

### Exported types

From the main `react-ws-context` entry:

| Type                     | Description                                           |
| ------------------------ | ----------------------------------------------------- |
| `CreateWsContextOptions` | Options for `createWsContext`                         |
| `WsContextValue`         | Return type of `useWsActions()`                       |
| `WsEvents`               | Event name → handler map                              |
| `WsStatus`               | Connection lifecycle status                           |
| `WsState`                | Subscribable store shape (health / queue / reconnect) |

---

## Submodule: `react-ws-context/stall`

Optional stall-control message helpers for demos or mock-server integration. **Not** wired into `createWsContext` — parse in your own handlers.

```ts
import {
  STALL_MESSAGE_TYPE,
  STALL_ACK_TYPE,
  createStallMessage,
  parseStallMessage,
  type StallAction,
  type StallMessage,
  type StallAck,
} from "react-ws-context/stall";
```

| Export                       | Description                                                   |
| ---------------------------- | ------------------------------------------------------------- |
| `STALL_MESSAGE_TYPE`         | Client control message type (`"STALL"`)                       |
| `STALL_ACK_TYPE`             | Server ack type (`"STALL_ACK"`)                               |
| `createStallMessage(action)` | Build a message for `sendJson`                                |
| `parseStallMessage(data)`    | Parse from `useWsEvents("message")` data; `null` if invalid   |
| `StallAction`                | `"stall" \| "release"`                                        |
| `StallMessage`               | `{ type: "STALL"; action: StallAction }`                      |
| `StallAck`                   | `{ type: "STALL_ACK"; action: StallAction; active: boolean }` |

---

## Design trade-offs

| Topic            | Notes                                                                          |
| ---------------- | ------------------------------------------------------------------------------ |
| Immutable config | `url`, `reconnectMs`, etc. are fixed at create time                            |
| Reconnect        | Fixed interval only; no exponential backoff or max retries yet                 |
| SSR              | No `WebSocket` on the server; `connect()` is a no-op without `window`          |
| Error status     | No `"error"` in `WsStatus`; use `useWsEvents("error")`                         |
| `WsState` scope  | Health / queue / reconnect only — not messages or app data                     |
| Rendering        | Components that only call `useWsActions` do not re-render on store or messages |

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
  - External store API — aligned with [`vanilla.ts`](https://github.com/pmndrs/zustand/blob/main/src/vanilla.ts) (subset only)
  - React subscription — inspired by [`react.ts`](https://github.com/pmndrs/zustand/blob/main/src/react.ts) `useStore`
- **Files:** `src/ws-context/store.ts`, `src/ws-context/use-store.ts`

### [nanoevents](https://github.com/ai/nanoevents)

- **Author:** [Andrey Sitnik](https://github.com/ai) (`ai`)
- **License:** [MIT](https://github.com/ai/nanoevents/blob/main/LICENSE)
- **Adapted from:** [`createNanoEvents`](https://github.com/ai/nanoevents/blob/main/index.js); `useEmitter` added by this package
- **File:** `src/ws-context/emitter.ts`
