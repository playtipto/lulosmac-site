// Gmail for the Influencer page: the owner connects the Lulo Smaç! mailbox (support@lulosmac.com) once with Google's OAuth
// consent; the panel then sends the outreach mails and replies from that mailbox and reads the replies in the same
// threads. Only two permissions are asked: send mail and read mail (no delete, no settings, no drafts).
//
// Setup (Cloudflare Pages → Settings → Variables and Secrets): GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET of a Google
// Cloud OAuth client (type "Web application", consent screen "Internal" in the lulosmac.com Workspace, redirect URI
// https://lulosmac-yonetim.pages.dev/admin/influencer/). The refresh token Google gives is kept in D1 encrypted (AES-GCM, key
// derived from ADMIN_SESSION_KEY): a new session key or "Bağlantıyı kes" means connecting again.
// INF_TEST_API (tests only) points Google and Anthropic calls at a local stand-in.
import { b64u, b64uDec } from './bytes.js';
import { InfError } from './influencer.js';

export const GMAIL_SCOPES = ['https://www.googleapis.com/auth/gmail.send', 'https://www.googleapis.com/auth/gmail.readonly'];
export const GMAIL_SECRETS = ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'];
const enc = new TextEncoder();

const testBase = (env) => {
  const t = String((env && env.INF_TEST_API) || '').trim().replace(/\/+$/, '');
  return /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(t) ? t : '';
};
export const googleUrls = (env) => {
  const t = testBase(env);
  return t
    ? { auth: t + '/google/auth', token: t + '/google/token', revoke: t + '/google/revoke', api: t + '/gmail/v1/users/me' }
    : { auth: 'https://accounts.google.com/o/oauth2/v2/auth', token: 'https://oauth2.googleapis.com/token', revoke: 'https://oauth2.googleapis.com/revoke', api: 'https://gmail.googleapis.com/gmail/v1/users/me' };
};
export const missingGmail = (env) => GMAIL_SECRETS.filter((k) => !env || !String(env[k] || '').trim());
export const redirectUri = (origin) => origin.replace(/\/+$/, '') + '/admin/influencer/';

// ---------------------------------------------------------------- keys from the session secret
async function rawSessionKey(env) {
  const raw = b64uDec(String(env.ADMIN_SESSION_KEY || '').trim());
  if (raw.length < 32) throw new InfError(424, 'setup', 'ADMIN_SESSION_KEY eksik ya da kısa.');
  return raw;
}
async function hmac(env, text) {
  const k = await crypto.subtle.importKey('raw', await rawSessionKey(env), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, enc.encode(text)));
}
async function aesKey(env) {
  const base = await crypto.subtle.importKey('raw', await rawSessionKey(env), 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: enc.encode('lulo-influencer'), info: enc.encode('gmail-refresh-token') },
    base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
export async function seal(env, text) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await aesKey(env), enc.encode(text)));
  const out = new Uint8Array(iv.length + ct.length);
  out.set(iv);
  out.set(ct, iv.length);
  return b64u(out);
}
export async function unseal(env, box) {
  const u = b64uDec(box);
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: u.slice(0, 12) }, await aesKey(env), u.slice(12));
  return new TextDecoder().decode(pt);
}

// ---------------------------------------------------------------- connecting (OAuth with state + PKCE, no storage)
// state = payload.mac, payload = base64url {n: nonce, e: expiry}; the PKCE verifier is an HMAC of the payload, so the
// server can make it again when Google sends the owner back, without keeping anything in between.
export async function makeState(env, now = Date.now()) {
  const payload = b64u(enc.encode(JSON.stringify({ n: b64u(crypto.getRandomValues(new Uint8Array(12))), e: now + 15 * 60000 })));
  return payload + '.' + b64u(await hmac(env, 'lulo-gmail-state|' + payload));
}
export async function checkState(env, state, now = Date.now()) {
  const [payload, mac] = String(state || '').split('.');
  if (!payload || !mac) return null;
  const want = b64u(await hmac(env, 'lulo-gmail-state|' + payload));
  if (want.length !== mac.length) return null;
  let d = 0;
  for (let i = 0; i < want.length; i++) d |= want.charCodeAt(i) ^ mac.charCodeAt(i);
  if (d) return null;
  let p;
  try { p = JSON.parse(new TextDecoder().decode(b64uDec(payload))); } catch (e) { return null; }
  if (!p || typeof p.e !== 'number' || p.e < now) return null;
  return payload;
}
async function verifierFor(env, payload) { return b64u(await hmac(env, 'lulo-gmail-pkce|' + payload)); }
async function challengeFor(verifier) { return b64u(new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(verifier)))); }

