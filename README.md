# react-ws monorepo

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
pnpm dev:mock         # Mock server → ws://localhost:8080
pnpm dev              # Demo → http://localhost:3000
pnpm build:pkg        # Build packages/react-ws → dist/
pnpm typecheck        # Typecheck entire workspace
```

The demo depends on `react-ws-context` via `workspace:*`. `pnpm dev` runs `tsdown --watch` alongside the demo (Next `transpilePackages`); `pnpm publish` ships `dist/`.

### Add a dependency to a workspace package

```bash
pnpm --filter @react-ws/web add lodash-es
pnpm --filter react-ws-context add -D some-dev-tool
pnpm --filter @react-ws/mock-ws add ws
```

## Package usage (summary)

Full API docs: **[`packages/react-ws/README.md`](./packages/react-ws/README.md)** (English) · **[繁中](./packages/react-ws/README.zh-TW.md)**

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
