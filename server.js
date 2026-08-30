/*
 * RuhVerse SSR/API server.
 * Debug flow:
 * 1) Environment + data bootstrap
 * 2) Shared helpers + auth/session logic
 * 3) Quran/city SSR renderers
 * 4) API routes (auth/bookmarks/progress/content)
 * 5) Sitemap + public page routes
 */
const express = require('express');
const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function loadDotEnvFile(filePath = path.join(__dirname, '.env')) {
  if (!fs.existsSync(filePath)) return;
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    raw.split(/\r?\n/).forEach((line) => {
      const trimmed = String(line || '').trim();
      if (!trimmed || trimmed.startsWith('#')) return;
      const eq = trimmed.indexOf('=');
      if (eq <= 0) return;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (key && process.env[key] === undefined) {
        process.env[key] = value;
      }
    });
  } catch (err) {
    console.warn('Unable to load .env file:', err.message);
  }
}

loadDotEnvFile();

// App + runtime configuration.
const app = express();
const PORT = process.env.PORT || 3000;
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || 'https://ruhverse.online';

const API_AR = 'https://api.alquran.cloud/v1/quran/quran-uthmani';
const API_EN = 'https://api.alquran.cloud/v1/quran/en.sahih';
const API_CHAPTER_INFO = 'https://api.quran.com/api/v4/chapters';
const TEMPLATE_PATH = path.join(__dirname, 'quran.html');
const BLOGS_DIR = path.join(__dirname, 'Blog Pages');
const QURAN_TEMPLATE = fs.readFileSync(TEMPLATE_PATH, 'utf8');
const AUTH_DB_PATH = path.join(__dirname, 'data', 'auth_db.json');
const SURAH_PROFILES_PATH = path.join(__dirname, 'data', 'surah_profiles.json');
const CITY_PROFILES_PATH = path.join(__dirname, 'data', 'city_profiles.json');
const WORLD_CITY_SEED_PATH = path.join(__dirname, 'data', 'world_cities_seed.json');
const SESSION_SECRET = process.env.SESSION_SECRET || 'ruhverse-dev-session-secret-change-in-production';
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 365; // 365 days (persistent login until manual logout)
const EMAIL_VERIFICATION_TTL_MS = 1000 * 60 * 60 * 24; // 24 hours
const SUPABASE_URL = normalizeWhitespace(process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const SUPABASE_ANON_KEY = normalizeWhitespace(process.env.SUPABASE_ANON_KEY || '');
const SUPABASE_SERVICE_ROLE_KEY = normalizeWhitespace(process.env.SUPABASE_SERVICE_ROLE_KEY || '');
const SUPABASE_AUTH_URL = SUPABASE_URL ? `${SUPABASE_URL}/auth/v1` : '';
const SUPABASE_REST_URL = SUPABASE_URL ? `${SUPABASE_URL}/rest/v1` : '';
const SUPABASE_ENABLED = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
const SUPABASE_ADMIN_ENABLED = Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY);

const SUPABASE_HTTP_TIMEOUT_MS = Math.max(3000, Number(process.env.SUPABASE_HTTP_TIMEOUT_MS) || 15000);
const IS_HOSTED_RUNTIME = Boolean(process.env.VERCEL || process.env.AWS_REGION);
const FILE_AUTH_DISABLED = Boolean(IS_HOSTED_RUNTIME && !SUPABASE_ENABLED);
const BISMILLAH = 'بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ';

let quranCache = null;
let quranCacheTime = 0;
let quranFetchPromise = null;
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const INTRO_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const CHAPTER_META_TTL_MS = 24 * 60 * 60 * 1000;
const surahIntroCache = new Map();
const surahIntroFetchPromises = new Map();
let chapterMetaCache = null;
let chapterMetaCacheTime = 0;
let chapterMetaFetchPromise = null;
let surahProfiles = {};
const cityPrayerCache = new Map(); // slug -> { data, time }
const CITY_PRAYER_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
const cityPopularMosquesCache = new Map(); // slug -> { data, time }
const CITY_POPULAR_MOSQUES_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const CITY_POPULAR_MOSQUES_SSR_TIMEOUT_MS = 1500;
const CITY_POPULAR_MOSQUES_RADIUS_METERS = 14000;
const CITY_POPULAR_MOSQUES_LIMIT = 8;
const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter'
];
const RAMADAN_CALENDAR_YEAR = 2026;
const IST_TIME_ZONE = 'Asia/Kolkata';
const SITEMAP_CITY_CHUNK_SIZE = 45000;
let cityPrayerTemplate = null;
let cityProfiles = {};
let worldCitySeeds = [];

app.use(express.json({ limit: '256kb' }));

if (SUPABASE_ENABLED) {
  console.info('[Auth] Supabase mode enabled (auth + bookmarks + progress).');
  if (!SUPABASE_ADMIN_ENABLED) {
    console.warn('[Auth] SUPABASE_SERVICE_ROLE_KEY missing. Using user-token RLS mode for data operations.');
  }
} else {
  console.warn('[Auth] Supabase env vars missing. Falling back to local auth_db.json mode.');
}
if (FILE_AUTH_DISABLED) {
  console.error('[Auth] Hosted runtime detected without Supabase env. File-based auth is disabled.');
}

try {
  surahProfiles = JSON.parse(fs.readFileSync(SURAH_PROFILES_PATH, 'utf8'));
} catch (err) {
  surahProfiles = {};
  console.warn('Unable to load hardcoded surah profiles:', err.message);
}

try {
  cityProfiles = JSON.parse(fs.readFileSync(CITY_PROFILES_PATH, 'utf8'));
} catch (err) {
  cityProfiles = {};
  console.warn('Unable to load city profiles:', err.message);
}

try {
  worldCitySeeds = JSON.parse(fs.readFileSync(WORLD_CITY_SEED_PATH, 'utf8'));
  if (!Array.isArray(worldCitySeeds)) worldCitySeeds = [];
} catch (err) {
  worldCitySeeds = [];
  console.warn('Unable to load world city seeds:', err.message);
}

try {
  cityPrayerTemplate = fs.readFileSync(path.join(__dirname, 'prayer-times-city.html'), 'utf8');
} catch (err) {
  cityPrayerTemplate = null;
  console.warn('Unable to load city prayer template:', err.message);
}

// --- Shared text, sanitization, and URL helpers ---
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function stripHtmlTags(value) {
  return String(value || '').replace(/<[^>]*>/g, ' ');
}

function decodeBasicHtmlEntities(value) {
  return String(value || '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');
}

function normalizeWhitespace(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function getAuthPublicBaseUrl(req) {
  const configured = String(PUBLIC_BASE_URL || '').trim().replace(/\/+$/, '');
  const configuredLooksLocal =
    /:\/\/localhost(?::\d+)?$/i.test(configured) ||
    /:\/\/127\.0\.0\.1(?::\d+)?$/i.test(configured);
  if (configured && !configuredLooksLocal) {
    return configured;
  }

  const forwardedProto = String(req?.headers?.['x-forwarded-proto'] || '')
    .split(',')[0]
    .trim()
    .toLowerCase();
  const forwardedHostRaw = String(req?.headers?.['x-forwarded-host'] || req?.headers?.host || '')
    .split(',')[0]
    .trim();
  const safeHost = /^[a-z0-9.-]+(?::\d+)?$/i.test(forwardedHostRaw) ? forwardedHostRaw : '';
  const safeHostName = safeHost.split(':')[0].toLowerCase();
  const safeHostLooksLocal = safeHostName === 'localhost' || safeHostName === '127.0.0.1';
  const proto = forwardedProto === 'http' || forwardedProto === 'https' ? forwardedProto : 'https';

  if (safeHost && !safeHostLooksLocal) return `${proto}://${safeHost}`;
  return configured || 'https://ruhverse.online';
}

function buildVerifyEmailUrl(req, rawToken) {
  return `${getAuthPublicBaseUrl(req)}/verify-email?token=${encodeURIComponent(rawToken)}`;
}

function normalizeVerificationActionUrl(req, actionUrl) {
  const raw = normalizeWhitespace(actionUrl || '');
  if (!raw) return '';
  try {
    const parsed = new URL(raw);
    const host = parsed.hostname.toLowerCase();
    if (host === 'localhost' || host === '127.0.0.1') {
      const publicBase = getAuthPublicBaseUrl(req);
      return `${publicBase}${parsed.pathname}${parsed.search}${parsed.hash}`;
    }
    return parsed.toString();
  } catch (_) {
    return raw;
  }
}

function slugifyCityName(name) {
  const cityPart = String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return cityPart || '';
}

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function ensureAuthDbFile() {
  const dir = path.dirname(AUTH_DB_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(AUTH_DB_PATH)) {
    fs.writeFileSync(AUTH_DB_PATH, JSON.stringify({ users: [] }, null, 2), 'utf8');
  }
}

// --- Local file-backed auth storage helpers ---
function readAuthDb() {
  ensureAuthDbFile();
  try {
    const parsed = JSON.parse(fs.readFileSync(AUTH_DB_PATH, 'utf8'));
    if (!parsed || !Array.isArray(parsed.users)) return { users: [] };
    return parsed;
  } catch (_) {
    return { users: [] };
  }
}

function writeAuthDb(db) {
  ensureAuthDbFile();
  const safeDb = db && Array.isArray(db.users) ? db : { users: [] };
  fs.writeFileSync(AUTH_DB_PATH, JSON.stringify(safeDb, null, 2), 'utf8');
}

// --- Session token + password utilities ---
function rejectUnconfiguredHostedAuth(res) {
  if (!FILE_AUTH_DISABLED) return false;
  res.status(503).json({
    error: 'Authentication is not configured on this deployment. Please set SUPABASE_URL, SUPABASE_ANON_KEY, and SUPABASE_SERVICE_ROLE_KEY in hosting environment variables, then redeploy.'
  });
  return true;
}

function base64UrlEncode(value) {
  return Buffer.from(String(value), 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function base64UrlDecode(value) {
  const normalized = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  return Buffer.from(padded, 'base64').toString('utf8');
}

function buildSessionToken(user) {
  const payload = {
    uid: user.id,
    exp: Date.now() + SESSION_TTL_MS
  };
  const payloadRaw = base64UrlEncode(JSON.stringify(payload));
  const signature = crypto.createHmac('sha256', SESSION_SECRET).update(payloadRaw).digest('hex');
  return `${payloadRaw}.${signature}`;
}

function verifySessionToken(tokenRaw) {
  const token = normalizeWhitespace(tokenRaw || '');
  const parts = token.split('.');
  if (parts.length !== 2) return null;

  const payloadRaw = parts[0];
  const suppliedSig = parts[1];
  const expectedSig = crypto.createHmac('sha256', SESSION_SECRET).update(payloadRaw).digest('hex');
  const suppliedBuf = Buffer.from(suppliedSig, 'utf8');
  const expectedBuf = Buffer.from(expectedSig, 'utf8');

  if (suppliedBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(suppliedBuf, expectedBuf)) {
    return null;
  }

  try {
    const payload = JSON.parse(base64UrlDecode(payloadRaw));
    if (!payload || !payload.uid || !payload.exp || payload.exp < Date.now()) return null;
    return payload;
  } catch (_) {
    return null;
  }
}

function createPasswordHash(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, passwordHash) {
  const parts = String(passwordHash || '').split(':');
  if (parts.length !== 2) return false;

  const salt = parts[0];
  const expectedHash = parts[1];
  const actualHash = crypto.scryptSync(String(password || ''), salt, 64).toString('hex');
  const expectedBuf = Buffer.from(expectedHash, 'hex');
  const actualBuf = Buffer.from(actualHash, 'hex');

  if (expectedBuf.length !== actualBuf.length) return false;
  return crypto.timingSafeEqual(expectedBuf, actualBuf);
}

function getTokenFromRequest(req) {
  const authHeader = String(req.headers.authorization || '');
  if (authHeader.toLowerCase().startsWith('bearer ')) {
    return authHeader.slice(7).trim();
  }
  return '';
}

function sanitizeUser(user) {
  const username = getDisplayName(user);
  const fullNameRaw = user?.fullName || user?.full_name || user?.user_metadata?.full_name || '';
  const createdAtRaw = user?.createdAt || user?.created_at || '';
  return {
    id: user.id,
    email: normalizeEmail(user.email),
    username,
    fullName: normalizeFullName(fullNameRaw),
    emailVerified: isUserEmailVerified(user),
    createdAt: createdAtRaw || new Date().toISOString()
  };
}

function normalizeEmail(email) {
  return normalizeWhitespace(email || '').toLowerCase();
}

function normalizeUsername(username) {
  return normalizeWhitespace(username || '').slice(0, 40);
}

function normalizeFullName(fullName) {
  return normalizeWhitespace(fullName || '').slice(0, 80);
}

function getDisplayName(user) {
  const explicit = normalizeUsername(user?.username || user?.user_metadata?.username || '');
  if (explicit) return explicit;

  const emailLocal = String(user?.email || '').split('@')[0] || '';
  const fromEmail = normalizeWhitespace(emailLocal.replace(/[._-]+/g, ' ')).slice(0, 40);
  return fromEmail || 'Member';
}

function isUserEmailVerified(user) {
  if (typeof user?.emailVerified === 'boolean') return user.emailVerified;
  if (Object.prototype.hasOwnProperty.call(user || {}, 'email_confirmed_at')
    || Object.prototype.hasOwnProperty.call(user || {}, 'confirmed_at')) {
    return Boolean(user?.email_confirmed_at || user?.confirmed_at);
  }
  // Keep old users (before verification support) usable.
  return true;
}

// --- Supabase HTTP/auth helpers ---
function buildVerificationTokenBundle() {
  const rawToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
  return {
    rawToken,
    tokenHash,
    expiresAt: new Date(Date.now() + EMAIL_VERIFICATION_TTL_MS).toISOString(),
    sentAt: new Date().toISOString()
  };
}

async function sendEmailVerificationMessage({ email, username, verifyUrl }) {
  const resendApiKey = String(process.env.RESEND_API_KEY || '').trim();
  const from = String(process.env.AUTH_EMAIL_FROM || 'RuhVerse <no-reply@ruhverse.online>').trim();

  if (!resendApiKey) {
    console.warn('RESEND_API_KEY is missing. Email confirmation link logged to console.');
    console.info(`[Verify Email] ${email}: ${verifyUrl}`);
    return { sent: false, provider: 'console' };
  }

  const safeName = escapeHtml(username || 'there');
  const html = `
    <div style="font-family:Arial,sans-serif;line-height:1.6;color:#1f2937">
      <h2 style="margin:0 0 12px;color:#1A4D2E">Confirm Your RuhVerse Account</h2>
      <p>Assalamu alaikum ${safeName},</p>
      <p>Please confirm your email to activate your account and protect RuhVerse from fake signups.</p>
      <p>
        <a href="${verifyUrl}" style="display:inline-block;background:#1A4D2E;color:#fff;text-decoration:none;padding:10px 16px;border-radius:8px">
          Confirm Email
        </a>
      </p>
      <p>This link expires in 24 hours.</p>
      <p>If you did not request this account, you can safely ignore this email.</p>
    </div>
  `;

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from,
        to: [email],
        subject: 'Confirm your RuhVerse account',
        html
      })
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(`Resend request failed (${response.status}): ${detail.slice(0, 200)}`);
    }

    return { sent: true, provider: 'resend' };
  } catch (err) {
    console.error('Failed to send verification email:', err.message);
    console.info(`[Verify Email Fallback] ${email}: ${verifyUrl}`);
    return { sent: false, provider: 'console_fallback' };
  }
}

function clipText(value, maxLength) {
  return String(value || '').trim().slice(0, maxLength);
}

function getSupabaseApiKey(useServiceRole = false) {
  if (useServiceRole && SUPABASE_SERVICE_ROLE_KEY) return SUPABASE_SERVICE_ROLE_KEY;
  return SUPABASE_ANON_KEY;
}

function toSupabaseErrorMessage(payload, fallback) {
  return (
    payload?.msg ||
    payload?.message ||
    payload?.error_description ||
    payload?.error ||
    fallback
  );
}

function isSupabaseEmailDeliveryError(message) {
  const text = normalizeWhitespace(message || '').toLowerCase();
  return text.includes('error sending confirmation email')
    || text.includes('error sending confirmation mail')
    || text.includes('error sending email')
    || text.includes('smtp');
}

async function supabaseRequest(url, options = {}) {
  const method = options.method || 'GET';
  const useServiceRole = Boolean(options.useServiceRole);
  const token = normalizeWhitespace(options.token || '');
  const apiKey = getSupabaseApiKey(useServiceRole);

  if (!SUPABASE_ENABLED || !SUPABASE_ANON_KEY || !apiKey) {
    const err = new Error('Supabase credentials are not configured.');
    err.status = 500;
    throw err;
  }

  const headers = { ...(options.headers || {}) };
  headers.apikey = apiKey;
  headers.Authorization = token ? `Bearer ${token}` : `Bearer ${apiKey}`;

  if (options.body !== undefined && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }

  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), SUPABASE_HTTP_TIMEOUT_MS);
  let response;
  try {
    response = await fetch(url, {
      method,
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      signal: controller.signal
    });
  } catch (err) {
    const isAbort = String(err?.name || '').toLowerCase() === 'aborterror';
    const error = new Error(
      isAbort
        ? `Authentication service timed out after ${SUPABASE_HTTP_TIMEOUT_MS}ms.`
        : `Could not reach authentication service. ${String(err?.message || '').trim()}`
    );
    error.status = isAbort ? 504 : 503;
    throw error;
  } finally {
    clearTimeout(timeoutHandle);
  }

  const text = await response.text().catch(() => '');
  let payload = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch (_) {
      payload = text;
    }
  }

  if (!response.ok) {
    const fallback = `Supabase request failed (${response.status}).`;
    const error = new Error(
      typeof payload === 'object' && payload
        ? toSupabaseErrorMessage(payload, fallback)
        : fallback
    );
    error.status = response.status;
    error.payload = payload;
    throw error;
  }

  return {
    payload,
    response
  };
}

