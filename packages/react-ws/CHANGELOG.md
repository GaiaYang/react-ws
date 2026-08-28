# Changelog

All notable changes to this package are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
