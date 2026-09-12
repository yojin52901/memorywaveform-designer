import { renderLoginPage } from './login-page.js';

const contentTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8'
};

function noStoreHeaders(headers = {}) {
  return { ...headers, 'cache-control': 'no-store' };
}

function contentType(pathname) {
  const extension = pathname.slice(pathname.lastIndexOf('.'));
  return contentTypes[extension] ?? 'text/plain; charset=utf-8';
}

function redirect(location) {
  return new Response(null, { status: 302, headers: noStoreHeaders({ location }) });
}

function json(payload, status = 200, headers = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: noStoreHeaders({ 'content-type': 'application/json; charset=utf-8', ...headers })
  });
}

function missingConfiguration() {
  return json({ error: 'Authentication is temporarily unavailable.' }, 503);
}

function isNavigation(request, pathname) {
  return pathname === '/' || pathname === '/index.html' || request.headers.get('accept')?.includes('text/html');
}

async function requestCredential(request) {
  try {
    const payload = await request.json();
    return typeof payload?.credential === 'string' && payload.credential.length > 0 ? payload.credential : null;
  } catch {
    return null;
  }
}

async function sessionFor(request, environment, auth) {
  if (!environment?.SESSION_SIGNING_KEY) return null;
  return auth.readSession({
    cookieHeader: request.headers.get('cookie'),
    signingKey: environment.SESSION_SIGNING_KEY
  });
}

function protectedAsset(pathname, assets) {
  const source = assets[pathname];
  if (source === undefined) return new Response('Not found', { status: 404, headers: noStoreHeaders() });
  return new Response(source, {
    headers: noStoreHeaders({ 'content-type': contentType(pathname) })
  });
}

export function createWorker({ assets, auth }) {
  return {
    async fetch(request, environment = {}) {
      const url = new URL(request.url);
      const pathname = url.pathname;

      if (pathname === '/auth/logout' && request.method === 'POST') {
        return new Response(null, {
          status: 204,
          headers: noStoreHeaders({ 'set-cookie': auth.sessionClearCookie() })
        });
      }

      if (pathname === '/auth/google' && request.method === 'POST') {
        if (!environment.GOOGLE_CLIENT_ID || !environment.SESSION_SIGNING_KEY) return missingConfiguration();
        const credential = await requestCredential(request);
        if (!credential) return json({ error: 'A Google credential is required.' }, 400);
        try {
          const identity = await auth.verifyGoogleIdToken({
            credential,
            clientId: environment.GOOGLE_CLIENT_ID
          });
          const token = await auth.issueSession({
            email: identity.email,
            signingKey: environment.SESSION_SIGNING_KEY
          });
          return new Response(null, {
            status: 204,
            headers: noStoreHeaders({ 'set-cookie': auth.sessionSetCookie(token) })
          });
        } catch {
          return json({ error: 'Google sign-in could not be verified.' }, 401);
        }
      }

      if (pathname === '/login' && request.method === 'GET') {
        if (!environment.GOOGLE_CLIENT_ID || !environment.SESSION_SIGNING_KEY) return missingConfiguration();
        if (await sessionFor(request, environment, auth)) return redirect('/');
        return new Response(renderLoginPage({ clientId: environment.GOOGLE_CLIENT_ID }), {
          headers: noStoreHeaders({ 'content-type': 'text/html; charset=utf-8' })
        });
      }

      const session = await sessionFor(request, environment, auth);
      if (!session) {
        return isNavigation(request, pathname) ? redirect('/login') : new Response('Unauthorized', { status: 401, headers: noStoreHeaders() });
      }

      if (pathname === '/auth/session' && request.method === 'GET') return json({ email: session.email });
      return protectedAsset(pathname === '/' ? '/index.html' : pathname, assets);
    }
  };
}
