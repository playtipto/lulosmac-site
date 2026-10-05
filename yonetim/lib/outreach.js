// Outreach mail through the connected Gmail: the first mail to a person, replies in their thread, and reading the
// threads back (new replies, bounces). Used by the panel's endpoint (functions/admin/api/gmail.js) and by the
// scheduler (functions/cron/influencer.js), so both follow the same rules: only to the address on the record, the first
// mail once per person (a lock on the record), the daily limit, nothing to sample records.
import { askJson } from './claude.js';
import { addrOf, findSentThread, readThread, sendMail } from './gmail.js';
import { dayKey, InfError, loadSettings, updateRecord, validId } from './influencer.js';
import { alintiyiAt, cevapPromptu, gecerliEmail, GIDILDI, mailUret, sablondanMi } from './influencer_logic.js';

export const REPLIES_PER_DAY = 200;
export const LOCK_MS = 120000;
export const OTO_MS = 120000;   // a mail of ours this soon after theirs was written by a machine, not by us
export const fromNameOf = (a) => (String(a.gonderenAd || '').trim() ? String(a.gonderenAd).trim() + ' · Lulo Smaç!' : 'Lulo Smaç!');
export const reSubject = (s) => 'Re: ' + String(s || '').replace(/^\s*((re|ynt|yanıt|aw|fwd?|ilt)\s*:\s*)+/i, '').trim();

// ---------------------------------------------------------------- the first mail
export async function sendFirst(env, store, body, now) {
  const id = body.id;
  if (!validId(id)) throw new InfError(400, 'invalid', 'Geçersiz kişi kimliği.');
  const a = await loadSettings(store);
  const sent = await store.countDay(dayKey(now), 'ilk');
  if (sent >= a.gunluk) throw new InfError(429, 'limit', `Bugünkü gönderim sınırı doldu (${a.gunluk}). Yarın devam edebilir ya da Ayarlar'dan sınırı artırabilirsin.`);
  const konuIn = String(body.konu || '').trim(), govdeIn = String(body.govde || '').trim();
  const nowIso = new Date(now).toISOString();
  let target = null, konu = '', govde = '';
  // take the sending lock first, so a double click or a second tab can never send twice
  await updateRecord(store, id, (d) => {
    if (d.ornek) throw new InfError(400, 'sample', 'Örnek kayıtlara mail gönderilmez.');
    if (!gecerliEmail(d.email)) throw new InfError(400, 'no_email', 'Bu kişinin geçerli bir e-posta adresi yok.');
    if (d.gonderim || GIDILDI.includes(d.durum)) throw new InfError(409, 'sent', 'Bu kişiye ilk mail zaten gönderilmiş.');
    if (d.durum === 'arsiv') throw new InfError(409, 'archived', 'Arşivdeki kişiye mail gönderilmez; önce arşivden çıkar.');
    if (d.gonderimBelirsiz) throw new InfError(409, 'unknown', 'Önceki denemenin sonucu belli değil; önce "Gmail\'den kontrol et"e bas.');
    if (d.gonderiliyor && now - Date.parse(d.gonderiliyor) < LOCK_MS) throw new InfError(409, 'busy', 'Bu mail şu an gönderiliyor.');
    // the scheduler sends what is stored, with nobody looking at it: a template mail is rebuilt from today's settings
    // first, so a setting changed since (the App Store link on launch day) is never missed
    if (body.tazele && !konuIn && !govdeIn && sablondanMi(d)) d.mail = Object.assign({}, d.mail || {}, mailUret(d, a), { uretim: 'sablon', tarih: nowIso });
    konu = konuIn || (d.mail && d.mail.konu) || '';
    govde = govdeIn || (d.mail && d.mail.govde) || '';
    if (!konu || !govde) throw new InfError(400, 'no_mail', 'Mailin konusu ya da metni boş.');
    target = d.email.trim().toLowerCase();
    d.gonderiliyor = nowIso;
    d.mail = Object.assign({}, d.mail || {}, { konu, govde });
    return d;
  }, now);
  let r;
  try {
    r = await sendMail(env, store, { to: target, subject: konu, body: govde, fromName: fromNameOf(a) });
  } catch (e) {
    const unknown = e instanceof InfError && e.code === 'gmail_down';
    await updateRecord(store, id, (d) => { d.gonderiliyor = ''; if (unknown) d.gonderimBelirsiz = nowIso; return d; }).catch(() => {});
    if (unknown) throw new InfError(424, 'gmail_unknown', 'Gmail cevap vermedi; mail gitmiş olabilir. Gmail\'de Gönderilenler\'e bak ya da "Gmail\'den kontrol et"e bas, panel kendisi eşleştirir.');
    throw e;
  }
  await store.log('ilk', id, r.id, now).catch(() => {});
  return updateRecord(store, id, (d) => {
    d.gonderiliyor = '';
    d.gonderimBelirsiz = '';
    d.durum = 'gonderildi';
    d.gonderim = { tarih: nowIso, kanal: 'gmail', threadId: r.threadId, messageId: r.id };
    d.yazisma = (d.yazisma || []).concat([{ yon: 'giden', tarih: nowIso, konu, metin: govde, kaynak: 'gmail', gmailId: r.id, threadId: r.threadId }]);
    return d;
  }, now);
}