async function supabaseAuthRequest(pathname, options = {}) {
  const cleanPath = pathname.startsWith('/') ? pathname : `/${pathname}`;
  return supabaseRequest(`${SUPABASE_AUTH_URL}${cleanPath}`, options);
}

async function supabaseRestRequest(pathname, options = {}) {
  const cleanPath = pathname.startsWith('/') ? pathname : `/${pathname}`;
  return supabaseRequest(`${SUPABASE_REST_URL}${cleanPath}`, options);
}

async function supabaseAdminGenerateSignupLink({ email, password, username, fullName, redirectTo }) {
  if (!SUPABASE_ADMIN_ENABLED) {
    const err = new Error('Supabase admin key is not configured.');
    err.status = 500;
    throw err;
  }
  const redirect = normalizeWhitespace(redirectTo || '');
  const body = {
    type: 'signup',
    email,
    password,
    data: {
      username,
      full_name: fullName
    }
  };
  if (redirect) body.redirect_to = redirect;

  const { payload } = await supabaseAuthRequest('/admin/generate_link', {
    method: 'POST',
    useServiceRole: true,
    body
  });

  const raw = payload || {};
  const normalizedUser = raw?.user || (raw?.id ? {
    id: raw.id,
    email: raw.email,
    user_metadata: raw.user_metadata || {}
  } : null);
  const actionLink = normalizeWhitespace(
    raw?.action_link || raw?.properties?.action_link || ''
  );

  return {
    raw,
    user: normalizedUser,
    actionLink
  };
}

async function getSupabaseAuthUser(token) {
  const { payload } = await supabaseAuthRequest('/user', { token });
  if (!payload || !payload.id) {
    const err = new Error('Invalid session');
    err.status = 401;
    throw err;
  }
  return payload;
}

async function getSupabaseProfile(userId, token = '') {
  const select = encodeURIComponent('id,email,username,full_name,created_at');
  const filter = encodeURIComponent(userId);
  const { payload } = await supabaseRestRequest(`/profiles?select=${select}&id=eq.${filter}&limit=1`, {
    useServiceRole: !token,
    token
  });
  return Array.isArray(payload) ? payload[0] || null : null;
}

function buildProfileUpsertRow(authUser, fallback = {}) {
  const id = normalizeWhitespace(authUser?.id || fallback?.id || '');
  if (!id) return null;
  const username = normalizeUsername(
    fallback?.username || authUser?.user_metadata?.username || ''
  );
  const fullName = normalizeFullName(
    fallback?.fullName || authUser?.user_metadata?.full_name || username
  );
  return {
    id,
    email: normalizeEmail(authUser?.email || fallback?.email || ''),
    username,
    full_name: fullName
  };
}

async function upsertSupabaseProfile(row, options = {}) {
  if (!row || !row.id) return null;
  const token = normalizeWhitespace(options.token || '');
  const canUseServiceRole = Boolean(options.useServiceRole && SUPABASE_ADMIN_ENABLED);
  if (!token && !canUseServiceRole) return null;

  const { payload } = await supabaseRestRequest('/profiles?on_conflict=id', {
    method: 'POST',
    token,
    useServiceRole: canUseServiceRole,
    headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
    body: [row]
  });
  return Array.isArray(payload) ? payload[0] || null : null;
}

async function ensureSupabaseProfile(authUser, options = {}) {
  const token = normalizeWhitespace(options.token || '');
  const fallback = {
    id: authUser?.id,
    email: authUser?.email,
    username: options.fallbackUsername || '',
    fullName: options.fallbackFullName || ''
  };
  const row = buildProfileUpsertRow(authUser, fallback);
  if (!row) return null;

  const existing = await getSupabaseProfile(row.id, token).catch(() => null);
  if (existing) return existing;

  const upserted = await upsertSupabaseProfile(row, {
    token,
    useServiceRole: Boolean(options.preferServiceRole)
  }).catch(() => null);
  if (upserted) return upserted;

  return getSupabaseProfile(row.id, token).catch(() => null);
}

function mapSupabaseBookmarkRow(row) {
  return {
    surahNumber: Number(row?.surah_number) || 1,
    ayahNumber: Number(row?.ayah_number) || 1,
    note: clipText(row?.note || '', 1200),
    createdAt: row?.created_at || new Date().toISOString()
  };
}

function mapSupabaseProgressRow(row) {
  return {
    lastSurah: Number(row?.last_surah) || 1,
    lastAyah: Number(row?.last_ayah) || 1,
    updatedAt: row?.updated_at || new Date().toISOString()
  };
}

async function requireAuth(req, res, next) {
  const token = getTokenFromRequest(req);
  if (!token) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  if (SUPABASE_ENABLED) {
    try {
      const authUser = await getSupabaseAuthUser(token);
      if (!isUserEmailVerified(authUser)) {
        res.status(401).json({ error: 'Please verify your email before logging in.' });
        return;
      }

      let profile = null;
      try {
        profile = await ensureSupabaseProfile(authUser, {
          token,
          preferServiceRole: true
        });
      } catch (_) {
        profile = null;
      }

      req.authToken = token;
      req.authUserRaw = authUser;
      req.authUser = {
        id: authUser.id,
        email: normalizeEmail(authUser.email),
        username: normalizeUsername(profile?.username || authUser?.user_metadata?.username || ''),
        fullName: normalizeFullName(profile?.full_name || authUser?.user_metadata?.full_name || ''),
        emailVerified: true,
        createdAt: authUser.created_at || profile?.created_at || new Date().toISOString()
      };
      next();
      return;
    } catch (_) {
      res.status(401).json({ error: 'Invalid session' });
      return;
    }
  }

  const session = verifySessionToken(token);
  if (!session) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const db = readAuthDb();
  const user = db.users.find((u) => u.id === session.uid);
  if (!user) {
    res.status(401).json({ error: 'Invalid session' });
    return;
  }
  if (!isUserEmailVerified(user)) {
    res.status(401).json({ error: 'Email is not verified.' });
    return;
  }

  req.authDb = db;
  req.authUser = user;
  next();
}

// --- City profile merge + slug generation ---
function normalizeBookmarkInput(raw) {
  const surahNumber = Number(raw?.surahNumber);
  const ayahNumber = Number(raw?.ayahNumber);
  if (!Number.isInteger(surahNumber) || surahNumber < 1 || surahNumber > 114) return null;
  if (!Number.isInteger(ayahNumber) || ayahNumber < 1 || ayahNumber > 286) return null;
  const note = clipText(
    raw?.note || raw?.textTranslation || raw?.textArabic || '',
    1200
  );

  return {
    surahNumber,
    ayahNumber,
    surahName: clipText(raw?.surahName, 120),
    note
  };
}

const INSIGHT_TEMPLATES = {
  opening: [
    "{name} is a major Muslim community center in {regionLabel}.",
    "The Muslim community in {name}, {regionLabel} relies on accurate daily prayer schedules for their spiritual routine.",
    "In {name}, {regionLabel}, observing daily salah at the prescribed times is a core part of faith and community life.",
    "{name} is home to a dedicated Muslim population in {regionLabel} that gathers for daily and Friday congregational prayers."
  ],
  utility: [
    "This page provides precise daily Fajr, Zohr, Asr, Maghrib, and Isha timings based on the city's geographical coordinates.",
    "Our automated system calculates highly accurate Namaz timings for {name} using the latest astronomical data and local standards.",
    "Follow this comprehensive guide for today's Fajr, Zohar, Asr, Magrib, and Isha times in {name}, updated daily for accuracy."
  ],
  community: [
    "During the holy month of Ramadan, these calculations are especially crucial for Sahur and Iftar timings in the {name} area.",
    "Local mosques and Islamic centers in {name} often use these astronomical windows as a reliable reference for their Adhan.",
    "Staying connected to the prayer schedule in {name} helps maintain a disciplined spiritual life and strengthens community bonds."
  ]
};

const FACT_POOL = [
  "Daily salah timings are calculated using the precise longitudinal and latitudinal coordinates for {name}.",
  "The {name} area follows high-precision astronomical data to ensure Fajr and Maghrib timings are accurate year-round.",
  "Islamic prayer times in {name} shift by a few minutes each day as the sun's position changes throughout the seasons.",
  "During Ramadan, the Iftar and Sahur times in {name} are closely monitored by the local community for fasting.",
  "The Fajr prayer marks the beginning of the spiritual day for Muslims in {name}, starting at the break of dawn.",
  "The Maghrib prayer is observed just after sunset, a key moment for the community in {name} to gather and reflect.",
  "The Dhuhr (Zohr) prayer occurs when the sun is at its highest point in the sky above {name}.",
  "Asr prayer is performed in the afternoon, providing a spiritual pause in the busy daily life of {name}.",
  "Isha is the final prayer of the day, observed by the Muslim community in {name} after twilight has disappeared.",
  "Friday (Jumu'ah) is a special day for the community in {name}, with larger congregations for the noon prayer.",
  "The {name} Central Mosque and other local masjids serve as vital hubs for worship and community welfare.",
  "Islamic heritage in the {regionLabel} region is reflected in the cultural and social life of {name}.",
  "Muslims in {name} often utilize digital tools and mobile apps to stay updated with live Namaz alerts.",
  "Community iftars are a common sight in {name} during Ramadan, fostering a sense of brotherhood and charity.",
  "Islamic values and traditions are deeply integrated into the local community fabric of the {name} area."
];

const FAQ_POOL = [
  {
    q: ["What method is used for {name} Namaz timings?", "How are the prayer times in {name} calculated?", "Are the {name} prayer times based on local mosque timings?"],
    a: ["RuhVerse calculates {name} timings using high-precision coordinates and the widely accepted Islamic standards for this region.", "We use astronomical formulas and local GPS data for {name} to provide the most accurate Fajr, Dhuhr, Asr, Maghrib, and Isha times.", "The timings for {name} are generated based on the city's exact location, ensuring they align with local solar positions."]
  },
  {
    q: ["Are these timings valid for nearby areas around {name}?", "Can I use these timings for suburbs surrounding {name}?", "How accurate are these timings for the {name} metropolitan region?"],
    a: ["Nearby districts usually differ by a few minutes. Use this page as a reliable city-center reference for {name}.", "These calculations are optimized for {name} center. Suburbs within a 10km radius will have nearly identical timings.", "While accurate for {name}, we recommend adding a 1-2 minute buffer for locations at the far edges of the city."]
  },
  {
    q: ["Do Ramadan and Eid dates in {name} change each year?", "When is Ramadan 2026 in {name}?", "How is the start of Ramadan determined in {name}?"],
    a: ["Yes. Ramadan and Eid depend on moon sighting, so official local announcements in {name} should be followed.", "Ramadan 2026 is expected around Feb 19th in {name}, but always check the local Hilal sighting confirmation.", "The Islamic calendar is lunar, meaning dates for {name} shift roughly 11 days earlier each Gregorian year."]
  }
];

function getDeterministicIndex(str, poolSize) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash) % poolSize;
}

function buildDefaultCityProfile(seedRaw) {
  const seed = seedRaw && typeof seedRaw === 'object' ? seedRaw : {};
  const name = normalizeWhitespace(seed.name || '');
  const country = normalizeWhitespace(seed.country || 'India');
  const state = normalizeWhitespace(seed.state || seed.region || '');
  const slug = normalizeWhitespace(seed.slug || slugifyCityName(name));
  if (!name || !slug) return null;

  const zone = normalizeWhitespace(seed.timezone || IST_TIME_ZONE);
  const regionLabel = [state, country].filter(Boolean).join(', ') || country;
  const aliases = Array.isArray(seed.aliases)
    ? seed.aliases.map((x) => normalizeWhitespace(x)).filter(Boolean)
    : [];

  const idx = getDeterministicIndex(slug, 100);

  // Generate unique Insights
  const insOp = INSIGHT_TEMPLATES.opening[idx % INSIGHT_TEMPLATES.opening.length].replace(/{name}/g, name).replace(/{regionLabel}/g, regionLabel);
  const insUt = INSIGHT_TEMPLATES.utility[idx % INSIGHT_TEMPLATES.utility.length].replace(/{name}/g, name);
  const insCo = INSIGHT_TEMPLATES.community[idx % INSIGHT_TEMPLATES.community.length].replace(/{name}/g, name);
  const generatedInsights = `${insOp} ${insUt} ${insCo}`;

  // Generate unique Facts
  const factIndices = [idx % FACT_POOL.length, (idx + 3) % FACT_POOL.length, (idx + 7) % FACT_POOL.length];
  const uniqueFactIndices = [...new Set(factIndices)];
  const generatedFacts = uniqueFactIndices.map(i => FACT_POOL[i].replace(/{name}/g, name).replace(/{regionLabel}/g, regionLabel));

  // Generate unique FAQs
  const generatedFaqs = FAQ_POOL.map((item, i) => {
    const qIdx = (idx + i) % item.q.length;
    const aIdx = (idx + i) % item.a.length;
    return {
      q: item.q[qIdx].replace(/{name}/g, name),
      a: item.a[aIdx].replace(/{name}/g, name)
    };
  });

  return {
    slug,
    name,
    state,
    country,
    latitude: toNumber(seed.latitude),
    longitude: toNumber(seed.longitude),
    method: Number.isFinite(Number(seed.method)) ? Number(seed.method) : 1,
    timezone: zone,
    aliases,
    muslimPopulation: normalizeWhitespace(seed.muslimPopulation || ''),
    famousLandmark: normalizeWhitespace(seed.famousLandmark || `${name} Central Mosque`),
    insights: normalizeWhitespace(seed.insights || generatedInsights),
    facts: Array.isArray(seed.facts) && seed.facts.length
      ? seed.facts.map((x) => normalizeWhitespace(x)).filter(Boolean).slice(0, 5)
      : generatedFacts,
    ramadanNote: normalizeWhitespace(
      seed.ramadanNote
      || `During Ramadan in ${name}, verify moon-sighting announcements from local authorities for final fasting and Eid dates.`
    ),
    faqItems: Array.isArray(seed.faqItems) && seed.faqItems.length
      ? seed.faqItems
      : generatedFaqs
  };
}

function mergeCityProfiles(explicitProfiles, seedCities) {
  const merged = {};

  if (Array.isArray(seedCities)) {
    seedCities.forEach((seed) => {
      const profile = buildDefaultCityProfile(seed);
      if (!profile || !profile.slug) return;
      let finalSlug = profile.slug;
      if (merged[finalSlug]) {
        const countrySuffix = slugifyCityName(profile.country || 'city');
        finalSlug = `${profile.slug}-${countrySuffix || 'global'}`;
      }
      merged[finalSlug] = { ...profile, slug: finalSlug };
    });
  }

  if (explicitProfiles && typeof explicitProfiles === 'object') {
    Object.entries(explicitProfiles).forEach(([key, value]) => {
      if (!value || typeof value !== 'object') return;
      const profile = { ...value };
      const fallbackSlug = slugifyCityName(profile.name);
      const slug = normalizeWhitespace(profile.slug || key || fallbackSlug);
      if (!slug) return;
      // Keep city surface strictly limited to seeded cities:
      // explicit profiles may only enrich/override an existing seed slug.
      if (!merged[slug]) return;
      profile.slug = slug;
      if (!Array.isArray(profile.aliases)) profile.aliases = [];
      merged[slug] = { ...merged[slug], ...profile, slug };
    });
  }

  return merged;
}

cityProfiles = mergeCityProfiles(cityProfiles, worldCitySeeds);

