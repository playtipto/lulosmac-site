// lulo-otomasyon: the Cloudflare Worker that drives the Influencer panel's automation (Ayarlar → Otomasyon).
// Deployed by Cloudflare Workers Builds from this folder (root directory yonetim/workers/otomasyon, see wrangler.toml, which
// also sets the cron trigger: every 10 minutes). The key is the Secret INF_CRON_KEY, set in the dashboard to the key
// made in the panel ("Anahtar oluştur"). Every run asks the panel (lulosmac-yonetim.pages.dev) to run the three steps; what each step does, and
// whether it does anything at all, is decided there (lib/otomasyon.js), so this Worker rarely needs to change.
const URL_ = 'https://lulosmac-yonetim.pages.dev/cron/influencer';
const ADIMLAR = ['kontrol', 'taslak', 'gonder'];

async function calistir(env) {
  if (!env.INF_CRON_KEY) { console.log('INF_CRON_KEY eksik'); return; }
  for (const is of ADIMLAR) {
    try {
      const r = await fetch(URL_ + '?is=' + is, { method: 'POST', headers: { authorization: 'Bearer ' + env.INF_CRON_KEY } });
      console.log(is, r.status, (await r.text()).slice(0, 300));
      if (r.status === 401) return;   // wrong key: no point calling the other steps
    } catch (e) {
      console.log(is, 'hata', String(e && e.message || e));
    }
  }
}

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(calistir(env));
  },
  async fetch() {
    return new Response('Not found', { status: 404 });
  },
};