// ---------------------------------------------------------------- replies
export async function sendReply(env, store, body, now) {
  const id = body.id;
  if (!validId(id)) throw new InfError(400, 'invalid', 'Geçersiz kişi kimliği.');
  const metin = String(body.metin || '').replace(/\r\n/g, '\n').trim();
  if (!metin) throw new InfError(400, 'invalid', 'Cevap boş.');
  if (metin.length > 20000) throw new InfError(413, 'too_large', 'Cevap çok uzun.');
  if ((await store.countDay(dayKey(now), 'cevap')) >= REPLIES_PER_DAY) throw new InfError(429, 'limit', 'Bugün çok fazla cevap gönderildi; yarın devam et.');
  const cur = await store.get(id);
  if (!cur) throw new InfError(404, 'not_found', 'Kişi listede yok; sayfayı yenile.');
  const d = cur.d;
  if (d.ornek) throw new InfError(400, 'sample', 'Örnek kayıtlara mail gönderilmez.');
  const gelen = (d.yazisma || []).slice().reverse().find((e) => e.yon === 'gelen' && !e.teslimHatasi);
  const threadId = (gelen && gelen.threadId) || (d.gonderim && d.gonderim.threadId) || '';
  const to = (gelen && (addrOf(gelen.yanitla) || addrOf(gelen.kimden))) || String(d.email || '').trim().toLowerCase();
  if (!gecerliEmail(to)) throw new InfError(400, 'no_email', 'Cevabın gideceği adres bulunamadı.');
  const konu = reSubject((gelen && gelen.konu) || (d.mail && d.mail.konu) || 'Lulo Smaç!');
  const a = await loadSettings(store);
  const inReplyTo = gelen && gelen.rfcId ? gelen.rfcId : '';
  const references = inReplyTo ? ((gelen.references ? gelen.references + ' ' : '') + inReplyTo) : '';
  const r = await sendMail(env, store, { to, subject: konu, body: metin, fromName: fromNameOf(a), threadId, inReplyTo, references });
  await store.log('cevap', id, r.id, now).catch(() => {});
  const nowIso = new Date(now).toISOString();
  const i = Number.isInteger(body.i) ? body.i : -1;
  return updateRecord(store, id, (x) => {
    const y = (x.yazisma || []).slice();
    const entry = { yon: 'giden', tarih: nowIso, konu, metin, kaynak: 'gmail', gmailId: r.id, threadId: r.threadId };
    if (i >= 0 && y[i] && y[i].yon === 'taslak') y[i] = entry; else y.push(entry);
    x.yazisma = y;
    if (x.durum === 'cevap') x.durum = 'gonderildi';
    if (!x.gonderim) x.gonderim = { tarih: nowIso, kanal: 'gmail', threadId: r.threadId, messageId: r.id };
    return x;
  }, now);
}

