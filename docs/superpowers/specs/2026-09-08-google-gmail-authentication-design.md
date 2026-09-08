---
status: ready-for-review
title: Google Gmail 登入與帳號登出
---

## 問題與目標

Memory Waveform Designer 目前使用 Sites 的 owner-only 存取設定，並沒有應用程式自己的帳號、登入或登出流程。使用者選擇「任何 Gmail 帳號都可登入」後，網站必須讓未登入者只看見 Google 登入頁，而登入且已驗證的 `@gmail.com` 帳號才可讀取 waveform app 及其靜態資產。

本功能以 Google Identity Services 的 popup 登入取得 Google ID token，由網站 worker 驗證後建立自己的安全 session cookie。這個 flow 只需要 Google OAuth Client ID，不需要 Google Client Secret 或 redirect callback URI。登入不會改變目前以瀏覽器 localStorage 儲存的文件；不同帳號之間不會自動共享資料。

## 使用者故事

1. 作為任何 Gmail 使用者，我想在網站登入頁按「使用 Google 登入」，完成帳號選擇後進入 waveform editor。
2. 作為已登入使用者，我想在 editor 工具列看見目前 Gmail 地址與「登出」按鈕，讓我可以結束此瀏覽器的登入狀態。
3. 作為未登入使用者，我不應能讀取 `/index.html`、JavaScript、CSS、SVG 或任何 waveform 文件內容。
4. 作為既有使用者，我想保留同一瀏覽器的 localStorage 文件與 history；登入只控制網站存取，不遷移或分享資料。
5. 作為維運者，我想在不將任何 secret 提交到 Git 的前提下部署此功能，並能在驗證失敗時安全地拒絕存取。

## 存取模型與路由

Sites 的外層存取模式將在已部署並驗證 worker gate 後改為 `public`。這是讓任意 Gmail 使用者能抵達登入頁所必需的；它不代表 waveform app 對未登入者公開。

worker 是唯一的 application access boundary：

| 路由 | 未登入行為 | 已登入行為 |
| --- | --- | --- |
| `GET /login` | 回傳只含 Google 登入按鈕的頁面 | 302 轉至 `/` |
| `POST /auth/google` | 驗證 Google ID token，成功後設定 session cookie | 可重新建立 session |
| `POST /auth/logout` | 清除可能存在的 session cookie | 清除 session cookie，回傳成功 |
| `GET /auth/session` | 401 | 回傳最小 JSON：`{ "email": "…" }` |
| `/` 與 HTML navigation | 302 轉至 `/login` | 回傳 editor HTML |
| app 靜態資產 | 401 | 回傳請求的資產 |

登入頁不可載入 editor 模組、文件資料或 localStorage 應用程式程式碼。所有身分、登入及鑑權回應使用 `Cache-Control: no-store`。

## Google 身分驗證

登入頁從 `https://accounts.google.com/gsi/client` 載入 Google Identity Services，並以 Sites environment 的 `GOOGLE_CLIENT_ID` 初始化 popup callback。callback 只將 Google 回傳的 `credential` ID token POST 至同源的 `/auth/google`；瀏覽器送出的 email、name 或其他宣告均不被信任。

worker 的驗證模組必須：

1. 以 token header 的 `kid` 從 Google JWKS endpoint `https://www.googleapis.com/oauth2/v3/certs` 取用 RSA public key，並使用 WebCrypto 驗證 `RS256` JWS 簽章；JWK 可在 worker 內短暫快取，但驗證失敗必須 fail closed。
2. 要求 issuer 是 `accounts.google.com` 或 `https://accounts.google.com`。
3. 要求 audience 完全等於 `GOOGLE_CLIENT_ID`。
4. 要求 `exp` 尚未過期。
5. 要求 `email_verified === true`，且 email 正規化為小寫後以 `@gmail.com` 結尾。
6. 對無效簽章、未知 key、錯誤 issuer/audience、過期 token、未驗證 email 或非 Gmail 地址，回傳登入失敗且不設定 cookie。

目前設定的 client ID 是 `418195064147-qumcv0nc1dge7vrq3iviqahr0i7aev9k.apps.googleusercontent.com`。Google Cloud Console 必須將 `https://memorywaveform-designer.yojin52901.chatgpt.site` 設為此 client 的 Authorized JavaScript origin。此設定不需要、也不應要求 client secret。

## Session 與登出

