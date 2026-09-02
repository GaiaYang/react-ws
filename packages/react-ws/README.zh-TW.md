# react-ws-context

[![npm version](https://img.shields.io/npm/v/react-ws-context.svg)](https://www.npmjs.com/package/react-ws-context)
[![npm downloads](https://img.shields.io/npm/dm/react-ws-context.svg)](https://www.npmjs.com/package/react-ws-context)

> **English:** [README.md](./README.md)

React 用的 **WebSocket 連線層**套件。將連線生命週期、可訂閱狀態與訊息事件分離，避免連線狀態或高頻訊息更新拖垮整棵元件樹。

> **維護者：** [GaiaYang](https://github.com/GaiaYang)  
> **原始碼：** [github.com/GaiaYang/react-ws](https://github.com/GaiaYang/react-ws)（monorepo 內路徑 `packages/react-ws`）

## 特性

- **零執行期依賴** — 僅需 `react >= 18`（peer 依賴）
- **策略凍結** — `url`／`protocols` 的 getter（或靜態值）與其餘選項在 `createWsContext` 時固定；每次握手才取值。執行期 API 仍只有 `connect`／`disconnect`
- **渲染隔離** — 連線層狀態（健康／重連）以 `useWsStore` 訂閱；訊息以 `useWsEvents` 訂閱（不寫入 React 狀態）
- **可選探活** — 週期性 ping／pong 偵測，逾時主動關閉 socket（若已啟用重連則可能觸發）
- **可選待送佇列** — socket 未連線時暫存待送訊息，連線成功後依序送出

## 環境需求

| 項目     | 版本                                              |
| -------- | ------------------------------------------------- |
| React    | >= 18（依賴 `useSyncExternalStore`）              |
| 執行環境 | 瀏覽器 Client Component（需原生 `WebSocket` API） |

套件入口標有 `"use client"`。呼叫 `createWsContext` 的模組，以及使用其 hooks 的元件，皆須位於 Client 邊界內。

## 安裝

```bash
pnpm add react-ws-context react
# or: npm install react-ws-context react
# or: yarn add react-ws-context react
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

`url`／`protocols` 可為靜態值或**同步 getter**（`MaybeGetter<T>`）。getter 在 `createWsContext` 時固定，每次 `connect()` 開頭同步呼叫（手動、`autoConnect`、重連計時器同一條路）。不要 `await`，也不要在 getter 裡用 hook。來源由呼叫端提供（例如 `localStorage`）；套件不負責 auth——何時 `connect()`／`disconnect()` 由呼叫端決定。

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

getter 丟出、取值後的 URL 為 `""`、或 `new WebSocket` 同步 throw（不合法 URL）時，`connect()` 會 emit `"error"`，不開新線、不拆現有線；`connect()` 本身不 throw。若重連計時器已經觸發，store 會變成 `status: "closed"`、`phase: "stopped"`（不再自動重試）。修好同步來源後再手動 `connect()`。要換 getter 或改回靜態字串，請再 `createWsContext` 一次。

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
        ├── WsProvider      管理 WebSocket 實例、重連、探活、待送佇列
        ├── useWsActions()  連線操作（send / connect / disconnect / getStatus），不觸發重繪
        ├── useWsStore()    訂閱連線層狀態：健康／重連
        └── useWsEvents()   訂閱 open / message / error / close 事件
```

- **同一應用可多次呼叫 `createWsContext`**，每次產生一組互不共用的 Provider 與 hooks（例如同時連業務 WS 與通知 WS）。
- **`WsState` 只放連線層、低頻欄位** — 連線健康（`status`、`phase`）、重連進度（`reconnectAttempt`、`reconnectExhausted`）。**不放**訊息內容或業務資料。
- **訊息與錯誤事件** — 請用 `useWsEvents`；訊息歷史請自行寫入 React 狀態、快取或自有狀態管理。
- **連線錯誤不反映在 `WsStatus`** — 請用 `useWsEvents("error", …)` 處理；原生 `error` 事件後通常緊接 `close`。

---

## API 參考

### `createWsContext(options)`

建立一組綁定同一連線設定的 `WsProvider` 與 hooks。

#### 參數：`CreateWsContextOptions`

| 欄位               | 型別                                      | 預設     | 說明                                                                                        |
| ------------------ | ----------------------------------------- | -------- | ------------------------------------------------------------------------------------------- |
| `url`              | `MaybeGetter<string>`                     | （必填） | WebSocket 連線網址；同步 getter 在每次 `connect()` 開頭呼叫                                 |
| `protocols`        | `MaybeGetter<string \| string[]>`         | —        | 傳入 `new WebSocket(url, protocols)`；省略此選項則不傳第二參數。getter 回傳空字串會原樣傳入 |
| `autoConnect`      | `boolean`                                 | `true`   | WsProvider 載入時是否自動連線                                                               |
| `reconnectMs`      | `number`                                  | `0`      | 非主動斷線後的重連間隔（毫秒）；`0` 表示不重連                                              |
| `reconnectMax`     | `number`                                  | `0`      | 非主動斷線後最多自動重連幾次；`0` 不限制（需 `reconnectMs > 0`）                            |
| `outgoingQueueMax` | `number`                                  | `0`      | socket 未連線時的待送佇列上限；`0` 關閉佇列                                                 |
| `parse`            | `(data: MessageEvent["data"]) => unknown` | 見下方   | 將原始 `MessageEvent.data` 轉成業務資料                                                     |
| `liveness`         | `LivenessOptions`                         | —        | 探活設定；省略則不啟用                                                                      |

**預設 `parse` 行為：**

- `data` 為字串 → 嘗試 `JSON.parse`，失敗則原樣回傳
- 非字串 → 原樣回傳

#### 回傳值

| 名稱           | 型別                                 | 說明                         |
| -------------- | ------------------------------------ | ---------------------------- |
| `WsProvider`   | `React.FC<{ children }>`             | 包住需要此連線的子樹         |
| `useWsActions` | `() => WsContextValue`               | 連線操作 API                 |
| `useWsStore`   | `() => WsState` 或 `(selector) => T` | 訂閱連線層狀態（健康／重連） |
| `useWsEvents`  | `(type, handler) => void`            | 訂閱 WebSocket 事件          |

---

### `WsProvider`

負責建立、維護與銷毀原生 `WebSocket` 實例。

| 行為                                               | 說明                                                                                                                                                                                                       |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `WsProvider` 載入且 `autoConnect: true`            | 自動連線                                                                                                                                                                                                   |
| 卸載                                               | 取消重連（`reconnectAttempt` 與 `reconnectExhausted` 歸零）、停止探活、清空待送佇列；狀態同步為 `status: "closed"`、`phase: "idle"`；若有 socket 則關閉並觸發 `close` 事件（reason: `"provider unmount"`） |
| `disconnect()`                                     | 與卸載相同的清理與狀態重置，但不觸發自動重連；若有 socket 則觸發 `close` 事件（reason: `"client disconnect"`）                                                                                             |
| 重連                                               | 非主動斷線且 `reconnectMs > 0` 時，以固定間隔重試（無指數退避）；`reconnectMax > 0` 時超過次數即停止                                                                                                       |
| `connect()` 時已有舊 socket                        | 先 `new WebSocket`；成功後才關閉舊 socket 並觸發 `close`（reason: `"reconnect"`）。建構失敗則保留舊線                                                                                                      |
| getter 丟出、空 URL、或 `new WebSocket` 同步 throw | emit `"error"`；不開新線、不拆現有線；`connect()` 不 throw。若重連計時器已觸發：`status: "closed"`、`phase: "stopped"`，不再自動重試                                                                       |

---

### `useWsActions(): WsContextValue`

必須在對應的 `WsProvider` 內使用。回傳的方法引用穩定，**不會**因狀態或訊息更新而重繪元件。

| 方法         | 簽名                         | 說明                                                                                     |
| ------------ | ---------------------------- | ---------------------------------------------------------------------------------------- |
| `send`       | `(data) => boolean`          | 傳送原始資料（`string`、`ArrayBuffer`、`Blob` 等）。已連線則立即送出；否則視佇列設定入隊 |
| `sendJson`   | `(data: unknown) => boolean` | `JSON.stringify` 後呼叫 `send`；回傳值同 `send`，無法序列化時為 `false`                  |
| `connect`    | `() => void`                 | 先取值並 `new WebSocket`；成功後才關舊線。握手失敗見 `WsProvider`                        |
| `disconnect` | `() => void`                 | 主動斷線；狀態設為 `phase: "idle"`、`status: "closed"`，**不**觸發自動重連；清空待送佇列 |
| `getStatus`  | `() => WsStatus`             | 讀取當下連線狀態；不訂閱、不觸發重繪                                                     |

**`send` / `sendJson` 回傳值：**

- `true` — 已送出，或已成功入隊
- `false` — 未送出：佇列已滿、佇列關閉，或 `sendJson` 無法序列化

---

### `useWsStore()`

必須在對應的 `WsProvider` 內使用。以 `useSyncExternalStore` 訂閱連線狀態；**欄位值與上次相同時不會觸發重繪**。

`WsState` 定位：**連線健康／重連** 等低頻、連線生命週期資訊。高頻訊息請用 `useWsEvents("message", …)`，不要寫入可訂閱狀態。

**建議：** 以選取器只訂閱需要的欄位（例如 `(s) => s.phase`）。不帶選取器的 `useWsStore()` 會訂閱整份狀態，任一欄位變更都會觸發重繪。

```ts
useWsStore(): WsState
useWsStore<T>(selector: (state: WsState) => T): T
```

#### `WsState`

```ts
interface WsState {
  status: WsStatus;
  /** Provider 連線意圖與重連策略階段；語意與 `status` 分開 */
  phase: WsPhase;
  /**
   * 本輪已排程的自動重連次數（意外斷線當下 +1，非重連成功才 +1）。
   * 顯示為 `n` 時，代表第 `n` 次重連已排程或進行中。
   * 成功 `open`、主動 `disconnect()` 歸零。手動 `connect()` 在非重連等待時立刻歸零；重連計時器等待中呼叫則等成功 `open` 才歸零。
   */
  reconnectAttempt: number;
  /** 本輪自動重連已達 `reconnectMax` 且最後一次也失敗；`connect()` / `disconnect()` 歸 `false` */
  reconnectExhausted: boolean;
}
```

| 適合放進可訂閱狀態                                          | 不適合                            |
| ----------------------------------------------------------- | --------------------------------- |
| `status`、`phase`、`reconnectAttempt`、`reconnectExhausted` | `lastMessage`、訊息歷史、業務資料 |

`reconnectMax` 等選項在 `createWsContext` 時即固定，**不會**出現在 `WsState`。取值後的 URL 字串也不會寫入。若 UI 要顯示「第 n 次／最多 m 次」，請在建立 context 時自行記下這些設定值。

#### `WsStatus`

| 值           | 意義     |
| ------------ | -------- |
| `idle`       | 尚未連線 |
| `connecting` | 連線中   |
| `open`       | 已連線   |
| `closed`     | 已斷線   |

反映 WebSocket 當下的連線狀態（類似 readyState 映射）。**不含**「是否在自動重連週期」「是否為使用者主動斷線」等 Provider 意圖——請搭配 `phase`。

#### `WsPhase`

| 值             | 意義                                                                                                                                             |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `idle`         | 未連線、未排程重連（初始或手動 `disconnect()`）                                                                                                  |
| `connecting`   | 首次或手動 `connect()` 連線中                                                                                                                    |
| `open`         | 已連線                                                                                                                                           |
| `reconnecting` | 自動重連週期（等待計時器或連線中）                                                                                                               |
| `stopped`      | 不會再自動重連。`reconnectExhausted === true` 表示已達 `reconnectMax`；`false` 表示未啟用重連（`reconnectMs === 0`），或握手在計時器已觸發後失敗 |

`status` 與 `phase` 常同時變化，但語意不同。例如 `phase === "reconnecting"` 且 `status === "closed"` 表示正在等待重連計時器；`status === "connecting"` 則表示計時器已觸發、正在嘗試連線。

**範例：**

```tsx
const phase = useWsStore((s) => s.phase);
const status = useWsStore((s) => s.status);

// 手動連線：閒置或已停止時才可點
const canConnect = phase === "idle" || phase === "stopped";
// 主動斷線：連線中或重連週期內才可點
const canDisconnect =
  phase === "open" || phase === "connecting" || phase === "reconnecting";
```

---

### `useWsEvents(type, handler)`

必須在對應的 `WsProvider` 內使用。元件掛載時註冊，卸載時自動取消訂閱。

| `type`      | 回呼簽名                                       | 說明                                |
| ----------- | ---------------------------------------------- | ----------------------------------- |
| `"message"` | `(data: unknown, event: MessageEvent) => void` | `data` 為經 `parse` 處理後的結果    |
| `"open"`    | `(event: Event) => void`                       | 連線建立                            |
| `"error"`   | `(event: Event) => void`                       | 連線錯誤（原生 socket，或握手失敗） |
| `"close"`   | `(event: CloseEvent) => void`                  | 連線關閉                            |

**行為細節：**

- 更新回呼**不會**重新訂閱
- `type` 變更**會**重新訂閱
- 非預期斷線時，`close` 回呼執行前狀態已更新為 `status: "closed"` 及對應 `phase`
- 主動 `disconnect()` 或 Provider 卸載亦同：先更新狀態，再觸發 `close` 事件（若當時有 socket）
- getter 丟出、url 為空字串、或 `new WebSocket` 同步 throw 時 emit `"error"`（synthetic `Event`），不觸發 `close`、不替換現有 socket
- 手動 `connect()` 在新 socket 建構成功後關閉舊線時，會先觸發 `close` 事件（reason: `"reconnect"`），再將狀態設為 `connecting`
- 需監聽多種事件時，分別呼叫多次 `useWsEvents`

---

### 探活

透過 `createWsContext({ liveness: { … } })` 啟用。連線建立後週期性送出應用層 ping（以 JSON 直接寫入 socket，非 WebSocket 控制幀，也不經待送佇列）；若在 `timeoutMs` 內未收到符合條件的 pong，主動關閉 socket（若已啟用重連則可能觸發）。

`liveness` 選項形狀如下：

```ts
interface LivenessOptions {
  intervalMs: number; // ping 間隔（毫秒）
  timeoutMs: number; // 等待 pong 逾時（毫秒）
  ping: unknown | (() => unknown); // ping 內容；函式則每次動態產生
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

探活期間，收到的每一筆訊息都會先經 `isPong` 判定；若為 pong 則清除逾時計時，並照常觸發 `"message"` 事件。ping 內容一律以 `JSON.stringify` 送出（僅支援 JSON 格式）。

---

### 待送佇列

當 `outgoingQueueMax > 0` 時：

| 時機                    | 行為                                                    |
| ----------------------- | ------------------------------------------------------- |
| `send` 且 socket 未連線 | 訊息入隊（先進先出）                                    |
| 佇列已滿                | 回傳 `false`，**不**丟棄舊訊息                          |
| socket 已連線           | 依序送出全部佇列                                        |
| `disconnect()`          | 清空佇列；狀態設為 `idle` / `closed`（見 `WsProvider`） |
| `WsProvider` 卸載       | 清空佇列；狀態同步（見 `WsProvider`）                   |
| 自動重連等待期間        | **保留**佇列                                            |

---

### 匯出型別

自 `react-ws-context` 主入口匯出：

| 型別                     | 說明                                                |
| ------------------------ | --------------------------------------------------- |
| `CreateWsContextOptions` | `createWsContext` 的選項                            |
| `MaybeGetter<T>`         | `T \| (() => T)` — 靜態值或同步 getter              |
| `LivenessOptions`        | `createWsContext` 的 `liveness` 選項                |
| `WsContextValue`         | `useWsActions()` 回傳型別                           |
| `WsEvents`               | 事件名稱與回呼的型別對應                            |
| `WsStatus`               | WebSocket 連線狀態（`WsState` 的一環）              |
| `WsPhase`                | Provider 連線意圖與重連策略階段（`WsState` 的一環） |
| `WsState`                | 可訂閱狀態的形狀（連線健康／重連）                  |

---

## 設計取捨與限制

| 項目           | 說明                                                                                                   |
| -------------- | ------------------------------------------------------------------------------------------------------ |
| 策略凍結       | getter／靜態值在 create 時固定；每次握手重新取值。要換「怎麼組」URL／protocols，請再 `createWsContext` |
| 重連策略       | 固定間隔，無指數退避；`reconnectMax > 0` 可限制次數                                                    |
| SSR            | 不在 server 建立 `WebSocket`；`connect()` 在 `window` 不存在時不執行任何動作（no-op）                  |
| 錯誤狀態       | 不設 `"error"` 狀態值；請監聽 `useWsEvents("error")`                                                   |
| `WsState` 範圍 | 只含連線健康／重連；訊息與業務資料不走可訂閱狀態                                                       |
| 訊息與渲染     | 只呼叫 `useWsActions` 的元件不會因狀態或訊息重繪                                                       |
| 狀態更新       | 欄位值未變不觸發重繪；建議以選取器只訂閱需要的欄位                                                     |

---

## 授權

本套件以 [MIT License](./LICENSE) 釋出。Copyright (c) 2026 [GaiaYang](https://github.com/GaiaYang)。

---

## 借鑑與致謝

本套件**未**將下列專案列為 npm 依賴；為達成零執行期依賴，僅內嵌本套件所需的精簡子集。各原始碼檔案頂部亦附有出處備註。

### [zustand](https://github.com/pmndrs/zustand)

- **作者／維護：** [pmndrs](https://github.com/pmndrs)（Poimandres）
- **授權：** [MIT](https://github.com/pmndrs/zustand/blob/main/LICENSE)
- **借鑑範圍：**
  - 外部 store（`getState` / `setState` / `subscribe` / `getInitialState`）— 靈感與行為對齊 [`vanilla.ts`](https://github.com/pmndrs/zustand/blob/main/src/vanilla.ts)，非完整搬移（無 middleware、replace、initializer factory）；`setState` 在欄位值未變時不通知訂閱者
  - React 訂閱 hook — 靈感來自 [`react.ts`](https://github.com/pmndrs/zustand/blob/main/src/react.ts) 的 `useStore`（無 `useDebugValue`）；本套件為 `useWsStore` 加上可選 selector overload
- **對應原始碼：** `src/ws-context/store.ts`、`src/ws-context/use-store.ts`

### [nanoevents](https://github.com/ai/nanoevents)

- **作者：** [Andrey Sitnik](https://github.com/ai)（`ai`）
- **授權：** [MIT](https://github.com/ai/nanoevents/blob/main/LICENSE)
- **借鑑範圍：**
  - 型別化事件派發 — 執行期邏輯幾乎對齊 [`createNanoEvents`](https://github.com/ai/nanoevents/blob/main/index.js)；型別為本套件收斂版
  - React 訂閱包裝 — 本套件自行新增
- **對應原始碼：** `src/ws-context/emitter.ts`、`src/ws-context/ws-events.ts`
