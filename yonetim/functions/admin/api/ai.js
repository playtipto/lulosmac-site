// GET  /admin/api/ai -> {configured, model}
// POST /admin/api/ai {kind, …} -> asks Claude (Anthropic API, secret ANTHROPIC_API_KEY); nothing is saved here, the page
// shows the answer and saves what the owner keeps:
//   {kind: 'ekran', images: [{type, data}]}  -> {profiles}: accounts read from profile screenshots (base64, ≤ 8 per call)
//   {kind: 'kisisel', id}                    -> {konu, govde}: the person's mail rewritten for them
//   {kind: 'cevap', id}                      -> {govde, ozet, durum}: a reply draft to the person's last mail
import { fail, json, readJson } from '../../../lib/admin.js';
import { AI_LIMITS, aiReady, askJson, checkImages, modelOf } from '../../../lib/claude.js';
import { d1Store, InfError, loadSettings, validId } from '../../../lib/influencer.js';
import { ekranPromptu, kisiselPromptu, mailUret } from '../../../lib/influencer_logic.js';
import { cevapTaslagi, kirp as text, SEMALAR } from '../../../lib/outreach.js';

const infFail = (e) => (e instanceof InfError ? fail(e.status, e.code, e.message) : fail(500, 'server', 'Beklenmeyen bir hata oldu.'));

export function onRequestGet({ env }) {
  return json({ configured: aiReady(env), model: modelOf(env) });
}

export async function onRequestPost({ request, env }) {
  if (!aiReady(env)) return fail(424, 'ai_setup', 'Claude için Cloudflare\'de ANTHROPIC_API_KEY eksik.');
  let body;
  try {
    body = await readJson(request, AI_LIMITS.body);
  } catch (e) {
    return fail(400, 'invalid', e.message);
  }
  if (!body || typeof body !== 'object') return fail(400, 'invalid', 'İstek boş.');
  try {
    if (body.kind === 'ekran') {
      const images = checkImages(body.images);
      const r = await askJson(env, ekranPromptu(images.length), { images, maxTokens: 8000, schema: SEMALAR.ekran });
      const list = Array.isArray(r) ? r : ((r && (r.hesaplar || r.profiller || r.accounts)) || []);
      return json({ profiles: list.filter((p) => p && typeof p === 'object').slice(0, 40) });
    }
    if (body.kind !== 'kisisel' && body.kind !== 'cevap') return fail(400, 'invalid', 'Bilinmeyen istek.');
    if (!env.INFLUENCER_DB) return fail(424, 'setup', 'Influencer veritabanı (INFLUENCER_DB) bağlanmamış.');
    if (!validId(body.id)) return fail(400, 'invalid', 'Geçersiz kişi kimliği.');
    const store = d1Store(env.INFLUENCER_DB);
    const [cur, a] = await Promise.all([store.get(body.id), loadSettings(store)]);
    if (!cur) return fail(404, 'not_found', 'Kişi listede yok; sayfayı yenile.');
    const d = cur.d;
    if (body.kind === 'kisisel') {
      const m = d.mail && d.mail.govde ? d.mail : mailUret(d, a);
      const r = await askJson(env, kisiselPromptu(d, a, m), { maxTokens: 4096, schema: SEMALAR.kisisel });
      const govde = text(r && r.govde, 20000);
      if (!govde) throw new InfError(424, 'ai_json', 'Claude boş döndü; tekrar dene.');
      return json({ konu: text((r && r.konu) || m.konu, 400), govde });
    }
    return json(await cevapTaslagi(env, d, a));
  } catch (e) {
    return infFail(e);
  }
}
