function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function isGmail(email) {
  return typeof email === 'string' && email.toLowerCase().endsWith('@gmail.com');
}

export async function getVerifiedAccount({ fetchImpl = fetch } = {}) {
  const response = await fetchImpl('/auth/session', { headers: { accept: 'application/json' } });
  if (!response.ok) throw new Error('Session is unavailable');
  const { email } = await response.json();
  if (!isGmail(email)) throw new Error('Session identity is invalid');
  return { email: email.toLowerCase() };
}

export async function endAccountSession({ fetchImpl = fetch } = {}) {
  const response = await fetchImpl('/auth/logout', { method: 'POST' });
  if (!response.ok) throw new Error('Logout failed');
}

export function renderAccountMarkup(email) {
  return `<span class="account-email" title="Signed in account">${escapeHtml(email)}</span><button id="logout" class="button secondary" type="button">登出</button>`;
}

export async function initializeAccountActions(root, { fetchImpl = fetch, location = window.location } = {}) {
  const accountActions = root.querySelector('#account-actions');
  try {
    const { email } = await getVerifiedAccount({ fetchImpl });

    accountActions.innerHTML = renderAccountMarkup(email);
    root.querySelector('#logout').addEventListener('click', async () => {
      try {
        await endAccountSession({ fetchImpl });
        location.assign('/login');
      } catch {
        // Keep the active account displayed when the server cannot clear its session.
      }
    });
    return true;
  } catch {
    location.assign('/login');
    return false;
  }
}
