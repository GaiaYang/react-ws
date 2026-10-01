# react-ws-context

[![npm version](https://img.shields.io/npm/v/react-ws-context.svg)](https://www.npmjs.com/package/react-ws-context)
[![npm downloads](https://img.shields.io/npm/dm/react-ws-context.svg)](https://www.npmjs.com/package/react-ws-context)

> [English](./README.en.md)

`react-ws-context` 用來在 React 中管理單一 WebSocket 連線的生命週期，並將**連線狀態**與**WebSocket 事件**分開處理。

- 建立與關閉連線
- 自動重連
- 連線狀態
- 重連進度
- 應用層 liveness 偵測

## 安裝

```bash
pnpm add react-ws-context react
# or: npm install react-ws-context react
# or: yarn add react-ws-context react
```

需要 React 18+。

執行環境與 Next.js 的相關說明，請參考[Next.js 與執行環境](#nextjs-與執行環境)。

## 快速開始

```tsx
"use client";

import { createWsContext } from "react-ws-context";

export const { WsProvider, useWsActions, useWsState, useWsEvents } =
  createWsContext({
    url: "ws://localhost:8080",
    reconnectMs: 2000,
  });
```

```tsx
"use client";

import { WsProvider, useWsActions, useWsState, useWsEvents } from "./ws";

export function App({ children }: { children: React.ReactNode }) {
  return <WsProvider>{children}</WsProvider>;
}

function Chat() {
  const { sendJson } = useWsActions();
  const status = useWsState((s) => s.status);
  const phase = useWsState((s) => s.phase);

  useWsEvents("message", (data) => {
    // 訊息歷史請存放在自己的 state 或 store
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

## 核心概念

每次呼叫 `createWsContext`，都會建立一組專門對應該 WebSocket 連線的 `WsProvider` 與三個 hooks。

如果應用程式需要管理兩條 WebSocket，請呼叫兩次 `createWsContext`。

這些 hooks 必須在對應的 `WsProvider` 內使用。

```text
                       react-ws-context

WebSocket ──→ Events ─────────────→ Event handlers
    │
    └──────→ Connection state ────→ External store ──→ React
```

| 需求                     | API            |
| ------------------------ | -------------- |
| 傳送訊息、建立或關閉連線 | `useWsActions` |
| 訂閱連線狀態             | `useWsState`   |
| 監聽 WebSocket 事件      | `useWsEvents`  |

- `useWsActions`：執行 WebSocket 操作，或讀取目前的連線狀態
- `useWsState`：訂閱連線狀態
- `useWsEvents`：接收 WebSocket 事件通知

### 套件負責的事項

- WebSocket 生命週期（掛載時連線、卸載時關閉）
- 連線狀態（`status`／`phase`）與重連進度
- 非主動斷線後的自動重連（退避、上限、抖動）
- 應用層 liveness（可選）
- `parse` 後的 `"message"`／`"error"` 事件分發

### 套件不負責的事項

- 訊息協定與業務 payload 的語意
- 訊息歷史。收到的訊息不會放進 `WsState`，請依照應用程式的需求，存放在自己的 state 或 store
- 斷線時暫存待送出的訊息（`send`／`sendJson` 在未連線時回傳 `false`，不會暫存）
- 驗證機制。Token 由應用程式自行提供

## 連線狀態

`useWsState` 訂閱 `WsState`，狀態改變時重新渲染。`useWsActions()` 的 `getState()` 取得呼叫當下的 `WsState`，不會建立訂閱。

欄位如下：

- `status`
- `phase`
- `reconnectAttempt`
- `reconnectExhausted`
- `nextReconnectAt`

重連相關欄位的詳細說明，請參考[重連 → Store 欄位](#store-欄位)。

`status` 與 `phase` 分別描述不同層級的狀態：

| 欄位     | 描述                                          |
| -------- | --------------------------------------------- |
| `status` | WebSocket 本身的連線狀態（類似 `readyState`） |
| `phase`  | Provider 目前所處的連線階段，包含自動重連狀態 |

例如：

```ts
{
  status: "closed",
  phase: "reconnecting",
}
```

代表目前 WebSocket 已關閉，但 Provider 正在等待下一次自動重連，或準備建立新的連線。

### 常見狀態組合

| `status`     | `phase`        | 意義                   |
| ------------ | -------------- | ---------------------- |
| `idle`       | `idle`         | 尚未建立連線           |
| `connecting` | `connecting`   | 首次連線或手動連線中   |
| `open`       | `open`         | 已連線                 |
| `closed`     | `reconnecting` | 等待或準備進行自動重連 |
| `connecting` | `reconnecting` | 正在進行自動重連       |
| `closed`     | `stopped`      | 不會再進行自動重連     |
| `closed`     | `idle`         | 主動關閉連線           |

當 `phase === "reconnecting"` 且 `status === "connecting"` 時，表示重連計時器已到期，目前正在建立新的 WebSocket 連線。

例如：

```tsx
const canConnect = useWsState(
  (s) => s.phase === "idle" || s.phase === "stopped",
);
```

### `WsStatus`

| 值           | 意義                                                     |
| ------------ | -------------------------------------------------------- |
| `idle`       | 尚未建立連線。只會出現在初始狀態，斷線後不會回到此狀態。 |
| `connecting` | 正在建立連線。                                           |
| `open`       | WebSocket 已連線。                                       |
| `closed`     | WebSocket 已關閉。                                       |

呼叫 `disconnect()` 後，狀態會變成：

```ts
{
  status: "closed",
  phase: "idle",
}
```

`status` 不會回到 `idle`。

連線錯誤不屬於 `WsStatus`，而是透過 `useWsEvents("error")` 通知。

原生 WebSocket 發生 `"error"` 後，通常會緊接著觸發 `"close"`。

### `WsPhase`

| 值             | 意義                                                                               |
| -------------- | ---------------------------------------------------------------------------------- |
| `idle`         | 尚未建立連線，且沒有排程中的重連。也是初始狀態，以及手動 `disconnect()` 後的狀態。 |
| `connecting`   | 首次連線或手動 `connect()` 正在建立連線。                                          |
| `open`         | WebSocket 已連線。                                                                 |
| `reconnecting` | 正在進行自動重連，包括等待計時器到期或正在建立新的連線。                           |
| `stopped`      | 不會再進行自動重連。                                                               |

當 `phase` 為 `stopped` 時，如果已達到 `reconnectMax`，`reconnectExhausted` 會是 `true`。

`reconnectExhausted` 只有在已達到 `reconnectMax`，且最後一次自動重連也失敗時才會是 `true`；其他情況皆為 `false`。

## 傳送訊息

套件不會在 WebSocket 尚未連線時暫存待送出的訊息。

```text
send() / sendJson()
        │
        ├── socket open → send → true
        │
        └── socket not open → false
```

| 方法       | 行為                                                                                                                                                |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `send`     | WebSocket 已連線時送出資料並回傳 `true`；尚未連線時回傳 `false`，不會暫存。WebSocket 已連線時，如果 `WebSocket.send` 擲出例外，例外會直接往外拋出。 |
| `sendJson` | 先呼叫 `JSON.stringify`，再執行 `send`。如果資料無法序列化，回傳 `false`；成功序列化後的傳送行為與 `send` 相同。                                    |

## 事件

### 訊息解析

收到 `MessageEvent` 後，會先交給 `parse`：

```text
MessageEvent
    │
    ▼
  parse()
    │
    ├── throw ──→ "error"
    │              │
    │              ├── 不觸發 "message"
    │              └── 不關閉 WebSocket
    │
    └── success
          │
          ▼
      "message"
```

預設的 `parse` 行為：

- 字串會嘗試使用 `JSON.parse`
- 如果 JSON 解析失敗，則回傳原始字串
- 非字串資料則原樣回傳

若 `parse` 同步呼叫 `disconnect()` 或 `connect()`，返回時這顆 socket 已不是現役，就不會觸發 `"message"`。斷線後沒有新 socket 接手時，接著擲出仍會觸發 `"error"`。`connect()` 已換線之後的擲出，不會算到新 socket 的 `"error"`。

### 事件種類

| `type`      | 回呼                                           | 說明                                                                                                                                                                                                                            |
| ----------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `"message"` | `(data: unknown, event: MessageEvent) => void` | `data` 是經過 `parse` 處理後的結果。                                                                                                                                                                                            |
| `"open"`    | `(event: Event) => void`                       | WebSocket 連線建立成功。                                                                                                                                                                                                        |
| `"error"`   | `(event) => void`                              | 原生 WebSocket 的 `"error"` 傳入原本的 `Event`。空 URL、getter、`new WebSocket()` 或 `parse` 失敗傳入 `{ type: "error", source: "construct" \| "parse", message, cause }`，不是 `Error`。空 URL 的 `message` 是 `"empty url"`。 |
| `"close"`   | `(event: CloseEvent) => void`                  | WebSocket 連線關閉。                                                                                                                                                                                                            |

### 訂閱行為

`useWsEvents(type, handler)` 的行為如下：

- 元件掛載時訂閱
- 元件卸載時取消訂閱
- `handler` 更新時不會重新訂閱
- `type` 改變時才會重新訂閱
- 每次呼叫只能監聽一種事件

如果 handler 擲出例外，例外不會往外拋出，也不會中斷連線層後續處理，例如替換 WebSocket 或啟動 liveness。

單一 handler 的例外不會影響其他訂閱者，也不會中斷連線層。例外會由 `console.error` 留下。

### 事件順序與失敗行為

| 情況                                   | `"error"`                                         | `"close"`                       | WebSocket／store                                                                                                                                                                                                                                                                  |
| -------------------------------------- | ------------------------------------------------- | ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 非主動斷線                             | 可能觸發。原生 WebSocket 通常會先觸發 `"error"`。 | 會觸發                          | 先更新 `status: "closed"` 與對應的 `phase`，再執行 `"close"` handler                                                                                                                                                                                                              |
| `disconnect()`／Provider 卸載          | 不會觸發                                          | WebSocket 存在時會觸發          | 先更新 store，再關閉 WebSocket                                                                                                                                                                                                                                                    |
| 握手／設定值取得／`new WebSocket` 失敗 | 會觸發，參數帶 `source`、`message`、`cause`       | 不會觸發                        | 不會替換既有 WebSocket。已觸發的自動重連計時器若失敗，未達 `reconnectMax` 會再排且 phase 維持 `reconnecting`；達到上限才設為 `closed`／`stopped`，且 `reconnectExhausted` 為 `true`。仍在等待則以同一個 `reconnectAttempt` 再排。詳見[重連](#重連)。                              |
| `parse` 擲出例外                       | 會觸發                                            | 不會觸發                        | 不會觸發 `"message"`，也不會關閉 WebSocket                                                                                                                                                                                                                                        |
| `connect()` 成功替換舊連線             | 不會觸發                                          | 會觸發，reason 為 `"reconnect"` | `"close"` 回呼前 `status` 已是 `closed`（不是 `open`），所以 `send` 回 `false`。回呼返回後，若這次 `connect()` 仍擁有這顆 socket，`status` 才變成 `"connecting"`。回呼裡的 `connect()` 若建構失敗，已建好的那顆會留下。詳見[重連 → `connect()` 的替換規則](#connect-的替換規則)。 |

## 重連

WebSocket 非主動斷線後，如果啟用自動重連，會自動建立新的連線，不需要重新掛載 `WsProvider`。

### 基本行為

當 `reconnectMs > 0` 時，非主動斷線會排程自動重連，並依設定套用退避、次數上限與抖動。

`reconnectMs: 0` 會停用自動重連。

手動 `disconnect()` 或 `WsProvider` 卸載時，不會觸發自動重連。

`reconnectMax: 3` 代表最多進行 3 次自動重連，不包含最初的 `connect()`，也不包含手動呼叫的 `connect()`。

`reconnectMax: 0` 代表不限制自動重連次數。

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

以下設定只有在 `reconnectMs > 0` 時才會生效。

| 欄位                   |  預設值 | 說明                                                                         |
| ---------------------- | ------: | ---------------------------------------------------------------------------- |
| `reconnectBackoff`     |     `2` | 下一次等待時間的倍率。`1` 代表固定間隔。                                     |
| `reconnectMax`         |     `0` | 自動重連次數上限。`0` 代表不限制。                                           |
| `reconnectDelayMaxMs`  | `30000` | 單次等待時間的上限，包含抖動。`0` 代表不設上限。                             |
| `reconnectJitter`      |   `0.2` | 隨機縮短等待時間的幅度，範圍為 `[0, 1]`。`0` 代表不使用抖動。                |
| `reconnectMinUptimeMs` |  `5000` | WebSocket 必須維持開啟多久，才會將重連週期歸零。`0` 代表連線成功後立即歸零。 |

### 重連等待時間

第 `n` 次自動重連的基礎等待時間為：

```text
reconnectMs * reconnectBackoff ** (n - 1)
```

接著先套用 `reconnectDelayMaxMs`。

如果 `reconnectDelayMaxMs` 為 `0`，則不設定等待時間上限。

最後套用抖動：

```text
(1 - random * reconnectJitter)
```

例如：

```ts
reconnectMs: 1000;
```

搭配預設設定時，等待時間大約會是：

```text
1 秒 → 2 秒 → 4 秒 → ...
```

每次等待時間最高不超過 30 秒，並會隨機縮短 0%～20%。

各設定值為 `0` 時的意義不同：

| 設定                   | `0` 的意思                   |
| ---------------------- | ---------------------------- |
| `reconnectMs`          | 停用自動重連                 |
| `reconnectMax`         | 不限制自動重連次數           |
| `reconnectDelayMaxMs`  | 不設定等待時間上限           |
| `reconnectMinUptimeMs` | 連線成功後立即將重連週期歸零 |
| `reconnectJitter`      | 不使用抖動                   |

如果希望使用固定間隔、不使用抖動，並在每次連線成功後立即歸零：

```tsx
createWsContext({
  url: "ws://localhost:8080",
  reconnectMs: 2000,
  reconnectBackoff: 1,
  reconnectJitter: 0,
  reconnectMinUptimeMs: 0,
});
```

### `connect()` 的替換規則

自動重連與手動 `connect()` 使用相同的 socket 替換機制：

```text
existing socket
      │
      │ connect() / reconnect
      ▼
create new socket
      │
      ├── failure → 保留既有 socket
      │
      └── success → 替換既有 socket
```

新的 WebSocket 會先建立。

只有在新 WebSocket 建構成功後，才會關閉舊的 WebSocket。`"close"` 回呼執行前，`status` 已是 `closed`，不是 `open`，所以 `send` 回 `false`。reason 為 `"reconnect"`。這次 close 仍屬於舊線。

回呼返回後，若這次 `connect()` 仍擁有這次嘗試，`status` 才變成 `"connecting"`。若回呼裡的 `connect()` 在建立 socket 前就失敗，這次 `connect()` 已經建好的 socket 會留下並進入 `connecting`。回呼裡的 `disconnect()` 仍然優先。

如果 `connect()` 是由已觸發的自動重連計時器執行，`phase` 會維持為 `"reconnecting"`。

手動呼叫 `connect()` 時，`phase` 會是 `"connecting"`，即使原本正在等待自動重連，也會切換為手動連線流程。

如果建立 WebSocket 時發生錯誤，例如：

- URL getter 擲出例外
- URL 為空
- `new WebSocket()` 擲出例外

則會觸發 `"error"` 事件（`source` 為 `"construct"`，並帶 `message` 與 `cause`），但 `connect()` 本身不會 throw。

此時既有 WebSocket 會維持不變。

如果這次呼叫來自**已觸發的自動重連計時器**，這次嘗試算失敗，並沿用自動重連的排程。未達 `reconnectMax` 時會再用同一套退避排下一次，`phase` 維持 `reconnecting`。`reconnectMax` 為 `0` 時會一直排。達到上限時 store 變成：

```ts
{
  status: "closed",
  phase: "stopped",
}
```

此時 `reconnectExhausted` 為 `true`。

如果仍在等待自動重連計時器，則會取消目前的計時器，並以同一個 `reconnectAttempt` 重新排程。手動失敗不計入 `reconnectMax`。

若這次手動 `connect()` 取代的是等待中的計時器，而新的握手在 `open` 之前關閉，會以同一個 `reconnectAttempt` 再排。`reconnectExhausted` 維持 `false`。

也就是說，提前呼叫 `connect()` 失敗後，這一輪自動重連仍會繼續。

當達到 `reconnectMax` 時，`phase` 會變成 `stopped`。

之後仍可透過 `connect()` 手動再次嘗試連線。

事件 payload，以及 store 與 `"close"` 事件的觸發順序，請參考[事件 → 事件順序與失敗行為](#事件順序與失敗行為)。

### Store 欄位

#### `reconnectAttempt`

`n` 代表第 `n` 次自動重連已經排程或正在進行。

在非主動斷線並決定進行重連時就會加一，而不是等到成功連線後才增加。

#### `nextReconnectAt`

下一次自動重連的預定時間，單位為 `Date.now()` 的毫秒時間戳。

沒有等待中的重連時為 `0`。

實際剩餘等待時間可以透過以下方式計算：

```text
nextReconnectAt - Date.now()
```

#### `reconnectExhausted`

表示已達到 `reconnectMax`，且最後一次自動重連也失敗。

之後呼叫 `connect()` 或 `disconnect()` 都會將此欄位重設為 `false`。

### 重連週期歸零

當 WebSocket 持續連線達到 `reconnectMinUptimeMs` 後，重連週期會歸零。

預設值為 `5000` ms。

當 `reconnectMinUptimeMs: 0` 時，WebSocket 觸發 `open` 後立即歸零。

`reconnectMinUptimeMs` 不是有限數時，沿用預設 `5000`。不會在 `open` 當下歸零，穩定連線也不會永遠留著上一輪的次數。

如果伺服器接受連線後立即斷線，建議保持 `reconnectMinUptimeMs > 0`。

還沒歸零就斷線時，下一次仍沿用這一輪的等待與 `reconnectMax`。只有已經歸零之後再斷線，才會從第一次等待重新計算。

`disconnect()` 會立即將重連週期歸零。

手動 `connect()` 如果目前沒有等待中的自動重連計時器，也會立即將重連週期歸零。

如果目前正在等待自動重連，則會等這次連線成功，並持續連線達到 `reconnectMinUptimeMs` 後才歸零。

## Liveness

`liveness` 是**應用層心跳機制**，不是 WebSocket 協定層的 ping/pong。

它可以用來偵測 WebSocket `readyState` 仍為開啟，但應用層實際上已經沒有回應的情況。

啟用 `liveness` 後，Provider 會依指定的時間間隔送出應用層 ping。

如果在 `timeoutMs` 內沒有收到符合條件的 pong，會立刻把這條連線當成非主動斷線：store 離開 `open`，並送出 `"close"`（reason 為 `"liveness timeout"`）。這一步不等瀏覽器的關閉握手。

當 `reconnectMs > 0` 時，這次關閉會排自動重連。

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

`ping` 由應用程式自行提供，套件不會自動呼叫 `JSON.stringify`。

`isPong` 會檢查 `parse` 的結果，只有回傳 `true` 才會視為 pong。

即使訊息被判定為 pong，仍然會觸發 `"message"` 事件。

如果 `ping` 擲出例外，該次 ping 不會送出，但仍會開始等待 pong。

`intervalMs` 與 `timeoutMs` 必須是大於 `0` 的有限數。`0`、負數、非有限數不會送 ping，也不會關閉 socket。`"open"` 仍會觸發，接著觸發 `"error"`，`source` 為 `"construct"`，`message` 為 `"invalid liveness"`。

`intervalMs` 與 `timeoutMs` 都是大於 `0` 的有限數時，超過 `timeoutMs` 仍未收到符合條件的 pong，WebSocket 會被關閉。

socket 已經 open 時會先觸發 `"open"`，再送出第一個 ping。若這個 ping 同步 `disconnect()`，順序是 `"open"` 然後 close（reason 為 `"client disconnect"`），而且不會送出 ping。若同步 `connect()` 換線，已 open 的那顆仍會先 `"open"`，接著 close reason 為 `"reconnect"`。進入 `onopen` 時已經不是現役的握手，以及換上去、尚未 open 的那顆，不會觸發 `"open"`。

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

`LivenessOptions` 的完整說明請參考 [`createWsContext`](#createwscontext)。

## API 參考

### `createWsContext`

`createWsContext(options)` 會回傳與同一份設定綁定的 `WsProvider` 與三個 hooks。

建立後設定即固定。

如果需要使用不同設定，請再次呼叫 `createWsContext` 建立另一個 Context。

#### 選項

`CreateWsContextOptions`

| 欄位                   | 型別                                      | 預設值                  | 說明                                                                                                                      |
| ---------------------- | ----------------------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `url`                  | `MaybeGetter<string>`                     | 必填                    | WebSocket URL。同步 getter 會在每次 `connect()` 開始時呼叫。                                                              |
| `protocols`            | `MaybeGetter<string \| string[]>`         | 無                      | 傳入 `new WebSocket(url, protocols)`。未設定時不傳入第二個參數。getter 回傳空字串時會原樣傳入。                           |
| `autoConnect`          | `boolean`                                 | `true`                  | `WsProvider` 掛載時是否自動建立連線。                                                                                     |
| `connectTimeoutMs`     | `number`                                  | `0`                     | 握手停在 `CONNECTING` 超過這個時間（毫秒）就關閉，reason 為 `"connect timeout"`。`0`、非有限數、負數都代表關閉。          |
| `reconnectMs`          | `number`                                  | `0`                     | 非主動斷線後第一次自動重連的等待時間（毫秒）。`0` 代表停用自動重連。                                                      |
| `reconnectMax`         | `number`                                  | `0`                     | 自動重連次數上限。`0` 代表不限制。只有在 `reconnectMs > 0` 時才會生效。                                                   |
| `reconnectBackoff`     | `number`                                  | `2`                     | 下一次等待時間的倍率。`2` 代表加倍，`1` 代表固定間隔，小於 `1` 的值會限制為 `1`。                                         |
| `reconnectDelayMaxMs`  | `number`                                  | `30000`                 | 單次等待時間的上限（毫秒），包含抖動。`0` 代表不設上限。                                                                  |
| `reconnectJitter`      | `number`                                  | `0.2`                   | 隨機縮短等待時間的幅度，範圍為 `[0, 1]`。預設會將實際等待時間隨機縮短 0%～20%。`1` 代表 full jitter，`0` 代表不使用抖動。 |
| `reconnectMinUptimeMs` | `number`                                  | `5000`                  | WebSocket 需要維持開啟多久才會將重連週期歸零（毫秒）。`0` 代表 `open` 後立即歸零。非有限數沿用這個預設。                  |
| `parse`                | `(data: MessageEvent["data"]) => unknown` | 見[訊息解析](#訊息解析) | 將原始 `MessageEvent.data` 轉換為應用程式資料。擲出例外時會觸發 `"error"`，不會觸發 `"message"`，也不會關閉 WebSocket。   |
| `liveness`             | `LivenessOptions`                         | 無                      | 應用層心跳機制。未設定時不會啟用。                                                                                        |

`url` 與 `protocols` 的 getter 必須同步執行，不可使用 `await` 或呼叫 hooks。若 getter 同步呼叫 `disconnect()` 或 `connect()`，以那次呼叫為準。

`connectTimeoutMs` 大於 0 時，這顆 socket 成為現役且仍在 `CONNECTING` 時開始計時。`open`、`disconnect()`、卸載、連線關閉，以及成功換線都會清掉。逾時走與其他非主動斷線相同的關閉路徑。`reconnectMs` 為 0 時仍會關線，phase 變成 `stopped`。

套件不負責驗證機制，Token 請由應用程式自行提供。

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

`connect()` 的建構失敗行為請參考[重連 → `connect()` 的替換規則](#connect-的替換規則)。

#### `LivenessOptions`

| 欄位         | 型別                                              | 說明                                                                                    |
| ------------ | ------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `intervalMs` | `number`                                          | Ping 的發送間隔（毫秒）。                                                               |
| `timeoutMs`  | `number`                                          | 等待 Pong 的時間（毫秒）。                                                              |
| `ping`       | `WebSocket.send` 可接受的資料，或回傳該型別的函式 | 要送出的 Ping。若提供函式，則每次送出前都會呼叫。                                       |
| `isPong`     | `(data: unknown) => boolean`                      | 判斷 `parse` 後的資料是否為 Pong。若擲出例外，會視為不是 Pong，但仍會觸發 `"message"`。 |

#### 回傳值

| 名稱           | 型別                                 | 說明                             |
| -------------- | ------------------------------------ | -------------------------------- |
| `WsProvider`   | `React.FC<{ children }>`             | 管理子元件樹所使用的 WebSocket。 |
| `useWsActions` | `() => WsActions`                    | 提供 WebSocket 操作。            |
| `useWsState`   | `() => WsState` 或 `(selector) => T` | 訂閱 WebSocket 連線狀態。        |
| `useWsEvents`  | `(type, handler) => void`            | 訂閱 WebSocket 事件。            |

### `WsProvider`

`WsProvider` 管理其子元件樹所使用的原生 `WebSocket`。

| 時機                           | 行為                                                                                                                                                                |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 掛載且 `autoConnect: true`     | 建立 WebSocket 連線。                                                                                                                                               |
| 卸載                           | 取消自動重連、重設重連進度、停止 `liveness`。store 設為 `status: "closed"`、`phase: "idle"`。如果存在 WebSocket，則關閉連線，close reason 為 `"provider unmount"`。 |
| `disconnect()`                 | 執行與卸載相同的清理與 store 重設，不會觸發自動重連。如果存在 WebSocket，則使用 `"client disconnect"` 作為 close reason。                                           |
| 非主動斷線且 `reconnectMs > 0` | 排程自動重連（退避／上限／抖動）。詳見[重連](#重連)。                                                                                                               |
| `connect()` 已有／無 WebSocket | 依[重連 → `connect()` 的替換規則](#connect-的替換規則)處理。                                                                                                        |

### `useWsActions`

`useWsActions(): WsActions`

只有使用 `useWsActions` 的元件，不會因為 store 或訊息更新而重新渲染。

```tsx
const { getState, sendJson } = useWsActions();

function ping() {
  if (getState().status !== "open") return;
  sendJson({ type: "ping" });
}
```

| 方法         | 簽名                         | 說明                                                                                       |
| ------------ | ---------------------------- | ------------------------------------------------------------------------------------------ |
| `send`       | `(data) => boolean`          | WebSocket 已連線時送出資料並回傳 `true`；未連線時回傳 `false`。詳見[傳送訊息](#傳送訊息)。 |
| `sendJson`   | `(data: unknown) => boolean` | 先使用 `JSON.stringify` 序列化，再執行 `send`。詳見[傳送訊息](#傳送訊息)。                 |
| `connect`    | `() => void`                 | 取得設定後建立 WebSocket。詳見[重連 → `connect()` 的替換規則](#connect-的替換規則)。       |
| `disconnect` | `() => void`                 | 主動關閉 WebSocket。狀態會變成 `phase: "idle"`、`status: "closed"`，且不會觸發自動重連。   |
| `getState`   | `() => WsState`              | 取得呼叫當下的 `WsState`，不會建立訂閱。                                                   |

### `useWsState`

`useWsState(): WsState` 或帶 selector 的版本：

```ts
useWsState(): WsState
useWsState<T>(selector: (state: WsState) => T): T
```

這個 hook 使用 React 的 `useSyncExternalStore`。

不使用 selector 時，會訂閱整份 `WsState`；建議使用 selector，只訂閱元件真正需要的欄位。

selector 的回傳值會使用 `Object.is` 與前一次結果比較。

因此，建議回傳基本型別，或確保每次回傳的值都維持相同參照。

如果每次都建立新的物件或陣列，React 會將它視為不同的值並觸發重新渲染，甚至可能造成元件陷入無限更新。

套件不會替 selector 結果進行 shallow compare。

收到的訊息不會存放在此 store。

#### `WsState`

| 欄位                 | 型別       | 說明                                                                               |
| -------------------- | ---------- | ---------------------------------------------------------------------------------- |
| `status`             | `WsStatus` | WebSocket 本身的連線狀態。詳見[連線狀態](#連線狀態)。                              |
| `phase`              | `WsPhase`  | Provider 目前的連線階段。詳見[連線狀態](#連線狀態)。                               |
| `reconnectAttempt`   | `number`   | 本輪已排程的自動重連次數。詳見[重連 → Store 欄位](#store-欄位)。                   |
| `reconnectExhausted` | `boolean`  | 是否已達 `reconnectMax` 且最後一次重連失敗。詳見[重連 → Store 欄位](#store-欄位)。 |
| `nextReconnectAt`    | `number`   | 下一次自動重連的預定時間（`Date.now()` 毫秒時間戳）。沒有等待中的重連時為 `0`。    |

`reconnectMax` 等設定，以及 WebSocket URL，都不會放在 `WsState` 中。

如果 UI 需要顯示「第 n 次／最多 m 次」，請在建立 Context 時自行保存相關設定。

### `useWsEvents`

`useWsEvents(type, handler)`

事件種類與訂閱行為請參考[事件](#事件)。

## Next.js 與執行環境

- 需要 React 18+ 與 `useSyncExternalStore`。
- 沒有執行期 npm 依賴。
- 需要 `globalThis.WebSocket`。
- 如果執行環境沒有 `WebSocket`，`connect()` 不會建立連線，並觸發 `"error"`（`source` 為 `"construct"`，`message` 為 `"WebSocket is undefined"`）。
- 沒有現役 socket 時，包含第一次 `connect()` 與已觸發的自動重連計時器，store 會變成 `status: "closed"`、`phase: "stopped"`。已有 socket 則維持不變。
- 套件入口包含 `"use client"`，適用於 Next.js App Router；一般 SPA 則會忽略此設定。

## 匯出型別

`react-ws-context` 主入口提供以下型別：

| 型別                     | 說明                                                             |
| ------------------------ | ---------------------------------------------------------------- |
| `CreateWsContextOptions` | `createWsContext` 的設定選項。                                   |
| `MaybeGetter<T>`         | `T \| (() => T)`，可提供靜態值或同步 getter。                    |
| `LivenessOptions`        | `liveness` 的設定。                                              |
| `WsActions`              | `useWsActions()` 的回傳型別。                                    |
| `WsEvents`               | 事件名稱與回呼的對應型別。                                       |
| `WsStatus`               | WebSocket 連線狀態。                                             |
| `WsPhase`                | Provider 的連線階段。                                            |
| `WsState`                | 連線狀態。`useWsState` 訂閱此值，`getState()` 讀取呼叫當下的值。 |

## Demo

Next.js demo：[apps/web](https://github.com/GaiaYang/react-ws/tree/main/apps/web)。

## 授權

[MIT License](./LICENSE)。

Copyright (c) 2026 [GaiaYang](https://github.com/GaiaYang)。

原始碼：[github.com/GaiaYang/react-ws](https://github.com/GaiaYang/react-ws)

套件位於 `packages/react-ws`。

## 來源與致謝

本套件沒有將 zustand／nanoevents 列為執行期 npm 依賴，而是僅內嵌實際使用到的部分。

相關檔案頂部皆有來源備註。

- [zustand](https://github.com/pmndrs/zustand)（MIT，[pmndrs](https://github.com/pmndrs)）：外部 store 的實作參考 [`vanilla.ts`](https://github.com/pmndrs/zustand/blob/main/src/vanilla.ts)；React 訂閱機制參考 [`react.ts`](https://github.com/pmndrs/zustand/blob/main/src/react.ts) 的 `useStore`。相關檔案為 `src/core/store.ts`、`src/react/use-store.ts`。
- [nanoevents](https://github.com/ai/nanoevents)（MIT，[Andrey Sitnik](https://github.com/ai/nanoevents)）：事件系統的實作參考 [`createNanoEvents`](https://github.com/ai/nanoevents)。相關檔案為 `src/core/emitter.ts`、`src/react/ws-events.ts`。