export async function connectUrl(env, origin, loginHint) {
  const miss = missingGmail(env);
  if (miss.length) throw new InfError(424, 'gmail_setup', 'Gmail bağlantısı için Cloudflare\'de şunlar eksik: ' + miss.join(', '));
  const state = await makeState(env);
  const payload = state.split('.')[0];
  const q = new URLSearchParams({
    client_id: String(env.GOOGLE_CLIENT_ID).trim(),
    redirect_uri: redirectUri(origin),
    response_type: 'code',
    scope: GMAIL_SCOPES.join(' '),
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'false',
    state,
    code_challenge: await challengeFor(await verifierFor(env, payload)),
    code_challenge_method: 'S256',
  });
  if (loginHint) q.set('login_hint', loginHint);
  return googleUrls(env).auth + '?' + q.toString();
}

async function tokenCall(env, params) {
  let r;
  try {
    r = await fetch(googleUrls(env).token, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(params).toString() });
  } catch (e) {
    throw new InfError(424, 'gmail_down', 'Google\'a ulaşılamadı; biraz sonra tekrar dene.');
  }
  const j = await r.json().catch(() => null);
  return { ok: r.ok, status: r.status, j: j || {} };
}

// Google sent the owner back with ?code&state: swap the code for tokens, check the mailbox, keep the refresh token.
export async function finishConnect(env, store, origin, code, state, now = Date.now()) {
  const payload = await checkState(env, state, now);
  if (!payload) throw new InfError(400, 'gmail_state', 'Bağlantı isteğinin süresi dolmuş ya da tanınmadı; "Gmail\'i bağla"ya yeniden bas.');
  if (typeof code !== 'string' || !code || code.length > 2000) throw new InfError(400, 'invalid', 'Google\'dan gelen kod okunamadı.');
  const t = await tokenCall(env, {
    code, client_id: String(env.GOOGLE_CLIENT_ID).trim(), client_secret: String(env.GOOGLE_CLIENT_SECRET).trim(),
    redirect_uri: redirectUri(origin), grant_type: 'authorization_code', code_verifier: await verifierFor(env, payload),
  });
  if (!t.ok || !t.j.access_token) {
    const why = t.j.error === 'invalid_client' ? 'GOOGLE_CLIENT_ID ya da GOOGLE_CLIENT_SECRET yanlış.'
      : t.j.error === 'redirect_uri_mismatch' ? 'Google Cloud\'daki yönlendirme adresi ' + redirectUri(origin) + ' olmalı.'
        : 'Google bağlantıyı onaylamadı (' + (t.j.error || t.status) + ').';
    throw new InfError(400, 'gmail_token', why);
  }
  const granted = String(t.j.scope || '').split(/\s+/);
  const eksik = GMAIL_SCOPES.filter((s) => !granted.includes(s));
  if (eksik.length) throw new InfError(400, 'gmail_scope', 'Google ekranında iki izin de verilmeli (mail gönderme ve okuma). Yeniden bağlanıp ikisini de işaretle.');
  if (!t.j.refresh_token) throw new InfError(400, 'gmail_token', 'Google kalıcı erişim vermedi. myaccount.google.com/permissions\'dan eski Lulo Smaç iznini kaldırıp yeniden bağlan.');
  cache.token = t.j.access_token;
  cache.exp = now + (Number(t.j.expires_in) || 3000) * 1000;
  const prof = await apiJson(env, t.j.access_token, 'GET', '/profile');
  const email = String((prof && prof.emailAddress) || '').toLowerCase();
  await store.kvSet('gmail', JSON.stringify({ email, rt: await seal(env, t.j.refresh_token), scopes: granted.filter((s) => GMAIL_SCOPES.includes(s)), connected: new Date(now).toISOString() }), now);
  cache.email = email;
  return { email };
}

