# Google Gmail 登入與帳號登出 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 讓任何已驗證的 Gmail 帳號能以 Google 登入 Memory Waveform Designer，並讓登入者可安全登出，同時保護所有 waveform app 資產。

**Architecture:** 將 Google ID token 驗證、cookie session 與 Sites worker route gate 分為獨立 server modules。未登入者只能取得最小 Google 登入頁；worker 在驗證後才交付 editor HTML 與 module graph。editor 仍是 browser-local application，帳號只控制存取與工具列帳號／登出操作。

**Tech Stack:** ES modules、Node built-in test runner、WebCrypto、Google Identity Services、Google JWKS、Sites worker runtime。

**Spec:** `docs/superpowers/specs/2026-09-08-google-gmail-authentication-design.md`

## Global Constraints

- 僅接受小寫正規化後以 `@gmail.com` 結尾、`email_verified === true` 的 Google ID token。
- Google ID token 必須驗證 RS256 簽章、Google issuer、exact audience 與未過期的 `exp`；任何錯誤 fail closed。
- 不使用或儲存 Google Client Secret；`GOOGLE_CLIENT_ID` 是 Sites 非 secret environment，`SESSION_SIGNING_KEY` 是 Sites secret environment。
- 自有 session 僅含 email 與 8 小時 expiry；cookie 為 `__Host-mwd_session; HttpOnly; Secure; SameSite=Lax; Path=/`。
- 未登入者可讀取的只有 `/login`、`POST /auth/google` 和 `POST /auth/logout`；任何 app HTML 或 asset 不得回傳 waveform source。
- 不更改文件 schema、JSON import/export、history 或 localStorage；帳號之間不共享文件。
- 不加入外部 runtime 套件；驗證與測試只使用現有 Node / WebCrypto API。
- 不提交 `SESSION_SIGNING_KEY`、OAuth client secret、cookie、Google ID token 或任何使用者 email fixture。
- 保留 root worktree 既有的 `.superpowers/sdd/**` 未提交修改，不將它納入任何 commit 或部署。

---

## File Structure

| File | Responsibility |
| --- | --- |
| `server/auth.js` | 驗證 Google JWS、快取 JWK、簽發／驗證 stateless session，以及建立／清除 cookie。 |
| `server/login-page.js` | 產生不載入 editor bundle 的最小 GSI 登入 HTML。 |
| `server/worker.js` | 依身份路由 login、auth、logout、session 與受保護 static asset 請求。 |
| `server/index.js` | Worker entry；以 generated asset map 建立 `createWorker`。 |
| `tests/server-auth.test.js` | 使用本機產生 RSA key/JWK 的 token 驗證與 session cookie 測試。 |
| `tests/server-worker.test.js` | route gate、登入／登出、asset protection 與 session endpoint 測試。 |
| `tests/auth-documentation.test.js` | README 的 Gmail 存取與 browser-local 文件契約測試。 |
| `src/ui/account.js` | 已登入 editor 的帳號顯示、session 讀取、登出 click lifecycle。 |
| `index.html`, `src/main.js`, `src/ui/styles.css` | 注入且呈現 account action 區。 |
| `tests/account.test.js` | account markup 與 logout/session failure UI 契約測試。 |
| `scripts/build.mjs`（Sites source mirror） | 將 server module graph 與 static assets 封裝為 `dist/server` worker。 |
| `tests/build.test.js`（Sites source mirror） | 使用已簽發 session 驗證部署產物的完整 browser module graph。 |

### Task 1: Google token 驗證與安全 session primitives

**Files:**
- Create: `server/auth.js`
- Create: `tests/server-auth.test.js`

**Interfaces:**
- Produces: `verifyGoogleIdToken({ credential, clientId, fetchImpl, now }) -> Promise<{ email: string }>`
- Produces: `issueSession({ email, signingKey, now }) -> Promise<string>`
- Produces: `readSession({ cookieHeader, signingKey, now }) -> Promise<{ email: string } | null>`
- Produces: `sessionSetCookie(token) -> string` and `sessionClearCookie() -> string`

- [ ] **Step 1: Write the failing token-verification and session tests**

