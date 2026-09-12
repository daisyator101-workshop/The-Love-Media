import './index.css';

const app = document.getElementById('root');
const isLocalDevelopment = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
const configuredApiUrl = import.meta.env.VITE_API_URL || '';
const isKnownStaticSiteUrl = configuredApiUrl.includes('the-love-media.onrender.com')
  || window.location.hostname === 'the-love-media-6.onrender.com';
const apiBaseUrl = configuredApiUrl && !isKnownStaticSiteUrl
  ? configuredApiUrl.replace(/\/$/, '')
  : (isLocalDevelopment ? `http://${window.location.hostname}:3002` : 'https://the-love-media-api.onrender.com');
const configuredWebSocketUrl = import.meta.env.VITE_WS_URL || '';
const webSocketBaseUrl = configuredWebSocketUrl && !isKnownStaticSiteUrl
  ? configuredWebSocketUrl.replace(/\/$/, '')
  : (isLocalDevelopment ? `ws://${window.location.hostname}:3002` : 'wss://the-love-media-api.onrender.com');
const stripePaymentLink = 'https://buy.stripe.com/6oU00c4rhgoB83MelKeZ200';
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

let updateActiveRoomMates = () => {};

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
    updateActiveRoomMates();
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

let serverAccountCount = null;

function accountCountLabel() {
  return 'Server accounts';
}

function accountCount() {
  accounts = JSON.parse(localStorage.getItem('the-love-media-accounts') || '[]');
  const localCodenames = new Set(accounts.map((a) => (typeof a === 'string' ? a : a?.codename)).filter(Boolean));
  if (typeof serverAccountCount === 'number') {
    return Math.max(serverAccountCount, localCodenames.size, 1);
  }
  return Math.max(localCodenames.size, 1);
}

async function fetchServerAccountCount() {
  try {
    const res = await fetch(`${apiBaseUrl}/api/accounts-count`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });
    if (res.ok) {
      const data = await res.json();
      if (typeof data.count === 'number') {
        serverAccountCount = data.count;
        const totalMembers = accountCount();
        document.querySelectorAll('.hero-metrics .hero-metric-members, .hero-metrics div:first-child strong').forEach((el) => {
          el.textContent = totalMembers;
        });
      }
    }
  } catch {
  }
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
  const headers = { 'Content-Type': 'application/json' };
  // Only send Authorization header for authenticated endpoints (not login/register)
  if (currentSessionToken && !path.includes('/login') && !path.includes('/accounts')) {
    headers.Authorization = `Bearer ${currentSessionToken}`;
  }
  const response = await fetch(`${apiBaseUrl}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload)
  });
  const responseText = await response.text();
  let result = {};
  if (responseText) {
    try {
      result = JSON.parse(responseText);
    } catch {
      result = { error: responseText };
    }
  }
  if (!response.ok) throw new Error(result.error || 'Account service unavailable.');
  return result;
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

const emojiCategories = [
  {
    name: 'Smileys',
    icon: '😀',
    emojis: [
      '😀', '😃', '😄', '😁', '😆', '😅', '😂', '🤣', '😊', '😇',
      '🥹', '😉', '😌', '😍', '🥰', '😘', '😗', '😙', '😚', '😋',
      '😛', '😝', '😜', '🤪', '🤨', '🧐', '🤓', '😎', '🤩', '🥳',
      '😏', '😒', '😞', '😔', '😟', '😕', '🙁', '😣', '😖', '😫',
      '😩', '🥺', '😢', '😭', '😤', '😠', '😡', '🤯', '😳', '🥵',
      '🥶', '😱', '😨', '😰', '😥', '😓', '🤗', '🤔', '🫣', '🤭',
      '🫢', '🫡', '🤫', '🫠', '🤥', '😶', '😐', '😑', '😬', '🙄',
      '😯', '😦', '😧', '😮', '😲', '🥱', '😴', '🤤', '😪', '😵',
      '😵‍💫', '🤐', '🥴', '🤢', '🤮', '🤧', '😷', '🤒', '🤕', '🤑',
      '🤠', '😈', '👿', '🤡', '💩', '👻', '💀', '👽', '🤖', '🎃'
    ]
  },
  {
    name: 'Pride & Love',
    icon: '🏳️‍🌈',
    emojis: [
      '🏳️‍🌈', '🏳️‍⚧️', '🌈', '🦄', '❤️', '🧡', '💛', '💚', '💙', '💜',
      '🖤', '🤍', '🤎', '💖', '💗', '💓', '💞', '💕', '❣️', '💔',
      '❤️‍🔥', '❤️‍🩹', '💘', '💝', '💟', '💋', '💌', '🫂', '💑', '👩‍❤️‍👩',
      '👨‍❤️‍👨', '💏', '👩‍❤️‍💋‍👩', '👨‍❤️‍💋‍👨', '💐', '🌹', '🌺', '🌸', '✨', '🔥'
    ]
  },
  {
    name: 'Gestures',
    icon: '✌️',
    emojis: [
      '👍', '👎', '👊', '✊', '🤛', '🤜', '🤞', '✌️', '🫰', '🤟',
      '🤘', '👌', '🤌', '🤏', '👈', '👉', '👆', '👇', '☝️', '✋',
      '🤚', '🖐️', '🖖', '👋', '🤙', '🤝', '👏', '🙌', '👐', '🤲',
      '🙏', '✍️', '💅', '🤳', '💪', '👀', '👁️', '👅', '👄', '🧠'
    ]
  },
  {
    name: 'Party & Fun',
    icon: '🎉',
    emojis: [
      '🎉', '🎊', '🎈', '🎂', '🥂', '🍻', '🍹', '🍸', '🍷', '🍾',
      '🍿', '🍕', '🍔', '🌮', '🍩', '🍫', '🍓', '🍒', '🌟', '💫',
      '💥', '⚡', '🌙', '☀️', '👑', '💎', '🎵', '🎶', '🎸', '🎤',
      '🎧', '🎮', '🎲', '🏆', '🥇', '🎯', '🚀', '🛸', '🦋', '🍀'
    ]
  }
];

function setupEmojiPicker(buttonId, pickerId, inputId) {
  const button = document.getElementById(buttonId);
  const picker = document.getElementById(pickerId);
  const input = document.getElementById(inputId);
  if (!button || !picker || !input) return;

  let currentCategory = 0;

  const renderPicker = () => {
    picker.innerHTML = `
      <div class="emoji-picker-header">
        <div class="emoji-picker-tabs">
          ${emojiCategories.map((cat, idx) => `
            <button class="emoji-tab-btn ${idx === currentCategory ? 'active' : ''}" data-cat-idx="${idx}" type="button" title="${cat.name}">
              ${cat.icon}
            </button>
          `).join('')}
        </div>
      </div>
      <div class="emoji-picker-grid">
        ${emojiCategories[currentCategory].emojis.map((emoji) => `
          <button class="emoji-select-btn" type="button">${emoji}</button>
        `).join('')}
      </div>
    `;

    picker.querySelectorAll('.emoji-tab-btn').forEach((tabBtn) => {
      tabBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        currentCategory = Number(tabBtn.dataset.catIdx);
        renderPicker();
      });
    });

    picker.querySelectorAll('.emoji-select-btn').forEach((emojiButton) => {
      emojiButton.addEventListener('click', (e) => {
        e.stopPropagation();
        const start = input.selectionStart || input.value.length;
        const end = input.selectionEnd || input.value.length;
        input.value = `${input.value.slice(0, start)}${emojiButton.textContent}${input.value.slice(end)}`;
        input.focus();
        input.setSelectionRange(start + emojiButton.textContent.length, start + emojiButton.textContent.length);
        picker.classList.add('hidden');
      });
    });
  };

  renderPicker();

  button.addEventListener('click', (event) => {
    event.stopPropagation();
    document.querySelectorAll('.emoji-picker').forEach((otherPicker) => {
      if (otherPicker !== picker) otherPicker.classList.add('hidden');
    });
    picker.classList.toggle('hidden');
  });

  document.addEventListener('click', (event) => {
    if (!picker.contains(event.target) && !button.contains(event.target)) {
      picker.classList.add('hidden');
    }
  });
}

function renderLoginPage() {
  window.history.replaceState({ screen: 'login' }, '', window.location.pathname);
  const rememberedCredentials = getRememberedCredentials();
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
            <strong class="hero-metric-members">${accountCount()}</strong>
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
          <div class="password-input-wrap">
            <input id="password" type="password" placeholder="••••••••" />
            <button class="password-visibility-btn" id="toggle-login-password-btn" type="button" aria-label="Show password">Show</button>
          </div>
        </div>

        <label class="remember-login" for="remember-login-input">
          <input id="remember-login-input" type="checkbox" ${rememberedCredentials ? 'checked' : ''} />
          <span>Remember my codename on this device</span>
        </label>
        <label class="remember-login" for="remember-password-input">
          <input id="remember-password-input" type="checkbox" />
          <span>Remember my password in my browser</span>
        </label>

        <button class="primary-btn" id="login-btn">Log in</button>
        <p class="form-status" id="login-status" aria-live="polite"></p>

        <div class="form-footer">
          <button class="inline-link-button" id="forgot-password-link" type="button">Forgot password?</button>
          <p class="secondary-text">
            New here? <button class="inline-link-button" id="create-account-link" type="button">Create an account</button>
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
  document.getElementById('toggle-login-password-btn').addEventListener('click', () => {
    const isPassword = passwordInput.type === 'password';
    passwordInput.type = isPassword ? 'text' : 'password';
    document.getElementById('toggle-login-password-btn').textContent = isPassword ? 'Hide' : 'Show';
    document.getElementById('toggle-login-password-btn').setAttribute('aria-label', `${isPassword ? 'Hide' : 'Show'} password`);
  });

  document.getElementById('login-btn').addEventListener('click', async () => {
    const codename = codenameInput.value.trim();
    const password = passwordInput.value;
    const status = document.getElementById('login-status');
    if (!codename || !password) {
      status.textContent = 'Enter your codename and password.';
      return;
    }
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
      console.error('Login error:', error);
      status.textContent = error.message || 'Login failed. Please try again.';
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
    const resetKey = document.getElementById('reset-key-input').value.trim();
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
          <input id="new-codename" name="new-codename" type="text" autocomplete="username" placeholder="Choose your codename" />
        </div>

        <div class="form-group">
          <label for="reset-key">Password Reset Key- What do you love about Life?</label>
          <input id="reset-key" name="account-reset-key" type="password" autocomplete="new-password" placeholder="Enter reset key" />
        </div>

        <div class="form-group">
          <label for="new-password">Password</label>
          <input id="new-password" name="new-password" type="password" autocomplete="new-password" placeholder="Create a password" />
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

function normalizeVideoComments(video) {
  if (!video) return video;
  return {
    ...video,
    comments: Array.isArray(video?.comments) ? video.comments.map((comment) => ({
      id: comment?.id || crypto.randomUUID(),
      author: comment?.author || 'Anonymous',
      text: String(comment?.text || '').trim(),
      timestamp: Number(comment?.timestamp || Date.now())
    })).filter((comment) => comment.text) : []
  };
}

const DB_NAME = 'the-love-media-video-db';
const DB_VERSION = 1;
const VIDEO_STORE = 'videos';

function openVideoDB() {
  return new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') {
      resolve(null);
      return;
    }
    try {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains(VIDEO_STORE)) {
          db.createObjectStore(VIDEO_STORE, { keyPath: 'id' });
        }
      };
      request.onsuccess = (event) => resolve(event.target.result);
      request.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

const memoryVideosMap = new Map();

async function getWelcomeVideos() {
  const db = await openVideoDB();
  if (db) {
    try {
      const all = await new Promise((resolve) => {
        const tx = db.transaction(VIDEO_STORE, 'readonly');
        const store = tx.objectStore(VIDEO_STORE);
        const req = store.getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => resolve([]);
      });
      const welcomeVids = all.filter((v) => (v.kind || 'welcome') === 'welcome').sort((a, b) => b.timestamp - a.timestamp);
      if (welcomeVids.length > 0) return welcomeVids.map(normalizeVideoComments);
    } catch (e) {
      console.warn('IndexedDB read error:', e);
    }
  }
  const mem = Array.from(memoryVideosMap.values()).filter((v) => (v.kind || 'welcome') === 'welcome').sort((a, b) => b.timestamp - a.timestamp);
  if (mem.length > 0) return mem.map(normalizeVideoComments);

  try {
    return (JSON.parse(localStorage.getItem('the-love-media-welcome-videos') || '[]')).map(normalizeVideoComments);
  } catch {
    return [];
  }
}

async function saveWelcomeVideo(video) {
  video.kind = 'welcome';
  memoryVideosMap.set(video.id, video);
  const db = await openVideoDB();
  if (db) {
    try {
      await new Promise((resolve, reject) => {
        const tx = db.transaction(VIDEO_STORE, 'readwrite');
        const store = tx.objectStore(VIDEO_STORE);
        const req = store.put(video);
        req.onsuccess = () => resolve();
        req.onerror = (e) => reject(e);
      });
    } catch (e) {
      console.warn('IndexedDB save error:', e);
    }
  }
}

async function deleteWelcomeVideo(id) {
  memoryVideosMap.delete(id);
  const db = await openVideoDB();
  if (db) {
    try {
      await new Promise((resolve) => {
        const tx = db.transaction(VIDEO_STORE, 'readwrite');
        const store = tx.objectStore(VIDEO_STORE);
        const req = store.delete(id);
        req.onsuccess = () => resolve();
        req.onerror = () => resolve();
      });
    } catch {}
  }
}

async function getGayjesusBlogVideos() {
  const db = await openVideoDB();
  if (db) {
    try {
      const all = await new Promise((resolve) => {
        const tx = db.transaction(VIDEO_STORE, 'readonly');
        const store = tx.objectStore(VIDEO_STORE);
        const req = store.getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => resolve([]);
      });
      const blogVids = all.filter((v) => v.kind === 'blog').sort((a, b) => b.timestamp - a.timestamp);
      if (blogVids.length > 0) return blogVids.map(normalizeVideoComments);
    } catch (e) {
      console.warn('IndexedDB read error:', e);
    }
  }
  const mem = Array.from(memoryVideosMap.values()).filter((v) => v.kind === 'blog').sort((a, b) => b.timestamp - a.timestamp);
  if (mem.length > 0) return mem.map(normalizeVideoComments);

  try {
    return (JSON.parse(localStorage.getItem('the-love-media-gayjesus-blog-videos') || '[]')).map(normalizeVideoComments);
  } catch {
    return [];
  }
}

async function saveGayjesusBlogVideo(video) {
  video.kind = 'blog';
  memoryVideosMap.set(video.id, video);
  const db = await openVideoDB();
  if (db) {
    try {
      await new Promise((resolve, reject) => {
        const tx = db.transaction(VIDEO_STORE, 'readwrite');
        const store = tx.objectStore(VIDEO_STORE);
        const req = store.put(video);
        req.onsuccess = () => resolve();
        req.onerror = (e) => reject(e);
      });
    } catch (e) {
      console.warn('IndexedDB save error:', e);
    }
  }
}

async function deleteGayjesusBlogVideo(id) {
  memoryVideosMap.delete(id);
  const db = await openVideoDB();
  if (db) {
    try {
      await new Promise((resolve) => {
        const tx = db.transaction(VIDEO_STORE, 'readwrite');
        const store = tx.objectStore(VIDEO_STORE);
        const req = store.delete(id);
        req.onsuccess = () => resolve();
        req.onerror = () => resolve();
      });
    } catch {}
  }
}

async function addVideoComment({ videoId, kind, text }) {
  const cleaned = String(text || '').trim();
  if (!cleaned) return;

  const isWelcome = kind === 'welcome';
  const videos = isWelcome ? await getWelcomeVideos() : await getGayjesusBlogVideos();
  const targetVideo = videos.find((v) => v.id === videoId);
  if (targetVideo) {
    targetVideo.comments = [
      ...(Array.isArray(targetVideo.comments) ? targetVideo.comments : []),
      {
        id: crypto.randomUUID(),
        author: currentProfileName || 'Anonymous',
        text: cleaned,
        timestamp: Date.now()
      }
    ];
    if (isWelcome) {
      await saveWelcomeVideo(targetVideo);
    } else {
      await saveGayjesusBlogVideo(targetVideo);
    }
  }
}

function getBlogTopics(videos) {
  const defaultTopics = ['Welcome', 'Updates', 'Community', 'Events', 'Spotlight'];
  const existingTopics = videos
    .map((video) => String(video.topic || 'Welcome').trim())
    .filter(Boolean);

  return [...new Set([...defaultTopics, ...existingTopics])];
}

function renderBlogTopicList(videos) {
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
            <div style="margin-top:4px;"><a href="${video.url}" target="_blank" rel="noreferrer">Open video</a></div>
          </div>
        `).join('')}
      </div>
    `;
  }).join('');
}

async function openWelcomeScreenShare(label = 'Welcome & updates') {
  if (!navigator.mediaDevices?.getDisplayMedia) {
    window.alert('Screen sharing is not available in this browser.');
    return;
  }

  try {
    const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
    const existingShare = document.getElementById('welcome-screen-share');
    if (existingShare) existingShare.remove();

    const share = document.createElement('div');
    share.className = 'group-camera-screen welcome-screen-share';
    share.id = 'welcome-screen-share';
    share.innerHTML = `
      <div class="group-camera-screen-header">
        <div>
          <p class="eyebrow">${label}</p>
          <h2>Live screen share</h2>
        </div>
        <button class="secondary-btn" id="stop-welcome-screen-share-btn" type="button">Stop sharing</button>
      </div>
      <div class="welcome-screen-share-preview">
        <video id="welcome-screen-share-video" autoplay muted playsinline></video>
      </div>
      <p class="group-camera-screen-status">Your screen is being shared in this preview.</p>
    `;
    document.getElementById('root').appendChild(share);
    const video = document.getElementById('welcome-screen-share-video');
    video.srcObject = stream;
    video.play().catch(() => {});

    const stopSharing = () => {
      stream.getTracks().forEach((track) => track.stop());
      share.remove();
    };
    stream.getVideoTracks()[0].addEventListener('ended', stopSharing, { once: true });
    document.getElementById('stop-welcome-screen-share-btn').addEventListener('click', stopSharing);
  } catch {
    return;
  }
}

function openWelcomeVideosPage() {
  window.history.pushState({ screen: 'welcome-videos' }, '', `${window.location.pathname}#welcome-videos`);
  renderWelcomeVideosPage();
}

