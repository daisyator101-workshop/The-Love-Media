import dotenv from 'dotenv';
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { WebSocketServer } from 'ws';
import Stripe from 'stripe';
import pg from 'pg';

const { Pool } = pg;

async function readEnvFiles() {
  if (process.env.NODE_ENV === 'production') return;
  const envPaths = [
    new URL('./.vscode/.env.txt', import.meta.url),
    new URL('./.env.txt', import.meta.url),
    new URL('./.env', import.meta.url),
  ];
  const loadedValues = new Map();

  for (const envPath of envPaths) {
    try {
      const contents = await readFile(envPath, 'utf8');
      const lines = contents.split(/\r?\n/);
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const separatorIndex = trimmed.indexOf('=');
        if (separatorIndex === -1) continue;
        const key = trimmed.slice(0, separatorIndex).trim();
        let value = trimmed.slice(separatorIndex + 1).trim().replace(/^['"]|['"]$/g, '');
        if (!key || !value) continue;

        const normalizedValue = value.trim();
        const placeholderNames = ['replace_me', 'your_stripe_secret_key', 'replace-this'];
        const looksLikePlaceholder = placeholderNames.some((token) => normalizedValue.toLowerCase().includes(token))
          || normalizedValue.toLowerCase().includes('replace-me');

        if (looksLikePlaceholder) continue;
        if (!loadedValues.has(key) || normalizedValue.startsWith('sk_')) {
          loadedValues.set(key, normalizedValue);
        }
      }
    } catch {
      continue;
    }
  }

  for (const [key, value] of loadedValues) {
    // Render-injected environment variables must take precedence over local fallback files.
    if (!process.env[key]) process.env[key] = value;
  }
}

await readEnvFiles();
if (!process.env.STRIPE_SECRET_KEY && !process.env.stripe_secret_key && !process.env.business_stripe_secret_key && !process.env.business_STRIPE_SECRET_KEY) {
  dotenv.config();
}

const stripeKey = process.env.STRIPE_SECRET_KEY || process.env.stripe_secret_key || process.env.business_stripe_secret_key || process.env.business_STRIPE_SECRET_KEY;
const port = Number(process.env.SIGNALING_PORT || 3002);
const rooms = new Map();
const accountFile = new URL('./accounts.json', import.meta.url);
const videoFile = new URL('./videos.json', import.meta.url);
const stripe = stripeKey ? new Stripe(stripeKey) : null;
const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET || process.env.stripe_webhook_secret || process.env.business_stripe_webhook_secret || process.env.business_STRIPE_WEBHOOK_SECRET;
const presenceRooms = new Map();
const chatRooms = new Map();
const privateMessageRooms = new Map();
const allowedOrigins = new Set(
  `${process.env.ALLOWED_ORIGINS || ''},${process.env.FRONTEND_URL || ''},https://the-love-media-6.onrender.com,http://127.0.0.1:3000,http://localhost:5173,http://127.0.0.1:5173`
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)
);
const authRateLimits = new Map();
const authRateLimitWindowMs = Number(process.env.AUTH_RATE_LIMIT_WINDOW_MS || 5 * 60 * 1000);
const authRateLimitMaxAttempts = Number(process.env.AUTH_RATE_LIMIT_MAX_ATTEMPTS || 8);
const sessions = new Map();
const sessionLifetimeMs = 8 * 60 * 60 * 1000;
const databasePool = process.env.DATABASE_URL
  ? new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } })
  : null;
let databaseReady = false;

if (process.env.NODE_ENV === 'production' && process.env.DATABASE_URL) {
  try {
    const databaseUrl = new URL(process.env.DATABASE_URL);
    console.log(`Database target: ${databaseUrl.hostname}/${databaseUrl.pathname.slice(1)}`);
  } catch {
    console.warn('DATABASE_URL is not a valid PostgreSQL URL.');
  }
}

function getClientAddress(request) {
  return request.socket.remoteAddress || 'unknown';
}

