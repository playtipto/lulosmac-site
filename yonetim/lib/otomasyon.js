// The scheduler behind Ayarlar → Otomasyon. A small Worker (lulo-otomasyon, Cloudflare cron every 10 minutes; its
// code and cron are in workers/otomasyon/) calls /cron/influencer once per step, each step its own request because the
// free plan's CPU limit is per request:
//   kontrol  reads a few sent threads (the least recently checked first): new replies and bounces land on the record
//   taslak   one Claude reply draft for a person whose last message is an unanswered reply; drafts are never sent here
//   gonder   one first mail, on weekdays between otoBas and otoBit (Istanbul), spaced so that the daily limit is reached
//            by the end of the window; same rules as the panel's Gönder (lib/outreach.js sendFirst)
// Nothing happens unless the owner turned it on: 'oto' for sending, 'otoCevap' for reading replies and drafting.
// inf_kv: 'cron' {hash, olusturma} the Worker's key (only its SHA-256), 'oto' the last runs, 'oto_kontrol' {id: when}.
import { aiReady } from './claude.js';
import { gmailState } from './gmail.js';
import { dayKey, InfError, loadSettings, updateRecord } from './influencer.js';
import { gecerliEmail } from './influencer_logic.js';
import { cevapTaslagi, sendFirst, syncOne } from './outreach.js';
import { b64u } from './bytes.js';

export const KONTROL_KISI = 6;              // threads read per run
const KONTROL_GUN = 60;                     // threads are read for this long after the first mail
const TASLAK_TEKRAR = 6 * 3600e3;           // a failed draft is tried again after this
const ARA_MIN = 12, ARA_MAX = 120;          // minutes between two automatic first mails
const KISIYE_OZEL = ['no_email', 'sent', 'archived', 'sample', 'unknown', 'busy', 'no_mail', 'not_found'];
const GMAIL_DUR = ['gmail_connect', 'gmail_setup', 'gmail_rate'];

const kvJson = (v) => { try { return v ? JSON.parse(v) : null; } catch (e) { return null; } };
const iso = (t) => new Date(t).toISOString();

// Türkiye is on UTC+3 all year
export function trSaat(now) {
  const t = new Date(now + 3 * 3600e3);
  return { gun: t.getUTCDay(), dakika: t.getUTCHours() * 60 + t.getUTCMinutes() };
}
export function pencerede(a, now) {
  const { gun, dakika } = trSaat(now);
  return gun >= 1 && gun <= 5 && dakika >= a.otoBas * 60 && dakika < a.otoBit * 60;
}

// ---------------------------------------------------------------- the Worker's key
const enc = new TextEncoder();
async function sha256hex(s) {
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(String(s))));
  return Array.from(h, (b) => b.toString(16).padStart(2, '0')).join('');
}
export async function anahtarUret(store, now) {
  const key = 'lulo_oto_' + b64u(crypto.getRandomValues(new Uint8Array(32)));
  await store.kvSet('cron', JSON.stringify({ hash: await sha256hex(key), olusturma: iso(now) }), now);
  return key;
}
export async function anahtarDogru(store, key) {
  key = String(key || '');
  if (key.length < 20 || key.length > 200) return false;
  const kayit = kvJson(await store.kvGet('cron'));
  if (!kayit || typeof kayit.hash !== 'string') return false;
  const h = await sha256hex(key);
  let fark = h.length ^ kayit.hash.length;
  for (let i = 0; i < h.length; i++) fark |= h.charCodeAt(i) ^ (kayit.hash.charCodeAt(i) || 0);
  return fark === 0;
}
export async function anahtarBilgisi(store) {
  const kayit = kvJson(await store.kvGet('cron'));
  return kayit && kayit.hash ? { var: true, olusturma: kayit.olusturma || '' } : { var: false, olusturma: '' };
}

// ---------------------------------------------------------------- state
export async function durumOku(store) { return kvJson(await store.kvGet('oto')) || {}; }
export async function durumYaz(store, yama, now) {
  const s = Object.assign(await durumOku(store), yama);
  await store.kvSet('oto', JSON.stringify(s), now);
  return s;
}

// ---------------------------------------------------------------- gonder
// who goes next: approved first, then the highest fit score, then the oldest on the list
export function siradakiler(rows, a) {
  const izinli = a.otoKapsam === 'onay' ? ['onay'] : ['onay', 'hazir'];
  return rows
    .filter((r) => izinli.includes(r.durum) && gecerliEmail(r.email) && !r.gonderim && !r.belirsiz && !r.ornek && r.mailVar)
    .sort((x, y) => (x.durum === 'onay' ? 0 : 1) - (y.durum === 'onay' ? 0 : 1) || y.puan - x.puan
      || String(x.eklenme).localeCompare(String(y.eklenme)) || x.id.localeCompare(y.id))
    .map((r) => r.id);
}
// minutes until the next automatic mail: what is left of today's window shared by what is left of today's limit
export function aralik(a, now, giden, rnd = Math.random()) {
  const kalanDk = Math.max(0, a.otoBit * 60 - trSaat(now).dakika);
  const kalanKota = Math.max(1, a.gunluk - giden);
  const dk = Math.min(ARA_MAX, Math.max(ARA_MIN, kalanDk / kalanKota));
  return dk * (0.85 + 0.3 * rnd);
}

