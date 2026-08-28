# react-ws monorepo

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
pnpm dev:mock         # 啟動 mock server → ws://localhost:8080
pnpm dev              # 啟動 Demo → http://localhost:3000
pnpm build:pkg        # 編譯 packages/react-ws → dist/
pnpm typecheck        # 全 workspace 型別檢查
```

Demo 透過 `workspace:*` 依賴 `react-ws-context`，開發時直讀套件 `src/`（Next `transpilePackages`）；`pnpm publish` 時改發 `dist/`。

### 為子專案加依賴

```bash
pnpm --filter @react-ws/web add lodash-es
pnpm --filter react-ws-context add -D some-dev-tool
pnpm --filter @react-ws/mock-ws add ws
```

## 套件用法（摘要）

完整 API 文件見 **[`packages/react-ws/README.zh-TW.md`](./packages/react-ws/README.zh-TW.md)**（繁中）· **[English](./packages/react-ws/README.md)**

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
