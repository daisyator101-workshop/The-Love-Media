import './index.css';

const app = document.getElementById('root');
const isLocalDevelopment = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';

function getApiBaseUrl() {
  const envUrl = (import.meta.env.VITE_API_URL || '').trim().replace(/\/+$/, '');
  const storedUrl = (localStorage.getItem('the-love-media-api-url') || '').trim().replace(/\/+$/, '');
  if (envUrl) return envUrl;
  if (storedUrl) return storedUrl;
  if (isLocalDevelopment) return `http://${window.location.hostname}:3002`;
  return '';
}

function getWebSocketBaseUrl() {
  const envWs = (import.meta.env.VITE_WS_URL || '').trim().replace(/\/+$/, '');
  const storedWs = (localStorage.getItem('the-love-media-ws-url') || '').trim().replace(/\/+$/, '');
  if (envWs) return envWs;
  if (storedWs) return storedWs;
  const api = getApiBaseUrl();
  if (api) return api.replace(/^http:/, 'ws:').replace(/^https:/, 'wss:');
  if (isLocalDevelopment) return `ws://${window.location.hostname}:3002`;
  return '';
}

function getAppDownloadUrl() {
  return (import.meta.env.VITE_APP_DOWNLOAD_URL || '').trim();
}

let apiBaseUrl = getApiBaseUrl();
let webSocketBaseUrl = getWebSocketBaseUrl();
let currentProfileName = 'Gayjesus';
let currentSessionToken = '';
let currentProfileBio = 'A little about you goes here.';
let currentProfileStatuses = [];
let currentConnectionStatus = '';
let friends = JSON.parse(localStorage.getItem('the-love-media-friends') || '[]');
let privateMessageOpener = null;
let pendingPrivateMessageFriend = null;
let groupChatActive = false;
let groupChatInvites = [];
let roomCounts = {};
let roomMembers = {};
let roomPresenceSocket = null;
let roomMatesRenderer = null;
let accounts = JSON.parse(localStorage.getItem('the-love-media-accounts') || '[]');
let privateMail = JSON.parse(localStorage.getItem('the-love-media-private-mail') || '{}');
const privateMessageLifetime = 30 * 24 * 60 * 60 * 1000;
let communityVibeScore = Number(localStorage.getItem('the-love-media-vibe-score') || 100);
const roomNames = [
  'ALL AROUND MAYHEM',
  'Twinks A Hoy',
  'daddys and sons',
  'bisexual town',
  'lezy lickables',
  'Queers all around us',
  'Fuzzy Frenzy',
  'Kinks r us',
  'Transgender Dominance'
];
const lgbtqUpdates = [
  {
    title: 'GLAAD responds to an anti-LGBTQ shooting in Tucson',
    source: 'GLAAD News',
    url: 'https://glaad.org/glaad-local-leaders-respond-to-anti-lgbtq-shooting-at-tucson-queer-bar/'
  },
  {
    title: 'GLAAD reports on LGBTQ stories at the Toronto International Film Festival',
    source: 'GLAAD News',
    url: 'https://glaad.org/glaad-to-toronto-for-tiff-the-market-festival-and-celebrating-lgbtq-stories/'
  },
  {
    title: '2026 State of HIV Stigma report and public awareness',
    source: 'GLAAD Research',
    url: 'https://glaad.org/glaads-2026-state-of-hiv-stigma-report-shows-alarming-gap-between-scientific-progress-and-public-understanding-of-hiv/'
  }
];

function updateGroupChatStatus() {
  const button = document.getElementById('enter-group-chat-btn');
  if (button) button.textContent = `Enter group chat - ${groupChatActive ? 'Active' : 'Inactive'}`;
}