```js
test('accepts only a signed, verified Gmail token for this client', async () => {
  const result = await verifyGoogleIdToken({
    credential: signedToken({ email: 'designer@gmail.com', email_verified: true, aud: CLIENT_ID }),
    clientId: CLIENT_ID,
    fetchImpl: jwksFetch,
    now: NOW
  });
  assert.deepEqual(result, { email: 'designer@gmail.com' });
});

test('rejects wrong audience, issuer, expiry, verification, domain, kid and signature', async () => {
  for (const credential of invalidCredentials) {
    await assert.rejects(() => verifyGoogleIdToken({ credential, clientId: CLIENT_ID, fetchImpl: jwksFetch, now: NOW }));
  }
});

test('session round-trip detects tampering and emits a host-only secure cookie', async () => {
  const token = await issueSession({ email: 'designer@gmail.com', signingKey: KEY, now: NOW });
  assert.deepEqual(await readSession({ cookieHeader: `__Host-mwd_session=${token}`, signingKey: KEY, now: NOW }), { email: 'designer@gmail.com' });
  assert.equal(await readSession({ cookieHeader: `__Host-mwd_session=${token}x`, signingKey: KEY, now: NOW }), null);
  assert.match(sessionSetCookie(token), /__Host-mwd_session=.*HttpOnly.*Secure.*SameSite=Lax.*Path=\//);
  assert.match(sessionClearCookie(), /__Host-mwd_session=.*Max-Age=0/);
});
```

- [ ] **Step 2: Run the focused tests and confirm the red state**

Run: `node --test tests/server-auth.test.js`

Expected: FAIL because `server/auth.js` and its exports do not yet exist.

- [ ] **Step 3: Implement strict token and session helpers**

```js
export async function verifyGoogleIdToken({ credential, clientId, fetchImpl = fetch, now = Date.now() }) {
  const { header, payload, signingInput, signature } = decodeJwt(credential);
  if (header.alg !== 'RS256' || typeof header.kid !== 'string') throw new Error('Invalid Google credential');
  const jwk = await googleJwkFor(header.kid, fetchImpl);
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  if (!await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, signature, utf8(signingInput))) throw new Error('Invalid Google credential');
  if (!['accounts.google.com', 'https://accounts.google.com'].includes(payload.iss) || payload.aud !== clientId || payload.exp * 1000 <= now || payload.email_verified !== true || !String(payload.email).toLowerCase().endsWith('@gmail.com')) throw new Error('Invalid Google credential');
  return { email: String(payload.email).toLowerCase() };
}
```

Implement HS256-equivalent HMAC-SHA-256 signing only for the self-issued session (not for Google tokens), constant-time signature comparison, `exp = now + 28_800_000`, and exact cookie attributes from Global Constraints. JWK fetching must cache keys in module memory for a bounded 15 minutes and reject any fetch / parse / key mismatch failure.

- [ ] **Step 4: Run focused tests and the full root suite**

Run: `node --test tests/server-auth.test.js && node --test`

Expected: All auth cases pass; pre-existing waveform tests remain green.

- [ ] **Step 5: Commit the independently testable primitive**

```bash
git add server/auth.js tests/server-auth.test.js
git commit -m "feat: verify Google credentials and sign sessions"
```

### Task 2: Gate Sites routes behind the authenticated session

**Files:**
- Create: `server/login-page.js`
- Create: `server/worker.js`
- Create: `server/index.js`
- Create: `tests/server-worker.test.js`
- Modify: `scripts/build.mjs` in the Sites source mirror
- Modify: `tests/build.test.js` in the Sites source mirror

**Interfaces:**
- Consumes: all exports from `server/auth.js`.
- Produces: `renderLoginPage({ clientId, error }) -> string`.
- Produces: `createWorker({ assets, auth }) -> { fetch(request, env): Promise<Response> }`.
- Produces: `server/index.js` default worker with `fetch(request, env)`.

- [ ] **Step 1: Write failing worker route tests**

```js
const worker = createWorker({ assets: { '/index.html': '<script type="module" src="/src/main.js"></script>', '/src/main.js': 'export {}' }, auth: fakeAuth });

test('anonymous navigation goes only to the login page and assets remain private', async () => {
  assert.equal((await worker.fetch(new Request('https://site.test/'))).status, 302);
  assert.equal((await worker.fetch(new Request('https://site.test/src/main.js'))).status, 401);
  const login = await worker.fetch(new Request('https://site.test/login'));
  const page = await login.text();
  assert.match(page, /accounts\.google\.com\/gsi\/client/);
  assert.doesNotMatch(page, /src\/main\.js/);
});

test('a valid Google credential establishes a session and logout deletes exactly that cookie', async () => {
  const login = await worker.fetch(new Request('https://site.test/auth/google', { method: 'POST', body: JSON.stringify({ credential: 'valid' }) }), ENV);
  const cookie = login.headers.get('set-cookie').split(';', 1)[0];
  assert.equal((await worker.fetch(new Request('https://site.test/index.html', { headers: { cookie } }), ENV)).status, 200);
  assert.match((await worker.fetch(new Request('https://site.test/auth/logout', { method: 'POST' }), ENV)).headers.get('set-cookie'), /Max-Age=0/);
});
```

- [ ] **Step 2: Run focused tests and confirm the red state**

Run: `node --test tests/server-worker.test.js`

