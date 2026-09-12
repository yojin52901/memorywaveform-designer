import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import test from 'node:test';

test('the deployment worker serves the complete browser module graph', async () => {
  execFileSync(process.execPath, ['scripts/build.mjs'], { stdio: 'pipe' });
  const { default: worker } = await import(`../dist/server/index.js?test=${Date.now()}`);
  const { issueSession } = await import(`../dist/server/auth.js?test=${Date.now()}`);
  const origin = 'https://site.test';
  const environment = {
    GOOGLE_CLIENT_ID: 'test-client.apps.googleusercontent.com',
    SESSION_SIGNING_KEY: 'build-test-session-signing-key'
  };
  const token = await issueSession({
    email: 'designer@gmail.com',
    signingKey: environment.SESSION_SIGNING_KEY,
    now: 1_800_000_000_000
  });
  const cookie = `__Host-mwd_session=${token}`;
  const anonymousAsset = await worker.fetch(new Request(`${origin}/assets/app.js`), environment);
  const loginResponse = await worker.fetch(new Request(`${origin}/login`), environment);
  const indexResponse = await worker.fetch(new Request(`${origin}/index.html`, { headers: { cookie } }), environment);
  const html = await indexResponse.text();
  const entryPath = html.match(/<script type="module" src="([^"]+)"/)?.[1];
  const stylesheetPath = html.match(/<link rel="stylesheet" href="([^"]+)"/)?.[1];

  assert.equal(anonymousAsset.status, 401);
  assert.equal(loginResponse.status, 200);
  assert.match(await loginResponse.text(), /accounts\.google\.com\/gsi\/client/);
  assert.equal(indexResponse.status, 200);
  assert.ok(entryPath, 'index.html must declare a module entry point');
  assert.equal(entryPath, './assets/app.js');
  assert.equal(stylesheetPath, './assets/app.css');
  const appBundle = await worker.fetch(new Request(new URL(entryPath, `${origin}/index.html`), { headers: { cookie } }), environment);
  assert.doesNotMatch(await appBundle.text(), /react\.development\.js/);
  const stylesheet = await worker.fetch(new Request(new URL(stylesheetPath, `${origin}/index.html`), { headers: { cookie } }), environment);
  assert.equal(stylesheet.status, 200);

  const pending = [new URL(entryPath, `${origin}/index.html`).pathname];
  const visited = new Set();
  while (pending.length) {
    const path = pending.shift();
    if (visited.has(path)) continue;
    visited.add(path);
    const response = await worker.fetch(new Request(`${origin}${path}`, { headers: { cookie } }), environment);
    assert.equal(response.status, 200, `${path} is imported by the browser but missing from the deployment`);
    const source = await response.text();
    // Match only ESM import declarations. Bundled dependencies contain ordinary strings
    // such as `linear-gradient(from "…")`, which are not browser module imports.
    const imports = [...source.matchAll(/^\s*import(?:[\w*${},\s]*from\s*)?['"]([^'"]+)['"]/gm)].map((match) => match[1]);
    for (const specifier of imports.filter((value) => value.startsWith('.'))) {
      pending.push(new URL(specifier, `${origin}${path}`).pathname);
    }
  }
});