function getRecordingOptions() {
  const types = [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
    'video/mp4'
  ];
  for (const type of types) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(type)) {
      return { mimeType: type };
    }
  }
  return {};
}

function createMixedAudioStream(streams) {
  const validStreams = (streams || []).filter(
    (s) => s && typeof s.getAudioTracks === 'function' && s.getAudioTracks().some((t) => t.readyState === 'live')
  );

  if (validStreams.length === 0) {
    return { stream: new MediaStream(), close: () => {} };
  }

  validStreams.forEach((s) => s.getAudioTracks().forEach((t) => { t.enabled = true; }));

  if (validStreams.length === 1 && validStreams[0].getAudioTracks().length === 1) {
    const originalTrack = validStreams[0].getAudioTracks()[0];
    const cloneTrack = originalTrack.clone();
    cloneTrack.enabled = true;
    return {
      stream: new MediaStream([cloneTrack]),
      close: () => {
        try { cloneTrack.stop(); } catch {}
      }
    };
  }

  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) {
    const tracks = validStreams.flatMap((s) => s.getAudioTracks());
    return { stream: new MediaStream(tracks), close: () => {} };
  }

  try {
    const audioCtx = new AudioCtx();
    const dest = audioCtx.createMediaStreamDestination();
    let connectedCount = 0;

    validStreams.forEach((stream) => {
      try {
        if (stream.getAudioTracks().length > 0) {
          const source = audioCtx.createMediaStreamSource(stream);
          source.connect(dest);
          connectedCount++;
        }
      } catch (err) {
        console.warn('AudioContext source connect error:', err);
      }
    });

    if (connectedCount === 0) {
      audioCtx.close().catch(() => {});
      return { stream: new MediaStream(), close: () => {} };
    }

    return {
      stream: dest.stream,
      close: () => {
        try {
          audioCtx.close();
        } catch {}
      }
    };
  } catch (e) {
    console.warn('Error mixing audio streams:', e);
    const tracks = validStreams.flatMap((s) => s.getAudioTracks());
    return { stream: new MediaStream(tracks), close: () => {} };
  }
}

