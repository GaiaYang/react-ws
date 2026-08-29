# react-ws monorepo

[![npm version](https://img.shields.io/npm/v/react-ws-context.svg)](https://www.npmjs.com/package/react-ws-context)
[![npm downloads](https://img.shields.io/npm/dm/react-ws-context.svg)](https://www.npmjs.com/package/react-ws-context)

> **繁體中文：** [README.zh-TW.md](./README.zh-TW.md)

React WebSocket **connection layer** monorepo. Publishable package: **`react-ws-context`** (`packages/react-ws`).

> **Maintainer:** [GaiaYang](https://github.com/GaiaYang) · **Repository:** [github.com/GaiaYang/react-ws](https://github.com/GaiaYang/react-ws)

## Layout

```
.
├── packages/react-ws   # Package core: react-ws-context (zero runtime deps)
├── apps/web            # Next.js demo
└── apps/mock-ws        # Local mock WS (ws://localhost:8080)
```

## Development

**Run all commands from the monorepo root** (where `pnpm-workspace.yaml` lives):

```bash
pnpm install          # Install workspace dependencies
pnpm dev:mock         # Terminal 1: mock server → ws://localhost:8080
pnpm dev              # Terminal 2: demo → http://localhost:3000
pnpm build:pkg        # Build packages/react-ws → dist/
pnpm typecheck        # Typecheck entire workspace
```

The demo connects to `ws://localhost:8080` — run `dev:mock` and `dev` in separate terminals. `react-ws-context` is consumed via `workspace:*` from compiled `dist/`; `pnpm dev` runs `tsdown --watch` and Next.js in parallel, so package source changes rebuild on save. If you start only the web app without watch, run `pnpm build:pkg` first.

### Add a dependency to a workspace package

```bash
pnpm --filter @react-ws/web add lodash-es
pnpm --filter react-ws-context add -D some-dev-tool
pnpm --filter @react-ws/mock-ws add ws
```

## Install from npm

```bash
pnpm add react-ws-context react
# or: npm install react-ws-context react
# or: yarn add react-ws-context react
```

## Package usage (summary)

Full API docs: **[`packages/react-ws/README.md`](./packages/react-ws/README.md)** (English) · **[繁中](./packages/react-ws/README.zh-TW.md)** · **[Changelog](./packages/react-ws/CHANGELOG.md)**

```tsx
"use client";

import { createWsContext } from "react-ws-context";

export const { WsProvider, useWsActions, useWsStore, useWsEvents } =
  createWsContext({
    url: "ws://localhost:8080",
    reconnectMs: 2000,
  });
```

## License

[MIT License](./LICENSE). Copyright (c) 2026 [GaiaYang](https://github.com/GaiaYang). Third-party acknowledgments (zustand, nanoevents): [`packages/react-ws/README.md#acknowledgments`](./packages/react-ws/README.md#acknowledgments).