// --- Quran metadata, summaries, and SSR rendering ---
function slugifySurahName(name) {
  const slug = String(name || '')
    .toLowerCase()
    .replace(/['’`]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'surah';
}

function buildSurahPath(surah) {
  const slug = slugifySurahName(surah?.englishName || surah?.englishNameTranslation || '');
  return `/quran/${slug}/${surah.number}`;
}

function getFallbackSurahCanonicalPath(surahNumber) {
  const num = Number(surahNumber);
  if (!Number.isInteger(num) || num < 1 || num > 114) return '/quran/surah/1';
  const profile = surahProfiles?.[num] || surahProfiles?.[String(num)] || null;
  const profileName = normalizeWhitespace(profile?.english_name || profile?.englishName || '');
  if (!profileName) return `/quran/surah/${num}`;
  return `/quran/${slugifySurahName(profileName)}/${num}`;
}

function truncateForMeta(text, maxLength = 160) {
  const clean = normalizeWhitespace(text);
  if (clean.length <= maxLength) return clean;
  return `${clean.slice(0, maxLength - 3).trimEnd()}...`;
}

function normalizeRevelationPlace(placeRaw) {
  const place = String(placeRaw || '').toLowerCase();
  if (place.includes('makk') || place.includes('mecc')) return 'Makkah';
  if (place.includes('med') || place.includes('madin')) return 'Madinah';
  return '';
}

function getHardcodedSurahProfile(surahNumber) {
  if (!surahProfiles || typeof surahProfiles !== 'object') return null;
  const profile = surahProfiles[surahNumber] || surahProfiles[String(surahNumber)] || null;
  if (!profile || typeof profile !== 'object') return null;
  return {
    summary: normalizeWhitespace(profile.summary || ''),
    mainTheme: normalizeWhitespace(profile.main_theme || ''),
    revelationContext: normalizeWhitespace(profile.revelation_context || ''),
    significance: normalizeWhitespace(profile.importance_in_life || ''),
    benefits: Array.isArray(profile.benefits_reader)
      ? profile.benefits_reader.map((x) => normalizeWhitespace(x)).filter(Boolean)
      : []
  };
}

function buildRevelationContext(revelationPlaceRaw, revelationOrder, versesCount) {
  const place = normalizeRevelationPlace(revelationPlaceRaw);
  const order = Number.isInteger(Number(revelationOrder)) && Number(revelationOrder) > 0
    ? Number(revelationOrder)
    : null;
  const verses = Number.isInteger(Number(versesCount)) && Number(versesCount) > 0
    ? Number(versesCount)
    : null;

  const parts = [];
  if (place) {
    parts.push(`Revealed in ${place}.`);
  } else {
    parts.push('Classical sources differ on the exact place of revelation.');
  }
  if (order) {
    parts.push(`Traditionally listed as revelation number ${order}.`);
  }
  if (verses) {
    parts.push(`Contains ${verses} verses.`);
  }

  return `Revelation Context: ${parts.join(' ')}`;
}

function extractSectionTextFromHtml(rawHtml, headingPatterns) {
  const html = String(rawHtml || '');
  if (!html) return '';

  for (const pattern of headingPatterns) {
    const regex = new RegExp(
      `<h[1-6][^>]*>\\s*${pattern}\\s*<\\/h[1-6]>([\\s\\S]*?)(?=<h[1-6][^>]*>|$)`,
      'i'
    );
    const match = html.match(regex);
    if (match && match[1]) {
      return normalizeWhitespace(decodeBasicHtmlEntities(stripHtmlTags(match[1])));
    }
  }

  return '';
}

function splitIntoSentences(text) {
  const clean = normalizeWhitespace(text);
  if (!clean) return [];
  return clean
    .split(/(?<=[.!?])\s+/)
    .map((s) => normalizeWhitespace(s))
    .filter((s) => s.length >= 24);
}

function normalizeThemeLead(text) {
  let value = normalizeWhitespace(text).replace(/^["']+|["']+$/g, '');
  value = value
    .replace(/^the\s+(principal\s+)?(subject|theme|central theme|main theme|discourse)\s+(of\s+this\s+surah|of\s+the\s+surah)?\s*(is|was|:)?\s*/i, '')
    .replace(/^its\s+theme\s+is\s+to\s+/i, '')
    .replace(/^this\s+surah\s+(focuses\s+on|is\s+about|deals\s+with)\s+/i, '');
  return normalizeWhitespace(value);
}

function buildMainTheme(themeSource, surahName, fallbackSummary = '') {
  const candidate = splitIntoSentences(themeSource)[0]
    || splitIntoSentences(fallbackSummary)[0]
    || normalizeWhitespace(fallbackSummary);
  const normalized = normalizeThemeLead(candidate).replace(/[.]+$/, '');
  const core = normalized || 'sincere faith, moral responsibility, and accountability before Allah';
  return truncateForMeta(`Surah ${surahName} focuses on ${core}.`, 230);
}

function uniqueSentences(sentences) {
  const seen = new Set();
  const out = [];
  sentences.forEach((sentence) => {
    const key = sentence.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      out.push(sentence);
    }
  });
  return out;
}

function buildSignificanceAndBenefits(chapterInfo, surahEn) {
  const shortText = normalizeWhitespace(
    decodeBasicHtmlEntities(stripHtmlTags(chapterInfo?.short_text || ''))
  );
  const fullText = String(chapterInfo?.text || '');
  const subjectSection = extractSectionTextFromHtml(fullText, [
    'Subject',
    'Subjects',
    'Theme',
    'Major Issues, Divine Laws and Guidance',
    'Major Issues',
    'Central Theme',
    'Topics?'
  ]);
  const significanceSection = extractSectionTextFromHtml(fullText, [
    'Name',
    'Virtue',
    'Excellence',
    'Background',
    'Historical Background'
  ]);

  const candidateSentences = uniqueSentences([
    ...splitIntoSentences(subjectSection),
    ...splitIntoSentences(significanceSection),
    ...splitIntoSentences(shortText)
  ]);

  let significance = candidateSentences[0] || '';
  let benefits = candidateSentences.slice(1, 3);

  if (!significance) {
    const openingFallback = getOpeningSummaryFallback(surahEn).replace(/^Opening message:\s*/i, '');
    significance = splitIntoSentences(openingFallback)[0] || openingFallback;
  }

  if (!benefits.length) {
    const openingFallback = getOpeningSummaryFallback(surahEn).replace(/^Opening message:\s*/i, '');
    const fallbackSentences = splitIntoSentences(openingFallback);
    benefits = fallbackSentences.slice(0, 2);
  }

  benefits = benefits
    .map((s) => truncateForMeta(s, 220))
    .filter(Boolean);

  return {
    significance: truncateForMeta(significance, 240),
    benefits
  };
}

function buildDetailedRevelationContext(chapterInfo, chapterMeta, defaultRevelationType, ayahCount) {
  const periodText = extractSectionTextFromHtml(chapterInfo?.text || '', [
    'Period of Revelation',
    'Occasion of Revelation',
    'Historical Background'
  ]);

  const periodSentence = splitIntoSentences(periodText)[0] || '';
  const place = chapterMeta?.revelationPlace || defaultRevelationType || '';
  const order = chapterMeta?.revelationOrder || null;
  const verses = chapterMeta?.versesCount || ayahCount;
  const base = buildRevelationContext(place, order, verses).replace(/^Revelation Context:\s*/i, '');

  if (periodSentence) {
    return `Revelation Context: ${base} ${truncateForMeta(periodSentence, 220)}`;
  }

  return `Revelation Context: ${base}`;
}

async function getChapterMetaMap() {
  const now = Date.now();
  if (chapterMetaCache && (now - chapterMetaCacheTime) < CHAPTER_META_TTL_MS) {
    return chapterMetaCache;
  }

  if (!chapterMetaFetchPromise) {
    chapterMetaFetchPromise = (async () => {
      const response = await fetch(`${API_CHAPTER_INFO}?language=en`, {
        headers: { Accept: 'application/json' }
      });
      if (!response.ok) {
        throw new Error(`Chapters API failed: ${response.status}`);
      }

      const payload = await response.json();
      const chapters = Array.isArray(payload?.chapters) ? payload.chapters : [];
      const map = {};

      chapters.forEach((chapter) => {
        if (!chapter?.id) return;
        map[chapter.id] = {
          revelationPlace: chapter.revelation_place || '',
          revelationOrder: chapter.revelation_order || null,
          versesCount: chapter.verses_count || null,
          nameSimple: chapter.name_simple || ''
        };
      });

      chapterMetaCache = map;
      chapterMetaCacheTime = Date.now();
      return map;
    })().finally(() => {
      chapterMetaFetchPromise = null;
    });
  }

  return chapterMetaFetchPromise;
}

function getOpeningSummaryFallback(surahEn) {
  const opening = (surahEn?.ayahs || [])
    .slice(0, 2)
    .map((ayah) => normalizeWhitespace(ayah?.text || ''))
    .filter(Boolean)
    .join(' ');

  if (!opening) {
    return 'This surah emphasizes worship of Allah, moral responsibility, and guidance for righteous living.';
  }

  const trimmed = opening.length > 260 ? `${opening.slice(0, 257).trimEnd()}...` : opening;
  return `Opening message: ${trimmed}`;
}

async function getSurahInfoContent(surahNumber, surahEn) {
  const now = Date.now();
  const cached = surahIntroCache.get(surahNumber);
  if (cached && (now - cached.time) < INTRO_CACHE_TTL_MS) {
    return cached.data;
  }

  if (surahIntroFetchPromises.has(surahNumber)) {
    return surahIntroFetchPromises.get(surahNumber);
  }

  const introPromise = (async () => {
    try {
      const response = await fetch(`${API_CHAPTER_INFO}/${surahNumber}/info?language=en`, {
        headers: { Accept: 'application/json' }
      });
      if (!response.ok) {
        throw new Error(`Chapter info API failed: ${response.status}`);
      }

      const payload = await response.json();
      const chapterInfo = payload?.chapter_info || {};
      const rawSummary = chapterInfo?.short_text || chapterInfo?.text || '';
      const cleanedSummary = normalizeWhitespace(decodeBasicHtmlEntities(stripHtmlTags(rawSummary)));
      const summary = cleanedSummary || getOpeningSummaryFallback(surahEn);
      const extra = buildSignificanceAndBenefits(chapterInfo, surahEn);
      const themeSection = extractSectionTextFromHtml(chapterInfo?.text || '', [
        'Subject',
        'Subjects',
        'Theme',
        'Central Theme',
        'Main Theme',
        'Subject Matter',
        'Topics?',
        'Major Issues'
      ]);
      const mainTheme = buildMainTheme(
        themeSection,
        surahEn?.englishName || `Surah ${surahNumber}`,
        summary
      );
      const data = {
        summary,
        mainTheme,
        significance: extra.significance,
        benefits: extra.benefits,
        chapterInfo
      };

      surahIntroCache.set(surahNumber, { data, time: Date.now() });
      return data;
    } catch (error) {
      const fallback = getOpeningSummaryFallback(surahEn);
      const fallbackData = {
        summary: fallback,
        mainTheme: buildMainTheme('', surahEn?.englishName || `Surah ${surahNumber}`, fallback),
        significance: truncateForMeta(fallback.replace(/^Opening message:\s*/i, ''), 240),
        benefits: splitIntoSentences(fallback).slice(0, 2),
        chapterInfo: {}
      };
      surahIntroCache.set(surahNumber, { data: fallbackData, time: Date.now() });
      console.warn(`Unable to load chapter summary for Surah ${surahNumber}:`, error.message);
      return fallbackData;
    } finally {
      surahIntroFetchPromises.delete(surahNumber);
    }
  })();

  surahIntroFetchPromises.set(surahNumber, introPromise);
  return introPromise;
}

function buildSurahIntro(surahAr, surahInfo, chapterMeta) {
  const ayahCount = Number(surahAr.numberOfAyahs) || surahAr?.ayahs?.length || 0;
  const revelationType = surahAr.revelationType || 'Quranic';
  const translatedName = surahAr.englishNameTranslation || surahAr.englishName;
  const revelationContext = normalizeWhitespace(surahInfo?.revelationContext || '') || buildDetailedRevelationContext(
    surahInfo?.chapterInfo || {},
    chapterMeta || {},
    revelationType,
    ayahCount
  );

  return {
    heading: `About Surah ${surahAr.englishName}`,
    meta: `${surahAr.number}. ${translatedName} | ${revelationType} | ${ayahCount} verses`,
    summary: surahInfo?.summary || 'Summary is currently unavailable for this surah.',
    mainTheme: surahInfo?.mainTheme || buildMainTheme('', surahAr.englishName, surahInfo?.summary || ''),
    revelationContext,
    significance: surahInfo?.significance || '',
    benefits: Array.isArray(surahInfo?.benefits) ? surahInfo.benefits : []
  };
}

function renderSurahIntroHtml(surahIntro) {
  if (!surahIntro) return '';
  const benefits = Array.isArray(surahIntro.benefits) ? surahIntro.benefits.filter(Boolean) : [];
  const benefitsHtml = benefits.length
    ? `<ul class="surah-benefits-list">${benefits.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`
    : '<p class="surah-benefits-empty">Key lessons are preserved in this surah&#39;s themes and guidance.</p>';

  return `
    <section class="verse-block surah-intro-block" aria-label="Surah introduction">
      <h2 class="surah-intro-title">${escapeHtml(surahIntro.heading)}</h2>
      <p class="surah-intro-meta">${escapeHtml(surahIntro.meta)}</p>
      <p class="surah-intro-summary">${escapeHtml(surahIntro.summary)}</p>
      <p class="surah-intro-theme"><strong>Main Theme:</strong> ${escapeHtml(surahIntro.mainTheme || '')}</p>
      <p class="surah-intro-revelation">${escapeHtml(surahIntro.revelationContext || '')}</p>
      <div class="surah-significance-block">
        <h3 class="surah-significance-title">Benefits &amp; Significance</h3>
        <p class="surah-significance-text">${escapeHtml(surahIntro.significance || '')}</p>
        ${benefitsHtml}
      </div>
    </section>
  `;
}

async function getQuranData() {
  const now = Date.now();
  if (quranCache && (now - quranCacheTime) < CACHE_TTL_MS) {
    return quranCache;
  }

  if (!quranFetchPromise) {
    quranFetchPromise = (async () => {
      const [resAr, resEn] = await Promise.all([fetch(API_AR), fetch(API_EN)]);
      if (!resAr.ok || !resEn.ok) {
        throw new Error(`Quran API failed: ar=${resAr.status}, en=${resEn.status}`);
      }

      const [jsonAr, jsonEn] = await Promise.all([resAr.json(), resEn.json()]);
      const data = {
        quranArabic: jsonAr.data.surahs,
        quranEnglish: jsonEn.data.surahs
      };

      quranCache = data;
      quranCacheTime = Date.now();
      return data;
    })().finally(() => {
      quranFetchPromise = null;
    });
  }

  return quranFetchPromise;
}

function renderSurahHtml(surahAr, surahEn, index, surahIntro) {
  let html = '';
  if (index !== 0 && index !== 8) {
    html += `<div class="bismillah-block">${BISMILLAH}</div>`;
  }
  html += renderSurahIntroHtml(surahIntro);

  surahAr.ayahs.forEach((ayah, vIndex) => {
    let text = ayah.text;
    if (vIndex === 0 && index !== 0 && index !== 8) {
      text = text.replace(/^\uFEFF/, '');
      if (text.startsWith(BISMILLAH)) {
        text = text.slice(BISMILLAH.length).trim();
      }
    }

    html += `<div class="verse-block" id="ayah-${ayah.numberInSurah}" data-ayah-index="${vIndex}" data-ayah-number="${ayah.numberInSurah}">`;
    html += `<p class="ayah-arabic">${escapeHtml(text)} <span class="verse-number">${ayah.numberInSurah}</span></p>`;
    html += `<p class="ayah-translation">${escapeHtml(surahEn.ayahs[vIndex].text)}</p>`;
    html += `</div>`;
  });

  return html;
}

function renderSurahListHtml(quranArabic, activeIndex) {
  return quranArabic.map((surah, index) => {
    const isActive = index === activeIndex ? ' active' : '';
    const surahPath = buildSurahPath(surah);
    return `
      <li class="${isActive}">
        <a href="${surahPath}" style="display:flex;justify-content:space-between;align-items:center;gap:0.75rem;text-decoration:none;color:inherit;">
          <span style="font-weight:600;">${surah.number}. ${escapeHtml(surah.englishName)}</span>
          <span class="arabic-name">${escapeHtml(surah.name)}</span>
        </a>
      </li>
    `;
  }).join('');
}

function renderQuranPage(templateHtml, data, initialSurahIndex, canonicalPath, initialSurahIntro, chapterMetaMap = {}) {
  const { quranArabic, quranEnglish } = data;
  const surahAr = quranArabic[initialSurahIndex];
  const surahEn = quranEnglish[initialSurahIndex];
  const surahMeta = quranArabic.map((surah) => ({
    number: surah.number,
    name: surah.name,
    englishName: surah.englishName,
    englishNameTranslation: surah.englishNameTranslation,
    revelationPlace: chapterMetaMap[surah.number]?.revelationPlace || '',
    revelationOrder: chapterMetaMap[surah.number]?.revelationOrder || null,
    versesCount: chapterMetaMap[surah.number]?.versesCount || surah.numberOfAyahs || null
  }));

  const ayahCount = Number(surahAr.numberOfAyahs) || surahAr?.ayahs?.length || 0;
  const revelation = surahAr.revelationType || 'Quranic';
  const translatedName = surahAr.englishNameTranslation || surahAr.englishName;
  const introSnippet = truncateForMeta(initialSurahIntro?.summary || '', 90);
  const themeSnippet = truncateForMeta(initialSurahIntro?.mainTheme || '', 80);
  const pageTitle = `Surah ${surahAr.englishName} (${surahAr.number}) - Arabic Text, English Translation, Tafsir Summary | RuhVerse`;
  const pageDescription = truncateForMeta(
    `Read Surah ${surahAr.englishName} (${surahAr.number}) online with Arabic text, English translation, main theme, revelation context, and tafsir-style summary. ${revelation} Surah with ${ayahCount} verses. ${themeSnippet} ${introSnippet}`,
    160
  );
  const pageKeywords = truncateForMeta(
    [
      `Surah ${surahAr.englishName}`,
      `Surah ${surahAr.number}`,
      `read Surah ${surahAr.englishName} online`,
      `Surah ${surahAr.englishName} English translation`,
      `Surah ${surahAr.number} Arabic text`,
      `Surah ${translatedName}`,
      `Quran Surah ${surahAr.englishName} summary`,
      `Surah ${surahAr.englishName} revelation context`,
      `Quran ${surahAr.number}`,
      'read Quran online',
      'Quran Arabic English translation',
      'Quran tafsir summary',
      'RuhVerse Quran'
    ].join(', '),
    250
  );
  const canonical = `${PUBLIC_BASE_URL}${canonicalPath}`;
  const ogImage = `${PUBLIC_BASE_URL}/assets/RuhVerse.jpg`;
  const currentTitle = `${surahAr.number}. ${surahAr.englishName}`;
  const structuredData = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: pageTitle,
    description: pageDescription,
    url: canonical,
    image: [ogImage],
    author: { '@type': 'Organization', name: 'RuhVerse' },
    publisher: {
      '@type': 'Organization',
      name: 'RuhVerse',
      logo: {
        '@type': 'ImageObject',
        url: ogImage
      }
    },
    mainEntityOfPage: canonical,
    articleSection: `Surah ${surahAr.englishName}`,
    inLanguage: 'en'
  });

  const ssrData = `
<script>
window.__SSR_BOOTSTRAP = ${JSON.stringify({
    surahMeta,
    initialSurahIndex,
    initialSurahArabic: surahAr,
    initialSurahEnglish: surahEn,
    initialSurahIntro
  })};
window.__INITIAL_SURAH_INDEX = ${initialSurahIndex};
</script>
`;

  return templateHtml
    .replace('<!--SSR_PAGE_TITLE-->Read Quran Online with Arabic Text, Translation & Tafsir Summary | RuhVerse', escapeHtml(pageTitle))
    .replace('<!--SSR_PAGE_DESCRIPTION-->Read Quran online with Arabic text, English translation, Surah summaries, and revelation context on RuhVerse.', escapeHtml(pageDescription))
    .replace('<!--SSR_PAGE_KEYWORDS-->read quran online, quran arabic text with english translation, surah tafsir summary, quran by surah, ruhverse quran', escapeHtml(pageKeywords))
    .replace('<!--SSR_CANONICAL-->https://ruhverse.online/quran.html', escapeHtml(canonical))
    .replace('<!--SSR_OG_TITLE-->Read Quran Online with Arabic Text, Translation & Tafsir Summary | RuhVerse', escapeHtml(pageTitle))
    .replace('<!--SSR_OG_DESCRIPTION-->Read Quran online with Arabic text, English translation, Surah summaries, and revelation context on RuhVerse.', escapeHtml(pageDescription))
    .replace('<!--SSR_OG_URL-->https://ruhverse.online/quran.html', escapeHtml(canonical))
    .replace('<!--SSR_OG_IMAGE-->https://ruhverse.online/assets/RuhVerse.jpg', escapeHtml(ogImage))
    .replace('<!--SSR_TWITTER_URL-->https://ruhverse.online/quran.html', escapeHtml(canonical))
    .replace('<!--SSR_TWITTER_TITLE-->Read Quran Online with Arabic Text, Translation & Tafsir Summary | RuhVerse', escapeHtml(pageTitle))
    .replace('<!--SSR_TWITTER_DESCRIPTION-->Read Quran online with Arabic text, English translation, Surah summaries, and revelation context on RuhVerse.', escapeHtml(pageDescription))
    .replace('<!--SSR_TWITTER_IMAGE-->https://ruhverse.online/assets/RuhVerse.jpg', escapeHtml(ogImage))
    .replace('<!--SSR_STRUCTURED_DATA-->', `<script type="application/ld+json">${structuredData}</script>`)
    .replace('<!--SSR_CURRENT_SURAH_TITLE-->Al-Fatihah', escapeHtml(currentTitle))
    .replace('<!--SSR_SURAH_LIST-->', renderSurahListHtml(quranArabic, initialSurahIndex))
    .replace('<!--SSR_QURAN_CONTENT-->', renderSurahHtml(surahAr, surahEn, initialSurahIndex, initialSurahIntro))
    .replace('<!--SSR_DATA-->', ssrData);
}

function applyIndexingHeaders(res) {
  res.set('X-Robots-Tag', 'index, follow, max-image-preview:large');
}

async function serveQuranPage(req, res, initialSurahIndex, canonicalPathOverride) {
  const templateHtml = QURAN_TEMPLATE;
  applyIndexingHeaders(res);

  try {
    const data = await getQuranData();
    let chapterMetaMap = {};
    try {
      chapterMetaMap = await getChapterMetaMap();
    } catch (metaErr) {
      console.warn('Unable to load chapter metadata:', metaErr.message);
    }
    const surahAr = data.quranArabic[initialSurahIndex];
    const surahEn = data.quranEnglish[initialSurahIndex];
    const canonicalPath = canonicalPathOverride || buildSurahPath(surahAr);
    const hardcodedProfile = getHardcodedSurahProfile(surahAr.number);
    const surahInfo = hardcodedProfile
      ? {
        summary: hardcodedProfile.summary,
        mainTheme: hardcodedProfile.mainTheme,
        revelationContext: hardcodedProfile.revelationContext,
        significance: hardcodedProfile.significance,
        benefits: hardcodedProfile.benefits,
        chapterInfo: {}
      }
      : await getSurahInfoContent(surahAr.number, surahEn);
    const surahIntro = buildSurahIntro(surahAr, surahInfo, chapterMetaMap[surahAr.number]);
    const html = renderQuranPage(templateHtml, data, initialSurahIndex, canonicalPath, surahIntro, chapterMetaMap);
    res.send(html);
  } catch (err) {
    console.error('SSR fetch failed, falling back to static page:', err);
    const canonicalPath = canonicalPathOverride || '/quran.html';
    const fallback = templateHtml
      .replace('<!--SSR_SURAH_LIST-->', '')
      .replace('<!--SSR_QURAN_CONTENT-->', '<div class="loading-spinner">Loading Quran Data...</div>')
      .replace('<!--SSR_DATA-->', '')
      .replace('<!--SSR_CURRENT_SURAH_TITLE-->Al-Fatihah', 'Al-Fatihah')
      .replace('<!--SSR_PAGE_KEYWORDS-->read quran online, quran arabic text with english translation, surah tafsir summary, quran by surah, ruhverse quran', 'read quran online, quran arabic text with english translation, surah tafsir summary, quran by surah, ruhverse quran')
      .replace('<!--SSR_CANONICAL-->https://ruhverse.online/quran.html', `${PUBLIC_BASE_URL}${canonicalPath}`)
      .replace('<!--SSR_PAGE_TITLE-->Read Quran Online with Arabic Text, Translation & Tafsir Summary | RuhVerse', 'Read Quran Online with Arabic Text, Translation & Tafsir Summary | RuhVerse')
      .replace('<!--SSR_PAGE_DESCRIPTION-->Read Quran online with Arabic text, English translation, Surah summaries, and revelation context on RuhVerse.', 'Read Quran online with Arabic text, English translation, Surah summaries, and revelation context on RuhVerse.')
      .replace('<!--SSR_OG_TITLE-->Read Quran Online with Arabic Text, Translation & Tafsir Summary | RuhVerse', 'Read Quran Online with Arabic Text, Translation & Tafsir Summary | RuhVerse')
      .replace('<!--SSR_OG_DESCRIPTION-->Read Quran online with Arabic text, English translation, Surah summaries, and revelation context on RuhVerse.', 'Read Quran online with Arabic text, English translation, Surah summaries, and revelation context on RuhVerse.')
      .replace('<!--SSR_OG_URL-->https://ruhverse.online/quran.html', `${PUBLIC_BASE_URL}${canonicalPath}`)
      .replace('<!--SSR_OG_IMAGE-->https://ruhverse.online/assets/RuhVerse.jpg', `${PUBLIC_BASE_URL}/assets/RuhVerse.jpg`)
      .replace('<!--SSR_TWITTER_URL-->https://ruhverse.online/quran.html', `${PUBLIC_BASE_URL}${canonicalPath}`)
      .replace('<!--SSR_TWITTER_TITLE-->Read Quran Online with Arabic Text, Translation & Tafsir Summary | RuhVerse', 'Read Quran Online with Arabic Text, Translation & Tafsir Summary | RuhVerse')
      .replace('<!--SSR_TWITTER_DESCRIPTION-->Read Quran online with Arabic text, English translation, Surah summaries, and revelation context on RuhVerse.', 'Read Quran online with Arabic text, English translation, Surah summaries, and revelation context on RuhVerse.')
      .replace('<!--SSR_TWITTER_IMAGE-->https://ruhverse.online/assets/RuhVerse.jpg', `${PUBLIC_BASE_URL}/assets/RuhVerse.jpg`)
      .replace('<!--SSR_STRUCTURED_DATA-->', '');
    res.send(fallback);
  }
}

// --- Quran API endpoints ---
app.get('/api/quran-data', async (req, res) => {
  try {
    const data = await getQuranData();
    res.setHeader('Cache-Control', 'public, max-age=900, stale-while-revalidate=3600');
    let chapterMetaMap = {};
    try {
      chapterMetaMap = await getChapterMetaMap();
    } catch (_) {
      chapterMetaMap = {};
    }
    res.json({ ...data, chapterMetaMap });
  } catch (err) {
    res.status(502).json({ error: 'Failed to load Quran data' });
  }
});

app.get('/api/surah-info/:surahNumber(\\d+)', async (req, res) => {
  const surahNumber = Number(req.params.surahNumber);
  if (surahNumber < 1 || surahNumber > 114) {
    res.status(404).json({ error: 'Surah not found' });
    return;
  }

  try {
    const data = await getQuranData();
    res.setHeader('Cache-Control', 'public, max-age=3600, stale-while-revalidate=86400');
    const chapterMetaMap = await getChapterMetaMap().catch(() => ({}));
    const surahAr = data.quranArabic[surahNumber - 1];
    const surahEn = data.quranEnglish[surahNumber - 1];
    const hardcodedProfile = getHardcodedSurahProfile(surahNumber);
    const surahInfo = hardcodedProfile
      ? {
        summary: hardcodedProfile.summary,
        mainTheme: hardcodedProfile.mainTheme,
        revelationContext: hardcodedProfile.revelationContext,
        significance: hardcodedProfile.significance,
        benefits: hardcodedProfile.benefits,
        chapterInfo: {}
      }
      : await getSurahInfoContent(surahNumber, surahEn);
    const intro = buildSurahIntro(surahAr, surahInfo, chapterMetaMap[surahNumber]);

    res.json({ intro });
  } catch (err) {
    res.status(502).json({ error: 'Failed to load surah info' });
  }
});

// -- Qibla Finder page --
app.get('/qibla', (req, res) => {
  const qiblaPath = path.join(__dirname, 'qibla.html');
  if (!fs.existsSync(qiblaPath)) {
    res.status(404).send('Qibla page not found.');
    return;
  }
  res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
  res.sendFile(qiblaPath);
});

app.get('/api/cities', (req, res) => {
  const query = normalizeWhitespace(req.query.q || '').toLowerCase();
  const limitRaw = Number(req.query.limit);
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(500, limitRaw)) : 50;

  const allCities = Object.values(cityProfiles);
  const filtered = query
    ? allCities.filter((city) => {
      const aliases = Array.isArray(city.aliases) ? city.aliases : [];
      const haystack = [
        city.slug,
        city.name,
        city.state,
        city.country,
        ...aliases
      ].map((x) => normalizeWhitespace(x).toLowerCase()).join(' ');
      return haystack.includes(query);
    })
    : allCities;

  const items = filtered
    .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')))
    .slice(0, limit)
    .map((city) => ({
      slug: city.slug,
      name: city.name,
      state: city.state || '',
      country: city.country || '',
      timezone: city.timezone || '',
      latitude: city.latitude,
      longitude: city.longitude
    }));

  res.setHeader('Cache-Control', 'public, max-age=1800, stale-while-revalidate=86400');
  res.json({
    total: filtered.length,
    returned: items.length,
    items
  });
});

