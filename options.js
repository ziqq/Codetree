(() => {
  'use strict';
  const C = globalThis.CodeTree;
  const appearance = document.getElementById('appearance-form');
  const navigation = document.getElementById('navigation-form');
  const accountForm = document.getElementById('account-form');
  const accounts = document.getElementById('accounts');
  const accountStatus = document.getElementById('account-status');
  const appearanceStatus = document.getElementById('appearance-status');
  const connect = document.getElementById('connect-button');
  const preview = document.getElementById('font-preview');
  const syncForm = document.getElementById('sync-form'); const syncSave = document.getElementById('sync-save');
  const syncStatus = document.getElementById('sync-status');
  const githubSignIn = document.getElementById('oauth-github'); const gitlabSignIn = document.getElementById('oauth-gitlab');
  const oauthStatus = document.getElementById('oauth-status'); const deviceBox = document.getElementById('oauth-device');
  let oauthInfo; let device; let pollTimer; let signingIn = false;
  let state; let syncSaving = false;
  async function rpc(type, value = {}) {
    const result = await chrome.runtime.sendMessage({type, ...value});
    if (!result?.ok) throw new Error(result?.error || 'The extension did not respond. Reload this settings page.');
    return result.value;
  }
  function status(element, text, error = false) {
    element.textContent = text; element.className = error ? 'error' : 'success';
  }
  function signInButtons() { githubSignIn.disabled = !oauthInfo?.github || signingIn; gitlabSignIn.disabled = !oauthInfo?.gitlab || signingIn; }
  function showDevice(value) {
    device = value; signingIn = Boolean(value); deviceBox.hidden = !value; clearTimeout(pollTimer); signInButtons();
    if (!value) return;
    document.getElementById('oauth-code').textContent = value.userCode;
    status(oauthStatus, 'Waiting for GitHub authorization…');
    pollTimer = setTimeout(pollDevice, value.interval * 1000);
  }
  async function pollDevice() {
    const active = device; if (!active) return;
    try {
      const result = await rpc('OAUTH_GITHUB_POLL', {id: active.id});
      if (device?.id !== active.id) return;
      if (result.pending) showDevice(result.pending);
      else { showDevice(null); state = result.state; renderAccounts(); status(oauthStatus, 'Connected. Refresh your repository tab.'); }
    } catch (error) { if (device?.id === active.id) { showDevice(null); status(oauthStatus, error.message, true); } }
  }
  githubSignIn.addEventListener('click', async () => {
    signingIn = true; signInButtons();
    try { showDevice(await rpc('OAUTH_GITHUB_START', {access: document.getElementById('oauth-access').value, label: accountForm.elements.label.value.trim()})); }
    catch (error) { signingIn = false; signInButtons(); status(oauthStatus, error.message, true); }
  });
  gitlabSignIn.addEventListener('click', async () => {
    signingIn = true; signInButtons();
    try {
      const granted = await chrome.permissions.request({permissions: ['identity']});
      if (!granted) throw new Error('Browser sign-in permission was not granted. You can use a personal access token.');
      state = await rpc('OAUTH_GITLAB', {label: accountForm.elements.label.value.trim()}); renderAccounts(); status(oauthStatus, 'Connected. Refresh your repository tab.');
    } catch (error) { status(oauthStatus, error.message, true); }
    finally { signingIn = false; signInButtons(); }
  });
  document.getElementById('oauth-cancel').addEventListener('click', async () => {
    const id = device?.id; showDevice(null);
    try { if (id) await rpc('OAUTH_CANCEL', {id}); status(oauthStatus, 'Sign-in cancelled.'); }
    catch (error) { status(oauthStatus, error.message, true); }
  });
  function showFont() {
    preview.style.fontFamily = C.fontFamilies[appearance.elements.fontFamily.value];
    preview.style.fontSize = `${appearance.elements.fontSize.value || 12}px`;
  }
  function renderPreferences() {
    for (const [key, value] of Object.entries(state.preferences)) {
      const field = appearance.elements.namedItem(key) || navigation.elements.namedItem(key);
      if (field) { if (field.type === 'checkbox') field.checked = value; else field.value = value; }
    }
    showFont();
  }
  function renderSync() {
    const value = state.sync || {enabled: false};
    syncForm.elements.enabled.checked = value.enabled === true;
    syncForm.elements.enabled.disabled = syncSaving; syncSave.disabled = syncSaving;
    if (value.error) status(syncStatus, `${value.enabled ? 'Enabled, but Sync needs attention.' : 'Sync is disabled.'} ${value.error} Local data is kept.`, true);
    else if (value.enabled) status(syncStatus, value.lastSyncedAt ? `Enabled. Last saved to browser Sync ${new Date(value.lastSyncedAt).toLocaleString()}.` : 'Enabled. Waiting for the first synced snapshot.');
    else { syncStatus.textContent = 'Disabled on this device. Local data and the shared copy on other enabled devices are kept.'; syncStatus.className = ''; }
  }
  async function refreshSync() {
    try { const value = await rpc('STATE'); state.sync = value.sync; renderSync(); }
    catch (error) { status(syncStatus, `Local changes are saved. Could not refresh Sync status: ${error.message}`, true); }
  }
  syncForm.addEventListener('submit', async event => {
    event.preventDefault(); syncSaving = true; syncSave.disabled = true; syncForm.elements.enabled.disabled = true;
    try { Object.assign(state, await rpc('SYNC_SETTINGS', {enabled: syncForm.elements.enabled.checked})); renderPreferences(); renderSync(); }
    catch (error) { status(syncStatus, error.message, true); }
    finally { syncSaving = false; syncSave.disabled = false; syncForm.elements.enabled.disabled = false; }
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (state && area === 'local' && Object.hasOwn(changes, 'syncSettings')) void refreshSync();
  });
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
    try { state.preferences = await rpc('PREFERENCES', {value}); status(appearanceStatus, 'Saved. Refresh your repository page to apply.'); await refreshSync(); }
    catch (error) { status(appearanceStatus, error.message, true); }
  });
  navigation.addEventListener('submit', async event => {
    event.preventDefault();
    const value = {pageScope: navigation.elements.pageScope.value, hidePatterns: navigation.elements.hidePatterns.value,
      folderClick: navigation.elements.folderClick.checked, toggleShortcut: navigation.elements.toggleShortcut.value.trim(), searchShortcut: navigation.elements.searchShortcut.value.trim()};
    const output = document.getElementById('navigation-status');
    try { C.validateNavigation(value); state.preferences = await rpc('PREFERENCES', {value}); status(output, 'Saved. Refresh your repository page to apply.'); await refreshSync(); }
    catch (error) { status(output, error.message, true); }
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
    renderPreferences(); renderSync(); showProvider(); renderAccounts();
    return rpc('OAUTH_INFO');
  }).then(value => {
    oauthInfo = value; signInButtons();
    document.getElementById('oauth-note').textContent = value.github || value.gitlab ? 'GitLab OAuth requests read_api. Custom servers use personal access tokens below.' : 'OAuth is not configured in this build. Use a personal access token below.';
    if (value.device) showDevice(value.device);
  }).catch(error => { document.getElementById('page-error').textContent = error.message; });
})();
