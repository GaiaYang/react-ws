# react-ws-context

[![npm version](https://img.shields.io/npm/v/react-ws-context.svg)](https://www.npmjs.com/package/react-ws-context)
[![npm downloads](https://img.shields.io/npm/dm/react-ws-context.svg)](https://www.npmjs.com/package/react-ws-context)

> [English](./README.md)

`react-ws-context` 是給 React 用的 WebSocket。

## 為什麼使用

- 訊息不進 React 狀態，所以不會重繪整棵樹。
- 重連先建新 socket，成功才關舊的。
- 握手失敗不關已開的 socket。
- `liveness` 是應用層心跳（ping 與 pong）。未連線時有待送佇列。

Next.js demo 在 [`apps/web`](https://github.com/GaiaYang/react-ws/tree/main/apps/web)。步驟見 [跑 Demo](https://github.com/GaiaYang/react-ws/blob/main/README.zh-TW.md#跑-demo)。

## 環境需求

| 項目            | 需求                            |
| --------------- | ------------------------------- |
| React           | >= 18（`useSyncExternalStore`） |
| 執行期 npm 依賴 | 無                              |
| 執行環境        | `globalThis.WebSocket`          |

## 安裝

```bash
pnpm add react-ws-context react
# or: npm install react-ws-context react
# or: yarn add react-ws-context react
```

套件入口標有 `"use client"`。Next.js App Router 可以直接引用。一般 SPA 會忽略此標記。

## 快速開始

### 先建立 context

一次 `createWsContext` 會回傳 Provider 與 hooks。

```tsx
"use client";

import { createWsContext } from "react-ws-context";

export const { WsProvider, useWsActions, useWsStore, useWsEvents } =
  createWsContext({
    url: "ws://localhost:8080",
    reconnectMs: 2000,
  });
```

每次 `createWsContext` 都回傳自己的 Provider 與 hooks。兩條 socket 要呼叫兩次，例如一條業務流量、一條通知。

### 在元件裡使用

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

在 `message` 的 handler 裡，把 payload 寫進你自己的 store。

## 核心概念

一次 `createWsContext` 對應一條 socket。`WsProvider` 持有這條 socket。hooks 必須包在對應的 Provider 內。

三個 hooks 分工如下。

- [`useWsActions`](#usewsactions)：操作連線與傳送資料，不訂閱狀態。
- [`useWsStore`](#usewsstore)：訂閱連線狀態。
- [`useWsEvents`](#usewsevents)：接收訊息與 WebSocket 事件。

## API 參考

本頁說明 [`createWsContext`](#createwscontext)、[`WsProvider`](#wsprovider)、[`useWsActions`](#usewsactions)、[`useWsStore`](#usewsstore)、[`useWsEvents`](#usewsevents)、[`liveness`](#liveness)、[待送佇列](#待送佇列)、[匯出型別](#匯出型別)。

### `createWsContext`

`createWsContext(options)` 回傳綁定同一份連線設定的 `WsProvider` 與 hooks。`url` 與 `protocols` 的 getter 或靜態值，以及其他選項，都在此次呼叫固定。之後只有 `connect` 與 `disconnect` 會改連線。要換 getter，或改回靜態字串，需要再呼叫一次 `createWsContext`。

#### 基本設定

`CreateWsContextOptions`

| 欄位               | 型別                                      | 預設   | 說明                                                                        |
| ------------------ | ----------------------------------------- | ------ | --------------------------------------------------------------------------- |
| `url`              | `MaybeGetter<string>`                     | 必填   | WebSocket URL。同步 getter 在每次 `connect()` 開頭呼叫。                    |
| `protocols`        | `MaybeGetter<string \| string[]>`         | 無     | 傳入 `new WebSocket(url, protocols)`。省略時不傳第二個參數。getter 回傳的空字串會原樣傳入。 |
| `autoConnect`      | `boolean`                                 | `true` | `WsProvider` 掛載時自動連線。                                               |
| `outgoingQueueMax` | `number`                                  | `0`    | socket 未連線時的待送佇列上限。`0` 關閉佇列。                               |
| `parse`            | `(data: MessageEvent["data"]) => unknown` | 見下方 | 將原始 `MessageEvent.data` 轉成業務資料。                                   |
| `liveness`         | `LivenessOptions`                         | 無     | 應用層心跳（ping 與 pong）。省略則不啟用。                                  |

預設 `parse` 會對字串跑 `JSON.parse`，失敗則回傳原字串。非字串原樣回傳。

#### URL 與 protocols

`url` 與 `protocols` 可為靜態值或同步 getter（`MaybeGetter<T>`）。getter 在每次 `connect()` 開頭呼叫，而且必須同步。`await` 與 hook 都不能寫在 getter 裡。token 等來源由呼叫端提供，例如 `localStorage`。套件不處理 auth。

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

握手失敗的情況是 getter 擲出錯誤、URL 為空，或 `new WebSocket` 擲出錯誤。此時 `connect()` 發出 `"error"`，既有連線不受影響。`connect()` 本身不會 throw。

#### 重連

| 欄位                   | 型別     | 預設    | 說明                                                                                                                       |
| ---------------------- | -------- | ------- | -------------------------------------------------------------------------------------------------------------------------- |
| `reconnectMs`          | `number` | `0`     | 非主動斷線後，第一次重連要等的時間，單位毫秒。`0` 表示不重連。                                                             |
| `reconnectMax`         | `number` | `0`     | 非主動斷線後最多自動重連幾次。`0` 表示不限制。仍需 `reconnectMs > 0` 才會重連。                                            |
| `reconnectBackoff`     | `number` | `2`     | 下次等待放大的倍率。預設 `2` 為逐次加倍，所以是 1s、2s、4s。`1` 不放大。小於 `1` 會夾回 `1`。                              |
| `reconnectDelayMaxMs`  | `number` | `30000` | 單次等待的硬上限，單位毫秒，含抖動。`0` 表示不設上限。                                                                     |
| `reconnectJitter`      | `number` | `0.2`   | 把每次等待隨機縮短的幅度，取值 `[0, 1]`。預設 `0.2` 表示實際等待為預定時間的 80% 到 100%。`1` 為 full jitter。`0` 不抖動。 |
| `reconnectMinUptimeMs` | `number` | `5000`  | 連線需維持多久才歸零重連週期，單位毫秒。`0` 表示 `open` 即歸零。                                                           |

只要 `reconnectMs > 0`，退避與抖動就會生效。

```ts
// 從 1s 起、每次乘 2、上限 30s。
// 每次再向下隨機縮短最多 20%。
// socket 維持開啟 5s 後，reconnectAttempt 才歸零。
createWsContext({ url: "ws://localhost:8080", reconnectMs: 1000 });
```

若 server 接受連線後立刻斷線，`reconnectMinUptimeMs: 0` 會讓每次 `open` 都歸零週期。退避與 `reconnectMax` 就會停在第一階。

以下設定每次都等同一個間隔、不抖動，並在 `open` 時歸零週期。

```ts
createWsContext({
  url: "ws://localhost:8080",
  reconnectMs: 2000,
  reconnectBackoff: 1,
  reconnectJitter: 0,
  reconnectMinUptimeMs: 0,
});
```

若重連計時器已經觸發才握手失敗，自動重試會停止，`phase` 變成 `"stopped"`。自動重試不會再繼續。之後的 `connect()` 才會開新的一次嘗試。

#### 回傳值

| 名稱           | 型別                                 | 說明                           |
| -------------- | ------------------------------------ | ------------------------------ |
| `WsProvider`   | `React.FC<{ children }>`             | 持有它所包住子樹的 WebSocket。 |
| `useWsActions` | `() => WsContextValue`               | 連線操作。                     |
| `useWsStore`   | `() => WsState` 或 `(selector) => T` | 連線狀態。                     |
| `useWsEvents`  | `(type, handler) => void`            | WebSocket 事件。               |

### `WsProvider`

`WsProvider` 建立原生 `WebSocket`，並在 Provider 卸載時關閉它。

| 時機                           | 行為                                                                                                                                                                        |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 掛載且 `autoConnect: true`     | 連線。                                                                                                                                                                      |
| 卸載                           | 取消重連並歸零重連進度、停止 `liveness`、清空待送佇列。store 變為 `status: "closed"`、`phase: "idle"`。若有 socket 則關閉，並觸發 `close`，reason 為 `"provider unmount"`。 |
| `disconnect()`                 | 清理與 store 重置與卸載相同。不自動重連。若有 socket 則觸發 `close`，reason 為 `"client disconnect"`。                                                                      |
| 非主動斷線且 `reconnectMs > 0` | 以退避、上限與抖動等待後重試。`reconnectMax` 大於 `0` 時，超過次數即停止。連線維持滿 `reconnectMinUptimeMs` 才歸零週期。等待中的到期時間在 `nextReconnectAt`。              |
| `connect()` 時已有 socket      | 先建構新 socket。成功後才關閉舊的，並觸發 `close`，reason 為 `"reconnect"`。建構失敗則保留既有 socket。                                                                     |
| 握手失敗                       | 發出 `"error"`。不建立新連線，也不關閉既有連線。store 維持原狀。若重連計時器已觸發，store 變為 `status: "closed"`、`phase: "stopped"`，自動重試停止。                       |

### `useWsActions`

`useWsActions(): WsContextValue`

在對應的 `WsProvider` 外呼叫時，此 hook 會擲出 `"useWsActions 必須包在對應的 WsProvider 內"`。回傳的方法引用穩定。只呼叫此 hook 的元件不會因 store 或訊息更新而重繪。

| 方法         | 簽名                         | 說明                                                                                                                                  |
| ------------ | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `send`       | `(data) => boolean`          | 傳送原始資料（`string`、`ArrayBuffer`、`Blob` 等 `WebSocket.send` 可接受的內容）。socket 已開啟則立即送出。否則在待送佇列啟用時入隊。 |
| `sendJson`   | `(data: unknown) => boolean` | `JSON.stringify` 後呼叫 `send`。回傳值同 `send`。無法序列化時回傳 `false`。                                                           |
| `connect`    | `() => void`                 | 先取值 `url` 與 `protocols`，再建構 socket。成功後才關閉既有 socket。握手失敗見 [`createWsContext`](#createwscontext)。               |
| `disconnect` | `() => void`                 | 主動斷線。store 變為 `phase: "idle"`、`status: "closed"`。不自動重連。清空待送佇列。                                                  |
| `getStatus`  | `() => WsStatus`             | 讀取當下 `status`，不訂閱，所以呼叫端元件不會重繪。                                                                                   |

`send` 與 `sendJson` 在已送出或已入隊時回傳 `true`。佇列已滿、佇列關閉，或 `sendJson` 無法序列化時回傳 `false`。

### `useWsStore`

在對應的 `WsProvider` 外呼叫時，此 hook 會擲出 `"useWsStore 必須包在對應的 WsProvider 內"`。它用 `useSyncExternalStore` 訂閱。選取到的值與上次相同時，它會跳過重繪。

```ts
useWsStore(): WsState
useWsStore<T>(selector: (state: WsState) => T): T
```

不帶 selector 的呼叫會訂閱整份 `WsState`，所以 `nextReconnectAt` 一變，只顯示 `status` 的元件也會重繪。帶 selector 則只訂閱選出的值。

進來的訊息不在這個 store。訊息從 `useWsEvents("message", ...)` 進來。

#### `WsState`

| 欄位                 | 型別       | 說明                                                           |
| -------------------- | ---------- | -------------------------------------------------------------- |
| `status`             | `WsStatus` | 目前的 WebSocket 連線狀態。                                    |
| `phase`              | `WsPhase`  | Provider 連線階段。語意與 `status` 分開。                      |
| `reconnectAttempt`   | `number`   | 本輪已排程的自動重連次數。                                     |
| `reconnectExhausted` | `boolean`  | 自動重連已達 `reconnectMax`，且最後一次也失敗。                |
| `nextReconnectAt`    | `number`   | 下次自動重連何時到期，為 `Date.now()` 毫秒。沒在等待時為 `0`。 |

`reconnectAttempt` 為 `n` 時，代表第 n 次重連已排程或進行中。它在非主動斷線、決定要重試時增加，不是連上才增加。連線維持開啟滿 `reconnectMinUptimeMs` 後才歸零。預設是 5 秒。該選項為 `0` 時，`open` 即歸零。`disconnect()` 立刻歸零。手動 `connect()` 在不是正在等重連時立刻歸零。若正在等重連計時器，要等連上並維持開啟滿 `reconnectMinUptimeMs` 才歸零。

之後的 `connect()` 或 `disconnect()` 會把 `reconnectExhausted` 設回 `false`。

有退避與抖動時，`nextReconnectAt - Date.now()` 才是這次實際要等的時間。

`reconnectMax` 等選項在 `createWsContext` 時即固定，不會出現在 `WsState`。實際握手用的 URL 也不會寫入。UI 若要顯示「第 n 次，最多 m 次」，建立 context 時自行保存這些設定值。

#### `WsStatus`

| 值           | 意義                                             |
| ------------ | ------------------------------------------------ |
| `idle`       | 尚未連線。只出現在初始值。斷線後不會回到這個值。 |
| `connecting` | 連線中。                                         |
| `open`       | 已連線。                                         |
| `closed`     | 已斷線。                                         |

`status` 對應 WebSocket 當下的連線狀態，類似 `readyState`。`disconnect()` 後為 `status: "closed"`、`phase: "idle"`。`status` 不會回到 `idle`。連線錯誤不是一種 `WsStatus`。錯誤從 `useWsEvents("error")` 進來。原生 `error` 事件後通常緊接 `close`。

`status` 不表示 Provider 是否在自動重連週期，也不表示是否為使用者主動斷線。那些狀態在 `phase`。

#### `WsPhase`

| 值             | 意義                                                     |
| -------------- | -------------------------------------------------------- |
| `idle`         | 未連線、未排程重連。初始值，或手動 `disconnect()` 之後。 |
| `connecting`   | 首次或手動 `connect()` 進行中。                          |
| `open`         | 已連線。                                                 |
| `reconnecting` | 自動重連週期。正在等計時器，或正在連線。                 |
| `stopped`      | 不會再自動重連。                                         |

`phase` 為 `stopped` 時，若已達次數上限，`reconnectExhausted` 為 `true`。沒開重連，或重連計時器到了但握手失敗時，為 `false`。

`status` 與 `phase` 常同時變化，但語意不同。`phase === "reconnecting"` 且 `status === "closed"` 表示正在等待重連計時器。同一個 `phase` 下 `status === "connecting"` 表示計時器已觸發、正在嘗試連線。

```tsx
const phase = useWsStore((s) => s.phase);
const status = useWsStore((s) => s.status);

const canConnect = phase === "idle" || phase === "stopped";
const canDisconnect =
  phase === "open" || phase === "connecting" || phase === "reconnecting";
```

### `useWsEvents`

`useWsEvents(type, handler)`

在對應的 `WsProvider` 外呼叫時，此 hook 會擲出 `"useWsEvents 必須包在對應的 WsProvider 內"`。元件掛載時訂閱，卸載時取消訂閱。

| `type`      | 回呼                                           | 說明                               |
| ----------- | ---------------------------------------------- | ---------------------------------- |
| `"message"` | `(data: unknown, event: MessageEvent) => void` | `data` 為經 `parse` 處理後的結果。 |
| `"open"`    | `(event: Event) => void`                       | 連線建立。                         |
| `"error"`   | `(event: Event) => void`                       | socket 或握手錯誤。                |
| `"close"`   | `(event: CloseEvent) => void`                  | 連線關閉。                         |

更新回呼不會重新訂閱。變更 `type` 會重新訂閱。

非主動斷線時，Provider 會先把 store 寫成 `status: "closed"` 及對應的 `phase`，再執行 `close` 回呼。主動 `disconnect()` 與 Provider 卸載也是這個順序。Provider 先更新 store，當時有 socket 才觸發 `close`。

握手失敗會發出 `"error"`，內容為 `{ type: "error" }`，不觸發 `close`，也不替換現有 socket。

`connect()` 在新 socket 建構成功後替換既有 socket 時，先觸發 `close`，reason 為 `"reconnect"`，再將 `status` 與 `phase` 設為 `"connecting"`。

一次呼叫只訂閱一種 `type`。

## 進階行為

### `liveness`

`liveness` 是應用層心跳（ping 與 pong）。在 `createWsContext` 設定即啟用。連線建立後，Provider 會週期送出應用層 ping。它把 ping 直接寫入 socket。ping 不是 WebSocket 控制幀，也不使用待送佇列。若在 `timeoutMs` 內沒有符合條件的 pong，Provider 會關閉 socket。已啟用重連時，這次關閉可能接著重連。

`LivenessOptions`

| 欄位         | 型別                         | 說明                             |
| ------------ | ---------------------------- | -------------------------------- |
| `intervalMs` | `number`                     | ping 間隔，單位毫秒。            |
| `timeoutMs`  | `number`                     | 等待 pong 的時間，單位毫秒。     |
| `ping`       | `unknown \| (() => unknown)` | ping 內容。函式則每次呼叫一次。  |
| `isPong`     | `(data: unknown) => boolean` | 判定 parse 後的資料是否為 pong。 |

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

每一筆進來的訊息都會先經 `isPong` 判定。若為 pong 則清除逾時計時，並照常觸發 `"message"`。Provider 用 `JSON.stringify` 送出 ping，所以 ping 本體必須可轉成 JSON。

### 待送佇列

當 `outgoingQueueMax > 0` 時：

| 時機              | 行為                                       |
| ----------------- | ------------------------------------------ |
| `send` 且尚未連線 | 訊息入隊，先進先出。                       |
| 佇列已滿          | 回傳 `false`。不丟棄舊訊息。               |
| `open`            | 依序送出全部佇列。                         |
| `disconnect()`    | 清空佇列。store 重置與 `WsProvider` 相同。 |
| `WsProvider` 卸載 | 清空佇列。store 重置與 `WsProvider` 相同。 |
| 自動重連等待期間  | 保留佇列。                                 |

## 其他

### 匯出型別

自 `react-ws-context` 主入口匯出：

| 型別                     | 說明                                    |
| ------------------------ | --------------------------------------- |
| `CreateWsContextOptions` | `createWsContext` 的選項。              |
| `MaybeGetter<T>`         | `T \| (() => T)`。靜態值或同步 getter。 |
| `LivenessOptions`        | `createWsContext` 的 `liveness` 選項。  |
| `WsContextValue`         | `useWsActions()` 的回傳型別。           |
| `WsEvents`               | 事件名稱與回呼的對應。                  |
| `WsStatus`               | WebSocket 連線狀態。`WsState` 的欄位。  |
| `WsPhase`                | 連線階段。                              |
| `WsState`                | 可訂閱的連線狀態。                      |

### 授權

本套件以 [MIT License](./LICENSE) 釋出。Copyright (c) 2026 [GaiaYang](https://github.com/GaiaYang)。原始碼在 [github.com/GaiaYang/react-ws](https://github.com/GaiaYang/react-ws)，套件路徑 `packages/react-ws`。

### 借鑑與致謝

本套件未將 zustand 或 nanoevents 列為 npm 依賴。它只內嵌用到的子集。各原始碼檔案頂部亦附有出處備註。

[zustand](https://github.com/pmndrs/zustand) 為 MIT 授權，由 [pmndrs](https://github.com/pmndrs)（Poimandres）維護。外部 store API 對齊 [`vanilla.ts`](https://github.com/pmndrs/zustand/blob/main/src/vanilla.ts)，不含 middleware、replace、initializer factory。`setState` 在欄位值未變時不通知訂閱者。React 訂閱對齊 [`react.ts`](https://github.com/pmndrs/zustand/blob/main/src/react.ts) 的 `useStore`，不含 `useDebugValue`。本套件為 `useWsStore` 加上可選的 selector overload。程式在 `src/ws-context/store.ts`、`src/ws-context/use-store.ts`。

[nanoevents](https://github.com/ai/nanoevents) 為 MIT 授權，作者是 [Andrey Sitnik](https://github.com/ai)（`ai`）。型別化事件派發的執行期對齊 [`createNanoEvents`](https://github.com/ai/nanoevents/blob/main/index.js)。型別為本套件的子集。React 訂閱包裝由本套件新增。程式在 `src/ws-context/emitter.ts`、`src/ws-context/ws-events.ts`。