function enforceAuthRateLimit(request) {
  const key = `${getClientAddress(request)}:${request.url}`;
  const now = Date.now();
  const recentAttempts = (authRateLimits.get(key) || []).filter((timestamp) => now - timestamp < authRateLimitWindowMs);
  if (recentAttempts.length >= authRateLimitMaxAttempts) {
    const error = new Error('Too many attempts. Try again later.');
    error.statusCode = 429;
    throw error;
  }
  recentAttempts.push(now);
  authRateLimits.set(key, recentAttempts);
  return authRateLimitMaxAttempts - recentAttempts.length;
}

function createSession(account) {
  const token = randomBytes(32).toString('hex');
  sessions.set(token, { codename: account.codename, expiresAt: Date.now() + sessionLifetimeMs });
  return token;
}

function getAuthenticatedSession(request) {
  const authorization = request.headers.authorization || '';
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
  const session = getSessionByToken(token);
  if (!session) throw new Error('Authentication required.');
  return session;
}

function getSessionByToken(token) {
  const session = sessions.get(token);
  if (!session || session.expiresAt <= Date.now()) {
    if (token) sessions.delete(token);
    return null;
  }
  return session;
}

function getPresenceCounts() {
  return Object.fromEntries([...presenceRooms].map(([roomId, sockets]) => [roomId, sockets.size]));
}

function getPresenceMembers() {
  return Object.fromEntries([...presenceRooms].map(([roomId, sockets]) => [
    roomId,
    [...new Set([...sockets]
      .map((socket) => socket.authenticatedSession?.codename)
      .filter(Boolean))]
  ]));
}

function getPresenceState() {
  return { counts: getPresenceCounts(), members: getPresenceMembers() };
}

function broadcastPresenceCounts() {
  const message = JSON.stringify({
    type: 'room-counts',
    ...getPresenceState()
  });
  for (const client of server.clients) {
    if (client.readyState === 1) client.send(message);
  }
}

function removePresence(socket) {
  if (!socket.presenceRoomId) return;
  const room = presenceRooms.get(socket.presenceRoomId);
  room?.delete(socket);
  if (room?.size === 0) presenceRooms.delete(socket.presenceRoomId);
  socket.presenceRoomId = null;
  broadcastPresenceCounts();
}

function removeChatPresence(socket) {
  if (!socket.chatRoomId) return;
  const room = chatRooms.get(socket.chatRoomId);
  room?.delete(socket);
  if (room?.size === 0) chatRooms.delete(socket.chatRoomId);
  socket.chatRoomId = null;
}

function removePrivateMessagePresence(socket) {
  if (!socket.privateMessageRoomId) return;
  const room = privateMessageRooms.get(socket.privateMessageRoomId);
  room?.delete(socket);
  if (room?.size === 0) privateMessageRooms.delete(socket.privateMessageRoomId);
  socket.privateMessageRoomId = null;
}

async function readAccounts() {
  if (databasePool) {
    if (!databaseReady) {
      await databasePool.query('CREATE TABLE IF NOT EXISTS app_state (id integer PRIMARY KEY, accounts jsonb NOT NULL)');
      databaseReady = true;
    }
    const result = await databasePool.query('SELECT accounts FROM app_state WHERE id = 1');
    if (result.rows[0]) return result.rows[0].accounts;

    let initialAccounts = [];
    try {
      initialAccounts = JSON.parse(await readFile(accountFile, 'utf8'));
    } catch {
      initialAccounts = [];
    }
    await databasePool.query('INSERT INTO app_state (id, accounts) VALUES (1, $1::jsonb)', [JSON.stringify(initialAccounts)]);
    return initialAccounts;
  }
  try {
    return JSON.parse(await readFile(accountFile, 'utf8'));
  } catch {
    return [];
  }
}

async function saveAccounts(accounts) {
  if (databasePool) {
    await databasePool.query(
      'INSERT INTO app_state (id, accounts) VALUES (1, $1::jsonb) ON CONFLICT (id) DO UPDATE SET accounts = EXCLUDED.accounts',
      [JSON.stringify(accounts)]
    );
    return;
  }
  await writeFile(accountFile, JSON.stringify(accounts, null, 2));
}

