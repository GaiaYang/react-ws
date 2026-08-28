> **English:** [README.md](./README.md)

# react-ws-context

React 用的 WebSocket **連線層**套件。將連線生命週期、可訂閱狀態與訊息事件分離，避免 status 或高頻訊息更新拖垮整棵元件樹。

> **維護者：** [GaiaYang](https://github.com/GaiaYang)  
> **原始碼：** [github.com/GaiaYang/react-ws](https://github.com/GaiaYang/react-ws)（monorepo 內路徑 `packages/react-ws`）

## 特性

- **零 runtime 依賴** — 僅需 `react >= 18`（peer dependency）
- **設定凍結** — `url`、`reconnectMs` 等在 `createWsContext` 時固定；執行期以 `connect` / `disconnect` 控制
- **渲染隔離** — 連線層 state（健康／佇列／重連）走外部 store；訊息走 event emitter，不進 React Context
- **可選探活** — 週期性 ping／pong 偵測，逾時主動關閉 socket 以觸發重連
- **可選 outbound 佇列** — 未 OPEN 時暫存待送訊息，連線成功後 flush

## 環境需求

| 項目     | 版本                                              |
| -------- | ------------------------------------------------- |
| React    | >= 18（依賴 `useSyncExternalStore`）              |
| 執行環境 | 瀏覽器 Client Component（需原生 `WebSocket` API） |

套件入口標有 `"use client"`。呼叫 `createWsContext` 的模組，以及使用其 hooks 的元件，皆須位於 Client 邊界內。

## 安裝

```bash
pnpm add react-ws-context react
# npm install react-ws-context react
# yarn add react-ws-context react
```

## 快速開始

**1. 建立連線 context（通常放在獨立模組，只執行一次）**

```tsx
"use client";

import { createWsContext } from "react-ws-context";

export const { WsProvider, useWsActions, useWsStore, useWsEvents } =
  createWsContext({
    url: "ws://localhost:8080",
    reconnectMs: 2000,
  });
```

**2. 在應用中使用**

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
    console.log("收到訊息", data);
  });

  return (
    <button
      disabled={status !== "open"}
      onClick={() => sendJson({ type: "ping" })}
    >
      送出（{status}）
    </button>
  );
}
```

## 核心概念

```
createWsContext(options)
        │
        ├── WsProvider      管理 WebSocket 實例、重連、探活、outbound 佇列
        ├── useWsActions()  連線操作（send / connect / disconnect），不觸發重繪
        ├── useWsStore()    訂閱連線層 state：健康／佇列／重連（useSyncExternalStore）
        └── useWsEvents()  訂閱 open / message / error / close 事件