function roomIdForName(roomName) {
  return roomName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function getFeaturedRoomName() {
  return roomNames.reduce((featuredRoom, roomName) => {
    return (roomCounts[roomIdForName(roomName)] || 0) > (roomCounts[roomIdForName(featuredRoom)] || 0)
      ? roomName
      : featuredRoom;
  }, roomNames[0]);
}

function roomCountLabel(count) {
  return `${count} ${count === 1 ? 'person' : 'people'} here now`;
}

function getRoomBackgroundKey(roomName) {
  return `the-love-media-room-background-${roomIdForName(roomName)}`;
}

function getRoomBackground(roomName) {
  return localStorage.getItem(getRoomBackgroundKey(roomName));
}

function setRoomBackground(roomName, imageData) {
  if (imageData) localStorage.setItem(getRoomBackgroundKey(roomName), imageData);
  else localStorage.removeItem(getRoomBackgroundKey(roomName));
}

function updateFeaturedRoomTiles() {
  const featuredRoom = getFeaturedRoomName();
  document.querySelectorAll('.room-tile[data-room-name]').forEach((tile) => {
    const isFeatured = tile.dataset.roomName === featuredRoom;
    const count = roomCounts[roomIdForName(tile.dataset.roomName)] || 0;
    tile.classList.toggle('room-tile-featured', isFeatured);
    tile.querySelector('.room-tag').textContent = isFeatured ? 'Featured' : tile.dataset.roomName;
    tile.querySelector('small').textContent = roomCountLabel(count);
  });
}

function updateRadarMembers() {
  const radarList = document.getElementById('radar-members-list');
  if (!radarList) return;
  const members = [...new Set(Object.values(roomMembers).flat())]
    .filter((member) => member && member !== currentProfileName)
    .slice(0, 5);
  radarList.innerHTML = members.length
    ? members.map((member) => `<li>${member} • live in a room</li>`).join('')
    : '<li>No other room members yet</li>';
}

function renderRoomTiles() {
  const featuredRoom = getFeaturedRoomName();
  return roomNames.map((roomName) => {
    const isFeatured = roomName === featuredRoom;
    const roomDescription = roomName === 'ALL AROUND MAYHEM'
      ? 'Open mic • dance • open chat'
      : roomCountLabel(roomCounts[roomIdForName(roomName)] || 0);
    return `
      <button class="room-tile${isFeatured ? ' room-tile-featured' : ''}" id="${roomIdForName(roomName)}-btn" data-room-name="${roomName}" type="button">
        <span class="room-tag${isFeatured ? '' : ' alt'}">${isFeatured ? 'Featured' : roomName}</span>
        <strong>${roomName}</strong>
        <small>${roomDescription}</small>
      </button>
    `;
  }).join('');
}

function connectRoomPresence(roomName = null) {
  roomPresenceSocket?.close();
  roomPresenceSocket = new WebSocket(webSocketBaseUrl);
  roomPresenceSocket.onopen = () => {
    roomPresenceSocket.send(JSON.stringify({ type: 'auth', sessionToken: currentSessionToken }));
    roomPresenceSocket.send(JSON.stringify({ type: 'presence-subscribe' }));
    if (roomName) roomPresenceSocket.send(JSON.stringify({ type: 'presence-join', room: roomIdForName(roomName) }));
  };
  roomPresenceSocket.onmessage = ({ data }) => {
    const message = JSON.parse(data);
    if (message.type !== 'room-counts') return;
    roomCounts = message.counts || {};
    roomMembers = message.members || {};
    updateFeaturedRoomTiles();
    updateRadarMembers();
    roomMatesRenderer?.();
  };
}

function getPrivateThreadKey(friend) {
  return `the-love-media-private-thread-${friend}`;
}

function getPrivateThread(friend) {
  try {
    return JSON.parse(localStorage.getItem(getPrivateThreadKey(friend)) || '[]');
  } catch {
    return [];
  }
}

function savePrivateThread(friend, messages) {
  localStorage.setItem(getPrivateThreadKey(friend), JSON.stringify(messages));
}

function clearPersistedSession() {
  localStorage.removeItem('the-love-media-profile');
}

function savePrivateMail() {
  localStorage.setItem('the-love-media-private-mail', JSON.stringify(privateMail));
}

function cleanPrivateMail(friend, isOnline) {
  if (isOnline || !privateMail[friend]) return;
  const cutoff = Date.now() - privateMessageLifetime;
  const freshMessages = privateMail[friend].filter((message) => {
    const isPermanentSuggestion = message.permanent || (friend === 'Gayjesus' && message.text.startsWith('Suggestion:'));
    return isPermanentSuggestion || message.createdAt > cutoff;
  });
  if (freshMessages.length !== privateMail[friend].length) {
    privateMail[friend] = freshMessages;
    savePrivateMail();
  }
}

function addPrivateMailMessage(friend, sender, text, options = {}) {
  if (!privateMail[friend]) privateMail[friend] = [];
  privateMail[friend].push({ id: crypto.randomUUID(), sender, text, createdAt: Date.now(), ...options });
  savePrivateMail();
}

function accountCountLabel() {
  const count = Math.max(1, accounts.length);
  return `${count} account${count === 1 ? '' : 's'}`;
}

function accountCount() {
  return Math.max(1, accounts.length);
}

function getRememberedCredentials() {
  try {
    const rememberedLogin = JSON.parse(localStorage.getItem('the-love-media-remembered-login') || 'null');
    if (!rememberedLogin?.codename) return null;
    return { codename: rememberedLogin.codename };
  } catch {
    return null;
  }
}

async function restoreBrowserCredential(codenameInput, passwordInput, rememberPasswordInput) {
  if (!window.PasswordCredential || !navigator.credentials?.get) return;
  try {
    const credential = await navigator.credentials.get({ password: true, mediation: 'silent' });
    if (!credential) return;
    codenameInput.value = credential.id || codenameInput.value;
    passwordInput.value = credential.password || '';
    rememberPasswordInput.checked = true;
  } catch {
    return;
  }
}

async function rememberBrowserCredential(codename, password, rememberPassword) {
  if (!rememberPassword || !window.PasswordCredential || !navigator.credentials?.store) return;
  try {
    await navigator.credentials.store(new PasswordCredential({ id: codename, password }));
  } catch {
    return;
  }
}

async function accountApi(path, payload) {
  let targetBaseUrl = getApiBaseUrl();
  if (!targetBaseUrl) {
    const entered = window.prompt(
      'Your Koyeb backend server URL is not configured.\n\nPlease enter your Koyeb backend URL (for example: https://my-app.koyeb.app):',
      'https://'
    );
    if (entered && entered.trim() && entered.trim() !== 'https://') {
      const cleanUrl = entered.trim().replace(/\/+$/, '');
      localStorage.setItem('the-love-media-api-url', cleanUrl);
      apiBaseUrl = cleanUrl;
      webSocketBaseUrl = getWebSocketBaseUrl();
      targetBaseUrl = cleanUrl;
      const statusLabel = document.getElementById('server-status-label');
      if (statusLabel) statusLabel.textContent = cleanUrl;
    } else {
      throw new Error('Backend URL is required. Click "(set URL)" below to enter your Koyeb backend URL.');
    }
  }

  let lastError;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const headers = { 'Content-Type': 'application/json' };
    if (currentSessionToken) headers.Authorization = `Bearer ${currentSessionToken}`;
    try {
      const response = await fetch(`${targetBaseUrl}${path}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        cache: 'no-store'
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Account service unavailable.');
      return result;
    } catch (error) {
      lastError = error;
      if (attempt === 0 && error instanceof TypeError) {
        await new Promise((resolve) => window.setTimeout(resolve, 800));
        continue;
      }
      if (error instanceof TypeError && error.message.toLowerCase().includes('fetch')) {
        throw new Error(`Cannot reach backend at "${targetBaseUrl}". Verify Koyeb is healthy or click "(set URL)" to update.`);
      }
      throw error;
    }
  }
  throw lastError || new Error('Account service unavailable.');
}

async function migrateLocalAccounts() {
  const legacyAccounts = accounts.filter((account) => account.password && account.resetKey);
  for (const account of legacyAccounts) {
    try {
      await accountApi('/api/accounts', {
        codename: account.codename,
        resetKey: account.resetKey,
        password: account.password,
        profile: account.codename === currentProfileName ? {
          bio: currentProfileBio,
          statuses: currentProfileStatuses,
          connectionStatus: currentConnectionStatus
        } : undefined
      });
      delete account.password;
    } catch {
      continue;
    }
  }
  localStorage.setItem('the-love-media-accounts', JSON.stringify(accounts));
}

function setupEmojiPicker(buttonId, pickerId, inputId) {
  const button = document.getElementById(buttonId);
  const picker = document.getElementById(pickerId);
  const input = document.getElementById(inputId);
  picker.querySelectorAll('button').forEach((emojiButton) => {
    emojiButton.addEventListener('click', () => {
      const start = input.selectionStart;
      const end = input.selectionEnd;
      input.value = `${input.value.slice(0, start)}${emojiButton.textContent}${input.value.slice(end)}`;
      input.focus();
      input.setSelectionRange(start + emojiButton.textContent.length, start + emojiButton.textContent.length);
      picker.classList.add('hidden');
    });
  });
  button.addEventListener('click', (event) => {
    event.stopPropagation();
    picker.classList.toggle('hidden');
  });
}

function renderLoginPage() {
  window.history.replaceState({ screen: 'login' }, '', window.location.pathname);
    window.history.pushState({ screen: 'forgot-password' }, '', window.location.pathname);
    renderForgotPasswordPage();
  const rememberedCredentials = getRememberedCredentials();
  const appDownloadUrl = getAppDownloadUrl();
  app.innerHTML = `
    <div class="app-shell auth-shell">
      <div class="floating-hearts" aria-hidden="true">
        <span class="heart heart-1">♥</span>
        <span class="heart heart-2">♥</span>
        <span class="heart heart-3">♥</span>
        <span class="heart heart-4">♥</span>
        <span class="heart heart-5">♥</span>
        <span class="heart heart-6">♥</span>
      </div>

      <div class="auth-visual">
        <div class="brand-badge">The Love Media</div>
        <h1>Find your people in real time.</h1>
        <p>Private rooms, intimate hangouts, and welcoming LGBTQ+ spaces built for connection.</p>
        <div class="hero-metrics">
          <div>
            <strong>${accountCount()}</strong>
            <span>Member</span>
          </div>
          <div>
            <strong>${roomNames.length}</strong>
            <span>Room</span>
          </div>
          <div>
            <strong>${communityVibeScore}%</strong>
            <span>Vibe score</span>
          </div>
        </div>
        <ul class="hero-list">
          <li>Low-key chats and loud late-night energy</li>
          <li>Private spaces for real connection</li>
          <li>Built for LGBTQ+ joy, support, and community</li>
        </ul>
      </div>

      <div class="login-card">
        <div class="login-header">
          <div class="brand-row">
            <p class="eyebrow">Welcome back</p>
            <span class="account-count">${accountCountLabel()}</span>
          </div>
          <h1>Sign in</h1>
          <p>Jump back into the room, reconnect with your people, and keep the energy going.</p>
        </div>

        <div class="form-group">
          <label for="email">Codename</label>
          <input id="email" type="text" placeholder="Enter your codename" />
        </div>

        <div class="form-group">
          <label for="password">Password</label>
          <input id="password" type="password" placeholder="••••••••" />
        </div>

        <label class="remember-login" for="remember-login-input">
          <input id="remember-login-input" type="checkbox" ${rememberedCredentials ? 'checked' : ''} />
          <span>Remember my codename on this device</span>
        </label>
        <label class="remember-login" for="remember-password-input">
          <input id="remember-password-input" type="checkbox" />
          <span>Remember my password in my browser</span>
        </label>

        <button class="primary-btn" id="login-btn" type="button">Log in</button>
        <p class="form-status" id="login-status" aria-live="polite"></p>

        <div class="form-footer">
          <button class="inline-link-button" id="forgot-password-link" type="button">Forgot password?</button>
          <p class="secondary-text">
            New here? <button class="inline-link-button" id="create-account-link" type="button">Create an account</button>
          </p>
          <div class="app-download">
            <p class="app-download-label">Get the app</p>
            ${appDownloadUrl
              ? `<a class="app-download-btn" id="app-download-btn" href="${appDownloadUrl}" rel="noopener">Download for your phone, computer or device</a>`
              : `<span class="app-download-btn is-unavailable" id="app-download-btn">App download coming soon</span>`}
            <p class="app-download-note">Windows app for the Microsoft Store, Android for Google Play.</p>
          </div>
          <p class="secondary-text" style="margin-top: 10px; font-size: 0.75rem; opacity: 0.6;">
            Server: <span id="server-status-label">${getApiBaseUrl() || 'Not configured'}</span>
            <button class="inline-link-button" id="configure-server-link" type="button" style="margin-left: 4px;">(set URL)</button>
          </p>
        </div>
      </div>
    </div>
  `;

  const codenameInput = document.getElementById('email');
  const passwordInput = document.getElementById('password');
  const rememberLoginInput = document.getElementById('remember-login-input');
  const rememberPasswordInput = document.getElementById('remember-password-input');
  if (rememberedCredentials) {
    codenameInput.value = rememberedCredentials.codename || '';
    passwordInput.value = rememberedCredentials.password || '';
  }

  rememberLoginInput.addEventListener('change', () => {
    if (!rememberLoginInput.checked) localStorage.removeItem('the-love-media-remembered-login');
  });
  restoreBrowserCredential(codenameInput, passwordInput, rememberPasswordInput);

  document.getElementById('login-btn').addEventListener('click', async () => {
    const codename = codenameInput.value.trim();
    const password = passwordInput.value;
    const status = document.getElementById('login-status');
    const loginButton = document.getElementById('login-btn');
    if (!codename || !password) {
      status.textContent = 'Enter your codename and password.';
      return;
    }
    loginButton.disabled = true;
    loginButton.classList.add('is-loading');
    loginButton.setAttribute('aria-busy', 'true');
    loginButton.textContent = 'Signing in...';
    try {
      const result = await accountApi('/api/login', { codename, password });
      currentProfileName = result.codename;
      currentSessionToken = result.sessionToken || '';
      currentProfileBio = result.profile?.bio || 'A little about you goes here.';
      currentProfileStatuses = result.profile?.statuses || [];
      currentConnectionStatus = result.profile?.connectionStatus || '';
      if (rememberLoginInput.checked) {
        localStorage.setItem('the-love-media-remembered-login', JSON.stringify({ codename }));
      }
      await rememberBrowserCredential(codename, password, rememberPasswordInput.checked);
      openWelcomePage();
    } catch (error) {
      const account = accounts.find((savedAccount) => savedAccount.codename.toLowerCase() === codename.toLowerCase());
      if (account?.password === password) {
        currentProfileName = account.codename;
        if (rememberLoginInput.checked) {
          localStorage.setItem('the-love-media-remembered-login', JSON.stringify({ codename }));
        }
        await rememberBrowserCredential(codename, password, rememberPasswordInput.checked);
        openWelcomePage();
      } else {
        status.textContent = error.message;
      }
    } finally {
      const currentLoginButton = document.getElementById('login-btn');
      if (currentLoginButton) {
        currentLoginButton.disabled = false;
        currentLoginButton.classList.remove('is-loading');
        currentLoginButton.removeAttribute('aria-busy');
        currentLoginButton.textContent = 'Log in';
      }
    }
  });
  document.getElementById('email').addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      document.getElementById('password').focus();
    }
  });
  document.getElementById('password').addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      document.getElementById('login-btn').click();
    }
  });
  document.getElementById('create-account-link').addEventListener('click', openCreateAccountPage);
  document.getElementById('forgot-password-link').addEventListener('click', openForgotPasswordPage);
  document.getElementById('configure-server-link')?.addEventListener('click', () => {
    const current = getApiBaseUrl() || 'https://';
    const entered = window.prompt('Enter your Koyeb backend URL (for example: https://my-app.koyeb.app):', current);
    if (entered && entered.trim() && entered.trim() !== 'https://') {
      const clean = entered.trim().replace(/\/+$/, '');
      localStorage.setItem('the-love-media-api-url', clean);
      apiBaseUrl = clean;
      webSocketBaseUrl = getWebSocketBaseUrl();
      const label = document.getElementById('server-status-label');
      if (label) label.textContent = clean;
    }
  });
}

function openForgotPasswordPage() {
  window.history.pushState({ screen: 'forgot-password' }, '', `${window.location.pathname}#forgot-password`);
  renderForgotPasswordPage();
}

function renderForgotPasswordPage() {
  app.innerHTML = `
    <div class="app-shell auth-shell">
      <div class="floating-hearts" aria-hidden="true">
        <span class="heart heart-1">♥</span>
        <span class="heart heart-2">♥</span>
        <span class="heart heart-3">♥</span>
        <span class="heart heart-4">♥</span>
        <span class="heart heart-5">♥</span>
        <span class="heart heart-6">♥</span>
      </div>

      <div class="auth-visual compact-visual">
        <div class="brand-badge">The Love Media</div>
        <h1>Reset your way back in.</h1>
        <p>Recover your account and get back to the rooms, friends, and conversations that matter.</p>
      </div>

      <div class="login-card">
        <div class="login-header">
          <div class="brand-row">
            <p class="eyebrow">Recovery</p>
            <span class="account-count">${accountCountLabel()}</span>
          </div>
          <h1>Forgot password?</h1>
          <p>Enter your Password Reset Key and we’ll help you get back in.</p>
        </div>

        <div class="form-group">
          <label for="reset-codename">Codename</label>
          <input id="reset-codename" type="text" placeholder="Enter your codename" />
        </div>

        <div class="form-group">
          <label for="reset-key-input">Password Reset Key</label>
          <div class="password-input-wrap">
            <input id="reset-key-input" type="password" placeholder="Enter your reset key" />
            <button class="password-visibility-btn" id="toggle-reset-key-btn" type="button" aria-label="Show reset key">Show</button>
          </div>
        </div>

        <div class="form-group">
          <label for="new-password-input">New password</label>
          <input id="new-password-input" type="password" placeholder="Create a new password" />
        </div>

        <button class="primary-btn" id="reset-btn">Reset password</button>
        <p class="form-status" id="reset-status" aria-live="polite"></p>

        <div class="form-footer">
          <p class="secondary-text">
            Remembered it? <button class="inline-link-button" id="return-to-login-link" type="button">Back to login</button>
          </p>
        </div>
      </div>
    </div>
  `;

  document.getElementById('reset-btn').addEventListener('click', async () => {
    const codename = document.getElementById('reset-codename').value.trim();
    const resetKey = document.getElementById('reset-key-input').value;
    const newPassword = document.getElementById('new-password-input').value;
    const status = document.getElementById('reset-status');
    if (!codename || !resetKey || !newPassword) {
      status.textContent = 'Enter your codename, reset key, and new password.';
      return;
    }
    try {
      await accountApi('/api/reset-password', { codename, resetKey, newPassword });
      status.textContent = 'Password reset successfully. You can now log in.';
      window.setTimeout(renderLoginPage, 700);
    } catch (error) {
      status.textContent = error.message;
    }
  });
  document.getElementById('toggle-reset-key-btn').addEventListener('click', () => {
    const resetKeyInput = document.getElementById('reset-key-input');
    const isVisible = resetKeyInput.type === 'text';
    resetKeyInput.type = isVisible ? 'password' : 'text';
    document.getElementById('toggle-reset-key-btn').textContent = isVisible ? 'Show' : 'Hide';
    document.getElementById('toggle-reset-key-btn').setAttribute('aria-label', `${isVisible ? 'Show' : 'Hide'} reset key`);
  });
  document.getElementById('return-to-login-link').addEventListener('click', (event) => {
    event.preventDefault();
    renderLoginPage();
  });
}

function openCreateAccountPage() {
  window.history.pushState({ screen: 'create-account' }, '', `${window.location.pathname}#create-account`);
  renderCreateAccountPage();
}

function renderCreateAccountPage() {
  app.innerHTML = `
    <div class="app-shell auth-shell">
      <div class="floating-hearts" aria-hidden="true">
        <span class="heart heart-1">♥</span>
        <span class="heart heart-2">♥</span>
        <span class="heart heart-3">♥</span>
        <span class="heart heart-4">♥</span>
        <span class="heart heart-5">♥</span>
        <span class="heart heart-6">♥</span>
      </div>

      <div class="auth-visual compact-visual">
        <div class="brand-badge">The Love Media</div>
        <h1>Join the circle.</h1>
        <p>Meet new friends, jump into live rooms, and share your energy with a community that gets it.</p>
      </div>

      <div class="login-card">
        <div class="login-header">
          <div class="brand-row">
            <p class="eyebrow">Create account</p>
            <span class="account-count">${accountCountLabel()}</span>
          </div>
          <h1>Create an account</h1>
          <p>Join the circle and start finding your people.</p>
        </div>

        <div class="form-group">
          <label for="new-codename">Codename</label>
          <input id="new-codename" type="text" placeholder="Choose your codename" />
        </div>

        <div class="form-group">
          <label for="reset-key">Password Reset Key- What do you love about Life?</label>
          <input id="reset-key" type="text" placeholder="Enter reset key" />
        </div>

        <div class="form-group">
          <label for="new-password">Password</label>
          <input id="new-password" type="password" placeholder="Create a password" />
        </div>

        <button class="primary-btn" id="create-account-btn">Create account</button>
        <p class="form-status" id="create-account-status" aria-live="polite"></p>

        <div class="form-footer">
          <p class="secondary-text">
            Already have an account? <button class="inline-link-button" id="back-to-login-link" type="button">Log in</button>
          </p>
        </div>
      </div>
    </div>
  `;

  document.getElementById('create-account-btn').addEventListener('click', async () => {
    const codename = document.getElementById('new-codename').value.trim();
    const resetKey = document.getElementById('reset-key').value.trim();
    const password = document.getElementById('new-password').value;
    const status = document.getElementById('create-account-status');

    if (!codename || !resetKey || !password) {
      status.textContent = 'Complete all fields to create your account.';
      return;
    }
    try {
      await accountApi('/api/accounts', { codename, resetKey, password });
      accounts = [...accounts, { codename }];
      localStorage.setItem('the-love-media-accounts', JSON.stringify(accounts));
      currentProfileName = codename;
      status.textContent = 'Account created. You can now log in.';
      window.setTimeout(renderLoginPage, 700);
    } catch (error) {
      status.textContent = error.message;
    }
  });
  document.getElementById('back-to-login-link').addEventListener('click', (event) => {
    event.preventDefault();
    renderLoginPage();
  });
}

function getVideoComments() {
  try {
    return JSON.parse(localStorage.getItem('the-love-media-video-comments') || '{}');
  } catch {
    return {};
  }
}

function saveVideoComments(comments) {
  localStorage.setItem('the-love-media-video-comments', JSON.stringify(comments));
}

function videoFileUrl(video) {
  return `${apiBaseUrl}/api/videos/${encodeURIComponent(video.id)}`;
}

function videoAuthHeaders(extra = {}) {
  return currentSessionToken ? { ...extra, Authorization: `Bearer ${currentSessionToken}` } : extra;
}

async function fetchVideos(kind) {
  if (!apiBaseUrl) throw new Error('Video sharing needs the online app.');
  const response = await fetch(`${apiBaseUrl}/api/videos?kind=${encodeURIComponent(kind)}`);
  if (!response.ok) throw new Error('Could not load the videos.');
  const payload = await response.json().catch(() => ({}));
  return Array.isArray(payload.videos) ? payload.videos : [];
}

async function uploadVideo(kind, blob, { title, topic } = {}) {
  const params = new URLSearchParams({ kind });
  if (title) params.set('title', title);
  if (topic) params.set('topic', topic);
  const response = await fetch(`${apiBaseUrl}/api/videos?${params.toString()}`, {
    method: 'POST',
    headers: videoAuthHeaders({ 'Content-Type': blob.type || 'video/webm' }),
    body: blob
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || 'The video could not be uploaded.');
  return payload.video;
}

async function removeVideo(videoId) {
  const response = await fetch(`${apiBaseUrl}/api/videos/${encodeURIComponent(videoId)}`, {
    method: 'DELETE',
    headers: videoAuthHeaders()
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || 'That video could not be removed.');
}

function renderVideoSource(video) {
  return `<video class="saved-video-preview" controls preload="metadata" playsinline src="${videoFileUrl(video)}"></video>`;
}

async function downloadVideo(video) {
  const response = await fetch(videoFileUrl(video));
  if (!response.ok) throw new Error('That video could not be downloaded.');
  const blob = await response.blob();
  const extension = String(blob.type || '').includes('mp4') ? 'mp4' : 'webm';
  const name = String(video.title || 'video')
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase() || 'video';
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${name}.${extension}`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10000);
}

function renderVideoComments(video, canDelete = false) {
  const comments = getVideoComments()[video.id] || [];
  return `
    <div class="video-actions">
      <button class="secondary-btn small-btn" data-video-download="${video.id}" type="button" title="Save the clip, then upload it to Facebook, Instagram or TikTok">Download</button>
      ${canDelete ? `<button class="danger-btn small-btn" data-video-delete="${video.id}" type="button">Delete video</button>` : ''}
    </div>
    <div class="video-comments">
      <strong>Comments</strong>
      ${comments.length ? comments.map((comment) => `
        <p><b>${comment.author || 'Member'}</b> ${comment.text}</p>
      `).join('') : '<p class="video-comments-empty">No comments yet.</p>'}
      <form class="video-comment-form" data-video-comment="${video.id}">
        <input name="comment" type="text" maxlength="240" placeholder="Leave a comment" required />
        <button class="small-btn" type="submit">Post</button>
      </form>
    </div>
  `;
}

function bindVideoInteractions(list, kind, videos, canDelete) {
  list.querySelectorAll('[data-video-download]').forEach((button) => {
    button.addEventListener('click', async () => {
      const video = videos.find((item) => item.id === button.dataset.videoDownload);
      if (!video) return;
      button.disabled = true;
      try {
        await downloadVideo(video);
      } catch (error) {
        window.alert(error.message);
      } finally {
        button.disabled = false;
      }
    });
  });

  list.querySelectorAll('[data-video-delete]').forEach((button) => {
    button.addEventListener('click', async () => {
      if (!window.confirm('Delete this video?')) return;
      button.disabled = true;
      try {
        await removeVideo(button.dataset.videoDelete);
        await loadVideosInto(list, kind, canDelete);
      } catch (error) {
        button.disabled = false;
        window.alert(error.message);
      }
    });
  });

  list.querySelectorAll('.video-comment-form').forEach((form) => {
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const text = form.elements.comment.value.trim();
      if (!text) return;
      const videoId = form.dataset.videoComment;
      const comments = getVideoComments();
      comments[videoId] = [
        ...(comments[videoId] || []),
        { id: crypto.randomUUID(), author: currentProfileName, text, createdAt: Date.now() }
      ];
      saveVideoComments(comments);
      renderVideoListInto(list, kind, videos, canDelete);
    });
  });
}

function renderVideoListInto(list, kind, videos, canDelete) {
  list.innerHTML = kind === 'blog'
    ? renderBlogTopicList(videos, canDelete)
    : renderWelcomeVideoList(videos, canDelete);
  bindVideoInteractions(list, kind, videos, canDelete);
}

async function loadVideosInto(list, kind, canDelete) {
  if (!list) return;
  list.innerHTML = '<p class="private-message-status">Loading videos...</p>';
  try {
    const videos = await fetchVideos(kind);
    if (list.isConnected) renderVideoListInto(list, kind, videos, canDelete);
  } catch (error) {
    if (list.isConnected) {
      list.innerHTML = `<p class="private-message-status">${error.message}</p>`;
    }
  }
}

function renderWelcomeVideoList(videos, canDelete = false) {
  return videos.length ? videos.map((video) => `
    <div class="private-message-item video-item" style="display:block; margin-bottom:12px;">
      <strong>${video.title || 'Welcome video'}</strong>
      <div style="margin-top: 8px;">${renderVideoSource(video)}</div>
      ${renderVideoComments(video, canDelete)}
    </div>
  `).join('') : '<p class="private-message-status">No welcome videos yet.</p>';
}

/**
 * Starts the video‑recorder UI and handles camera / microphone access.
 * Shows a readable alert if the API is missing or permission is denied.
 * Includes a fallback to the legacy navigator.getUserMedia for older browsers.
 * The modal is attached to document.body and a minimal backdrop style is added.
 */
function startVideoRecorder({ titleInput, topicInput, status, onSave }) {
  // ---------------------------------------------------------------
  // 1️⃣ Verify required media APIs – show an alert instead of silent fail
  // ---------------------------------------------------------------
  if (!navigator.mediaDevices?.getUserMedia && !navigator.getUserMedia) {
    const msg = 'Your browser does not support video recording.';
    alert(msg);
    if (status) status.textContent = msg;
    return;
  }

  // ---------------------------------------------------------------
  // 2️⃣ Build modal UI and attach it to document.body for guaranteed visibility
  // ---------------------------------------------------------------
  const recorderModal = document.createElement('div');
  recorderModal.className = 'profile-editor-modal';
  recorderModal.id = 'video-recorder-modal';
  recorderModal.innerHTML = `
    <div class="profile-editor-card video-recorder-card">
      <p class="eyebrow">Create a video</p>
      <h3>Record your update</h3>
      <video id="video-recorder-preview" class="video-recorder-preview" autoplay muted playsinline></video>
      <p class="private-message-status" id="video-recorder-status" aria-live="polite">Camera is ready when you are.</p>
      <div class="profile-editor-actions">
        <button class="primary-btn" id="start-recording-btn" type="button">Start recording</button>
        <button class="danger-btn" id="stop-recording-btn" type="button" disabled>Stop</button>
        <button class="secondary-btn" id="cancel-recording-btn" type="button">Cancel</button>
      </div>
    </div>
  `;

  // Minimal inline backdrop style (fallback if external CSS missing)
  const style = document.createElement('style');
  style.textContent = `
    .profile-editor-modal { position: fixed; inset: 0; background: rgba(0,0,0,0.5); display: flex; align-items: center; justify-content: center; z-index: 9999; }
    .video-recorder-card { background:#fff; padding:1.5rem; border-radius:8px; max-width:480px; width:90%; box-shadow:0 4px 12px rgba(0,0,0,0.15); }
  `;
  document.head.appendChild(style);
  document.body.appendChild(recorderModal);

  // ---------------------------------------------------------------
  // 3️⃣ Grab UI handles
  // ---------------------------------------------------------------
  const preview = document.getElementById('video-recorder-preview');
  const recorderStatus = document.getElementById('video-recorder-status');
  const startButton = document.getElementById('start-recording-btn');
  const stopButton = document.getElementById('stop-recording-btn');
  const cancelButton = document.getElementById('cancel-recording-btn');

  let stream;   // MediaStream from getUserMedia
  let recorder; // MediaRecorder instance
  let chunks = []; // Media data chunks

  // ---------------------------------------------------------------
  // 4️⃣ Helper to clean up and close modal
  // ---------------------------------------------------------------
  const closeRecorder = () => {
    stream?.getTracks().forEach((track) => track.stop());
    recorderModal.remove();
    style.remove();
  };

  cancelButton.addEventListener('click', closeRecorder);

  // ---------------------------------------------------------------
  // 5️⃣ Start recording – request media, handle errors, fallback API
  // ---------------------------------------------------------------
  startButton.addEventListener('click', async () => {
    try {
      const constraints = { video: true, audio: true };
      // Prefer modern API, fallback to legacy if needed
      stream = await (navigator.mediaDevices?.getUserMedia?.bind(navigator.mediaDevices) ||
                     navigator.getUserMedia?.bind(navigator))(constraints);
      preview.srcObject = stream;
      chunks = [];
      const mimeType = pickRecorderMimeType({ hasAudio: stream.getAudioTracks().length > 0 });
      recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      recorder.addEventListener('dataavailable', (e) => {
        if (e.data && e.data.size) chunks.push(e.data);
      });
      recorder.addEventListener('stop', async () => {
        const blob = new Blob(chunks, { type: String(recorder.mimeType || 'video/webm').split(';')[0] });
        if (!blob.size) {
          recorderStatus.textContent = 'Nothing was recorded. Record for a few seconds, then stop.';
          startButton.disabled = false;
          return;
        }
        recorderStatus.textContent = 'Saving your video...';
        try {
          await onSave(blob);
          closeRecorder();
        } catch (error) {
          const outOfSpace = error && (error.name === 'QuotaExceededError' || error.name === 'NS_ERROR_DOM_QUOTA_REACHED');
          recorderStatus.textContent = outOfSpace
            ? 'Your browser is out of storage space. Delete an old video, then record this one again.'
            : `The video could not be saved: ${error?.message || error}`;
        }
      }, { once: true });
      recorder.start();
      startButton.disabled = true;
      stopButton.disabled = false;
      recorderStatus.textContent = 'Recording now. Share what is happening.';
    } catch (err) {
      const isPermission = err && (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError');
      const msg = isPermission
        ? 'Camera and microphone access was blocked. Please allow permissions and try again.'
        : `Unable to start video recording: ${err?.message || err}`;
      alert(msg);
      if (status) status.textContent = msg;
    }
  });

  // ---------------------------------------------------------------
  // 6️⃣ Stop recording – finalize video and invoke onSave
  // ---------------------------------------------------------------
  stopButton.addEventListener('click', () => {
    if (recorder?.state === 'recording') {
      recorder.stop();
      stopButton.disabled = true;
      recorderStatus.textContent = 'Saving your video...';
    }
  });
}


function getBlogTopics(videos) {
  const defaultTopics = ['Welcome', 'Updates', 'Community', 'Events', 'Spotlight'];
  const existingTopics = videos
    .map((video) => String(video.topic || 'Welcome').trim())
    .filter(Boolean);

  return [...new Set([...defaultTopics, ...existingTopics])];
}

function renderBlogTopicList(videos, canDelete = false) {
  const topics = getBlogTopics(videos);

  if (!videos.length) {
    return '<p class="private-message-status">No blog videos yet.</p>';
  }

  return topics.map((topic) => {
    const topicVideos = videos.filter((video) => (video.topic || 'Welcome') === topic);

    return `
      <div class="private-message-item" style="display:block; margin-bottom:18px;">
        <strong style="display:block; margin-bottom:8px;">${topic}</strong>
        ${topicVideos.map((video) => `
          <div style="margin-bottom:10px; padding-left:10px; border-left:2px solid rgba(255,255,255,0.15);">
            <div><strong>${video.title || 'Blog video'}</strong></div>
            <div style="margin-top:4px;">${renderVideoSource(video)}</div>
            ${renderVideoComments(video, canDelete)}
          </div>
        `).join('')}
      </div>
    `;
  }).join('');
}

// MP4 (H.264 + AAC) is the format Facebook, Instagram and the other social
// sites accept, so it is tried first; browsers without it fall back to WebM.
function pickRecorderMimeType({ hasAudio = true } = {}) {
  const options = [
    hasAudio ? 'video/mp4;codecs=avc1.42E01E,mp4a.40.2' : 'video/mp4;codecs=avc1.42E01E',
    'video/mp4',
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm'
  ];
  return options.find((type) => window.MediaRecorder?.isTypeSupported?.(type)) || '';
}

function mixAudioTracks(tracks) {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass || !tracks.length) return { track: null, stop: () => {} };

  try {
    const context = new AudioContextClass();
    const destination = context.createMediaStreamDestination();
    tracks.forEach((track) => {
      const source = context.createMediaStreamSource(new MediaStream([track]));
      const gain = context.createGain();
      gain.gain.value = 1;
      source.connect(gain);
      gain.connect(destination);
    });
    return {
      track: destination.stream.getAudioTracks()[0] || null,
      stop: () => {
        try {
          context.close();
        } catch {
          // The audio context is already closed.
        }
      }
    };
  } catch (error) {
    console.warn('Could not combine the audio tracks', error);
    return { track: null, stop: () => {} };
  }
}

function createScreenComposite(screenStream, webcamStream) {
  const canvas = document.createElement('canvas');
  // Match the shape of whatever is being shared, so a window or a tall screen
  // is never squeezed into a fixed 16:9 frame with bars or a cropped page.
  const settings = screenStream.getVideoTracks()[0]?.getSettings?.() || {};
  const sourceWidth = Number(settings.width) || 1280;
  const sourceHeight = Number(settings.height) || 720;
  const fit = Math.min(1, 1920 / sourceWidth, 1080 / sourceHeight);
  canvas.width = Math.max(2, Math.round((sourceWidth * fit) / 2) * 2);
  canvas.height = Math.max(2, Math.round((sourceHeight * fit) / 2) * 2);

  const context = canvas.getContext('2d');
  const screenVideo = document.createElement('video');
  screenVideo.srcObject = screenStream;
  screenVideo.muted = true;
  screenVideo.playsInline = true;
  screenVideo.play().catch(() => {});

  let webcamVideo = null;
  if (webcamStream) {
    webcamVideo = document.createElement('video');
    webcamVideo.srcObject = webcamStream;
    webcamVideo.muted = true;
    webcamVideo.playsInline = true;
    webcamVideo.play().catch(() => {});
  }

  // Some capture sources only report their size once the frames arrive, so the
  // canvas is re-shaped to the real source before recording starts.
  const matchSourceShape = () => {
    if (!screenVideo.videoWidth || !screenVideo.videoHeight) return;
    const target = screenVideo.videoWidth / screenVideo.videoHeight;
    if (Math.abs(canvas.width / canvas.height - target) < 0.01) return;
    const fit = Math.min(1, 1920 / screenVideo.videoWidth, 1080 / screenVideo.videoHeight);
    canvas.width = Math.max(2, Math.round((screenVideo.videoWidth * fit) / 2) * 2);
    canvas.height = Math.max(2, Math.round((screenVideo.videoHeight * fit) / 2) * 2);
  };

  const draw = () => {
    matchSourceShape();
    context.fillStyle = '#000';
    context.fillRect(0, 0, canvas.width, canvas.height);

    if (screenVideo.videoWidth) {
      const scale = Math.min(canvas.width / screenVideo.videoWidth, canvas.height / screenVideo.videoHeight);
      const width = screenVideo.videoWidth * scale;
      const height = screenVideo.videoHeight * scale;
      context.drawImage(screenVideo, (canvas.width - width) / 2, (canvas.height - height) / 2, width, height);
    }

    if (webcamVideo?.videoWidth) {
      const insetWidth = Math.round(canvas.width * 0.22);
      const insetHeight = Math.round(insetWidth * (webcamVideo.videoHeight / webcamVideo.videoWidth));
      const x = canvas.width - insetWidth - 24;
      const y = canvas.height - insetHeight - 24;
      context.fillStyle = 'rgba(255, 255, 255, 0.85)';
      context.fillRect(x - 4, y - 4, insetWidth + 8, insetHeight + 8);
      context.drawImage(webcamVideo, x, y, insetWidth, insetHeight);
    }
  };

  // Animation frames stop while the tab is hidden, which would freeze a recording
  // made in another window, so a hidden tab falls back to a slower timer.
  let frameId = 0;
  let intervalId = 0;
  const loop = () => {
    draw();
    frameId = window.requestAnimationFrame(loop);
  };
  const stopLoop = () => {
    if (frameId) window.cancelAnimationFrame(frameId);
    if (intervalId) window.clearInterval(intervalId);
    frameId = 0;
    intervalId = 0;
  };
  const startLoop = () => {
    stopLoop();
    if (document.hidden) intervalId = window.setInterval(draw, 250);
    else frameId = window.requestAnimationFrame(loop);
  };
  const onVisibilityChange = () => startLoop();

  document.addEventListener('visibilitychange', onVisibilityChange);
  startLoop();
  draw();

  return {
    canvas,
    stop: () => {
      stopLoop();
      document.removeEventListener('visibilitychange', onVisibilityChange);
    }
  };
}

function openScreenRecorder({ label = 'Welcome & updates', withWebcam = false, onSave } = {}) {
  if (!navigator.mediaDevices?.getDisplayMedia) {
    window.alert('Screen recording is not available in this browser.');
    return;
  }
  if (!window.MediaRecorder) {
    window.alert('This browser cannot record video.');
    return;
  }

  (async () => {
    let screenStream;
    try {
      screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
    } catch (error) {
      if (error?.name !== 'NotAllowedError') console.warn('Screen capture failed', error);
      return;
    }

    let webcamStream = null;
    try {
      webcamStream = await navigator.mediaDevices.getUserMedia(withWebcam ? { video: true, audio: true } : { audio: true });
    } catch (error) {
      // Without a camera or microphone the screen is still recorded.
      console.warn('Webcam or microphone unavailable', error);
    }

    const existing = document.getElementById('screen-recorder-modal');
    if (existing) existing.remove();

    const hasWebcam = Boolean(webcamStream?.getVideoTracks().length);
    const modal = document.createElement('div');
    modal.className = 'profile-editor-modal';
    modal.id = 'screen-recorder-modal';
    modal.innerHTML = `
      <div class="profile-editor-card video-recorder-card">
        <p class="eyebrow">${label}</p>
        <h3>${hasWebcam ? 'Record screen & webcam' : 'Record screen'}</h3>
        <div class="screen-recorder-preview" id="screen-recorder-preview"></div>
        <p class="private-message-status" id="screen-recorder-status" aria-live="polite">
          ${hasWebcam ? 'Screen and webcam are ready.' : 'Screen is ready.'} Press Start recording.
        </p>
        <div class="profile-editor-actions">
          <button class="primary-btn" id="start-screen-recording-btn" type="button">Start recording</button>
          <button class="danger-btn" id="stop-screen-recording-btn" type="button" disabled>Stop &amp; save</button>
          <button class="secondary-btn" id="cancel-screen-recording-btn" type="button">Cancel</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    const preview = document.getElementById('screen-recorder-preview');
    const status = document.getElementById('screen-recorder-status');
    const startButton = document.getElementById('start-screen-recording-btn');
    const stopButton = document.getElementById('stop-screen-recording-btn');
    const cancelButton = document.getElementById('cancel-screen-recording-btn');

    const composite = hasWebcam ? createScreenComposite(screenStream, webcamStream) : null;
    if (composite) {
      preview.appendChild(composite.canvas);
    } else {
      const screenVideo = document.createElement('video');
      screenVideo.srcObject = screenStream;
      screenVideo.autoplay = true;
      screenVideo.muted = true;
      screenVideo.playsInline = true;
      preview.appendChild(screenVideo);
    }

    let recorder = null;
    let chunks = [];
    let mixer = null;
    let shareWatchId = 0;
    let cancelled = false;
    let closed = false;

    const cleanup = () => {
      if (closed) return;
      closed = true;
      window.clearInterval(shareWatchId);
      screenStream.getTracks().forEach((track) => track.stop());
      webcamStream?.getTracks().forEach((track) => track.stop());
      composite?.stop();
      mixer?.stop();
      modal.remove();
    };

    const finish = async (blob) => {
      if (!blob.size) {
        status.textContent = 'Nothing was recorded. Record for a few seconds, then stop.';
        startButton.disabled = false;
        stopButton.disabled = true;
        return;
      }
      if (blob.size > 40 * 1024 * 1024) {
        status.textContent = 'That recording is larger than 40 MB. Record a shorter clip.';
        startButton.disabled = false;
        stopButton.disabled = true;
        return;
      }
      status.textContent = 'Saving your recording...';
      try {
        await onSave(blob);
        cleanup();
      } catch (error) {
        status.textContent = `The recording could not be saved: ${error?.message || error}`;
        startButton.disabled = false;
        stopButton.disabled = true;
      }
    };

    startButton.addEventListener('click', () => {
      mixer?.stop();
      mixer = mixAudioTracks([
        ...screenStream.getAudioTracks(),
        ...(webcamStream?.getAudioTracks() || [])
      ]);

      const tracks = composite
        ? composite.canvas.captureStream(30).getVideoTracks()
        : screenStream.getVideoTracks();
      const recorderTracks = [...tracks];
      if (mixer.track) recorderTracks.push(mixer.track);
      const mimeType = pickRecorderMimeType({
        hasAudio: recorderTracks.some((track) => track.kind === 'audio')
      });

      chunks = [];
      try {
        recorder = new MediaRecorder(new MediaStream(recorderTracks), mimeType ? { mimeType } : undefined);
      } catch (error) {
        status.textContent = `Recording could not start: ${error?.message || error}`;
        return;
      }

      recorder.addEventListener('dataavailable', (event) => {
        if (event.data && event.data.size) chunks.push(event.data);
      });
      recorder.addEventListener('stop', () => {
        const type = String(recorder.mimeType || mimeType || 'video/webm').split(';')[0];
        const blob = new Blob(chunks, { type });
        if (cancelled) {
          cleanup();
          return;
        }
        finish(blob);
      }, { once: true });

      recorder.start();
      startButton.disabled = true;
      stopButton.disabled = false;
      status.textContent = 'Recording now. Switch to the window you are showing, then press Stop & save.';

      // Chrome's own "Stop sharing" button ends the track without always firing
      // an ended event, so the track state is watched as well.
      window.clearInterval(shareWatchId);
      shareWatchId = window.setInterval(() => {
        if (screenStream.getVideoTracks()[0]?.readyState === 'ended') stopRecording();
      }, 1000);
    });

    const stopRecording = () => {
      if (recorder?.state !== 'recording') return;
      window.clearInterval(shareWatchId);
      recorder.stop();
      stopButton.disabled = true;
      status.textContent = 'Saving your recording...';
    };

    stopButton.addEventListener('click', stopRecording);
    screenStream.getVideoTracks()[0]?.addEventListener('ended', () => {
      if (recorder?.state === 'recording') stopRecording();
    }, { once: true });
    cancelButton.addEventListener('click', () => {
      cancelled = true;
      if (recorder?.state === 'recording') recorder.stop();
      cleanup();
    });
  })();
}

function openWelcomeVideosModal() {
  const existingModal = document.getElementById('welcome-videos-modal');
  if (existingModal) existingModal.remove();

  const isGayjesus = currentProfileName.toLowerCase() === 'gayjesus';

  const modal = document.createElement('div');
  modal.className = 'profile-editor-modal';
  modal.id = 'welcome-videos-modal';
  modal.innerHTML = `
    <div class="profile-editor-card donation-card">
      <p class="eyebrow">Welcome & updates</p>
      <h3>Welcome videos</h3>
      <p>Fresh drops and welcomes for the room.</p>

      ${isGayjesus ? `
        <div class="form-group" style="margin-top: 16px;">
          <label for="welcome-video-title">Video title</label>
          <input id="welcome-video-title" type="text" placeholder="Welcome reel title" />
        </div>
        <div class="profile-editor-actions video-actions" style="margin-top: 12px;">
          <button class="small-btn" id="record-welcome-video-btn" type="button">Record video</button>
          <button class="small-btn" id="start-welcome-screen-share-btn" type="button">Record screen</button>
          <button class="small-btn" id="start-welcome-screen-webcam-btn" type="button">Record screen & webcam</button>
        </div>
        <p class="private-message-status" id="welcome-video-status" aria-live="polite"></p>
      ` : `
        <p class="private-message-status" aria-live="polite">Only Gayjesus can add welcome videos.</p>
      `}

      <div class="friends-list" id="welcome-videos-list" style="margin-top: 18px;">
        <p class="private-message-status">Loading videos...</p>
      </div>

      <div class="profile-editor-actions" style="margin-top: 18px;">
        <button class="secondary-btn" id="close-welcome-videos-btn" type="button">Back</button>
      </div>
    </div>
  `;


document.body.appendChild(modal);

const welcomeVideosList = document.getElementById('welcome-videos-list');
loadVideosInto(welcomeVideosList, 'welcome', isGayjesus);

if (isGayjesus) {
  const titleInput = document.getElementById('welcome-video-title');
  const status = document.getElementById('welcome-video-status');
  const saveWelcomeClip = async (blob, fallbackTitle) => {
    await uploadVideo('welcome', blob, { title: titleInput.value.trim() || fallbackTitle });
    await loadVideosInto(welcomeVideosList, 'welcome', isGayjesus);
    status.textContent = 'Video added to welcome & updates.';
  };
  document.getElementById('record-welcome-video-btn').addEventListener('click', () => {
    startVideoRecorder({
      titleInput,
      status,
      onSave: (blob) => saveWelcomeClip(blob, 'Welcome update')
    });
  });
  document.getElementById('start-welcome-screen-share-btn').addEventListener('click', () => {
    openScreenRecorder({
      label: 'Welcome & updates',
      onSave: (blob) => saveWelcomeClip(blob, 'Screen recording')
    });
  });
  document.getElementById('start-welcome-screen-webcam-btn').addEventListener('click', () => {
    openScreenRecorder({
      label: 'Welcome & updates',
      withWebcam: true,
      onSave: (blob) => saveWelcomeClip(blob, 'Screen & webcam recording')
    });
  });
}

document.getElementById('close-welcome-videos-btn').addEventListener('click', () => {
  document.getElementById('welcome-videos-modal').remove();
});
}

function openWelcomeVideosPage() {
  openWelcomeVideosModal();
}

function openGayjesusBlogPage() {
  openGayjesusBlogModal();
}

function openGayjesusBlogModal() {
  const existingModal = document.getElementById('gayjesus-blog-modal');
  if (existingModal) existingModal.remove();

  const isGayjesus = currentProfileName.toLowerCase() === 'gayjesus';

  const modal = document.createElement('div');
  modal.className = 'profile-editor-modal';
  modal.id = 'gayjesus-blog-modal';
  modal.innerHTML = `
    <div class="profile-editor-card donation-card gayjesus-blog-card">
      <p class="eyebrow">Gayjesus</p>
      <h3>Blog & topic videos</h3>
      <p>Create videos in separate topics and keep them apart from the welcome videos.</p>

      <div class="church-feature-card">
        <p class="panel-label">Church where I reside</p>
        <h4>Phoenix Community Church UCC</h4>
        <p>Progressive and inclusive Open and Affirming congregation in Kalamazoo, Michigan.</p>
        <p class="church-feature-address">345 W. Michigan Ave., Kalamazoo, MI 49007</p>
        <a class="small-btn church-feature-link" href="https://www.phoenixcommunitychurch.org/" target="_blank" rel="noopener noreferrer">Visit church website</a>
      </div>

      ${isGayjesus ? `
        <div class="form-group" style="margin-top: 16px;">
          <label for="blog-video-title">Video title</label>
          <input id="blog-video-title" type="text" placeholder="Topic video title" />
        </div>
        <div class="form-group">
          <label for="blog-custom-topic">Topic</label>
          <input id="blog-custom-topic" type="text" placeholder="Example: Dating, Advice, Lifestyle" />
        </div>
        <div class="profile-editor-actions video-actions" style="margin-top: 12px;">
          <button class="small-btn" id="record-blog-video-btn" type="button">Record video</button>
          <button class="small-btn" id="start-blog-screen-share-btn" type="button">Record screen</button>
          <button class="small-btn" id="start-blog-screen-webcam-btn" type="button">Record screen & webcam</button>
        </div>
        <p class="private-message-status" id="blog-video-status" aria-live="polite"></p>
      ` : `
        <p class="private-message-status" aria-live="polite">Only Gayjesus can add blog videos.</p>
      `}

      <div class="friends-list" id="gayjesus-blog-list" style="margin-top: 18px;">
        <p class="private-message-status">Loading videos...</p>
      </div>

      <div class="profile-editor-actions" style="margin-top: 18px;">
        <button class="secondary-btn" id="close-gayjesus-blog-btn" type="button">Close</button>
      </div>
    </div>
  `;


document.body.appendChild(modal);

const blogVideosList = document.getElementById('gayjesus-blog-list');
loadVideosInto(blogVideosList, 'blog', isGayjesus);

if (isGayjesus) {
  const titleInput = document.getElementById('blog-video-title');
  const customTopicInput = document.getElementById('blog-custom-topic');
  const status = document.getElementById('blog-video-status');
  const saveBlogClip = async (blob, fallbackTitle) => {
    const topic = customTopicInput.value.trim();
    await uploadVideo('blog', blob, {
      title: titleInput.value.trim() || (topic ? 'Topic update' : fallbackTitle),
      topic
    });
    await loadVideosInto(blogVideosList, 'blog', isGayjesus);
    status.textContent = 'Video added to the blog.';
  };
  document.getElementById('record-blog-video-btn').addEventListener('click', () => {
    startVideoRecorder({
      titleInput,
      topicInput: customTopicInput,
      status,
      onSave: (blob) => saveBlogClip(blob, 'Welcome update')
    });
  });
  document.getElementById('start-blog-screen-share-btn').addEventListener('click', () => {
    openScreenRecorder({
      label: 'Gayjesus blog',
      onSave: (blob) => saveBlogClip(blob, 'Screen recording')
    });
  });
  document.getElementById('start-blog-screen-webcam-btn').addEventListener('click', () => {
    openScreenRecorder({
      label: 'Gayjesus blog',
      withWebcam: true,
      onSave: (blob) => saveBlogClip(blob, 'Screen & webcam recording')
    });
  });
}

document.getElementById('close-gayjesus-blog-btn').addEventListener('click', () => {
  document.getElementById('gayjesus-blog-modal').remove();
});
}

function openWelcomePage() {
  window.history.pushState({ screen: 'welcome' }, '', `${window.location.pathname}#welcome`);
  renderNextPage();
}

function renderNextPage() {
  app.innerHTML = `
    <div class="app-shell">
      <div class="floating-hearts welcome-hearts" aria-hidden="true">
        <span class="heart heart-1">♥</span>
        <span class="heart heart-2">♥</span>
        <span class="heart heart-3">♥</span>
        <span class="heart heart-4">♥</span>
        <span class="heart heart-5">♥</span>
        <span class="heart heart-6">♥</span>
      </div>
      <div class="welcome-card">
        <div class="brand-row">
          <p class="eyebrow">The Love Media</p>
          <span class="account-count">${accountCountLabel()}</span>
        </div>
        <h1>You're in.</h1>
        <p>Welcome to your next space for connection, conversation, and community.</p>
        <button class="primary-btn" id="chatroom-btn">Go to chatroom workspace</button>
        <button class="secondary-btn" id="welcome-videos-btn">Welcome & updates videos</button>
        <button class="secondary-btn" id="gayjesus-blog-btn">Gayjesus blog</button>
        <button class="secondary-btn" id="back-btn">Back to login</button>
        <button class="danger-btn" id="delete-account-btn">Delete account</button>
        <p class="form-status" id="account-delete-status" aria-live="polite"></p>
      </div>
    </div>
  `;

  document.getElementById('chatroom-btn').addEventListener('click', openChatroomWorkspacePage);
  document.getElementById('welcome-videos-btn').addEventListener('click', openWelcomeVideosPage);
  document.getElementById('gayjesus-blog-btn').addEventListener('click', openGayjesusBlogPage);
  document.getElementById('back-btn').addEventListener('click', () => {
    currentSessionToken = '';
    roomPresenceSocket?.close();
    roomPresenceSocket = null;
    renderLoginPage();
  });
  document.getElementById('delete-account-btn').addEventListener('click', async () => {
    const status = document.getElementById('account-delete-status');
    if (!window.confirm('Delete your account permanently?')) return;

    try {
      await accountApi('/api/delete-account', { codename: currentProfileName });
      accounts = accounts.filter((account) => account.codename.toLowerCase() !== currentProfileName.toLowerCase());
      localStorage.removeItem('the-love-media-profile');
      localStorage.removeItem('the-love-media-friends');
      status.textContent = 'Account deleted.';
      window.setTimeout(renderLoginPage, 700);
    } catch (error) {
      status.textContent = error.message;
    }
  });
}

function openChatroomWorkspacePage() {
  window.history.pushState({ screen: 'workspace' }, '', `${window.location.pathname}#workspace`);
  renderChatroomWorkspace();
}

function openRoomPage(roomName) {
  window.history.pushState({ screen: 'room', roomName }, '', `${window.location.pathname}#room/${roomIdForName(roomName)}`);
  renderAllAroundMayhemRoom(roomName);
}

function openDonationPopup() {
  const persistedReturnHash = sessionStorage.getItem('the-love-media-donation-return-hash');
  if (window.location.hash === '#donation' && persistedReturnHash) {
    if (persistedReturnHash === '#workspace' && !document.querySelector('.workspace-sidebar')) {
      renderChatroomWorkspace();
    } else {
      const roomRoute = persistedReturnHash.match(/^#room\/([^/]+)$/);
      const roomName = roomRoute && roomNames.find((name) => roomIdForName(name) === roomRoute[1]);
      if (roomName && !document.querySelector('.room-shell')) renderAllAroundMayhemRoom(roomName);
    }
  }
  const existingDonation = document.getElementById('donation-modal');
  if (existingDonation) existingDonation.remove();
  if (window.location.hash !== '#donation') {
    sessionStorage.setItem('the-love-media-donation-return-hash', window.location.hash || '#welcome');
    window.history.pushState({ screen: 'donation', returnHash: window.location.hash }, '', `${window.location.pathname}#donation`);
  }

  const savedDonations = JSON.parse(localStorage.getItem('the-love-media-donations') || '[]');
  const totalDonated = savedDonations.reduce((sum, item) => sum + Number(item.amount || 0), 0);

  const donationModal = document.createElement('div');
  donationModal.className = 'profile-editor-modal';
  donationModal.id = 'donation-modal';
  donationModal.innerHTML = `
    <div class="profile-editor-card donation-card">
      <p class="eyebrow">Support the room</p>
      <h3>Donate a $1</h3>
      <p>Help keep the community glowing and the spaces open for everyone.</p>

      <div class="donation-amount-pills">
        <button class="donation-pill active" type="button" data-amount="1">$1</button>
        <button class="donation-pill" type="button" data-amount="5">$5</button>
        <button class="donation-pill" type="button" data-amount="10">$10</button>
        <button class="donation-pill" type="button" data-amount="25">$25</button>
      </div>

      <label class="donation-label" for="donation-amount-input">Custom amount</label>
      <div class="donation-amount-input-wrap">
        <span>$</span>
        <input id="donation-amount-input" type="number" min="1" step="0.01" value="1.00" />
      </div>

      <div class="donation-summary">
        <span>Total support</span>
        <strong>$${totalDonated.toFixed(2)}</strong>
      </div>

      <p class="private-message-status" id="donation-status" aria-live="polite">Your support keeps the room running.</p>
      <div class="profile-editor-actions">
        <button class="small-btn" id="confirm-donation-btn" type="button">Donate $1.00</button>
        <button class="secondary-btn" id="close-donation-btn" type="button">Back to previous page</button>
      </div>
    </div>
  `;
  document.getElementById('root').appendChild(donationModal);

  const donationAmountInput = document.getElementById('donation-amount-input');
  const confirmDonationButton = document.getElementById('confirm-donation-btn');
  const updateConfirmText = () => {
    const amount = Number(donationAmountInput.value);
    confirmDonationButton.textContent = Number.isFinite(amount) && amount >= 1
      ? `Donate $${amount.toFixed(2)}`
      : 'Donate';
  };

  const setDonationAmount = (amountValue) => {
    const amount = Number(amountValue);
    if (!Number.isFinite(amount) || amount < 1) {
      donationAmountInput.value = '1';
      updateConfirmText();
      return;
    }

    donationAmountInput.value = amount.toFixed(2);
    updateConfirmText();
    document.querySelectorAll('.donation-pill').forEach((pill) => {
      const isActive = Number(pill.dataset.amount) === Number(amount.toFixed(2));
      pill.classList.toggle('active', isActive);
    });
  };

  donationAmountInput.addEventListener('input', () => {
    const amount = Number(donationAmountInput.value);
    document.querySelectorAll('.donation-pill').forEach((pill) => {
      const isActive = Number(pill.dataset.amount) === Number(amount || 1);
      pill.classList.toggle('active', isActive);
    });
    updateConfirmText();
  });

  document.querySelectorAll('.donation-pill').forEach((pill) => {
    pill.addEventListener('click', () => setDonationAmount(pill.dataset.amount));
  });

  confirmDonationButton.addEventListener('click', async () => {
    const amount = Number(donationAmountInput.value);
    if (!Number.isFinite(amount) || amount < 1) {
      document.getElementById('donation-status').textContent = 'Enter an amount of at least $1.00.';
      return;
    }

    confirmDonationButton.disabled = true;
    confirmDonationButton.textContent = 'Opening checkout...';
    document.getElementById('donation-status').textContent = 'Preparing your secure checkout...';

    try {
      const response = await fetch(`${apiBaseUrl}/api/create-checkout-session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: Math.round(amount * 100),
          productName: 'The Love Media support',
          returnHash: history.state?.returnHash || window.location.hash
        })
      });

      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.error || 'Checkout could not be started.');
      }

      if (result.url) {
        window.location.href = result.url;
        return;
      }

      throw new Error('No checkout URL was returned.');
    } catch (error) {
      confirmDonationButton.disabled = false;
      confirmDonationButton.textContent = `Donate $${amount.toFixed(2)}`;
      document.getElementById('donation-status').textContent = error.message;
    }
  });

  document.getElementById('close-donation-btn').addEventListener('click', () => {
    sessionStorage.removeItem('the-love-media-donation-return-hash');
    window.history.back();
  });
}

function openPrivateMail() {
  const existingMail = document.getElementById('private-mail-modal');
  if (existingMail) existingMail.remove();

  const onlinePeople = new Set([currentProfileName]);
  const mailModal = document.createElement('div');
  mailModal.className = 'friends-connect-modal';
  mailModal.id = 'private-mail-modal';
  mailModal.innerHTML = `
    <div class="friends-connect-screen">
      <div class="friends-connect-header">
        <div>
          <p class="eyebrow">The Love Media</p>
          <h2>PM Mail</h2>
          <p class="profile-preview-label">Private messages sent while friends are offline appear here for 30 days.</p>
        </div>
        <button class="secondary-btn" id="close-pm-mail-btn" type="button">Exit</button>
      </div>
      <div class="friends-connect-content">
        <div class="friends-connect-list" id="pm-mail-list"></div>
      </div>
      <div class="profile-editor-modal hidden" id="private-mail-message-modal">
        <div class="profile-editor-card private-mail-message-card">
          <p class="eyebrow">PM Mail</p>
          <h3 id="private-mail-message-title"></h3>
          <p class="profile-preview-label">Full message</p>
          <div class="private-mail-full-message" id="private-mail-full-message"></div>
          <div class="profile-editor-actions">
            <button class="secondary-btn" id="close-private-mail-message-btn" type="button">Close</button>
          </div>
        </div>
      </div>
    </div>
  `;
  document.getElementById('root').appendChild(mailModal);
  const messageModal = mailModal.querySelector('#private-mail-message-modal');
  messageModal.querySelector('#close-private-mail-message-btn').addEventListener('click', (event) => {
    event.stopPropagation();
    messageModal.classList.add('hidden');
  });

  const mailList = document.getElementById('pm-mail-list');
  [...new Set([...friends, 'Gayjesus'])].forEach((friend) => {
    const isOnline = onlinePeople.has(friend);
    cleanPrivateMail(friend, isOnline);
    if (!privateMail[friend]?.length) return;
    privateMail[friend].forEach((savedMessage) => {
      const row = document.createElement('div');
      row.className = 'pm-mail-row';
      row.innerHTML = '<button class="pm-mail-conversation" type="button"><strong></strong><span></span><small></small></button><button class="pm-mail-delete" type="button" aria-label="Delete this message">Delete</button>';
      row.querySelector('strong').textContent = `${friend} - ${savedMessage.sender}`;
      row.querySelector('span').textContent = savedMessage.text;
      row.querySelector('small').textContent = `${new Date(savedMessage.createdAt).toLocaleString()}${isOnline ? ' - Online' : ' - Offline'}`;
      row.querySelector('.pm-mail-conversation').addEventListener('click', () => {
        openPrivateMailMessage(friend, savedMessage, mailModal);
      });
      row.querySelector('.pm-mail-delete').addEventListener('click', (event) => {
        event.stopPropagation();
        privateMail[friend] = privateMail[friend].filter((message) => message.id !== savedMessage.id);
        if (!privateMail[friend].length) delete privateMail[friend];
        savePrivateMail();
        row.remove();
        if (!mailList.children.length) {
          const emptyMessage = document.createElement('p');
          emptyMessage.className = 'profile-preview-label';
          emptyMessage.textContent = 'Your private mailbox is empty.';
          mailList.appendChild(emptyMessage);
        }
      });
      mailList.appendChild(row);
    });
  });
  if (!mailList.children.length) {
    const emptyMessage = document.createElement('p');
    emptyMessage.className = 'profile-preview-label';
    emptyMessage.textContent = 'Your private mailbox is empty.';
    mailList.appendChild(emptyMessage);
  }
  document.getElementById('close-pm-mail-btn').addEventListener('click', () => mailModal.remove());
}

function openPrivateMailMessage(friend, message, mailModal) {
  const messageModal = mailModal.querySelector('#private-mail-message-modal');
  messageModal.querySelector('#private-mail-message-title').textContent = `To ${friend} from ${message.sender}`;
  messageModal.querySelector('#private-mail-full-message').textContent = message.text;
  messageModal.classList.remove('hidden');
}

function openFriendsConnectPage() {
  window.history.pushState({ screen: 'friends-connect' }, '', `${window.location.pathname}#friends-connect`);
  openFriendsConnect();
}

function openFriendsConnect() {
  const existingOverlay = document.getElementById('friends-connect-modal');
  if (existingOverlay) existingOverlay.remove();

  const overlay = document.createElement('div');
  overlay.className = 'friends-connect-modal';
  overlay.id = 'friends-connect-modal';
  overlay.innerHTML = `
    <div class="friends-connect-screen">
      <div class="friends-connect-header">
        <div>
          <p class="eyebrow">The Love Media</p>
          <h2>Friends Connect</h2>
          <button class="secondary-btn friends-donate-button donate-btn" id="friends-donate-btn" type="button">Donate a $1</button>
        </div>
        <div class="friends-connect-header-actions">
          <button class="secondary-btn" id="close-friends-connect-btn">Exit</button>
          <button class="secondary-btn" id="open-pm-mail-btn" type="button">PM Mail</button>
          <button class="secondary-btn" id="enter-group-chat-btn" type="button"></button>
        </div>
      </div>
      <div class="friends-connect-content">
        <div class="friends-connect-list" id="friends-connect-list"></div>
      </div>
    </div>
  `;

  document.getElementById('root').appendChild(overlay);
  document.getElementById('open-pm-mail-btn').addEventListener('click', () => {
    overlay.remove();
    openPrivateMail();
  });
  document.getElementById('friends-donate-btn').addEventListener('click', openDonationPopup);
  const enterGroupChatButton = document.getElementById('enter-group-chat-btn');
  updateGroupChatStatus();
  enterGroupChatButton.addEventListener('click', () => {
    groupChatActive = true;
    updateGroupChatStatus();
    if (privateMessageOpener) {
      privateMessageOpener('Group chat', { groupChat: true });
    } else {
      openGroupChatMessagePopup();
    }
  });
  const friendsList = document.getElementById('friends-connect-list');
  const onlinePeople = new Set([currentProfileName]);
  if (friends.length === 0) {
    const emptyMessage = document.createElement('p');
    emptyMessage.className = 'profile-preview-label';
    emptyMessage.textContent = 'No friends added yet.';
    friendsList.appendChild(emptyMessage);
  } else {
    friends.forEach((friend) => {
      const friendRow = document.createElement('div');
      friendRow.className = 'friends-connect-person';
      friendRow.tabIndex = 0;
      const friendName = document.createElement('strong');
      friendName.textContent = friend;
      const friendActions = document.createElement('div');
      friendActions.className = 'friends-connect-actions';
      const friendStatus = document.createElement('span');
      const isOnline = onlinePeople.has(friend);
      friendStatus.className = isOnline ? 'online-status' : 'offline-status';
      friendStatus.textContent = isOnline ? 'Online' : 'Offline';
      const messageButton = document.createElement('button');
      messageButton.className = 'secondary-btn';
      messageButton.type = 'button';
      messageButton.textContent = 'Private message';
      messageButton.addEventListener('click', (event) => {
        event.stopPropagation();
        overlay.remove();
        if (privateMessageOpener) {
          privateMessageOpener(friend);
        } else {
          pendingPrivateMessageFriend = friend;
          renderAllAroundMayhemRoom();
        }
      });
      const inviteButton = document.createElement('button');
      inviteButton.className = 'secondary-btn';
      inviteButton.type = 'button';
      inviteButton.textContent = groupChatInvites.includes(friend) ? 'Invited' : 'Invite to group chat';
      inviteButton.disabled = groupChatInvites.includes(friend);
      inviteButton.addEventListener('click', (event) => {
        event.stopPropagation();
        groupChatActive = true;
        if (!groupChatInvites.includes(friend)) groupChatInvites.push(friend);
        inviteButton.textContent = 'Invited';
        inviteButton.disabled = true;
        updateGroupChatStatus();
      });
      const deleteButton = document.createElement('button');
      deleteButton.className = 'pm-mail-delete friend-delete-button';
      deleteButton.type = 'button';
      deleteButton.textContent = 'Delete';
      deleteButton.addEventListener('click', (event) => {
        event.stopPropagation();
        friends = friends.filter((savedFriend) => savedFriend !== friend);
        localStorage.setItem('the-love-media-friends', JSON.stringify(friends));
        groupChatInvites = groupChatInvites.filter((invitedFriend) => invitedFriend !== friend);
        friendRow.remove();
        if (!friendsList.children.length) {
          const emptyMessage = document.createElement('p');
          emptyMessage.className = 'profile-preview-label';
          emptyMessage.textContent = 'No friends added yet.';
          friendsList.appendChild(emptyMessage);
        }
      });
      friendActions.append(friendStatus, messageButton, inviteButton, deleteButton);
      friendRow.append(friendName, friendActions);
      const openMessage = () => {
        overlay.remove();
        if (privateMessageOpener) {
          privateMessageOpener(friend);
        } else {
          pendingPrivateMessageFriend = friend;
          renderAllAroundMayhemRoom();
        }
      };
      friendRow.addEventListener('click', openMessage);
      friendRow.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          openMessage();
        }
      });
      friendsList.appendChild(friendRow);
    });
  }
  document.getElementById('close-friends-connect-btn').addEventListener('click', () => window.history.back());
}

function openGroupChatMessagePopup() {
  const existingMessage = document.getElementById('group-chat-message-modal');
  if (existingMessage) existingMessage.remove();

  const messageModal = document.createElement('div');
  messageModal.className = 'profile-editor-modal group-chat-message-modal';
  messageModal.id = 'group-chat-message-modal';
  messageModal.innerHTML = `
    <div class="profile-editor-card private-message-card">
      <div class="private-message-drag-handle" title="Drag to move group chat box">
        <h3>Group chat</h3>
        <span aria-hidden="true">⠿</span>
      </div>
      <div class="group-chat-header">
        <div class="group-camera-controls">
          <label for="group-camera-count">Cameras</label>
          <input id="group-camera-count" type="number" min="1" max="16" value="4" />
          <button class="secondary-btn" id="group-camera-btn" type="button">Camera</button>
        </div>
      </div>
      <div class="group-chat-invites" id="group-chat-invites"></div>
      <div class="private-message-thread" id="group-message-thread"></div>
      <div class="group-message-compose-row">
        <div class="private-message-compose">
          <label for="group-message-input">Message</label>
          <textarea id="group-message-input" rows="1" placeholder="Write a group message"></textarea>
        </div>
        <div class="emoji-message-controls">
          <button class="secondary-btn emoji-picker-button" id="group-emoji-btn" type="button" aria-label="Add emoji">😊</button>
          <div class="emoji-picker hidden" id="group-emoji-picker">
            <button type="button">🏳️‍🌈</button><button type="button">🏳️‍⚧️</button><button type="button">🌈</button><button type="button">⚧️</button>
            <button type="button">👭</button><button type="button">👬</button><button type="button">🧑‍🤝‍🧑</button><button type="button">💑</button>
            <button type="button">👩‍❤️‍👩</button><button type="button">👨‍❤️‍👨</button><button type="button">👩‍❤️‍💋‍👩</button><button type="button">👨‍❤️‍💋‍👨</button>
            <button type="button">🦄</button><button type="button">💖</button><button type="button">💜</button><button type="button">💙</button>
            <button type="button">🥰</button><button type="button">😍</button><button type="button">❤️</button><button type="button">🧡</button>
            <button type="button">💛</button><button type="button">💚</button><button type="button">❤️‍🔥</button><button type="button">💕</button>
            <button type="button">✨</button><button type="button">🪩</button><button type="button">😀</button><button type="button">😂</button>
            <button type="button">😎</button><button type="button">🎉</button><button type="button">💪</button><button type="button">✊</button>
          </div>
        </div>
        <button class="small-btn" id="send-group-message-btn">Send</button>
      </div>
      <p class="private-message-status" id="group-message-status" aria-live="polite"></p>
      <div class="profile-editor-actions">
        <button class="secondary-btn" id="close-group-message-btn">Exit</button>
      </div>
      <div class="private-message-resize-handle" title="Resize group chat box" aria-hidden="true"></div>
    </div>
  `;

  document.getElementById('root').appendChild(messageModal);
  const messageCard = messageModal.querySelector('.private-message-card');
  const dragHandle = messageModal.querySelector('.private-message-drag-handle');
  const resizeHandle = messageModal.querySelector('.private-message-resize-handle');
  const initialRect = messageCard.getBoundingClientRect();
  messageCard.style.position = 'fixed';
  messageCard.style.left = `${initialRect.left}px`;
  messageCard.style.top = `${initialRect.top}px`;
  messageCard.style.width = `${initialRect.width}px`;
  let dragState = null;
  let resizeState = null;
  const clampCardPosition = () => {
    const margin = 12;
    const maxLeft = Math.max(margin, window.innerWidth - messageCard.offsetWidth - margin);
    const maxTop = Math.max(margin, window.innerHeight - messageCard.offsetHeight - margin);
    const currentRect = messageCard.getBoundingClientRect();
    messageCard.style.left = `${Math.min(Math.max(margin, currentRect.left), maxLeft)}px`;
    messageCard.style.top = `${Math.min(Math.max(margin, currentRect.top), maxTop)}px`;
  };
  dragHandle.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    const currentRect = messageCard.getBoundingClientRect();
    dragState = { startX: event.clientX, startY: event.clientY, left: currentRect.left, top: currentRect.top };
    dragHandle.setPointerCapture(event.pointerId);
  });
  dragHandle.addEventListener('pointermove', (event) => {
    if (!dragState) return;
    messageCard.style.left = `${dragState.left + event.clientX - dragState.startX}px`;
    messageCard.style.top = `${dragState.top + event.clientY - dragState.startY}px`;
    clampCardPosition();
  });
  dragHandle.addEventListener('pointerup', () => { dragState = null; });
  dragHandle.addEventListener('pointercancel', () => { dragState = null; });
  resizeHandle.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    resizeState = { startX: event.clientX, startY: event.clientY, width: messageCard.offsetWidth, height: messageCard.offsetHeight };
    resizeHandle.setPointerCapture(event.pointerId);
  });
  resizeHandle.addEventListener('pointermove', (event) => {
    if (!resizeState) return;
    const width = Math.max(340, resizeState.width + event.clientX - resizeState.startX);
    const requestedHeight = Math.max(260, resizeState.height + event.clientY - resizeState.startY);
    messageCard.style.width = `${Math.min(width, window.innerWidth - 24)}px`;
    messageCard.style.height = 'auto';
    messageCard.style.height = `${Math.max(requestedHeight, messageCard.scrollHeight)}px`;
    clampCardPosition();
  });
  resizeHandle.addEventListener('pointerup', () => { resizeState = null; });
  resizeHandle.addEventListener('pointercancel', () => { resizeState = null; });
  window.addEventListener('resize', clampCardPosition, { once: true });
  const invites = document.getElementById('group-chat-invites');
  invites.textContent = groupChatInvites.length
    ? `Invited friends: ${groupChatInvites.join(', ')}`
    : 'No friends invited yet.';
  setupEmojiPicker('group-emoji-btn', 'group-emoji-picker', 'group-message-input');
  const addMessage = (sender, text) => {
    const bubble = document.createElement('div');
    bubble.className = 'private-message-bubble';
    const senderLabel = document.createElement('strong');
    senderLabel.textContent = sender;
    const messageText = document.createElement('span');
    messageText.textContent = text;
    bubble.append(senderLabel, messageText);
    document.getElementById('group-message-thread').appendChild(bubble);
  };
  const sendMessage = () => {
    const input = document.getElementById('group-message-input');
    if (!input.value.trim()) return;
    addMessage(currentProfileName, input.value.trim());
    input.value = '';
  };
  document.getElementById('send-group-message-btn').addEventListener('click', sendMessage);
  document.getElementById('group-message-input').addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' || event.shiftKey) return;
    event.preventDefault();
    sendMessage();
  });
  document.getElementById('group-camera-btn').addEventListener('click', () => {
    const cameraCountInput = document.getElementById('group-camera-count');
    const cameraCount = Math.min(16, Math.max(1, Number(cameraCountInput.value) || 4));
    cameraCountInput.value = cameraCount;
    openGroupCameraScreen(cameraCount);
  });
  document.getElementById('close-group-message-btn').addEventListener('click', () => {
    groupChatActive = false;
    updateGroupChatStatus();
    messageModal.remove();
  });
}