async function readVideos() {
  if (databasePool) {
    if (!databaseReady) {
      await databasePool.query('CREATE TABLE IF NOT EXISTS app_state (id integer PRIMARY KEY, accounts jsonb NOT NULL)');
      databaseReady = true;
    }
    await databasePool.query('CREATE TABLE IF NOT EXISTS app_videos (id text PRIMARY KEY, video jsonb NOT NULL)');
    const result = await databasePool.query('SELECT video FROM app_videos ORDER BY (video->>\'timestamp\')::bigint DESC NULLS LAST');
    return result.rows.map((row) => row.video);
  }
  try {
    return JSON.parse(await readFile(videoFile, 'utf8'));
  } catch {
    return [];
  }
}

async function saveVideo(video) {
  if (databasePool) {
    await databasePool.query(
      'CREATE TABLE IF NOT EXISTS app_videos (id text PRIMARY KEY, video jsonb NOT NULL)'
    );
    await databasePool.query(
      'INSERT INTO app_videos (id, video) VALUES ($1, $2::jsonb) ON CONFLICT (id) DO UPDATE SET video = EXCLUDED.video',
      [String(video.id), JSON.stringify(video)]
    );
    return;
  }
  const videos = await readVideos();
  const index = videos.findIndex((savedVideo) => savedVideo.id === video.id);
  if (index >= 0) videos[index] = video;
  else videos.push(video);
  await writeFile(videoFile, JSON.stringify(videos, null, 2));
}

async function deleteVideo(id) {
  if (databasePool) {
    await databasePool.query('CREATE TABLE IF NOT EXISTS app_videos (id text PRIMARY KEY, video jsonb NOT NULL)');
    await databasePool.query('DELETE FROM app_videos WHERE id = $1', [String(id)]);
    return;
  }
  const videos = (await readVideos()).filter((video) => video.id !== id);
  await writeFile(videoFile, JSON.stringify(videos, null, 2));
}

function hashPassword(password, salt = randomBytes(16).toString('hex')) {
  return { salt, hash: scryptSync(password, salt, 64).toString('hex') };
}

