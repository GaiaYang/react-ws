# react-ws-context

[![npm version](https://img.shields.io/npm/v/react-ws-context.svg)](https://www.npmjs.com/package/react-ws-context)
[![npm downloads](https://img.shields.io/npm/dm/react-ws-context.svg)](https://www.npmjs.com/package/react-ws-context)

> [English](./README.en.md)

`react-ws-context` 是給 React 用的 WebSocket 連線層：連線生命週期、連線狀態與事件分開處理。

```text
                       react-ws-context

WebSocket ──→ Events ─────────────→ Event handlers
    │
    └──────→ Connection state ────→ External store ──→ React
```

## 核心概念

| 需求                | API            |
| ------------------- | -------------- |
| 傳送、連線、斷線    | `useWsActions` |
| 訂閱連線狀態        | `useWsStore`   |
| 監聽 WebSocket 事件 | `useWsEvents`  |

一次 `createWsContext` 對應一條 WebSocket。回傳綁定該連線的 `WsProvider` 與三個 hooks。兩條 socket 呼叫兩次。hooks 必須在對應的 `WsProvider` 內。

## 安裝

```bash
pnpm add react-ws-context react
# or: npm install react-ws-context react
# or: yarn add react-ws-context react
```

需要 React 18+（`useSyncExternalStore`）。沒有執行期 npm 依賴。需要 `globalThis.WebSocket`；沒有時 `connect()` 不會建立連線。若該次呼叫來自已觸發的重連計時器，store 為 `status: "closed"`、`phase: "stopped"`。

套件入口標有 `"use client"`（Next.js App Router）。一般 SPA 會忽略。

## 快速開始

```tsx
"use client";

import { createWsContext } from "react-ws-context";

export const { WsProvider, useWsActions, useWsStore, useWsEvents } =
  createWsContext({
    url: "ws://localhost:8080",
    reconnectMs: 2000,
  });
```

```tsx
"use client";

import { WsProvider, useWsActions, useWsStore, useWsEvents } from "./ws";

export function App({ children }: { children: React.ReactNode }) {
  return <WsProvider>{children}</WsProvider>;
}

function Chat() {
  const { sendJson } = useWsActions();
  const status = useWsStore((s) => s.status);
  const phase = useWsStore((s) => s.phase);

  useWsEvents("message", (data) => {
    // 訊息歷史請存在自己的 state 或 store
    console.log("收到訊息", data);
  });

  return (
    <button
      disabled={status !== "open"}
      onClick={() => sendJson({ type: "chat", text: "hi" })}
    >
      送出（{status}／{phase}）
    </button>
  );
}
```

## 連線狀態

- `status`：WebSocket 連線狀態（類似 `readyState`）。
- `phase`：Provider 連線階段，含重連。

```ts
{
  status: "closed",
  phase: "reconnecting",
}
```

socket 已關，Provider 正在等待或進行下一次自動重連。

`phase === "reconnecting"` 且 `status === "connecting"`：重連計時器已觸發，正在連線。

```tsx
const phase = useWsStore((s) => s.phase);
const canConnect = phase === "idle" || phase === "stopped";
```

```tsx
const canConnect = useWsStore(
  (s) => s.phase === "idle" || s.phase === "stopped",
);
```

### `WsStatus`

| 值           | 意義                                             |
| ------------ | ------------------------------------------------ |
| `idle`       | 尚未連線。只出現在初始值。斷線後不會回到這個值。 |
| `connecting` | 連線中。                                         |
| `open`       | 已連線。                                         |
| `closed`     | 已斷線。                                         |

`disconnect()` 後為 `status: "closed"`、`phase: "idle"`。`status` 不會回到 `idle`。連線錯誤不是 `WsStatus`，走 `useWsEvents("error")`。原生 `error` 後通常緊接 `close`。

### `WsPhase`

| 值             | 意義                                                     |
| -------------- | -------------------------------------------------------- |
| `idle`         | 未連線、未排程重連。初始值，或手動 `disconnect()` 之後。 |
| `connecting`   | 首次或手動 `connect()` 進行中。                          |
| `open`         | 已連線。                                                 |
| `reconnecting` | 自動重連週期。正在等計時器，或正在連線。                 |
| `stopped`      | 不會再自動重連。                                         |

`phase` 為 `stopped` 時：若已達 `reconnectMax`，`reconnectExhausted` 為 `true`；未啟用重連，或重連計時器到了但握手失敗時，為 `false`。

## 重連

非主動斷線後再開 socket，不必重掛 Provider。`reconnectMs: 0` 關閉重連。

`reconnectMax: 3` 最多 3 次自動重連，不含最初的 `connect()`，也不含手動 `connect()`。`reconnectMax: 0` 不限次數。

### `connect()` 替換規則

重連與手動 `connect()` 相同：

```text
existing socket
      │
      │ connect() / reconnect
      ▼
create new socket
      │
      ├── failure → keep existing socket
      │
      └── success → replace existing socket
```

先建構新 socket，成功後才關閉舊的，並觸發 `close`（reason `"reconnect"`），再將 `status` 設為 `"connecting"`。來自重連計時器時 `phase` 為 `"reconnecting"`，否則為 `"connecting"`。

建構失敗（getter 擲出、URL 為空、`new WebSocket` 擲出）：發 `"error"`，保留既有 socket，`connect()` 本身不 throw。若呼叫來自已觸發的重連計時器：停止自動重試，store 為 `status: "closed"`、`phase: "stopped"`。之後呼叫 `connect()` 再試。

事件 payload 與 store／`close` 順序見 [`useWsEvents`](#usewsevents)。

### 選項

在 `reconnectMs > 0` 時生效（預設與型別見 [`createWsContext`](#createwscontext)）：

| 欄位                   | 預設    | 說明                                                 |
| ---------------------- | ------- | ---------------------------------------------------- |
| `reconnectBackoff`     | `2`     | 下次等待的倍率。`1` 為固定間隔                       |
| `reconnectMax`         | `0`     | 自動重連次數上限。`0` 表示不限制                     |
| `reconnectDelayMaxMs`  | `30000` | 單次等待硬上限，含抖動。`0` 表示不設上限             |
| `reconnectJitter`      | `0.2`   | 隨機縮短幅度，取值 `[0, 1]`。`0` 不抖動              |
| `reconnectMinUptimeMs` | `5000`  | 連線需維持多久才歸零重連週期。`0` 表示 `open` 即歸零 |

第 `n` 次重連等待：先算 `reconnectMs * reconnectBackoff ** (n - 1)`，再套 `reconnectDelayMaxMs`（`0` 則不設上限），再乘 `(1 - random * reconnectJitter)`。

`reconnectMs: 1000` 預設排程大約 1s → 2s → 4s，上限 30s，每次再隨機縮短 0%–20%。socket 維持開啟滿 `reconnectMinUptimeMs` 後歸零週期。伺服器接受後立刻斷線時，請保持 `reconnectMinUptimeMs > 0`。為 `0` 時，每次 `open` 都會歸零重連週期；若 socket 很快斷線，下一次重連會重新從第一次等待開始計算，`reconnectMax` 也會重新計數。

`0` 的意思：`reconnectMs: 0` 關閉重連；`reconnectMax: 0` 與 `reconnectDelayMaxMs: 0` 不設上限。

固定間隔、不抖動、每次 `open` 即歸零：

```ts
createWsContext({
  url: "ws://localhost:8080",
  reconnectMs: 2000,
  reconnectBackoff: 1,
  reconnectJitter: 0,
  reconnectMinUptimeMs: 0,
});
```

### Store 欄位

- `reconnectAttempt` 為 `n`：第 n 次重連已排程或進行中。非主動斷線並決定重試時加一，不是連上才加。
- `nextReconnectAt`：等待中的到期時間（`Date.now()` 毫秒）。沒在等待時為 `0`。實際等待為 `nextReconnectAt - Date.now()`。
- `reconnectExhausted`：已達 `reconnectMax` 且最後一次也失敗。之後的 `connect()` 或 `disconnect()` 清回 `false`。

歸零：連線維持開啟滿 `reconnectMinUptimeMs`（預設 5s；`0` 則 `open` 即歸零）。`disconnect()` 立刻歸零。手動 `connect()` 若不在等重連計時器，立刻歸零；若正在等，要等這次連上並撐滿 `reconnectMinUptimeMs`。

## Liveness

`liveness` 是應用層心跳，不是 WebSocket 協定層 ping/pong。用來偵測 socket 看似開啟、但應用層已無回應。

設定後，Provider 定期送應用層 ping。`timeoutMs` 內沒有符合的 pong 則關閉 socket；`reconnectMs > 0` 時走非主動斷線重連。

`ping` 由應用程式提供，套件不自動 `JSON.stringify`。`isPong` 看 `parse` 結果，`true` 才算 pong。pong 仍觸發 `"message"`。`ping` 擲出則該次不送，但仍開始等 pong；逾時一樣關線。

```tsx
createWsContext({
  url: "ws://localhost:8080",
  reconnectMs: 3000,
  liveness: {
    intervalMs: 30_000,
    timeoutMs: 10_000,
    ping: JSON.stringify({ type: "ping" }),
    isPong: (data) =>
      typeof data === "object" &&
      data != null &&
      (data as { type?: string }).type === "pong",
  },
});
```

欄位見下方 [`LivenessOptions`](#createwscontext)。

## API 參考

### `createWsContext`

`createWsContext(options)` 回傳綁定同一份設定的 `WsProvider` 與 hooks。選項在建立時固定；換設定需再呼叫一次。

#### 選項

`CreateWsContextOptions`

| 欄位                   | 型別                                      | 預設    | 說明                                                                                                                       |
| ---------------------- | ----------------------------------------- | ------- | -------------------------------------------------------------------------------------------------------------------------- |
| `url`                  | `MaybeGetter<string>`                     | 必填    | WebSocket URL。同步 getter 在每次 `connect()` 開頭呼叫。                                                                   |
| `protocols`            | `MaybeGetter<string \| string[]>`         | 無      | 傳入 `new WebSocket(url, protocols)`。省略則不傳第二參數。getter 回傳空字串會原樣傳入。                                    |
| `autoConnect`          | `boolean`                                 | `true`  | `WsProvider` 掛載時自動連線。                                                                                              |
| `reconnectMs`          | `number`                                  | `0`     | 非主動斷線後第一次重連等待（毫秒）。`0` 不重連。詳見 [重連](#重連)。                                                       |
| `reconnectMax`         | `number`                                  | `0`     | 自動重連上限。`0` 不限制。仍需 `reconnectMs > 0`。                                                                         |
| `reconnectBackoff`     | `number`                                  | `2`     | 下次等待倍率。`2` 加倍；`1` 不放大；小於 `1` 夾回 `1`。                                                                   |
| `reconnectDelayMaxMs`  | `number`                                  | `30000` | 單次等待硬上限（毫秒），含抖動。`0` 不設上限。                                                                             |
| `reconnectJitter`      | `number`                                  | `0.2`   | 隨機縮短幅度 `[0, 1]`。預設實際等待為預定時間的 80%–100%。`1` 為 full jitter；`0` 不抖動。                                 |
| `reconnectMinUptimeMs` | `number`                                  | `5000`  | 維持多久才歸零重連週期（毫秒）。`0` 表示 `open` 即歸零。                                                                   |
| `parse`                | `(data: MessageEvent["data"]) => unknown` | 見下方  | 原始 `MessageEvent.data` → 業務資料。擲出發 `"error"`，不發 `"message"`，不關線。                                          |
| `liveness`             | `LivenessOptions`                         | 無      | 應用層心跳。省略則不啟用。                                                                                                 |

預設 `parse`：字串嘗試 `JSON.parse`，失敗則原樣；非字串原樣回傳。

`url`／`protocols` getter 必須同步，不可 `await` 或呼叫 hooks。套件不處理驗證；token 由應用程式提供。

```tsx
createWsContext({
  url: () => {
    const token = localStorage.getItem("accessToken");
    if (!token) throw new Error("no token");
    return `wss://api.example.com/ws?token=${encodeURIComponent(token)}`;
  },
  autoConnect: false,
  reconnectMs: 2000,
});
```

`connect()` 建構失敗行為見 [重連 → `connect()` 替換規則](#connect-替換規則)。

`LivenessOptions`

| 欄位         | 型別                                              | 說明                                                       |
| ------------ | ------------------------------------------------- | ---------------------------------------------------------- |
| `intervalMs` | `number`                                          | ping 間隔（毫秒）。                                        |
| `timeoutMs`  | `number`                                          | 等待 pong（毫秒）。                                        |
| `ping`       | `WebSocket.send` 可接受的資料，或回傳該型別的函式 | 要送的 ping。函式則每次呼叫。                              |
| `isPong`     | `(data: unknown) => boolean`                      | 判定 parse 後是否為 pong。擲出視為不是。仍發 `"message"`。 |

#### 回傳值

| 名稱           | 型別                                 | 說明                           |
| -------------- | ------------------------------------ | ------------------------------ |
| `WsProvider`   | `React.FC<{ children }>`             | 持有子樹的 WebSocket。         |
| `useWsActions` | `() => WsContextValue`               | 連線操作。                     |
| `useWsStore`   | `() => WsState` 或 `(selector) => T` | 連線狀態。                     |
| `useWsEvents`  | `(type, handler) => void`            | WebSocket 事件。               |

### `WsProvider`

管理子樹對應的原生 `WebSocket`；卸載時關閉。

| 時機                           | 行為                                                                                                                                   |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| 掛載且 `autoConnect: true`     | 連線。                                                                                                                                 |
| 卸載                           | 取消重連並歸零進度、停止 `liveness`。store → `status: "closed"`、`phase: "idle"`。有 socket 則關線，`close` reason `"provider unmount"`。 |
| `disconnect()`                 | 清理與 store 重置同卸載。不自動重連。有 socket 則 `close` reason `"client disconnect"`。                                               |
| 非主動斷線且 `reconnectMs > 0` | 排程重連（退避／上限／抖動）。見 [重連](#重連)。                                                                                       |
| `connect()` 已有／無 socket    | 見 [重連 → `connect()` 替換規則](#connect-替換規則)。                                                                                  |

### `useWsActions`

`useWsActions(): WsContextValue`

在對應 `WsProvider` 外呼叫時擲出 `"useWsActions 必須包在對應的 WsProvider 內"`。方法引用穩定；只呼叫它的元件不因 store 或訊息更新而重繪。

| 方法         | 簽名                         | 說明                                                                                   |
| ------------ | ---------------------------- | -------------------------------------------------------------------------------------- |
| `send`       | `(data) => boolean`          | 連線開啟時送出並回 `true`。否則 `false`，不暫存。                                      |
| `sendJson`   | `(data: unknown) => boolean` | `JSON.stringify` 後 `send`。無法序列化回 `false`。                                     |
| `connect`    | `() => void`                 | 取值後建構 socket。行為見 [重連 → `connect()` 替換規則](#connect-替換規則)。           |
| `disconnect` | `() => void`                 | 主動斷線。`phase: "idle"`、`status: "closed"`。不自動重連。                            |
| `getStatus`  | `() => WsStatus`             | 讀當下 `status`，不訂閱。                                                              |

### `useWsStore`

在對應 `WsProvider` 外呼叫時擲出 `"useWsStore 必須包在對應的 WsProvider 內"`。

```ts
useWsStore(): WsState
useWsStore<T>(selector: (state: WsState) => T): T
```

使用 `useSyncExternalStore`。不帶 selector 訂閱整份 `WsState`；建議帶 selector。selector 回傳值以 `Object.is` 與前次結果比較；相等則不因 store 其他欄位變更而重繪。每次回傳新的物件或陣列會不相等，仍會重繪。進來的訊息不在此 store。

#### `WsState`

| 欄位                 | 型別       | 說明                                                           |
| -------------------- | ---------- | -------------------------------------------------------------- |
| `status`             | `WsStatus` | WebSocket 連線狀態。見 [連線狀態](#連線狀態)。                 |
| `phase`              | `WsPhase`  | Provider 連線階段。見 [連線狀態](#連線狀態)。                  |
| `reconnectAttempt`   | `number`   | 本輪已排程的自動重連次數。見 [重連 → Store 欄位](#store-欄位)。 |
| `reconnectExhausted` | `boolean`  | 已達 `reconnectMax` 且最後一次也失敗。見同上。                 |
| `nextReconnectAt`    | `number`   | 下次自動重連到期（`Date.now()` 毫秒）。未等待為 `0`。          |

`reconnectMax` 等選項與握手 URL 不在 `WsState`。UI 若要「第 n 次／最多 m 次」，建立 context 時自行保存設定。

### `useWsEvents`

`useWsEvents(type, handler)`

在對應 `WsProvider` 外呼叫時擲出 `"useWsEvents 必須包在對應的 WsProvider 內"`。

掛載訂閱、卸載取消。更新回呼不重新訂閱；變更 `type` 才會。一次呼叫聽一種事件。handler 擲出不向外冒泡，也不打斷連線層後續（例如改用新 socket、啟動 liveness）。

| `type`      | 回呼                                           | 說明                                                                              |
| ----------- | ---------------------------------------------- | --------------------------------------------------------------------------------- |
| `"message"` | `(data: unknown, event: MessageEvent) => void` | `data` 為 `parse` 後結果。                                                        |
| `"open"`    | `(event: Event) => void`                       | 連線建立。                                                                        |
| `"error"`   | `(event: Event) => void`                       | socket、握手或 `parse` 錯誤。握手／取值失敗為 `{ type: "error" }`，不是 `Error`。 |
| `"close"`   | `(event: CloseEvent) => void`                  | 連線關閉。                                                                        |

順序與失敗行為：

| 情況                         | `"error"`                         | `"close"`              | socket／store                                                                 |
| ---------------------------- | --------------------------------- | ---------------------- | ----------------------------------------------------------------------------- |
| 非主動斷線                   | 視情況（原生 `error` 常緊接在前） | 有                     | 先寫 `status: "closed"` 與對應 `phase`，再跑 `close` handler                  |
| `disconnect()`／Provider 卸載 | —                                 | 有 socket 才有         | 先更新 store，再 `close`                                                      |
| 握手／取值／`new WebSocket` 失敗 | `{ type: "error" }`（無 `message`） | 無                   | 不替換既有 socket；來自已觸發重連計時器時 → `closed`／`stopped`，見 [重連](#重連) |
| `parse` 擲出                 | 有                                | 無                     | 不發 `"message"`，不關線                                                      |
| `connect()` 成功替換舊線     | 無                                | reason `"reconnect"`   | 先 `close`，再 `status: "connecting"`（`phase` 見 [重連](#重連)）             |

## 匯出型別

自 `react-ws-context` 主入口：

| 型別                     | 說明                                    |
| ------------------------ | --------------------------------------- |
| `CreateWsContextOptions` | `createWsContext` 的選項。              |
| `MaybeGetter<T>`         | `T \| (() => T)`。靜態值或同步 getter。 |
| `LivenessOptions`        | `liveness` 選項。                       |
| `WsContextValue`         | `useWsActions()` 回傳型別。             |
| `WsEvents`               | 事件名稱與回呼對應。                    |
| `WsStatus`               | WebSocket 連線狀態。                    |
| `WsPhase`                | 連線階段。                              |
| `WsState`                | 可訂閱的連線狀態。                      |

## Demo

Next.js demo：[`apps/web`](https://github.com/GaiaYang/react-ws/tree/main/apps/web)。步驟：[跑 Demo](https://github.com/GaiaYang/react-ws/blob/main/README.zh-TW.md#跑-demo)。

## 授權

[MIT License](./LICENSE)。Copyright (c) 2026 [GaiaYang](https://github.com/GaiaYang)。原始碼 [github.com/GaiaYang/react-ws](https://github.com/GaiaYang/react-ws)，套件路徑 `packages/react-ws`。

## 借鑑與致謝

未將 zustand／nanoevents 列為執行期 npm 依賴，只內嵌用到的子集。相關檔案頂部有出處備註。

- [zustand](https://github.com/pmndrs/zustand)（MIT，[pmndrs](https://github.com/pmndrs)）：外部 store 對齊 [`vanilla.ts`](https://github.com/pmndrs/zustand/blob/main/src/vanilla.ts)。React 訂閱對齊 [`react.ts`](https://github.com/pmndrs/zustand/blob/main/src/react.ts) 的 `useStore`。檔案在 `src/ws-context/store.ts`、`src/ws-context/use-store.ts`。
- [nanoevents](https://github.com/ai/nanoevents)（MIT，[Andrey Sitnik](https://github.com/ai)）：執行期對齊 [`createNanoEvents`](https://github.com/ai/nanoevents/blob/main/index.js)。檔案在 `src/ws-context/emitter.ts`、`src/ws-context/ws-events.ts`。
