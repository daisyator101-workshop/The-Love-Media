import dotenv from 'dotenv';
import { createServer } from 'node:http';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { WebSocketServer } from 'ws';
import Stripe from 'stripe';
import pg from 'pg';

const { Pool } = pg;
const httpServer = createServer();

// --- Environment and Setup ---

async function readEnvFiles() {
  // Define relative paths correctly for Node.js modules
  const envPaths = [
    new URL('./.vscode/.env.txt', import.meta.url),
    new URL('./.env.txt', import.meta.url),
    new URL('./.env', import.meta.url),
  ];
  
  // Load environment variables from files
  for (const envPath of envPaths) {
    try {
      const content = await readFile(envPath, 'utf8');
      for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const index = trimmed.indexOf('=');
        if (index === -1) continue;
        const key = trimmed.substring(0, index).trim();
        const value = trimmed.substring(index + 1).trim();
        
        // Only set process.env if it's not already set (to respect existing process.env or .env loading)
        if (!process.env[key]) {
          process.env[key] = value;
        }
      }
    } catch (error) {
      // Silently ignore errors when files don't exist, which is fine for optional .env files.
    }
  }
}

// Load environment variables from .env file if not already loaded
if (!process.env.STRIPE_SECRET_KEY && !process.env.stripe_secret_key && !process.env.business_stripe_secret_key && !process.env.business_STRIPE_SECRET_KEY) {
  dotenv.config();
}

const stripeKey = process.env.STRIPE_SECRET_KEY || process.env.stripe_secret_key || process.env.business_stripe_secret_key || process.env.business_STRIPE_SECRET_KEY;
const port = Number(process.env.PORT || process.env.SIGNALING_PORT || 3002);
const rooms = new Map();
const accountFile = new URL('./accounts.json', import.meta.url);
const stripe = stripeKey ? new Stripe(stripeKey) : null;
const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET || process.env.stripe_webhook_secret || process.env.business_stripe_webhook_secret || process.env.business_STRIPE_WEBHOOK_SECRET;
const presenceRooms = new Map();
const defaultAllowedOrigins = [
  process.env.FRONTEND_URL || 'http://localhost:3000',
  // Vercel deployment URLs
  process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : '',
  'https://onrender.com',
  'http://localhost:3000',
  'http://localhost:5173',
  'http://127.0.0.1:5173'
];

const configuredAllowedOrigins = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);
const allowedOrigins = new Set([...defaultAllowedOrigins, ...configuredAllowedOrigins]);

function isOriginAllowed(origin) {
  if (!origin) return true;
  if (allowedOrigins.has(origin) || allowedOrigins.has('*')) return true;
  try {
    const url = new URL(origin);
    // Allow all Vercel deployment URLs (*.vercel.app)
    if (url.hostname.endsWith('.vercel.app')) return true;
    // Allow local development URLs
    if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') return true;
  } catch {
    return false;
  }
  return false;
}
const authRateLimits = new Map();
const authRateLimitWindowMs = 5 * 60 * 1000;
const authRateLimitMaxAttempts = 8;
const sessions = new Map();
const sessionLifetimeMs = 8 * 60 * 60 * 1000;
const databasePool = process.env.DATABASE_URL
  ? new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } })
  : null;
if (!databasePool) {
  console.warn('[the-love-media] DATABASE_URL is not set - accounts are stored in accounts.json and will be lost on redeploy.');
}
let databaseReady = false;

// --- Utility Functions ---

function getClientAddress(request) {
  const forwarded = request.headers['x-forwarded-for'];
  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }
  return request.socket.remoteAddress || 'unknown';
}

function checkAuthRateLimit(request) {
  const key = `${getClientAddress(request)}:${request.url}`;
  const now = Date.now();
  const recentAttempts = (authRateLimits.get(key) || []).filter((timestamp) => now - timestamp < authRateLimitWindowMs);
  
  if (recentAttempts.length >= authRateLimitMaxAttempts) {
    const error = new Error('Too many attempts. Try again later.');
    error.statusCode = 429;
    throw error;
  }
}

function recordAuthFailure(request) {
  const key = `${getClientAddress(request)}:${request.url}`;
  const now = Date.now();
  const recentAttempts = (authRateLimits.get(key) || []).filter((timestamp) => now - timestamp < authRateLimitWindowMs);
  recentAttempts.push(now);
  authRateLimits.set(key, recentAttempts);
}

