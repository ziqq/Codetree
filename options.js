(() => {
  'use strict';
  const C = globalThis.CodeTree;
  const appearance = document.getElementById('appearance-form');
  const accountForm = document.getElementById('account-form');
  const accounts = document.getElementById('accounts');
  const accountStatus = document.getElementById('account-status');
  const appearanceStatus = document.getElementById('appearance-status');
  const connect = document.getElementById('connect-button');
  const preview = document.getElementById('font-preview');
  let state;
  async function rpc(type, value = {}) {
    const result = await chrome.runtime.sendMessage({type, ...value});
    if (!result?.ok) throw new Error(result?.error || 'The extension did not respond. Reload this settings page.');
    return result.value;
  }
  function status(element, text, error = false) {
    element.textContent = text; element.className = error ? 'error' : 'success';
  }
  function showFont() {
    preview.style.fontFamily = C.fontFamilies[appearance.elements.fontFamily.value];
    preview.style.fontSize = `${appearance.elements.fontSize.value || 12}px`;
  }
  function showProvider() {
    const gitlab = accountForm.elements.provider.value === 'gitlab';
    const field = accountForm.elements.origin;
    if (['https://github.com', 'https://gitlab.com'].includes(field.value)) field.value = gitlab ? 'https://gitlab.com' : 'https://github.com';
    field.placeholder = gitlab ? 'https://gitlab.example.com' : 'https://github.example.com';
    document.getElementById('host-note').textContent = gitlab ? 'Use gitlab.com or the HTTPS origin of your self-managed GitLab server.' : 'Use github.com or the HTTPS origin of your GitHub Enterprise Server.';
    document.getElementById('github-permissions').hidden = gitlab;
    document.getElementById('gitlab-permissions').hidden = !gitlab;
  }
  accountForm.elements.provider.addEventListener('change', showProvider);
  function renderAccounts() {
    accounts.replaceChildren();
    if (!state.accounts.length) {
      const text = document.createElement('p'); text.className = 'no-accounts';
      text.textContent = 'Public repositories work immediately. Connect a token for private repositories, review-state filters and a higher API limit.'; accounts.append(text);
    }
    for (const account of state.accounts) {
      const row = document.createElement('div'); row.className = 'account';
      const avatar = document.createElement('div'); avatar.className = 'account-avatar'; avatar.textContent = account.login[0];
      const info = document.createElement('div'); info.className = 'account-info';
      const name = document.createElement('strong'); name.textContent = account.label === account.login ? account.login : `${account.label} · ${account.login}`;
      const host = document.createElement('small'); host.textContent = `${account.provider === 'gitlab' ? 'GitLab' : 'GitHub'} · ${account.origin}`;
      info.append(name, host);
      const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = 'Remove'; remove.setAttribute('aria-label', `Remove ${account.login}`);
      remove.addEventListener('click', async () => {
        remove.disabled = true;
        try { state = await rpc('REMOVE_ACCOUNT', {id: account.id}); renderAccounts(); status(accountStatus, 'Account removed from this browser.'); }
        catch (error) { status(accountStatus, error.message, true); remove.disabled = false; }
      });
      row.append(avatar, info, remove); accounts.append(row);
    }
  }
  appearance.addEventListener('input', showFont);
  appearance.addEventListener('submit', async event => {
    event.preventDefault();
    const value = {dock: appearance.elements.dock.value, iconTheme: appearance.elements.iconTheme.value,
      width: Number(appearance.elements.width.value), fontSize: Number(appearance.elements.fontSize.value),
      fontFamily: appearance.elements.fontFamily.value, pinned: appearance.elements.pinned.checked};
    try { state.preferences = await rpc('PREFERENCES', {value}); status(appearanceStatus, 'Saved. Refresh your repository page to apply.'); }
    catch (error) { status(appearanceStatus, error.message, true); }
  });
  accountForm.addEventListener('submit', async event => {
    event.preventDefault();
    let origin;
    try { origin = C.normalizeOrigin(accountForm.elements.origin.value.trim()); }
    catch (error) { status(accountStatus, error.message, true); return; }
    const provider = accountForm.elements.provider.value;
    connect.disabled = true; accountStatus.textContent = `Connecting directly to ${provider === 'gitlab' ? 'GitLab' : 'GitHub'}…`; accountStatus.className = '';
    try {
      // Request optional permissions here, during the user's form submission gesture.
      if (!['https://github.com', 'https://gitlab.com'].includes(origin)) {
        const granted = await chrome.permissions.request({origins: [`${origin}/*`]});
        if (!granted) throw new Error('Browser permission was not granted for this server.');
      }
      state = await rpc('ADD_ACCOUNT', {provider, origin, label: accountForm.elements.label.value.trim(), token: accountForm.elements.token.value.trim()});
      accountForm.elements.token.value = ''; accountForm.elements.label.value = '';
      renderAccounts(); status(accountStatus, 'Connected. Refresh the repository tab to enable this account.');
    } catch (error) { status(accountStatus, error.message, true); }
    finally { connect.disabled = false; }
  });
  rpc('STATE').then(value => {
    state = value;
    for (const [key, value] of Object.entries(state.preferences)) {
      const field = appearance.elements.namedItem(key);
      if (field) { if (field.type === 'checkbox') field.checked = value; else field.value = value; }
    }
    showFont(); showProvider(); renderAccounts();
  }).catch(error => { document.getElementById('page-error').textContent = error.message; });
})();