async function renderWelcomeVideosPage() {
  const videos = await getWelcomeVideos();
  const isGayjesus = currentProfileName.toLowerCase() === 'gayjesus';
  let recordingStream = null;
  let mediaRecorder = null;
  let recordedChunks = [];
  let previewCameraStream = null;
  let cameraStream = null;
  let screenStream = null;
  let audioMixer = null;

  const stopAllTracks = () => {
    if (audioMixer) {
      audioMixer.close();
      audioMixer = null;
    }
    if (previewCameraStream) {
      previewCameraStream.getTracks().forEach((track) => track.stop());
      previewCameraStream = null;
    }
    if (recordingStream) {
      recordingStream.getTracks().forEach((track) => track.stop());
      recordingStream = null;
    }
    if (cameraStream) {
      cameraStream.getTracks().forEach((track) => track.stop());
      cameraStream = null;
    }
    if (screenStream) {
      screenStream.getTracks().forEach((track) => track.stop());
      screenStream = null;
    }
  };

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
          <p class="eyebrow">Welcome & Updates</p>
          <span class="account-count">${accountCountLabel()}</span>
        </div>
        <h1>Welcome videos</h1>
        <p>Record fresh content or test your camera setup to welcome members.</p>
        
        <div id="video-recording-section" style="margin-top: 20px; padding: 18px; border-radius: 16px; background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.14);">
          <h3 style="margin: 0 0 12px; font-size: 1.1rem; display: flex; align-items: center; gap: 8px; color: #fff;">
            <span>📷 Camera & Recording Studio</span>
          </h3>

          <div id="recording-preview-container" style="position: relative; margin-bottom: 16px; border-radius: 12px; overflow: hidden; background: #000; min-height: 240px; display: flex; align-items: center; justify-content: center; border: 1px solid rgba(255,255,255,0.18);">
            <video id="camera-preview" autoplay muted playsinline style="width: 100%; height: 100%; min-height: 240px; max-height: 360px; object-fit: cover; display: none;"></video>
            
            <div id="camera-placeholder" style="text-align: center; padding: 24px; color: rgba(255,255,255,0.7);">
              <div style="font-size: 2.8rem; margin-bottom: 8px;">🎥</div>
              <p style="margin: 0 0 6px; font-weight: 600; color: #fff;">Camera Preview Off</p>
              <p style="margin: 0; font-size: 0.85rem; color: rgba(255,255,255,0.5);">Click "Start camera preview" below to test your webcam.</p>
            </div>

            <div id="camera-badge" style="display: none; position: absolute; top: 12px; left: 12px; background: rgba(0,0,0,0.7); padding: 4px 10px; border-radius: 20px; font-size: 0.78rem; font-weight: 700; color: #4ade80; border: 1px solid rgba(74, 222, 128, 0.4); backdrop-filter: blur(4px);">
              ● LIVE PREVIEW
            </div>
          </div>

          <div style="margin-bottom: 14px;">
            <label for="camera-device-select" style="display: block; font-size: 0.85rem; font-weight: 700; margin-bottom: 6px; color: #e2d7f5;">Choose Camera:</label>
            <select id="camera-device-select" style="width: 100%; padding: 10px 12px; border-radius: 10px; border: 1px solid rgba(255,255,255,0.2); background: rgba(20, 10, 35, 0.9); color: #fff; font-size: 0.9rem; cursor: pointer;">
              <option value="">Default Camera</option>
            </select>
          </div>

          <div style="margin-bottom: 14px;">
            <span style="display: block; font-size: 0.85rem; font-weight: 700; margin-bottom: 6px; color: #e2d7f5;">Recording Mode:</span>
            <div style="display: flex; flex-direction: column; gap: 8px;">
              <label style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
                <input id="recording-mode-camera" type="radio" name="recording-mode" value="camera" checked style="cursor: pointer;" />
                <span>📷 Record camera</span>
              </label>
              <label style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
                <input id="recording-mode-screen" type="radio" name="recording-mode" value="screen" style="cursor: pointer;" />
                <span>🖥️ Record screen</span>
              </label>
              <label style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
                <input id="recording-mode-both" type="radio" name="recording-mode" value="both" style="cursor: pointer;" />
                <span>🖼️ Record both (camera in corner)</span>
              </label>
            </div>
          </div>

          <div class="profile-editor-actions" style="display: flex; flex-wrap: wrap; gap: 10px;">
            <button class="small-btn" id="preview-recording-btn" type="button">Start camera preview</button>
            <button class="small-btn" id="stop-preview-btn" type="button" style="display: none; background: rgba(255,255,255,0.15);">Stop preview</button>
            <button class="small-btn" id="start-recording-btn" type="button" style="background: linear-gradient(135deg, #e11d48, #be123c);">🔴 Start recording</button>
            <button class="small-btn" id="stop-recording-btn" type="button" style="display: none; background: #dc2626;">⏹️ Stop recording</button>
          </div>
          <p class="private-message-status" id="recording-status" aria-live="polite" style="margin-top: 10px; font-weight: 600;"></p>
        </div>

        <div style="margin-top: 20px;">
          <h3>Your videos (${videos.length})</h3>
          <div class="friends-list" id="videos-list">
            ${videos.length ? videos.map((video) => `
              <div class="private-message-item" style="display:block; margin-bottom:12px; position: relative;">
                <div style="display: flex; justify-content: space-between; align-items: center;">
                  <strong>${video.title || 'Welcome video'}</strong>
                  ${isGayjesus ? `<button class="delete-video-btn" data-video-id="${video.id}" style="padding: 4px 8px; font-size: 0.75rem; background: rgba(255,80,120,0.3); border: 1px solid rgba(255,80,120,0.5); border-radius: 6px; color: #ff6b9d; cursor: pointer;">Delete</button>` : ''}
                </div>
                <video id="video-${video.id}" style="width: 100%; margin-top: 8px; border-radius: 8px; background: #000; max-height: 200px; object-fit: cover; cursor: pointer;" controls></video>
                <div style="margin-top: 12px;">
                  <div style="display: flex; flex-direction: column; gap: 8px;">
                    ${(video.comments || []).length ? (video.comments || []).map((comment) => `
                      <div style="display: flex; justify-content: flex-start;">
                        <div style="max-width: 85%; padding: 10px 12px; border-radius: 14px 14px 14px 4px; background: linear-gradient(135deg, rgba(255,130,180,0.22), rgba(255,255,255,0.05)); border: 1px solid rgba(255,255,255,0.08); box-shadow: 0 6px 16px rgba(0,0,0,0.12);">
                          <div style="font-size: 0.7rem; letter-spacing: 0.04em; text-transform: uppercase; color: #ffd4e4; margin-bottom: 4px; font-weight: 700;">${comment.author || 'Anonymous'}</div>
                          <div style="color: #f3f3f3; font-size: 0.86rem; line-height: 1.45;">${comment.text}</div>
                        </div>
                      </div>
                    `).join('') : '<p class="private-message-status">No comments yet.</p>'}
                  </div>
                  <div style="display: flex; gap: 8px; margin-top: 10px;">
                    <input class="comment-input" data-video-id="${video.id}" type="text" placeholder="Add a comment" style="flex: 1; min-width: 0; border-radius: 999px; border: 1px solid rgba(255,255,255,0.12); background: rgba(255,255,255,0.02); color: #fff; padding: 9px 12px;" />
                    <button class="comment-submit-btn" data-video-id="${video.id}" type="button" style="padding: 9px 12px; border-radius: 999px; background: linear-gradient(135deg, rgba(255, 128, 174, 0.35), rgba(137,109,255,0.28)); border: 1px solid rgba(255,255,255,0.08); color: #fff; cursor: pointer; font-weight: 700;">Comment</button>
                  </div>
                </div>
              </div>
            `).join('') : '<p class="private-message-status">No videos yet.</p>'}
          </div>
        </div>

        <div class="profile-editor-actions" style="margin-top: 20px;">
          <button class="secondary-btn" id="back-from-videos-btn" type="button">Back</button>
        </div>
      </div>
    </div>
  `;

  // Load videos into video elements
  videos.forEach((video) => {
    const videoElement = document.getElementById(`video-${video.id}`);
    if (videoElement && video.blob) {
      try {
        let blobUrl;
        if (video.blob instanceof Blob) {
          blobUrl = URL.createObjectURL(video.blob);
        } else if (Array.isArray(video.blob) || video.blob instanceof Uint8Array || video.blob.buffer) {
          const blob = new Blob([new Uint8Array(video.blob)], { type: 'video/webm' });
          blobUrl = URL.createObjectURL(blob);
        }
        if (blobUrl) {
          videoElement.src = blobUrl;
        }
      } catch (e) {
        console.warn('Error displaying video:', e);
      }
    }
  });

  // Setup event listeners
  const previewBtn = document.getElementById('preview-recording-btn');
  const stopPreviewBtn = document.getElementById('stop-preview-btn');
  const startBtn = document.getElementById('start-recording-btn');
  const stopBtn = document.getElementById('stop-recording-btn');
  const status = document.getElementById('recording-status');
  const placeholder = document.getElementById('camera-placeholder');
  const badge = document.getElementById('camera-badge');
  const cameraPreview = document.getElementById('camera-preview');
  const deviceSelect = document.getElementById('camera-device-select');
  const cameraRadio = document.getElementById('recording-mode-camera');
  const screenRadio = document.getElementById('recording-mode-screen');
  const bothRadio = document.getElementById('recording-mode-both');
  let currentRecordingMode = 'camera';

  const populateDevices = async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const videoDevices = devices.filter((d) => d.kind === 'videoinput');
      if (videoDevices.length > 0) {
        const currentVal = deviceSelect.value;
        deviceSelect.innerHTML = videoDevices.map((d, index) => 
          `<option value="${d.deviceId}">${d.label || `Camera ${index + 1}`}</option>`
        ).join('');
        if (currentVal && videoDevices.some((d) => d.deviceId === currentVal)) {
          deviceSelect.value = currentVal;
        }
      }
    } catch {
      // Ignore
    }
  };

  const getCameraStream = async (deviceId) => {
    const videoConstraints = deviceId ? { deviceId: { exact: deviceId } } : true;
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: videoConstraints, audio: true });
    } catch (err1) {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: videoConstraints, audio: false });
      } catch (err2) {
        if (deviceId) {
          stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        } else {
          throw err2;
        }
      }
      try {
        const audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        audioStream.getAudioTracks().forEach((track) => {
          track.enabled = true;
          stream.addTrack(track);
        });
      } catch (audioErr) {
        console.warn('Microphone access failed:', audioErr);
      }
    }
    return stream;
  };

  const stopCameraPreview = () => {
    if (previewCameraStream) {
      previewCameraStream.getTracks().forEach((track) => track.stop());
      previewCameraStream = null;
    }
    if (cameraPreview) {
      cameraPreview.srcObject = null;
      cameraPreview.style.display = 'none';
    }
    if (placeholder) placeholder.style.display = 'block';
    if (badge) badge.style.display = 'none';
    if (previewBtn) previewBtn.style.display = 'inline-block';
    if (stopPreviewBtn) stopPreviewBtn.style.display = 'none';
  };

  const ensureCameraPreview = async () => {
    if (currentRecordingMode === 'screen') {
      status.textContent = 'Choose "Record camera" or "Record both" to preview your camera.';
      return;
    }

    stopCameraPreview();
    status.textContent = 'Connecting to camera & microphone...';

    try {
      const selectedDeviceId = deviceSelect ? deviceSelect.value : '';
      previewCameraStream = await getCameraStream(selectedDeviceId);
      
      await populateDevices();

      if (cameraPreview) {
        cameraPreview.srcObject = previewCameraStream;
        cameraPreview.muted = true;
        cameraPreview.style.display = 'block';
        await cameraPreview.play().catch(() => {});
      }
      if (placeholder) placeholder.style.display = 'none';
      if (badge) {
        badge.style.display = 'block';
        badge.textContent = '● LIVE PREVIEW';
        badge.style.color = '#4ade80';
      }
      if (previewBtn) previewBtn.style.display = 'none';
      if (stopPreviewBtn) stopPreviewBtn.style.display = 'inline-block';

      const audioTrackCount = previewCameraStream.getAudioTracks().length;
      if (audioTrackCount > 0) {
        previewCameraStream.getAudioTracks().forEach((t) => { t.enabled = true; });
        status.textContent = '🎙️ Camera & Microphone live preview active. Select mode and click "Start recording" when ready.';
      } else {
        status.innerHTML = '📷 Camera preview active. <strong style="color: #fca5a5;">⚠️ Microphone is off or blocked by browser (video will record without sound).</strong>';
      }
    } catch (err) {
      stopCameraPreview();
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        status.innerHTML = `
          <div style="background: rgba(239, 68, 68, 0.15); border: 1px solid rgba(239, 68, 68, 0.4); border-radius: 12px; padding: 14px; text-align: left; color: #fca5a5; margin-top: 8px;">
            <strong style="color: #fff; font-size: 0.95rem; display: block; margin-bottom: 6px;">🔒 Camera or Microphone Permission Blocked in Browser</strong>
            Your browser blocked camera or microphone access for this site. To unblock:
            <ol style="margin: 8px 0 8px 20px; padding: 0; line-height: 1.5; font-size: 0.85rem;">
              <li>Click the <strong>tune/sliders icon</strong> (or camera icon) on the left side of your browser address bar next to <code>the-love-media-6.onrender.com</code>.</li>
              <li>Ensure both <strong>Camera</strong> and <strong>Microphone</strong> are set to <strong>Allow</strong>.</li>
              <li>Refresh the page and click <strong>"Start camera preview"</strong> again.</li>
            </ol>
          </div>
        `;
      } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
        status.textContent = 'No camera device found on this system. Please connect a webcam.';
      } else {
        status.textContent = `Camera error: ${err.message || err.name || 'Could not start camera preview.'}`;
      }
    }
  };

  if (deviceSelect) {
    deviceSelect.addEventListener('change', async () => {
      if (previewCameraStream) {
        await ensureCameraPreview();
      }
    });
  }

  populateDevices();

  cameraRadio.addEventListener('change', async () => {
    currentRecordingMode = 'camera';
    status.textContent = 'Camera mode selected. Click "Start camera preview" to test your camera & mic.';
    if (previewCameraStream) {
      await ensureCameraPreview();
    }
  });

  screenRadio.addEventListener('change', () => {
    currentRecordingMode = 'screen';
    stopCameraPreview();
    status.textContent = 'Screen mode selected. Click "Start recording" to select a screen or window.';
  });

  bothRadio.addEventListener('change', async () => {
    currentRecordingMode = 'both';
    status.textContent = 'Both mode selected. Preview your camera before recording.';
    if (previewCameraStream) {
      await ensureCameraPreview();
    }
  });

  if (previewBtn) {
    previewBtn.addEventListener('click', ensureCameraPreview);
  }

  if (stopPreviewBtn) {
    stopPreviewBtn.addEventListener('click', stopCameraPreview);
  }

  startBtn.addEventListener('click', async () => {
    try {
      if (currentRecordingMode === 'camera') {
        if (!previewCameraStream || !previewCameraStream.active) {
          const selectedDeviceId = deviceSelect ? deviceSelect.value : '';
          previewCameraStream = await getCameraStream(selectedDeviceId);
        }
        let micStream = null;
        if (previewCameraStream.getAudioTracks().length === 0) {
          try {
            micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
          } catch (micErr) {
            console.warn('Could not attach mic stream to camera recording:', micErr);
          }
        }
        audioMixer = createMixedAudioStream([previewCameraStream, micStream]);

        const videoTrack = previewCameraStream.getVideoTracks()[0];
        const audioTrack = audioMixer.stream.getAudioTracks()[0];
        const tracks = [videoTrack].filter(Boolean);
        if (audioTrack) tracks.push(audioTrack);

        recordingStream = new MediaStream(tracks);

        if (cameraPreview) {
          cameraPreview.srcObject = previewCameraStream;
          cameraPreview.muted = true;
          cameraPreview.style.display = 'block';
          await cameraPreview.play().catch(() => {});
        }
        if (placeholder) placeholder.style.display = 'none';

        const hasMic = audioMixer.stream.getAudioTracks().length > 0;

        if (badge) {
          badge.style.display = 'block';
          badge.textContent = hasMic ? '🔴 RECORDING CAMERA + MIC' : '🔴 RECORDING (NO MIC)';
          badge.style.color = '#ef4444';
        }
      } else if (currentRecordingMode === 'screen') {
        screenStream = await navigator.mediaDevices.getDisplayMedia({ video: { cursor: 'always' }, audio: true });
        let micStream = null;
        try {
          micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        } catch (micErr) {
          console.warn('Could not get mic for screen recording:', micErr);
        }

        audioMixer = createMixedAudioStream([screenStream, micStream]);

        const videoTrack = screenStream.getVideoTracks()[0];
        const audioTrack = audioMixer.stream.getAudioTracks()[0];
        const tracks = [videoTrack].filter(Boolean);
        if (audioTrack) tracks.push(audioTrack);

        recordingStream = new MediaStream(tracks);

        if (cameraPreview) {
          cameraPreview.srcObject = screenStream;
          cameraPreview.muted = true;
          cameraPreview.style.display = 'block';
          await cameraPreview.play().catch(() => {});
        }
        if (placeholder) placeholder.style.display = 'none';

        const hasAudio = audioMixer.stream.getAudioTracks().length > 0;
        if (badge) {
          badge.style.display = 'block';
          badge.textContent = hasAudio ? '🖥️ RECORDING SCREEN + AUDIO' : '🖥️ RECORDING SCREEN (NO AUDIO)';
          badge.style.color = '#ef4444';
        }
      } else if (currentRecordingMode === 'both') {
        if (!previewCameraStream || !previewCameraStream.active) {
          const selectedDeviceId = deviceSelect ? deviceSelect.value : '';
          previewCameraStream = await getCameraStream(selectedDeviceId);
        }
        cameraStream = previewCameraStream;
        screenStream = await navigator.mediaDevices.getDisplayMedia({ video: { cursor: 'always' }, audio: true });
        
        let micStream = null;
        if (cameraStream.getAudioTracks().length === 0) {
          try {
            micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
          } catch {}
        }

        audioMixer = createMixedAudioStream([cameraStream, screenStream, micStream]);

        const canvas = document.createElement('canvas');
        canvas.width = 1280;
        canvas.height = 720;
        const ctx = canvas.getContext('2d');
        
        const screenVideo = document.createElement('video');
        const cameraVideo = document.createElement('video');
        screenVideo.muted = true;
        cameraVideo.muted = true;
        screenVideo.srcObject = screenStream;
        cameraVideo.srcObject = cameraStream;
        await screenVideo.play().catch(() => {});
        await cameraVideo.play().catch(() => {});
        
        const canvasStream = canvas.captureStream(30);
        const canvasVideoTrack = canvasStream.getVideoTracks()[0];
        const mixedAudioTrack = audioMixer.stream.getAudioTracks()[0];

        const tracks = [canvasVideoTrack].filter(Boolean);
        if (mixedAudioTrack) tracks.push(mixedAudioTrack);

        recordingStream = new MediaStream(tracks);
        
        if (cameraPreview) {
          cameraPreview.srcObject = canvasStream;
          cameraPreview.muted = true;
          cameraPreview.style.display = 'block';
          await cameraPreview.play().catch(() => {});
        }
        if (placeholder) placeholder.style.display = 'none';
        
        const hasAudio = audioMixer.stream.getAudioTracks().length > 0;
        if (badge) {
          badge.style.display = 'block';
          badge.textContent = hasAudio ? '🔴 RECORDING BOTH + AUDIO' : '🔴 RECORDING BOTH (NO AUDIO)';
          badge.style.color = '#ef4444';
        }

        const drawLoop = setInterval(() => {
          if (!screenVideo.paused && !screenVideo.ended) {
            ctx.drawImage(screenVideo, 0, 0, canvas.width, canvas.height);
            if (!cameraVideo.paused && !cameraVideo.ended) {
              const camWidth = 240;
              const camHeight = 160;
              ctx.drawImage(cameraVideo, canvas.width - camWidth - 20, canvas.height - camHeight - 20, camWidth, camHeight);
              ctx.strokeStyle = '#ffffff';
              ctx.lineWidth = 3;
              ctx.strokeRect(canvas.width - camWidth - 20, canvas.height - camHeight - 20, camWidth, camHeight);
            }
          }
        }, 1000 / 30);

        startBtn.dataset.drawLoop = drawLoop;
      }

      recordedChunks = [];
      const options = getRecordingOptions();
      mediaRecorder = new MediaRecorder(recordingStream, options);
      mediaRecorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          recordedChunks.push(event.data);
        }
      };
      mediaRecorder.onstop = async () => {
        const mimeType = options.mimeType || 'video/webm';
        const blob = new Blob(recordedChunks, { type: mimeType });
        
        if (startBtn.dataset.drawLoop) {
          clearInterval(parseInt(startBtn.dataset.drawLoop));
          delete startBtn.dataset.drawLoop;
        }

        stopAllTracks();
        stopCameraPreview();

        if (!blob || blob.size === 0) {
          status.textContent = 'Recorded video was empty. Please try recording again.';
          return;
        }

        status.textContent = 'Video recorded! Enter a title to save:';
        const title = window.prompt('Video title:', 'Welcome video');
        if (title) {
          status.textContent = 'Posting video...';
          const newVideo = {
            id: crypto.randomUUID(),
            title: title.trim() || 'Welcome video',
            blob: blob,
            timestamp: Date.now(),
            type: currentRecordingMode,
            comments: [],
            kind: 'welcome'
          };
          await saveWelcomeVideo(newVideo);
          status.textContent = 'Video posted successfully!';
          await renderWelcomeVideosPage();
        } else {
          status.textContent = 'Recording discarded.';
        }
      };

      mediaRecorder.start(500);
      startBtn.style.display = 'none';
      stopBtn.style.display = 'inline-block';
      if (previewBtn) previewBtn.style.display = 'none';
      if (stopPreviewBtn) stopPreviewBtn.style.display = 'none';
      if (deviceSelect) deviceSelect.disabled = true;
      cameraRadio.disabled = true;
      screenRadio.disabled = true;
      bothRadio.disabled = true;
      status.textContent = 'Recording in progress... Click "Stop recording" when finished.';
    } catch (error) {
      status.textContent = `Recording error: ${error.message || 'Could not start recording.'}`;
      if (deviceSelect) deviceSelect.disabled = false;
      cameraRadio.disabled = false;
      screenRadio.disabled = false;
      bothRadio.disabled = false;
      startBtn.style.display = 'inline-block';
      stopBtn.style.display = 'none';
    }
  });

  stopBtn.addEventListener('click', () => {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
      mediaRecorder.stop();
    }
    startBtn.style.display = 'inline-block';
    stopBtn.style.display = 'none';
    if (deviceSelect) deviceSelect.disabled = false;
    cameraRadio.disabled = false;
    screenRadio.disabled = false;
    bothRadio.disabled = false;
  });

  document.querySelectorAll('.comment-submit-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const videoId = btn.getAttribute('data-video-id');
      const input = document.querySelector(`.comment-input[data-video-id="${videoId}"]`);
      if (!input) return;
      await addVideoComment({ videoId, kind: 'welcome', text: input.value });
      input.value = '';
      await renderWelcomeVideosPage();
    });
  });

  document.querySelectorAll('.comment-input').forEach((input) => {
    input.addEventListener('keydown', async (event) => {
      if (event.key === 'Enter') {
        const videoId = input.getAttribute('data-video-id');
        await addVideoComment({ videoId, kind: 'welcome', text: input.value });
        input.value = '';
        await renderWelcomeVideosPage();
      }
    });
  });

  document.querySelectorAll('.delete-video-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (window.confirm('Delete this video?')) {
        const videoId = btn.getAttribute('data-video-id');
        await deleteWelcomeVideo(videoId);
        await renderWelcomeVideosPage();
      }
    });
  });

  document.getElementById('back-from-videos-btn').addEventListener('click', () => {
    stopAllTracks();
    window.history.back();
  });
}

function openWelcomeVideosModal() {
  openWelcomeVideosPage();
}

function openGayjesusBlogPage() {
  window.history.pushState({ screen: 'gayjesus-blog' }, '', `${window.location.pathname}#gayjesus-blog`);
  renderGayjesusBlogPage();
}

