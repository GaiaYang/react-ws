# react-ws-context

[![npm version](https://img.shields.io/npm/v/react-ws-context.svg)](https://www.npmjs.com/package/react-ws-context)
[![npm downloads](https://img.shields.io/npm/dm/react-ws-context.svg)](https://www.npmjs.com/package/react-ws-context)

> [English](./README.en.md)

`react-ws-context` 在 React 裡管理一條 WebSocket 的生命週期。連線狀態與事件分開處理。

```text
                       react-ws-context

WebSocket ──→ Events ─────────────→ Event handlers
    │
    └──────→ Connection state ────→ External store ──→ React
```

## 這是什麼

這是連線層。它管理一條 WebSocket 的 lifecycle：連線、斷線、重連、liveness、連線狀態。

不管訊息協定、訊息歷史、或 outgoing message queue。進來的訊息不在 `WsState`。請存在自己的 state 或 store。

## 核心概念

| 需求                | API            |
| ------------------- | -------------- |
| 傳送、連線、斷線    | `useWsActions` |
| 訂閱連線狀態        | `useWsStore`   |
| 監聽 WebSocket 事件 | `useWsEvents`  |

```text
                    WsProvider
                         │
              ┌──────────┼──────────┐
              │          │          │
           Actions      Store      Events
              │          │          │
           commands     state    notifications
              │          │          │
           connect      status      message
           send         phase       open
           disconnect   reconnect   error
                                  close
```

- `useWsActions`：對 socket 做事情（`connect`／`send`／`disconnect`）
- `useWsStore`：讀 connection state
- `useWsEvents`：接收 WebSocket events

### 一次 context 對應一條 WebSocket

一次 `createWsContext` 對應一條 WebSocket。回傳綁定該連線的 `WsProvider` 與三個 hooks。兩條 socket 呼叫兩次。hooks 必須在對應的 `WsProvider` 內。

### 套件管理什麼

- WebSocket lifecycle（掛載連線、卸載關線）
- 連線狀態（`status`／`phase`）與重連進度欄位
- 非主動斷線後的自動重連（退避、上限、抖動）
- 應用層 liveness（可選）
- `parse` 後的 `"message"`／`"error"` 事件分發

### 套件不管什麼

- 訊息協定與業務 payload 語意
- 訊息歷史（incoming messages 不在 `WsState`）
- disconnected 時暫存 outgoing messages（`send`／`sendJson` 未開啟回 `false`，不暫存）
- 驗證。token 由應用程式提供。

## 安裝

```bash
pnpm add react-ws-context react
# or: npm install react-ws-context react
# or: yarn add react-ws-context react
```

需要 React 18+。執行環境與 Next.js 說明見 [Next.js 與執行環境](#nextjs-與執行環境)。

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

`status` 與 `phase` 分開：

| 欄位     | 描述的是什麼                            |
| -------- | --------------------------------------- |
| `status` | WebSocket 連線狀態（類似 `readyState`） |
| `phase`  | Provider 連線階段，含重連               |

例如：

```ts
{
  status: "closed",
  phase: "reconnecting",
}
```

socket 已關。Provider 正在等待或進行下一次自動重連。

`phase === "reconnecting"` 且 `status === "connecting"` 時，重連計時器已觸發，正在建立 socket。

### 常見狀態組合

| `status`     | `phase`        | 意義                    |
| ------------ | -------------- | ----------------------- |
| `idle`       | `idle`         | 尚未連線                |
| `connecting` | `connecting`   | 首次或手動連線          |
| `open`       | `open`         | 已連線                  |
| `closed`     | `reconnecting` | 等待或準備自動重連      |
| `connecting` | `reconnecting` | 自動重連正在建立 socket |
| `closed`     | `stopped`      | 不再自動重連            |
| `closed`     | `idle`         | 主動斷線                |

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

`disconnect()` 後為 `status: "closed"`、`phase: "idle"`。`status` 不會回到 `idle`。

連線錯誤不是 `WsStatus`。走 `useWsEvents("error")`。原生 `error` 後通常緊接 `close`。

### `WsPhase`

| 值             | 意義                                                     |
| -------------- | -------------------------------------------------------- |
| `idle`         | 未連線、未排程重連。初始值，或手動 `disconnect()` 之後。 |
| `connecting`   | 首次或手動 `connect()` 進行中。                          |
| `open`         | 已連線。                                                 |
| `reconnecting` | 自動重連週期。正在等計時器，或正在連線。                 |
| `stopped`      | 不會再自動重連。                                         |

`phase` 為 `stopped` 時，若已達 `reconnectMax`，`reconnectExhausted` 為 `true`。

未啟用重連，或重連計時器到了但握手失敗時，為 `false`。

## 重連

非主動斷線後再開 socket，不必重掛 Provider。

### 基本行為

在 `reconnectMs > 0` 時，非主動斷線會排程重連（退避／上限／抖動）。

`reconnectMs: 0` 關閉重連。

手動 `disconnect()` 或 Provider 卸載不自動重連。

`reconnectMax: 3` 最多 3 次自動重連，不含最初的 `connect()`，也不含手動 `connect()`。

`reconnectMax: 0` 不限次數。

```text
connect()
   │
   ▼
connecting
   │
   ├── success ──→ open
   │
   └── failure（見 connect() 替換規則／建構失敗）

non-active close
   │
   ▼
reconnecting
   │
   ├── retry ──→ connecting（phase 仍為 reconnecting）
   │
   └── exhausted／不再重連 ──→ stopped
```

### 選項

在 `reconnectMs > 0` 時生效。

| 欄位                   | 預設    | 說明                                                 |
| ---------------------- | ------- | ---------------------------------------------------- |
| `reconnectBackoff`     | `2`     | 下次等待的倍率。`1` 為固定間隔                       |
| `reconnectMax`         | `0`     | 自動重連次數上限。`0` 表示不限制                     |
| `reconnectDelayMaxMs`  | `30000` | 單次等待硬上限，含抖動。`0` 表示不設上限             |
| `reconnectJitter`      | `0.2`   | 隨機縮短幅度，取值 `[0, 1]`。`0` 不抖動              |
| `reconnectMinUptimeMs` | `5000`  | 連線需維持多久才歸零重連週期。`0` 表示 `open` 即歸零 |

### 重連等待計算

第 `n` 次重連等待：

```text
reconnectMs * reconnectBackoff ** (n - 1)
```

先套用 `reconnectDelayMaxMs`，該值為 `0` 則不設上限，再乘：

```text
(1 - random * reconnectJitter)
```

`reconnectMs: 1000` 在預設設定下，排程大約 1s、再 2s、再 4s，上限 30s，每次再隨機縮短 0% 到 20%。

socket 維持開啟滿 `reconnectMinUptimeMs` 後歸零週期。

伺服器接受後立刻斷線時，請保持 `reconnectMinUptimeMs > 0`。為 `0` 時，每次 `open` 都會歸零重連週期。

若 socket 很快斷線，下一次重連會重新從第一次等待開始計算，`reconnectMax` 也會重新計數。

各欄位的 `0` 意思不同：

| 設定                   | `0` 的意思    |
| ---------------------- | ------------- |
| `reconnectMs`          | 關閉重連      |
| `reconnectMax`         | 不限重連次數  |
| `reconnectDelayMaxMs`  | 不設等待上限  |
| `reconnectMinUptimeMs` | `open` 即歸零 |
| `reconnectJitter`      | 不抖動        |

固定間隔、不抖動、每次 `open` 即歸零：

```tsx
createWsContext({
  url: "ws://localhost:8080",
  reconnectMs: 2000,
  reconnectBackoff: 1,
  reconnectJitter: 0,
  reconnectMinUptimeMs: 0,
});
```

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

先建構新 socket。成功後才關閉舊的，並觸發 `close`（reason `"reconnect"`），再將 `status` 設為 `"connecting"`。

來自已觸發的重連計時器時，`phase` 為 `"reconnecting"`。

手動 `connect()` 為 `"connecting"`。包含仍在倒數時提前連的情況。

若建構失敗是因為 getter 擲出、URL 為空、或 `new WebSocket` 擲出，發 `"error"`，保留既有 socket，`connect()` 本身不 throw。

如果呼叫來自已觸發的重連計時器，停止自動重試，store 為：

```ts
{
  status: "closed",
  phase: "stopped",
}
```

如果仍在等待重連倒數，取消該次計時器並再排下一次。提前試失敗仍繼續這一輪。

達 `reconnectMax` 則 `phase` 進入 `stopped`。之後呼叫 `connect()` 可以再次嘗試。

事件 payload 與 store／`close` 順序見 [事件 → 事件順序與失敗行為](#事件順序與失敗行為)。

### Store 欄位

#### `reconnectAttempt`

`n` 代表第 n 次重連已排程或進行中。

非主動斷線並決定重試時加一，不是連上才加。

#### `nextReconnectAt`

等待中的到期時間，單位是 `Date.now()` 毫秒。

沒有等待時為 `0`。

實際剩餘等待時間為：

```text
nextReconnectAt - Date.now()
```

#### `reconnectExhausted`

已達 `reconnectMax` 且最後一次也失敗。

之後的 `connect()` 或 `disconnect()` 清回 `false`。

### 重連週期歸零

重連週期在 socket 維持開啟滿 `reconnectMinUptimeMs` 後歸零。

預設為 `5000` ms。

`reconnectMinUptimeMs: 0` 時，`open` 即歸零。

`disconnect()` 立刻歸零。

手動 `connect()` 若不在等重連計時器，立刻歸零。若正在等，要等這次連上並撐滿 `reconnectMinUptimeMs`。

## Liveness

`liveness` 是應用層心跳，不是 WebSocket 協定層 ping/pong。

用來偵測 `readyState` 仍是開啟、但應用層已無回應的 socket。

啟用 `liveness` 後，Provider 依間隔送應用層 ping。`timeoutMs` 內沒有符合的 pong 則關閉 socket。

`reconnectMs > 0` 時，這次關閉視為非主動斷線並排程重連。

```text
ping
  ↓
WebSocket.send()
  ↓
server response
  ↓
parse()
  ↓
isPong()
```

`ping` 由應用程式提供，套件不自動 `JSON.stringify`。

`isPong` 看 `parse` 結果，回傳 `true` 才算 pong。pong 仍觸發 `"message"`。

`ping` 擲出時，該次不送，但仍開始等 pong。逾時一樣關線。

若 `ping` 同步呼叫 `disconnect()` 或成功的 `connect()`，已放棄的那次握手不會再發 `"open"`。

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

`LivenessOptions` 見 [`createWsContext`](#livenessoptions)。

## 傳送訊息

套件不會在未開啟時暫存 outgoing messages。

```text
send() / sendJson()
        │
        ├── socket open → send → true
        │
        └── socket not open → false
```

| 方法       | 行為                                                                                        |
| ---------- | ------------------------------------------------------------------------------------------- |
| `send`     | 開啟時送出並回 `true`；未開啟回 `false`，不暫存。已開啟時 `WebSocket.send` 的例外會往外傳。 |
| `sendJson` | `JSON.stringify` 後 `send`。無法序列化回 `false`；送出階段同 `send`。                       |

## 事件

### Message parsing

收到 `MessageEvent` 後先跑 `parse`：

```text
MessageEvent
    │
    ▼
  parse()
    │
    ├── throw ──→ "error"
    │              │
    │              ├── 不發 "message"
    │              └── 不關線
    │
    └── success
          │
          ▼
      "message"
```

預設 `parse` 對字串嘗試 `JSON.parse`，失敗則回傳原字串。非字串原樣回傳。

### 事件種類

| `type`      | 回呼                                           | 說明                                                                              |
| ----------- | ---------------------------------------------- | --------------------------------------------------------------------------------- |
| `"message"` | `(data: unknown, event: MessageEvent) => void` | `data` 為 `parse` 後結果。                                                        |
| `"open"`    | `(event: Event) => void`                       | 連線建立。                                                                        |
| `"error"`   | `(event: Event) => void`                       | socket、握手或 `parse` 錯誤。握手／取值失敗為 `{ type: "error" }`，不是 `Error`。 |
| `"close"`   | `(event: CloseEvent) => void`                  | 連線關閉。                                                                        |

### 訂閱行為

`useWsEvents(type, handler)`：

- 掛載時訂閱
- 卸載時取消訂閱
- 更新 handler 不重新訂閱
- 變更 `type` 才會重新訂閱
- 一次呼叫聽一種事件

handler 擲出時不向外冒泡。也不打斷連線層後續行為，例如改用新 socket 或啟動 liveness。

同一事件若有多個 handler，其中一個擲出時，同一次發送裡後面的 handler 可能跑不到。

### 事件順序與失敗行為

| 情況                             | `"error"`                           | `"close"`            | socket／store                                                                                             |
| -------------------------------- | ----------------------------------- | -------------------- | --------------------------------------------------------------------------------------------------------- |
| 非主動斷線                       | 可能有。原生 `error` 常緊接在前。   | 有                   | 先寫 `status: "closed"` 與對應 `phase`，再跑 `close` handler                                              |
| `disconnect()`／Provider 卸載    | 無                                  | 有 socket 才有       | 先更新 store，再 `close`                                                                                  |
| 握手／取值／`new WebSocket` 失敗 | `{ type: "error" }`（無 `message`） | 無                   | 不替換既有 socket。已觸發重連計時器則設為 `closed`／`stopped`。仍在等待則取消倒數並再排。見 [重連](#重連) |
| `parse` 擲出                     | 有                                  | 無                   | 不發 `"message"`，不關線                                                                                  |
| `connect()` 成功替換舊線         | 無                                  | reason `"reconnect"` | 先 `close`，再 `status: "connecting"`。`phase` 見 [重連](#重連)                                           |

## API 參考

### `createWsContext`

`createWsContext(options)` 回傳綁定同一份設定的 `WsProvider` 與 hooks。

選項在建立時固定。換設定需再呼叫一次。

#### 選項

`CreateWsContextOptions`

| 欄位                   | 型別                                      | 預設                        | 說明                                                                                          |
| ---------------------- | ----------------------------------------- | --------------------------- | --------------------------------------------------------------------------------------------- |
| `url`                  | `MaybeGetter<string>`                     | 必填                        | WebSocket URL。同步 getter 在每次 `connect()` 開頭呼叫。                                      |
| `protocols`            | `MaybeGetter<string \| string[]>`         | 無                          | 傳入 `new WebSocket(url, protocols)`。省略則不傳第二參數。getter 回傳空字串會原樣傳入。       |
| `autoConnect`          | `boolean`                                 | `true`                      | `WsProvider` 掛載時自動連線。                                                                 |
| `reconnectMs`          | `number`                                  | `0`                         | 非主動斷線後第一次重連等待（毫秒）。`0` 不重連。詳見 [重連](#重連)。                          |
| `reconnectMax`         | `number`                                  | `0`                         | 自動重連上限。`0` 不限制。仍需 `reconnectMs > 0`。                                            |
| `reconnectBackoff`     | `number`                                  | `2`                         | 下次等待倍率。`2` 加倍；`1` 不放大；小於 `1` 夾回 `1`。                                       |
| `reconnectDelayMaxMs`  | `number`                                  | `30000`                     | 單次等待硬上限（毫秒），含抖動。`0` 不設上限。                                                |
| `reconnectJitter`      | `number`                                  | `0.2`                       | 隨機縮短幅度 `[0, 1]`。預設實際等待為預定時間的 80% 到 100%。`1` 為 full jitter；`0` 不抖動。 |
| `reconnectMinUptimeMs` | `number`                                  | `5000`                      | 維持多久才歸零重連週期（毫秒）。`0` 表示 `open` 即歸零。                                      |
| `parse`                | `(data: MessageEvent["data"]) => unknown` | 見 [事件](#message-parsing) | 把原始 `MessageEvent.data` 轉成業務資料。擲出發 `"error"`，不發 `"message"`，不關線。         |
| `liveness`             | `LivenessOptions`                         | 無                          | 應用層心跳。省略則不啟用。                                                                    |

`url`／`protocols` getter 必須同步，不可 `await` 或呼叫 hooks。

套件不處理驗證。token 由應用程式提供。

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

#### `LivenessOptions`

| 欄位         | 型別                                              | 說明                                                       |
| ------------ | ------------------------------------------------- | ---------------------------------------------------------- |
| `intervalMs` | `number`                                          | ping 間隔（毫秒）。                                        |
| `timeoutMs`  | `number`                                          | 等待 pong（毫秒）。                                        |
| `ping`       | `WebSocket.send` 可接受的資料，或回傳該型別的函式 | 要送的 ping。函式則每次呼叫。                              |
| `isPong`     | `(data: unknown) => boolean`                      | 判定 parse 後是否為 pong。擲出視為不是。仍發 `"message"`。 |

#### 回傳值

| 名稱           | 型別                                 | 說明                   |
| -------------- | ------------------------------------ | ---------------------- |
| `WsProvider`   | `React.FC<{ children }>`             | 管理子樹的 WebSocket。 |
| `useWsActions` | `() => WsContextValue`               | 連線操作。             |
| `useWsStore`   | `() => WsState` 或 `(selector) => T` | 連線狀態。             |
| `useWsEvents`  | `(type, handler) => void`            | WebSocket 事件。       |

### `WsProvider`

管理子樹對應的原生 `WebSocket`。卸載時關閉。

| 時機                           | 行為                                                                                                                                         |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| 掛載且 `autoConnect: true`     | 連線。                                                                                                                                       |
| 卸載                           | 取消重連並歸零進度、停止 `liveness`。store 設為 `status: "closed"`、`phase: "idle"`。有 socket 則關線，`close` reason `"provider unmount"`。 |
| `disconnect()`                 | 清理與 store 重置同卸載。不自動重連。有 socket 則 `close` reason `"client disconnect"`。                                                     |
| 非主動斷線且 `reconnectMs > 0` | 排程重連（退避／上限／抖動）。見 [重連](#重連)。                                                                                             |
| `connect()` 已有／無 socket    | 見 [重連 → `connect()` 替換規則](#connect-替換規則)。                                                                                        |

### `useWsActions`

`useWsActions(): WsContextValue`

在對應 `WsProvider` 外呼叫時擲出：

```text
"useWsActions 必須包在對應的 WsProvider 內"
```

方法引用穩定。只呼叫它的元件不因 store 或訊息更新而重繪。

| 方法         | 簽名                         | 說明                                                                  |
| ------------ | ---------------------------- | --------------------------------------------------------------------- |
| `send`       | `(data) => boolean`          | 開啟時送出並回 `true`；未開啟回 `false`。詳見 [傳送訊息](#傳送訊息)。 |
| `sendJson`   | `(data: unknown) => boolean` | `JSON.stringify` 後 `send`。詳見 [傳送訊息](#傳送訊息)。              |
| `connect`    | `() => void`                 | 取值後建構 socket。詳見 [重連](#重連)。                               |
| `disconnect` | `() => void`                 | 主動斷線。`phase: "idle"`、`status: "closed"`。不自動重連。           |
| `getStatus`  | `() => WsStatus`             | 讀當下 `status`，不訂閱。                                             |

### `useWsStore`

`useWsStore(): WsState` 或帶 selector。

在對應 `WsProvider` 外呼叫時擲出：

```text
"useWsStore 必須包在對應的 WsProvider 內"
```

```ts
useWsStore(): WsState
useWsStore<T>(selector: (state: WsState) => T): T
```

這個 hook 使用 `useSyncExternalStore`。

不帶 selector 時訂閱整份 `WsState`。建議帶 selector。

selector 回傳值以 `Object.is` 與前次結果比較。相等則不因 store 其他欄位變更而重繪。

每次回傳新的物件或陣列會不相等，仍會重繪。

進來的訊息不在此 store。

#### `WsState`

| 欄位                 | 型別       | 說明                                                            |
| -------------------- | ---------- | --------------------------------------------------------------- |
| `status`             | `WsStatus` | WebSocket 連線狀態。見 [連線狀態](#連線狀態)。                  |
| `phase`              | `WsPhase`  | Provider 連線階段。見 [連線狀態](#連線狀態)。                   |
| `reconnectAttempt`   | `number`   | 本輪已排程的自動重連次數。見 [重連 → Store 欄位](#store-欄位)。 |
| `reconnectExhausted` | `boolean`  | 已達 `reconnectMax` 且最後一次也失敗。見同上。                  |
| `nextReconnectAt`    | `number`   | 下次自動重連到期（`Date.now()` 毫秒）。未等待為 `0`。           |

`reconnectMax` 等選項與握手 URL 不在 `WsState`。

UI 若要顯示「第 n 次／最多 m 次」，建立 context 時自行保存設定。

### `useWsEvents`

`useWsEvents(type, handler)`

在對應 `WsProvider` 外呼叫時擲出：

```text
"useWsEvents 必須包在對應的 WsProvider 內"
```

事件種類與訂閱行為見 [事件](#事件)。

## Next.js 與執行環境

- 需要 React 18+ 與 `useSyncExternalStore`。
- 沒有執行期 npm 依賴。
- 需要 `globalThis.WebSocket`。沒有時 `connect()` 不會建立連線。若該次呼叫來自已觸發的重連計時器，store 為 `status: "closed"`、`phase: "stopped"`。
- 套件入口標有 `"use client"`，給 Next.js App Router 用。一般 SPA 會忽略。

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

Next.js demo：[`apps/web`](https://github.com/GaiaYang/react-ws/tree/main/apps/web)。

## 授權

[MIT License](./LICENSE)。Copyright (c) 2026 [GaiaYang](https://github.com/GaiaYang)。

原始碼 [github.com/GaiaYang/react-ws](https://github.com/GaiaYang/react-ws)，套件路徑 `packages/react-ws`。

## 來源與致謝

未將 zustand／nanoevents 列為執行期 npm 依賴，只內嵌用到的子集。相關檔案頂部有出處備註。

- [zustand](https://github.com/pmndrs/zustand)（MIT，[pmndrs](https://github.com/pmndrs)）：外部 store 對齊 [`vanilla.ts`](https://github.com/pmndrs/zustand/blob/main/src/vanilla.ts)。React 訂閱對齊 [`react.ts`](https://github.com/pmndrs/zustand/blob/main/src/react.ts) 的 `useStore`。檔案在 `src/ws-context/store.ts`、`src/ws-context/use-store.ts`。
- [nanoevents](https://github.com/ai/nanoevents)（MIT，[Andrey Sitnik](https://github.com/ai)）：執行期對齊 [`createNanoEvents`](https://github.com/ai/nanoevents/blob/main/index.js)。檔案在 `src/ws-context/emitter.ts`、`src/ws-context/ws-events.ts`。
