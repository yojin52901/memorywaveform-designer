function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function renderLoginPage({ clientId, error = '' }) {
  const safeClientId = escapeHtml(clientId);
  const errorMarkup = error ? `<p id="login-error" role="alert">${escapeHtml(error)}</p>` : '';

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="description" content="Sign in to Memory Waveform Designer." />
    <title>Sign in · Memory Waveform Designer</title>
  </head>
  <body>
    <main>
      <h1>Memory Waveform Designer</h1>
      <p>Sign in with a verified Gmail account to open the editor.</p>
      <div id="google-login"></div>
      ${errorMarkup}
    </main>
    <script src="https://accounts.google.com/gsi/client" async defer></script>
    <script>
      async function onGoogleCredential(response) {
        const result = await fetch('/auth/google', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({ credential: response.credential })
        });
        if (result.ok) {
          window.location.assign('/');
          return;
        }
        document.getElementById('login-error').hidden = false;
      }

      window.onload = () => {
        google.accounts.id.initialize({ client_id: '${safeClientId}', callback: onGoogleCredential });
        google.accounts.id.renderButton(document.getElementById('google-login'), { theme: 'outline', size: 'large', text: 'signin_with' });
      };
    </script>
    <p id="login-error" role="alert" hidden>Google sign-in could not be verified. Try again with a verified Gmail account.</p>
  </body>
</html>`;
}
