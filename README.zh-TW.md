# react-ws monorepo

[![npm version](https://img.shields.io/npm/v/react-ws-context.svg)](https://www.npmjs.com/package/react-ws-context)
[![npm downloads](https://img.shields.io/npm/dm/react-ws-context.svg)](https://www.npmjs.com/package/react-ws-context)

> **English:** [README.md](./README.md)

React WebSocket **連線層** monorepo。可發佈套件：**`react-ws-context`**（目錄 `packages/react-ws`）。

> 維護者：[GaiaYang](https://github.com/GaiaYang) · 原始碼：<https://github.com/GaiaYang/react-ws>

## 目錄結構

```
.
├── packages/react-ws   # 套件核心：react-ws-context（零 runtime 依賴）
├── apps/web            # Next.js Demo
└── apps/mock-ws        # 本地 mock WS（ws://localhost:8080）
```

## 開發

**所有指令均在 monorepo 根目錄執行**（含 `pnpm-workspace.yaml` 的這一層）：

```bash
pnpm install          # 安裝整個 workspace 依賴
pnpm dev:mock         # 終端 1：mock server → ws://localhost:8080
pnpm dev              # 終端 2：Demo → http://localhost:3000
pnpm build:pkg        # 編譯 packages/react-ws → dist/
pnpm typecheck        # 全 workspace 型別檢查
```

Demo 連線 `ws://localhost:8080`，需同時跑 `dev:mock` 與 `dev`（兩個終端）。`react-ws-context` 透過 `workspace:*` 讀取編譯後的 `dist/`；`pnpm dev` 會平行跑 `tsdown --watch` 與 Next.js，改套件原始碼時存檔即會重編譯。若只啟動 web、不跑 watch，需先 `pnpm build:pkg`。

### 為子專案加依賴

```bash
pnpm --filter @react-ws/web add lodash-es
pnpm --filter react-ws-context add -D some-dev-tool
pnpm --filter @react-ws/mock-ws add ws
```

## 從 npm 安裝

```bash
pnpm add react-ws-context react
# or: npm install react-ws-context react
# or: yarn add react-ws-context react
```

## 套件用法（摘要）

完整 API 文件見 **[`packages/react-ws/README.zh-TW.md`](./packages/react-ws/README.zh-TW.md)**（繁中）· **[English](./packages/react-ws/README.md)** · **[Changelog](./packages/react-ws/CHANGELOG.md)**

```tsx
"use client";

import { createWsContext } from "react-ws-context";

export const { WsProvider, useWsActions, useWsStore, useWsEvents } =
  createWsContext({
    url: "ws://localhost:8080",
    reconnectMs: 2000,
  });
```

## 授權

本 monorepo 以 [MIT License](./LICENSE) 釋出。Copyright (c) 2026 [GaiaYang](https://github.com/GaiaYang)。套件核心內嵌程式碼之借鑑出處（zustand、nanoevents）詳見 [`packages/react-ws/README.zh-TW.md#借鑑與致謝`](./packages/react-ws/README.zh-TW.md#借鑑與致謝)。
