# Changelog

All notable changes to this package are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.7.0] - 2026-09-12

### Breaking

- Removed `outgoingQueueMax` and the outgoing queue. Buffering while disconnected is a delivery concern, not connection lifecycle. Apps should send again after `open`, so this package can focus on open / close / reconnect / liveness.
- `liveness.ping` is no longer auto-`JSON.stringify`ed. Ping content is application protocol; callers must supply data ready for `WebSocket.send` (for example `JSON.stringify` themselves) so the connection layer does not shape the payload.

### Removed

- `outgoingQueueMax`
- Outgoing queue (`outgoing-queue.ts`)

## [0.6.4] - 2026-09-11

### Fixed

- Liveness: a pong timeout already in progress is not reset by later pings; after timeout, pinging stops even if `close()` never calls `stop()`
- Outgoing queue: on `send` throw during `flush`, unsent items are restored in order; if the socket is still current and `OPEN`, only that item is dropped, `"error"` is emitted, and the rest continue
- Event handler throws no longer interrupt the connection layer: `flush` still finishes and liveness still starts; replacing an old socket still switches to the new one
- When replacing a socket, `disconnect()` / `connect()` inside a `"close"` handler wins for that handler turn and is not overwritten by the same `connect()` round
- Stale `onclose` (handlers already cleared, or the socket is no longer current) no longer stops liveness, schedules reconnect, emits, or writes the store
- When a reconnect timer has fired but `globalThis.WebSocket` is missing, the store becomes `closed` / `stopped` instead of staying in `reconnecting`
- Non-finite `reconnectBackoff` / `reconnectJitter` / `reconnectDelayMaxMs` fall back to `reconnectDelay` defaults; non-finite `reconnectMs` is treated as reconnect off, so `setTimeout` does not fire immediately
- Non-finite `reconnectMinUptimeMs` does not reset the backoff cycle immediately
- `disconnect()` clears the reconnect-timer-fired flag so a later manual `connect()` is `connecting`
- Handshake failure writes `stopped` before emitting `"error"`, so a throwing handler cannot leave auto-retry stuck
- `sendJson` returns `false` when `JSON.stringify` does not produce a string (e.g. `undefined`, function, symbol)
- Non-finite `outgoingQueueMax` is treated as queue off
- A throwing `parse` emits `"error"`, skips `"message"`, and does not close the socket; a throwing `isPong` is treated as not a pong, and `"message"` still fires
- A throwing liveness ping still arms the timeout and does not block `"open"`; non-finite `intervalMs` / `timeoutMs` do not ping or close in a tight loop; values above the platform delay limit are clamped

## [0.6.3] - 2026-09-11

### Changed

- Reconnect writes `reconnectAttempt` / `reconnectExhausted` / `nextReconnectAt` in one store patch and keeps the cycle count internally, so it no longer reads back from the store
- Liveness `start(socket)` binds ping and timeout to that socket (same public `liveness` options)
- `WsStatus` / `WsPhase` / `WsState` JSDoc: shorter field contracts for IDE consumers; behavior unchanged
- Tests renamed from `*.smoke.test.ts` to `*.test.ts`

## [0.6.2] - 2026-09-09

### Changed

- README: npm package `README.md` is now a short entry page; full English docs live in `README.en.md`, Traditional Chinese in `README.zh-TW.md`
- README (EN / zh-TW): restructure as a user-facing library README (positioning, why the split, quick start, how it works, layered configuration, API reference, then reconnect / liveness / outgoing queue)
- README (EN / zh-TW): clarify hook usage paths, `status` / `phase`, and handshake failure after a fired reconnect timer against the connection layer
- Public API JSDoc: tighten wording while keeping design constraints and field titles for IDE consumers

## [0.6.1] - 2026-09-07

### Changed

- `connect()` is a no-op when `globalThis.WebSocket` is missing, instead of checking `window`
- Handshake `error` and client `close` are plain objects with the MDN fields (`type` / `code` / `reason` / `wasClean`), not `new Event` / `new CloseEvent`. Handler types remain `Event` / `CloseEvent`
- README (EN / zh-TW): requirements and SSR describe the `WebSocket` global, not `window`

### Added

- Smoke tests: `connect()` without `WebSocket` is a no-op; synthetic close / error still work without DOM event constructors

## [0.6.0] - 2026-09-06

### Added

- `reconnectBackoff` — exponential backoff factor; attempt `n` waits `reconnectMs * reconnectBackoff ** (n - 1)`. Values below `1` are clamped to `1`
- `reconnectDelayMaxMs` — hard cap for a single reconnect delay (jitter included); `0` uncapped, still clamped to the `setTimeout` limit
- `reconnectJitter` — random jitter ratio in `[0, 1]`; the delay is shortened to `[backoff * (1 - ratio), backoff]`, so the cap stays hard and delays keep spreading once the backoff sits at the cap (`1` is full jitter)
- `reconnectMinUptimeMs` — a connection must stay open this long before `reconnectAttempt` / `reconnectExhausted` reset, so a server that accepts and immediately closes (flapping) can no longer pin backoff and `reconnectMax` to the first step
- `WsState.nextReconnectAt` — when the scheduled reconnect is due (`Date.now()` ms, `0` while not waiting), so a countdown UI can still tell how long the wait is now that backoff and jitter make it unpredictable
- Reconnect smoke tests: backoff schedule, hard cap under jitter, factor clamping, both flapping / stable-connection reset paths, and `nextReconnectAt` lifetime

### Changed