function createSession(account) {
  const token = randomBytes(32).toString('hex');
  sessions.set(token, { codename: account.codename, expiresAt: Date.now() + sessionLifetimeMs });
  return token;
}

function getAuthenticatedSession(request) {
  const authorization = request.headers.authorization || '';
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
  const session = sessions.get(token);
  
  if (!session) {
    throw new Error('Authentication required.');
  }
  
  if (session.expiresAt <= Date.now()) {
    sessions.delete(token);
    throw new Error('Session expired.');
  }
  
  return session;
}

function getSessionByToken(token) {
  const session = sessions.get(token);
  if (!session) {
    return null;
  }
  if (session.expiresAt <= Date.now()) {
    sessions.delete(token);
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
    [...sockets]
      .map((socket) => socket.authenticatedSession?.codename)
      .filter(Boolean)
  ]));
}

function broadcastPresenceCounts() {
  const message = JSON.stringify({
    type: 'room-counts',
    counts: getPresenceCounts(),
    members: getPresenceMembers()
  });
  for (const client of server.clients) {
    if (client.readyState === 1) client.send(message);
  }
}

function removePresence(socket) {
  if (!socket.presenceRoomId) return;
  const room = presenceRooms.get(socket.presenceRoomId);
  if (room) {
    room.delete(socket);
    if (room.size === 0) presenceRooms.delete(socket.presenceRoomId);
  }
  socket.presenceRoomId = null;
  broadcastPresenceCounts();
}

// --- Account/Database Management ---

async function readAccounts() {
  let accounts = [];
  if (databasePool) {
    if (!databaseReady) {
      // Ensure the table exists
      await databasePool.query('CREATE TABLE IF NOT EXISTS app_state (id integer PRIMARY KEY, accounts jsonb NOT NULL)');
      databaseReady = true;
    }
    // Fetch accounts from DB
    const result = await databasePool.query('SELECT accounts FROM app_state WHERE id = 1');
    if (result.rows.length && result.rows[0].accounts) {
      accounts = result.rows[0].accounts;
    } else {
      accounts = [];
    }

    // Fallback or synchronization if DB read fails/is empty (based on original file logic)
    if (accounts.length === 0) {
        try {
            accounts = JSON.parse(await readFile(accountFile, 'utf8'));
        } catch {
            accounts = [];
        }
    }
    return accounts;
  }
  
  // Fallback to file read if no database pool
  try {
    return JSON.parse(await readFile(accountFile, 'utf8'));
  } catch {
    return [];
  }
}

async function saveAccounts(accounts) {
  if (databasePool) {
    // Save to DB
    await databasePool.query(
      'INSERT INTO app_state (id, accounts) VALUES (1, $1::jsonb) ON CONFLICT (id) DO UPDATE SET accounts = EXCLUDED.accounts',
      [JSON.stringify(accounts)]
    );
    return;
  }
  // Save to file (fallback)
  await writeFile(accountFile, JSON.stringify(accounts, null, 2));
}

function hashPassword(password, salt = randomBytes(16).toString('hex')) {
  return { salt, hash: scryptSync(password, salt, 64).toString('hex') };
}

function passwordsMatch(password, account) {
  if (!account.passwordHash || !account.passwordSalt) return false;
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
    if (!account.resetKey || !account.resetKeySalt || !account.resetKeyHash) continue;
    
    // Re-hash the reset key for consistency check, or just use existing
    const resetKeyData = hashPassword(account.resetKey);
    
    // The original logic seems to hash the *stored* resetKey to generate new salt/hash pair, which is fine for security rotation.
    account.resetKeySalt = resetKeyData.salt;
    account.resetKeyHash = resetKeyData.hash;
    delete account.resetKey;
    changed = true;
  }
  if (changed) {
    await saveAccounts(accounts);
  }
}

// --- Request Handlers ---

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

// --- Shared videos (welcome/updates and blog clips) ---

const videoAdminCodename = 'gayjesus';
const videoMaxBytes = 40 * 1024 * 1024;
const videoUploadDir = new URL('./video-uploads/', import.meta.url);
const videoIndexFile = new URL('./video-uploads/index.json', import.meta.url);
let videosTableReady = false;

function normalizeVideoKind(value) {
  return value === 'blog' ? 'blog' : 'welcome';
}

async function ensureVideosTable() {
  if (!databasePool || videosTableReady) return;
  await databasePool.query(`
    CREATE TABLE IF NOT EXISTS videos (
      id text PRIMARY KEY,
      kind text NOT NULL,
      title text NOT NULL,
      topic text,
      mime_type text NOT NULL,
      uploaded_by text NOT NULL,
      size integer NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      data bytea NOT NULL
    )
  `);
  videosTableReady = true;
}

