function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function isGmail(email) {
  return typeof email === 'string' && email.toLowerCase().endsWith('@gmail.com');
}

export function renderAccountMarkup(email) {
  return `<span class="account-email" title="Signed in account">${escapeHtml(email)}</span><button id="logout" class="button secondary" type="button">登出</button>`;
}

export async function initializeAccountActions(root, { fetchImpl = fetch, location = window.location } = {}) {
  const accountActions = root.querySelector('#account-actions');
  try {
    const response = await fetchImpl('/auth/session', { headers: { accept: 'application/json' } });
    if (!response.ok) throw new Error('Session is unavailable');
    const { email } = await response.json();
    if (!isGmail(email)) throw new Error('Session identity is invalid');

    accountActions.innerHTML = renderAccountMarkup(email.toLowerCase());
    root.querySelector('#logout').addEventListener('click', async () => {
      const logout = await fetchImpl('/auth/logout', { method: 'POST' });
      if (logout.ok) location.assign('/login');
    });
    return true;
  } catch {
    location.assign('/login');
    return false;
  }
}
