import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import test from 'node:test';

import { issueSession, readSession, sessionClearCookie, sessionSetCookie, verifyGoogleIdToken } from '../server/auth.js';

const NOW = 1_800_000_000_000;
const CLIENT_ID = 'test-client.apps.googleusercontent.com';
const SESSION_KEY = 'test-session-signing-key';
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const JWK = {
  ...publicKey.export({ format: 'jwk' }),
  kid: 'google-test-key',
  alg: 'RS256',
  use: 'sig'
};

function base64url(value) {
  return Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)).toString('base64url');
}

function signedCredential(overrides = {}, signingKey = privateKey, kid = JWK.kid) {
  const header = { alg: 'RS256', kid, typ: 'JWT' };
  const payload = {
    iss: 'https://accounts.google.com',
    aud: CLIENT_ID,
    exp: Math.floor(NOW / 1000) + 300,
    email: 'designer@gmail.com',
    email_verified: true,
    ...overrides
  };
  const signingInput = `${base64url(header)}.${base64url(payload)}`;
  const signature = sign('RSA-SHA256', Buffer.from(signingInput), signingKey).toString('base64url');
  return `${signingInput}.${signature}`;
}

function jwksFetch(keys = [JWK]) {
  return async (input) => {
    assert.equal(String(input), 'https://www.googleapis.com/oauth2/v3/certs');
    return new Response(JSON.stringify({ keys }), { status: 200 });
  };
}

test('accepts a signed, verified Gmail token for this client', async () => {
  const result = await verifyGoogleIdToken({
    credential: signedCredential(),
    clientId: CLIENT_ID,
    fetchImpl: jwksFetch(),
    now: NOW
  });

  assert.deepEqual(result, { email: 'designer@gmail.com' });
});

test('rejects an invalid Google identity credential before a session exists', async () => {
  const otherKey = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
  const invalidCredentials = [
    signedCredential({ aud: 'wrong-client.apps.googleusercontent.com' }),
    signedCredential({ iss: 'https://issuer.example.test' }),
    signedCredential({ exp: Math.floor(NOW / 1000) }),
    signedCredential({ email_verified: false }),
    signedCredential({ email: 'designer@example.com' }),
    signedCredential({ }, otherKey),
    signedCredential({ }, privateKey, 'missing-key')
  ];

  for (const credential of invalidCredentials) {
    await assert.rejects(
      () => verifyGoogleIdToken({ credential, clientId: CLIENT_ID, fetchImpl: jwksFetch(), now: NOW }),
      /Google credential/
    );
  }
});

test('creates an eight-hour signed session and rejects a modified or expired one', async () => {
  const token = await issueSession({ email: 'designer@gmail.com', signingKey: SESSION_KEY, now: NOW });

  assert.deepEqual(
    await readSession({ cookieHeader: `theme=light; __Host-mwd_session=${token}`, signingKey: SESSION_KEY, now: NOW + 1 }),
    { email: 'designer@gmail.com' }
  );
  assert.equal(
    await readSession({ cookieHeader: `__Host-mwd_session=${token}x`, signingKey: SESSION_KEY, now: NOW + 1 }),
    null
  );
  assert.equal(
    await readSession({ cookieHeader: `__Host-mwd_session=${token}`, signingKey: SESSION_KEY, now: NOW + 28_800_000 }),
    null
  );
});

test('emits and clears a host-only secure session cookie', async () => {
  const token = await issueSession({ email: 'designer@gmail.com', signingKey: SESSION_KEY, now: NOW });

  assert.equal(
    sessionSetCookie(token),
    `__Host-mwd_session=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=28800`
  );
  assert.equal(
    sessionClearCookie(),
    '__Host-mwd_session=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0'
  );
});