/**
 * Joins a video room on the signaling server and connects to everyone in it.
 * The private camera uses a room of two; the group camera uses the room name.
 */
function createVideoRoomConnection({ room, stream, onPeer, onPeerLeft, onStatus = () => {} }) {
  const peerConnections = new Map();
  const peerId = crypto.randomUUID();
  let socket = null;
  let closed = false;

  const send = (message) => {
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
  };

  const dropPeer = (remotePeerId) => {
    peerConnections.get(remotePeerId)?.close();
    peerConnections.delete(remotePeerId);
    onPeerLeft(remotePeerId);
  };

  const connectToPeer = async (remotePeerId, codename, shouldOffer) => {
    if (closed || !remotePeerId || remotePeerId === peerId) return null;
    const existing = peerConnections.get(remotePeerId);
    if (existing) return existing;

    const connection = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
    });
    peerConnections.set(remotePeerId, connection);
    stream.getTracks().forEach((track) => connection.addTrack(track, stream));
    connection.onicecandidate = ({ candidate }) => {
      if (candidate) send({ type: 'candidate', to: remotePeerId, candidate });
    };
    connection.ontrack = ({ streams }) => onPeer(remotePeerId, streams[0], codename);
    connection.onconnectionstatechange = () => {
      if (['failed', 'closed', 'disconnected'].includes(connection.connectionState)) dropPeer(remotePeerId);
    };

    if (shouldOffer) {
      await connection.setLocalDescription(await connection.createOffer());
      send({
        type: 'offer',
        to: remotePeerId,
        codename: currentProfileName,
        description: connection.localDescription
      });
    }
    return connection;
  };

  socket = new WebSocket(webSocketBaseUrl);
  socket.onopen = () => {
    send({ type: 'auth', sessionToken: currentSessionToken });
    send({ type: 'join', room, peerId });
  };
  socket.onerror = () => {
    if (!closed) onStatus('Unable to connect to the video server.');
  };
  socket.onmessage = async ({ data }) => {
    let message;
    try {
      message = JSON.parse(data);
    } catch {
      return;
    }
    try {
      if (message.type === 'existing-peer') {
        for (const peer of message.peers || []) await connectToPeer(peer.peerId, peer.codename, true);
      }
      if (message.type === 'peer-joined') {
        await connectToPeer(message.peerId, message.codename, false);
      }
      if (message.type === 'offer') {
        const connection = peerConnections.get(message.from)
          || await connectToPeer(message.from, message.codename || '', false);
        if (!connection) return;
        await connection.setRemoteDescription(message.description);
        await connection.setLocalDescription(await connection.createAnswer());
        send({ type: 'answer', to: message.from, description: connection.localDescription });
      }
      if (message.type === 'answer') {
        await peerConnections.get(message.from)?.setRemoteDescription(message.description);
      }
      if (message.type === 'candidate') await peerConnections.get(message.from)?.addIceCandidate(message.candidate);
      if (message.type === 'peer-left') dropPeer(message.peerId);
    } catch (error) {
      console.warn('Video call signaling failed', error);
    }
  };

  return {
    close: () => {
      closed = true;
      socket?.close();
      peerConnections.forEach((connection) => connection.close());
      peerConnections.clear();
    }
  };
}