// --- Auth + account routes ---
app.post('/api/auth/register', async (req, res) => {
  if (rejectUnconfiguredHostedAuth(res)) return;

  const username = normalizeUsername(req.body?.username);
  const fullName = normalizeFullName(req.body?.fullName || username);
  const email = normalizeEmail(req.body?.email);
  const password = String(req.body?.password || '');
  const verifyRedirectUrl = `${getAuthPublicBaseUrl(req)}/verify-email`;
  const verifyRedirectParam = encodeURIComponent(verifyRedirectUrl);

  if (username.length < 2 || username.length > 40) {
    res.status(400).json({ error: 'Username must be between 2 and 40 characters.' });
    return;
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    res.status(400).json({ error: 'Enter a valid email address.' });
    return;
  }

  if (password.length < 6 || password.length > 200) {
    res.status(400).json({ error: 'Password must be between 6 and 200 characters.' });
    return;
  }

  if (SUPABASE_ENABLED) {
    try {
      const hasResendApiKey = Boolean(String(process.env.RESEND_API_KEY || '').trim());

      if (SUPABASE_ADMIN_ENABLED && hasResendApiKey) {
        try {
          const adminPayload = await supabaseAdminGenerateSignupLink({
            email,
            password,
            username,
            fullName,
            redirectTo: verifyRedirectUrl
          });

          const authUser = adminPayload?.user;
          const actionLink = normalizeVerificationActionUrl(req, adminPayload?.actionLink || '');
          if (!actionLink) {
            throw new Error('Could not create verification email link.');
          }

          const profile = authUser?.id
            ? await ensureSupabaseProfile(authUser, {
              preferServiceRole: true,
              fallbackUsername: username,
              fallbackFullName: fullName
            }).catch(() => null)
            : null;

          await sendEmailVerificationMessage({
            email,
            username: username || getDisplayName({ email }),
            verifyUrl: actionLink
          });

          const user = sanitizeUser({
            ...authUser,
            email,
            username: profile?.username || username || authUser?.user_metadata?.username || '',
            full_name: profile?.full_name || fullName || authUser?.user_metadata?.full_name || '',
            emailVerified: false
          });

          res.status(201).json({
            requiresEmailVerification: true,
            user,
            message: 'Email verification sent. Please check your email.'
          });
          return;
        } catch (adminErr) {
          console.warn('Admin verification-link flow failed. Falling back to standard signup:', adminErr.message);
        }
      }

      const { payload } = await supabaseAuthRequest(`/signup?redirect_to=${verifyRedirectParam}`, {
        method: 'POST',
        body: {
          email,
          password,
          data: {
            username,
            full_name: fullName
          },
          options: {
            emailRedirectTo: verifyRedirectUrl,
            data: {
              username,
              full_name: fullName
            }
          }
        }
      });

      const authUser = payload?.user || (payload?.id ? payload : null);
      if (!authUser?.id) {
        res.status(201).json({
          requiresEmailVerification: true,
          user: sanitizeUser({
            id: '',
            email,
            username,
            full_name: fullName,
            emailVerified: false,
            created_at: new Date().toISOString()
          }),
          message: 'Email verification sent. Please check your email.'
        });
        return;
      }

      const token = normalizeWhitespace(payload?.access_token || payload?.session?.access_token || '');
      const requiresEmailVerification = !isUserEmailVerified(authUser);
      const profile = await ensureSupabaseProfile(authUser, {
        token,
        fallbackUsername: username,
        fallbackFullName: fullName,
        preferServiceRole: true
      }).catch(() => null);
      const user = sanitizeUser({
        ...authUser,
        email,
        username: profile?.username || username || authUser?.user_metadata?.username || '',
        full_name: profile?.full_name || fullName || authUser?.user_metadata?.full_name || '',
        emailVerified: Boolean(authUser?.email_confirmed_at)
      });

      res.status(201).json({
        requiresEmailVerification,
        user,
        token: !requiresEmailVerification ? (token || undefined) : undefined,
        message: requiresEmailVerification
          ? 'Email verification sent. Please check your email.'
          : 'Account created successfully.'
      });

      // Best effort resend for providers that delay first email delivery.
      if (requiresEmailVerification) {
        await supabaseAuthRequest(`/resend?redirect_to=${verifyRedirectParam}`, {
          method: 'POST',
          body: {
            type: 'signup',
            email,
            options: {
              emailRedirectTo: verifyRedirectUrl
            }
          }
        }).catch(() => null);
      }
      return;
    } catch (err) {
      const message = String(err?.message || 'Could not create account.');
      if (isSupabaseEmailDeliveryError(message)) {
        res.status(503).json({
          error: 'Account could not send verification email right now. Please try again in a minute.'
        });
        return;
      }
      const isConflict = /already registered|already exists|exists/i.test(message);
      if (isConflict) {
        try {
          await supabaseAuthRequest(`/resend?redirect_to=${verifyRedirectParam}`, {
            method: 'POST',
            body: {
              type: 'signup',
              email,
              options: {
                emailRedirectTo: verifyRedirectUrl
              }
            }
          });

          res.status(202).json({
            requiresEmailVerification: true,
            message: 'Email already registered but not verified. We have sent a fresh verification link.'
          });
          return;
        } catch (_) {
          res.status(409).json({ error: 'This email is already registered. Please login.' });
          return;
        }
      }

      // Recovery path: if signup may have completed but a follow-up step failed,
      // resend verification and return a success-style message.
      try {
        await supabaseAuthRequest(`/resend?redirect_to=${verifyRedirectParam}`, {
          method: 'POST',
          body: {
            type: 'signup',
            email,
            options: {
              emailRedirectTo: verifyRedirectUrl
            }
          }
        });
        res.status(202).json({
          requiresEmailVerification: true,
          message: 'Email verification sent. Please check your email.'
        });
        return;
      } catch (_) {
        // Keep original error below.
      }

      if (/could not create account|create account right now/i.test(message)) {
        res.status(202).json({
          requiresEmailVerification: true,
          message: 'Email verification may already be sent. Please check your inbox and spam folder.'
        });
        return;
      }

      res.status(err?.status || 400).json({ error: message });
      return;
    }
  }

  const db = readAuthDb();
  const existing = db.users.find((u) => normalizeEmail(u.email) === email);
  const { rawToken, tokenHash, expiresAt, sentAt } = buildVerificationTokenBundle();
  const verifyUrl = buildVerifyEmailUrl(req, rawToken);

  if (existing) {
    if (isUserEmailVerified(existing)) {
      res.status(409).json({ error: 'This email is already registered. Please login.' });
      return;
    }

    existing.username = username || existing.username || '';
    existing.fullName = fullName || existing.fullName || '';
    existing.emailVerification = { tokenHash, expiresAt, sentAt };
    existing.emailVerified = false;
    writeAuthDb(db);

    sendEmailVerificationMessage({
      email: existing.email,
      username: existing.username || getDisplayName(existing),
      verifyUrl
    }).catch(() => null);

    res.status(202).json({
      requiresEmailVerification: true,
      user: sanitizeUser(existing),
      message: 'Email already registered but not verified. We have sent a fresh verification link.'
    });
    return;
  }

  const nowIso = new Date().toISOString();
  const user = {
    id: crypto.randomUUID(),
    username,
    fullName,
    email,
    passwordHash: createPasswordHash(password),
    emailVerified: false,
    emailVerification: { tokenHash, expiresAt, sentAt },
    createdAt: nowIso,
    userProgress: {
      lastSurah: 1,
      lastAyah: 1,
      updatedAt: nowIso
    },
    bookmarks: []
  };

  db.users.push(user);
  writeAuthDb(db);

  sendEmailVerificationMessage({
    email: user.email,
    username: user.username || getDisplayName(user),
    verifyUrl
  }).catch(() => null);

  res.status(201).json({
    requiresEmailVerification: true,
    user: sanitizeUser(user),
    message: 'Account created. Please verify your email before logging in.'
  });
});

