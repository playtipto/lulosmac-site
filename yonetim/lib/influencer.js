// Influencer outreach data for the admin panel's Influencer page (Lulo Smaç! yönetim paneli, /admin/influencer): the people we write
// to (creators and media) with their outreach mail and mail thread, the page's settings and a send log for the daily
// limit. Storage: Cloudflare D1, binding INFLUENCER_DB (tables are made on first use). Only the owner's signed-in
// session reaches this (functions/admin/_middleware.js). Records are the same shape the page works with; the server
// keeps them tidy (known fields only, size limits) and owns the sending lock and the send log.
import { AYAR_VARSAYILAN, DURUM_AD, eksikleriTamamla, gecerliEmail } from './influencer_logic.js';

export class InfError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export const INF_LIMITS = { people: 5000, record: 200 * 1024, yazisma: 120, metin: 30000, bulk: 25, dayMax: 100, list: 5000 };   // bulk: records per request (the free plan's 10 ms CPU limit)
export const DAY_TZ = 'Europe/Istanbul';

// ---------------------------------------------------------------- record shape
const str = (v, max) => (v == null ? '' : String(v)).slice(0, max);
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const pick = (v, allowed, fallback) => (allowed.includes(v) ? v : fallback);

const STR = {
  platform: 20, handle: 80, ad: 200, bio: 1500, kategori: 200, sehir: 80, ulke: 4, email: 200, profil: 500, kaynak: 20,
  tur: 10, not: 2000, kisisel: 1000, nis: 20, dil: 4, hitap: 4, hitapAdi: 200, eklenme: 40, guncelleme: 40, gonderimBelirsiz: 40,
};
const NUM = ['takipci', 'etkilesim', 'izlenme', 'puan'];

function cleanMail(m) {
  if (!m || typeof m !== 'object') return null;
  return {
    konu: str(m.konu, 400), govde: str(m.govde, 20000), dm: str(m.dm, 4000),
    uretim: pick(m.uretim, ['sablon', 'claude', 'elle'], 'sablon'), tarih: str(m.tarih, 40), onayTarih: str(m.onayTarih, 40),
  };
}
function cleanGonderim(g) {
  if (!g || typeof g !== 'object') return null;
  return { tarih: str(g.tarih, 40), kanal: pick(g.kanal, ['gmail', 'elle', 'dm'], 'elle'), threadId: str(g.threadId, 64), messageId: str(g.messageId, 64), rfcId: str(g.rfcId, 400) };
}
function cleanTeslim(t) {
  if (!t || typeof t !== 'object') return null;
  return { hata: !!t.hata, tarih: str(t.tarih, 40), metin: str(t.metin, 600) };
}
function cleanEntry(e) {
  if (!e || typeof e !== 'object') return null;
  const yon = pick(e.yon, ['giden', 'gelen', 'taslak'], null);
  if (!yon) return null;
  const o = { yon, tarih: str(e.tarih, 40), metin: str(e.metin, INF_LIMITS.metin) };
  for (const [k, max] of [['konu', 400], ['kaynak', 20], ['gmailId', 64], ['threadId', 64], ['rfcId', 400], ['references', 2000], ['kimden', 300], ['yanitla', 300], ['ozet', 400]]) {
    if (e[k] != null && e[k] !== '') o[k] = str(e[k], max);
  }
  if (e.teslimHatasi) o.teslimHatasi = true;
  if (e.otomatik) o.otomatik = true;   // their automatic reply (out of office): kept, but not an answer
  if (e.oto) o.oto = true;   // a draft the scheduler wrote
  const oneri = pick(e.oneri, ['cevap', 'anlasildi', 'olumsuz'], null);   // Claude's read of their mail
  if (oneri) o.oneri = oneri;
  return o;
}