function openGroupCameraScreen(cameraCount) {
  const existingScreen = document.getElementById('group-camera-screen');
  if (existingScreen) existingScreen.remove();

  const clampCameraCount = (value) => {
    const wanted = Math.round(Number(value));
    return Math.min(16, Math.max(1, Number.isFinite(wanted) && wanted > 0 ? wanted : 1));
  };
  let slotCount = clampCameraCount(cameraCount);

  const cameraScreen = document.createElement('div');
  cameraScreen.className = 'group-camera-screen';
  cameraScreen.id = 'group-camera-screen';
  cameraScreen.innerHTML = `
    <div class="group-camera-screen-header">
      <div>
        <p class="eyebrow">The Love Media</p>
        <h2>Group camera view</h2>
      </div>
      <div class="group-camera-controls">
        <label for="group-camera-slot-count">Cameras</label>
        <input id="group-camera-slot-count" type="number" min="1" max="16" value="${slotCount}" />
        <button class="secondary-btn" id="close-group-camera-btn">Exit</button>
      </div>
    </div>
    <div class="group-camera-grid" id="group-camera-grid"></div>
    <p class="group-camera-screen-status" id="group-camera-screen-status" aria-live="polite"></p>
  `;

  document.getElementById('root').appendChild(cameraScreen);
  const cameraGrid = document.getElementById('group-camera-grid');
  const countInput = document.getElementById('group-camera-slot-count');
  const statusElement = () => document.getElementById('group-camera-screen-status');
  let cameraStream = null;
  let connection = null;

  const localTile = document.createElement('div');
  localTile.className = 'group-camera-tile';
  localTile.innerHTML = `<video id="group-local-camera" autoplay muted playsinline></video><strong></strong>`;
  localTile.querySelector('strong').textContent = currentProfileName;

  const peerTiles = new Map();

  const renderGrid = () => {
    const peerTileList = [...peerTiles.values()];
    const shown = Math.max(slotCount, peerTileList.length + 1);
    const columns = shown <= 1 ? 1 : shown <= 4 ? 2 : shown <= 9 ? 3 : 4;
    cameraGrid.style.gridTemplateColumns = `repeat(${columns}, minmax(0, 1fr))`;
    cameraGrid.replaceChildren(localTile, ...peerTileList);

    for (let index = peerTileList.length + 1; index < shown; index += 1) {
      const emptyTile = document.createElement('div');
      emptyTile.className = 'group-camera-tile group-camera-empty';
      emptyTile.innerHTML = '<span>Open camera spot</span>';
      cameraGrid.appendChild(emptyTile);
    }
  };

  const setCameraCount = (value) => {
    slotCount = clampCameraCount(value);
    countInput.value = String(slotCount);
    renderGrid();
  };

  const addPeerTile = (remotePeerId, stream, codename) => {
    let tile = peerTiles.get(remotePeerId);
    if (!tile) {
      tile = document.createElement('div');
      tile.className = 'group-camera-tile';
      tile.innerHTML = '<video autoplay playsinline></video><strong></strong>';
      peerTiles.set(remotePeerId, tile);
    }
    tile.querySelector('strong').textContent = codename || `Participant ${peerTiles.size}`;
    tile.querySelector('video').srcObject = stream;
    renderGrid();
  };

  const removePeerTile = (remotePeerId) => {
    peerTiles.get(remotePeerId)?.remove();
    peerTiles.delete(remotePeerId);
    renderGrid();
  };

  countInput.addEventListener('change', () => setCameraCount(countInput.value));
  countInput.addEventListener('input', () => {
    if (countInput.value) setCameraCount(countInput.value);
  });

  renderGrid();

  if (!navigator.mediaDevices?.getUserMedia || !window.RTCPeerConnection) {
    statusElement().textContent = 'Webcam access is not available.';
  } else {
    navigator.mediaDevices.getUserMedia({ video: true, audio: false })
      .then((stream) => {
        cameraStream = stream;
        localTile.querySelector('video').srcObject = stream;
        connection = createVideoRoomConnection({
          room: 'all-around-mayhem',
          stream,
          onPeer: addPeerTile,
          onPeerLeft: removePeerTile,
          onStatus: (text) => {
            statusElement().textContent = text;
          }
        });
      })
      .catch(() => {
        statusElement().textContent = 'Camera permission was not granted.';
      });
  }

  document.getElementById('close-group-camera-btn').addEventListener('click', () => {
    if (cameraStream) cameraStream.getTracks().forEach((track) => track.stop());
    connection?.close();
    cameraScreen.remove();
  });
}