Expected: FAIL because worker routes do not yet exist.

- [ ] **Step 3: Implement login page and fail-closed route gate**

```js
export function createWorker({ assets, auth }) {
  return {
    async fetch(request, env) {
      const url = new URL(request.url);
      if (url.pathname === '/login') return loginResponse(request, env.GOOGLE_CLIENT_ID);
      if (url.pathname === '/auth/google' && request.method === 'POST') return googleLoginResponse(request, env, auth);
      if (url.pathname === '/auth/logout' && request.method === 'POST') return logoutResponse();
      const session = await auth.readSession({ cookieHeader: request.headers.get('cookie'), signingKey: env.SESSION_SIGNING_KEY });
      if (!session) return isNavigation(request) ? redirect('/login') : new Response('Unauthorized', { status: 401 });
      if (url.pathname === '/auth/session') return json({ email: session.email });
      return protectedAsset(url.pathname === '/' ? '/index.html' : url.pathname, assets);
    }
  };
}
```

`POST /auth/google` accepts only JSON `{ credential: string }`, invokes the real verifier with `env.GOOGLE_CLIENT_ID`, issues the self session using `env.SESSION_SIGNING_KEY`, and returns 400/401/503 without a Set-Cookie on malformed credential, verification failure or missing environment. All identity and protected responses set `Cache-Control: no-store`.

- [ ] **Step 4: Extend the Sites build to emit the complete server module graph**

Write the generated asset map to `dist/server/assets.js`; copy `server/auth.js`, `server/login-page.js`, and `server/worker.js` into `dist/server`; create `dist/server/index.js` that imports `assets` and `createWorker`, then exports `createWorker({ assets, auth })`. Keep root source modules and their Sites mirror byte-identical.

Update the deployment test to import both `dist/server/index.js` and `dist/server/auth.js`, issue a test session with a test signing key, send that cookie while traversing the browser module graph, and assert an anonymous `GET /src/main.js` is 401.

- [ ] **Step 5: Run worker and deployment focused tests**

Run in root: `node --test tests/server-worker.test.js`

Run in Sites source mirror: `node --test tests/build.test.js && node scripts/build.mjs`

Expected: all route tests and the authenticated module graph pass; anonymous assets remain unavailable.

- [ ] **Step 6: Commit the worker boundary**

```bash
git add server/login-page.js server/worker.js server/index.js tests/server-worker.test.js
git commit -m "feat: protect waveform assets with Google sessions"
```

### Task 3: Display account identity and provide a reliable logout control

**Files:**
- Create: `src/ui/account.js`
- Create: `tests/account.test.js`
- Modify: `index.html`
- Modify: `src/main.js`
- Modify: `src/ui/styles.css`

**Interfaces:**
- Produces: `renderAccountMarkup(email) -> string`.
- Produces: `initializeAccountActions(root, { fetchImpl, location }) -> Promise<boolean>`.
- Consumes: `GET /auth/session` and `POST /auth/logout` from Task 2.

- [ ] **Step 1: Write failing account UI tests**

```js
test('shows the verified email and wires logout to the session endpoint', async () => {
  const root = fakeRootWithAccountContainer();
  await initializeAccountActions(root, { fetchImpl: successfulSessionFetch('designer@gmail.com'), location: fakeLocation });
  assert.match(root.account.innerHTML, /designer@gmail\.com/);
  root.logout.dispatch('click', { preventDefault() {} });
  assert.deepEqual(fakeLocation.assignments, ['/login']);
});

test('redirects to login without starting an editor session when session lookup fails', async () => {
  await initializeAccountActions(fakeRootWithAccountContainer(), { fetchImpl: failingSessionFetch(401), location: fakeLocation });
  assert.deepEqual(fakeLocation.assignments, ['/login']);
});
```

- [ ] **Step 2: Run focused tests and confirm the red state**

Run: `node --test tests/account.test.js`

Expected: FAIL because the account module and toolbar container do not exist.

- [ ] **Step 3: Implement account UI without storing identity locally**

```js
export async function initializeAccountActions(root, { fetchImpl = fetch, location = window.location } = {}) {
  const response = await fetchImpl('/auth/session', { headers: { accept: 'application/json' } });
  if (!response.ok) {
    location.assign('/login');
    return false;
  }
  const { email } = await response.json();
  root.querySelector('#account-actions').innerHTML = renderAccountMarkup(email);
  root.querySelector('#logout').addEventListener('click', async () => {
    await fetchImpl('/auth/logout', { method: 'POST' });
    location.assign('/login');
  });
  return true;
}
```

Add only `<div id="account-actions" aria-live="polite"></div>` to the toolbar, and gate startup with `if (await initializeAccountActions(document)) createEditor(document)`. Style it as a compact non-overlapping toolbar group. Never store email, token or session data in localStorage.

