// /admin: the Lulo Smaç! owner's panel home: sign-in, the way to the Influencer page and what the panel is set up with.
// Talks only to /admin/api on this site.
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  };
  const pad = (n) => String(n).padStart(2, '0');

  // ---------------------------------------------------------------- server
  let status = null;
  async function api(path, opts = {}) {
    let r;
    try {
      r = await fetch('/admin/api/' + path, {
        method: opts.method || 'GET',
        headers: { 'X-Lulo-Admin': '1', ...(opts.body ? { 'Content-Type': 'application/json' } : {}) },
        body: opts.body ? JSON.stringify(opts.body) : undefined,
        credentials: 'same-origin',
        cache: 'no-store',
      });
    } catch (e) {
      throw new Error('Sunucuya ulaşılamadı. İnternet bağlantını kontrol et.');
    }
    let j = null;
    try { j = await r.json(); } catch (e) { /* not JSON */ }
    if (r.status === 401 && path !== 'login') {
      showLogin(status ? 'Oturum kapandı; tekrar giriş yap.' : '');   // on a first visit it is just the sign-in
      const err = new Error('Oturum kapandı.');
      err.code = 'login';
      throw err;
    }
    if (!r.ok) {
      const err = new Error((j && j.message) || 'Sunucu hatası (' + r.status + ').');
      err.status = r.status;
      err.code = j && j.error;
      err.data = j;
      throw err;
    }
    return j;
  }

  // ---------------------------------------------------------------- small helpers
  let toastT = 0;
  function toast(text) {
    let t = document.querySelector('.toast');
    if (!t) { t = el('div', 'toast'); t.setAttribute('role', 'status'); document.body.appendChild(t); }
    t.textContent = text;
    t.hidden = false;
    clearTimeout(toastT);
    toastT = setTimeout(() => { t.hidden = true; }, 1800);
  }
  function setMsg(id, text, kind) {
    const m = $(id);
    m.className = 'msg ' + (kind || 'err');
    m.textContent = text || '';
  }

  // ---------------------------------------------------------------- views
  const VIEWS = ['v-wait', 'v-setup', 'v-login', 'v-app'];
  function show(id) {
    for (const v of VIEWS) $(v).hidden = v !== id;
    const inApp = id === 'v-app';
    $('logout').hidden = !inApp;
    $('who').hidden = !inApp;
  }
  function showSetup(missing) {
    const ul = $('missing');
    ul.textContent = '';
    for (const m of missing) ul.appendChild(el('li', null, m));
    show('v-setup');
  }
  function showLogin(message) {
    show('v-login');
    setMsg('loginMsg', message || '');
    setTimeout(() => $('pw').focus(), 50);
  }

  async function boot() {
    let h = null;
    try { h = await api('health'); } catch (e) { /* offline: try to sign in anyway */ }
    if (h && h.missing && (h.missing.includes('ADMIN_PASSWORD_HASH') || h.missing.includes('ADMIN_SESSION_KEY'))) { showSetup(h.missing); return; }
    try {
      enterApp(await api('status'));
    } catch (e) {
      if (e.code !== 'login') showLogin(e.message);
    }
  }

  $('loginForm').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const pw = $('pw').value;
    if (!pw.trim()) { setMsg('loginMsg', 'Şifreyi yaz.'); return; }
    $('loginBtn').disabled = true;
    setMsg('loginMsg', '');
    try {
      await api('login', { method: 'POST', body: { password: pw } });
      $('pw').value = '';
      enterApp(await api('status'));
    } catch (e) {
      if (e.code === 'setup') showSetup((e.data && e.data.missing) || []);
      else setMsg('loginMsg', e.message);
    } finally {
      $('loginBtn').disabled = false;
    }
  });
  $('logout').addEventListener('click', async () => {
    try { await api('logout', { method: 'POST' }); } catch (e) { /* signed out anyway */ }
    status = null;
    showLogin('Çıkış yapıldı.');
    setMsg('loginMsg', 'Çıkış yapıldı.', 'ok');
  });

  function enterApp(s) {
    status = s;
    show('v-app');
    const ends = new Date(s.sessionEnds * 1000);
    $('who').textContent = 'Oturum ' + pad(ends.getHours()) + ':' + pad(ends.getMinutes()) + "'e kadar";
    renderStatus();
  }

  // ---------------------------------------------------------------- status
  function renderStatus() {
    if (!status) return;
    const dl = $('statusList');
    dl.textContent = '';
    const row = (k, ok, good, bad) => {
      dl.append(el('dt', null, k));
      const d = el('dd');
      d.append(el('span', ok ? 'ok' : 'bad', ok ? '✓ ' + good : '✗ ' + bad));
      dl.append(d);
    };
    row('Giriş', !(status.missing && status.missing.length), 'şifre ve oturum anahtarı tamam', 'eksik: ' + (status.missing || []).join(', '));
    row('Influencer veritabanı', status.influencerDb, 'bağlı (lulo-influencer)', 'INFLUENCER_DB bağlı değil');
    row('Gmail', status.gmail, 'Google anahtarları eklendi; kutuyu Influencer → Ayarlar\'dan bağla', 'GOOGLE_CLIENT_ID ve GOOGLE_CLIENT_SECRET eksik');
    row('Claude', status.claude, 'ANTHROPIC_API_KEY eklendi', 'ANTHROPIC_API_KEY eksik (mailler şablonla yine hazırlanır)');
  }
  $('recheck').addEventListener('click', async () => {
    try { enterApp(await api('status')); toast('Güncellendi'); } catch (e) { if (e.code !== 'login') toast(e.message); }
  });

  boot();
})();
