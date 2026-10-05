// The admin panel's sign-in. One owner, no user database: the password is made by /admin/setup/ in the owner's browser
// (100 random bits, so a fast salted SHA-256 is enough and fits the 10 ms CPU limit of the free plan) and only its hash
// is kept, as the Cloudflare secret ADMIN_PASSWORD_HASH ("v1$salt$hash", base64url). A session is a signed cookie
// (HMAC-SHA-256 with the secret ADMIN_SESSION_KEY), valid for 8 hours, only sent to /admin, never readable by scripts.
// Changing the password or the session key ends every session. The admin cookie is the only cookie of the Lulo Smaç!
// panel and it exists only in the owner's browser.
import { b64u, b64uDec, cat } from './bytes.js';

export const SECRETS = ['ADMIN_PASSWORD_HASH', 'ADMIN_SESSION_KEY'];
const COOKIE = '__Secure-lulo_admin';
const HOURS = 8;
const enc = new TextEncoder();

export const missingSecrets = (env) => SECRETS.filter((k) => !env || !String(env[k] || '').trim());

export function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers } });
}
export const fail = (status, error, message, extra = {}) => json({ error, message, ...extra }, status);

// request body as JSON, refusing anything large
export async function readJson(request, max = 64 * 1024) {
  const text = await request.text();
  if (text.length > max) throw new Error('İstek çok büyük.');
  try {
    return JSON.parse(text || 'null');
  } catch (e) {
    throw new Error('İstek okunamadı.');
  }
}

// The password is Crockford base32 shown in groups (K7M2Q-9ZT4W-…): case, spaces and dashes don't matter, and the
// look-alike letters O, I, L are read as 0, 1, 1 (the alphabet has none of them). The setup page hashes the same form.
export const canonicalPassword = (s) => String(s).normalize('NFKC').trim().toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');

function same(a, b) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i];
  return d === 0;
}

export async function checkPassword(env, password) {
  const parts = String(env.ADMIN_PASSWORD_HASH || '').trim().split('$');
  if (parts.length !== 3 || parts[0] !== 'v1' || typeof password !== 'string' || !password || password.length > 200) return false;
  let salt, want;
  try {
    salt = b64uDec(parts[1]);
    want = b64uDec(parts[2]);
  } catch (e) {
    return false;
  }
  if (salt.length < 16 || want.length !== 32) return false;
  const typed = canonicalPassword(password);
  const got = new Uint8Array(await crypto.subtle.digest('SHA-256', cat(salt, enc.encode(typed))));
  return same(got, want);
}

async function macKey(env) {
  const raw = b64uDec(String(env.ADMIN_SESSION_KEY || '').trim());
  if (raw.length < 32) throw new Error('ADMIN_SESSION_KEY çok kısa.');
  return crypto.subtle.importKey('raw', raw, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}
// a session is tied to the current password: a new password ends the old sessions
async function passwordTag(env) {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(String(env.ADMIN_PASSWORD_HASH || '').trim())));
  return b64u(d.slice(0, 9));
}
const macText = (exp, nonce, tag) => enc.encode(`lulo-admin|${exp}|${nonce}|${tag}`);

export async function newSession(env, now = Date.now()) {
  const exp = Math.floor(now / 1000) + HOURS * 3600;
  const nonce = b64u(crypto.getRandomValues(new Uint8Array(12)));
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', await macKey(env), macText(exp, nonce, await passwordTag(env))));
  const token = `${exp}.${nonce}.${b64u(mac)}`;
  return { exp, cookie: `${COOKIE}=${token}; Path=/admin; Max-Age=${HOURS * 3600}; HttpOnly; Secure; SameSite=Strict` };
}
export const endSession = () => `${COOKIE}=; Path=/admin; Max-Age=0; HttpOnly; Secure; SameSite=Strict`;

export async function readSession(request, env, now = Date.now()) {
  const raw = request.headers.get('Cookie') || '';
  const m = raw.match(new RegExp('(?:^|;\\s*)' + COOKIE.replace(/[.$]/g, '\\$&') + '=([^;]+)'));
  if (!m) return null;
  const [exp, nonce, mac] = m[1].split('.');
  if (!/^\d{9,11}$/.test(exp || '') || !nonce || !mac || Number(exp) * 1000 <= now) return null;
  try {
    const ok = await crypto.subtle.verify('HMAC', await macKey(env), b64uDec(mac), macText(exp, nonce, await passwordTag(env)));
    return ok ? { exp: Number(exp) } : null;
  } catch (e) {
    return null;
  }
}

// every /admin response: never cached, never indexed, no framing, scripts and styles only from the site itself
export function adminHeaders(response) {
  const r = new Response(response.body, response);
  const h = r.headers;
  h.set('Cache-Control', 'no-store');
  h.delete('Access-Control-Allow-Origin');   // Pages adds it to static files; nothing here is for other sites
  h.set('X-Robots-Tag', 'noindex, nofollow');
  h.set('X-Content-Type-Options', 'nosniff');
  h.set('X-Frame-Options', 'DENY');
  h.set('Referrer-Policy', 'no-referrer');
  h.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()');
  h.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  h.set('Cross-Origin-Opener-Policy', 'same-origin');
  h.set('Content-Security-Policy', "default-src 'self'; img-src 'self' data: blob:; style-src 'self'; script-src 'self'; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'");
  return r;
}
