// GET  /admin/api/influencer -> {missing, people: [{id, v, d}], settings, gmail, ai, today}: everything the page shows
// POST /admin/api/influencer {action, …} -> changes to the list and the settings:
//   {action: 'create', id, data}          a new person (computed fields are filled like the page does)
//   {action: 'patch', id, patch}          merges into the record (mail and gonderim merge one level deep)
//   {action: 'delete', id}
//   {action: 'bulk', ops: [{op, id, data | patch}]}   up to 25 creates/patches/deletes per call (imports, backups)
//   {action: 'settings', settings}        saves the page settings
//   {action: 'cronKey'}                   a new key for the scheduler's Worker, shown once (only its hash is kept)
import { fail, json, readJson } from '../../../lib/admin.js';
import { aiReady, modelOf } from '../../../lib/claude.js';
import { gmailState, missingGmail } from '../../../lib/gmail.js';
import { d1Store, dayKey, INF_LIMITS, InfError, loadSettings, mergePatch, prepareNew, saveSettings, updateRecord, validId } from '../../../lib/influencer.js';
import { anahtarBilgisi, anahtarUret, durumOku } from '../../../lib/otomasyon.js';

const infFail = (e) => (e instanceof InfError ? fail(e.status, e.code, e.message) : fail(500, 'server', 'Beklenmeyen bir hata oldu.'));

export async function onRequestGet({ env }) {
  const missing = [];
  if (!env.INFLUENCER_DB) missing.push('INFLUENCER_DB');
  const gmailMissing = missingGmail(env);
  const ai = { configured: aiReady(env), model: modelOf(env) };
  if (missing.length) return json({ missing, people: [], settings: null, gmail: { configured: !gmailMissing.length, missing: gmailMissing, connected: false }, ai, today: { sent: 0 } });
  try {
    const store = d1Store(env.INFLUENCER_DB);
    const [raw, settings, g, sent, anahtar, durum] = await Promise.all([store.listRaw(), loadSettings(store), gmailState(env, store), store.countDay(dayKey(), 'ilk'), anahtarBilgisi(store), durumOku(store)]);
    const gmail = { configured: !gmailMissing.length, missing: gmailMissing, connected: !!(g && g.rt), email: (g && g.email) || '', since: (g && g.connected) || '' };
    delete durum.taslakDenenen;
    const head = JSON.stringify({ missing, settings, gmail, ai, today: { sent, limit: settings.gunluk, day: dayKey() }, oto: { anahtar, durum } });
    return new Response(head.slice(0, -1) + ',"people":' + raw + '}', { headers: { 'Content-Type': 'application/json; charset=utf-8' } });
  } catch (e) {
    return infFail(e);
  }
}

async function applyOp(store, settings, op, now) {
  const id = op && op.id;
  if (!validId(id)) throw new InfError(400, 'invalid', 'Geçersiz kişi kimliği.');
  if (op.op === 'create') {
    if ((await store.count()) >= INF_LIMITS.people) throw new InfError(409, 'full', `Liste dolu (en fazla ${INF_LIMITS.people} kişi). Arşivdekileri silip yer aç.`);
    return store.insert(id, prepareNew(op.data, settings, new Date(now).toISOString()), now);
  }
  if (op.op === 'patch') return updateRecord(store, id, (d) => mergePatch(d, op.patch), now);
  if (op.op === 'delete') { await store.remove(id); return { id, deleted: true }; }
  throw new InfError(400, 'invalid', 'Bilinmeyen işlem.');
}

export async function onRequestPost({ request, env }) {
  if (!env.INFLUENCER_DB) return fail(424, 'setup', 'Influencer veritabanı (INFLUENCER_DB) bağlanmamış.');
  let body;
  try {
    body = await readJson(request, 2 * 1024 * 1024);
  } catch (e) {
    return fail(400, 'invalid', e.message);
  }
  if (!body || typeof body !== 'object') return fail(400, 'invalid', 'İstek boş.');
  const now = Date.now();
  try {
    const store = d1Store(env.INFLUENCER_DB);
    if (body.action === 'settings') return json({ settings: await saveSettings(store, body.settings, now) });
    if (body.action === 'cronKey') return json({ key: await anahtarUret(store, now), anahtar: await anahtarBilgisi(store) });
    const settings = await loadSettings(store);
    if (body.action === 'create' || body.action === 'patch' || body.action === 'delete') {
      return json(await applyOp(store, settings, { op: body.action, id: body.id, data: body.data, patch: body.patch }, now));
    }
    if (body.action === 'bulk') {
      const ops = Array.isArray(body.ops) ? body.ops : [];
      if (!ops.length || ops.length > INF_LIMITS.bulk) return fail(400, 'invalid', `Tek seferde 1–${INF_LIMITS.bulk} işlem.`);
      const results = [];
      for (const op of ops) {
        try {
          results.push(await applyOp(store, settings, op, now));
        } catch (e) {
          results.push({ id: op && op.id, error: e instanceof InfError ? e.code : 'server', message: e instanceof InfError ? e.message : 'Beklenmeyen bir hata oldu.' });
        }
      }
      return json({ results });
    }
    return fail(400, 'invalid', 'Bilinmeyen işlem.');
  } catch (e) {
    return infFail(e);
  }
}