async function renderGayjesusBlogPage() {
  const videos = await getGayjesusBlogVideos();
  const isGayjesus = currentProfileName.toLowerCase() === 'gayjesus';
  const topicOptions = getBlogTopics(videos);
  let recordingStream = null;
  let mediaRecorder = null;
  let recordedChunks = [];

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
          <p class="eyebrow">Gayjesus</p>
          <span class="account-count">${accountCountLabel()}</span>
        </div>
        <h1>Blog & topic videos</h1>
        <p>Church updates, lifestyle, advice, and community topics.</p>

        <div class="church-feature-card" style="margin-top: 16px; padding: 14px; border-radius: 14px; background: rgba(148, 102, 211, 0.15); border: 1px solid rgba(148, 102, 211, 0.3);">
          <p style="margin: 0 0 6px; font-size: 0.78rem; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: #d4a5ff;">Church where I reside</p>
          <h4 style="margin: 0 0 4px;">Phoenix Community Church UCC</h4>
          <p style="margin: 0 0 4px; color: #f0d6ff; font-size: 0.9rem;">Progressive and inclusive Open and Affirming congregation in Kalamazoo, Michigan.</p>
          <p style="margin: 0 0 8px; color: #e9dff6; font-size: 0.85rem;">345 W. Michigan Ave., Kalamazoo, MI 49007</p>
          <a style="display: inline-block; padding: 6px 12px; border-radius: 8px; background: rgba(148, 102, 211, 0.3); color: #d4a5ff; text-decoration: none; font-size: 0.75rem; font-weight: 700;" href="https://www.phoenixcommunitychurch.org/" target="_blank" rel="noopener noreferrer">Visit church website</a>
        </div>

        <div id="blog-recording-section" style="margin-top: 20px; padding: 16px; border-radius: 16px; background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.14);">
          <div id="blog-recording-preview" style="display: none; margin-bottom: 16px;">
            <video id="blog-camera-preview" autoplay muted playsinline style="width: 100%; border-radius: 12px; background: #000; max-height: 300px; object-fit: cover;"></video>
          </div>
          <div class="form-group">
            <label for="blog-video-title">Video title</label>
            <input id="blog-video-title" type="text" placeholder="Topic video title" />
          </div>
          <div class="form-group">
            <label for="blog-custom-topic">Topic</label>
            <input id="blog-custom-topic" type="text" placeholder="Example: Dating, Advice, Lifestyle" />
          </div>
          <div style="margin-bottom: 12px;">
            <label style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
              <input id="blog-recording-mode-camera" type="radio" name="blog-recording-mode" value="camera" checked style="cursor: pointer;" />
              <span>Record camera</span>
            </label>
            <label style="display: flex; align-items: center; gap: 8px; cursor: pointer; margin-top: 8px;">
              <input id="blog-recording-mode-screen" type="radio" name="blog-recording-mode" value="screen" style="cursor: pointer;" />
              <span>Record screen</span>
            </label>
            <label style="display: flex; align-items: center; gap: 8px; cursor: pointer; margin-top: 8px;">
              <input id="blog-recording-mode-both" type="radio" name="blog-recording-mode" value="both" style="cursor: pointer;" />
              <span>Record both (camera in corner)</span>
            </label>
          </div>
          <div class="profile-editor-actions">
            <button class="small-btn" id="preview-blog-recording-btn" type="button">Preview camera</button>
            <button class="small-btn" id="start-blog-recording-btn" type="button">Start recording</button>
            <button class="small-btn" id="stop-blog-recording-btn" type="button" style="display: none;">Stop recording</button>
          </div>
          <p class="private-message-status" id="blog-recording-status" aria-live="polite"></p>
        </div>

        <div style="margin-top: 20px;">
          <h3>Blog videos by topic</h3>
          <div class="friends-list" id="gayjesus-blog-list">
            ${renderBlogTopicListWithDelete(videos, isGayjesus)}
          </div>
        </div>

        <div class="profile-editor-actions" style="margin-top: 20px;">
          <button class="secondary-btn" id="back-from-blog-btn" type="button">Back</button>
        </div>
      </div>
    </div>
  `;

  // Load videos into video elements
  videos.forEach((video) => {
    const videoElement = document.getElementById(`blog-video-${video.id}`);
    if (videoElement && video.blob) {
      try {
        let blobUrl;
        if (video.blob instanceof Blob) {
          blobUrl = URL.createObjectURL(video.blob);
        } else if (Array.isArray(video.blob) || video.blob instanceof Uint8Array || video.blob.buffer) {
          const blob = new Blob([new Uint8Array(video.blob)], { type: 'video/webm' });
          blobUrl = URL.createObjectURL(blob);
        }
        if (blobUrl) {
          videoElement.src = blobUrl;
        }
      } catch (e) {
        console.warn('Error displaying blog video:', e);
      }
    }
  });

  // Setup event listeners
  const titleInput = document.getElementById('blog-video-title');
  const topicInput = document.getElementById('blog-custom-topic');
  const previewBtn = document.getElementById('preview-blog-recording-btn');
  const startBtn = document.getElementById('start-blog-recording-btn');
  const stopBtn = document.getElementById('stop-blog-recording-btn');
  const status = document.getElementById('blog-recording-status');
  const previewDiv = document.getElementById('blog-recording-preview');
  const cameraPreview = document.getElementById('blog-camera-preview');
  const cameraRadio = document.getElementById('blog-recording-mode-camera');
  const screenRadio = document.getElementById('blog-recording-mode-screen');
  const bothRadio = document.getElementById('blog-recording-mode-both');
  let currentRecordingMode = 'camera';
  let cameraStream = null;
  let screenStream = null;
  let previewCameraStream = null;
  let audioMixer = null;

  const stopCameraPreview = () => {
    if (previewCameraStream) {
      previewCameraStream.getTracks().forEach((track) => track.stop());
      previewCameraStream = null;
    }
    if (cameraPreview) {
      cameraPreview.srcObject = null;
    }
  };

  const getBlogCameraStream = async () => {
    try {
      return await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    } catch {
      return await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    }
  };

  const ensureCameraPreview = async () => {
    if (currentRecordingMode === 'screen') {
      status.textContent = 'Choose camera or both to preview the camera.';
      return;
    }

    stopCameraPreview();
    status.textContent = 'Accessing camera...';
    previewDiv.style.display = 'block';

    try {
      previewCameraStream = await getBlogCameraStream();
      if (cameraPreview) {
        cameraPreview.srcObject = previewCameraStream;
        await cameraPreview.play().catch(() => {});
      }
      status.textContent = 'Camera preview live. When ready, start recording.';
    } catch (err) {
      status.textContent = err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError'
        ? 'Camera permission denied. Please allow camera access in your browser.'
        : `Could not access camera (${err.message || 'No camera found'}).`;
    }
  };

  cameraRadio.addEventListener('change', async () => {
    currentRecordingMode = 'camera';
    previewDiv.style.display = 'none';
    status.textContent = 'Camera mode selected. Preview before you record.';
    await ensureCameraPreview();
  });

  screenRadio.addEventListener('change', () => {
    currentRecordingMode = 'screen';
    stopCameraPreview();
    previewDiv.style.display = 'none';
    status.textContent = 'Screen mode selected. Choose a screen to record.';
  });

  bothRadio.addEventListener('change', async () => {
    currentRecordingMode = 'both';
    previewDiv.style.display = 'none';
    status.textContent = 'Both mode selected. Preview the camera before you record.';
    await ensureCameraPreview();
  });

  previewBtn.addEventListener('click', ensureCameraPreview);

  startBtn.addEventListener('click', async () => {
    try {
      if (currentRecordingMode === 'camera') {
        if (!previewCameraStream) {
          previewCameraStream = await getBlogCameraStream();
        }
        let micStream = null;
        if (previewCameraStream.getAudioTracks().length === 0) {
          try { micStream = await navigator.mediaDevices.getUserMedia({ audio: true }); } catch {}
        }
        audioMixer = createMixedAudioStream([previewCameraStream, micStream]);
        const videoTrack = previewCameraStream.getVideoTracks()[0];
        const audioTrack = audioMixer.stream.getAudioTracks()[0];
        const tracks = [videoTrack].filter(Boolean);
        if (audioTrack) tracks.push(audioTrack);
        recordingStream = new MediaStream(tracks);

        if (cameraPreview) {
          cameraPreview.srcObject = previewCameraStream;
          cameraPreview.muted = true;
          await cameraPreview.play().catch(() => {});
        }
      } else if (currentRecordingMode === 'screen') {
        screenStream = await navigator.mediaDevices.getDisplayMedia({ video: { cursor: 'always' }, audio: true });
        let micStream = null;
        try { micStream = await navigator.mediaDevices.getUserMedia({ audio: true }); } catch {}
        audioMixer = createMixedAudioStream([screenStream, micStream]);
        const videoTrack = screenStream.getVideoTracks()[0];
        const audioTrack = audioMixer.stream.getAudioTracks()[0];
        const tracks = [videoTrack].filter(Boolean);
        if (audioTrack) tracks.push(audioTrack);
        recordingStream = new MediaStream(tracks);

        if (cameraPreview) {
          cameraPreview.srcObject = screenStream;
          cameraPreview.muted = true;
          await cameraPreview.play().catch(() => {});
        }
      } else if (currentRecordingMode === 'both') {
        if (!previewCameraStream) {
          previewCameraStream = await getBlogCameraStream();
        }
        cameraStream = previewCameraStream;
        screenStream = await navigator.mediaDevices.getDisplayMedia({ video: { cursor: 'always' }, audio: true });
        let micStream = null;
        if (cameraStream.getAudioTracks().length === 0) {
          try { micStream = await navigator.mediaDevices.getUserMedia({ audio: true }); } catch {}
        }
        audioMixer = createMixedAudioStream([cameraStream, screenStream, micStream]);

        const canvas = document.createElement('canvas');
        canvas.width = 1920;
        canvas.height = 1080;
        const ctx = canvas.getContext('2d');
        
        const screenVideo = document.createElement('video');
        const cameraVideo = document.createElement('video');
        screenVideo.muted = true;
        cameraVideo.muted = true;
        screenVideo.srcObject = screenStream;
        cameraVideo.srcObject = cameraStream;
        await screenVideo.play().catch(() => {});
        await cameraVideo.play().catch(() => {});
        
        const canvasStream = canvas.captureStream(30);
        const videoTrack = canvasStream.getVideoTracks()[0];
        const audioTrack = audioMixer.stream.getAudioTracks()[0];
        const tracks = [videoTrack].filter(Boolean);
        if (audioTrack) tracks.push(audioTrack);
        recordingStream = new MediaStream(tracks);

        // Animation loop to draw to canvas
        const drawLoop = setInterval(() => {
          if (!screenVideo.paused) {
            ctx.drawImage(screenVideo, 0, 0, canvas.width, canvas.height);
            // Draw camera in bottom-right corner (250x180)
            if (!cameraVideo.paused) {
              ctx.drawImage(cameraVideo, canvas.width - 260, canvas.height - 190, 250, 180);
              // Add border
              ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
              ctx.lineWidth = 2;
              ctx.strokeRect(canvas.width - 260, canvas.height - 190, 250, 180);
            }
          }
        }, 1000 / 30);
        
        startBtn.dataset.drawLoop = drawLoop;
        startBtn.dataset.screenVideo = screenVideo;
        startBtn.dataset.cameraVideo = cameraVideo;
      }
      
      previewDiv.style.display = 'block';
      recordedChunks = [];
      const options = getRecordingOptions();
      mediaRecorder = new MediaRecorder(recordingStream, options);
      mediaRecorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          recordedChunks.push(event.data);
        }
      };
      mediaRecorder.onstop = async () => {
        if (audioMixer) {
          audioMixer.close();
          audioMixer = null;
        }
        const mimeType = options.mimeType || 'video/webm';
        const blob = new Blob(recordedChunks, { type: mimeType });
        recordingStream.getTracks().forEach((track) => track.stop());
        if (cameraStream) cameraStream.getTracks().forEach((track) => track.stop());
        if (screenStream) screenStream.getTracks().forEach((track) => track.stop());
        
        if (startBtn.dataset.drawLoop) {
          clearInterval(parseInt(startBtn.dataset.drawLoop));
          delete startBtn.dataset.drawLoop;
        }
        
        previewDiv.style.display = 'none';
          status.textContent = 'Video recorded! Add a title and topic to save.';
          
          const title = titleInput.value.trim() || 'Blog video';
          const topic = topicInput.value.trim() || 'Updates';
          if (title) {
            const newVideo = { id: crypto.randomUUID(), title, topic, blob: blob, timestamp: Date.now(), type: currentRecordingMode, comments: [], kind: 'blog' };
            await saveGayjesusBlogVideo(newVideo);
            status.textContent = 'Video saved!';
            titleInput.value = '';
            topicInput.value = '';
            await renderGayjesusBlogPage();
          }
        };
        mediaRecorder.start(500);
        startBtn.style.display = 'none';
        stopBtn.style.display = 'inline-block';
        cameraRadio.disabled = true;
        screenRadio.disabled = true;
        bothRadio.disabled = true;
        status.textContent = 'Recording...';
      } catch (error) {
        status.textContent = currentRecordingMode === 'camera' ? 'Camera access denied or not available.' : (currentRecordingMode === 'screen' ? 'Screen share cancelled or not available.' : 'Camera or screen access denied.');
        cameraRadio.disabled = false;
        screenRadio.disabled = false;
        bothRadio.disabled = false;
      }
    });

    stopBtn.addEventListener('click', () => {
      if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        mediaRecorder.stop();
      }
      startBtn.style.display = 'inline-block';
      stopBtn.style.display = 'none';
      cameraRadio.disabled = false;
      screenRadio.disabled = false;
      bothRadio.disabled = false;
    });

    // Delete video buttons
    document.querySelectorAll('.blog-comment-submit-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const videoId = btn.getAttribute('data-video-id');
        const input = document.querySelector(`.blog-comment-input[data-video-id="${videoId}"]`);
        if (!input) return;
        await addVideoComment({ videoId, kind: 'blog', text: input.value });
        input.value = '';
        await renderGayjesusBlogPage();
      });
    });

    document.querySelectorAll('.blog-comment-input').forEach((input) => {
      input.addEventListener('keydown', async (event) => {
        if (event.key === 'Enter') {
          const videoId = input.getAttribute('data-video-id');
          await addVideoComment({ videoId, kind: 'blog', text: input.value });
          input.value = '';
          await renderGayjesusBlogPage();
        }
      });
    });

    document.querySelectorAll('.delete-blog-video-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (window.confirm('Delete this video?')) {
          const videoId = btn.getAttribute('data-video-id');
          await deleteGayjesusBlogVideo(videoId);
          await renderGayjesusBlogPage();
        }
      });
    });

  document.getElementById('back-from-blog-btn').addEventListener('click', () => {
    window.history.back();
  });
}

function renderBlogTopicListWithDelete(videos, isGayjesus) {
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
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <strong>${video.title || 'Blog video'}</strong>
              ${isGayjesus ? `<button class="delete-blog-video-btn" data-video-id="${video.id}" style="padding: 4px 8px; font-size: 0.75rem; background: rgba(255,80,120,0.3); border: 1px solid rgba(255,80,120,0.5); border-radius: 6px; color: #ff6b9d; cursor: pointer;">Delete</button>` : ''}
            </div>
            <video id="blog-video-${video.id}" style="width: 100%; margin-top: 8px; border-radius: 8px; background: #000; max-height: 150px; object-fit: cover; cursor: pointer;" controls></video>
            <div style="margin-top: 12px;">
              <div style="display: flex; flex-direction: column; gap: 8px;">
                ${(video.comments || []).length ? (video.comments || []).map((comment) => `
                  <div style="display: flex; justify-content: flex-start;">
                    <div style="max-width: 85%; padding: 10px 12px; border-radius: 14px 14px 14px 4px; background: linear-gradient(135deg, rgba(255,130,180,0.22), rgba(255,255,255,0.05)); border: 1px solid rgba(255,255,255,0.08); box-shadow: 0 6px 16px rgba(0,0,0,0.12);">
                      <div style="font-size: 0.7rem; letter-spacing: 0.04em; text-transform: uppercase; color: #ffd4e4; margin-bottom: 4px; font-weight: 700;">${comment.author || 'Anonymous'}</div>
                      <div style="color: #f3f3f3; font-size: 0.86rem; line-height: 1.45;">${comment.text}</div>
                    </div>
                  </div>
                `).join('') : '<p class="private-message-status">No comments yet.</p>'}
              </div>
              <div style="display: flex; gap: 8px; margin-top: 10px;">
                <input class="blog-comment-input" data-video-id="${video.id}" type="text" placeholder="Add a comment" style="flex: 1; min-width: 0; border-radius: 999px; border: 1px solid rgba(255,255,255,0.12); background: rgba(255,255,255,0.02); color: #fff; padding: 9px 12px;" />
                <button class="blog-comment-submit-btn" data-video-id="${video.id}" type="button" style="padding: 9px 12px; border-radius: 999px; background: linear-gradient(135deg, rgba(255, 128, 174, 0.35), rgba(137,109,255,0.28)); border: 1px solid rgba(255,255,255,0.08); color: #fff; cursor: pointer; font-weight: 700;">Comment</button>
              </div>
            </div>
          </div>
        `).join('')}
      </div>
    `;
  }).join('');
}

function openGayjesusBlogModal() {
  renderGayjesusBlogPage();
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
  document.getElementById('welcome-videos-btn').addEventListener('click', openWelcomeVideosModal);
  document.getElementById('gayjesus-blog-btn').addEventListener('click', openGayjesusBlogPage);
  document.getElementById('back-btn').addEventListener('click', (event) => {
    event.preventDefault();
    window.history.back();
  });
  document.getElementById('delete-account-btn').addEventListener('click', async () => {
    const status = document.getElementById('account-delete-status');
    if (!window.confirm('Delete your account permanently?')) return;

    try {
      await accountApi('/api/delete-account', { codename: currentProfileName });
      accounts = accounts.filter((account) => account.codename.toLowerCase() !== currentProfileName.toLowerCase());
      localStorage.setItem('the-love-media-accounts', JSON.stringify(accounts));
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
      window.location.href = stripePaymentLink;
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
    overlay.remove();
    openGroupChatMessagePopup();
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
            <button type="button">😀</button><button type="button">😂</button><button type="button">🥰</button><button type="button">😍</button><button type="button">😎</button><button type="button">❤️</button><button type="button">🏳️‍🌈</button><button type="button">🎉</button>
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

function openGroupCameraScreen(cameraCount = 4) {
  let activeCameraCount = Math.min(16, Math.max(1, Number(cameraCount) || 4));
  const existingScreen = document.getElementById('group-camera-screen');
  if (existingScreen) existingScreen.remove();

  const cameraScreen = document.createElement('div');
  cameraScreen.className = 'group-camera-screen';
  cameraScreen.id = 'group-camera-screen';
  cameraScreen.innerHTML = `
    <div class="group-camera-screen-header">
      <div>
        <p class="eyebrow">The Love Media</p>
        <h2>Group camera view</h2>
      </div>
      <div class="group-camera-screen-actions">
        <div class="group-camera-controls">
          <label for="group-screen-camera-count">Cameras</label>
          <input id="group-screen-camera-count" type="number" min="1" max="16" value="${activeCameraCount}" />
        </div>
        <button class="secondary-btn" id="toggle-group-camera-btn" type="button">Enable Camera</button>
        <button class="secondary-btn" id="close-group-camera-btn">Exit</button>
      </div>
    </div>
    <div class="group-camera-grid" id="group-camera-grid"></div>
    <p class="group-camera-screen-status" id="group-camera-screen-status" aria-live="polite"></p>
  `;

  document.getElementById('root').appendChild(cameraScreen);
  const cameraGrid = document.getElementById('group-camera-grid');
  const toggleCameraBtn = document.getElementById('toggle-group-camera-btn');
  const screenStatus = document.getElementById('group-camera-screen-status');
  let cameraStream = null;

  const localTile = document.createElement('div');
  localTile.className = 'group-camera-tile group-local-tile';

  const peerConnections = new Map();
  const peerTiles = new Map();
  const peerId = crypto.randomUUID();
  let signalingSocket = null;

  const updateLocalTileDisplay = () => {
    if (cameraStream) {
      localTile.innerHTML = `<video id="group-local-camera" autoplay muted playsinline></video><strong>${currentProfileName} (You)</strong>`;
      const videoEl = localTile.querySelector('#group-local-camera');
      if (videoEl) videoEl.srcObject = cameraStream;
      toggleCameraBtn.textContent = 'Turn off camera';
    } else {
      localTile.innerHTML = `
        <div class="group-camera-permission-card">
          <div class="placeholder-camera-icon">📷</div>
          <strong>Camera Permission</strong>
          <p>Click below to grant camera permission and share your video.</p>
          <button class="primary-btn permission-request-btn" id="grant-camera-permission-btn" type="button">Grant Camera Permission</button>
        </div>
        <strong>${currentProfileName} (You)</strong>
      `;
      const grantBtn = localTile.querySelector('#grant-camera-permission-btn');
      grantBtn?.addEventListener('click', requestCameraPermission);
      toggleCameraBtn.textContent = 'Enable Camera';
    }
  };

  const updateGridDisplay = () => {
    cameraGrid.innerHTML = '';
    cameraGrid.appendChild(localTile);
    let occupied = 1;
    peerTiles.forEach((tile) => {
      cameraGrid.appendChild(tile);
      occupied += 1;
    });
    for (let slot = occupied + 1; slot <= activeCameraCount; slot++) {
      const placeholder = document.createElement('div');
      placeholder.className = 'group-camera-tile group-camera-placeholder';
      placeholder.innerHTML = `
        <div class="placeholder-camera-icon">📷</div>
        <strong>Camera Slot ${slot}</strong>
        <span>Waiting for participant...</span>
      `;
      cameraGrid.appendChild(placeholder);
    }
  };

  updateLocalTileDisplay();
  updateGridDisplay();

  const screenCountInput = document.getElementById('group-screen-camera-count');
  screenCountInput.addEventListener('input', () => {
    const val = Number(screenCountInput.value);
    if (!Number.isNaN(val) && val >= 1 && val <= 16) {
      activeCameraCount = Math.min(16, Math.max(1, val));
      const modalCountInput = document.getElementById('group-camera-count');
      if (modalCountInput) modalCountInput.value = activeCameraCount;
      updateGridDisplay();
    }
  });

  const sendSignal = (message) => {
    if (signalingSocket?.readyState === WebSocket.OPEN) signalingSocket.send(JSON.stringify(message));
  };

  const removePeer = (remotePeerId) => {
    peerConnections.get(remotePeerId)?.close();
    peerConnections.delete(remotePeerId);
    peerTiles.get(remotePeerId)?.remove();
    peerTiles.delete(remotePeerId);
    updateGridDisplay();
  };

  const addRemotePeer = (remotePeerId, stream) => {
    let tile = peerTiles.get(remotePeerId);
    if (!tile) {
      tile = document.createElement('div');
      tile.className = 'group-camera-tile';
      tile.innerHTML = '<video autoplay playsinline></video><strong></strong>';
      tile.querySelector('strong').textContent = `Participant ${peerTiles.size + 1}`;
      peerTiles.set(remotePeerId, tile);
    }
    tile.querySelector('video').srcObject = stream;
    updateGridDisplay();
  };

  const connectToPeer = async (remotePeerId, stream, shouldOffer) => {
    const connection = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
    });
    peerConnections.set(remotePeerId, connection);
    stream.getTracks().forEach((track) => connection.addTrack(track, stream));
    connection.onicecandidate = ({ candidate }) => {
      if (candidate) sendSignal({ type: 'candidate', to: remotePeerId, candidate });
    };
    connection.ontrack = ({ streams }) => addRemotePeer(remotePeerId, streams[0]);
    connection.onconnectionstatechange = () => {
      if (['failed', 'closed', 'disconnected'].includes(connection.connectionState)) removePeer(remotePeerId);
    };
    if (shouldOffer) {
      await connection.setLocalDescription(await connection.createOffer());
      sendSignal({ type: 'offer', to: remotePeerId, description: connection.localDescription });
    }
    return connection;
  };

  const startWebRtc = async (stream) => {
    if (signalingSocket) return;
    const signalingUrl = webSocketBaseUrl;
    try {
      signalingSocket = new WebSocket(signalingUrl);
      signalingSocket.onopen = () => {
        sendSignal({ type: 'auth', sessionToken: currentSessionToken });
        sendSignal({ type: 'join', room: 'all-around-mayhem', peerId });
      };
      signalingSocket.onerror = () => {
        screenStatus.textContent = 'Unable to connect to the video server.';
      };
      signalingSocket.onmessage = async ({ data }) => {
        const message = JSON.parse(data);
        if (message.type === 'existing-peer') await connectToPeer(message.peerId, stream, true);
        if (message.type === 'offer') {
          const connection = peerConnections.get(message.from) || await connectToPeer(message.from, stream, false);
          await connection.setRemoteDescription(message.description);
          await connection.setLocalDescription(await connection.createAnswer());
          sendSignal({ type: 'answer', to: message.from, description: connection.localDescription });
        }
        if (message.type === 'answer') await peerConnections.get(message.from)?.setRemoteDescription(message.description);
        if (message.type === 'candidate') await peerConnections.get(message.from)?.addIceCandidate(message.candidate);
        if (message.type === 'peer-left') removePeer(message.peerId);
      };
    } catch {
      screenStatus.textContent = 'Unable to establish video connection.';
    }
  };

  async function requestCameraPermission() {
    if (!navigator.mediaDevices?.getUserMedia) {
      screenStatus.textContent = 'Webcam access is not supported by your browser.';
      return;
    }

    screenStatus.textContent = 'Requesting camera permission...';
    try {
      cameraStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      screenStatus.textContent = 'Camera active.';
      updateLocalTileDisplay();
      updateGridDisplay();
      startWebRtc(cameraStream);
    } catch (error) {
      screenStatus.textContent = error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError'
        ? 'Camera permission denied. Click "Grant Camera Permission" or allow camera access in your browser.'
        : 'Could not access camera. Please check your camera connection.';
      updateLocalTileDisplay();
    }
  }

  function stopCamera() {
    if (cameraStream) {
      cameraStream.getTracks().forEach((track) => track.stop());
      cameraStream = null;
    }
    screenStatus.textContent = 'Camera turned off.';
    updateLocalTileDisplay();
    updateGridDisplay();
  }

  toggleCameraBtn.addEventListener('click', () => {
    if (cameraStream) {
      stopCamera();
    } else {
      requestCameraPermission();
    }
  });

  // Request camera on entry
  requestCameraPermission();

  document.getElementById('close-group-camera-btn').addEventListener('click', () => {
    stopCamera();
    signalingSocket?.close();
    peerConnections.forEach((connection) => connection.close());
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
                  <button type="button">😀</button><button type="button">😂</button><button type="button">🥰</button><button type="button">😍</button><button type="button">😎</button><button type="button">❤️</button><button type="button">🏳️‍🌈</button><button type="button">🎉</button>
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
            <div class="private-camera-controls">
              <button class="secondary-btn" id="private-camera-btn" type="button">Camera</button>
              <button class="secondary-btn private-mic-btn hidden" id="private-mic-btn" type="button" title="Mute or unmute microphone">🎤 Mic On</button>
            </div>
            <span class="private-camera-status" id="private-camera-status" aria-live="polite"></span>
            ${showCameraPreview ? `
              <div class="private-camera-feeds hidden" id="private-camera-preview-wrap">
                <div class="private-video-card remote-video-card hidden" id="private-remote-video-card">
                  <video id="private-remote-video" autoplay playsinline></video>
                  <span class="private-video-label">${name}</span>
                </div>
                <div class="private-video-card local-video-card hidden" id="private-local-video-card">
                  <video id="private-camera-preview" autoplay muted playsinline></video>
                  <span class="private-video-label">You</span>
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
            <button type="button">😀</button><button type="button">😂</button><button type="button">🥰</button><button type="button">😍</button><button type="button">😎</button><button type="button">❤️</button><button type="button">🏳️‍🌈</button><button type="button">🎉</button>
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
    const margin = 12;
    const targetWidth = Math.min(window.innerWidth - 24, 520);
    const startLeft = Math.max(margin, (window.innerWidth - targetWidth) / 2);
    const startTop = Math.max(margin, Math.min(48, (window.innerHeight - 520) / 2));
    messageCard.style.position = 'fixed';
    messageCard.style.left = `${startLeft}px`;
    messageCard.style.top = `${startTop}px`;
    messageCard.style.width = `${targetWidth}px`;
    messageCard.style.maxHeight = `${window.innerHeight - 24}px`;
    let dragState = null;
    let resizeState = null;

    const clampCardPosition = () => {
      const currentRect = messageCard.getBoundingClientRect();
      const maxLeft = Math.max(margin, window.innerWidth - messageCard.offsetWidth - margin);
      const maxTop = Math.max(margin, window.innerHeight - messageCard.offsetHeight - margin);
      messageCard.style.left = `${Math.min(Math.max(margin, currentRect.left), maxLeft)}px`;
      messageCard.style.top = `${Math.min(Math.max(margin, currentRect.top), maxTop)}px`;
      messageCard.style.maxHeight = `${window.innerHeight - 24}px`;
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
      const width = Math.max(300, resizeState.width + event.clientX - resizeState.startX);
      const requestedHeight = Math.max(240, resizeState.height + event.clientY - resizeState.startY);
      messageCard.style.width = `${Math.min(width, window.innerWidth - 24)}px`;
      messageCard.style.height = `${Math.min(requestedHeight, window.innerHeight - 24)}px`;
      clampCardPosition();
    });
    resizeHandle.addEventListener('pointerup', () => { resizeState = null; });
    resizeHandle.addEventListener('pointercancel', () => { resizeState = null; });
    window.addEventListener('resize', clampCardPosition);
    setupEmojiPicker('private-emoji-btn', 'private-emoji-picker', 'private-message-input');
    let cameraStream = null;
    let peerConnection = null;
    let signalingSocket = null;
    let isMicMuted = false;
    const peerId = crypto.randomUUID();
    const pmRoom = 'pm-' + [currentProfileName, name].map((s) => encodeURIComponent(String(s || '').toLowerCase().trim())).sort().join('-');

    const cameraButton = document.getElementById('private-camera-btn');
    const micButton = document.getElementById('private-mic-btn');
    const cameraPreviewWrap = document.getElementById('private-camera-preview-wrap');
    const localVideoCard = document.getElementById('private-local-video-card');
    const localVideo = document.getElementById('private-camera-preview');
    const remoteVideoCard = document.getElementById('private-remote-video-card');
    const remoteVideo = document.getElementById('private-remote-video');
    const cameraStatus = document.getElementById('private-camera-status');
    const messageThread = document.getElementById('private-message-thread');
    const isFriendOnline = new Set([currentProfileName, ...(Object.values(roomMembers).flat())]).has(name);
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

    const sendSignal = (message) => {
      if (signalingSocket?.readyState === WebSocket.OPEN) signalingSocket.send(JSON.stringify(message));
    };

    const removePeerConnection = () => {
      if (peerConnection) {
        peerConnection.close();
        peerConnection = null;
      }
      if (remoteVideo) remoteVideo.srcObject = null;
      if (remoteVideoCard) remoteVideoCard.classList.add('hidden');
    };

    const connectToPeer = async (remotePeerId, stream, shouldOffer) => {
      removePeerConnection();
      peerConnection = new RTCPeerConnection({
        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
      });
      if (stream) {
        stream.getTracks().forEach((track) => peerConnection.addTrack(track, stream));
      }
      peerConnection.onicecandidate = ({ candidate }) => {
        if (candidate) sendSignal({ type: 'candidate', to: remotePeerId, candidate });
      };
      peerConnection.ontrack = ({ streams }) => {
        if (remoteVideo && streams[0]) {
          remoteVideo.srcObject = streams[0];
          remoteVideo.muted = false;
          if (remoteVideoCard) remoteVideoCard.classList.remove('hidden');
          if (cameraPreviewWrap) cameraPreviewWrap.classList.remove('hidden');
          cameraStatus.textContent = `Connected with ${name}.`;
        }
      };
      peerConnection.onconnectionstatechange = () => {
        if (['failed', 'closed', 'disconnected'].includes(peerConnection?.connectionState)) {
          if (remoteVideo) remoteVideo.srcObject = null;
          if (remoteVideoCard) remoteVideoCard.classList.add('hidden');
          cameraStatus.textContent = `${name} disconnected from camera.`;
        }
      };
      if (shouldOffer) {
        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);
        sendSignal({ type: 'offer', to: remotePeerId, description: peerConnection.localDescription });
      }
      return peerConnection;
    };

    const startWebRtc = async (stream) => {
      if (signalingSocket) return;
      const signalingUrl = webSocketBaseUrl;
      try {
        signalingSocket = new WebSocket(signalingUrl);
        signalingSocket.onopen = () => {
          sendSignal({ type: 'auth', sessionToken: currentSessionToken });
          sendSignal({ type: 'join', room: pmRoom, peerId });
        };
        signalingSocket.onerror = () => {
          cameraStatus.textContent = 'Unable to connect to video server.';
        };
        signalingSocket.onmessage = async ({ data }) => {
          const message = JSON.parse(data);
          if (message.type === 'existing-peer') {
            await connectToPeer(message.peerId, stream, true);
          }
          if (message.type === 'offer') {
            const connection = peerConnection || await connectToPeer(message.from, stream, false);
            await connection.setRemoteDescription(message.description);
            await connection.setLocalDescription(await connection.createAnswer());
            sendSignal({ type: 'answer', to: message.from, description: connection.localDescription });
          }
          if (message.type === 'answer') {
            await peerConnection?.setRemoteDescription(message.description);
          }
          if (message.type === 'candidate') {
            await peerConnection?.addIceCandidate(message.candidate);
          }
          if (message.type === 'peer-left') {
            removePeerConnection();
            cameraStatus.textContent = `${name} left video.`;
          }
        };
      } catch {
        cameraStatus.textContent = 'Unable to establish video connection.';
      }
    };

    const stopCamera = () => {
      if (cameraStream) {
        cameraStream.getTracks().forEach((track) => track.stop());
        cameraStream = null;
      }
      removePeerConnection();
      if (signalingSocket) {
        signalingSocket.close();
        signalingSocket = null;
      }
      if (localVideo) localVideo.srcObject = null;
      if (localVideoCard) localVideoCard.classList.add('hidden');
      if (remoteVideo) remoteVideo.srcObject = null;
      if (remoteVideoCard) remoteVideoCard.classList.add('hidden');
      if (cameraPreviewWrap) cameraPreviewWrap.classList.add('hidden');
      if (micButton) {
        micButton.classList.add('hidden');
        micButton.textContent = '🎤 Mic On';
        micButton.classList.remove('muted');
      }
      isMicMuted = false;
      cameraButton.textContent = 'Camera';
      cameraStatus.textContent = '';
    };

    cameraButton.addEventListener('click', async () => {
      if (!showCameraPreview) {
        cameraStatus.textContent = 'Camera attached to this message.';
        return;
      }
      if (cameraStream) {
        stopCamera();
        return;
      }

      if (!navigator.mediaDevices?.getUserMedia) {
        cameraStatus.textContent = 'Webcam access is not available.';
        return;
      }

      try {
        try {
          cameraStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        } catch {
          cameraStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        }
        if (localVideo) localVideo.srcObject = cameraStream;
        if (localVideoCard) localVideoCard.classList.remove('hidden');
        if (cameraPreviewWrap) cameraPreviewWrap.classList.remove('hidden');
        cameraButton.textContent = 'Turn off camera';
        isMicMuted = false;
        if (micButton) {
          micButton.classList.remove('hidden');
          micButton.textContent = '🎤 Mic On';
          micButton.classList.remove('muted');
        }
        cameraStatus.textContent = `Camera active. Waiting for ${name}...`;
        startWebRtc(cameraStream);
      } catch (error) {
        cameraStatus.textContent = 'Camera permission was not granted.';
      }
    });

    micButton?.addEventListener('click', () => {
      if (!cameraStream) return;
      const audioTracks = cameraStream.getAudioTracks();
      if (audioTracks.length === 0) {
        cameraStatus.textContent = 'No microphone track available.';
        return;
      }
      isMicMuted = !isMicMuted;
      audioTracks.forEach((track) => {
        track.enabled = !isMicMuted;
      });
      micButton.textContent = isMicMuted ? '🔇 Mic Muted' : '🎤 Mic On';
      micButton.classList.toggle('muted', isMicMuted);
      cameraStatus.textContent = isMicMuted ? 'Microphone muted.' : 'Microphone unmuted.';
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
      stopCamera();
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

  const updateRoomMates = () => {
    const list = document.getElementById('room-mates-list');
    if (!list) return;
    list.innerHTML = '';
    const currentRoomId = roomIdForName(roomName);
    const peersInRoom = (roomMembers[currentRoomId] || []).filter((peerName) => peerName && peerName !== currentProfileName);
    const activeRoomMates = [currentProfileName, ...new Set(peersInRoom)];

    activeRoomMates.forEach((name) => {
      const roomMateEntry = document.createElement('div');
      roomMateEntry.className = 'room-mate-entry';

      const roomMate = document.createElement('button');
      roomMate.className = 'room-side-pill room-mate-trigger';
      roomMate.type = 'button';
      roomMate.textContent = name === currentProfileName ? `${name} (You)` : name;

      const roomMateMenu = document.createElement('div');
      roomMateMenu.className = 'profile-menu hidden';
      ['Exit', 'Private message', 'Add friend', 'Profile'].forEach((actionName) => {
        const action = document.createElement('button');
        action.className = 'profile-menu-item';
        action.type = 'button';
        action.textContent = actionName;
        if (actionName === 'Exit') {
          action.addEventListener('click', (event) => {
            event.stopPropagation();
            roomMateMenu.classList.add('hidden');
          });
        }
        if (actionName === 'Profile') {
          action.addEventListener('click', (event) => {
            event.stopPropagation();
            roomMateMenu.classList.add('hidden');
            openRoommateProfile(name);
          });
        }
        if (actionName === 'Private message') {
          action.addEventListener('click', (event) => {
            event.stopPropagation();
            roomMateMenu.classList.add('hidden');
            openPrivateMessage(name);
          });
        }
        if (actionName === 'Add friend') {
          action.addEventListener('click', (event) => {
            event.stopPropagation();
            if (!friends.includes(name)) {
              friends = [...friends, name];
              localStorage.setItem('the-love-media-friends', JSON.stringify(friends));
            }
            roomMateMenu.classList.add('hidden');
          });
        }
        roomMateMenu.appendChild(action);
      });

      roomMate.addEventListener('click', (event) => {
        event.stopPropagation();
        const isHidden = roomMateMenu.classList.contains('hidden');
        document.querySelectorAll('.profile-menu').forEach((menu) => menu.classList.add('hidden'));
        if (isHidden) {
          roomMateMenu.classList.remove('hidden');
        }
      });
      roomMateEntry.append(roomMate, roomMateMenu);
      list.appendChild(roomMateEntry);
    });
  };

  updateActiveRoomMates = updateRoomMates;
  updateActiveRoomMates();

  document.getElementById('exit-room-btn').addEventListener('click', () => {
    updateActiveRoomMates = () => {};
    groupChatActive = false;
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
    renderWelcomeVideosPage();
    return;
  }
  if (hash === '#gayjesus-blog') {
    renderGayjesusBlogPage();
    return;
  }
  renderLoginPage();
}

migrateLocalAccounts();
fetchServerAccountCount();
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
  if (window.location.hash === '#gayjesus-blog' && app.querySelector('.welcome-card h1')?.textContent !== 'Blog & topic videos') {
    renderGayjesusBlogPage();
    return;
  }
  if (window.location.hash === '#welcome-videos' && app.querySelector('.welcome-card h1')?.textContent !== 'Welcome videos') {
    renderWelcomeVideosPage();
    return;
  }
  if (window.location.hash !== '#friends-connect' && document.querySelector('#friends-connect-modal')) {
    document.querySelector('#friends-connect-modal').remove();
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