function passwordsMatch(password, account) {
  const expected = Buffer.from(account.passwordHash, 'hex');
  const actual = Buffer.from(scryptSync(password, account.passwordSalt, 64).toString('hex'), 'hex');
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function secretMatches(secret, salt, hash) {
  if (!salt || !hash) return false;
  const expected = Buffer.from(hash, 'hex');
  const actual = Buffer.from(scryptSync(secret, salt, 64).toString('hex'), 'hex');
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

async function migrateResetKeys(accounts) {
  let changed = false;
  for (const account of accounts) {
    if (!account.resetKey || account.resetKeySalt || account.resetKeyHash) continue;
    const resetKeyData = hashPassword(account.resetKey);
    account.resetKeySalt = resetKeyData.salt;
    account.resetKeyHash = resetKeyData.hash;
    delete account.resetKey;
    changed = true;
  }
  if (changed) await saveAccounts(accounts);
}

await migrateResetKeys(await readAccounts());

async function requestBody(request) {
  let body = '';
  for await (const chunk of request) body += chunk;
  return JSON.parse(body || '{}');
}

async function readRawBody(request) {
  let body = '';
  for await (const chunk of request) body += chunk;
  return body;
}

const httpServer = createServer(async (request, response) => {
  const origin = request.headers.origin;
  if (origin && allowedOrigins.has(origin)) {
    response.setHeader('Access-Control-Allow-Origin', origin);
    response.setHeader('Vary', 'Origin');
  }
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  response.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('X-Frame-Options', 'DENY');
  response.setHeader('Referrer-Policy', 'no-referrer');
  if (request.method === 'OPTIONS') {
    response.writeHead(204);
    response.end();
    return;
  }
  if (!request.url?.startsWith('/api/') || request.method !== 'POST') {
    response.writeHead(404);
    response.end();
    return;
  }

  try {
    let attemptsRemaining = null;
    if (['/api/accounts', '/api/login', '/api/reset-password'].includes(request.url)) {
      attemptsRemaining = enforceAuthRateLimit(request);
    }
    const body = await requestBody(request);
    const accounts = await readAccounts();
    await migrateResetKeys(accounts);

    if (request.url === '/api/stripe/webhook') {
      if (!stripe || !webhookSecret) {
        throw new Error('Stripe webhook is not configured. Add STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET to a local .env file.');
      }

      const signature = request.headers['stripe-signature'];
      const rawBody = await readRawBody(request);

      let event;
      try {
        event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
      } catch (error) {
        response.writeHead(400, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({ error: `Webhook signature verification failed: ${error.message}` }));
        return;
      }

      console.log(`Stripe event received: ${event.type}`);
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ received: true }));
      return;
    }

    if (request.url === '/api/create-checkout-session') {
      if (!stripe) {
        throw new Error('Stripe is not configured. Add your STRIPE_SECRET_KEY to a local .env file.');
      }

      const amount = Number(body.amount || 2000);
      const productName = String(body.productName || 'QueerPulse Premium');
      const returnHash = typeof body.returnHash === 'string' && /^#(?:welcome|workspace|friends-connect|room\/[a-z0-9-]+)$/.test(body.returnHash)
        ? body.returnHash
        : '#welcome';

      const session = await stripe.checkout.sessions.create({
        mode: 'payment',
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: 'usd',
              unit_amount: amount,
              product_data: {
                name: productName,
              },
            },
          },
        ],
        success_url: `${process.env.FRONTEND_URL || 'http://localhost:3000'}/?checkout=success${returnHash}`,
        cancel_url: `${process.env.FRONTEND_URL || 'http://localhost:3000'}/?checkout=cancelled${returnHash}`,
        metadata: {
          productName,
        },
      });

      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ url: session.url }));
      return;
    }

    if (request.url === '/api/accounts-count') {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ count: accounts.length }));
      return;
    }

    if (request.url === '/api/accounts') {
      const codename = String(body.codename || '').trim();
      const resetKey = String(body.resetKey || '').trim();
      const password = String(body.password || '');
      if (!codename || !resetKey || !password) throw new Error('All fields are required.');
      if (accounts.some((account) => account.codename.toLowerCase() === codename.toLowerCase())) throw new Error('That codename is already taken.');
      const passwordData = hashPassword(password);
      const resetKeyData = hashPassword(resetKey);
      accounts.push({
        codename,
        resetKeySalt: resetKeyData.salt,
        resetKeyHash: resetKeyData.hash,
        passwordSalt: passwordData.salt,
        passwordHash: passwordData.hash,
        profile: {
          bio: String(body.profile?.bio || ''),
          statuses: Array.isArray(body.profile?.statuses) ? body.profile.statuses : [],
          connectionStatus: String(body.profile?.connectionStatus || '')
        },
        privateMail: []
      });
      await saveAccounts(accounts);
      response.writeHead(201, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ codename }));
      return;
    }
    if (request.url === '/api/login') {
      const account = accounts.find((savedAccount) => savedAccount.codename.toLowerCase() === String(body.codename || '').trim().toLowerCase());
      if (!account || !passwordsMatch(String(body.password || ''), account)) {
        throw new Error(`That codename or password is not correct. Attempts remaining: ${attemptsRemaining}.`);
      }
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ codename: account.codename, profile: account.profile || {}, sessionToken: createSession(account) }));
      return;
    }
    if (request.url === '/api/reset-password') {
      const codename = String(body.codename || '').trim();
      const resetKey = String(body.resetKey || '').trim();
      const newPassword = String(body.newPassword || '');
      const account = accounts.find((savedAccount) => savedAccount.codename.toLowerCase() === codename.toLowerCase());
      if (!account || !secretMatches(resetKey, account.resetKeySalt, account.resetKeyHash)) throw new Error('That codename or Password Reset Key is not correct.');
      if (newPassword.length < 8) throw new Error('New password must be at least 8 characters.');
      const passwordData = hashPassword(newPassword);
      account.passwordSalt = passwordData.salt;
      account.passwordHash = passwordData.hash;
      delete account.password;
      await saveAccounts(accounts);
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ reset: true }));
      return;
    }
    if (request.url === '/api/profile') {
      const session = getAuthenticatedSession(request);
      const account = accounts.find((savedAccount) => savedAccount.codename.toLowerCase() === session.codename.toLowerCase());
      if (!account) throw new Error('Authentication required.');
      account.profile = {
        bio: String(body.profile?.bio || ''),
        statuses: Array.isArray(body.profile?.statuses) ? body.profile.statuses : [],
        connectionStatus: String(body.profile?.connectionStatus || '')
      };
      await saveAccounts(accounts);
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ profile: account.profile }));
      return;
    }
    if (request.url === '/api/private-mail') {
      const session = getAuthenticatedSession(request);
      const account = accounts.find((savedAccount) => savedAccount.codename.toLowerCase() === session.codename.toLowerCase());
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ messages: Array.isArray(account?.privateMail) ? account.privateMail : [] }));
      return;
    }
    if (request.url === '/api/videos') {
      getAuthenticatedSession(request);
      const videos = await readVideos();
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ videos }));
      return;
    }
    if (request.url === '/api/videos/save') {
      const session = getAuthenticatedSession(request);
      if (session.codename.toLowerCase() !== 'gayjesus') throw new Error('Only Gayjesus can save videos.');
      const video = body.video;
      if (!video?.id || !['welcome', 'blog'].includes(video.kind)) throw new Error('Invalid video.');
      await saveVideo(video);
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ saved: true }));
      return;
    }
    if (request.url === '/api/videos/delete') {
      const session = getAuthenticatedSession(request);
      if (session.codename.toLowerCase() !== 'gayjesus') throw new Error('Only Gayjesus can delete videos.');
      await deleteVideo(body.id);
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ deleted: true }));
      return;
    }
    if (request.url === '/api/delete-account') {
      const codename = String(body.codename || '').trim();
      const account = accounts.find((savedAccount) => savedAccount.codename.toLowerCase() === codename.toLowerCase());
      if (!account) {
        response.writeHead(200, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({ deleted: true }));
        return;
      }
      let session = null;
      try {
        session = getAuthenticatedSession(request);
      } catch {}
      if (session && session.codename.toLowerCase() !== codename.toLowerCase()) {
        throw new Error('Authentication required.');
      }
      const remainingAccounts = accounts.filter((acc) => acc.codename.toLowerCase() !== codename.toLowerCase());
      await saveAccounts(remainingAccounts);
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ deleted: true }));
      return;
    }
    response.writeHead(404);
    response.end();
  } catch (error) {
    response.writeHead(error.statusCode || 400, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ error: error.message }));
  }
});