function renderAllAroundMayhemRoom(roomName = 'ALL AROUND MAYHEM') {
  connectRoomPresence(roomName);
  const customBackground = getRoomBackground(roomName);
  const shellClass = ['ALL AROUND MAYHEM', 'Twinks A Hoy', 'daddys and sons', 'bisexual town', 'lezy lickables', 'Queers all around us', 'Fuzzy Frenzy', 'Kinks r us', 'Transgender Dominance'].includes(roomName)
    ? 'workspace-card room-shell room-shell-mayhem'
    : 'workspace-card room-shell';
  app.innerHTML = `
    <div class="workspace-shell">
      <div class="${shellClass}" id="active-room-shell">
        <div class="room-header">
          <div>
            <p class="eyebrow">${roomName}</p>
            <p class="room-member-name" id="room-member-name"></p>
          </div>
          <div class="room-header-actions">
            <button class="small-btn" id="room-gayjesus-blog-btn">Gayjesus Blog</button>
            <button class="small-btn" id="room-friends-connect-btn">Friends Connect</button>
            <button class="small-btn donate-btn" id="room-donate-btn">Donate a $1</button>
            <button class="small-btn" id="room-background-btn" type="button">Change picture</button>
            ${customBackground ? '<button class="small-btn" id="reset-room-background-btn" type="button">Use default</button>' : ''}
            <input id="room-background-input" type="file" accept="image/*" hidden />
            <button class="small-btn" id="exit-room-btn">Exit room</button>
          </div>
        </div>
        <div class="room-chat-box">
          <div class="room-chat-main">
            <div class="room-chat-messages">
              <div class="message-item">Welcome to ${roomName}.</div>
              <div class="message-item">The room is open for chaos and connection.</div>
            </div>
            <div class="room-chat-composer">
              <textarea id="room-message-input" rows="4" placeholder="Write your message"></textarea>
              <div class="emoji-message-controls">
                <button class="secondary-btn emoji-picker-button" id="room-emoji-btn" type="button" aria-label="Add emoji">😊</button>
                <div class="emoji-picker hidden" id="room-emoji-picker">
                  <button type="button">🏳️‍🌈</button><button type="button">🏳️‍⚧️</button><button type="button">🌈</button><button type="button">⚧️</button>
                  <button type="button">👭</button><button type="button">👬</button><button type="button">🧑‍🤝‍🧑</button><button type="button">💑</button>
                  <button type="button">👩‍❤️‍👩</button><button type="button">👨‍❤️‍👨</button><button type="button">👩‍❤️‍💋‍👩</button><button type="button">👨‍❤️‍💋‍👨</button>
                  <button type="button">🦄</button><button type="button">💖</button><button type="button">💜</button><button type="button">💙</button>
                  <button type="button">🥰</button><button type="button">😍</button><button type="button">❤️</button><button type="button">🧡</button>
                  <button type="button">💛</button><button type="button">💚</button><button type="button">❤️‍🔥</button><button type="button">💕</button>
                  <button type="button">✨</button><button type="button">🪩</button><button type="button">😀</button><button type="button">😂</button>
                  <button type="button">😎</button><button type="button">🎉</button><button type="button">💪</button><button type="button">✊</button>
                </div>
              </div>
              <button class="small-btn" id="send-room-message-btn">Send</button>
            </div>
          </div>
          <aside class="room-side-panel">
            <p class="room-side-label">Room mates</p>
            <div id="room-mates-list"></div>
          </aside>
        </div>
      </div>
    </div>
  `;

  document.getElementById('room-member-name').textContent = currentProfileName;
  document.getElementById('room-gayjesus-blog-btn').addEventListener('click', openGayjesusBlogPage);
  document.getElementById('room-friends-connect-btn').addEventListener('click', openFriendsConnectPage);
  document.getElementById('room-donate-btn').addEventListener('click', openDonationPopup);
  const roomShell = document.getElementById('active-room-shell');
  const roomBackgroundInput = document.getElementById('room-background-input');
  if (customBackground) roomShell.style.backgroundImage = `linear-gradient(180deg, rgba(13, 4, 24, 0.42), rgba(13, 4, 24, 0.78)), url("${customBackground}")`;
  document.getElementById('room-background-btn').addEventListener('click', () => roomBackgroundInput.click());
  roomBackgroundInput.addEventListener('change', () => {
    const file = roomBackgroundInput.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) return;
    if (file.size > 3 * 1024 * 1024) {
      window.alert('Choose an image smaller than 3 MB.');
      roomBackgroundInput.value = '';
      return;
    }
    const reader = new FileReader();
    reader.addEventListener('load', () => {
      setRoomBackground(roomName, reader.result);
      roomShell.style.backgroundImage = `linear-gradient(180deg, rgba(13, 4, 24, 0.42), rgba(13, 4, 24, 0.78)), url("${reader.result}")`;
    });
    reader.readAsDataURL(file);
  });
  document.getElementById('reset-room-background-btn')?.addEventListener('click', () => {
    setRoomBackground(roomName);
    roomShell.style.backgroundImage = '';
    document.getElementById('reset-room-background-btn').remove();
  });
  const roomMatesList = document.getElementById('room-mates-list');

  // Everyone currently in this room, plus yourself, so the roommates panel can
  // actually open a private message with the other people in the room.
  const roomMateNames = () => {
    const members = roomMembers[roomIdForName(roomName)] || [];
    return [...new Set([currentProfileName, ...members].filter(Boolean))];
  };

  const renderRoomMates = () => {
    if (!roomMatesList.isConnected) return;
    roomMatesList.replaceChildren();
    roomMateNames().forEach((name) => {
    const roomMateEntry = document.createElement('div');
    roomMateEntry.className = 'room-mate-entry';

    const roomMate = document.createElement('button');
    roomMate.className = 'room-side-pill room-mate-trigger';
    roomMate.type = 'button';
    roomMate.textContent = name;

    const roomMateMenu = document.createElement('div');
    roomMateMenu.className = 'profile-menu hidden';

    const roomMateMenuName = document.createElement('p');
    roomMateMenuName.className = 'profile-menu-name';
    roomMateMenuName.textContent = name;
    roomMateMenu.appendChild(roomMateMenuName);

    ['Exit', 'Private message', 'Add friend', 'Profile'].forEach((actionName) => {
      const action = document.createElement('button');
      action.className = 'profile-menu-item';
      action.type = 'button';
      action.textContent = actionName;
      if (actionName === 'Exit') {
        action.addEventListener('click', () => {
          roomMateMenu.classList.add('hidden');
        });
      }
      if (actionName === 'Profile') {
        action.addEventListener('click', () => {
          roomMateMenu.classList.add('hidden');
          openRoommateProfile(name);
        });
      }
      if (actionName === 'Private message') {
        action.addEventListener('click', () => {
          roomMateMenu.classList.add('hidden');
          openPrivateMessage(name);
        });
      }
      if (actionName === 'Add friend') {
        action.addEventListener('click', () => {
          if (!friends.includes(name)) {
            friends = [...friends, name];
            localStorage.setItem('the-love-media-friends', JSON.stringify(friends));
          }
          roomMateMenu.classList.add('hidden');
        });
      }
      roomMateMenu.appendChild(action);
    });


  function openRoommateProfile(name) {
    const existingProfile = document.getElementById('roommate-profile-modal');
    if (existingProfile) existingProfile.remove();

    const profileModal = document.createElement('div');
    profileModal.className = 'profile-editor-modal';
    profileModal.id = 'roommate-profile-modal';
    profileModal.innerHTML = `
      <div class="profile-editor-card">
        <h3>Profile</h3>
        <div class="form-group">
          <label for="roommate-profile-name">Codename</label>
          <input id="roommate-profile-name" type="text" value="${name}" disabled />
        </div>
        <div class="form-group">
          <label for="roommate-profile-bio">Bio</label>
          <textarea id="roommate-profile-bio" rows="4" disabled>A little about you goes here.</textarea>
        </div>
        <div class="form-group">
          <label>Status</label>
          <div class="status-options">
            <label class="status-option">
              <input type="checkbox" id="roommate-status-single" disabled />
              <span>Single</span>
            </label>
            <label class="status-option">
              <input type="checkbox" id="roommate-status-coupled" disabled />
              <span>Coupled</span>
            </label>
            <label class="status-option">
              <input type="checkbox" id="roommate-status-married" disabled />
              <span>Married</span>
            </label>
          </div>
        </div>
        <div class="form-group">
          <label for="roommate-connection-status">Connection status</label>
          <textarea id="roommate-connection-status" rows="3" disabled>Available to connect with the room.</textarea>
        </div>
        <div class="profile-editor-actions">
          <button class="secondary-btn" id="close-roommate-profile-btn">Exit</button>
        </div>
      </div>
    `;

    document.getElementById('root').appendChild(profileModal);
    document.getElementById('roommate-profile-name').value = name;
    document.getElementById('roommate-profile-bio').value = currentProfileBio;
    document.getElementById('roommate-connection-status').value = currentConnectionStatus;
    ['Single', 'Coupled', 'Married'].forEach((status) => {
      const statusInput = profileModal.querySelector(`#roommate-status-${status.toLowerCase()}`);
      if (statusInput) statusInput.checked = currentProfileStatuses.includes(status);
    });
    document.getElementById('close-roommate-profile-btn').addEventListener('click', () => {
      profileModal.remove();
    });
  }

  function openPrivateMessage(name, options = {}) {
    const showCameraPreview = !options.groupChat;
    const existingMessage = document.getElementById('private-message-modal');
    if (existingMessage) existingMessage.remove();

    const messageModal = document.createElement('div');
    messageModal.className = `profile-editor-modal${options.groupChat ? ' group-chat-message-modal' : ''}`;
    messageModal.id = 'private-message-modal';
    messageModal.innerHTML = `
      <div class="profile-editor-card private-message-card">
        <div class="private-message-drag-handle" title="Drag to move message box">
          <h3>Private message</h3>
          <span aria-hidden="true">⠿</span>
        </div>
        <p class="profile-preview-label">To: ${name}</p>
        <div class="private-message-layout">
          <div class="private-message-column">
            <div class="private-message-thread" id="private-message-thread" aria-live="polite"></div>
          </div>
          <div class="private-camera-column">
            ${options.groupChat ? `
              <div class="group-camera-controls">
                <label for="private-group-camera-count">Cameras</label>
                <input id="private-group-camera-count" type="number" min="1" max="16" value="4" />
              </div>
            ` : ''}
            <button class="secondary-btn" id="private-camera-btn" type="button">Camera</button>
            <span class="private-camera-status" id="private-camera-status" aria-live="polite"></span>
            ${showCameraPreview ? `
              <div class="camera-preview hidden" id="private-camera-preview-wrap">
                <div class="video-call-grid">
                  <div class="video-call-tile">
                    <video id="private-camera-preview" autoplay muted playsinline></video>
                    <strong>You</strong>
                  </div>
                  <div class="video-call-tile waiting" id="private-remote-tile">
                    <video id="private-remote-video" autoplay playsinline></video>
                    <strong>${name}</strong>
                    <span class="video-call-waiting">Waiting for ${name} to open their camera</span>
                  </div>
                </div>
              </div>
            ` : ''}
          </div>
        </div>
        <div class="private-message-compose">
          <label for="private-message-input">Message</label>
          <textarea id="private-message-input" rows="1" placeholder="Write a private message"></textarea>
        </div>
        <div class="emoji-message-controls">
          <button class="secondary-btn emoji-picker-button" id="private-emoji-btn" type="button" aria-label="Add emoji">😊</button>
          <div class="emoji-picker hidden" id="private-emoji-picker">
            <button type="button">🏳️‍🌈</button><button type="button">🏳️‍⚧️</button><button type="button">🌈</button><button type="button">⚧️</button>
            <button type="button">👭</button><button type="button">👬</button><button type="button">🧑‍🤝‍🧑</button><button type="button">💑</button>
            <button type="button">👩‍❤️‍👩</button><button type="button">👨‍❤️‍👨</button><button type="button">👩‍❤️‍💋‍👩</button><button type="button">👨‍❤️‍💋‍👨</button>
            <button type="button">🦄</button><button type="button">💖</button><button type="button">💜</button><button type="button">💙</button>
            <button type="button">🥰</button><button type="button">😍</button><button type="button">❤️</button><button type="button">🧡</button>
            <button type="button">💛</button><button type="button">💚</button><button type="button">❤️‍🔥</button><button type="button">💕</button>
            <button type="button">✨</button><button type="button">🪩</button><button type="button">😀</button><button type="button">😂</button>
            <button type="button">😎</button><button type="button">🎉</button><button type="button">💪</button><button type="button">✊</button>
          </div>
        </div>
        <p class="private-message-status" id="private-message-status" aria-live="polite"></p>
        <div class="profile-editor-actions">
          <button class="small-btn" id="send-private-message-btn">Send</button>
          <button class="secondary-btn" id="close-private-message-btn">Exit</button>
        </div>
        <div class="private-message-resize-handle" title="Resize message box" aria-hidden="true"></div>
      </div>
    `;

    document.getElementById('root').appendChild(messageModal);
    const messageCard = messageModal.querySelector('.private-message-card');
    const dragHandle = messageModal.querySelector('.private-message-drag-handle');
    const resizeHandle = messageModal.querySelector('.private-message-resize-handle');
    const initialRect = messageCard.getBoundingClientRect();
    messageCard.style.position = 'fixed';
    messageCard.style.left = `${initialRect.left}px`;
    messageCard.style.top = `${initialRect.top}px`;
    messageCard.style.width = `${initialRect.width}px`;
    let dragState = null;
    let resizeState = null;

    const clampCardPosition = () => {
      const margin = 12;
      const maxLeft = Math.max(margin, window.innerWidth - messageCard.offsetWidth - margin);
      const maxTop = Math.max(margin, window.innerHeight - messageCard.offsetHeight - margin);
      const currentRect = messageCard.getBoundingClientRect();
      messageCard.style.left = `${Math.min(Math.max(margin, currentRect.left), maxLeft)}px`;
      messageCard.style.top = `${Math.min(Math.max(margin, currentRect.top), maxTop)}px`;
    };

    dragHandle.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      const currentRect = messageCard.getBoundingClientRect();
      dragState = { startX: event.clientX, startY: event.clientY, left: currentRect.left, top: currentRect.top };
      dragHandle.setPointerCapture(event.pointerId);
    });
    dragHandle.addEventListener('pointermove', (event) => {
      if (!dragState) return;
      messageCard.style.left = `${dragState.left + event.clientX - dragState.startX}px`;
      messageCard.style.top = `${dragState.top + event.clientY - dragState.startY}px`;
      clampCardPosition();
    });
    dragHandle.addEventListener('pointerup', () => { dragState = null; });
    dragHandle.addEventListener('pointercancel', () => { dragState = null; });

    resizeHandle.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      resizeState = { startX: event.clientX, startY: event.clientY, width: messageCard.offsetWidth, height: messageCard.offsetHeight };
      resizeHandle.setPointerCapture(event.pointerId);
    });
    resizeHandle.addEventListener('pointermove', (event) => {
      if (!resizeState) return;
      const width = Math.max(340, resizeState.width + event.clientX - resizeState.startX);
      const requestedHeight = Math.max(260, resizeState.height + event.clientY - resizeState.startY);
      messageCard.style.width = `${Math.min(width, window.innerWidth - 24)}px`;
      messageCard.style.height = 'auto';
      const contentHeight = messageCard.scrollHeight;
      messageCard.style.height = `${Math.max(requestedHeight, contentHeight)}px`;
      clampCardPosition();
    });
    resizeHandle.addEventListener('pointerup', () => { resizeState = null; });
    resizeHandle.addEventListener('pointercancel', () => { resizeState = null; });
    window.addEventListener('resize', clampCardPosition, { once: true });
    setupEmojiPicker('private-emoji-btn', 'private-emoji-picker', 'private-message-input');
    let cameraStream = null;
    const cameraButton = document.getElementById('private-camera-btn');
    const cameraPreviewWrap = document.getElementById('private-camera-preview-wrap');
    const cameraPreview = document.getElementById('private-camera-preview');
    const cameraStatus = document.getElementById('private-camera-status');
    const messageThread = document.getElementById('private-message-thread');
    const isFriendOnline = new Set([currentProfileName]).has(name);
    const threadMessages = getPrivateThread(name);

    const addPrivateMessage = (sender, message, ownMessage = false) => {
      const messageBubble = document.createElement('div');
      messageBubble.className = `private-message-bubble${ownMessage ? ' own' : ''}`;

      const senderLabel = document.createElement('strong');
      senderLabel.textContent = sender;
      const messageText = document.createElement('span');
      messageText.textContent = message;
      messageBubble.append(senderLabel, messageText);
      messageThread.appendChild(messageBubble);
      messageThread.scrollTop = messageThread.scrollHeight;
    };

    if (!options.groupChat) {
      threadMessages.forEach((savedMessage) => {
        addPrivateMessage(savedMessage.sender, savedMessage.text, savedMessage.ownMessage);
      });
      cleanPrivateMail(name, isFriendOnline);
    }

    const appendThreadMessage = (sender, message, ownMessage = false) => {
      threadMessages.push({ id: crypto.randomUUID(), sender, text: message, ownMessage, createdAt: Date.now() });
      savePrivateThread(name, threadMessages);
      addPrivateMessage(sender, message, ownMessage);
    };

    const remoteTile = document.getElementById('private-remote-tile');
    const remoteVideo = document.getElementById('private-remote-video');
    let callConnection = null;

    const stopPrivateCall = () => {
      callConnection?.close();
      callConnection = null;
      if (cameraStream) cameraStream.getTracks().forEach((track) => track.stop());
      cameraStream = null;
      cameraPreview.srcObject = null;
      if (remoteVideo) remoteVideo.srcObject = null;
      remoteTile?.classList.add('waiting');
      cameraPreviewWrap?.classList.add('hidden');
      cameraButton.textContent = 'Camera';
      cameraStatus.textContent = '';
    };

    cameraButton.addEventListener('click', async () => {
      if (!showCameraPreview) {
        const cameraCountInput = document.getElementById('private-group-camera-count');
        openGroupCameraScreen(Number(cameraCountInput?.value) || 4);
        return;
      }
      if (cameraStream) {
        stopPrivateCall();
        return;
      }

      if (!navigator.mediaDevices?.getUserMedia || !window.RTCPeerConnection) {
        cameraStatus.textContent = 'Webcam access is not available.';
        return;
      }

      // Both sides of a private message join the same room, so the cameras meet
      // in the middle instead of only showing a local preview.
      try {
        const callStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        cameraStream = callStream;
        cameraPreview.srcObject = callStream;
        cameraPreviewWrap.classList.remove('hidden');
        remoteTile?.classList.add('waiting');
        cameraButton.textContent = 'Turn off camera';
        cameraStatus.textContent = `Waiting for ${name} to open their camera.`;

        const callRoom = `dm:${[currentProfileName, name]
          .map((codename) => codename.toLowerCase())
          .sort()
          .join('|')}`;
        callConnection = createVideoRoomConnection({
          room: callRoom,
          stream: callStream,
          onPeer: (peerId, peerStream) => {
            remoteVideo.srcObject = peerStream;
            remoteTile.classList.remove('waiting');
            cameraStatus.textContent = '';
          },
          onPeerLeft: () => {
            remoteVideo.srcObject = null;
            remoteTile.classList.add('waiting');
            cameraStatus.textContent = `Waiting for ${name} to open their camera.`;
          },
          onStatus: (text) => {
            cameraStatus.textContent = text;
          }
        });
      } catch (error) {
        cameraStream = null;
        cameraStatus.textContent = 'Camera permission was not granted.';
      }
    });

    const sendPrivateMessage = () => {
      const input = document.getElementById('private-message-input');
      const status = document.getElementById('private-message-status');
      const message = input.value.trim();
      if (!message) return;
      appendThreadMessage(currentProfileName, message, true);
      if (!options.groupChat && !isFriendOnline) addPrivateMailMessage(name, currentProfileName, message);
      input.value = '';
      status.textContent = !options.groupChat && !isFriendOnline
        ? `${name} is offline. Your message was sent to PM Mail.`
        : '';

      window.setTimeout(() => {
        if (!document.body.contains(messageModal) || !isFriendOnline) return;
        const reply = `${name}: Thanks for reaching out.`;
        appendThreadMessage(name, reply, false);
      }, 600);
    };

    document.getElementById('send-private-message-btn').addEventListener('click', sendPrivateMessage);
    document.getElementById('private-message-input').addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' || event.shiftKey) return;
      event.preventDefault();
      sendPrivateMessage();
    });
    document.getElementById('close-private-message-btn').addEventListener('click', () => {
      callConnection?.close();
      if (cameraStream) cameraStream.getTracks().forEach((track) => track.stop());
      if (options.groupChat) {
        groupChatActive = false;
        updateGroupChatStatus();
      }
      messageModal.remove();
    });
  }

  privateMessageOpener = openPrivateMessage;
  if (pendingPrivateMessageFriend) {
    const friendToMessage = pendingPrivateMessageFriend;
    pendingPrivateMessageFriend = null;
    openPrivateMessage(friendToMessage);
  }
    roomMate.addEventListener('click', (e) => {
      e.stopPropagation();
      const isHidden = roomMateMenu.classList.contains('hidden');
      document.querySelectorAll('#room-mates-list .profile-menu').forEach(m => m.classList.add('hidden'));
      if (isHidden) {
        const rect = roomMate.getBoundingClientRect();
        roomMateMenu.style.position = 'fixed';
        // Center it vertically on the screen to prevent it from going off the bottom
        roomMateMenu.style.top = '50%';
        // Keep it horizontally centered with the button on the right side
        roomMateMenu.style.left = `${rect.left + (rect.width / 2)}px`;
        roomMateMenu.style.transform = 'translate(-50%, -50%)';
        roomMateMenu.classList.remove('hidden');
      }
    });
    roomMateEntry.append(roomMate, roomMateMenu);
    roomMatesList.appendChild(roomMateEntry);
    });
  };

  roomMatesRenderer = renderRoomMates;
  renderRoomMates();

  document.addEventListener('click', (e) => {
    if (!e.target.closest('.room-mate-trigger') && !e.target.closest('.profile-menu')) {
      document.querySelectorAll('#room-mates-list .profile-menu').forEach(m => m.classList.add('hidden'));
    }
  });

  const sidePanel = document.getElementById('room-mates-list').parentElement;
  if (sidePanel) {
    sidePanel.addEventListener('scroll', () => {
      document.querySelectorAll('#room-mates-list .profile-menu').forEach(m => m.classList.add('hidden'));
    });
  }

  document.getElementById('exit-room-btn').addEventListener('click', () => {
    groupChatActive = false;
    roomMatesRenderer = null;
    window.history.back();
  });

  setupEmojiPicker('room-emoji-btn', 'room-emoji-picker', 'room-message-input');

  const sendRoomMessage = () => {
    const input = document.getElementById('room-message-input');
    const message = input.value.trim();
    if (!message) return;

    const messages = document.querySelector('.room-chat-messages');
    const bubble = document.createElement('div');
    bubble.className = 'message-item';
    const sender = document.createElement('strong');
    sender.textContent = currentProfileName;
    const messageText = document.createElement('span');
    messageText.textContent = message;
    bubble.append(sender, messageText);
    messages.appendChild(bubble);
    input.value = '';
  };

  document.getElementById('send-room-message-btn').addEventListener('click', sendRoomMessage);
  document.getElementById('room-message-input').addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' || event.shiftKey) return;
    event.preventDefault();
    sendRoomMessage();
  });
}