```

- **同一應用可多次呼叫 `createWsContext`**，每次產生一組互不共用的 Provider 與 hooks（例如同時連業務 WS 與通知 WS）。
- **`WsState` 只放連線層、低頻欄位** — 連線健康（如 `status`）、outbound 佇列（如未來 `pendingCount`）、重連（如未來 `reconnectAttempt`）。**不放**訊息 payload 或業務資料。
- **訊息與錯誤事件** — 請用 `useWsEvents`；訊息歷史請自行寫入 state、cache 或外部 store。
- **連線錯誤不反映在 `WsStatus`** — 請用 `useWsEvents("error", …)` 處理；原生 `error` 事件後通常緊接 `close`。

---

## API 參考

### `createWsContext(options)`

建立一組綁定同一連線設定的 `WsProvider` 與 hooks。

#### 參數：`CreateWsContextOptions`

| 欄位               | 型別                                      | 預設     | 說明                                           |
| ------------------ | ----------------------------------------- | -------- | ---------------------------------------------- |
| `url`              | `string`                                  | （必填） | WebSocket 連線網址                             |
| `protocols`        | `string \| string[]`                      | —        | 傳入 `new WebSocket(url, protocols)` 的子協定  |
| `autoConnect`      | `boolean`                                 | `true`   | `WsProvider` mount 後是否自動呼叫 `connect()`  |
| `reconnectMs`      | `number`                                  | `0`      | 非主動斷線後的重連間隔（毫秒）；`0` 表示不重連 |
| `outgoingQueueMax` | `number`                                  | `0`      | 未 OPEN 時 outbound 佇列上限；`0` 關閉佇列     |
| `parse`            | `(data: MessageEvent["data"]) => unknown` | 見下方   | 將原始 `MessageEvent.data` 轉成業務資料        |
| `liveness`         | `LivenessOptions`                         | —        | 探活設定；省略則不啟用                         |

**預設 `parse` 行為：**

- `data` 為字串 → 嘗試 `JSON.parse`，失敗則原樣回傳
- 非字串 → 原樣回傳

#### 回傳值

| 名稱           | 型別                                 | 說明                                 |
| -------------- | ------------------------------------ | ------------------------------------ |
| `WsProvider`   | `React.FC<{ children }>`             | 包住需要此連線的子樹                 |
| `useWsActions` | `() => WsContextValue`               | 連線操作 API                         |
| `useWsStore`   | `() => WsState` 或 `(selector) => T` | 訂閱連線層 state（健康／佇列／重連） |
| `useWsEvents`  | `(type, handler) => void`            | 訂閱 WebSocket 事件                  |

---

### `WsProvider`

負責建立、維護與銷毀原生 `WebSocket` 實例。

| 行為                        | 說明                                                                        |
| --------------------------- | --------------------------------------------------------------------------- |
| mount + `autoConnect: true` | 自動 `connect()`                                                            |
| unmount                     | 主動關閉連線、停止探活、清空 outbound 佇列，並 emit `close`                 |
| 重連                        | 非主動斷線且 `reconnectMs > 0` 時，以固定間隔重試（無 exponential backoff） |
| 重連前                      | 若已有舊 socket，先關閉並 emit `close`（reason: `"reconnect"`）             |

---

### `useWsActions(): WsContextValue`

必須在對應的 `WsProvider` 內使用。回傳值以 `useMemo` 穩定引用，**不會**因 store 或訊息更新而重繪元件。

| 方法         | 簽名                         | 說明                                                                                       |
| ------------ | ---------------------------- | ------------------------------------------------------------------------------------------ |
| `send`       | `(data) => boolean`          | 傳送原始資料（`string`、`ArrayBuffer`、`Blob` 等）。已 OPEN 則立即送出；否則視佇列設定入隊 |
| `sendJson`   | `(data: unknown) => boolean` | `JSON.stringify` 後呼叫 `send`                                                             |
| `connect`    | `() => void`                 | 建立連線；若已有連線會先關閉舊 socket                                                      |
| `disconnect` | `() => void`                 | 主動斷線，**不**觸發自動重連；清空 outbound 佇列                                           |
| `getStatus`  | `() => WsStatus`             | 讀取當下 status；不訂閱、不觸發渲染                                                        |

**`send` / `sendJson` 回傳值：**

- `true` — 已送出，或已成功入隊
- `false` — 未 OPEN 且佇列已滿（`outgoingQueueMax > 0` 且達上限），或佇列關閉（`outgoingQueueMax === 0`）

---

### `useWsStore()`

必須在對應的 `WsProvider` 內使用。底層以 `useSyncExternalStore` 訂閱外部 store。

`WsState` 定位：**連線健康／outbound 佇列／重連** 等低頻、連線生命週期資訊。高頻訊息請用 `useWsEvents("message", …)`，不要寫進 store。

```ts
useWsStore(): WsState
useWsStore<T>(selector: (state: WsState) => T): T
```

#### `WsState`

```ts
interface WsState {
  status: WsStatus;
  // 未來可能擴充（皆為低頻、連線層）：
  // reconnectAttempt?: number;
  // pendingCount?: number;
}
```

| 適合放進 store                                               | 不適合                                |
| ------------------------------------------------------------ | ------------------------------------- |
| `status`、重連次數、待送佇列長度、探活／stall 等連線健康摘要 | `lastMessage`、訊息歷史、業務 payload |

#### `WsStatus`

| 值           | 意義     |
| ------------ | -------- |
| `idle`       | 尚未連線 |
| `connecting` | 連線中   |
| `open`       | 已連線   |
| `closed`     | 已斷線   |

**建議：** 以 selector 只訂閱需要的欄位；state 擴充後可避免不必要的重繪。

```tsx
const status = useWsStore((s) => s.status);
```

---

### `useWsEvents(type, handler)`

必須在對應的 `WsProvider` 內使用。在 `useEffect` 內註冊，unmount 時自動取消訂閱。

| `type`      | handler 簽名                                   | 說明                             |
| ----------- | ---------------------------------------------- | -------------------------------- |
| `"message"` | `(data: unknown, event: MessageEvent) => void` | `data` 為經 `parse` 處理後的結果 |
| `"open"`    | `(event: Event) => void`                       | 連線建立                         |
| `"error"`   | `(event: Event) => void`                       | 連線錯誤                         |
| `"close"`   | `(event: CloseEvent) => void`                  | 連線關閉                         |

**行為細節：**

- `handler` 以 ref 保存最新引用，callback 重建**不會**導致重新訂閱
- `type` 變更**會**重新訂閱
- 需監聽多種事件時，分別呼叫多次 `useWsEvents`

---

### 探活：`LivenessOptions`

透過 `createWsContext({ liveness: { … } })` 啟用。連線 OPEN 後開始週期性送 ping；若在 `timeoutMs` 內未收到符合條件的 pong，主動 `close()` socket（進而觸發重連流程）。

```ts
interface LivenessOptions {
  intervalMs: number; // ping 間隔（毫秒）
  timeoutMs: number; // 等待 pong 逾時（毫秒）
  ping: unknown | (() => unknown); // ping  payload；函式則每次動態產生
  isPong: (data: unknown) => boolean; // 判定傳入 data 是否為 pong
}
```

**範例：**

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

探活期間，`onmessage` 收到的每一筆資料都會先經 `isPong` 判定；若為 pong 則重置逾時計時，並照常 emit `"message"` 事件。

---

### Outbound 佇列

當 `outgoingQueueMax > 0` 時：

| 時機                     | 行為                           |
| ------------------------ | ------------------------------ |
| `send` 且 socket 未 OPEN | 訊息入隊（FIFO）               |
| 佇列已滿                 | 回傳 `false`，**不**丟棄舊訊息 |
| socket OPEN              | 依序 flush 全部佇列            |
| `disconnect()`           | 清空佇列                       |
| `WsProvider` unmount     | 清空佇列                       |
| 自動重連等待期間         | **保留**佇列                   |

---

### 匯出型別

自 `react-ws-context` 主入口匯出：

| 型別                     | 說明                                               |
| ------------------------ | -------------------------------------------------- |
| `CreateWsContextOptions` | `createWsContext` 的選項                           |
| `WsContextValue`         | `useWsActions()` 回傳型別                          |
| `WsEvents`               | 事件名稱與 handler 的型別對應                      |
| `WsStatus`               | 連線生命週期狀態聯集（`WsState` 的一環）           |
| `WsState`                | 可訂閱 store 的 state 形狀（連線健康／佇列／重連） |

---

## 子模組：`react-ws-context/stall`

可選的停滯（stall）控制訊息 helper，供 Demo 或需與 mock server 對接的場景使用。**不**自動整合進 `createWsContext`，需自行在 handler 內解析。

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

| 匯出                         | 說明                                                            |
| ---------------------------- | --------------------------------------------------------------- |
| `STALL_MESSAGE_TYPE`         | 客戶端控制訊息 type 常數（`"STALL"`）                           |
| `STALL_ACK_TYPE`             | 伺服器確認 type 常數（`"STALL_ACK"`）                           |
| `createStallMessage(action)` | 建立可 `sendJson` 的控制訊息                                    |
| `parseStallMessage(data)`    | 從 `useWsEvents("message")` 的 `data` 解析；格式不符回傳 `null` |
| `StallAction`                | `"stall" \| "release"`                                          |
| `StallMessage`               | `{ type: "STALL"; action: StallAction }`                        |
| `StallAck`                   | `{ type: "STALL_ACK"; action: StallAction; active: boolean }`   |

**範例：**

```tsx
const { sendJson } = useWsActions();