app.post('/api/auth/verify-email', async (req, res) => {
  if (rejectUnconfiguredHostedAuth(res)) return;

  if (SUPABASE_ENABLED) {
    const tokenHash = normalizeWhitespace(req.body?.tokenHash || req.body?.token_hash || '');
    const token = normalizeWhitespace(req.body?.token || '');
    const type = normalizeWhitespace(req.body?.type || 'signup') || 'signup';
    if (!tokenHash && !token) {
      res.status(400).json({ error: 'Verification token is required.' });
      return;
    }

    try {
      const { payload } = await supabaseAuthRequest('/verify', {
        method: 'POST',
        body: tokenHash
          ? { type, token_hash: tokenHash }
          : { type, token }
      });

      const user = sanitizeUser(payload?.user || {});
      const token = normalizeWhitespace(payload?.access_token || payload?.session?.access_token || '');
      res.json({
        user,
        token,
        message: 'Email verified successfully.'
      });
      return;
    } catch (err) {
      res.status(err?.status || 400).json({ error: String(err?.message || 'Could not verify email.') });
      return;
    }
  }

  const tokenRaw = normalizeWhitespace(req.body?.token || '');
  if (!tokenRaw) {
    res.status(400).json({ error: 'Verification token is required.' });
    return;
  }

  const tokenHash = crypto.createHash('sha256').update(tokenRaw).digest('hex');
  const db = readAuthDb();
  const user = db.users.find((u) => {
    const meta = u?.emailVerification || {};
    return String(meta.tokenHash || '') === tokenHash;
  });

  if (!user) {
    res.status(400).json({ error: 'Invalid verification token.' });
    return;
  }

  const expiresAtRaw = user?.emailVerification?.expiresAt || '';
  const expiresAtMs = Date.parse(expiresAtRaw);
  if (!Number.isFinite(expiresAtMs) || expiresAtMs < Date.now()) {
    res.status(400).json({ error: 'Verification link has expired. Please register again to get a new link.' });
    return;
  }

  user.emailVerified = true;
  delete user.emailVerification;
  writeAuthDb(db);

  res.json({
    user: sanitizeUser(user),
    token: buildSessionToken(user),
    message: 'Email verified successfully.'
  });
});

app.post('/api/auth/resend-verification', async (req, res) => {
  if (rejectUnconfiguredHostedAuth(res)) return;

  const email = normalizeEmail(req.body?.email);
  if (!email) {
    res.status(400).json({ error: 'Email is required.' });
    return;
  }

  if (SUPABASE_ENABLED) {
    try {
      const verifyRedirectUrl = `${getAuthPublicBaseUrl(req)}/verify-email`;
      const verifyRedirectParam = encodeURIComponent(verifyRedirectUrl);
      await supabaseAuthRequest(`/resend?redirect_to=${verifyRedirectParam}`, {
        method: 'POST',
        body: {
          type: 'signup',
          email,
          options: {
            emailRedirectTo: verifyRedirectUrl
          }
        }
      });
      res.status(202).json({ message: 'Verification email sent. Please check your inbox.' });
      return;
    } catch (err) {
      const message = String(err?.message || 'Could not resend verification email.');
      if (isSupabaseEmailDeliveryError(message)) {
        res.status(503).json({ error: 'Verification email could not be delivered right now. Please try again shortly.' });
        return;
      }
      res.status(err?.status || 400).json({ error: message });
      return;
    }
  }

  const db = readAuthDb();
  const user = db.users.find((u) => normalizeEmail(u.email) === email);
  if (!user) {
    res.status(404).json({ error: 'No account found for this email.' });
    return;
  }
  if (isUserEmailVerified(user)) {
    res.status(409).json({ error: 'This account is already verified. Please login.' });
    return;
  }

  const { rawToken, tokenHash, expiresAt, sentAt } = buildVerificationTokenBundle();
  user.emailVerification = { tokenHash, expiresAt, sentAt };
  user.emailVerified = false;
  writeAuthDb(db);

  const verifyUrl = buildVerifyEmailUrl(req, rawToken);
  sendEmailVerificationMessage({
    email: user.email,
    username: user.username || getDisplayName(user),
    verifyUrl
  }).catch(() => null);

  res.status(202).json({ message: 'Verification email sent. Please check your inbox.' });
});

app.post('/api/auth/login', async (req, res) => {
  if (rejectUnconfiguredHostedAuth(res)) return;

  const email = normalizeEmail(req.body?.email);
  const password = String(req.body?.password || '');

  if (!email || !password) {
    res.status(400).json({ error: 'Email and password are required.' });
    return;
  }

  if (SUPABASE_ENABLED) {
    try {
      const { payload } = await supabaseAuthRequest('/token?grant_type=password', {
        method: 'POST',
        body: { email, password }
      });

      const token = normalizeWhitespace(payload?.access_token || '');
      if (!token) {
        throw new Error('Login succeeded but no session token was returned.');
      }

      const authUser = payload?.user || {};
      if (!isUserEmailVerified(authUser)) {
        res.status(403).json({ error: 'Please verify your email before logging in.' });
        return;
      }
      const profile = await ensureSupabaseProfile(authUser, {
        token,
        preferServiceRole: true
      }).catch(() => null);
      const user = sanitizeUser({
        ...authUser,
        username: profile?.username || authUser?.user_metadata?.username || '',
        full_name: profile?.full_name || authUser?.user_metadata?.full_name || ''
      });

      res.json({ user, token });
      return;
    } catch (err) {
      const message = String(err?.message || 'Invalid email or password.');
      const emailConfirmationError = /email not confirmed|email confirmation/i.test(message);
      res.status(emailConfirmationError ? 403 : (err?.status || 401)).json({
        error: emailConfirmationError ? 'Please verify your email before logging in.' : message
      });
      return;
    }
  }

  const db = readAuthDb();
  const user = db.users.find((u) => normalizeEmail(u.email) === email);
  if (!user || !verifyPassword(password, user.passwordHash)) {
    res.status(401).json({ error: 'Invalid email or password.' });
    return;
  }
  if (!isUserEmailVerified(user)) {
    res.status(403).json({ error: 'Please verify your email before logging in.' });
    return;
  }

  res.json({
    user: sanitizeUser(user),
    token: buildSessionToken(user)
  });
});

app.get('/api/auth/me', requireAuth, async (req, res) => {
  if (SUPABASE_ENABLED) {
    try {
      const userId = encodeURIComponent(req.authUser.id);
      const { payload, response } = await supabaseRestRequest(`/bookmarks?select=id&user_id=eq.${userId}`, {
        token: req.authToken,
        headers: {
          Prefer: 'count=exact',
          Range: '0-0'
        }
      });
      const contentRange = String(response?.headers?.get('content-range') || '');
      const totalCount = Number(contentRange.split('/')[1]);
      const count = Number.isFinite(totalCount) ? totalCount : (Array.isArray(payload) ? payload.length : 0);
      res.json({
        user: sanitizeUser(req.authUser),
        bookmarksCount: count
      });
      return;
    } catch (_) {
      res.json({
        user: sanitizeUser(req.authUser),
        bookmarksCount: 0
      });
      return;
    }
  }

  res.json({
    user: sanitizeUser(req.authUser),
    bookmarksCount: Array.isArray(req.authUser.bookmarks) ? req.authUser.bookmarks.length : 0
  });
});

app.post('/api/auth/logout', (req, res) => {
  res.status(204).end();
});

app.get('/api/auth/status', (req, res) => {
  res.json({
    mode: SUPABASE_ENABLED ? 'supabase' : 'local',
    hostedRuntime: IS_HOSTED_RUNTIME,
    fileAuthDisabled: FILE_AUTH_DISABLED,
    supabaseConfigured: Boolean(SUPABASE_URL && SUPABASE_ANON_KEY),
    supabaseAdminConfigured: Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY),
    emailProviderConfigured: Boolean(String(process.env.RESEND_API_KEY || '').trim()),
    publicBaseUrl: PUBLIC_BASE_URL
  });
});