- Reconnect option JSDoc and README (EN / zh-TW) describe the reconnect behavior in user terms (what the wait looks like, when to change each knob) instead of restating the formula
- `reconnectDelay` documents why the order is backoff → cap → downward jitter: the cap stays hard and delays keep spreading once the backoff sits at the cap
- `reconnectAttempt` docs no longer say a pending-timer `connect()` resets on `open`; it resets once that connection survives `reconnectMinUptimeMs`

### Breaking

- Reconnect defaults now include backoff and jitter: `reconnectBackoff: 2`, `reconnectDelayMaxMs: 30000`, `reconnectJitter: 0.2`, `reconnectMinUptimeMs: 5000`. Reconnect itself is still opt-in via `reconnectMs`. For the previous fixed-interval behavior, pass `reconnectBackoff: 1`, `reconnectJitter: 0`, `reconnectMinUptimeMs: 0`
- `reconnectAttempt` / `reconnectExhausted` now reset only after the connection has stayed open for `reconnectMinUptimeMs` (default 5000), not immediately on `open`. Pass `0` to restore the previous reset-on-open behavior

## [0.5.0] - 2026-09-01

### Added

- `url` / `protocols` accept `MaybeGetter<T>` (`T | (() => T)`); resolved synchronously at the start of `connect()` (manual, `autoConnect`, and reconnect timer share that path)
- Handshake getter throw, empty URL, or synchronous `new WebSocket` throw emits `error` and does not open or replace a socket; if the reconnect timer had already fired, `phase` becomes `stopped` (no further auto-retries)

### Breaking

- Removed `react-ws-context/stall` subpath; stall protocol is now owned by the app / mock

## [0.4.2] - 2026-08-30

### Fixed

- Liveness ping and timeout bind to the socket from `start()`, so a stale timer cannot close a newer reconnect socket

### Changed

- `bindOnReconnect` runs in the mount `useEffect` (no render-phase write)
- `WsState` JSDoc: fields are primitives only; drop stale outbound-queue mention

### Added

- Liveness smoke test: timeout does not close a newer socket

## [0.4.1] - 2026-08-30

### Added

- Export `LivenessOptions` from the package entry

### Changed

- README (EN / zh-TW): align structure and wording; fix immutable-config URL guidance; clarify render isolation, stall parsing, and `WsProvider` lifecycle
- JSDoc (`CreateWsContextOptions`, `WsContextValue`): clearer field descriptions; fix `autoConnect` wording

## [0.4.0] - 2026-08-29

### Fixed

- Store `setState` skips listener notification when partial values are unchanged (shallow compare on updated keys)
- Provider unmount syncs store to `status: "closed"` and `phase: "idle"` (consistent with `disconnect()`)
- Liveness ping and timeout both use `getActiveSocket()` for the active socket
- `sendJson` returns `false` when `JSON.stringify` fails (e.g. circular reference) instead of throwing
- `useWsEvents` handler ref sync moved into `useEffect` (complies with `react-hooks/refs`)

### Changed

- Shared `teardown()` for `disconnect()` and provider unmount cleanup
- On unintentional close, store updates before `close` is emitted so handlers see consistent `status` / `phase`
- Batch `status` and `phase` store updates where both change together
- `Liveness.start()` takes no socket argument; uses `getActiveSocket()` at runtime
- Internal layout: `useWsEventsApi` in `ws-events.ts` (`emitter.ts` is React-free); aligned Context module structure (`ws-store`, `ws-events`, `ws-actions`)

### Added

- Store smoke test for `setState` deduplication

## [0.3.0] - 2026-08-29

### Added

- `WsPhase` type — provider connection intent and reconnect strategy: `idle` | `connecting` | `open` | `reconnecting` | `stopped`
- `WsState.phase` — subscribable provider lifecycle phase, orthogonal to `status` (WebSocket readyState mapping); use with `reconnectAttempt` / `reconnectExhausted` for reconnect UI
- Exported `WsPhase` from the package entry

## [0.2.0] - 2026-08-28

### Added

- `reconnectMax` option — limit auto-reconnect attempts after unintentional close (excludes initial `autoConnect` / manual connect); `0` means unlimited
- `WsState.reconnectAttempt` — subscribable count of reconnects scheduled this cycle (incremented when a reconnect is queued, not on success)
- `WsState.reconnectExhausted` — `true` when `reconnectMax` is hit and the final attempt also failed
- Reconnect module (`createReconnect` / `useReconnect`) extracted from `WsProvider`, with dedicated smoke tests

### Changed

- Reconnect scheduling refactored into `src/ws-context/reconnect.ts`
- `disconnect()` and provider unmount reset `reconnectAttempt` and `reconnectExhausted`

## [0.1.1] - 2026-08-28

### Fixed

- Remove `exports.development` so npm consumers no longer resolve missing `src/` in dev mode

## [0.1.0] - 2026-08-28

### Added

- `createWsContext(options)` factory — returns `WsProvider`, `useWsActions`, `useWsStore`, and `useWsEvents` per connection
- **Render isolation:** actions (no re-renders), connection-layer store (`useSyncExternalStore`), and message events kept separate
- Connection lifecycle: `connect`, `disconnect`, `autoConnect`, fixed-interval reconnect (`reconnectMs`)
- Outbound message queue while socket is not `OPEN` (`outgoingQueueMax`)
- Optional liveness / heartbeat (`LivenessOptions`: ping interval, timeout, custom `isPong`)
- Configurable `parse` for incoming messages (default: `JSON.parse` for strings)
- `WsStatus`: `idle` | `connecting` | `open` | `closed`
- `react-ws-context/stall` subpath — optional stall-control message helpers for demos and mock servers
- Zero runtime dependencies (`react >= 18` peer only)
- Smoke tests for context, liveness, and stall helpers
