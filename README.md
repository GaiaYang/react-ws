# react-ws monorepo

[![npm version](https://img.shields.io/npm/v/react-ws-context.svg)](https://www.npmjs.com/package/react-ws-context)
[![npm downloads](https://img.shields.io/npm/dm/react-ws-context.svg)](https://www.npmjs.com/package/react-ws-context)

> [繁體中文](./README.zh-TW.md)

This repository publishes the React WebSocket connection layer `react-ws-context` from `packages/react-ws`. `apps/web` is a Next.js demo. `apps/mock-ws` is a local WebSocket server at `ws://localhost:8080`.

Maintainer is [GaiaYang](https://github.com/GaiaYang). Repository is [github.com/GaiaYang/react-ws](https://github.com/GaiaYang/react-ws).

## Repository layout

```
.
├── packages/react-ws   # react-ws-context (no runtime npm dependencies)
├── apps/web            # Next.js demo
└── apps/mock-ws        # mock WS at ws://localhost:8080
```

## Run the demo

Run every command from the repository root, the directory that contains `pnpm-workspace.yaml`.

1. Install workspace dependencies with `pnpm install`.
2. In one terminal, run `pnpm dev:mock`. The mock server listens at `ws://localhost:8080`.
3. In a second terminal, run `pnpm dev`. The demo is at http://localhost:3000.

The demo connects to `ws://localhost:8080`. Both terminals need to be running.

The demo imports `react-ws-context` through `workspace:*` from compiled `dist/`. `pnpm dev` runs `tsdown --watch` and Next.js in parallel, so saving a file in `packages/react-ws` rebuilds the package.

If you run only `pnpm --filter @react-ws/web dev` without the package watch, run `pnpm build:pkg` first.

Other commands from the root:

```bash
pnpm build:pkg        # Build packages/react-ws to dist/
pnpm typecheck        # Typecheck the whole workspace
pnpm test             # packages/react-ws smoke tests
```

### Add a dependency to a workspace package

```bash
pnpm --filter @react-ws/web add lodash-es
pnpm --filter react-ws-context add -D some-dev-tool
pnpm --filter @react-ws/mock-ws add ws
```

## Install the published package

```bash
pnpm add react-ws-context react
# or: npm install react-ws-context react
# or: yarn add react-ws-context react
```

API, options, and hook behavior are in [`packages/react-ws/README.en.md`](./packages/react-ws/README.en.md) (English), [the Traditional Chinese README](./packages/react-ws/README.zh-TW.md), and the [Changelog](./packages/react-ws/CHANGELOG.md).

```tsx
"use client";

import { createWsContext } from "react-ws-context";

export const { WsProvider, useWsActions, useWsStore, useWsEvents } =
	createWsContext({
		url: "ws://localhost:8080",
		reconnectMs: 2000,
	});
```

`url` and `protocols` may also be sync getters, resolved at the start of each `connect()`. Reconnect stays off while `reconnectMs` is `0`.

## License

[MIT License](./LICENSE). Copyright (c) 2026 [GaiaYang](https://github.com/GaiaYang). Third-party acknowledgments for zustand and nanoevents are in [`packages/react-ws/README.en.md#acknowledgments`](./packages/react-ws/README.en.md#acknowledgments).