// A person record as stored: known fields only, strings cut to size, the thread capped (oldest entries go first).
export function cleanRecord(d) {
  if (!d || typeof d !== 'object' || Array.isArray(d)) throw new InfError(400, 'invalid', 'Kayıt okunamadı.');
  const o = {};
  for (const [k, max] of Object.entries(STR)) if (d[k] != null) o[k] = str(d[k], max);
  if (o.profil && !/^https?:\/\/[^\s"'<>]+$/i.test(o.profil)) o.profil = '';   // links open from the page: web addresses only
  for (const k of NUM) if (k in d) o[k] = num(d[k]);
  o.ornek = !!d.ornek;
  o.durum = DURUM_AD[d.durum] ? d.durum : 'yeni';
  if ('mail' in d) o.mail = cleanMail(d.mail);
  if ('gonderim' in d) o.gonderim = cleanGonderim(d.gonderim);
  if ('teslim' in d) o.teslim = cleanTeslim(d.teslim);
  o.yazisma = (Array.isArray(d.yazisma) ? d.yazisma : []).map(cleanEntry).filter(Boolean).slice(-INF_LIMITS.yazisma);
  if (d.gonderiliyor) o.gonderiliyor = str(d.gonderiliyor, 40);   // the server's sending lock (never taken from the page)
  if (JSON.stringify(o).length > INF_LIMITS.record) throw new InfError(413, 'too_large', 'Kayıt çok büyük; yazışmayı ya da notları kısalt.');
  return o;
}

// A change from the page: mail, gonderim and teslim merge into what is there; everything else replaces. The sending
// lock is never taken from the page.
export function mergePatch(old, patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new InfError(400, 'invalid', 'Değişiklik okunamadı.');
  const out = Object.assign({}, old);
  for (const [k, v] of Object.entries(patch)) {
    if (k === 'gonderiliyor') continue;
    if (['mail', 'gonderim', 'teslim'].includes(k) && v && typeof v === 'object' && old[k] && typeof old[k] === 'object') out[k] = Object.assign({}, old[k], v);
    else out[k] = v;
  }
  return out;
}

// A new record: tidied, then the computed fields the page would have filled (fit score, template mail, status…).
export function prepareNew(d, ayar, nowIso) {
  const c = cleanRecord(Object.assign({}, d, { gonderiliyor: null }));
  if (!DURUM_AD[d && d.durum]) c.durum = gecerliEmail(c.email) ? 'hazir' : 'yeni';
  const tam = cleanRecord(Object.assign({}, c, eksikleriTamamla(c, ayar)));
  tam.eklenme = c.eklenme || nowIso;
  tam.guncelleme = nowIso;
  return tam;
}

export const validId = (id) => typeof id === 'string' && /^[A-Za-z0-9_.:@+-]{1,100}$/.test(id);

// ---------------------------------------------------------------- settings
export function cleanSettings(a) {
  const s = Object.assign({}, AYAR_VARSAYILAN, a && typeof a === 'object' ? a : {});
  const o = {};
  for (const [k, max] of [['gonderenAd', 80], ['gonderenEmail', 200], ['appStore', 500], ['sirket', 200], ['instagram', 300], ['tiktok', 300], ['youtube', 300], ['x', 300], ['facebook', 300], ['kosul', 2000]]) {
    o[k] = str(s[k], max).trim();
  }
  o.hitap = pick(s.hitap, ['sen', 'siz'], AYAR_VARSAYILAN.hitap);
  o.yayin = pick(s.yayin, ['buhafta', 'yakinda'], AYAR_VARSAYILAN.yayin);
  for (const k of ['fikirErken', 'fikirKod', 'fikirLig']) o[k] = !!s[k];
  o.gunluk = Math.max(1, Math.min(INF_LIMITS.dayMax, parseInt(s.gunluk, 10) || AYAR_VARSAYILAN.gunluk));
  o.oto = !!s.oto;
  o.otoCevap = !!s.otoCevap;
  o.otoKapsam = pick(s.otoKapsam, ['hazir', 'onay'], 'hazir');
  const saat = (v, lo, hi, def) => { const n = parseInt(v, 10); return Number.isInteger(n) && n >= lo && n <= hi ? n : def; };
  o.otoBas = saat(s.otoBas, 0, 23, AYAR_VARSAYILAN.otoBas);
  o.otoBit = saat(s.otoBit, 1, 24, AYAR_VARSAYILAN.otoBit);
  if (o.otoBit <= o.otoBas) { o.otoBas = AYAR_VARSAYILAN.otoBas; o.otoBit = AYAR_VARSAYILAN.otoBit; }
  return o;
}

// the calendar day in Istanbul, for the daily limit
const DAY_FMT = new Intl.DateTimeFormat('en-CA', { timeZone: DAY_TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
export const dayKey = (now = Date.now()) => DAY_FMT.format(new Date(now));

// ---------------------------------------------------------------- storage
export const SCHEMA = [
  'CREATE TABLE IF NOT EXISTS inf_people (id TEXT PRIMARY KEY, data TEXT NOT NULL, created INTEGER NOT NULL, updated INTEGER NOT NULL, version INTEGER NOT NULL DEFAULT 1)',
  'CREATE TABLE IF NOT EXISTS inf_kv (k TEXT PRIMARY KEY, v TEXT NOT NULL, updated INTEGER NOT NULL)',
  'CREATE TABLE IF NOT EXISTS inf_log (id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, day TEXT NOT NULL, kind TEXT NOT NULL, person TEXT, info TEXT)',
  'CREATE INDEX IF NOT EXISTS inf_log_day ON inf_log (day, kind)',
];
export const SQL = {
  list: 'SELECT id, version, data FROM inf_people ORDER BY updated DESC LIMIT ?1',
  get: 'SELECT id, version, data FROM inf_people WHERE id = ?1',
  insert: 'INSERT INTO inf_people (id, data, created, updated, version) VALUES (?1, ?2, ?3, ?3, 1)',
  update: 'UPDATE inf_people SET data = ?2, updated = ?3, version = version + 1 WHERE id = ?1 AND version = ?4',
  remove: 'DELETE FROM inf_people WHERE id = ?1',
  count: 'SELECT COUNT(*) AS n FROM inf_people',
  kvGet: 'SELECT v FROM inf_kv WHERE k = ?1',
  kvSet: 'INSERT INTO inf_kv (k, v, updated) VALUES (?1, ?2, ?3) ON CONFLICT(k) DO UPDATE SET v = excluded.v, updated = excluded.updated',
  kvDel: 'DELETE FROM inf_kv WHERE k = ?1',
  log: 'INSERT INTO inf_log (ts, day, kind, person, info) VALUES (?1, ?2, ?3, ?4, ?5)',
  countDay: "SELECT COUNT(*) AS n FROM inf_log WHERE day = ?1 AND kind = ?2",
  // the few fields the scheduler picks people by, read by SQLite instead of parsing every record
  ozet: "SELECT id, json_extract(data, '$.durum') AS durum, json_extract(data, '$.puan') AS puan, json_extract(data, '$.email') AS email,"
    + " json_extract(data, '$.gonderim.tarih') AS gonderim, json_extract(data, '$.gonderimBelirsiz') AS belirsiz, json_extract(data, '$.ornek') AS ornek,"
    + " json_extract(data, '$.eklenme') AS eklenme, length(coalesce(json_extract(data, '$.mail.govde'), '')) AS mailUzunluk,"
    + " json_extract(data, '$.yazisma[#-1].yon') AS sonYon, json_extract(data, '$.yazisma[#-1].teslimHatasi') AS sonHata,"
    + " json_extract(data, '$.yazisma[#-1].otomatik') AS sonOto, json_extract(data, '$.yazisma[#-1].gmailId') AS sonGmailId FROM inf_people",
};

// one row of SQL.ozet as the scheduler uses it
const ozetSatiri = (r) => ({
  id: r.id, durum: r.durum || '', puan: typeof r.puan === 'number' ? r.puan : 0, email: r.email || '', gonderim: r.gonderim || '',
  belirsiz: r.belirsiz || '', ornek: !!r.ornek, eklenme: r.eklenme || '', mailVar: Number(r.mailUzunluk) > 0,
  sonYon: r.sonYon || '', sonHata: !!r.sonHata, sonOto: !!r.sonOto, sonGmailId: r.sonGmailId || '',
});
export function ozetHesapla(id, d) {
  const y = Array.isArray(d.yazisma) ? d.yazisma : [];
  const son = y[y.length - 1] || {};
  return ozetSatiri({
    id, durum: d.durum, puan: d.puan, email: d.email, gonderim: d.gonderim && d.gonderim.tarih, belirsiz: d.gonderimBelirsiz, ornek: d.ornek,
    eklenme: d.eklenme, mailUzunluk: d.mail && d.mail.govde ? String(d.mail.govde).length : 0, sonYon: son.yon, sonHata: son.teslimHatasi, sonOto: son.otomatik, sonGmailId: son.gmailId,
  });
}

let schemaDone = false;   // once per isolate
async function ensureSchema(db) {
  if (schemaDone) return;
  await db.batch(SCHEMA.map((s) => db.prepare(s)));
  schemaDone = true;
}

const row = (r) => (r ? { id: r.id, v: r.version, d: JSON.parse(r.data) } : null);

// The D1-backed store. Tests use memoryStore() with the same methods.
export function d1Store(db) {
  if (!db || typeof db.prepare !== 'function') throw new InfError(424, 'setup', 'Influencer veritabanı (INFLUENCER_DB) bağlanmamış.');
  const q = async (sql, ...args) => { await ensureSchema(db); return db.prepare(sql).bind(...args); };
  return {
    // the whole list as JSON text, without parsing every record (keeps the free plan's CPU limit)
    async listRaw(limit = INF_LIMITS.list) {
      const rows = ((await (await q(SQL.list, limit)).all()).results) || [];
      return '[' + rows.map((r) => '{"id":' + JSON.stringify(r.id) + ',"v":' + Number(r.version) + ',"d":' + r.data + '}').join(',') + ']';
    },
    async get(id) { return row(await (await q(SQL.get, id)).first()); },
    async count() { return Number(((await (await q(SQL.count)).first()) || {}).n || 0); },
    async insert(id, d, now) {
      try {
        await (await q(SQL.insert, id, JSON.stringify(d), now)).run();
      } catch (e) {
        if (/UNIQUE|constraint/i.test(String(e && e.message))) throw new InfError(409, 'exists', 'Bu kişi zaten listede.');
        throw e;
      }
      return { id, v: 1, d };
    },
    // write only if nobody changed the record since `version` was read
    async replace(id, d, version, now) {
      const r = await (await q(SQL.update, id, JSON.stringify(d), now, version)).run();
      return !!(r && r.meta && r.meta.changes);
    },
    async remove(id) { await (await q(SQL.remove, id)).run(); },
    async kvGet(k) { const r = await (await q(SQL.kvGet, k)).first(); return r ? r.v : null; },
    async kvSet(k, v, now) { await (await q(SQL.kvSet, k, v, now)).run(); },
    async kvDel(k) { await (await q(SQL.kvDel, k)).run(); },
    async log(kind, person, info, now) { await (await q(SQL.log, now, dayKey(now), kind, person || null, info ? String(info).slice(0, 500) : null)).run(); },
    async countDay(day, kind) { return Number(((await (await q(SQL.countDay, day, kind)).first()) || {}).n || 0); },
    async ozet() { return (((await (await q(SQL.ozet)).all()).results) || []).map(ozetSatiri); },
  };
}

export function memoryStore() {
  const people = new Map(), kv = new Map(), logs = [];
  const copy = (x) => JSON.parse(JSON.stringify(x));
  return {
    people, kv, logs,
    async listRaw(limit = INF_LIMITS.list) {
      const rows = Array.from(people.entries()).sort((a, b) => b[1].updated - a[1].updated).slice(0, limit);
      return '[' + rows.map(([id, r]) => '{"id":' + JSON.stringify(id) + ',"v":' + r.version + ',"d":' + r.data + '}').join(',') + ']';
    },
    async get(id) { const r = people.get(id); return r ? { id, v: r.version, d: JSON.parse(r.data) } : null; },
    async count() { return people.size; },
    async insert(id, d, now) {
      if (people.has(id)) throw new InfError(409, 'exists', 'Bu kişi zaten listede.');
      people.set(id, { data: JSON.stringify(d), created: now, updated: now, version: 1 });
      return { id, v: 1, d: copy(d) };
    },
    async replace(id, d, version, now) {
      const r = people.get(id);
      if (!r || r.version !== version) return false;
      people.set(id, { data: JSON.stringify(d), created: r.created, updated: now, version: r.version + 1 });
      return true;
    },
    async remove(id) { people.delete(id); },
    async kvGet(k) { return kv.has(k) ? kv.get(k) : null; },
    async kvSet(k, v) { kv.set(k, v); },
    async kvDel(k) { kv.delete(k); },
    async log(kind, person, info, now) { logs.push({ ts: now, day: dayKey(now), kind, person, info }); },
    async countDay(day, kind) { return logs.filter((l) => l.day === day && l.kind === kind).length; },
    async ozet() { return Array.from(people.entries()).map(([id, r]) => ozetHesapla(id, JSON.parse(r.data))); },
  };
}

// Read-modify-write with the version check: `fn` gets a copy of the record and returns the new one (or null for "no
// change"). Retried when another request changed the record in between.
export async function updateRecord(store, id, fn, now = Date.now()) {
  for (let i = 0; i < 4; i++) {
    const cur = await store.get(id);
    if (!cur) throw new InfError(404, 'not_found', 'Kişi listede yok; sayfayı yenile.');
    const next = await fn(JSON.parse(JSON.stringify(cur.d)), cur);
    if (!next) return cur;
    const clean = cleanRecord(next);
    clean.guncelleme = new Date(now).toISOString();
    if (await store.replace(id, clean, cur.v, now)) return { id, v: cur.v + 1, d: clean };
  }
  throw new InfError(409, 'busy', 'Kayıt aynı anda değişti; tekrar dene.');
}

export async function loadSettings(store) {
  const raw = await store.kvGet('ayar');
  let a = null;
  try { a = raw ? JSON.parse(raw) : null; } catch (e) { a = null; }
  return cleanSettings(a);
}
export async function saveSettings(store, a, now = Date.now()) {
  const s = cleanSettings(a);
  await store.kvSet('ayar', JSON.stringify(s), now);
  return s;
}