app.get('/verify-email', (req, res) => {
  const token = normalizeWhitespace(req.query.token || '');
  const verificationMode = SUPABASE_ENABLED ? 'supabase' : 'legacy';

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <!-- Google tag (gtag.js) -->
  <script async src="https://www.googletagmanager.com/gtag/js?id=G-D26HFHH54J"></script>
  <script>
    window.dataLayer = window.dataLayer || [];
    function gtag(){dataLayer.push(arguments);}
    gtag('js', new Date());

    gtag('config', 'G-D26HFHH54J');
  </script>
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Email Verification | RuhVerse</title>
  <style>
    body{font-family:Arial,sans-serif;background:#f7faf8;color:#163426;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:1rem}
    .card{max-width:520px;width:100%;background:#fff;border:1px solid #d8e8df;border-radius:14px;padding:1.4rem 1.2rem;box-shadow:0 18px 40px rgba(22,52,38,.08)}
    h1{margin:0 0 .6rem;font-size:1.35rem;color:#1A4D2E}
    p{margin:.3rem 0 .8rem;line-height:1.6}
    .muted{color:#5f7a6b;font-size:.95rem}
    .error{color:#8b1f1f}
  </style>
</head>
<body>
  <div class="card">
    <h1>Confirming your email...</h1>
    <p id="status">Please wait while we verify your account.</p>
    <p class="muted">After confirmation, you can sign in normally on RuhVerse.</p>
  </div>
  <script>
    (async function () {
      const statusEl = document.getElementById('status');
      const mode = ${JSON.stringify(verificationMode)};
      const query = new URLSearchParams(window.location.search);
      const hash = new URLSearchParams((window.location.hash || '').replace(/^#/, ''));
      const queryToken = ${JSON.stringify(token)} || query.get('token') || '';
      const tokenHash = query.get('token_hash') || '';
      const verifyType = query.get('type') || 'signup';
      const hashAccessToken = hash.get('access_token') || '';
      const urlError = query.get('error_description') || hash.get('error_description') || '';

      if (urlError) {
        statusEl.textContent = urlError;
        statusEl.className = 'error';
        return;
      }

      if (mode === 'supabase') {
        try {
          if (hashAccessToken) {
            localStorage.setItem('ruhverse_auth_token', hashAccessToken);
            statusEl.textContent = 'Email verified successfully. Redirecting to home...';
            setTimeout(() => { window.location.href = '/index.html?verified=1'; }, 1200);
            return;
          }

          if (!tokenHash) {
            if (queryToken) {
              const res = await fetch('/api/auth/verify-email', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ token: queryToken, type: verifyType })
              });
              const data = await res.json().catch(() => ({}));
              if (!res.ok) throw new Error(data.error || 'Could not verify email.');
              if (data.token) {
                localStorage.setItem('ruhverse_auth_token', data.token);
              }
              statusEl.textContent = 'Email verified successfully. Redirecting to home...';
              setTimeout(() => { window.location.href = '/index.html?verified=1'; }, 1200);
              return;
            }
            statusEl.textContent = 'Email confirmed. You can now login on RuhVerse.';
            setTimeout(() => { window.location.href = '/index.html?auth=login&verified=1'; }, 1600);
            return;
          }

          const res = await fetch('/api/auth/verify-email', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tokenHash, type: verifyType })
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(data.error || 'Could not verify email.');

          if (data.token) {
            localStorage.setItem('ruhverse_auth_token', data.token);
          }
          statusEl.textContent = 'Email verified successfully. Redirecting to home...';
          setTimeout(() => { window.location.href = '/index.html?verified=1'; }, 1200);
          return;
        } catch (err) {
          statusEl.textContent = err.message || 'Verification failed.';
          statusEl.className = 'error';
          return;
        }
      }

      if (!queryToken) {
        statusEl.textContent = 'Verification token is missing.';
        statusEl.className = 'error';
        return;
      }

      try {
        const res = await fetch('/api/auth/verify-email', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: queryToken })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'Could not verify email.');

        if (data.token) {
          localStorage.setItem('ruhverse_auth_token', data.token);
        }

        statusEl.textContent = 'Email verified successfully. Redirecting to home...';
        setTimeout(() => { window.location.href = '/index.html?verified=1'; }, 1200);
      } catch (err) {
        statusEl.textContent = err.message || 'Verification failed.';
        statusEl.className = 'error';
      }
    })();
  </script>
</body>
</html>`);
});

// --- Bookmarks + reading progress routes ---
app.get('/api/bookmarks', requireAuth, async (req, res) => {
  if (SUPABASE_ENABLED) {
    try {
      const userId = encodeURIComponent(req.authUser.id);
      const { payload } = await supabaseRestRequest(
        `/bookmarks?select=surah_number,ayah_number,note,created_at&user_id=eq.${userId}&order=created_at.desc`,
        { token: req.authToken }
      );
      const bookmarks = Array.isArray(payload) ? payload.map(mapSupabaseBookmarkRow) : [];
      res.json({ bookmarks });
      return;
    } catch (err) {
      res.status(err?.status || 500).json({ error: String(err?.message || 'Failed to load bookmarks.') });
      return;
    }
  }

  const bookmarks = Array.isArray(req.authUser.bookmarks) ? req.authUser.bookmarks : [];
  const sorted = bookmarks
    .slice()
    .sort((a, b) => String(b.createdAt || b.updatedAt || '').localeCompare(String(a.createdAt || a.updatedAt || '')));

  res.json({ bookmarks: sorted });
});

app.post('/api/bookmarks', requireAuth, async (req, res) => {
  const normalized = normalizeBookmarkInput(req.body);
  if (!normalized) {
    res.status(400).json({ error: 'Provide valid surahNumber and ayahNumber.' });
    return;
  }

  if (SUPABASE_ENABLED) {
    try {
      const { payload } = await supabaseRestRequest('/bookmarks?on_conflict=user_id,surah_number,ayah_number', {
        method: 'POST',
        token: req.authToken,
        headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
        body: [{
          user_id: req.authUser.id,
          surah_number: normalized.surahNumber,
          ayah_number: normalized.ayahNumber,
          note: normalized.note || null
        }]
      });

      const row = Array.isArray(payload) ? payload[0] : null;
      res.status(201).json({
        bookmark: row ? mapSupabaseBookmarkRow(row) : {
          ...normalized,
          createdAt: new Date().toISOString()
        }
      });
      return;
    } catch (err) {
      res.status(err?.status || 500).json({ error: String(err?.message || 'Could not save bookmark.') });
      return;
    }
  }

  const db = req.authDb;
  const user = req.authUser;
  if (!Array.isArray(user.bookmarks)) user.bookmarks = [];

  const nowIso = new Date().toISOString();
  const existingIdx = user.bookmarks.findIndex(
    (x) => x.surahNumber === normalized.surahNumber && x.ayahNumber === normalized.ayahNumber
  );

  if (existingIdx >= 0) {
    user.bookmarks[existingIdx] = {
      ...user.bookmarks[existingIdx],
      ...normalized
    };
  } else {
    user.bookmarks.push({
      ...normalized,
      createdAt: nowIso
    });
  }

  writeAuthDb(db);
  const bookmark = user.bookmarks.find(
    (x) => x.surahNumber === normalized.surahNumber && x.ayahNumber === normalized.ayahNumber
  );
  res.status(201).json({ bookmark });
});

app.delete('/api/bookmarks/:surahNumber/:ayahNumber', requireAuth, async (req, res) => {
  const surahNumber = Number(req.params.surahNumber);
  const ayahNumber = Number(req.params.ayahNumber);
  if (!Number.isInteger(surahNumber) || !Number.isInteger(ayahNumber)) {
    res.status(400).json({ error: 'Invalid bookmark key.' });
    return;
  }

  if (SUPABASE_ENABLED) {
    try {
      const userId = encodeURIComponent(req.authUser.id);
      await supabaseRestRequest(
        `/bookmarks?user_id=eq.${userId}&surah_number=eq.${surahNumber}&ayah_number=eq.${ayahNumber}`,
        {
          method: 'DELETE',
          token: req.authToken
        }
      );
      res.status(204).end();
      return;
    } catch (err) {
      res.status(err?.status || 500).json({ error: String(err?.message || 'Could not delete bookmark.') });
      return;
    }
  }

  const db = req.authDb;
  const user = req.authUser;
  if (!Array.isArray(user.bookmarks)) user.bookmarks = [];
  const before = user.bookmarks.length;
  user.bookmarks = user.bookmarks.filter(
    (x) => !(x.surahNumber === surahNumber && x.ayahNumber === ayahNumber)
  );

  if (user.bookmarks.length !== before) {
    writeAuthDb(db);
  }

  res.status(204).end();
});

app.get('/api/user-progress', requireAuth, async (req, res) => {
  if (SUPABASE_ENABLED) {
    try {
      const userId = encodeURIComponent(req.authUser.id);
      const { payload } = await supabaseRestRequest(
        `/user_progress?select=last_surah,last_ayah,updated_at&user_id=eq.${userId}&limit=1`,
        { token: req.authToken }
      );
      const row = Array.isArray(payload) ? payload[0] : null;
      const progress = row
        ? mapSupabaseProgressRow(row)
        : {
          lastSurah: 1,
          lastAyah: 1,
          updatedAt: req.authUser?.createdAt || new Date().toISOString()
        };
      res.json({ progress });
      return;
    } catch (err) {
      res.status(err?.status || 500).json({ error: String(err?.message || 'Failed to load reading progress.') });
      return;
    }
  }

  const progress = req.authUser?.userProgress || {
    lastSurah: 1,
    lastAyah: 1,
    updatedAt: req.authUser?.createdAt || new Date().toISOString()
  };
  res.json({ progress });
});

app.post('/api/user-progress', requireAuth, async (req, res) => {
  const lastSurah = Number(req.body?.lastSurah);
  const lastAyah = Number(req.body?.lastAyah);
  if (!Number.isInteger(lastSurah) || lastSurah < 1 || lastSurah > 114) {
    res.status(400).json({ error: 'Provide a valid lastSurah (1-114).' });
    return;
  }
  if (!Number.isInteger(lastAyah) || lastAyah < 1 || lastAyah > 286) {
    res.status(400).json({ error: 'Provide a valid lastAyah (1-286).' });
    return;
  }

  if (SUPABASE_ENABLED) {
    try {
      const { payload } = await supabaseRestRequest('/user_progress?on_conflict=user_id', {
        method: 'POST',
        token: req.authToken,
        headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
        body: [{
          user_id: req.authUser.id,
          last_surah: lastSurah,
          last_ayah: lastAyah,
          updated_at: new Date().toISOString()
        }]
      });
      const row = Array.isArray(payload) ? payload[0] : null;
      res.status(201).json({
        progress: row
          ? mapSupabaseProgressRow(row)
          : { lastSurah, lastAyah, updatedAt: new Date().toISOString() }
      });
      return;
    } catch (err) {
      res.status(err?.status || 500).json({ error: String(err?.message || 'Could not save reading progress.') });
      return;
    }
  }

  const db = req.authDb;
  const user = req.authUser;
  user.userProgress = {
    lastSurah,
    lastAyah,
    updatedAt: new Date().toISOString()
  };
  writeAuthDb(db);
  res.status(201).json({ progress: user.userProgress });
});

// --- Sitemap builders and XML routes ---
function getSitemapLastMod() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: IST_TIME_ZONE }).format(new Date());
}

function formatDateForSitemap(date) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: IST_TIME_ZONE }).format(date);
}

function getFileSitemapLastMod(...filePaths) {
  const existingPaths = filePaths.filter((filePath) => filePath && fs.existsSync(filePath));
  if (!existingPaths.length) return getSitemapLastMod();

  let latestMtime = 0;
  existingPaths.forEach((filePath) => {
    try {
      const stat = fs.statSync(filePath);
      if (stat.mtimeMs > latestMtime) latestMtime = stat.mtimeMs;
    } catch (_) {
      // Ignore unreadable files and fall back below.
    }
  });

  return latestMtime ? formatDateForSitemap(new Date(latestMtime)) : getSitemapLastMod();
}

function getLatestSitemapLastMod(entries, fallback = getSitemapLastMod()) {
  const lastmods = entries
    .map((entry) => normalizeWhitespace(entry?.lastmod || ''))
    .filter(Boolean)
    .sort();

  return lastmods.length ? lastmods[lastmods.length - 1] : fallback;
}

function getStaticSitemapUrls() {
  return [
    {
      loc: `${PUBLIC_BASE_URL}/`,
      changefreq: 'weekly',
      priority: '1.0',
      lastmod: getFileSitemapLastMod(path.join(__dirname, 'index.html'), path.join(__dirname, 'style.css'))
    },
    {
      loc: `${PUBLIC_BASE_URL}/quran`,
      changefreq: 'weekly',
      priority: '0.9',
      lastmod: getFileSitemapLastMod(path.join(__dirname, 'quran.html'), path.join(__dirname, 'data', 'surah_profiles.json'))
    },
    {
      loc: `${PUBLIC_BASE_URL}/terms.html`,
      changefreq: 'yearly',
      priority: '0.3',
      lastmod: getFileSitemapLastMod(path.join(__dirname, 'terms.html'))
    },
    {
      loc: `${PUBLIC_BASE_URL}/prayer-times-india.html`,
      changefreq: 'monthly',
      priority: '0.9',
      lastmod: getFileSitemapLastMod(path.join(__dirname, 'prayer-times-india.html'), path.join(__dirname, 'style.css'))
    },
    {
      loc: `${PUBLIC_BASE_URL}/prayer-times-new-delhi.html`,
      changefreq: 'weekly',
      priority: '0.8',
      lastmod: getFileSitemapLastMod(path.join(__dirname, 'prayer-times-new-delhi.html'), path.join(__dirname, 'style.css'))
    },
    {
      loc: `${PUBLIC_BASE_URL}/prayer-times-global.html`,
      changefreq: 'monthly',
      priority: '0.7',
      lastmod: getFileSitemapLastMod(path.join(__dirname, 'prayer-times-global.html'), path.join(__dirname, 'style.css'))
    },
    {
      loc: `${PUBLIC_BASE_URL}/qibla`,
      changefreq: 'weekly',
      priority: '0.8',
      lastmod: getFileSitemapLastMod(path.join(__dirname, 'qibla.html'), path.join(__dirname, 'qibla.js'))
    }
  ];
}

function getBlogSitemapUrls() {
  return [
    {
      loc: `${PUBLIC_BASE_URL}/blog`,
      changefreq: 'weekly',
      priority: '0.7',
      lastmod: getFileSitemapLastMod(resolveBlogFilePath('blog.html'))
    },
    {
      loc: `${PUBLIC_BASE_URL}/why-genz-muslims-losing-faith`,
      changefreq: 'monthly',
      priority: '0.65',
      lastmod: getFileSitemapLastMod(resolveBlogFilePath('why-genz-muslims-losing-faith.html'))
    },
    {
      loc: `${PUBLIC_BASE_URL}/how-to-pray-eid-salah`,
      changefreq: 'monthly',
      priority: '0.68',
      lastmod: getFileSitemapLastMod(resolveBlogFilePath('how-to-pray-eid-salah.html'))
    },
    {
      loc: `${PUBLIC_BASE_URL}/is-trading-halal`,
      changefreq: 'monthly',
      priority: '0.66',
      lastmod: getFileSitemapLastMod(resolveBlogFilePath('is-trading-halal.html'))
    },
    {
      loc: `${PUBLIC_BASE_URL}/is-music-haram`,
      changefreq: 'monthly',
      priority: '0.66',
      lastmod: getFileSitemapLastMod(resolveBlogFilePath('is-music-haram.html'))
    },
    {
      loc: `${PUBLIC_BASE_URL}/is-ai-haram`,
      changefreq: 'monthly',
      priority: '0.66',
      lastmod: getFileSitemapLastMod(resolveBlogFilePath('is-ai-haram.html'))
    },
    {
      loc: `${PUBLIC_BASE_URL}/why-girlfriend-boyfriend-is-haram-in-islam`,
      changefreq: 'monthly',
      priority: '0.66',
      lastmod: getFileSitemapLastMod(resolveBlogFilePath('why-girlfriend-boyfriend-is-haram-in-islam.html'))
    },
    {
      loc: `${PUBLIC_BASE_URL}/why-prophet-marry-aisha`,
      changefreq: 'monthly',
      priority: '0.67',
      lastmod: getFileSitemapLastMod(resolveBlogFilePath('Why-Prophet-marry-aisha.html'))
    },
    {
      loc: `${PUBLIC_BASE_URL}/what-islam-says-about-anxiety-depression`,
      changefreq: 'monthly',
      priority: '0.67',
      lastmod: getFileSitemapLastMod(resolveBlogFilePath('anxiety-depression.html'))
    },
    {
      loc: `${PUBLIC_BASE_URL}/is-birthday-haram`,
      changefreq: 'monthly',
      priority: '0.66',
      lastmod: getFileSitemapLastMod(resolveBlogFilePath('Is-Birthday-Haram.html'))
    },
    {
      loc: `${PUBLIC_BASE_URL}/why-feel-guilty-after-tawbah`,
      changefreq: 'monthly',
      priority: '0.67',
      lastmod: getFileSitemapLastMod(resolveBlogFilePath('why-feel-guilty.html'))
    },
    {
      loc: `${PUBLIC_BASE_URL}/spiritually-empty-after-ramadan-ends`,
      changefreq: 'monthly',
      priority: '0.66',
      lastmod: getFileSitemapLastMod(resolveBlogFilePath('why-feel-empty.html'))
    },
    {
      loc: `${PUBLIC_BASE_URL}/why-i-feel-nothing-praying-reading-quran`,
      changefreq: 'monthly',
      priority: '0.68',
      lastmod: getFileSitemapLastMod(resolveBlogFilePath('Feeling-numb-deen.html'))
    },
    {
      loc: `${PUBLIC_BASE_URL}/ibadah-burnout-recognizing-and-recovering`,
      changefreq: 'monthly',
      priority: '0.67',
      lastmod: getFileSitemapLastMod(resolveBlogFilePath('burnt-out-worshipping.html'))
    },
    {
      loc: `${PUBLIC_BASE_URL}/ibadah-burnout-warning-signs`,
      changefreq: 'monthly',
      priority: '0.67',
      lastmod: getFileSitemapLastMod(resolveBlogFilePath('ibadah-burnout-warning-signs.html'))
    },
    {
      loc: `${PUBLIC_BASE_URL}/committing-sins`,
      changefreq: 'monthly',
      priority: '0.67',
      lastmod: getFileSitemapLastMod(resolveBlogFilePath('committing-sins.html'))
    },
    {
      loc: `${PUBLIC_BASE_URL}/is-it-haram-to-feel-angry-at-allah`,
      changefreq: 'monthly',
      priority: '0.67',
      lastmod: getFileSitemapLastMod(resolveBlogFilePath('angryA-haram.html'))
    },
    {
      loc: `${PUBLIC_BASE_URL}/instrutive-thoughts`,
      changefreq: 'monthly',
      priority: '0.67',
      lastmod: getFileSitemapLastMod(resolveBlogFilePath('instrutive-thoughts.html'))
    },
    {
      loc: `${PUBLIC_BASE_URL}/missing-fajr`,
      changefreq: 'monthly',
      priority: '0.67',
      lastmod: getFileSitemapLastMod(resolveBlogFilePath('missing-fajr.html'))
    },
    {
      loc: `${PUBLIC_BASE_URL}/how-to-forgive-someone-in-islam`,
      changefreq: 'monthly',
      priority: '0.67',
      lastmod: getFileSitemapLastMod(resolveBlogFilePath('forgive-someone.html'))
    }
  ];
}

function getCitySitemapUrls() {
  return Object.values(cityProfiles).map((city) => ({
    loc: `${PUBLIC_BASE_URL}/namaz-times/${city.slug}`,
    changefreq: 'daily',
    priority: '0.85',
    lastmod: getFileSitemapLastMod(
      path.join(__dirname, 'prayer-times-city.html'),
      CITY_PROFILES_PATH,
      WORLD_CITY_SEED_PATH,
      path.join(__dirname, 'data', 'ramadan_2026.json'),
      path.join(__dirname, 'data', 'ramadan_2026.js')
    )
  }));
}

function buildSitemapUrlset(urls, lastmod) {
  const body = urls.map((entry) => `
  <url>
    <loc>${escapeHtml(entry.loc)}</loc>
    <lastmod>${entry.lastmod || lastmod}</lastmod>
    <changefreq>${entry.changefreq}</changefreq>
    <priority>${entry.priority}</priority>
  </url>`).join('');

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${body}
</urlset>`;
}

function buildSitemapIndex(entries, lastmod) {
  const body = entries.map((entry) => `
  <sitemap>
    <loc>${escapeHtml(entry.loc)}</loc>
    <lastmod>${entry.lastmod || lastmod}</lastmod>
  </sitemap>`).join('');

  return `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${body}
</sitemapindex>`;
}

function resolveBlogFilePath(fileName) {
  const preferred = path.join(BLOGS_DIR, fileName);
  if (fs.existsSync(preferred)) return preferred;

  // Legacy fallback for older layouts where blog files lived in project root.
  const legacy = path.join(__dirname, fileName);
  if (fs.existsSync(legacy)) return legacy;

  return null;
}

function sendBlogPage(res, fileName) {
  const filePath = resolveBlogFilePath(fileName);
  if (!filePath) {
    res.status(404).send('Blog page not found.');
    return;
  }
  res.sendFile(filePath);
}

async function getCoreSitemapUrls() {
  const staticUrls = getStaticSitemapUrls();
  try {
    const data = await getQuranData();
    const surahUrls = data.quranArabic.map((surah) => ({
      loc: `${PUBLIC_BASE_URL}${buildSurahPath(surah)}`,
      changefreq: 'monthly',
      priority: '0.8'
    }));
    return staticUrls.concat(surahUrls);
  } catch (_) {
    const surahUrls = Array.from({ length: 114 }, (_, idx) => idx + 1).map((num) => ({
      loc: `${PUBLIC_BASE_URL}${getFallbackSurahCanonicalPath(num)}`,
      changefreq: 'monthly',
      priority: '0.8',
      lastmod: getFileSitemapLastMod(path.join(__dirname, 'quran.html'), SURAH_PROFILES_PATH)
    }));
    return staticUrls.concat(surahUrls);
  }
}

app.get('/sitemap-core.xml', async (req, res) => {
  const fallbackLastmod = getSitemapLastMod();
  try {
    const urls = await getCoreSitemapUrls();
    res.set('Content-Type', 'application/xml; charset=utf-8');
    res.set('Cache-Control', 'public, max-age=3600, stale-while-revalidate=86400');
    res.send(buildSitemapUrlset(urls, getLatestSitemapLastMod(urls, fallbackLastmod)));
  } catch (_) {
    res.set('Content-Type', 'application/xml; charset=utf-8');
    res.set('Cache-Control', 'public, max-age=3600, stale-while-revalidate=86400');
    const fallbackUrls = getStaticSitemapUrls();
    res.send(buildSitemapUrlset(fallbackUrls, getLatestSitemapLastMod(fallbackUrls, fallbackLastmod)));
  }
});

app.get('/sitemap-blogs.xml', (req, res) => {
  const urls = getBlogSitemapUrls();
  res.set('Content-Type', 'application/xml; charset=utf-8');
  res.set('Cache-Control', 'public, max-age=3600, stale-while-revalidate=86400');
  res.send(buildSitemapUrlset(urls, getLatestSitemapLastMod(urls)));
});

app.get('/sitemap-cities-:chunk(\\d+).xml', (req, res) => {
  const fallbackLastmod = getSitemapLastMod();
  const chunkIndex = Math.max(0, Number(req.params.chunk) || 0);
  const cityUrls = getCitySitemapUrls();
  const start = chunkIndex * SITEMAP_CITY_CHUNK_SIZE;
  const chunkUrls = cityUrls.slice(start, start + SITEMAP_CITY_CHUNK_SIZE);

  if (!chunkUrls.length) {
    res.status(404).set('Content-Type', 'application/xml; charset=utf-8');
    res.set('Cache-Control', 'public, max-age=3600, stale-while-revalidate=86400');
    res.send(buildSitemapUrlset([], fallbackLastmod));
    return;
  }

  res.set('Content-Type', 'application/xml; charset=utf-8');
  res.set('Cache-Control', 'public, max-age=3600, stale-while-revalidate=86400');
  res.send(buildSitemapUrlset(chunkUrls, getLatestSitemapLastMod(chunkUrls, fallbackLastmod)));
});

app.get('/sitemap.xml', async (req, res) => {
  const fallbackLastmod = getSitemapLastMod();
  let coreUrls;
  try {
    coreUrls = await getCoreSitemapUrls();
  } catch (_) {
    coreUrls = getStaticSitemapUrls();
  }
  const blogUrls = getBlogSitemapUrls();
  const cityUrls = getCitySitemapUrls();
  const entries = [
    {
      loc: `${PUBLIC_BASE_URL}/sitemap-core.xml`,
      lastmod: getLatestSitemapLastMod(coreUrls, fallbackLastmod)
    },
    {
      loc: `${PUBLIC_BASE_URL}/sitemap-blogs.xml`,
      lastmod: getLatestSitemapLastMod(blogUrls, fallbackLastmod)
    }
  ];

  if (cityUrls.length) {
    const cityChunkCount = Math.ceil(cityUrls.length / SITEMAP_CITY_CHUNK_SIZE);
    for (let i = 0; i < cityChunkCount; i += 1) {
      const start = i * SITEMAP_CITY_CHUNK_SIZE;
      const chunkUrls = cityUrls.slice(start, start + SITEMAP_CITY_CHUNK_SIZE);
      entries.push({
        loc: `${PUBLIC_BASE_URL}/sitemap-cities-${i}.xml`,
        lastmod: getLatestSitemapLastMod(chunkUrls, fallbackLastmod)
      });
    }
  }

  res.set('Content-Type', 'application/xml; charset=utf-8');
  res.set('Cache-Control', 'public, max-age=3600, stale-while-revalidate=86400');
  res.send(buildSitemapIndex(entries, getLatestSitemapLastMod(entries, fallbackLastmod)));
});

function pathIsCanonical(reqPath, canonicalPath) {
  const sourceRaw = `/${String(reqPath || '').replace(/^\/+/, '')}`.toLowerCase();
  const source = sourceRaw === '/' ? '/' : sourceRaw.replace(/\/{2,}/g, '/');
  const target = `/${String(canonicalPath || '').replace(/^\/+/, '')}`.replace(/\/+$/, '').toLowerCase() || '/';
  return source === target;
}

function redirectToCanonicalIfNeeded(req, res, canonicalPath) {
  if (!pathIsCanonical(req.path, canonicalPath)) {
    res.redirect(301, canonicalPath);
    return true;
  }
  return false;
}

// --- Public page routes + canonical redirects ---
app.get(['/blog', '/blog.html'], (req, res) => {
  if (redirectToCanonicalIfNeeded(req, res, '/blog')) return;
  sendBlogPage(res, 'blog.html');
});

app.get(['/why-genz-muslims-losing-faith', '/why-genz-muslims-losing-faith.html'], (req, res) => {
  if (redirectToCanonicalIfNeeded(req, res, '/why-genz-muslims-losing-faith')) return;
  sendBlogPage(res, 'why-genz-muslims-losing-faith.html');
});

app.get(['/how-to-pray-eid-salah', '/how-to-pray-eid-salah.html'], (req, res) => {
  if (redirectToCanonicalIfNeeded(req, res, '/how-to-pray-eid-salah')) return;
  sendBlogPage(res, 'how-to-pray-eid-salah.html');
});

app.get(['/is-trading-halal', '/is-trading-halal.html'], (req, res) => {
  if (redirectToCanonicalIfNeeded(req, res, '/is-trading-halal')) return;
  sendBlogPage(res, 'is-trading-halal.html');
});

app.get(['/is-music-haram', '/is-music-haram.html'], (req, res) => {
  if (redirectToCanonicalIfNeeded(req, res, '/is-music-haram')) return;
  sendBlogPage(res, 'is-music-haram.html');
});

app.get(['/is-ai-haram', '/is-ai-haram.html'], (req, res) => {
  if (redirectToCanonicalIfNeeded(req, res, '/is-ai-haram')) return;
  sendBlogPage(res, 'is-ai-haram.html');
});

app.get(['/why-girlfriend-boyfriend-is-haram-in-islam', '/why-girlfriend-boyfriend-is-haram-in-islam.html'], (req, res) => {
  if (redirectToCanonicalIfNeeded(req, res, '/why-girlfriend-boyfriend-is-haram-in-islam')) return;
  sendBlogPage(res, 'why-girlfriend-boyfriend-is-haram-in-islam.html');
});

app.get([
  '/why-prophet-marry-aisha',
  '/why-prophet-marry-aisha/',
  '/why-prophet-marry-aisha.html',
  '/Why-Prophet-marry-aisha',
  '/Why-Prophet-marry-aisha.html'
], (req, res) => {
  if (redirectToCanonicalIfNeeded(req, res, '/why-prophet-marry-aisha')) return;
  sendBlogPage(res, 'Why-Prophet-marry-aisha.html');
});

app.get([
  '/what-islam-says-about-anxiety-depression',
  '/what-islam-says-about-anxiety-depression/',
  '/what-islam-says-about-anxiety-depression.html',
  '/what-islam-really-says-about-anxiety-depression',
  '/what-islam-really-says-about-anxiety-depression/',
  '/what-islam-really-says-about-anxiety-depression.html',
  '/anxiety-depression',
  '/anxiety-depression.html'
], (req, res) => {
  if (redirectToCanonicalIfNeeded(req, res, '/what-islam-says-about-anxiety-depression')) return;
  sendBlogPage(res, 'anxiety-depression.html');
});

app.get([
  '/why-prophet-married-aisha',
  '/why-prophet-married-aisha/',
  '/why-prophet-married-aisha.html'
], (req, res) => {
  if (redirectToCanonicalIfNeeded(req, res, '/why-prophet-marry-aisha')) return;
  sendBlogPage(res, 'Why-Prophet-marry-aisha.html');
});

app.get([
  '/is-birthday-haram',
  '/is-birthday-haram/',
  '/is-birthday-haram.html',
  '/Is-Birthday-Haram',
  '/Is-Birthday-Haram.html'
], (req, res) => {
  if (redirectToCanonicalIfNeeded(req, res, '/is-birthday-haram')) return;
  sendBlogPage(res, 'Is-Birthday-Haram.html');
});

app.get([
  '/why-feel-guilty-after-tawbah',
  '/why-feel-guilty-after-tawbah/',
  '/why-feel-guilty-after-tawbah.html',
  '/why-feel-guilty',
  '/why-feel-guilty/',
  '/why-feel-guilty.html'
], (req, res) => {
  if (redirectToCanonicalIfNeeded(req, res, '/why-feel-guilty-after-tawbah')) return;
  sendBlogPage(res, 'why-feel-guilty.html');
});

app.get([
  '/spiritually-empty-after-ramadan-ends',
  '/spiritually-empty-after-ramadan-ends/',
  '/spiritually-empty-after-ramadan-ends.html',
  '/why-feel-empty',
  '/why-feel-empty/',
  '/why-feel-empty.html'
], (req, res) => {
  if (redirectToCanonicalIfNeeded(req, res, '/spiritually-empty-after-ramadan-ends')) return;
  sendBlogPage(res, 'why-feel-empty.html');
});

app.get([
  '/why-i-feel-nothing-praying-reading-quran',
  '/why-i-feel-nothing-praying-reading-quran/',
  '/why-i-feel-nothing-praying-reading-quran.html',
  '/Feeling-numb-deen',
  '/Feeling-numb-deen/',
  '/Feeling-numb-deen.html'
], (req, res) => {
  if (redirectToCanonicalIfNeeded(req, res, '/why-i-feel-nothing-praying-reading-quran')) return;
  sendBlogPage(res, 'Feeling-numb-deen.html');
});

app.get([
  '/is-it-haram-to-feel-angry-at-allah',
  '/is-it-haram-to-feel-angry-at-allah/',
  '/is-it-haram-to-feel-angry-at-allah.html',
  '/angryA-haram',
  '/angryA-haram/',
  '/angryA-haram.html'
], (req, res) => {
  if (redirectToCanonicalIfNeeded(req, res, '/is-it-haram-to-feel-angry-at-allah')) return;
  sendBlogPage(res, 'angryA-haram.html');
});

app.get([
  '/instrutive-thoughts',
  '/instrutive-thoughts/',
  '/instrutive-thoughts.html'
], (req, res) => {
  if (redirectToCanonicalIfNeeded(req, res, '/instrutive-thoughts')) return;
  sendBlogPage(res, 'instrutive-thoughts.html');
});

app.get([
  '/ibadah-burnout-recognizing-and-recovering',
  '/ibadah-burnout-recognizing-and-recovering/',
  '/ibadah-burnout-recognizing-and-recovering.html',
  '/burnt-out-worshipping',
  '/burnt-out-worshipping/',
  '/burnt-out-worshipping.html'
], (req, res) => {
  if (redirectToCanonicalIfNeeded(req, res, '/ibadah-burnout-recognizing-and-recovering')) return;
  sendBlogPage(res, 'burnt-out-worshipping.html');
});

app.get([
  '/ibadah-burnout-warning-signs',
  '/ibadah-burnout-warning-signs/',
  '/ibadah-burnout-warning-signs.html'
], (req, res) => {
  if (redirectToCanonicalIfNeeded(req, res, '/ibadah-burnout-warning-signs')) return;
  sendBlogPage(res, 'ibadah-burnout-warning-signs.html');
});

app.get([
  '/committing-sins',
  '/committing-sins/',
  '/committing-sins.html'
], (req, res) => {
  if (redirectToCanonicalIfNeeded(req, res, '/committing-sins')) return;
  sendBlogPage(res, 'committing-sins.html');
});

app.get([
  '/missing-fajr',
  '/missing-fajr/',
  '/missing-fajr.html'
], (req, res) => {
  if (redirectToCanonicalIfNeeded(req, res, '/missing-fajr')) return;
  sendBlogPage(res, 'missing-fajr.html');
});

app.get([
  '/how-to-forgive-someone-in-islam',
  '/how-to-forgive-someone-in-islam/',
  '/how-to-forgive-someone-in-islam.html',
  '/forgive-someone',
  '/forgive-someone/',
  '/forgive-someone.html',
  '/how-to-forgive-someone',
  '/how-to-forgive-someone/',
  '/how-to-forgive-someone.html'
], (req, res) => {
  if (redirectToCanonicalIfNeeded(req, res, '/how-to-forgive-someone-in-islam')) return;
  sendBlogPage(res, 'forgive-someone.html');
});

app.get('/prayer-times-city.html', (req, res) => {
  res.redirect(301, '/prayer-times-india.html');
});

app.get(['/prayer-times-india', '/prayer-times-india/'], (req, res) => {
  res.redirect(301, '/prayer-times-india.html');
});

app.get(['/prayer-times-new-delhi', '/prayer-times-new-delhi/'], (req, res) => {
  res.redirect(301, '/prayer-times-new-delhi.html');
});

app.get(['/prayer-times-global', '/prayer-times-global/'], (req, res) => {
  res.redirect(301, '/prayer-times-global.html');
});

app.get(['/terms', '/terms/'], (req, res) => {
  res.redirect(301, '/terms.html');
});

app.get('/index.html', (req, res) => {
  res.redirect(301, '/');
});

app.get(['/qibla.html', '/qibla/'], (req, res) => {
  res.redirect(301, '/qibla');
});

app.get(['/quran.html', '/quran'], async (req, res) => {
  try {
    const data = await getQuranData();
    res.redirect(301, buildSurahPath(data.quranArabic[0]));
  } catch (_) {
    res.redirect(301, getFallbackSurahCanonicalPath(1));
  }
});

app.get('/quran/surah/:surahNumber(\\d+)', async (req, res) => {
  const surahNumber = Number(req.params.surahNumber);
  if (surahNumber < 1 || surahNumber > 114) {
    res.status(404).send('Surah not found');
    return;
  }

  try {
    const data = await getQuranData();
    const surah = data.quranArabic[surahNumber - 1];
    res.redirect(301, buildSurahPath(surah));
  } catch (_) {
    const index = surahNumber - 1;
    await serveQuranPage(req, res, index, getFallbackSurahCanonicalPath(surahNumber));
  }
});

// Compatibility redirects for stale relative links from older templates.
app.get('/quran/:surahSlug/index.html', (req, res) => {
  res.redirect(301, '/index.html');
});

app.get('/quran/:surahSlug/:surahNumber/index.html', async (req, res) => {
  const surahNumber = Number(req.params.surahNumber);
  if (Number.isInteger(surahNumber) && surahNumber >= 1 && surahNumber <= 114) {
    try {
      const data = await getQuranData();
      const surah = data.quranArabic[surahNumber - 1];
      res.redirect(301, buildSurahPath(surah));
      return;
    } catch (_) {
      // Fall through to home if canonical path lookup fails.
    }
  }
  res.redirect(301, '/index.html');
});

app.get('/quran/:surahSlug/:surahNumber(\\d+)', async (req, res) => {
  const surahNumber = Number(req.params.surahNumber);
  if (surahNumber < 1 || surahNumber > 114) {
    res.status(404).send('Surah not found');
    return;
  }

  try {
    const data = await getQuranData();
    const surah = data.quranArabic[surahNumber - 1];
    const canonicalPath = buildSurahPath(surah);
    const normalizedReqPath = req.path.replace(/\/+$/, '').toLowerCase();
    const normalizedCanonicalPath = canonicalPath.toLowerCase();

    if (normalizedReqPath !== normalizedCanonicalPath) {
      res.redirect(301, canonicalPath);
      return;
    }

    await serveQuranPage(req, res, surahNumber - 1, canonicalPath);
  } catch (_) {
    await serveQuranPage(req, res, surahNumber - 1, getFallbackSurahCanonicalPath(surahNumber));
  }
});

// -- City Prayer Times SSR -------------------------------------------------

function getTodayIstIsoDate() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: IST_TIME_ZONE }).format(new Date());
}