Google ID token 不會保存於 cookie 或 localStorage。worker 會建立只有 `{ email, exp }` 的自有 session payload，以 `SESSION_SIGNING_KEY` 做 HMAC-SHA-256 簽章。每一個受保護請求都驗證簽章與期限；無效或過期 session 一律視為未登入。

cookie 名稱為 `__Host-mwd_session`，屬性固定為 `HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=28800`（8 小時）。它不設定 `Domain`，因此符合 `__Host-` 限制。登出 endpoint 會以同名 cookie、相同 scope 與 `Max-Age=0` 覆寫清除，然後前端導回 `/login`。session 為無狀態設計；登出撤銷目前瀏覽器 cookie，不嘗試撤銷 Google 帳號層的登入。

## UI 行為

已登入的 `index.html` 工具列新增帳號區：顯示已驗證的 Gmail 地址及「登出」按鈕。`src/main.js` 在啟動 editor 後請求 `/auth/session` 取得此最小顯示資訊；如果請求失敗，前端導向 `/login`。點擊登出時前端 POST `/auth/logout`，接著以 `location.assign('/login')` 取代目前頁面。

這個改動不修改 waveform document schema、domain operation、history 或 presentation。existing localStorage key、匯出 JSON 與 import JSON 維持原樣，故資料仍只存在該瀏覽器 profile。

## 模組與建置邊界

目前建置將所有靜態內容內嵌在單一 Sites worker。為維持可測試性，worker code 拆為清楚的三個責任：

- `server/auth.js`：Google ID token 驗證、JWK 快取、session 簽發／驗證與 cookie helper；不依賴 renderer 或 DOM。
- `server/worker.js`：登入、登出、session、受保護 asset 與 navigation 的 routing；只透過 auth module 決定身份。
- `scripts/build.mjs`：產生靜態 asset map，並組裝可由 Sites 載入的 `dist/server/index.js` module graph，不內嵌任何 runtime secret。

`index.html`、`src/main.js` 與 `src/ui/styles.css` 只處理已登入頁面的帳號顯示與登出互動。登入 UI 保持在 worker 的最小 login HTML，避免未登入 route 載入 editor bundle。

## Environment 與部署

Sites runtime environment 必須有：

| Key | 值／來源 | Secret |
| --- | --- | --- |
| `GOOGLE_CLIENT_ID` | 已提供的 Google client ID | 否 |
| `SESSION_SIGNING_KEY` | 部署時以安全亂數產生的至少 32-byte base64url key | 是 |

`SESSION_SIGNING_KEY` 只寫入 Sites secret environment，不出現在 source、archive、測試 fixture、log 或 Git commit。worker 缺少任一環境值時，所有登入相關請求都安全失敗，並以可理解但不洩漏內部資訊的錯誤提示回應。

部署順序為：先在目前私有 Sites project 設定 runtime environment，建立並測試含 worker gate 的版本，再保存和發布該版本，最後才將 Sites access mode 改為 `public`。公開後未登入請求仍只能見到登入頁。若最後 smoke test 失敗，回復前一個 Sites version，並將 access mode 還原為 private custom access。

## 測試決策

以 Node worker-route 及 module-graph 測試涵蓋：

1. 未登入 navigation 會轉至 `/login`，而未登入 asset request 不會回傳 app source。
2. 登入頁含正確 Google client ID 與 GSI script，且沒有 session signing key 或 client secret。
3. 以 mocked JWKS 驗證有效 Google token 可建立 session；錯誤簽章、未知 key、錯誤 issuer/audience、過期 token、未驗證 email 與非 Gmail email 都被拒絕。
4. 有效 session 可取回 editor HTML、資產與最小 email JSON；遭竄改與過期 session 被拒絕。
5. 登出回應以正確安全屬性刪除 `__Host-mwd_session`。
6. toolbar 在 authenticated runtime 顯示 email 與登出動作；session 失敗會導回登入頁。
7. Sites build 的 browser module graph 仍完整可載入，並且完整既有 waveform suite 維持通過。

## 非目標

- 不建立帳號資料庫、團隊、文件同步、跨帳號共用或 server-side document persistence。
- 不請求 Google Drive、Gmail 或任何 Google API scope；只做身份驗證。
- 不支援非 `@gmail.com` 的 Google Workspace 或自訂網域帳號。
- 不提供密碼登入、email magic link、帳號管理或全域 token revocation。