- [ ] **Step 4: Run focused UI tests plus the full root suite**

Run: `node --test tests/account.test.js && node --test`

Expected: account lifecycle tests pass and no controller / waveform regression occurs.

- [ ] **Step 5: Commit the authenticated editor UI**

```bash
git add index.html src/main.js src/ui/account.js src/ui/styles.css tests/account.test.js
git commit -m "feat: show signed-in Gmail account and logout"
```

### Task 4: Document, synchronize, and verify the production artifact

**Files:**
- Modify: `README.md`
- Create: `tests/auth-documentation.test.js`
- Modify: equivalent source, tests, and `scripts/build.mjs` in `/workspace/scratch/e513fc1a7794/memorywaveform-site-source.NmkbAp`

**Interfaces:**
- Consumes: the source modules and tests from Tasks 1–3.
- Produces: an auditable Sites archive whose worker requires a signed session before serving the editor.

- [ ] **Step 1: Write the failing documentation contract check**

```js
test('README documents Gmail-only access and browser-local documents', () => {
  const readme = readFileSync('README.md', 'utf8');
  assert.match(readme, /@gmail\.com/);
  assert.match(readme, /localStorage/);
  assert.doesNotMatch(readme, /Client Secret/);
});
```

Create this check in `tests/auth-documentation.test.js` before changing the README.

- [ ] **Step 2: Run the focused documentation test and confirm the red state**

Run: `node --test tests/auth-documentation.test.js`

Expected: FAIL because README has no authenticated-access statement.

- [ ] **Step 3: Document the final user-facing privacy contract and synchronize deployment source**

Add a short README section stating: access requires a verified Gmail address; documents remain browser-local; user may logout from the toolbar; no Google API scopes or Client Secret are used. Copy every Task 1–3 source/test change to the Sites source mirror and verify byte identity for the shared paths with `cmp`.

- [ ] **Step 4: Run all release gates**

```bash
# Root worktree
node --test
node --check server/auth.js
node --check server/login-page.js
node --check server/worker.js
node --check src/ui/account.js
git diff --check

# Sites source mirror
node --test
node scripts/build.mjs
node --test tests/build.test.js
git diff --check
```

Expected: every root and Sites test passes, all generated worker modules parse, and no whitespace error exists.

- [ ] **Step 5: Commit source and deployment documentation separately**

```bash
# Root GitHub source branch
git add README.md tests/auth-documentation.test.js
git commit -m "docs: describe Gmail access and local waveform data"

# Sites source checkout
git add index.html src server scripts tests README.md dist
git commit -m "feat: require Google Gmail login for waveform designer"
```

### Task 5: Configure environment, publish, and smoke-test the Gmail gate

**Files:**
- No committed secret files.

**Interfaces:**
- Consumes: the Sites source commit generated in Task 4 and the provided `GOOGLE_CLIENT_ID`.
- Produces: the existing production URL where unauthenticated visitors see only the Google sign-in page.

- [ ] **Step 1: Set Sites runtime environment before publishing**

Set `GOOGLE_CLIENT_ID=418195064147-qumcv0nc1dge7vrq3iviqahr0i7aev9k.apps.googleusercontent.com` as a non-secret Sites variable. Generate a 32-byte base64url `SESSION_SIGNING_KEY` locally and set it only as a secret Sites variable. Confirm the environment list reveals key names but does not reveal the secret value.

- [ ] **Step 2: Publish the verified site artifact while current private access remains in place**

Build and package the exact Sites source commit, save a new version, deploy it, and wait for a successful deployment terminal state. Do not change access mode before the deployment is successful.

- [ ] **Step 3: Perform unauthenticated and login-page smoke tests**

At `https://memorywaveform-designer.yojin52901.chatgpt.site`, verify that `/` redirects to `/login`, `/login` contains the Google GSI button and no waveform module request is successful without a cookie, and the GSI initialization contains the configured client ID. Verify the Google Cloud Console authorized JavaScript origin is exactly `https://memorywaveform-designer.yojin52901.chatgpt.site`; stop with a clear message if Google rejects the origin.

- [ ] **Step 4: Make the platform entry public only after the gate passes**

Change the Sites project access mode from custom owner-only to `public`. Re-run the unauthenticated smoke test: public visitors must still see only the login page, not app HTML/assets. Do not attempt to enter passwords, verification codes, or user credentials during smoke testing.

- [ ] **Step 5: Push and deliver**

Fast-forward the existing GitHub feature branch without force-push, using the authorized GitHub App workflow if local Git credentials are unavailable. Report the GitHub commit, Sites deployment version, production URL, root/Sites test counts, and the access model. If public smoke fails, restore the previous Sites version and custom access mode before reporting the failure.