function renderChatroomWorkspace(profileToView = null) {
  connectRoomPresence();
  app.innerHTML = `
    <div class="workspace-shell">
      <div class="workspace-card">
        <div class="brand-row">
          <p class="eyebrow">The Love Media</p>
          <div class="header-actions">
            <button class="secondary-btn header-pill-btn" id="sign-out-btn">Sign out</button>
            <button class="secondary-btn header-pill-btn" id="workspace-gayjesus-blog-btn">Gayjesus Blog</button>
            <button class="secondary-btn header-pill-btn" id="workspace-friends-connect-btn">Friends Connect</button>
            <button class="secondary-btn header-pill-btn donate-btn" id="workspace-donate-btn">Donate a $1</button>
            <span class="account-count">${accountCountLabel()}</span>
          </div>
        </div>
        <div class="workspace-content">
          <div class="workspace-sidebar">
            <h1>Chatroom workspace</h1>
            <div class="profile-preview" id="profile-preview">
              <p class="profile-preview-label">Profile preview</p>
              <strong id="profile-name-display">Gayjesus</strong>
              <p id="profile-bio-display">A little about you goes here.</p>
            </div>
            <div class="profile-action">
              <button class="secondary-btn" id="profile-btn">Profile</button>
              <div class="profile-menu hidden" id="profile-menu">
                <button class="profile-menu-item" id="edit-profile-item">Edit profile</button>
              </div>
            </div>
            <button class="secondary-btn" id="suggestions-btn">Suggestions and vibe rating</button>
            <button class="primary-btn" id="back-to-main-btn">Back to main</button>
          </div>
          <div class="workspace-main">
            <div class="workspace-header">
              <div>
                <p class="eyebrow subtle">Community pulse</p>
                <h2>Live rooms</h2>
              </div>
              <span class="status-pill">● Online</span>
            </div>

            <div class="room-grid">${renderRoomTiles()}</div>

            <div class="insight-row">
              <div class="mini-panel">
                <p class="panel-label">New friends</p>
                <strong>${friends.length}</strong>
                <span>Joined in the last hour</span>
              </div>
              <div class="mini-panel">
                <p class="panel-label">Good vibes</p>
                <strong id="community-vibe-score">${communityVibeScore}%</strong>
                <span>Positive energy rating</span>
              </div>
              <div class="mini-panel">
                <p class="panel-label">Tonight</p>
                <strong>${roomNames.length} live</strong>
                <span>Rooms currently active</span>
              </div>
            </div>

            <div class="community-strip">
              <div class="community-card">
                <p class="panel-label">On your radar</p>
                <h3>Meet sparks</h3>
                <ul id="radar-members-list">
                  <li>Waiting for room members</li>
                </ul>
              </div>
              <div class="community-card">
                <p class="panel-label">LGBTQ+ world updates</p>
                <h3>What’s happening now</h3>
                <div class="world-updates-list">
                  ${lgbtqUpdates.map((update) => `
                    <a class="world-update" href="${update.url}" target="_blank" rel="noopener noreferrer">
                      <strong>${update.title}</strong>
                      <span>${update.source} ↗</span>
                    </a>
                  `).join('')}
                </div>
                <p class="world-updates-note">Links open the original reporting so the context stays current.</p>
              </div>
            </div>

            <div class="social-feed">
              <div class="feed-card featured-feed">
                <p class="panel-label">Community feed</p>
                <h3>Rooftop tonight</h3>
                <p>Hosting a cozy rooftop room with sunset drinks, warm music, and a low-key crowd. Come say hi if you want to lounge and talk.</p>
                <span>by Mina • 2m ago</span>
              </div>
              <div class="feed-card">
                <p class="panel-label">Spotlight</p>
                <h3>Best room energy</h3>
                <p>People keep saying the best part is how easy it feels to meet people who just get it.</p>
                <span>by Theo • 16m ago</span>
              </div>
              <div class="feed-card">
                <p class="panel-label">New friends</p>
                <h3>Tonight’s invite</h3>
                <p>Open mic, soft lighting, and space for good conversation. New faces are always welcome.</p>
                <span>by Jules • 31m ago</span>
              </div>
            </div>
          </div>
        </div>
        <div class="suggestions-modal hidden" id="suggestions-modal">
          <div class="suggestions-card">
            <h3>Suggestions</h3>
            <p>Share what you’d like to see next in The Love Media and set the current community vibe.</p>
            <label class="vibe-control-label" for="vibe-score-input">
              Vibe score <strong id="vibe-score-value">${communityVibeScore}%</strong>
            </label>
            <input id="vibe-score-input" type="range" min="0" max="100" value="${communityVibeScore}" />
            <textarea id="suggestions-input" rows="5" placeholder="Write your suggestion here"></textarea>
            <div class="profile-editor-actions">
              <button class="small-btn" id="send-suggestion-btn">Send</button>
              <button class="secondary-btn" id="close-suggestions-btn">Close</button>
            </div>
          </div>
        </div>
        <div class="profile-editor-modal hidden" id="profile-editor-modal">
          <div class="profile-editor-card">
            <h3>Edit profile</h3>
            <div class="form-group">
              <label for="profile-name-input">Codename</label>
              <input id="profile-name-input" type="text" placeholder="Gayjesus" />
            </div>
            <div class="form-group">
              <label for="profile-bio-input">Bio</label>
              <textarea id="profile-bio-input" rows="4" placeholder="Let's hear your story on how you got where you are today, no matter the cost"></textarea>
            </div>
            <div class="form-group">
              <label>Status</label>
              <div class="status-options">
                <label class="status-option">
                  <input type="checkbox" id="status-single" />
                  <span>Single</span>
                </label>
                <label class="status-option">
                  <input type="checkbox" id="status-coupled" />
                  <span>Coupled</span>
                </label>
                <label class="status-option">
                  <input type="checkbox" id="status-married" />
                  <span>Married</span>
                </label>
              </div>
            </div>
            <div class="form-group">
              <label for="connection-status-input">Connection status</label>
              <textarea id="connection-status-input" rows="3" placeholder="What connection are you or if you are coupled or married willing to make"></textarea>
            </div>
            <div class="profile-editor-actions">
              <button class="small-btn" id="save-profile-btn">Save</button>
              <button class="secondary-btn" id="cancel-profile-btn">Cancel</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;

  const profileBtn = document.getElementById('profile-btn');
  document.getElementById('sign-out-btn').addEventListener('click', () => {
    privateMessageOpener = null;
    groupChatActive = false;
    currentSessionToken = '';
    clearPersistedSession();
    renderLoginPage();
  });
  document.getElementById('workspace-gayjesus-blog-btn').addEventListener('click', openGayjesusBlogPage);
  document.getElementById('workspace-friends-connect-btn').addEventListener('click', openFriendsConnectPage);
  document.getElementById('workspace-donate-btn').addEventListener('click', openDonationPopup);
  const profileMenu = document.getElementById('profile-menu');
  const editProfileItem = document.getElementById('edit-profile-item');
  const suggestionsBtn = document.getElementById('suggestions-btn');
  const suggestionsModal = document.getElementById('suggestions-modal');
  const closeSuggestionsBtn = document.getElementById('close-suggestions-btn');
  const sendSuggestionBtn = document.getElementById('send-suggestion-btn');
  const suggestionsInput = document.getElementById('suggestions-input');
  const vibeScoreInput = document.getElementById('vibe-score-input');
  const vibeScoreValue = document.getElementById('vibe-score-value');
  const profileEditorModal = document.getElementById('profile-editor-modal');
  const profileNameInput = document.getElementById('profile-name-input');
  const profileBioInput = document.getElementById('profile-bio-input');
  const profileNameDisplay = document.getElementById('profile-name-display');
  const profileBioDisplay = document.getElementById('profile-bio-display');
  const connectionStatusInput = document.getElementById('connection-status-input');
  const statusInputs = {
    Single: document.getElementById('status-single'),
    Coupled: document.getElementById('status-coupled'),
    Married: document.getElementById('status-married')
  };
  profileNameDisplay.textContent = currentProfileName;
  profileBioDisplay.textContent = currentProfileBio;

  if (profileToView) {
    profileNameInput.value = profileToView;
    profileBioInput.value = 'A little about you goes here.';
    profileEditorModal.querySelectorAll('input, textarea').forEach((field) => {
      field.disabled = true;
    });
    document.getElementById('save-profile-btn').classList.add('hidden');
    profileEditorModal.classList.remove('hidden');
  }

  profileBtn.addEventListener('click', (event) => {
    event.stopPropagation();
    profileMenu.classList.toggle('hidden');
  });

  editProfileItem.addEventListener('click', (event) => {
    event.stopPropagation();
    profileMenu.classList.add('hidden');
    profileNameInput.value = currentProfileName;
    profileBioInput.value = currentProfileBio;
    connectionStatusInput.value = currentConnectionStatus;
    Object.entries(statusInputs).forEach(([status, input]) => {
      input.checked = currentProfileStatuses.includes(status);
    });
    profileEditorModal.querySelectorAll('input, textarea').forEach((field) => {
      field.disabled = false;
    });
    document.getElementById('save-profile-btn').classList.remove('hidden');
    profileEditorModal.classList.remove('hidden');
  });

  suggestionsBtn.addEventListener('click', (event) => {
    event.stopPropagation();
    suggestionsModal.classList.remove('hidden');
  });

  vibeScoreInput.addEventListener('input', () => {
    communityVibeScore = Number(vibeScoreInput.value);
    vibeScoreValue.textContent = `${communityVibeScore}%`;
    const communityVibeScoreDisplay = document.getElementById('community-vibe-score');
    if (communityVibeScoreDisplay) communityVibeScoreDisplay.textContent = `${communityVibeScore}%`;
    localStorage.setItem('the-love-media-vibe-score', String(communityVibeScore));
  });

  closeSuggestionsBtn.addEventListener('click', () => {
    suggestionsModal.classList.add('hidden');
  });

  sendSuggestionBtn.addEventListener('click', () => {
    const suggestion = suggestionsInput.value.trim();
    if (!suggestion) return;
    addPrivateMailMessage('Gayjesus', currentProfileName, `Suggestion (${communityVibeScore}% vibe): ${suggestion}`, { permanent: true });
    suggestionsInput.value = '';
    suggestionsModal.classList.add('hidden');
  });

  document.getElementById('save-profile-btn').addEventListener('click', async () => {
    const nextName = profileNameInput.value.trim() || 'Gayjesus';
    const nextBio = profileBioInput.value.trim() || 'A little about you goes here.';
    currentProfileName = nextName;
    currentProfileBio = nextBio;
    currentConnectionStatus = document.getElementById('connection-status-input').value.trim();
    currentProfileStatuses = ['Single', 'Coupled', 'Married'].filter((status) => {
      return document.getElementById(`status-${status.toLowerCase()}`).checked;
    });
    localStorage.setItem('the-love-media-profile', JSON.stringify({
      name: currentProfileName,
      bio: currentProfileBio,
      statuses: currentProfileStatuses,
      connectionStatus: currentConnectionStatus
    }));
    try {
      await accountApi('/api/profile', {
        codename: currentProfileName,
        profile: {
          bio: currentProfileBio,
          statuses: currentProfileStatuses,
          connectionStatus: currentConnectionStatus
        }
      });
    } catch {
    }
    profileNameDisplay.textContent = nextName;
    profileBioDisplay.textContent = nextBio;
    profileEditorModal.classList.add('hidden');
  });

  document.getElementById('cancel-profile-btn').addEventListener('click', () => {
    profileEditorModal.classList.add('hidden');
  });

  document.addEventListener('click', (event) => {
    if (!profileMenu.contains(event.target) && !profileBtn.contains(event.target)) {
      profileMenu.classList.add('hidden');
    }
    if (!profileEditorModal.contains(event.target) && !event.target.closest('#profile-btn') && !event.target.closest('#edit-profile-item')) {
      profileEditorModal.classList.add('hidden');
    }
    if (!suggestionsModal.contains(event.target) && !event.target.closest('#suggestions-btn')) {
      suggestionsModal.classList.add('hidden');
    }
  });

  document.querySelectorAll('.room-tile[data-room-name]').forEach((roomTile) => {
    roomTile.addEventListener('click', () => openRoomPage(roomTile.dataset.roomName));
  });
  document.getElementById('back-to-main-btn').addEventListener('click', () => {
    window.history.back();
  });
}

function renderInitialRoute() {
  const hash = window.location.hash;
  if (hash === '#donation') {
    const returnHash = sessionStorage.getItem('the-love-media-donation-return-hash') || '#welcome';
    if (returnHash === '#workspace') {
      renderChatroomWorkspace();
    } else {
      const roomRoute = returnHash.match(/^#room\/([^/]+)$/);
      const roomName = roomRoute && roomNames.find((name) => roomIdForName(name) === roomRoute[1]);
      if (roomName) renderAllAroundMayhemRoom(roomName);
      else renderNextPage();
    }
    window.setTimeout(() => {
      if (window.location.hash === '#donation') openDonationPopup();
    }, 0);
    return;
  }
  if (hash === '#workspace') {
    renderChatroomWorkspace();
    return;
  }
  const roomRoute = hash.match(/^#room\/([^/]+)$/);
  if (roomRoute) {
    const roomName = roomNames.find((name) => roomIdForName(name) === roomRoute[1]);
    if (roomName) {
      renderAllAroundMayhemRoom(roomName);
      return;
    }
  }
  if (hash === '#welcome') {
    renderNextPage();
    return;
  }
  if (hash === '#welcome-videos') {
    openWelcomeVideosModal();
    return;
  }
  renderLoginPage();
}

migrateLocalAccounts();
renderInitialRoute();

const handleAuthHistoryBack = (event) => {
  const authHeading = document.querySelector('.login-card h1')?.textContent;
  const workspaceHeading = document.querySelector('.workspace-sidebar h1')?.textContent;
  if (window.location.hash === '#donation' && !document.querySelector('#donation-modal')) {
    openDonationPopup();
    return;
  }
  if (window.location.hash !== '#donation' && document.querySelector('#donation-modal')) {
    document.querySelector('#donation-modal').remove();
  }
  const roomRoute = window.location.hash.match(/^#room\/([^/]+)$/);
  if (window.location.hash === '#friends-connect' && !document.querySelector('#friends-connect-modal')) {
    openFriendsConnect();
    return;
  }
  if (window.location.hash === '#gayjesus-blog' && !document.querySelector('#gayjesus-blog-modal')) {
    openGayjesusBlogModal();
    return;
  }
  if (window.location.hash === '#welcome-videos' && !document.querySelector('#welcome-videos-modal')) {
    openWelcomeVideosModal();
    return;
  }
  if (window.location.hash !== '#friends-connect' && document.querySelector('#friends-connect-modal')) {
    document.querySelector('#friends-connect-modal').remove();
  }
  if (window.location.hash !== '#gayjesus-blog' && document.querySelector('#gayjesus-blog-modal')) {
    document.querySelector('#gayjesus-blog-modal').remove();
  }
  if (window.location.hash !== '#welcome-videos' && document.querySelector('#welcome-videos-modal')) {
    document.querySelector('#welcome-videos-modal').remove();
  }
  if (roomRoute && !document.querySelector('.room-shell')) {
    const roomName = roomNames.find((name) => roomIdForName(name) === roomRoute[1]);
    if (roomName) renderAllAroundMayhemRoom(roomName);
    return;
  }
  if ((event.state?.screen === 'workspace' || window.location.hash === '#workspace') && workspaceHeading !== 'Chatroom workspace') {
    renderChatroomWorkspace();
    return;
  }
  if (window.location.hash === '#workspace' && document.querySelector('.room-shell')) {
    renderChatroomWorkspace();
    return;
  }
  if (workspaceHeading === 'Chatroom workspace') {
    renderNextPage();
    return;
  }
  if (!window.location.hash && !document.querySelector('.login-card')) {
    currentSessionToken = '';
    renderLoginPage();
    return;
  }
  if (event.state?.screen === 'login' || authHeading === 'Forgot password?' || authHeading === 'Create an account') {
    renderLoginPage();
  }
};

window.addEventListener('popstate', handleAuthHistoryBack);
window.addEventListener('hashchange', handleAuthHistoryBack);
window.addEventListener('hashchange', () => {
  if (window.location.hash === '#workspace' && !document.querySelector('.workspace-sidebar')) {
    renderChatroomWorkspace();
  }
});
window.addEventListener('hashchange', () => {
  if (window.location.hash === '#friends-connect' && !document.querySelector('#friends-connect-modal')) {
    openFriendsConnect();
  }
});
window.addEventListener('hashchange', () => {
  if (window.location.hash === '#gayjesus-blog' && !document.querySelector('#gayjesus-blog-modal')) {
    openGayjesusBlogModal();
  }
});
const restoreDonationRoute = () => {
  if (window.location.hash !== '#donation' || document.querySelector('#donation-modal')) return;
  const returnHash = history.state?.returnHash || sessionStorage.getItem('the-love-media-donation-return-hash') || '#welcome';
  if (returnHash === '#workspace' && !document.querySelector('.workspace-sidebar')) renderChatroomWorkspace();
  const roomRoute = returnHash.match(/^#room\/([^/]+)$/);
  if (roomRoute && !document.querySelector('.room-shell')) {
    const roomName = roomNames.find((name) => roomIdForName(name) === roomRoute[1]);
    if (roomName) renderAllAroundMayhemRoom(roomName);
  }
  window.setTimeout(() => {
    if (window.location.hash === '#donation' && !document.querySelector('#donation-modal')) openDonationPopup();
  }, 0);
};
window.addEventListener('popstate', restoreDonationRoute);
window.addEventListener('hashchange', restoreDonationRoute);

window.addEventListener('beforeunload', clearPersistedSession);
window.addEventListener('pagehide', clearPersistedSession);
