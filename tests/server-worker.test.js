import assert from 'node:assert/strict';
import test from 'node:test';

import { createWorker } from '../server/worker.js';

const ENV = {
  GOOGLE_CLIENT_ID: 'test-client.apps.googleusercontent.com',
  SESSION_SIGNING_KEY: 'test-signing-key'
};

const assets = {
  '/index.html': '<!doctype html><script type="module" src="/src/main.js"></script>',
  '/src/main.js': 'export {}',
  '/src/ui/styles.css': 'body { color: black; }'
};

const auth = {
  async verifyGoogleIdToken({ credential }) {
    if (credential !== 'valid-credential') throw new Error('Invalid Google credential');
    return { email: 'designer@gmail.com' };
  },
  async issueSession({ email }) {
    assert.equal(email, 'designer@gmail.com');
    return 'valid-session';
  },
  async readSession({ cookieHeader }) {
    return cookieHeader?.includes('__Host-mwd_session=valid-session') ? { email: 'designer@gmail.com' } : null;
  },
  sessionSetCookie(token) {
    return `__Host-mwd_session=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=28800`;
  },
  sessionClearCookie() {
    return '__Host-mwd_session=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0';
  }
};

function request(path, options = {}) {
  return new Request(`https://site.test${path}`, options);
}

test('anonymous visitors see only the Google login page and cannot fetch waveform assets', async () => {
  const worker = createWorker({ assets, auth });

  const home = await worker.fetch(request('/'), ENV);
  const login = await worker.fetch(request('/login'), ENV);
  const asset = await worker.fetch(request('/src/main.js'), ENV);
  const session = await worker.fetch(request('/auth/session'), ENV);
  const page = await login.text();

  assert.equal(home.status, 302);
  assert.equal(home.headers.get('location'), '/login');
  assert.equal(asset.status, 401);
  assert.equal(session.status, 401);
  assert.equal(login.status, 200);
  assert.match(page, /https:\/\/accounts\.google\.com\/gsi\/client/);
  assert.match(page, /test-client\.apps\.googleusercontent\.com/);
  assert.doesNotMatch(page, /src\/main\.js/);
  assert.equal(login.headers.get('cache-control'), 'no-store');
});

test('a valid Google credential creates a session that unlocks only the requested app assets', async () => {
  const worker = createWorker({ assets, auth });
  const login = await worker.fetch(request('/auth/google', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ credential: 'valid-credential' })
  }), ENV);
  const cookie = login.headers.get('set-cookie').split(';', 1)[0];
  const index = await worker.fetch(request('/index.html', { headers: { cookie } }), ENV);
  const appAsset = await worker.fetch(request('/src/main.js', { headers: { cookie } }), ENV);
  const session = await worker.fetch(request('/auth/session', { headers: { cookie } }), ENV);
  const loginAgain = await worker.fetch(request('/login', { headers: { cookie } }), ENV);
  const missing = await worker.fetch(request('/missing.js', { headers: { cookie } }), ENV);

  assert.equal(login.status, 204);
  assert.equal(index.status, 200);
  assert.equal(appAsset.status, 200);
  assert.deepEqual(await session.json(), { email: 'designer@gmail.com' });
  assert.equal(loginAgain.status, 302);
  assert.equal(loginAgain.headers.get('location'), '/');
  assert.equal(missing.status, 404);
  assert.equal(index.headers.get('cache-control'), 'no-store');
});

test('bad login data cannot create a session and logout clears the same cookie name', async () => {
  const worker = createWorker({ assets, auth });
  const malformed = await worker.fetch(request('/auth/google', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ credential: 'invalid-credential' })
  }), ENV);
  const badShape = await worker.fetch(request('/auth/google', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}'
  }), ENV);
  const logout = await worker.fetch(request('/auth/logout', { method: 'POST' }), ENV);

  assert.equal(malformed.status, 401);
  assert.equal(malformed.headers.has('set-cookie'), false);
  assert.equal(badShape.status, 400);
  assert.equal(badShape.headers.has('set-cookie'), false);
  assert.equal(logout.status, 204);
  assert.equal(logout.headers.get('set-cookie'), '__Host-mwd_session=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0');
});

test('the worker fails closed when Google runtime configuration is absent', async () => {
  const worker = createWorker({ assets, auth });
  const login = await worker.fetch(request('/login'), { SESSION_SIGNING_KEY: ENV.SESSION_SIGNING_KEY });
  const credential = await worker.fetch(request('/auth/google', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ credential: 'valid-credential' })
  }), { SESSION_SIGNING_KEY: ENV.SESSION_SIGNING_KEY });

  assert.equal(login.status, 503);
  assert.equal(credential.status, 503);
  assert.equal(credential.headers.has('set-cookie'), false);
});
