# react-ws monorepo

[![npm version](https://img.shields.io/npm/v/react-ws-context.svg)](https://www.npmjs.com/package/react-ws-context)
[![npm downloads](https://img.shields.io/npm/dm/react-ws-context.svg)](https://www.npmjs.com/package/react-ws-context)

> [English](./README.md)

此 repository 從 `packages/react-ws` 發佈 React WebSocket 連線層 `react-ws-context`。`apps/web` 是 Next.js Demo。`apps/mock-ws` 是本地 WebSocket server，位址 `ws://localhost:8080`。

維護者是 [GaiaYang](https://github.com/GaiaYang)。原始碼在 [github.com/GaiaYang/react-ws](https://github.com/GaiaYang/react-ws)。

## 目錄結構

```
.
├── packages/react-ws   # react-ws-context（無執行期 npm 依賴）
├── apps/web            # Next.js Demo
└── apps/mock-ws        # 本地 mock WS，ws://localhost:8080
```

## 跑 Demo

所有指令都在 repository 根目錄執行，也就是含 `pnpm-workspace.yaml` 的那一層。

1. 用 `pnpm install` 安裝 workspace 依賴。
2. 在第一個終端執行 `pnpm dev:mock`。mock server 開在 `ws://localhost:8080`。
3. 在第二個終端執行 `pnpm dev`。Demo 在 http://localhost:3000。

Demo 連線 `ws://localhost:8080`。兩個終端都要在跑。

Demo 透過 `workspace:*` 從編譯後的 `dist/` 引用 `react-ws-context`。`pnpm dev` 會平行跑 `tsdown --watch` 與 Next.js，所以在 `packages/react-ws` 存檔就會重編譯套件。

若只跑 `pnpm --filter @react-ws/web dev`、不含套件 watch，需先執行 `pnpm build:pkg`。

根目錄其他指令：

```bash
pnpm build:pkg        # 編譯 packages/react-ws 到 dist/
pnpm typecheck        # 全 workspace 型別檢查
pnpm test             # packages/react-ws tests
```

### 為子專案加依賴

```bash
pnpm --filter @react-ws/web add lodash-es
pnpm --filter react-ws-context add -D some-dev-tool
pnpm --filter @react-ws/mock-ws add ws
```

## 安裝已發佈的套件

```bash
pnpm add react-ws-context react
# or: npm install react-ws-context react
# or: yarn add react-ws-context react
```

API、選項與 hook 行為見 [`packages/react-ws/README.zh-TW.md`](./packages/react-ws/README.zh-TW.md)（繁中）、[English README](./packages/react-ws/README.en.md)、[Changelog](./packages/react-ws/CHANGELOG.md)。

```tsx
"use client";

import { createWsContext } from "react-ws-context";

export const { WsProvider, useWsActions, useWsStore, useWsEvents } =
	createWsContext({
		url: "ws://localhost:8080",
		reconnectMs: 2000,
	});
```

`url` 與 `protocols` 也可為同步 getter，每次 `connect()` 開頭取值。`reconnectMs` 為 `0` 時，重連保持關閉。

## 授權

本 monorepo 以 [MIT License](./LICENSE) 釋出。Copyright (c) 2026 [GaiaYang](https://github.com/GaiaYang)。zustand 與 nanoevents 的借鑑出處見 [`packages/react-ws/README.zh-TW.md#借鑑與致謝`](./packages/react-ws/README.zh-TW.md#借鑑與致謝)。