function videoFromRow(row) {
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    topic: row.topic || undefined,
    mimeType: row.mime_type,
    uploadedBy: row.uploaded_by,
    size: row.size,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at)
  };
}

async function readLocalVideoIndex() {
  try {
    return JSON.parse(await readFile(videoIndexFile, 'utf8'));
  } catch {
    return [];
  }
}

async function writeLocalVideoIndex(videos) {
  await mkdir(videoUploadDir, { recursive: true });
  await writeFile(videoIndexFile, JSON.stringify(videos, null, 2));
}

async function listVideos(kind) {
  if (databasePool) {
    await ensureVideosTable();
    const result = await databasePool.query(
      'SELECT id, kind, title, topic, mime_type, uploaded_by, size, created_at FROM videos WHERE kind = $1 ORDER BY created_at DESC',
      [kind]
    );
    return result.rows.map(videoFromRow);
  }
  const videos = await readLocalVideoIndex();
  return videos
    .filter((video) => video.kind === kind)
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

async function insertVideo(video) {
  if (databasePool) {
    await ensureVideosTable();
    await databasePool.query(
      'INSERT INTO videos (id, kind, title, topic, mime_type, uploaded_by, size, data) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
      [video.id, video.kind, video.title, video.topic || null, video.mimeType, video.uploadedBy, video.data.length, video.data]
    );
    return;
  }
  await mkdir(videoUploadDir, { recursive: true });
  await writeFile(new URL(`./${video.id}.webm`, videoUploadDir), video.data);
  const videos = await readLocalVideoIndex();
  videos.push({ ...video, size: video.data.length, createdAt: new Date().toISOString(), data: undefined });
  await writeLocalVideoIndex(videos);
}

async function readVideoData(id) {
  if (databasePool) {
    await ensureVideosTable();
    const result = await databasePool.query('SELECT mime_type, data FROM videos WHERE id = $1', [id]);
    if (!result.rows.length) return null;
    return { mimeType: result.rows[0].mime_type, data: result.rows[0].data };
  }
  const videos = await readLocalVideoIndex();
  const video = videos.find((entry) => entry.id === id);
  if (!video) return null;
  try {
    return { mimeType: video.mimeType, data: await readFile(new URL(`./${id}.webm`, videoUploadDir)) };
  } catch {
    return null;
  }
}

async function removeVideo(id) {
  if (databasePool) {
    await ensureVideosTable();
    const result = await databasePool.query('DELETE FROM videos WHERE id = $1 RETURNING id', [id]);
    return result.rowCount > 0;
  }
  const videos = await readLocalVideoIndex();
  const remaining = videos.filter((video) => video.id !== id);
  if (remaining.length === videos.length) return false;
  await writeLocalVideoIndex(remaining);
  try {
    await unlink(new URL(`./${id}.webm`, videoUploadDir));
  } catch {
    // The index is the source of truth; a missing file changes nothing.
  }
  return true;
}

async function readBinaryBody(request, limit) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > limit) {
      const error = new Error('That video is too large. Keep clips under 40 MB.');
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function sendVideoStream(request, response, video) {
  const total = video.data.length;
  response.setHeader('Content-Type', video.mimeType || 'video/webm');
  response.setHeader('Accept-Ranges', 'bytes');
  response.setHeader('Cache-Control', 'public, max-age=86400');

  const range = request.headers.range;
  const match = typeof range === 'string' ? /^bytes=(\d*)-(\d*)$/.exec(range.trim()) : null;
  if (match && (match[1] || match[2])) {
    const start = match[1] ? Number(match[1]) : 0;
    const end = match[2] ? Math.min(Number(match[2]), total - 1) : total - 1;
    if (start >= total || start > end) {
      response.writeHead(416, { 'Content-Range': `bytes */${total}` });
      response.end();
      return;
    }
    response.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${total}`,
      'Content-Length': end - start + 1
    });
    response.end(video.data.subarray(start, end + 1));
    return;
  }

  response.writeHead(200, { 'Content-Length': total });
  response.end(video.data);
}

function requireVideoAdmin(request, response) {
  let session;
  try {
    session = getAuthenticatedSession(request);
  } catch (error) {
    response.writeHead(401, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ error: 'Log in before adding or removing videos.' }));
    return null;
  }
  if (session.codename.toLowerCase() !== videoAdminCodename) {
    response.writeHead(403, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ error: 'Only Gayjesus can add or remove videos.' }));
    return null;
  }
  return session;
}

// --- HTTP Server Logic ---

httpServer.on('request', async (request, response) => {
  const origin = request.headers.origin;
  
  // CORS Headers
  if (origin && isOriginAllowed(origin)) {
    response.setHeader('Access-Control-Allow-Origin', origin);
    response.setHeader('Vary', 'Origin');
    response.setHeader('Access-Control-Allow-Credentials', 'true');
  }
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
  response.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  response.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('X-Frame-Options', 'DENY');
  response.setHeader('Referrer-Policy', 'no-referrer');

  // Handle OPTIONS requests
  if (request.method === 'OPTIONS') {
    response.writeHead(204);
    response.end();
    return;
  }

  // Health check endpoint (for Koyeb/uptime monitors)
  if (request.method === 'GET' && (request.url === '/' || request.url === '/health' || request.url === '/api/health')) {
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ status: 'ok', service: 'the-love-media-api', timestamp: new Date().toISOString() }));
    return;
  }

  const requestUrl = new URL(request.url || '/', 'http://localhost');

  // Videos are shared: any visitor can watch, only the admin can add or remove.
  if (request.method === 'GET' && requestUrl.pathname === '/api/videos') {
    try {
      const videos = await listVideos(normalizeVideoKind(requestUrl.searchParams.get('kind')));
      response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      response.end(JSON.stringify({ videos }));
    } catch (error) {
      console.error('Video list error:', error.message);
      response.writeHead(500, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ error: 'Could not load the videos.' }));
    }
    return;
  }

  if (request.method === 'GET' && requestUrl.pathname.startsWith('/api/videos/')) {
    try {
      const video = await readVideoData(decodeURIComponent(requestUrl.pathname.slice('/api/videos/'.length)));
      if (!video) {
        response.writeHead(404, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({ error: 'Video not found.' }));
        return;
      }
      sendVideoStream(request, response, video);
    } catch (error) {
      console.error('Video read error:', error.message);
      response.writeHead(500, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ error: 'Could not load that video.' }));
    }
    return;
  }

  if (request.method === 'DELETE' && requestUrl.pathname.startsWith('/api/videos/')) {
    const session = requireVideoAdmin(request, response);
    if (!session) return;
    try {
      const removed = await removeVideo(decodeURIComponent(requestUrl.pathname.slice('/api/videos/'.length)));
      if (!removed) {
        response.writeHead(404, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({ error: 'Video not found.' }));
        return;
      }
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ deleted: true }));
    } catch (error) {
      console.error('Video delete error:', error.message);
      response.writeHead(500, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ error: 'Could not remove that video.' }));
    }
    return;
  }

  if (request.method === 'POST' && requestUrl.pathname === '/api/videos') {
    const session = requireVideoAdmin(request, response);
    if (!session) return;
    try {
      const mimeType = String(request.headers['content-type'] || 'video/webm').split(';')[0].trim();
      if (!mimeType.startsWith('video/')) {
        response.writeHead(415, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({ error: 'Only video files can be uploaded.' }));
        return;
      }
      const data = await readBinaryBody(request, videoMaxBytes);
      if (!data.length) {
        response.writeHead(400, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({ error: 'That video was empty. Try recording again.' }));
        return;
      }
      const video = {
        id: randomBytes(12).toString('hex'),
        kind: normalizeVideoKind(requestUrl.searchParams.get('kind')),
        title: String(requestUrl.searchParams.get('title') || '').trim().slice(0, 120) || 'Video',
        topic: String(requestUrl.searchParams.get('topic') || '').trim().slice(0, 60) || null,
        mimeType,
        uploadedBy: session.codename,
        data
      };
      await insertVideo(video);
      response.writeHead(201, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ video: { ...video, data: undefined, size: data.length, createdAt: new Date().toISOString() } }));
    } catch (error) {
      console.error('Video upload error:', error.message);
      response.writeHead(error.statusCode || 500, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ error: error.statusCode ? error.message : 'Could not save that video.' }));
    }
    return;
  }

  // API Endpoint Check
  if (!request.url?.startsWith('/api/') || request.method !== 'POST') {
    response.writeHead(404);
    response.end();
    return;
  }

  try {
    // Authentication Rate Limiting check for sensitive endpoints
    if (['/api/accounts', '/api/login', '/api/reset-password'].includes(request.url)) {
      checkAuthRateLimit(request);
    }
    
    const body = await requestBody(request);
    const accounts = await readAccounts();
    await migrateResetKeys(accounts);

    // --- Webhook Endpoint ---
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

    // --- Checkout Session Endpoint ---
    if (request.url === '/api/create-checkout-session') {
      if (!stripe) {
        throw new Error('Stripe is not configured. Add your STRIPE_SECRET_KEY to a local .env file.');
      }

      const amount = Number(body.amount || 2000);
      const productName = String(body.productName || 'QueerPulse Premium');
      // Validate returnHash format
      const returnHash = typeof body.returnHash === 'string' && /^#(?:welcome|workspace|friends-connect|room\/[a-z0-9-]+)$/.test(body.returnHash)
        ? body.returnHash
        : '#welcome';

      const session = await stripe.checkout.sessions.create({
        mode: 'payment',
        managed_payments: {
          enabled: false,
        },
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

    // --- Account Management Endpoints ---
    if (request.url === '/api/accounts') {
      const codename = String(body.codename || '').trim();
      const resetKey = String(body.resetKey || '').trim();
      const password = String(body.password || '');
      
      if (!codename || !resetKey || !password) throw new Error('All fields are required.');
      
      // Check for duplicate codename
      const exists = accounts.some((account) => account.codename.toLowerCase() === codename.toLowerCase());
      if (exists) throw new Error('That codename is already taken.');
      
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
        }
      });
      
      await saveAccounts(accounts);
      
      // Clear rate limit on successful account creation
      const rateLimitKey = `${getClientAddress(request)}:${request.url}`;
      authRateLimits.delete(rateLimitKey);
      
      response.writeHead(201, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ codename }));
      return;
    }

    if (request.url === '/api/login') {
      const account = accounts.find((savedAccount) => savedAccount.codename.toLowerCase() === String(body.codename || '').trim().toLowerCase());
      
      if (!account) throw new Error('Account not found.');
      if (!passwordsMatch(String(body.password || ''), account)) throw new Error('That codename or password is not correct.');
      
      // Clear rate limit on successful login so the user isn't stuck in lockout
      const rateLimitKey = `${getClientAddress(request)}:${request.url}`;
      authRateLimits.delete(rateLimitKey);
      
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ codename: account.codename, profile: account.profile || {}, sessionToken: createSession(account) }));
      return;
    }

    if (request.url === '/api/reset-password') {
      const codename = String(body.codename || '').trim();
      const resetKey = String(body.resetKey || '').trim();
      const newPassword = String(body.newPassword || '');
      const account = accounts.find((savedAccount) => savedAccount.codename.toLowerCase() === codename.toLowerCase());
      
      if (!account) throw new Error('Account not found.');
      if (!secretMatches(resetKey, account.resetKeySalt, account.resetKeyHash)) throw new Error('That codename or Password Reset Key is not correct.');
      if (newPassword.length < 8) throw new Error('New password must be at least 8 characters.');
      
      const passwordData = hashPassword(newPassword);
      
      account.passwordSalt = passwordData.salt;
      account.passwordHash = passwordData.hash;
      delete account.password; // Remove old password field
      
      await saveAccounts(accounts);
      
      // Clear rate limit on successful password reset
      const rateLimitKey = `${getClientAddress(request)}:${request.url}`;
      authRateLimits.delete(rateLimitKey);
      
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ reset: true }));
      return;
    }

    if (request.url === '/api/profile') {
      const codename = String(body.codename || '').trim();
      const session = getAuthenticatedSession(request);
      const account = accounts.find((savedAccount) => savedAccount.codename.toLowerCase() === codename.toLowerCase());
      
      if (!account || session.codename.toLowerCase() !== codename.toLowerCase()) throw new Error('Authentication required.');
      
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

    if (request.url === '/api/delete-account') {
      const codename = String(body.codename || '').trim();
      const session = getAuthenticatedSession(request);
      const account = accounts.find((savedAccount) => savedAccount.codename.toLowerCase() === codename.toLowerCase());
      
      if (!account || session.codename.toLowerCase() !== codename.toLowerCase()) throw new Error('Authentication required.');
      
      const remainingAccounts = accounts.filter((account) => account.codename.toLowerCase() !== codename.toLowerCase());
      
      if (remainingAccounts.length === accounts.length) throw new Error('Account not found.');
      
      await saveAccounts(remainingAccounts);
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ deleted: true }));
      return;
    }

    // 404 Not Found
    response.writeHead(404);
    response.end();

  } catch (error) {
    if (['/api/accounts', '/api/login', '/api/reset-password'].includes(request.url) && error.statusCode !== 429) {
      recordAuthFailure(request);
    }
    console.error(`Request error for ${request.url}:`, error.message);
    response.writeHead(error.statusCode || 400, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ error: error.message }));
  }
});

// --- WebSocket Logic ---

const server = new WebSocketServer({ server: httpServer });

server.on('connection', (socket) => {
  let roomId = null;
  let peerId = null;
  let authenticatedSession = null;

  socket.on('message', (rawMessage) => {
    let message;
    try {
      message = JSON.parse(rawMessage.toString());
    } catch (e) {
      console.error("Failed to parse WebSocket message:", e);
      return;
    }

    if (message.type === 'auth') {
      authenticatedSession = getSessionByToken(String(message.sessionToken || ''));
      if (!authenticatedSession) {
        socket.close(1008, 'Authentication required.');
      }
      return;
    }

    if (!authenticatedSession) {
      socket.close(1008, 'Authentication required.');
      return;
    }

    if (message.type === 'presence-subscribe') {
      // Send initial state upon subscription
      socket.send(JSON.stringify({ type: 'room-counts', counts: getPresenceCounts(), members: getPresenceMembers() }));
      return;
    }

    if (message.type === 'presence-join') {
      removePresence(socket); // Clean up previous room state if joining a new one
      const presenceRoom = String(message.room || '').trim();
      
      if (presenceRoom) {
        if (!rooms.has(presenceRoom)) rooms.set(presenceRoom, new Map());
        
        const room = rooms.get(presenceRoom);
        if (!room.has(socket)) {
            room.set(socket, { authenticatedSession: authenticatedSession });
        }
        
        presenceRooms.get(presenceRoom)?.add(socket);
        socket.presenceRoomId = presenceRoom;
        broadcastPresenceCounts();
      }
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
      
      // Notify existing peers that a new peer has joined
      for (const [existingPeerId, existingSocket] of room) {
        if (existingSocket !== socket) { // Avoid sending to self if logic is complex
          existingSocket.send(JSON.stringify({ type: 'peer-joined', peerId }));
        }
      }
      
      // Register the new peer
      room.set(peerId, socket);
      
      // Notify the new peer about the existing members
      socket.send(JSON.stringify({ type: 'existing-peer', peerId: peerId }));
      return;
    }

    // Handle peer-to-peer messaging
    if (!roomId || !peerId || !message.to) return;
    const recipient = rooms.get(roomId)?.get(message.to);
    
    if (recipient && recipient.readyState === 1) {
      // Forward message to the recipient
      recipient.send(JSON.stringify({ ...message, from: peerId }));
    }
  });

  socket.on('close', () => {
    removePresence(socket);
    if (!roomId || !peerId) return;
    
    const room = rooms.get(roomId);
    if (room) {
      room.delete(peerId);
      
      // Notify remaining peers that the peer left
      for (const remainingSocket of room?.values() || []) {
        if (remainingSocket.readyState === 1) {
          remainingSocket.send(JSON.stringify({ type: 'peer-left', peerId }));
        }
      }
      
      if (room.size === 0) rooms.delete(roomId);
    }
  });
});

// --- Server Start ---

const host = '0.0.0.0';
httpServer.listen(port, host, () => {
  console.log(`WebRTC signaling & API server listening on http://${host}:${port}`);
});

// --- Database Maintenance ---

const DELETION_INTERVAL = 24 * 60 * 60 * 1000; 

setInterval(async () => {
  if (!databasePool) return;
  console.log('Running master database maintenance: Purging expired messages... 🧹');
  try {
    // 1. Wipe onscreen chat messages older than 30 days
    const purgeOnscreen = `
      DELETE FROM messages 
      WHERE created_at < NOW() - INTERVAL '30 days';
    `;
    const liveResult = await databasePool.query(purgeOnscreen);
    console.log(`Onscreen purge complete: Removed ${liveResult.rowCount} chat records.`);

    // 2. Wipe offscreen/offline PM mail older than 30 days
    const purgeOffscreen = `
      DELETE FROM offline_pm_mail 
      WHERE created_at < NOW() - INTERVAL '30 days';
    `;
    const mailResult = await databasePool.query(purgeOffscreen);
    console.log(`Offscreen purge complete: Removed ${mailResult.rowCount} unread notices.`);

    console.log('Master database cleanup successful! system memory is fully optimized.');
  } catch (err) {
    console.error('Error executing master 30-day deletion worker:', err);
  }
}, DELETION_INTERVAL);