export async function gmailState(env, store) {
  const raw = await store.kvGet('gmail');
  if (!raw) return null;
  try { return JSON.parse(raw); } catch (e) { return null; }
}

export async function disconnect(env, store) {
  const g = await gmailState(env, store);
  await store.kvDel('gmail');
  cache.token = ''; cache.exp = 0; cache.email = '';
  if (g && g.rt) {
    try {
      const rt = await unseal(env, g.rt);
      await fetch(googleUrls(env).revoke, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'token=' + encodeURIComponent(rt) });
    } catch (e) { /* the token is forgotten here either way */ }
  }
}

// ---------------------------------------------------------------- access token (kept in memory while the isolate lives)
const cache = { token: '', exp: 0, email: '' };
async function accessToken(env, store, now = Date.now()) {
  if (cache.token && cache.exp - 60000 > now) return cache.token;
  const miss = missingGmail(env);
  if (miss.length) throw new InfError(424, 'gmail_setup', 'Gmail bağlantısı için Cloudflare\'de şunlar eksik: ' + miss.join(', '));
  const g = await gmailState(env, store);
  if (!g || !g.rt) throw new InfError(409, 'gmail_connect', 'Gmail bağlı değil; Ayarlar\'dan "Gmail\'i bağla"ya bas.');
  let rt;
  try { rt = await unseal(env, g.rt); } catch (e) {
    throw new InfError(409, 'gmail_connect', 'Kayıtlı Gmail bağlantısı açılamadı (oturum anahtarı değişmiş olabilir); Ayarlar\'dan yeniden bağla.');
  }
  const t = await tokenCall(env, { client_id: String(env.GOOGLE_CLIENT_ID).trim(), client_secret: String(env.GOOGLE_CLIENT_SECRET).trim(), refresh_token: rt, grant_type: 'refresh_token' });
  if (!t.ok || !t.j.access_token) {
    if (t.j.error === 'invalid_grant') {
      await store.kvDel('gmail');
      throw new InfError(409, 'gmail_connect', 'Gmail bağlantısı düştü (izin geri alınmış ya da süresi dolmuş); Ayarlar\'dan yeniden bağla.');
    }
    if (t.j.error === 'invalid_client') throw new InfError(424, 'gmail_setup', 'GOOGLE_CLIENT_ID ya da GOOGLE_CLIENT_SECRET yanlış.');
    throw new InfError(424, 'gmail_down', 'Google şu an yanıt vermiyor; biraz sonra tekrar dene.');
  }
  cache.token = t.j.access_token;
  cache.exp = now + (Number(t.j.expires_in) || 3000) * 1000;
  cache.email = g.email || '';
  return cache.token;
}