// ---------------------------------------------------------------- reading threads
export async function syncOne(env, store, id, now) {
  const cur = await store.get(id);
  if (!cur) return { person: null, yeni: 0 };
  const d0 = cur.d;
  if (d0.ornek || !gecerliEmail(d0.email)) return { person: cur, yeni: 0 };
  let threadId = (d0.gonderim && d0.gonderim.threadId) || '';
  if (!threadId && (d0.gonderim || d0.gonderimBelirsiz)) threadId = await findSentThread(env, store, d0.email);
  if (!threadId) {
    // an unclear send that never reached Sent (checked a couple of minutes later): it did not go, so it may be sent again
    if (d0.gonderimBelirsiz && !d0.gonderim && now - Date.parse(d0.gonderimBelirsiz) > LOCK_MS) {
      return { person: await updateRecord(store, id, (d) => { d.gonderimBelirsiz = ''; return d; }, now), yeni: 0 };
    }
    return { person: cur, yeni: 0 };
  }
  const msgs = await readThread(env, store, threadId);
  let yeni = 0;
  const person = await updateRecord(store, id, (d) => {
    const y = (d.yazisma || []).slice();
    const known = new Set(y.map((e) => e.gmailId).filter(Boolean));
    if (d.gonderim && d.gonderim.messageId) known.add(d.gonderim.messageId);
    let changed = false, firstMine = null, gelenYeni = 0, onceki = null;
    for (const m of msgs) {
      // an automatic reply: theirs (out of office) is kept but is not an answer; ours (a vacation responder left on in
      // Gmail, answering seconds after their mail even without the headers) is not part of the conversation at all
      const oto = m.otomatik || (m.mine && !!onceki && !onceki.mine && Date.parse(m.tarih) - Date.parse(onceki.tarih) < OTO_MS);
      onceki = m;
      if (m.mine && oto) continue;
      if (m.mine && !firstMine) firstMine = m;
      if (!m.gmailId || known.has(m.gmailId)) continue;
      known.add(m.gmailId);
      changed = true;
      if (m.mine) {
        // a mail marked as sent by hand: attach the Gmail copy instead of adding it twice
        const t = Date.parse(m.tarih);
        const el = y.find((e) => e.yon === 'giden' && !e.gmailId && Math.abs(Date.parse(e.tarih) - t) < 15 * 60000);
        if (el) Object.assign(el, { gmailId: m.gmailId, threadId: m.threadId });
        else y.push({ yon: 'giden', tarih: m.tarih, konu: m.konu, metin: alintiyiAt(m.metin), kaynak: 'gmail', gmailId: m.gmailId, threadId: m.threadId });
      } else {
        const e = { yon: 'gelen', tarih: m.tarih, konu: m.konu, metin: alintiyiAt(m.metin), kaynak: 'gmail', gmailId: m.gmailId, threadId: m.threadId, kimden: m.kimden, rfcId: m.rfcId };
        if (m.yanitla) e.yanitla = m.yanitla;
        if (m.references) e.references = m.references;
        if (m.teslimHatasi) {
          e.teslimHatasi = true;
          d.teslim = { hata: true, tarih: m.tarih, metin: m.metin.slice(0, 400) };
        } else if (oto) e.otomatik = true;
        else gelenYeni++;
        y.push(e);
      }
    }
    if (!d.gonderim && firstMine) { d.gonderim = { tarih: firstMine.tarih, kanal: 'gmail', threadId, messageId: firstMine.gmailId }; changed = true; }
    else if (d.gonderim && !d.gonderim.threadId) { d.gonderim = Object.assign({}, d.gonderim, { threadId }); changed = true; }
    if (d.gonderimBelirsiz && firstMine) {
      d.gonderimBelirsiz = '';
      if (!GIDILDI.includes(d.durum)) d.durum = 'gonderildi';
      changed = true;
    }
    if (gelenYeni && !['anlasildi', 'olumsuz', 'arsiv'].includes(d.durum)) d.durum = 'cevap';
    if (!changed) return null;
    yeni = gelenYeni;
    d.yazisma = y.sort((a, b) => String(a.tarih).localeCompare(String(b.tarih)));
    return d;
  }, now);
  return { person, yeni };
}

export async function sync(env, store, body, now) {
  const ids = Array.isArray(body.ids) ? body.ids.filter(validId).slice(0, 10) : [];
  if (!ids.length) throw new InfError(400, 'invalid', 'Kontrol edilecek kişi yok.');
  const people = [], errors = [];
  let yeni = 0;
  for (const id of ids) {
    try {
      const r = await syncOne(env, store, id, now);
      if (r.person) people.push(r.person);
      yeni += r.yeni;
    } catch (e) {
      if (e instanceof InfError && ['gmail_connect', 'gmail_setup', 'gmail_rate'].includes(e.code)) throw e;   // no point going on
      errors.push({ id, error: e instanceof InfError ? e.code : 'server', message: e instanceof InfError ? e.message : 'Beklenmeyen bir hata oldu.' });
    }
  }
  return { people, yeni, errors };
}

// ---------------------------------------------------------------- Claude's answers
// Shapes of Claude's answers (structured output, see askJson): every property required, nothing extra
const obj = (properties) => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
const str = { type: 'string' };
const orNull = (type) => ({ anyOf: [{ type }, { type: 'null' }] });
export const SEMALAR = {
  kisisel: obj({ konu: str, govde: str }),
  cevap: obj({ govde: str, ozet: str, durum: { type: 'string', enum: ['cevap', 'anlasildi', 'olumsuz'] } }),
  ekran: obj({
    hesaplar: {
      type: 'array',
      items: obj({
        platform: str, handle: str, ad: orNull('string'), takipci: orNull('integer'), etkilesim: orNull('number'), bio: orNull('string'),
        email: orNull('string'), kategori: orNull('string'), sehir: orNull('string'), ulke: orNull('string'), web: orNull('string'),
        gorsel: { type: 'array', items: { type: 'integer' } },
      }),
    },
  }),
};
export const kirp = (v, max) => String(v == null ? '' : v).replace(/\r\n/g, '\n').trim().slice(0, max);

// A reply draft to the person's last mail: {govde, ozet (a one-line Turkish summary of their mail), durum (Claude's read)}
export async function cevapTaslagi(env, d, a) {
  if (!(d.yazisma || []).some((e) => e.yon === 'gelen' && !e.otomatik && !e.teslimHatasi)) throw new InfError(400, 'invalid', 'Cevaplanacak gelen mail yok.');
  const r = await askJson(env, cevapPromptu(d, a), { maxTokens: 4096, schema: SEMALAR.cevap });
  const govde = kirp(r && r.govde, 20000);
  if (!govde) throw new InfError(424, 'ai_json', 'Claude boş döndü; tekrar dene.');
  return { govde, ozet: kirp(r && r.ozet, 300), durum: ['cevap', 'anlasildi', 'olumsuz'].includes(r && r.durum) ? r.durum : 'cevap' };
}
