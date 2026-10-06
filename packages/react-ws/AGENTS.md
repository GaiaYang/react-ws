避免過度設計：先沿用 WebSocket 既有的介面與行為。做不到時，只補連線生命週期缺的那一塊，不另做一套說法。

只擁有一條 WebSocket 的連線與生命週期，包含重連、退避、抖動、liveness、握手逾時與連線狀態。不定義應用層協定。`parse` 與 `sendJson` 只處理字串和 JSON。沒被提出的能力不要加。

只依賴 ECMAScript 與 `globalThis.WebSocket`。計時、`Date.now`、`Math.random`、`JSON`、`console` 算執行環境。不使用其他平台 API，也不讀網路狀態或前後景。

不把 `WebSocket` 實例交出去。送出、關閉、心跳由套件執行。

`open`、`error`、`close` 的參數，以及 `message` 的事件參數，只使用 WebSocket 原本的 `Event`、`MessageEvent`、`CloseEvent`。不得把自訂物件放進這些參數。`message` 可以在事件前多帶 parse 結果。不是 socket 事件的失敗另用一個事件，參數不要寫成 `Event`。

`src/core` 只寫 TypeScript，不依賴 React。React 綁定只放 `src/react`，而且只有這一側可以依賴 `core`。其他平台以後與 `react` 同層。進入點可以標 `"use client"`。

連線若會悄悄壞掉，依連線層常見做法修正。多種做法都守住以上邊界時，選不改既有預設、公開型別改動最少的那一種，並寫明原因。