function apiError(status, j) {
  const msg = j && j.error && (j.error.message || j.error.status) ? String(j.error.message || j.error.status).slice(0, 200) : '';
  if (status === 401) return new InfError(409, 'gmail_connect', 'Gmail izni geçersiz; Ayarlar\'dan yeniden bağla.');
  if (status === 403) return new InfError(403, 'gmail_scope', 'Gmail bu işleme izin vermedi' + (msg ? ': ' + msg : '.'));
  if (status === 404) return new InfError(404, 'gmail_missing', 'Gmail\'de bu yazışma bulunamadı (silinmiş olabilir).');
  if (status === 429) return new InfError(429, 'gmail_rate', 'Gmail çok sık istek aldı ya da günlük gönderim sınırına geldi; biraz sonra tekrar dene.');
  if (status === 400) return new InfError(400, 'gmail_invalid', 'Gmail isteği reddetti' + (msg ? ': ' + msg : '.'));
  return new InfError(424, 'gmail_down', 'Gmail şu an yanıt vermiyor; biraz sonra tekrar dene.');
}
async function apiJson(env, token, method, path, body) {
  let r;
  try {
    r = await fetch(googleUrls(env).api + path, {
      method,
      headers: { Authorization: 'Bearer ' + token, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    throw new InfError(424, 'gmail_down', 'Gmail\'e ulaşılamadı; biraz sonra tekrar dene.');
  }
  const j = await r.json().catch(() => null);
  if (!r.ok) throw apiError(r.status, j);
  return j;
}
// one retry with a fresh token when Google says the cached one expired early
async function call(env, store, method, path, body) {
  try {
    return await apiJson(env, await accessToken(env, store), method, path, body);
  } catch (e) {
    if (e.code === 'gmail_connect' && cache.token) {
      cache.token = ''; cache.exp = 0;
      return apiJson(env, await accessToken(env, store), method, path, body);
    }
    throw e;
  }
}

// ---------------------------------------------------------------- building a mail (RFC 5322, UTF-8)
function b64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
// a header value in plain ASCII stays as it is; anything else becomes RFC 2047 encoded words (≤ 75 chars each)
export function encodeWord(s) {
  const t = String(s == null ? '' : s).replace(/[\r\n]+/g, ' ');
  if (/^[\x20-\x7e]*$/.test(t)) return t;
  const words = [];
  let cur = '';
  for (const ch of t) {
    if (enc.encode(cur + ch).length > 45) { words.push(cur); cur = ''; }
    cur += ch;
  }
  if (cur) words.push(cur);
  return words.map((w) => '=?UTF-8?B?' + b64(enc.encode(w)) + '?=').join('\r\n ');
}
const cleanAddr = (s) => String(s || '').replace(/[\r\n<>,;"]/g, '').trim();
export function buildMime({ from, fromName, to, subject, body, inReplyTo, references, date }) {
  const f = cleanAddr(from), t = cleanAddr(to);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(t)) throw new InfError(400, 'invalid', 'Alıcı adresi geçersiz: ' + t);
  const lines = [
    'From: ' + (fromName ? encodeWord(fromName) + ' <' + f + '>' : f),
    'To: ' + t,
    'Subject: ' + encodeWord(subject),
    'Date: ' + (date || new Date()).toUTCString().replace('GMT', '+0000'),
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
  ];
  const clean = (v) => String(v || '').replace(/[\r\n]+/g, ' ').trim();
  if (inReplyTo) lines.push('In-Reply-To: ' + clean(inReplyTo), 'References: ' + clean(references || inReplyTo));
  const text = String(body == null ? '' : body).replace(/\r\n|\r|\n/g, '\r\n');
  const data = b64(enc.encode(text)).replace(/.{1,76}/g, '$&\r\n');
  return lines.join('\r\n') + '\r\n\r\n' + data;
}

// Sends one mail from the connected mailbox; threadId keeps a reply in its conversation.
export async function sendMail(env, store, m) {
  const g = await gmailState(env, store);
  const from = (g && g.email) || cache.email;
  if (!from) throw new InfError(409, 'gmail_connect', 'Gmail bağlı değil; Ayarlar\'dan "Gmail\'i bağla"ya bas.');
  const raw = b64u(enc.encode(buildMime(Object.assign({}, m, { from }))));
  const j = await call(env, store, 'POST', '/messages/send', Object.assign({ raw }, m.threadId ? { threadId: m.threadId } : {}));
  return { id: String((j && j.id) || ''), threadId: String((j && j.threadId) || ''), from };
}

// ---------------------------------------------------------------- reading a thread
const header = (hs, name) => {
  const h = (hs || []).find((x) => String(x.name).toLowerCase() === name);
  return h ? String(h.value || '') : '';
};
function decodePart(p) {
  if (!p || !p.body || !p.body.data) return '';
  const bytes = b64uDec(p.body.data);
  const cs = (/charset="?([^";\s]+)/i.exec(header(p.headers, 'content-type')) || [])[1] || 'utf-8';
  try { return new TextDecoder(cs.toLowerCase()).decode(bytes); } catch (e) { return new TextDecoder().decode(bytes); }
}
function findPart(p, type) {
  if (!p) return null;
  if (String(p.mimeType || '').toLowerCase() === type && p.body && p.body.data) return p;
  for (const c of p.parts || []) { const f = findPart(c, type); if (f) return f; }
  return null;
}
export function htmlToText(h) {
  return String(h || '')
    .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|li|tr|h\d|blockquote)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
    .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}
export const addrOf = (s) => { const m = String(s || '').match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i); return m ? m[0].toLowerCase() : ''; };
const BOUNCE_FROM = /(mailer-daemon|postmaster|mail-daemon)@/i;
const BOUNCE_SUBJECT = /(delivery status notification|undeliver|delivery (has )?failed|mail delivery (failed|subsystem)|returned mail|teslim edilemedi|iletilemedi|adres bulunamad)/i;
// Automatic replies (out of office, vacation responders): the RFC 3834 headers first, then the subjects mail programs give them
const OTO_KONU = /^\s*(otomat[iİ]k\s+(yan[ıi]t|cevap)|automatic\s+reply|auto(matic)?[\s-]?(reply|response)|autoreply|out\s+of\s+(the\s+)?office|ofis\s+d[ıi][şs][ıi]nda|r[ée]ponse\s+automatique|automatische\s+antwort|abwesenheitsnotiz|(ال)?رد\s*(ال)?(تلقائي|آلي)|خارج\s*المكتب)(?=[\s:：-]|$)/i;
export function otomatikMi(hs) {
  const as = header(hs, 'auto-submitted').trim().toLowerCase();
  if (as && as !== 'no') return true;
  if (header(hs, 'x-autoreply') || header(hs, 'x-autorespond') || header(hs, 'x-autoresponder')) return true;
  if (/auto[_-]?reply/i.test(header(hs, 'precedence'))) return true;
  return OTO_KONU.test(header(hs, 'subject'));
}