useWsEvents("message", (data) => {
  const stall = parseStallMessage(data);
  if (stall) console.log("stall 控制", stall.action);
});

sendJson(createStallMessage("stall"));
```

---

## 設計取捨與限制

| 項目           | 說明                                                                                       |
| -------------- | ------------------------------------------------------------------------------------------ |
| 設定不可變     | `url`、`reconnectMs` 等建立後固定；需換 URL 請另建 context 或手動 `disconnect` + `connect` |
| 重連策略       | 固定間隔，無 exponential backoff、無最大重試次數                                           |
| SSR            | 不在 server 建立 `WebSocket`；`connect()` 在 `window` 不存在時為 no-op                     |
| 錯誤狀態       | 不設 `"error"` status；請監聽 `useWsEvents("error")`                                       |
| `WsState` 範圍 | 只含連線健康／佇列／重連；訊息與業務資料不走 store                                         |
| 訊息與渲染     | 只呼叫 `useWsActions` 的元件不會因 store 或 message 重繪                                   |

---

## 授權

本套件以 [MIT License](./LICENSE) 釋出。Copyright (c) 2026 [GaiaYang](https://github.com/GaiaYang)。

---

## 借鑑與致謝

本套件**未**將下列專案列為 npm 依賴；為達成零 runtime 依賴，僅內嵌本套件所需的精簡子集。各原始碼檔案頂部亦附有出處備註。

### [zustand](https://github.com/pmndrs/zustand)

- **作者／維護：** [pmndrs](https://github.com/pmndrs)（Poimandres）
- **授權：** [MIT](https://github.com/pmndrs/zustand/blob/main/LICENSE)
- **借鑑範圍：**
  - 外部 store（`getState` / `setState` / `subscribe` / `getInitialState`）— 靈感與行為對齊 [`vanilla.ts`](https://github.com/pmndrs/zustand/blob/main/src/vanilla.ts)，非完整搬移（無 middleware、replace、initializer factory）
  - React 訂閱 hook — 靈感來自 [`react.ts`](https://github.com/pmndrs/zustand/blob/main/src/react.ts) 的 `useStore`（selector 必填、無 `useDebugValue`）
- **對應原始碼：** `src/ws-context/store.ts`、`src/ws-context/use-store.ts`

### [nanoevents](https://github.com/ai/nanoevents)

- **作者：** [Andrey Sitnik](https://github.com/ai)（`ai`）
- **授權：** [MIT](https://github.com/ai/nanoevents/blob/main/LICENSE)
- **借鑑範圍：**
  - Typed event emitter — 執行期邏輯幾乎對齊 [`createNanoEvents`](https://github.com/ai/nanoevents/blob/main/index.js)；型別為本套件收斂版
  - `useEmitter` 為本套件自行新增（React `useState` 包裝）
- **對應原始碼：** `src/ws-context/emitter.ts`
