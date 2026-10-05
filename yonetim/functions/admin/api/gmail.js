// GET  /admin/api/gmail -> {configured, missing, connected, email, today}
// POST /admin/api/gmail {action, …}:
//   {action: 'connect'}                 -> {url}: Google's consent page (the page sends the owner there)
//   {action: 'finish', code, state}     -> {email}: Google sent the owner back to /admin/influencer/
//   {action: 'disconnect'}              -> forgets (and revokes) the Gmail permission
//   {action: 'send', id, konu, govde}   -> the first outreach mail to a person, from the connected mailbox; only to the
//                                          address on the record, once per person, within the daily limit
//   {action: 'reply', id, metin, i}     -> a reply in the person's thread (to whoever wrote last); i = the draft it replaces
//   {action: 'sync', ids}               -> reads the threads of up to 10 people and records new replies (and bounces)
//   {action: 'test'}                    -> a test mail from the mailbox to itself
import { fail, json, readJson } from '../../../lib/admin.js';
import { connectUrl, disconnect, finishConnect, gmailState, missingGmail, sendMail } from '../../../lib/gmail.js';
import { dayKey, d1Store, InfError, loadSettings } from '../../../lib/influencer.js';
import { fromNameOf, sendFirst, sendReply, sync } from '../../../lib/outreach.js';

const infFail = (e) => (e instanceof InfError ? fail(e.status, e.code, e.message) : fail(500, 'server', 'Beklenmeyen bir hata oldu.'));
const originOf = (request) => new URL(request.url).origin;

export async function onRequestGet({ env }) {
  const missing = missingGmail(env);
  if (!env.INFLUENCER_DB) return json({ configured: !missing.length, missing, connected: false, email: '' });
  try {
    const store = d1Store(env.INFLUENCER_DB);
    const [g, a, sent] = await Promise.all([gmailState(env, store), loadSettings(store), store.countDay(dayKey(), 'ilk')]);
    return json({ configured: !missing.length, missing, connected: !!(g && g.rt), email: (g && g.email) || '', since: (g && g.connected) || '', today: { sent, limit: a.gunluk } });
  } catch (e) {
    return infFail(e);
  }
}

export async function onRequestPost({ request, env }) {
  if (!env.INFLUENCER_DB) return fail(424, 'setup', 'Influencer veritabanı (INFLUENCER_DB) bağlanmamış.');
  let body;
  try {
    body = await readJson(request, 64 * 1024);
  } catch (e) {
    return fail(400, 'invalid', e.message);
  }
  if (!body || typeof body !== 'object') return fail(400, 'invalid', 'İstek boş.');
  const now = Date.now();
  try {
    const store = d1Store(env.INFLUENCER_DB);
    switch (body.action) {
      case 'connect': {
        const a = await loadSettings(store);
        return json({ url: await connectUrl(env, originOf(request), a.gonderenEmail) });
      }
      case 'finish': return json(await finishConnect(env, store, originOf(request), body.code, body.state, now));
      case 'disconnect': await disconnect(env, store); return json({ ok: true });
      case 'send': return json({ person: await sendFirst(env, store, body, now) });
      case 'reply': return json({ person: await sendReply(env, store, body, now) });
      case 'sync': return json(await sync(env, store, body, now));
      case 'test': {
        const g = await gmailState(env, store);
        if (!g || !g.email) throw new InfError(409, 'gmail_connect', 'Gmail bağlı değil; önce "Gmail\'i bağla"ya bas.');
        if ((await store.countDay(dayKey(now), 'test')) >= 10) throw new InfError(429, 'limit', 'Bugün yeterince deneme maili gitti.');
        const a = await loadSettings(store);
        const r = await sendMail(env, store, {
          to: g.email, fromName: fromNameOf(a), subject: 'Lulo Smaç! paneli: deneme maili',
          body: 'Bu mail Lulo Smaç! yönetim panelinin Influencer sayfasından gönderildi.\n\nGelen kutunda bu maili görüyorsan Gmail bağlantısı çalışıyor: influencer mailleri bu adresten gidecek, cevaplar panelde görünecek.\n\nLulo Smaç!',
        });
        await store.log('test', null, r.id, now).catch(() => {});
        return json({ to: g.email, id: r.id });
      }
      default: return fail(400, 'invalid', 'Bilinmeyen işlem.');
    }
  } catch (e) {
    return infFail(e);
  }
}