// One Gmail message in the panel's terms. `mine` = sent from the connected mailbox; `otomatik` = an automatic reply.
export function parseMessage(m, myEmail) {
  const hs = (m && m.payload && m.payload.headers) || [];
  const labels = (m && m.labelIds) || [];
  const kimden = header(hs, 'from');
  const plain = findPart(m && m.payload, 'text/plain');
  const html = plain ? null : findPart(m && m.payload, 'text/html');
  const metin = plain ? decodePart(plain) : html ? htmlToText(decodePart(html)) : String((m && m.snippet) || '');
  const ts = Number(m && m.internalDate) || Date.parse(header(hs, 'date')) || Date.now();
  const mine = labels.includes('SENT') || (!!myEmail && addrOf(kimden) === myEmail);
  return {
    gmailId: String((m && m.id) || ''), threadId: String((m && m.threadId) || ''), tarih: new Date(ts).toISOString(),
    kimden, kime: header(hs, 'to'), konu: header(hs, 'subject'), rfcId: header(hs, 'message-id'), yanitla: header(hs, 'reply-to'),
    references: header(hs, 'references'), metin, mine, taslak: labels.includes('DRAFT'),
    teslimHatasi: !mine && (BOUNCE_FROM.test(kimden) || BOUNCE_SUBJECT.test(header(hs, 'subject'))),
    otomatik: otomatikMi(hs),
  };
}

export async function readThread(env, store, threadId) {
  if (!/^[A-Za-z0-9]{6,40}$/.test(String(threadId || ''))) throw new InfError(400, 'invalid', 'Geçersiz yazışma.');
  const g = await gmailState(env, store);
  const me = ((g && g.email) || cache.email || '').toLowerCase();
  const j = await call(env, store, 'GET', '/threads/' + threadId + '?format=full');
  return ((j && j.messages) || []).map((m) => parseMessage(m, me)).filter((x) => !x.taslak).sort((a, b) => a.tarih.localeCompare(b.tarih));
}

// the newest thread we sent to this address (for people marked as sent by hand, without a thread id)
export async function findSentThread(env, store, email) {
  const a = addrOf(email);
  if (!a) return '';
  const j = await call(env, store, 'GET', '/threads?maxResults=3&q=' + encodeURIComponent('in:sent to:' + a + ' newer_than:180d'));
  return String(((j && j.threads) || [])[0] ? j.threads[0].id : '');
}