function extractTimeHHMM(rawValue) {
  const match = String(rawValue || '').match(/(\d{1,2}):(\d{2})/);
  if (!match) return '';
  return `${String(Number(match[1])).padStart(2, '0')}:${match[2]}`;
}

function formatTime12h(rawValue) {
  const normalized = extractTimeHHMM(rawValue);
  if (!normalized) return '';
  const [h, m] = normalized.split(':').map(Number);
  return `${String(h % 12 || 12).padStart(2, '0')}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
}

async function getCityPrayerTimes(slug, latitude, longitude, method) {
  const now = Date.now();
  const cached = cityPrayerCache.get(slug);
  if (cached && (now - cached.time) < CITY_PRAYER_CACHE_TTL_MS) {
    return cached.data;
  }

  const today = getTodayIstIsoDate();
  const unixTs = Math.floor(Date.now() / 1000);
  const endpointCandidates = [
    `https://api.aladhan.com/v1/timings/${unixTs}?latitude=${latitude}&longitude=${longitude}&method=${method || 1}`,
    `https://api.aladhan.com/v1/timingsByCity?city=${encodeURIComponent(slug)}&country=&method=${method || 1}`
  ];

  let apiTimings = null;
  let lastError = null;
  for (const url of endpointCandidates) {
    try {
      const response = await fetch(url, { headers: { Accept: 'application/json' } });
      if (!response.ok) throw new Error(`AlAdhan API failed: ${response.status}`);
      const payload = await response.json();
      if (payload?.code === 200 && payload?.data?.timings) {
        apiTimings = payload.data.timings;
        break;
      }
      throw new Error('AlAdhan payload missing timings');
    } catch (err) {
      lastError = err;
    }
  }

  if (!apiTimings) {
    throw lastError || new Error('Unable to fetch prayer timings');
  }

  const timings = ['Fajr', 'Dhuhr', 'Asr', 'Maghrib', 'Isha'].reduce((acc, prayer) => {
    acc[prayer] = extractTimeHHMM(apiTimings[prayer] || '');
    return acc;
  }, {});
  const result = { timings, date: today };
  cityPrayerCache.set(slug, { data: result, time: Date.now() });
  return result;
}

function geoDistanceMeters(lat1, lon1, lat2, lon2) {
  const earthRadius = 6371000;
  const toRadians = (value) => (Number(value) * Math.PI) / 180;
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2))
    * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return earthRadius * c;
}

function getOverpassElementPoint(item) {
  if (typeof item?.lat === 'number' && typeof item?.lon === 'number') {
    return { lat: item.lat, lon: item.lon };
  }
  if (typeof item?.center?.lat === 'number' && typeof item?.center?.lon === 'number') {
    return { lat: item.center.lat, lon: item.center.lon };
  }
  return null;
}

function buildFallbackPopularMosques(cityProfile) {
  const cityName = normalizeWhitespace(cityProfile?.name || 'City');
  const countryName = normalizeWhitespace(cityProfile?.country || '');
  const landmark = normalizeWhitespace(cityProfile?.famousLandmark || '');
  const names = [];

  if (landmark && /mosque|masjid|jamia|jami|jame|mosquee|camii|masjid/i.test(landmark)) {
    names.push(landmark);
  }

  names.push(
    `${cityName} Grand Mosque`,
    `${cityName} Central Mosque`,
    `${cityName} Juma Masjid`,
    `${cityName} Jama Masjid`,
    `${cityName} Main Mosque`,
    `${cityName} Islamic Center Mosque`
  );

  if (countryName) names.push(`${countryName} National Mosque (${cityName})`);

  const dedup = new Set();
  const result = [];
  names.forEach((name) => {
    const normalized = normalizeWhitespace(name);
    if (!normalized) return;
    const key = normalized.toLowerCase();
    if (dedup.has(key)) return;
    dedup.add(key);
    result.push(normalized);
  });
  return result.slice(0, CITY_POPULAR_MOSQUES_LIMIT);
}

async function fetchPopularMosquesFromOverpass(cityProfile) {
  const lat = Number(cityProfile?.latitude);
  const lon = Number(cityProfile?.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return [];

  const query = `
[out:json][timeout:25];
(
  node(around:${CITY_POPULAR_MOSQUES_RADIUS_METERS},${lat},${lon})["amenity"="place_of_worship"]["religion"="muslim"];
  way(around:${CITY_POPULAR_MOSQUES_RADIUS_METERS},${lat},${lon})["amenity"="place_of_worship"]["religion"="muslim"];
  relation(around:${CITY_POPULAR_MOSQUES_RADIUS_METERS},${lat},${lon})["amenity"="place_of_worship"]["religion"="muslim"];
  node(around:${CITY_POPULAR_MOSQUES_RADIUS_METERS},${lat},${lon})["amenity"="mosque"];
  way(around:${CITY_POPULAR_MOSQUES_RADIUS_METERS},${lat},${lon})["amenity"="mosque"];
  relation(around:${CITY_POPULAR_MOSQUES_RADIUS_METERS},${lat},${lon})["amenity"="mosque"];
);
out center tags;
`;

  let lastError = null;
  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
        body: `data=${encodeURIComponent(query)}`
      });
      if (!response.ok) throw new Error(`Overpass request failed: ${response.status}`);

      const payload = await response.json();
      const elements = Array.isArray(payload?.elements) ? payload.elements : [];
      const dedup = new Map();

      elements.forEach((item) => {
        const rawName = normalizeWhitespace(item?.tags?.name || '');
        if (!rawName) return;
        const point = getOverpassElementPoint(item);
        if (!point) return;

        const distance = geoDistanceMeters(lat, lon, point.lat, point.lon);
        if (!Number.isFinite(distance) || distance > CITY_POPULAR_MOSQUES_RADIUS_METERS) return;
        const key = rawName.toLowerCase();
        if (dedup.has(key)) return;

        dedup.set(key, { name: rawName, distance });
      });

      return Array.from(dedup.values())
        .sort((a, b) => a.distance - b.distance || a.name.localeCompare(b.name))
        .map((item) => item.name)
        .slice(0, CITY_POPULAR_MOSQUES_LIMIT);
    } catch (err) {
      lastError = err;
    }
  }

  if (lastError) throw lastError;
  return [];
}

async function getCityPopularMosques(cityProfile) {
  const slug = normalizeWhitespace(cityProfile?.slug || '');
  if (!slug) return buildFallbackPopularMosques(cityProfile);

  const now = Date.now();
  const cached = cityPopularMosquesCache.get(slug);
  if (cached && (now - cached.time) < CITY_POPULAR_MOSQUES_CACHE_TTL_MS) {
    return cached.data;
  }

  let names = [];
  try {
    names = await fetchPopularMosquesFromOverpass(cityProfile);
  } catch (err) {
    console.warn(`Popular mosques fetch failed for ${slug}:`, err.message);
  }

  if (!Array.isArray(names) || !names.length) {
    names = buildFallbackPopularMosques(cityProfile);
  }

  if (names.length < 4) {
    const fallback = buildFallbackPopularMosques(cityProfile);
    const seen = new Set(names.map((x) => normalizeWhitespace(x).toLowerCase()));
    fallback.forEach((name) => {
      const key = normalizeWhitespace(name).toLowerCase();
      if (!key || seen.has(key)) return;
      seen.add(key);
      names.push(name);
    });
  }

  const finalNames = names.slice(0, CITY_POPULAR_MOSQUES_LIMIT);
  cityPopularMosquesCache.set(slug, { data: finalNames, time: Date.now() });
  return finalNames;
}

function renderPopularMosqueItemsHtml(mosques) {
  if (!Array.isArray(mosques) || !mosques.length) {
    return '<li>Popular mosque names will be updated shortly.</li>';
  }
  return mosques
    .map((name) => `<li>${escapeHtml(name)}</li>`)
    .join('');
}

function buildCityStructuredData(cityProfile) {
  const faqEntities = (cityProfile.faqItems || []).map(item => ({
    '@type': 'Question',
    name: item.q,
    acceptedAnswer: { '@type': 'Answer', text: item.a }
  }));

  const citySlug = cityProfile.slug;
  const canonical = `${PUBLIC_BASE_URL}/namaz-times/${citySlug}`;

  const faqSchema = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faqEntities
  };

  const articleSchema = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: `Namaz Timings in ${cityProfile.name}, ${cityProfile.country || 'India'} Today | Fajr, Zohr, Asr, Magrib, Isha | RuhVerse`,
    description: `Accurate daily Namaz timings in ${cityProfile.name}, ${cityProfile.country || 'India'} with Fajr, Zohr, Asr, Magrib, and Isha times.`,
    url: canonical,
    image: [`${PUBLIC_BASE_URL}/assets/RuhVerse.jpg`],
    author: { '@type': 'Organization', name: 'RuhVerse' },
    publisher: {
      '@type': 'Organization',
      name: 'RuhVerse',
      logo: { '@type': 'ImageObject', url: `${PUBLIC_BASE_URL}/assets/RuhVerse.jpg` }
    },
    mainEntityOfPage: canonical,
    inLanguage: 'en'
  };

  return [
    `<script type="application/ld+json">${JSON.stringify(faqSchema)}</script>`,
    `<script type="application/ld+json">${JSON.stringify(articleSchema)}</script>`
  ].join('\n');
}

