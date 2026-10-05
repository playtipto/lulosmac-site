// POST /cron/influencer?is=kontrol|taslak|gonder   (Authorization: Bearer <key>)
// The lulo-otomasyon Worker calls this every 10 minutes, once per step (lib/otomasyon.js). The key is made in the
// panel (Ayarlar → Otomasyon → Anahtar oluştur) and kept as the Worker's INF_CRON_KEY secret; only its hash is stored.
// Outside /admin on purpose: no session here, the key is the only way in. Each step does nothing while the owner has
// that part of the automation turned off.
import { fail, json } from '../../lib/admin.js';
import { d1Store, InfError } from '../../lib/influencer.js';
import { anahtarDogru, calistir } from '../../lib/otomasyon.js';

const bearer = (request) => String(request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();

export async function onRequestPost({ request, env }) {
  if (!env.INFLUENCER_DB) return fail(424, 'setup', 'Influencer veritabanı (INFLUENCER_DB) bağlanmamış.');
  const now = Date.now();
  try {
    const store = d1Store(env.INFLUENCER_DB);
    if (!(await anahtarDogru(store, bearer(request)))) return fail(401, 'key', 'Anahtar geçersiz.');
    const is = new URL(request.url).searchParams.get('is') || '';
    return json(Object.assign({ is }, await calistir(env, store, is, now)));
  } catch (e) {
    return e instanceof InfError ? fail(e.status, e.code, e.message) : fail(500, 'server', 'Beklenmeyen bir hata oldu.');
  }
}
