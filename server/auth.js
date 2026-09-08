const GOOGLE_JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const GOOGLE_ISSUERS = new Set(['accounts.google.com', 'https://accounts.google.com']);
const SESSION_COOKIE = '__Host-mwd_session';
const SESSION_MAX_AGE_SECONDS = 28_800;
const JWKS_CACHE_MAX_AGE_MS = 15 * 60 * 1000;

let jwksCache = { expiresAt: 0, keys: new Map() };

function bytes(value) {
  return new TextEncoder().encode(value);
}

function base64urlToBytes(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('Invalid Google credential');
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = `${base64}${'='.repeat((4 - (base64.length % 4)) % 4)}`;
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
}

function bytesToBase64url(value) {
  let binary = '';
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

function parseJsonSegment(value) {
  try {
    return JSON.parse(new TextDecoder().decode(base64urlToBytes(value)));
  } catch {
    throw new Error('Invalid Google credential');
  }
}

function decodeJwt(credential) {
  if (typeof credential !== 'string') throw new Error('Invalid Google credential');
  const segments = credential.split('.');
  if (segments.length !== 3) throw new Error('Invalid Google credential');
  return {
    header: parseJsonSegment(segments[0]),
    payload: parseJsonSegment(segments[1]),
    signingInput: `${segments[0]}.${segments[1]}`,
    signature: base64urlToBytes(segments[2])
  };
}

async function googleJwkFor(kid, fetchImpl, now) {
  if (!jwksCache.keys.has(kid) || jwksCache.expiresAt <= now) {
    let response;
    try {
      response = await fetchImpl(GOOGLE_JWKS_URL);
    } catch {
      throw new Error('Invalid Google credential');
    }

    if (!response?.ok) throw new Error('Invalid Google credential');
    let payload;
    try {
      payload = await response.json();
    } catch {
      throw new Error('Invalid Google credential');
    }
    if (!Array.isArray(payload?.keys)) throw new Error('Invalid Google credential');
    jwksCache = {
      expiresAt: now + JWKS_CACHE_MAX_AGE_MS,
      keys: new Map(payload.keys.filter((key) => typeof key?.kid === 'string').map((key) => [key.kid, key]))
    };
  }

  const jwk = jwksCache.keys.get(kid);
  if (!jwk) throw new Error('Invalid Google credential');
  return jwk;
}

async function importHmacKey(signingKey, usages) {
  if (typeof signingKey !== 'string' || signingKey.length === 0) throw new Error('Invalid session configuration');
  return crypto.subtle.importKey('raw', bytes(signingKey), { name: 'HMAC', hash: 'SHA-256' }, false, usages);
}

async function signSessionPayload(payload, signingKey) {
  const key = await importHmacKey(signingKey, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', key, bytes(payload));
  return bytesToBase64url(new Uint8Array(signature));
}

async function verifySessionPayload(payload, signature, signingKey) {
  try {
    const key = await importHmacKey(signingKey, ['verify']);
    return crypto.subtle.verify('HMAC', key, base64urlToBytes(signature), bytes(payload));
  } catch {
    return false;
  }
}

function cookieValue(cookieHeader) {
  if (typeof cookieHeader !== 'string') return null;
  for (const item of cookieHeader.split(';')) {
    const [name, ...value] = item.trim().split('=');
    if (name === SESSION_COOKIE) return value.join('=') || null;
  }
  return null;
}

export async function verifyGoogleIdToken({ credential, clientId, fetchImpl = fetch, now = Date.now() }) {
  const { header, payload, signingInput, signature } = decodeJwt(credential);
  if (header?.alg !== 'RS256' || typeof header.kid !== 'string') throw new Error('Invalid Google credential');

  let publicKey;
  try {
    const jwk = await googleJwkFor(header.kid, fetchImpl, now);
    publicKey = await crypto.subtle.importKey(
      'jwk',
      jwk,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify']
    );
  } catch {
    throw new Error('Invalid Google credential');
  }

  if (!await crypto.subtle.verify('RSASSA-PKCS1-v1_5', publicKey, signature, bytes(signingInput))) {
    throw new Error('Invalid Google credential');
  }

  const email = typeof payload?.email === 'string' ? payload.email.toLowerCase() : '';
  if (
    !GOOGLE_ISSUERS.has(payload?.iss) ||
    payload.aud !== clientId ||
    !Number.isFinite(payload.exp) ||
    payload.exp * 1000 <= now ||
    payload.email_verified !== true ||
    !email.endsWith('@gmail.com')
  ) {
    throw new Error('Invalid Google credential');
  }

  return { email };
}

export async function issueSession({ email, signingKey, now = Date.now() }) {
  if (typeof email !== 'string' || !email.endsWith('@gmail.com')) throw new Error('Invalid session subject');
  const payload = bytesToBase64url(bytes(JSON.stringify({ email, exp: now + SESSION_MAX_AGE_SECONDS * 1000 })));
  return `${payload}.${await signSessionPayload(payload, signingKey)}`;
}

export async function readSession({ cookieHeader, signingKey, now = Date.now() }) {
  const token = cookieValue(cookieHeader);
  if (!token) return null;
  const [payload, signature, ...extra] = token.split('.');
  if (!payload || !signature || extra.length !== 0 || !await verifySessionPayload(payload, signature, signingKey)) return null;

  try {
    const session = JSON.parse(new TextDecoder().decode(base64urlToBytes(payload)));
    if (typeof session.email !== 'string' || !session.email.endsWith('@gmail.com') || !Number.isFinite(session.exp) || session.exp <= now) return null;
    return { email: session.email };
  } catch {
    return null;
  }
}

export function sessionSetCookie(token) {
  return `${SESSION_COOKIE}=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${SESSION_MAX_AGE_SECONDS}`;
}

export function sessionClearCookie() {
  return `${SESSION_COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;
}