function renderPrayerCardsHtml(timings) {
  const prayers = ['Fajr', 'Dhuhr', 'Asr', 'Maghrib', 'Isha'];
  const prayerLabels = { Fajr: 'Fajr', Dhuhr: 'Zohr', Asr: 'Asr', Maghrib: 'Magrib', Isha: 'Isha' };
  return prayers.map(name => {
    const displayTime = formatTime12h(timings[name] || '') || '--';
    return `<div class="prayer-card"><h4>${escapeHtml(prayerLabels[name] || name)}</h4><span>${escapeHtml(displayTime)}</span></div>`;
  }).join('');
}

function renderCityFactsHtml(facts) {
  const icons = ['Prayer', 'Heritage', 'Ramadan', 'Moon', 'Insight'];
  return (facts || []).map((fact, i) => `
    <div class="city-fact-card">
      <span class="city-fact-icon">${icons[i % icons.length]}</span>
      <p>${escapeHtml(fact)}</p>
    </div>
  `).join('');
}

function renderCityFaqHtml(faqItems) {
  return (faqItems || []).map(item => `
    <div class="faq-item">
      <h3>${escapeHtml(item.q)}</h3>
      <p>${escapeHtml(item.a)}</p>
    </div>
  `).join('');
}

function getRelatedCityProfiles(cityProfile, limit = 8) {
  const sameCountry = normalizeWhitespace(cityProfile.country || '').toLowerCase();
  const sameState = normalizeWhitespace(cityProfile.state || '').toLowerCase();
  const allCities = Object.values(cityProfiles).filter((city) => city && city.slug && city.slug !== cityProfile.slug);

  const ranked = allCities.map((city) => {
    let score = 0;
    const cityCountry = normalizeWhitespace(city.country || '').toLowerCase();
    const cityState = normalizeWhitespace(city.state || '').toLowerCase();
    if (sameCountry && cityCountry === sameCountry) score += 100;
    if (sameState && cityState && cityState === sameState) score += 25;
    if (Array.isArray(city.aliases) && city.aliases.length) score += 3;
    if (normalizeWhitespace(city.muslimPopulation || '')) score += 2;
    return { city, score };
  });

  ranked.sort((a, b) => b.score - a.score || String(a.city.name || '').localeCompare(String(b.city.name || '')));
  return ranked.slice(0, limit).map((item) => item.city);
}

function renderRelatedCityLinksHtml(cityProfile) {
  const related = getRelatedCityProfiles(cityProfile, 8);
  if (!related.length) {
    return `
      <a href="/prayer-times-global.html" class="related-city-link">
        <h4>Explore Worldwide Cities</h4>
        <p>Browse global prayer-time hubs and find your next city.</p>
        <small>Global Directory</small>
      </a>
    `;
  }

  return related.map((city) => {
    const region = [city.state, city.country].filter(Boolean).join(', ');
    const snippet = truncateForMeta(city.famousLandmark || city.insights || `Namaz timings in ${city.name}.`, 92);
    return `
      <a href="/namaz-times/${encodeURIComponent(city.slug)}" class="related-city-link">
        <h4>${escapeHtml(city.name)}</h4>
        <p>${escapeHtml(snippet)}</p>
        <small>${escapeHtml(region)}</small>
      </a>
    `;
  }).join('');
}

function renderRamadanNoteHtml(note) {
  if (!note) return '';
  return `
    <div class="ramadan-note-banner">
      <span class="ramadan-icon">Ramadan</span>
      <div>
        <h4>Ramadan in This City</h4>
        <p>${escapeHtml(note)}</p>
      </div>
    </div>
  `;
}

function renderCityPage(template, cityProfile, prayerData, popularMosques) {
  const { timings, date } = prayerData;
  const citySlug = cityProfile.slug;
  const canonical = `${PUBLIC_BASE_URL}/namaz-times/${citySlug}`;
  const ogImage = `${PUBLIC_BASE_URL}/assets/RuhVerse.jpg`;
  const countryName = cityProfile.country || 'India';
  const regionName = [cityProfile.state, countryName].filter(Boolean).join(', ');
  const cityCountryLabel = `${cityProfile.name}, ${countryName}`;

  const fajrDisplay = formatTime12h(timings['Fajr'] || '') || '--';
  const zohrDisplay = formatTime12h(timings['Dhuhr'] || '') || '--';
  const asrDisplay = formatTime12h(timings['Asr'] || '') || '--';
  const maghribDisplay = formatTime12h(timings['Maghrib'] || '') || '--';
  const ishaDisplay = formatTime12h(timings['Isha'] || '') || '--';

  const pageTitle = `Today's Prayer Times in ${cityCountryLabel} | Fajr, Dhuhr, Asr, Maghrib, Isha | RuhVerse`;
  const pageDescription = truncateForMeta(
    `Check today's prayer times in ${cityCountryLabel}: Fajr ${fajrDisplay}, Dhuhr ${zohrDisplay}, Asr ${asrDisplay}, Maghrib ${maghribDisplay}, Isha ${ishaDisplay}. Includes Ramadan schedule and nearby mosque guidance.`,
    160
  );
  const aliasTerms = Array.isArray(cityProfile.aliases)
    ? cityProfile.aliases.map((x) => normalizeWhitespace(x)).filter(Boolean).slice(0, 8)
    : [];
  const keywordSet = new Set([
    `namaz timings ${cityProfile.name} ${countryName}`,
    `prayer times ${cityProfile.name} ${countryName}`,
    `${cityProfile.name} namaz timing today`,
    `${cityProfile.name} fajr dhuhr asr maghrib isha time`,
    `fajr time ${cityProfile.name}`,
    `zohr time ${cityProfile.name}`,
    `asr time ${cityProfile.name}`,
    `magrib time ${cityProfile.name}`,
    `isha time ${cityProfile.name}`,
    `${cityProfile.name} salah schedule`,
    `ramadan ${RAMADAN_CALENDAR_YEAR} ${cityProfile.name}`,
    `iftar time ${cityProfile.name}`,
    `sehri time ${cityProfile.name}`,
    `namaz ${countryName}`,
    'RuhVerse namaz'
  ]);
  aliasTerms.forEach((alias) => {
    keywordSet.add(`namaz timings ${alias} ${countryName}`);
    keywordSet.add(`prayer time ${alias}`);
    keywordSet.add(`${alias} fajr zohr asr magrib isha`);
  });
  const pageKeywords = Array.from(keywordSet).join(', ');

  const heroTitle = `Namaz Times in ${cityProfile.name}`;
  const heroSubtitle = `Official Salah schedule for ${cityProfile.name}, ${regionName}. Timings for Fajr, Dhuhr, Asr, Maghrib, and Isha calculated using the University of Islamic Sciences (Karachi) method at coordinates ${cityProfile.latitude} deg N, ${cityProfile.longitude} deg E.`;
  const locationLabel = `${cityProfile.name}, ${regionName} (${cityProfile.timezone || IST_TIME_ZONE})`;
  const insightsHeading = `Islam & the Muslim Community in ${cityProfile.name}`;
  const popularMosquesTitle = `Popular Mosques in ${cityProfile.name}`;

  const chipsHtml = [
    `<span class="city-meta-chip">Region: ${escapeHtml(regionName)}</span>`,
    `<span class="city-meta-chip">Community: ${escapeHtml(cityProfile.muslimPopulation || '')} Muslims</span>`,
    `<span class="city-meta-chip">Date: ${escapeHtml(date)}</span>`
  ].join('');

  const insightsHtml = `
    <h3>${escapeHtml(cityProfile.famousLandmark || cityProfile.name)}</h3>
    <p>${escapeHtml(cityProfile.insights || '')}</p>
  `;

  const structuredData = buildCityStructuredData(cityProfile);
  const relatedCitiesHtml = renderRelatedCityLinksHtml(cityProfile);
  const popularMosqueItemsHtml = renderPopularMosqueItemsHtml(popularMosques);

  const ssrBootstrap = `
<script>
window.__SSR_CITY = ${JSON.stringify({
    slug: citySlug,
    name: cityProfile.name,
    latitude: cityProfile.latitude,
    longitude: cityProfile.longitude,
    timezone: cityProfile.timezone || IST_TIME_ZONE,
    method: cityProfile.method,
    prayerTimes: timings,
    date
  })};
</script>`;

  return template
    .replace('<!--SSR_PAGE_TITLE-->Prayer Times Today by City | Fajr, Dhuhr, Asr, Maghrib, Isha | RuhVerse', escapeHtml(pageTitle))
    .replace('<!--SSR_PAGE_DESCRIPTION-->Get accurate city prayer times today with Fajr, Dhuhr, Asr, Maghrib, Isha, nearby mosques, and local Islamic insights on RuhVerse.', escapeHtml(pageDescription))
    .replace('<!--SSR_PAGE_KEYWORDS-->prayer times today, city namaz timings, fajr dhuhr asr maghrib isha time, nearby mosque, ramadan sehri iftar time', escapeHtml(pageKeywords))
    .replace('<!--SSR_CANONICAL-->https://ruhverse.online/namaz-times', escapeHtml(canonical))
    .replace('<!--SSR_OG_TITLE-->Prayer Times Today by City | Fajr, Dhuhr, Asr, Maghrib, Isha | RuhVerse', escapeHtml(pageTitle))
    .replace('<!--SSR_OG_DESCRIPTION-->Get accurate city prayer times today with nearby mosques and local Islamic insights on RuhVerse.', escapeHtml(pageDescription))
    .replace('<!--SSR_OG_URL-->https://ruhverse.online/namaz-times', escapeHtml(canonical))
    .replace('<!--SSR_OG_IMAGE-->https://ruhverse.online/assets/RuhVerse.jpg', escapeHtml(ogImage))
    .replace('<!--SSR_TWITTER_URL-->https://ruhverse.online/namaz-times', escapeHtml(canonical))
    .replace('<!--SSR_TWITTER_TITLE-->Prayer Times Today by City | Fajr, Dhuhr, Asr, Maghrib, Isha | RuhVerse', escapeHtml(pageTitle))
    .replace('<!--SSR_TWITTER_DESCRIPTION-->Get accurate city prayer times today with nearby mosques and local Islamic insights on RuhVerse.', escapeHtml(pageDescription))
    .replace('<!--SSR_TWITTER_IMAGE-->https://ruhverse.online/assets/RuhVerse.jpg', escapeHtml(ogImage))
    .replace('<!--SSR_STRUCTURED_DATA-->', structuredData)
    .replace('<!--SSR_CITY_CHIPS-->', chipsHtml)
    .replace('<!--SSR_CITY_HERO_TITLE-->Prayer Times', escapeHtml(heroTitle))
    .replace('<!--SSR_CITY_HERO_SUBTITLE-->Accurate Namaz timings calculated using the University of Islamic Sciences (Karachi) method.', escapeHtml(heroSubtitle))
    .replace('<!--SSR_CITY_LOCATION_LABEL-->India (IST)', escapeHtml(locationLabel))
    .replace('<!--SSR_COUNTDOWN_INIT-->Loading...', 'Loading...')
    .replace('<!--SSR_PRAYER_CARDS-->', renderPrayerCardsHtml(timings))
    .replace('<!--SSR_CITY_INSIGHTS_HEADING-->Islam & Community in This City', escapeHtml(insightsHeading))
    .replace('<!--SSR_CITY_INSIGHTS-->', insightsHtml)
    .replace('<!--SSR_POPULAR_MOSQUES_TITLE-->Popular Mosques in This City', escapeHtml(popularMosquesTitle))
    .replace('<!--SSR_POPULAR_MOSQUE_ITEMS-->', popularMosqueItemsHtml)
    .replace('<!--SSR_RAMADAN_NOTE-->', renderRamadanNoteHtml(cityProfile.ramadanNote))
    .replace('<!--SSR_RAMADAN_CALENDAR-->', '')
    .replace('<!--SSR_CITY_FACTS-->', renderCityFactsHtml(cityProfile.facts))
    .replace('<!--SSR_FAQ_ITEMS-->', renderCityFaqHtml(cityProfile.faqItems))
    .replace('<!--SSR_RELATED_CITIES-->', relatedCitiesHtml)
    .replace('<!--SSR_DATA-->', ssrBootstrap);
}

async function serveCityPage(req, res, cityProfile) {
  if (!cityPrayerTemplate) {
    res.status(500).send('City prayer template not found.');
    return;
  }

  applyIndexingHeaders(res);
  const popularMosquesPromise = Promise.race([
    getCityPopularMosques(cityProfile),
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error('SSR popular mosques timeout')), CITY_POPULAR_MOSQUES_SSR_TIMEOUT_MS);
    })
  ]).catch((err) => {
    console.warn(`City popular mosques SSR fallback for ${cityProfile.slug}:`, err.message);
    return buildFallbackPopularMosques(cityProfile);
  });

  try {
    const prayerPromise = getCityPrayerTimes(
      cityProfile.slug,
      cityProfile.latitude,
      cityProfile.longitude,
      cityProfile.method
    );
    const [prayerData, popularMosques] = await Promise.all([
      prayerPromise,
      popularMosquesPromise
    ]);
    const html = renderCityPage(cityPrayerTemplate, cityProfile, prayerData, popularMosques);
    res.send(html);
  } catch (err) {
    console.error(`City SSR failed for ${cityProfile.slug}:`, err.message);
    // Fallback: render page with dashes on prayer cards
    const fallbackTimings = { Fajr: '', Dhuhr: '', Asr: '', Maghrib: '', Isha: '' };
    const fallbackData = { timings: fallbackTimings, date: getTodayIstIsoDate() };
    const [popularMosques] = await Promise.all([popularMosquesPromise]);
    try {
      const html = renderCityPage(cityPrayerTemplate, cityProfile, fallbackData, popularMosques);
      res.send(html);
    } catch (e2) {
      res.status(500).send('Failed to render city prayer page.');
    }
  }
}

app.get('/namaz-times/:citySlug', async (req, res) => {
  const slug = (req.params.citySlug || '').toLowerCase().trim();
  const cityProfile = cityProfiles[slug];

  if (!cityProfile) {
    res.status(404).send(`City "${escapeHtml(slug)}" not found. <a href="/prayer-times-india.html">View all Indian cities</a>.`);
    return;
  }

  await serveCityPage(req, res, cityProfile);
});

app.get('/onesignal-init.js', (req, res) => {
  res.set('Cache-Control', 'no-store, max-age=0');
  res.type('application/javascript; charset=utf-8').sendFile(path.join(__dirname, 'onesignal-init.js'));
});

app.get('/push/onesignal/OneSignalSDKWorker.js', (req, res) => {
  res.type('application/javascript; charset=utf-8').send('importScripts("https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.sw.js");\n');
});

// Block backend, repo, and local data files from being served by root static hosting.
app.use((req, res, next) => {
  let decodedPath = '';
  try {
    decodedPath = decodeURIComponent(String(req.path || '')).replace(/\\/g, '/');
  } catch (_) {
    res.status(404).send('Not found.');
    return;
  }

  const normalizedPath = path.posix.normalize(decodedPath);
  const segments = normalizedPath.split('/').filter(Boolean);
  const fileName = segments[segments.length - 1] || '';
  const lowerPath = normalizedPath.toLowerCase();
  const lowerFileName = fileName.toLowerCase();

  // Whitelist specific public client-side files inside /data/ before applying the block.
  const dataWhitelist = ['/data/insights.js'];
  if (dataWhitelist.includes(lowerPath)) {
    return next();
  }

  const isBlocked =
    segments.some((segment) => segment.startsWith('.')) ||
    lowerPath.startsWith('/data/') ||
    lowerPath.startsWith('/node_modules/') ||
    lowerPath.startsWith('/.git/') ||
    lowerFileName === 'server.js' ||
    lowerFileName === 'package.json' ||
    lowerFileName === 'package-lock.json' ||
    lowerFileName === 'vercel.json' ||
    lowerFileName === 'agents.md' ||
    lowerFileName.endsWith('.sql') ||
    lowerFileName.endsWith('.env');

  if (isBlocked) {
    res.status(404).send('Not found.');
    return;
  }

  next();
});

// -- Static files should be served after SSR routes ------------------------
app.use(express.static(path.join(__dirname), {
  etag: true,
  lastModified: true,
  maxAge: '7d',
  setHeaders: (res, filePath) => {
    if (/\.(html?)$/i.test(filePath)) {
      res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
      return;
    }

    if (/\.(css|js|mjs)$/i.test(filePath)) {
      res.setHeader('Cache-Control', 'public, max-age=300, must-revalidate');
      return;
    }

    if (/\.(jpg|jpeg|png|webp|svg|ico|woff2?|ttf|otf)$/i.test(filePath)) {
      res.setHeader('Cache-Control', 'public, max-age=604800, stale-while-revalidate=86400');
    }
  }
}));

if (require.main === module) {
  const explicitPort = process.env.PORT;
  const basePort = Number(PORT) || 3000;
  const maxRetries = explicitPort ? 0 : 20;

  const startServer = (port, attempt = 0) => {
    const server = app.listen(port, () => {
      const activePort = server.address()?.port || port;
      console.log(`\x1b[32m[RuhVerse]\x1b[0m SSR Server active on port ${activePort}`);
    });

    server.once('error', (err) => {
      if (err?.code === 'EADDRINUSE' && attempt < maxRetries) {
        const nextPort = port + 1;
        console.warn(`Port ${port} is in use. Retrying on ${nextPort}...`);
        startServer(nextPort, attempt + 1);
        return;
      }

      console.error(`Failed to start server on port ${port}:`, err.message);
      process.exit(1);
    });
  };

  startServer(basePort);
}

module.exports = app;
