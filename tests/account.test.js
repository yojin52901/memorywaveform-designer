import assert from 'node:assert/strict';
import test from 'node:test';

import { initializeAccountActions, renderAccountMarkup } from '../src/ui/account.js';

function eventNode() {
  const listeners = new Map();
  return {
    innerHTML: '',
    addEventListener(type, listener) {
      listeners.set(type, listener);
    },
    dispatch(type, event = { preventDefault() {} }) {
      return listeners.get(type)?.(event);
    }
  };
}

function accountRoot() {
  const account = eventNode();
  const logout = eventNode();
  return {
    account,
    logout,
    querySelector(selector) {
      return selector === '#account-actions' ? account : selector === '#logout' ? logout : null;
    }
  };
}

function fakeLocation() {
  return {
    assignments: [],
    assign(path) {
      this.assignments.push(path);
    }
  };
}

test('renders the verified account as text rather than HTML', () => {
  assert.match(renderAccountMarkup('designer@gmail.com'), /designer@gmail\.com/);
  assert.doesNotMatch(renderAccountMarkup('<img>@gmail.com'), /<img>/);
  assert.match(renderAccountMarkup('designer@gmail.com'), /id="logout"/);
});

test('shows the signed-in email and clears the server session on logout', async () => {
  const root = accountRoot();
  const location = fakeLocation();
  const requests = [];
  const fetchImpl = async (path, options = {}) => {
    requests.push({ path, options });
    if (path === '/auth/session') return new Response(JSON.stringify({ email: 'designer@gmail.com' }), { status: 200 });
    if (path === '/auth/logout') return new Response(null, { status: 204 });
    throw new Error(`Unexpected request: ${path}`);
  };

  assert.equal(await initializeAccountActions(root, { fetchImpl, location }), true);
  assert.match(root.account.innerHTML, /designer@gmail\.com/);
  await root.logout.dispatch('click');

  assert.deepEqual(requests, [
    { path: '/auth/session', options: { headers: { accept: 'application/json' } } },
    { path: '/auth/logout', options: { method: 'POST' } }
  ]);
  assert.deepEqual(location.assignments, ['/login']);
});

test('redirects to login and does not render the editor account on a missing or invalid session', async () => {
  for (const fetchImpl of [
    async () => new Response(null, { status: 401 }),
    async () => new Response(JSON.stringify({ email: 'not-gmail@example.com' }), { status: 200 }),
    async () => { throw new Error('Network error'); }
  ]) {
    const root = accountRoot();
    const location = fakeLocation();
    assert.equal(await initializeAccountActions(root, { fetchImpl, location }), false);
    assert.equal(root.account.innerHTML, '');
    assert.deepEqual(location.assignments, ['/login']);
  }
});