export async function adimGonder(env, store, now) {
  const a = await loadSettings(store);
  if (!a.oto) return { atla: 'kapali' };
  if (!pencerede(a, now)) return { atla: 'saat_disi' };
  const g = await gmailState(env, store);
  if (!g || !g.rt) return { atla: 'gmail_yok' };
  let giden = await store.countDay(dayKey(now), 'ilk');
  if (giden >= a.gunluk) return { atla: 'limit' };
  const s = await durumOku(store);
  if (s.sonraki && now < Date.parse(s.sonraki)) return { atla: 'bekle', sonraki: s.sonraki };
  const ids = siradakiler(await store.ozet(), a);
  if (!ids.length) return { atla: 'aday_yok' };
  for (const id of ids.slice(0, 3)) {
    try {
      const p = await sendFirst(env, store, { id, tazele: true }, now);
      giden++;
      const sonraki = iso(now + aralik(a, now, giden) * 60000);
      await durumYaz(store, { sonGonderim: { id, ad: (p && p.d && p.d.ad) || id, tarih: iso(now) }, sonraki }, now);
      return { gonderildi: id, sonraki };
    } catch (e) {
      if (e instanceof InfError && KISIYE_OZEL.includes(e.code)) continue;   // only this person: try the next one
      throw e;                                                                // Gmail, the limit…: stop until the next run
    }
  }
  return { atla: 'aday_yok' };
}

// ---------------------------------------------------------------- kontrol
export async function adimKontrol(env, store, now) {
  const a = await loadSettings(store);
  if (!a.otoCevap) return { atla: 'kapali' };
  const g = await gmailState(env, store);
  if (!g || !g.rt) return { atla: 'gmail_yok' };
  const once = kvJson(await store.kvGet('oto_kontrol')) || {};
  const sinir = now - KONTROL_GUN * 864e5;
  const rows = (await store.ozet()).filter((r) => !r.ornek && r.durum !== 'arsiv' && ((r.gonderim && Date.parse(r.gonderim) > sinir) || r.belirsiz));
  rows.sort((x, y) => (once[x.id] || 0) - (once[y.id] || 0) || x.id.localeCompare(y.id));
  let yeni = 0, bakilan = 0;
  try {
    for (const r of rows.slice(0, KONTROL_KISI)) {
      try {
        yeni += (await syncOne(env, store, r.id, now)).yeni;
      } catch (e) {
        if (e instanceof InfError && GMAIL_DUR.includes(e.code)) throw e;
      }
      once[r.id] = now;
      bakilan++;
    }
  } finally {
    const kalan = {};
    for (const r of rows) if (once[r.id]) kalan[r.id] = once[r.id];
    await store.kvSet('oto_kontrol', JSON.stringify(kalan), now);
  }
  if (yeni) await durumYaz(store, { sonCevap: { sayi: yeni, tarih: iso(now) } }, now);
  return { bakilan, yeni };
}

// ---------------------------------------------------------------- taslak
export async function adimTaslak(env, store, now) {
  const a = await loadSettings(store);
  if (!a.otoCevap) return { atla: 'kapali' };
  if (!aiReady(env)) return { atla: 'claude_yok' };
  const s = await durumOku(store);
  const denenen = s.taslakDenenen || {};
  const r = (await store.ozet()).find((x) => x.durum === 'cevap' && x.sonYon === 'gelen' && !x.sonHata && !x.sonOto
    && !(denenen[x.id] && denenen[x.id].gmailId === x.sonGmailId && now - Date.parse(denenen[x.id].tarih) < TASLAK_TEKRAR));
  if (!r) return { atla: 'yok' };
  const cur = await store.get(r.id);
  if (!cur) return { atla: 'yok' };
  denenen[r.id] = { gmailId: r.sonGmailId, tarih: iso(now) };
  await durumYaz(store, { taslakDenenen: denenen }, now);   // a failing draft is not retried every 10 minutes
  const t = await cevapTaslagi(env, cur.d, a);
  let yazildi = false;
  await updateRecord(store, r.id, (d) => {
    const y = (d.yazisma || []).slice();
    const son = y[y.length - 1];
    if (!son || son.yon !== 'gelen' || son.teslimHatasi || son.otomatik || (son.gmailId || '') !== r.sonGmailId) return null;   // changed meanwhile
    if (t.ozet && !son.ozet) y[y.length - 1] = Object.assign({}, son, { ozet: t.ozet });
    y.push({ yon: 'taslak', tarih: iso(now), metin: t.govde, kaynak: 'claude', oto: true, oneri: t.durum });
    d.yazisma = y;
    yazildi = true;
    return d;
  }, now);
  if (yazildi) {
    delete denenen[r.id];
    await durumYaz(store, { taslakDenenen: denenen, sonTaslak: { id: r.id, ad: cur.d.ad || r.id, tarih: iso(now) } }, now);
  }
  return yazildi ? { taslak: r.id } : { atla: 'degisti' };
}

export const ADIMLAR = { gonder: adimGonder, kontrol: adimKontrol, taslak: adimTaslak };

// one step, with its outcome kept for the panel ("Son çalışma …")
export async function calistir(env, store, is, now) {
  const adim = ADIMLAR[is];
  if (!adim) throw new InfError(400, 'invalid', 'Bilinmeyen adım.');
  try {
    const sonuc = await adim(env, store, now);
    const yama = { sonCalisma: iso(now), ['son_' + is]: Object.assign({ tarih: iso(now) }, sonuc) };
    const s = await durumOku(store);
    if (s.hata && s.hata.adim === is) yama.hata = null;   // this step works again
    await durumYaz(store, yama, now);
    return sonuc;
  } catch (e) {
    const hata = e instanceof InfError ? { kod: e.code, mesaj: e.message } : { kod: 'server', mesaj: 'Beklenmeyen bir hata oldu.' };
    await durumYaz(store, { sonCalisma: iso(now), hata: Object.assign({ adim: is, tarih: iso(now) }, hata) }, now).catch(() => {});
    throw e;
  }
}