const server = new WebSocketServer({ server: httpServer });

server.on('connection', (socket) => {
  let roomId = null;
  let peerId = null;
  let authenticatedSession = null;

  socket.on('message', async (rawMessage) => {
    let message;
    try {
      message = JSON.parse(rawMessage.toString());
    } catch {
      return;
    }

    if (message.type === 'auth') {
      authenticatedSession = getSessionByToken(String(message.sessionToken || ''));
      socket.authenticatedSession = authenticatedSession;
      if (!authenticatedSession) socket.close(1008, 'Authentication required.');
      return;
    }

    if (!authenticatedSession) {
      socket.close(1008, 'Authentication required.');
      return;
    }

    if (message.type === 'presence-subscribe') {
      socket.send(JSON.stringify({ type: 'room-counts', ...getPresenceState() }));
      return;
    }

    if (message.type === 'presence-join') {
      removePresence(socket);
      const presenceRoom = String(message.room || '').trim();
      if (presenceRoom) {
        if (!presenceRooms.has(presenceRoom)) presenceRooms.set(presenceRoom, new Set());
        presenceRooms.get(presenceRoom).add(socket);
        socket.presenceRoomId = presenceRoom;
        broadcastPresenceCounts();
        socket.send(JSON.stringify({ type: 'presence-joined', room: presenceRoom, ...getPresenceState() }));
      }
      return;
    }

    if (message.type === 'chat-join') {
      removeChatPresence(socket);
      const chatRoomId = String(message.room || '').trim();
      if (chatRoomId) {
        if (!chatRooms.has(chatRoomId)) chatRooms.set(chatRoomId, new Set());
        chatRooms.get(chatRoomId).add(socket);
        socket.chatRoomId = chatRoomId;
      }
      return;
    }

    if (message.type === 'chat-message') {
      const chatRoomId = String(message.room || '').trim();
      const text = String(message.text || '').trim();
      if (!chatRoomId || !text || chatRoomId !== socket.chatRoomId) return;
      const chatMessage = JSON.stringify({
        type: 'chat-message',
        sender: authenticatedSession.codename,
        text
      });
      for (const client of chatRooms.get(chatRoomId) || []) {
        if (client.readyState === 1) client.send(chatMessage);
      }
      return;
    }

    if (message.type === 'private-message-join') {
      removePrivateMessagePresence(socket);
      const privateRoomId = String(message.room || '').trim();
      if (privateRoomId) {
        if (!privateMessageRooms.has(privateRoomId)) privateMessageRooms.set(privateRoomId, new Set());
        privateMessageRooms.get(privateRoomId).add(socket);
        socket.privateMessageRoomId = privateRoomId;
      }
      return;
    }

    if (message.type === 'private-message') {
      const privateRoomId = String(message.room || '').trim();
      const recipient = String(message.recipient || '').trim();
      const text = String(message.text || '').trim();
      if (!privateRoomId || !recipient || !text || privateRoomId !== socket.privateMessageRoomId) return;
      const recipientSockets = [...server.clients].filter((client) => client.readyState === 1
        && client.authenticatedSession?.codename?.toLowerCase() === recipient.toLowerCase());
      const recipientOnline = recipientSockets.length > 0;
      if (!recipientOnline) {
        const accounts = await readAccounts();
        const recipientAccount = accounts.find((account) => account.codename.toLowerCase() === recipient.toLowerCase());
        if (recipientAccount) {
          const privateMail = Array.isArray(recipientAccount.privateMail) ? recipientAccount.privateMail : [];
          privateMail.push({
            id: randomBytes(16).toString('hex'),
            sender: authenticatedSession.codename,
            text,
            createdAt: Date.now()
          });
          recipientAccount.privateMail = privateMail.slice(-100);
          await saveAccounts(accounts);
        }
      }
      const privateMessage = JSON.stringify({
        type: 'private-message',
        id: randomBytes(16).toString('hex'),
        sender: authenticatedSession.codename,
        text
      });
      for (const client of recipientSockets) client.send(privateMessage);
      return;
    }

    if (message.type === 'presence-leave') {
      removePresence(socket);
      return;
    }

    if (message.type === 'join') {
      roomId = message.room || 'main-group';
      peerId = message.peerId;
      if (!rooms.has(roomId)) rooms.set(roomId, new Map());

      const room = rooms.get(roomId);
      for (const [existingPeerId, existingSocket] of room) {
        existingSocket.send(JSON.stringify({ type: 'peer-joined', peerId }));
        socket.send(JSON.stringify({ type: 'existing-peer', peerId: existingPeerId }));
      }
      room.set(peerId, socket);
      return;
    }

    if (!roomId || !peerId || !message.to) return;
    const recipient = rooms.get(roomId)?.get(message.to);
    if (recipient?.readyState === 1) {
      recipient.send(JSON.stringify({ ...message, from: peerId }));
    }
  });

  socket.on('close', () => {
    removePresence(socket);
    removeChatPresence(socket);
    removePrivateMessagePresence(socket);
    if (!roomId || !peerId) return;
    const room = rooms.get(roomId);
    room?.delete(peerId);
    for (const remainingSocket of room?.values() || []) {
      if (remainingSocket.readyState === 1) {
        remainingSocket.send(JSON.stringify({ type: 'peer-left', peerId }));
      }
    }
    if (room?.size === 0) rooms.delete(roomId);
  });
});

httpServer.listen(port, () => {
  console.log(`WebRTC signaling server listening on ws://localhost:${port}`);
});
