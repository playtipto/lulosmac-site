// /admin/influencer: the Influencer page of the Lulo Smaç! owner's panel. Candidates come from profile screenshots
// (read by Claude), a Modash CSV or by hand; each gets a personal outreach mail from the templates in
// lib/influencer_logic.js (bundled above this code by tools/build_influencer.py). Mails and replies go through the
// connected Gmail; everything is saved in D1. Talks only to /admin/api on this site.

const $ = (s, r) => (r || document).querySelector(s);
const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const simdi = () => new Date().toISOString();
const bekle = (ms) => new Promise((r) => setTimeout(r, ms));
const TARIH = new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const GUN = new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'short' });
const fmtTarih = (iso) => { try { return iso ? TARIH.format(new Date(iso)) : ''; } catch (e) { return ''; } };
const nisK = (d) => 'n-' + (d && NISLER[d.nis] ? d.nis : 'diger');
const pad2 = (n) => String(n).padStart(2, '0');
const webLink = (u) => (/^https?:\/\//i.test(String(u || '')) ? String(u) : '');

const PUAN_ALAN = new Set(['nis', 'etkilesim', 'takipci', 'email', 'sehir', 'ulke', 'bio']);
const SABLON_ALAN = new Set(['hitapAdi', 'ad', 'nis', 'dil', 'hitap', 'sehir', 'ulke', 'bio', 'kisisel']);
const GORSEL = { tipler: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'], grup: 6, kenar: 1568 };

const S = {
  hazir: false, adaylar: new Map(), ayar: Object.assign({}, AYAR_VARSAYILAN),
  gmail: { configured: false, missing: [], connected: false, email: '' },
  ai: { configured: false, model: '' },
  today: { sent: 0, limit: 20, day: '' },
  tab: 'adaylar', filtre: 'hepsi', ara: '', sirala: 'puan',
  acik: null, sonOdak: null, mailSekme: 'eposta', silOnay: false, sablonOnay: false, ornekSilOnay: false,
  inceleme: null, isler: {}, durumOneri: {},
  oneriSecim: new Set(), oneriGorulen: new Set(), eskiMailler: [], onizDil: 'tr',
  gonderOnay: null, topluOnay: false, toplu: null, kontrol: null, tlOnay: null, yeniGiden: new Set(), sonKontrol: null,
  kesOnay: false, sonYukleme: 0,
  oto: { anahtar: { var: false, olusturma: '' }, durum: {} }, yeniAnahtar: '', anahtarOnay: false,
};

/* ---------- küçük yardımcılar ---------- */

function bas(d) {
  const t = temizAd(d.ad || '').replace(/^@/, '');
  const p = t.split(/\s+/).filter((x) => /\p{L}/u.test(x));
  const s = p.length >= 2 ? p[0][0] + p[1][0] : (p[0] || d.handle || '?').slice(0, 2);
  return s.toLocaleUpperCase('tr');
}
function sablonMu(d) {
  return sablondanMi(d);
}
function skorHtml(p) {
  const v = typeof p === 'number' ? Math.max(0, Math.min(100, p)) : 0;
  return `<span class="score"><span class="bar"><i data-w="${v}"></i></span><b>${typeof p === 'number' ? p : '–'}</b></span>`;
}
function ilerlemeHtml(bitti, toplam, etiket, kimlik) {
  const v = Math.round(bitti / Math.max(1, toplam) * 100);
  return `<div class="ilerleme" role="progressbar"${etiket ? ` aria-label="${esc(etiket)}"` : ''} aria-valuemin="0" aria-valuemax="${toplam}" aria-valuenow="${bitti}"><i${kimlik ? ` id="${kimlik}"` : ''} data-w="${v}"></i></div>`;
}
// bar widths come from script: the admin CSP allows no inline styles
function genislik(kok) {
  for (const el of $$('[data-w]', kok || document)) el.style.width = Math.max(0, Math.min(100, Number(el.dataset.w) || 0)) + '%';
}
function pillHtml(k) { return `<span class="pill s-${esc(k)}">${esc(DURUM_AD[k] || k)}</span>`; }
function avHtml(d, cls) { return `<span class="av ${nisK(d)} ${cls || ''}" aria-hidden="true">${esc(bas(d))}</span>`; }
function ulasmadiHtml(d) { return d.teslim && d.teslim.hata ? '<em class="etiket-kotu">ULAŞMADI</em>' : ''; }
function tumu() { return Array.from(S.adaylar.entries()).map(([id, d]) => Object.assign({ id }, d)); }
const puanaGore = (a, b) => (b.puan || 0) - (a.puan || 0);

let toastZ = 0;
function toast(t) {
  const el = $('#toast');
  el.textContent = t;
  el.classList.add('on');
  clearTimeout(toastZ);
  toastZ = setTimeout(() => el.classList.remove('on'), 3600);
}
let kayitZ = 0;
function kayitYaz(t) {
  const el = $('#kayitDurum');
  if (!el) return;
  el.textContent = t;
  clearTimeout(kayitZ);
  if (t === 'Kaydedildi') kayitZ = setTimeout(() => { el.textContent = ''; }, 2200);
}
function indir(ad, metin, tur) {
  const url = URL.createObjectURL(new Blob([metin], { type: tur }));
  const a = document.createElement('a');
  a.href = url;
  a.download = ad;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/* ---------- sunucu ---------- */

async function api(yol, secenek) {
  const o = secenek || {};
  let r;
  try {
    r = await fetch('/admin/api/' + yol, {
      method: o.body ? 'POST' : (o.method || 'GET'),
      headers: { 'X-Lulo-Admin': '1', ...(o.body ? { 'Content-Type': 'application/json' } : {}) },
      body: o.body ? JSON.stringify(o.body) : undefined,
      credentials: 'same-origin',
      cache: 'no-store',
    });
  } catch (e) {
    const err = new Error('Sunucuya ulaşılamadı. İnternet bağlantını kontrol et.');
    err.code = 'network';
    throw err;
  }
  let j = null;
  try { j = await r.json(); } catch (e) { /* JSON değil */ }
  if (r.status === 401 && j && j.error === 'login') {
    girisGoster(S.hazir ? 'Oturum kapandı; tekrar giriş yap.' : '');
    const err = new Error('Oturum kapandı; tekrar giriş yap.');
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
function hata(e, yedek) {
  if (e && e.code === 'login') return;
  toast((e && e.message) || yedek || 'Şu an olmadı; biraz sonra tekrar dene.');
  kayitYaz('');
}

function uygula(p) { if (p && p.id && p.d) S.adaylar.set(p.id, p.d); }
async function yazHam(id, yama) {
  const r = await api('influencer', { body: { action: 'patch', id, patch: yama } });
  uygula(r);
  return r;
}
async function guncelle(id, yama) {
  try { await yazHam(id, yama); kayitYaz('Kaydedildi'); planla(); return true; }
  catch (e) { hata(e, 'Kaydedilemedi; tekrar dene.'); planla(); return false; }
}
async function adayYaz(id, d) {
  const r = await api('influencer', { body: { action: 'create', id, data: d } });
  uygula(r);
  return r;
}
// many writes at once (imports, backups, template refresh): 20 per request for the server's CPU limit
async function topluYaz(islemler, ilerle) {
  const sonuc = { tamam: 0, hata: [] };
  for (let i = 0; i < islemler.length; i += 20) {
    const parca = islemler.slice(i, i + 20);
    const r = await api('influencer', { body: { action: 'bulk', ops: parca } });
    for (const x of r.results || []) {
      if (x.error) sonuc.hata.push(x);
      else if (x.deleted) { S.adaylar.delete(x.id); sonuc.tamam++; }
      else { uygula(x); sonuc.tamam++; }
    }
    if (ilerle) ilerle(Math.min(i + parca.length, islemler.length), islemler.length);
  }
  planla();
  return sonuc;
}

const bekleyen = new Map();
function geciktir(k, fn, ms) {
  const o = bekleyen.get(k);
  if (o) clearTimeout(o.t);
  const t = setTimeout(() => { bekleyen.delete(k); fn(); }, ms || 650);
  bekleyen.set(k, { t, fn });
  kayitYaz('Kaydediliyor…');
}
async function hepsiniYaz() {
  const isler = Array.from(bekleyen.values());
  bekleyen.clear();
  for (const o of isler) clearTimeout(o.t);
  await Promise.all(isler.map((o) => o.fn()));
}

function birlestirYamasi(eski, yeni) {
  const y = {};
  for (const f of ['ad', 'bio', 'kategori', 'sehir', 'ulke', 'email', 'profil']) if (!eski[f] && yeni[f]) y[f] = yeni[f];
  for (const f of ['takipci', 'etkilesim', 'izlenme']) if (yeni[f] != null) y[f] = yeni[f];
  const d = Object.assign({}, eski, y);
  y.puan = puanHesapla(d).toplam;
  if (y.email && eski.durum === 'yeni') y.durum = 'hazir';
  if (sablonMu(eski) && (y.email || y.sehir || y.ulke || y.bio || y.ad)) y.mail = Object.assign(mailUret(d, S.ayar), { uretim: 'sablon', tarih: simdi() });
  return y;
}

/* ---------- görünümler, giriş ---------- */

const GORUNUMLER = ['v-wait', 'v-login', 'v-setup', 'v-app'];
function goster(id) {
  for (const v of GORUNUMLER) $('#' + v).hidden = v !== id;
  const ic = id === 'v-app';
  $('#logout').hidden = !ic;
  $('#who').hidden = !ic || !$('#who').textContent;
}
function girisGoster(mesaj) {
  if (S.acik) { S.acik = null; $('#drawer').hidden = true; $('#drawer').innerHTML = ''; $('#scrim').hidden = true; document.body.classList.remove('kilit'); }
  goster('v-login');
  const m = $('#loginMsg');
  m.className = 'msg err';
  m.textContent = mesaj || '';
  setTimeout(() => $('#pw').focus(), 50);
}
async function oturumBilgisi() {
  try {
    const s = await api('status');
    const bitis = new Date(s.sessionEnds * 1000);
    $('#who').textContent = 'Oturum ' + pad2(bitis.getHours()) + ':' + pad2(bitis.getMinutes()) + "'e kadar";
    $('#who').hidden = $('#v-app').hidden;
  } catch (e) { /* önemli değil */ }
}

async function basla() {
  $('#elleNis').innerHTML = '<option value="">Otomatik bul</option>' + Object.keys(NISLER).map((k) => `<option value="${k}">${esc(NISLER[k].ad)}</option>`).join('');
  olaylar();
  // Google sends the owner back here after the Gmail consent (?code&state, or ?error)
  const q = new URLSearchParams(location.search);
  const oauth = q.get('code') || q.get('error') ? { code: q.get('code'), state: q.get('state'), error: q.get('error') } : null;
  if (oauth) history.replaceState(null, '', location.pathname);
  await yukle(true);
  if (oauth && S.hazir) gmailBitir(oauth);
}

async function yukle(ilk) {
  let j;
  try { j = await api('influencer'); }
  catch (e) {
    if (e.code === 'login') return;
    if (ilk) { goster('v-wait'); $('#v-wait p').textContent = e.message; }
    else toast(e.message);
    return;
  }
  if (j.missing && j.missing.includes('INFLUENCER_DB')) { goster('v-setup'); return; }
  S.ayar = Object.assign({}, AYAR_VARSAYILAN, j.settings || {});
  S.gmail = Object.assign({ configured: false, missing: [], connected: false, email: '' }, j.gmail || {});
  S.ai = Object.assign({ configured: false, model: '' }, j.ai || {});
  S.today = Object.assign({ sent: 0 }, j.today || {});
  S.oto = { anahtar: Object.assign({ var: false, olusturma: '' }, (j.oto && j.oto.anahtar) || {}), durum: (j.oto && j.oto.durum) || {} };
  const m = new Map();
  for (const p of j.people || []) m.set(p.id, p.d);
  S.adaylar = m;
  S.hazir = true;
  S.sonYukleme = Date.now();
  goster('v-app');
  if (ilk) oturumBilgisi();
  if (S.acik && !m.has(S.acik)) drawerKapat();
  ciz();
}

let rafId = 0;
function planla() {
  if (rafId) return;
  rafId = requestAnimationFrame(() => { rafId = 0; ciz(); });
}
function ciz() {
  if (!S.hazir) return;
  cizUst();
  if (S.tab === 'adaylar') cizAdaylar();
  else if (S.tab === 'ekle') cizEkle();
  else if (S.tab === 'gonderim') cizGonderim();
  else if (S.tab === 'ayarlar') cizAyarlar();
  if (S.acik) drawerTazele();
}
function sekmeAc(tab) {
  S.tab = tab;
  for (const b of $$('.tab')) b.setAttribute('aria-selected', String(b.dataset.tab === tab));
  for (const p of $$('.panel')) p.hidden = p.id !== 'p-' + tab;
  ciz();
  window.scrollTo({ top: 0 });
}

function cizUst() {
  const t = tumu();
  $('#topMeta').textContent = `${t.filter((d) => d.durum !== 'arsiv').length} aday · bugün ${bugunGiden()}/${gunlukLimit()} gönderildi`;
  const cevap = t.filter((d) => d.durum === 'cevap').length;
  const b = $('#tabBadge');
  b.hidden = !cevap;
  b.textContent = cevap;
  b.setAttribute('aria-label', cevap + ' cevap bekliyor');
}

/* ---------- Adaylar ---------- */

function gorunenler() {
  let arr = tumu();
  const f = S.filtre;
  arr = arr.filter((a) => (f === 'hepsi' ? a.durum !== 'arsiv' : a.durum === f));
  const q = katla(S.ara.trim());
  if (q) arr = arr.filter((a) => katla([a.ad, a.handle, a.email, a.sehir, a.bio, a.hitapAdi].join(' ')).includes(q));
  const k = S.sirala;
  arr.sort((x, y) => (k === 'takipci' ? (y.takipci || 0) - (x.takipci || 0)
    : k === 'etkilesim' ? (y.etkilesim || 0) - (x.etkilesim || 0)
      : k === 'yeni' ? String(y.eklenme || '').localeCompare(String(x.eklenme || ''))
        : puanaGore(x, y)));
  return arr;
}
function satirHtml(a) {
  const nis = NISLER[a.nis] || NISLER.diger;
  const alt = [a.handle ? '@' + esc(a.handle) : '', a.sehir ? esc(a.sehir) : '', !gecerliEmail(a.email) ? '<span class="warn">e-posta yok</span>' : ''].filter(Boolean).join(' · ');
  return `<button class="row" type="button" data-act="ac" data-id="${esc(a.id)}">
    ${avHtml(a)}
    <span class="who"><span class="nm">${esc(a.ad || '@' + a.handle)}${a.ornek ? '<em class="ornek">ÖRNEK</em>' : ''}${ulasmadiHtml(a)}</span><span class="hd">${alt}</span><span class="meta-m">${esc(nis.ad)} · ${esc(fmtSayi(a.takipci))} takipçi · ${esc(fmtYuzde(a.etkilesim))} · uyum ${a.puan == null ? '–' : a.puan}</span></span>
    <span class="c-nis"><span class="tag ${nisK(a)}">${esc(nis.ad)}</span></span>
    <span class="c-num">${esc(fmtSayi(a.takipci))}</span>
    <span class="c-num">${esc(fmtYuzde(a.etkilesim))}</span>
    <span class="c-score">${skorHtml(a.puan)}</span>
    <span class="c-st">${pillHtml(a.durum)}</span>
  </button>`;
}
function cizAdaylar() {
  const liste = $('#liste');
  const c = { hepsi: 0 };
  for (const d of DURUMLAR) c[d.k] = 0;
  for (const d of S.adaylar.values()) { if (c[d.durum] != null) c[d.durum]++; if (d.durum !== 'arsiv') c.hepsi++; }
  $('#chips').innerHTML = [{ k: 'hepsi', ad: 'Hepsi' }].concat(DURUMLAR)
    .filter((d) => d.k === 'hepsi' || c[d.k] > 0 || d.k === S.filtre || ['hazir', 'onay', 'gonderildi', 'cevap'].includes(d.k))
    .map((d) => `<button class="chip" type="button" data-act="filtre" data-k="${d.k}" aria-pressed="${S.filtre === d.k}"><span class="dot s-${d.k}"></span>${esc(d.ad)} <b>${c[d.k] || 0}</b></button>`).join('');
  $('#csvIndir').hidden = S.adaylar.size === 0;
  $('#yedekIndir').hidden = S.adaylar.size === 0;
  const ornekler = Array.from(S.adaylar.values()).filter((d) => d.ornek).length;
  const os = $('#ornekSil');
  os.hidden = !ornekler;
  os.textContent = S.ornekSilOnay ? `Evet, ${ornekler} örneği sil` : 'Örnekleri sil';
  os.className = S.ornekSilOnay ? 'btn btn-danger' : 'btn btn-quiet';
  if (S.adaylar.size === 0) {
    liste.innerHTML = `<div class="bos bos-buyuk"><div class="mini-lanes" aria-hidden="true"><i class="lane-g"></i><i class="lane-r"></i><i class="lane-w"></i></div><h2>İlk adaylarını ekle</h2><p>Modash CSV'ni bırak ya da Instagram profil ekran görüntülerini yükle. Her kişi için Lulo Smaç!'a uygun, kişiye özel bir mail kendiliğinden hazırlanır.</p><div class="actions"><button class="btn btn-primary" type="button" data-act="tab" data-tab="ekle">İçe aktar</button></div></div>`;
    return;
  }
  const arr = gorunenler();
  if (!arr.length) { liste.innerHTML = `<div class="bos"><p>${S.ara ? 'Aramana uyan aday yok.' : 'Bu durumda aday yok.'}</p></div>`; return; }
  liste.innerHTML = '<div class="row row-head" aria-hidden="true"><span></span><span>Aday</span><span>İçerik</span><span class="c-num">Takipçi</span><span class="c-num">Etkileşim</span><span>Uyum</span><span>Durum</span></div>' + arr.map(satirHtml).join('');
  genislik(liste);
}

/* ---------- Aday ayrıntısı ---------- */

function alanHtml(k, ad, ipucu, tip, im) {
  return `<label class="f">${esc(ad)}${ipucu ? ` <small>${esc(ipucu)}</small>` : ''}<input data-f="${k}" type="${tip || 'text'}"${im ? ` inputmode="${im}"` : ''} autocomplete="off"></label>`;
}
function drawerHtml() {
  const nisOps = Object.keys(NISLER).map((k) => `<option value="${k}">${esc(NISLER[k].ad)}</option>`).join('');
  const durumOps = DURUMLAR.map((d) => `<option value="${d.k}">${esc(d.ad)}</option>`).join('');
  return `
  <div class="dw-head">
    <span class="av av-l" id="dwAv" aria-hidden="true"></span>
    <div class="dw-t"><h2 id="dwBaslik" tabindex="-1"></h2><div class="dw-sub" id="dwAlt"></div></div>
    <button class="icon-btn" type="button" data-act="kapat" aria-label="Kapat"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg></button>
    <span class="damga" id="dwDamga" hidden></span>
  </div>
  <div class="dw-stats" id="dwStats"></div>
  <div class="dw-durum">
    <label class="f" for="f-durum">Durum</label>
    <select id="f-durum" data-sel="durum">${durumOps}</select>
    <span class="kayit" id="kayitDurum" aria-live="polite"></span>
  </div>
  <div class="teslim" id="teslimKutu" hidden></div>
  <details class="neden"><summary>Uyum puanı nasıl hesaplandı?</summary><ul id="dwPuan"></ul></details>

  <section class="dw-sec" aria-labelledby="h-mail">
    <h3 id="h-mail">Mail</h3>
    <div class="seg" role="group" aria-label="Mesaj türü">
      <button type="button" data-act="mailSekme" data-s="eposta" aria-pressed="true">E-posta</button>
      <button type="button" data-act="mailSekme" data-s="dm" aria-pressed="false">DM metni</button>
    </div>
    <div id="mailEposta">
      <div class="mailcard">
        <div class="mc-meta" id="mailMeta"></div>
        <label class="sr" for="f-konu">Konu</label>
        <input id="f-konu" class="mc-konu" data-m="konu" autocomplete="off">
        <label class="sr" for="f-govde">Mail metni</label>
        <textarea id="f-govde" class="mc-govde" data-m="govde" rows="18"></textarea>
        <div class="mc-not" id="mailNot"></div>
      </div>
      <div class="is" id="mailIs" hidden><span class="spin" aria-hidden="true"></span><span>Claude maili bu kişiye göre yeniden yazıyor…</span></div>
      <div class="is" id="gonderIs" hidden><span class="spin" aria-hidden="true"></span><span>Gmail'den gönderiliyor…</span></div>
      <div class="actions">
        <button class="btn btn-primary" type="button" id="btnGmailGonder" data-act="gmailGonder" hidden>Gmail'den gönder</button>
        <button class="btn btn-gold" type="button" id="btnOnay" data-act="onayla">Onayla</button>
        <button class="btn" type="button" data-act="kopyalaMail">Kopyala</button>
        <button class="btn" type="button" id="btnClaude" data-act="claudeKisisel">Claude ile kişiselleştir</button>
        <a class="btn btn-quiet" id="lnkGmail" target="_blank" rel="noopener">Gmail'de aç</a>
        <button class="btn btn-quiet" type="button" id="btnSablon" data-act="sablonYenile">Şablondan yenile</button>
      </div>
      <div class="uyari-kutu" id="belirsizKutu" hidden><span>Son gönderim denemesinin sonucu belli değil. Gmail'de Gönderilenler'e bak ya da buradan kontrol et: mail gittiyse panel kendisi işaretler, gitmediyse yeniden gönderebilirsin.</span><button class="btn btn-s" type="button" data-act="gmailYenile">Gmail'den kontrol et</button></div>
    </div>
    <div id="mailDm" hidden>
      <div class="mailcard">
        <div class="mc-meta" id="dmMeta"></div>
        <label class="sr" for="f-dm">DM metni</label>
        <textarea id="f-dm" class="mc-govde mc-dm" data-m="dm" rows="8"></textarea>
      </div>
      <div class="actions">
        <button class="btn btn-gold" type="button" data-act="kopyalaDm">Kopyala</button>
        <a class="btn" id="lnkDm" target="_blank" rel="noopener">Instagram'da aç</a>
        <button class="btn btn-quiet" type="button" id="btnDmGonderildi" data-act="dmGonderildi">DM gönderildi say</button>
      </div>
    </div>
  </section>

  <section class="dw-sec" aria-labelledby="h-yaz">
    <div class="tl-bas"><h3 id="h-yaz">Yazışma</h3><button class="btn btn-s btn-quiet" type="button" id="btnGmailYenile" data-act="gmailYenile" hidden>Gmail'den yenile</button></div>
    <ol class="timeline" id="tl"></ol>
    <div id="durumOneri"></div>
    <label class="f" for="f-gelen">Gelen cevabı yapıştır <small>Gmail bağlıysa cevaplar kendiliğinden gelir</small></label>
    <textarea id="f-gelen" rows="4" dir="auto" placeholder="Influencer'ın cevabını buraya yapıştır"></textarea>
    <div class="is" id="cevapIs" hidden><span class="spin" aria-hidden="true"></span><span>Claude cevap taslağı yazıyor…</span></div>
    <div class="actions">
      <button class="btn" type="button" data-act="gelenEkle">Cevabı ekle</button>
      <button class="btn btn-gold" type="button" id="btnCevap" data-act="claudeCevap">Claude ile cevap yaz</button>
      <button class="btn btn-quiet" type="button" id="btnGonderildi" data-act="gonderildiSay">Gönderildi say</button>
    </div>
  </section>

  <section class="dw-sec" aria-labelledby="h-bil">
    <h3 id="h-bil">Bilgiler</h3>
    <div class="bil-grid">
      ${alanHtml('hitapAdi', 'Hitap adı', 'Mailde “Merhaba …”')}
      ${alanHtml('ad', 'Görünen ad')}
      ${alanHtml('handle', 'Kullanıcı adı')}
      <label class="f">Platform<select data-sel="platform"><option value="instagram">Instagram</option><option value="tiktok">TikTok</option><option value="youtube">YouTube</option><option value="twitch">Twitch / Kick</option><option value="web">Web sitesi / medya</option></select></label>
      ${alanHtml('email', 'E-posta', '', 'email')}
      ${alanHtml('takipci', 'Takipçi', '', 'text', 'decimal')}
      ${alanHtml('etkilesim', 'Etkileşim (%)', '', 'text', 'decimal')}
      ${alanHtml('izlenme', 'Ort. izlenme', '', 'text', 'decimal')}
      ${alanHtml('sehir', 'Şehir')}
      ${alanHtml('ulke', 'Ülke kodu', 'TR, SA, AE…')}
      <label class="f">İçerik alanı<select data-sel="nis">${nisOps}</select></label>
      <label class="f">Mail dili<select data-sel="dil"><option value="tr">Türkçe</option><option value="en">İngilizce</option></select></label>
      <label class="f">Hitap (Türkçe)<select data-sel="hitap"><option value="sen">Samimi (sen)</option><option value="siz">Resmî (siz)</option></select></label>
      <label class="f full">Kişisel açılış cümlesi <small>Boş kalırsa içerik alanına göre yazılır</small><textarea data-f="kisisel" rows="2" dir="auto"></textarea></label>
      <label class="f full">Bio<textarea data-f="bio" rows="3" dir="auto"></textarea></label>
      <label class="f full">Ekip notu <small>Claude kişiselleştirirken bunu da okur</small><textarea data-f="not" rows="2"></textarea></label>
    </div>
  </section>
  <div class="dw-alt" id="silAlan"></div>`;
}

function drawerAc(id, bolum) {
  if (!S.adaylar.has(id)) return;
  S.acik = id; S.mailSekme = 'eposta'; S.silOnay = false; S.sablonOnay = false;
  const dw = $('#drawer');
  dw.innerHTML = drawerHtml();
  dw.hidden = false;
  $('#scrim').hidden = false;
  document.body.classList.add('kilit');
  drawerTazele(true);
  mailSekmeCiz();
  dw.scrollTop = 0;
  setTimeout(() => {
    if (bolum === 'yazisma') { const h = $('#h-yaz'); if (h) h.scrollIntoView({ block: 'start' }); const g = $('#f-gelen'); if (g) g.focus({ preventScroll: true }); }
    else { const b = $('#dwBaslik'); if (b) b.focus({ preventScroll: true }); }
  }, 40);
}
async function drawerKapat() {
  await hepsiniYaz();
  S.acik = null;
  S.gonderOnay = null;
  S.tlOnay = null;
  $('#drawer').hidden = true;
  $('#drawer').innerHTML = '';
  $('#scrim').hidden = true;
  document.body.classList.remove('kilit');
  if (S.sonOdak && document.contains(S.sonOdak)) S.sonOdak.focus({ preventScroll: true });
  planla();
}
function bosSa(el, val) {
  if (!el) return;
  if (document.activeElement === el || el.dataset.kirli === '1') return;
  const v = String(val == null ? '' : val);
  if (el.value !== v) el.value = v;
}
function mailNotu(d) {
  const m = d.mail || {};
  const parca = [];
  if (m.uretim === 'claude') parca.push('Claude bu kişiye göre kişiselleştirdi' + (m.tarih ? ' · ' + fmtTarih(m.tarih) : ''));
  else if (m.uretim === 'elle') parca.push('Elle düzenlendi' + (m.tarih ? ' · ' + fmtTarih(m.tarih) : ''));
  else parca.push('Şablondan hazırlandı; düzenleyebilirsin, değişiklikler kendiliğinden kaydedilir');
  if (d.durum === 'onay') parca.push('Onaylandı' + (m.onayTarih ? ' · ' + fmtTarih(m.onayTarih) : '') + ': gönderim sırasında');
  return parca.join(' · ');
}
function gmailLinkGuncelle() {
  const d = S.adaylar.get(S.acik);
  const a = $('#lnkGmail');
  if (!d || !a) return;
  const ok = gecerliEmail(d.email);
  a.href = gmailLink(ok ? d.email : '', $('#f-konu').value, $('#f-govde').value, S.ayar.gonderenEmail);
  a.setAttribute('aria-disabled', String(!ok));
}
function mailSekmeCiz() {
  const dw = $('#drawer');
  for (const b of $$('[data-act="mailSekme"]', dw)) b.setAttribute('aria-pressed', String(b.dataset.s === S.mailSekme));
  $('#mailEposta', dw).hidden = S.mailSekme !== 'eposta';
  $('#mailDm', dw).hidden = S.mailSekme !== 'dm';
}

function tlHtml(d) {
  const y = d.yazisma || [];
  if (!y.length) return '<li class="tl-bos">Henüz yazışma yok. Mail gidince burada görünür; cevaplar Gmail\'den gelir ya da aşağıya yapıştırabilirsin.</li>';
  const konu = (d.mail && d.mail.konu) || '';
  return y.map((e, i) => {
    if (e.yon === 'giden') {
      const kanal = e.kaynak === 'gmail' ? ' · Gmail' : e.kaynak === 'dm' ? ' · Instagram DM' : e.kaynak === 'elle' ? ' · elle işaretlendi' : '';
      return `<li class="tl giden"><span class="tl-dot"></span><div class="tl-h"><b>Gönderildi</b><span>${esc(fmtTarih(e.tarih))}${kanal}</span></div><details><summary>${esc(e.konu || 'Mesaj metni')}</summary><pre class="tl-metin" dir="auto">${esc(e.metin || '')}</pre></details></li>`;
    }
    if (e.yon === 'gelen') {
      if (e.teslimHatasi) return `<li class="tl gelen hata"><span class="tl-dot"></span><div class="tl-h"><b>Mail ulaşmadı</b><span>${esc(fmtTarih(e.tarih))} · Gmail</span></div><details><summary>Gmail'in bildirimi</summary><pre class="tl-metin" dir="auto">${esc(e.metin || '')}</pre></details></li>`;
      if (e.otomatik) return `<li class="tl gelen oto"><span class="tl-dot"></span><div class="tl-h"><b>Otomatik yanıt</b><span>${esc(fmtTarih(e.tarih))} · Gmail · cevap sayılmadı</span></div><details><summary>${esc(e.konu || 'Mesaj metni')}</summary><pre class="tl-metin" dir="auto">${esc(e.metin || '')}</pre></details></li>`;
      const kimden = e.kimden && ilkEmail(e.kimden) && ilkEmail(e.kimden) !== String(d.email || '').toLowerCase() ? ' · ' + esc(e.kimden) : '';
      return `<li class="tl gelen"><span class="tl-dot"></span><div class="tl-h"><b>Cevap geldi</b><span>${esc(fmtTarih(e.tarih))}${e.kaynak === 'gmail' ? ' · Gmail' : ''}${kimden}</span></div>${e.ozet ? `<p class="tl-ozet">${esc(e.ozet)}</p>` : ''}<blockquote class="tl-metin" dir="auto">${esc(e.metin || '')}</blockquote></li>`;
    }
    const gm = gmailVar() && !d.ornek && (gecerliEmail(d.email) || y.some((x) => x.yon === 'gelen'));
    const mesgul = !!S.isler[S.acik + ':tl'];
    const onayK = S.acik + ':' + i;
    const link = gmailLink(gecerliEmail(d.email) ? d.email : '', 'Re: ' + konu, e.metin || '', S.ayar.gonderenEmail);
    const gmailDugme = gm
      ? `<button class="btn btn-s btn-primary" type="button" data-act="tlGmailGonder" data-i="${i}"${mesgul ? ' disabled' : ''}>${S.tlOnay === onayK ? 'Evet, gönder' : 'Gmail\'den gönder'}</button>`
      : `<a class="btn btn-s" target="_blank" rel="noopener" href="${esc(link)}">Gmail'de aç</a>`;
    return `<li class="tl taslak"><span class="tl-dot"></span><div class="tl-h"><b>Cevap taslağı</b><span>${esc(fmtTarih(e.tarih))}${e.kaynak === 'claude' ? (e.oto ? ' · Claude kendiliğinden yazdı' : ' · Claude yazdı') : ''}</span></div>${e.ozet ? `<p class="tl-ozet">${esc(e.ozet)}</p>` : ''}<label class="sr" for="tl-${i}">Cevap taslağı</label><textarea class="tl-edit" id="tl-${i}" data-tl="${i}" rows="8" dir="auto">${esc(e.metin || '')}</textarea><div class="actions sm">${gmailDugme}<button class="btn btn-s" type="button" data-act="tlKopyala" data-i="${i}">Kopyala</button><button class="btn btn-s ${gm ? 'btn-quiet' : 'btn-gold'}" type="button" data-act="tlGonderildi" data-i="${i}">Gönderildi say</button><button class="btn btn-s btn-quiet" type="button" data-act="tlSil" data-i="${i}">Sil</button></div></li>`;
  }).join('');
}
function tlCiz(d) {
  const tl = $('#tl');
  if (!tl) return;
  const ae = document.activeElement;
  if (tl.contains(ae) && ae.matches('textarea,input')) return;
  const iz = [JSON.stringify(d.yazisma || []), d.email || '', (d.mail && d.mail.konu) || '', S.ayar.gonderenEmail || '', gmailVar(), S.tlOnay, S.isler[S.acik + ':tl'] ? 1 : 0].join('|');
  if (tl.dataset.iz === iz) return;
  const odak = tl.contains(ae) && ae.dataset.act ? [ae.dataset.act, ae.dataset.i] : null;
  tl.dataset.iz = iz;
  tl.innerHTML = tlHtml(d);
  if (odak) { const el = tl.querySelector(`[data-act="${odak[0]}"][data-i="${odak[1]}"]`); if (el) el.focus({ preventScroll: true }); }
}

function drawerTazele(ilk) {
  const id = S.acik;
  if (!id) return;
  const dw = $('#drawer');
  const d = S.adaylar.get(id);
  if (!d) { if (!ilk) { drawerKapat(); toast('Aday listeden kaldırıldı.'); } return; }
  const av = $('#dwAv', dw);
  av.textContent = bas(d);
  av.className = 'av av-l ' + nisK(d);
  $('#dwBaslik', dw).textContent = d.ad || ('@' + (d.handle || ''));
  $('#dwAlt', dw).innerHTML = [
    d.handle ? `<a href="${esc(webLink(d.profil) || profilUrl(d.platform, d.handle))}" target="_blank" rel="noopener">@${esc(d.handle)}</a>` : '',
    esc(PLATFORM_AD[d.platform] || 'Instagram'),
    d.sehir ? esc(d.sehir) : '',
    d.ornek ? '<em class="ornek">ÖRNEK</em>' : '',
  ].filter(Boolean).join('<span aria-hidden="true">·</span>');
  const damga = $('#dwDamga', dw);
  if (d.gonderim && d.gonderim.tarih) { damga.hidden = false; damga.innerHTML = 'GÖNDERİLDİ<small>' + esc(GUN.format(new Date(d.gonderim.tarih))) + '</small>'; }
  else damga.hidden = true;
  $('#dwStats', dw).innerHTML = [['Takipçi', fmtSayi(d.takipci)], ['Etkileşim', fmtYuzde(d.etkilesim)], ['Ort. izlenme', fmtSayi(d.izlenme)], ['Uyum puanı', d.puan == null ? '–' : d.puan + '/100']]
    .map(([k, v]) => `<div class="dw-stat"><span>${k}</span><b>${esc(v)}</b></div>`).join('');
  const p = puanHesapla(d);
  $('#dwPuan', dw).innerHTML = p.kalemler.map((k) => `<li><span>${esc(k.ad)}: ${esc(k.deger)}</span><b>${k.p}/${k.max}</b></li>`).join('') + `<li class="top"><span>Toplam</span><b>${p.toplam}/100</b></li>`;
  const tk = $('#teslimKutu', dw);
  tk.hidden = !(d.teslim && d.teslim.hata);
  if (!tk.hidden) tk.innerHTML = `<b>Mail bu adrese ulaşmadı</b> (${esc(fmtTarih(d.teslim.tarih))}). Adres yanlış ya da kapalı olabilir: e-postayı düzeltip yeniden gönderebilir ya da adayı arşive taşıyabilirsin.`;

  const m = d.mail || {};
  const yon = d.dil === 'ar' ? 'rtl' : 'ltr';
  for (const sel of ['#f-konu', '#f-govde', '#f-dm']) $(sel, dw).dir = yon;
  bosSa($('#f-konu', dw), m.konu || '');
  bosSa($('#f-govde', dw), m.govde || '');
  bosSa($('#f-dm', dw), m.dm || '');
  const kime = gecerliEmail(d.email) ? esc(d.email) : '<span class="warn">e-posta yok</span>';
  const kimden = (gmailVar() && S.gmail.email) || S.ayar.gonderenEmail || '–';
  $('#mailMeta', dw).innerHTML = `<span>Kime: <b>${kime}</b></span><span>Kimden: <b>${esc(kimden)}</b></span><span>Dil: <b>${esc(DIL_AD[d.dil] || 'Türkçe')}${d.dil === 'tr' ? ' · ' + (d.hitap === 'siz' ? 'siz' : 'sen') : ''}</b></span>`;
  $('#dmMeta', dw).innerHTML = `<span>${d.platform === 'instagram' ? 'Instagram DM' : d.platform === 'web' ? 'Kısa mesaj' : esc(PLATFORM_AD[d.platform] || '') + ' mesajı'}: <b>${d.handle ? esc(d.platform === 'web' ? d.handle : '@' + d.handle) : '–'}</b></span><span>E-postası olmayan adaylar için kısa sürüm</span>`;
  $('#mailNot', dw).textContent = mailNotu(d);
  gmailLinkGuncelle();
  const lnkDm = $('#lnkDm', dw);
  if (d.platform === 'instagram' && d.handle) { lnkDm.hidden = false; lnkDm.href = 'https://ig.me/m/' + encodeURIComponent(d.handle); lnkDm.textContent = 'Instagram\'da aç'; }
  else if (webLink(d.profil)) { lnkDm.hidden = false; lnkDm.href = webLink(d.profil); lnkDm.textContent = 'Profili aç'; }
  else lnkDm.hidden = true;

  const gitti = GIDILDI.includes(d.durum);
  const gm = gmailVar();
  const b = $('#btnOnay', dw);
  b.textContent = d.durum === 'onay' ? 'Onayı geri al' : 'Onayla';
  b.dataset.act = d.durum === 'onay' ? 'onayGeriAl' : 'onayla';
  b.className = d.durum === 'onay' || gm ? 'btn' : 'btn btn-gold';
  b.disabled = gitti || !gecerliEmail(d.email) || d.durum === 'arsiv';
  b.title = !gecerliEmail(d.email) ? 'Önce e-posta adresini ekle' : '';
  const gIs = S.isler[id + ':gonder'];
  const bg = $('#btnGmailGonder', dw);
  bg.hidden = !(gm && gonderilebilir(id, d) && !d.gonderimBelirsiz);
  bg.disabled = !!gIs;
  bg.textContent = S.gonderOnay === id ? 'Evet, şimdi gönder' : 'Gmail\'den gönder';
  $('#gonderIs', dw).hidden = !gIs;
  $('#belirsizKutu', dw).hidden = !(gm && d.gonderimBelirsiz);
  $('#lnkGmail', dw).hidden = gm && !gitti;
  const gy = $('#btnGmailYenile', dw);
  gy.hidden = !(gm && (d.gonderim || d.gonderimBelirsiz));
  gy.disabled = !!S.kontrol;
  gy.textContent = S.kontrol ? 'Bakılıyor…' : 'Gmail\'den yenile';
  const claudeVar = !!S.ai.configured;
  const mIs = S.isler[id + ':mail'];
  $('#btnClaude', dw).hidden = !claudeVar || gitti;
  $('#btnClaude', dw).disabled = !!mIs;
  $('#mailIs', dw).hidden = !mIs;
  const bs = $('#btnSablon', dw);
  bs.hidden = gitti || !(m.uretim && m.uretim !== 'sablon');
  bs.textContent = S.sablonOnay ? 'Evet, şablonla değiştir' : 'Şablondan yenile';
  $('#btnDmGonderildi', dw).hidden = gitti;

  tlCiz(d);
  const gelenVar = (d.yazisma || []).some((e) => e.yon === 'gelen' && !e.teslimHatasi && !e.otomatik);
  const cIs = S.isler[id + ':cevap'];
  $('#btnCevap', dw).hidden = !(claudeVar && gelenVar);
  $('#btnCevap', dw).disabled = !!cIs;
  $('#cevapIs', dw).hidden = !cIs;
  $('#btnGonderildi', dw).hidden = gitti;
  const sonT = (d.yazisma || []).slice(-1)[0];
  const o = S.durumOneri[id] || (sonT && sonT.yon === 'taslak' && ['anlasildi', 'olumsuz'].includes(sonT.oneri) ? sonT.oneri : '');
  $('#durumOneri', dw).innerHTML = o && o !== d.durum
    ? `<div class="oneri"><span>Claude'a göre bu yazışmanın durumu: <b>${esc(DURUM_AD[o])}</b></span><button class="btn btn-s" type="button" data-act="durumUygula" data-d="${esc(o)}">Durumu değiştir</button></div>` : '';

  const durumSel = $('#f-durum', dw);
  if (document.activeElement !== durumSel) durumSel.value = d.durum || 'yeni';
  for (const el of $$('[data-f]', dw)) {
    const f = el.dataset.f;
    let v = d[f];
    if (f === 'etkilesim' && v != null) v = String(v).replace('.', ',');
    bosSa(el, v == null ? '' : v);
  }
  for (const el of $$('select[data-sel]:not(#f-durum)', dw)) {
    if (document.activeElement === el) continue;
    const v = d[el.dataset.sel];
    el.value = v || el.options[0].value;
  }
  $('#silAlan', dw).innerHTML = S.silOnay
    ? '<p>Bu aday ve yazışmaları kalıcı olarak silinsin mi?</p><div class="actions"><button class="btn btn-danger-solid" type="button" data-act="silEvet">Evet, sil</button><button class="btn" type="button" data-act="silVazgec">Vazgeç</button></div>'
    : `<div class="actions"><button class="btn btn-quiet" type="button" data-act="arsivle">${d.durum === 'arsiv' ? 'Arşivden çıkar' : 'Arşive taşı'}</button><button class="btn btn-danger" type="button" data-act="sil">Adayı sil</button></div>`;
}

/* ---------- aday işlemleri ---------- */

function alanKaydet(id, f, ham) {
  const d0 = S.adaylar.get(id);
  if (!d0) return Promise.resolve(false);
  let v = ham;
  if (f === 'takipci' || f === 'izlenme') v = yuvarla(parseSayi(ham), 0);
  else if (f === 'etkilesim') v = yuvarla(parseSayi(ham), 2);
  else if (f === 'email') v = String(ham || '').trim().toLowerCase();
  else if (f === 'handle') v = normHandle(ham);
  else if (f === 'ulke') v = ulkeKod(ham) || String(ham || '').trim().toUpperCase().slice(0, 2);
  else if (typeof v === 'string' && f !== 'bio' && f !== 'not' && f !== 'kisisel') v = v.trim();
  const d = Object.assign({}, d0, { [f]: v });
  const yama = { [f]: v };
  if (f === 'handle' || f === 'platform') yama.profil = profilUrl(d.platform, d.handle);
  if (PUAN_ALAN.has(f)) yama.puan = puanHesapla(d).toplam;
  if (SABLON_ALAN.has(f) && sablonMu(d0)) yama.mail = Object.assign(mailUret(d, S.ayar), { uretim: 'sablon', tarih: simdi() });
  if (f === 'email' && d0.durum === 'yeni' && gecerliEmail(v)) yama.durum = 'hazir';
  if (f === 'email' && d0.teslim && d0.teslim.hata && v !== d0.email) yama.teslim = null;
  return guncelle(id, yama);
}
async function onayla(id) {
  await hepsiniYaz();
  const d = S.adaylar.get(id);
  if (!d) return;
  if (!gecerliEmail(d.email)) { toast('Önce e-posta adresini ekle.'); return; }
  if (!(d.mail && d.mail.govde)) { toast('Önce maili hazırla.'); return; }
  if (await guncelle(id, { durum: 'onay', mail: { onayTarih: simdi() } })) toast('Onaylandı: gönderim sırasına girdi.');
}
async function gonderildiSay(id, kanal) {
  await hepsiniYaz();
  const d = S.adaylar.get(id);
  if (!d) return;
  const m = d.mail || {};
  const t = simdi();
  const kayit = kanal === 'dm'
    ? { yon: 'giden', tarih: t, konu: 'Instagram DM', metin: m.dm || '', kaynak: 'dm' }
    : { yon: 'giden', tarih: t, konu: m.konu || '', metin: m.govde || '', kaynak: 'elle' };
  const yama = { yazisma: (d.yazisma || []).concat([kayit]) };
  if (!GIDILDI.includes(d.durum)) yama.durum = 'gonderildi';
  if (!d.gonderim) yama.gonderim = { tarih: t, kanal: kanal === 'dm' ? 'dm' : 'elle' };
  if (await guncelle(id, yama)) toast(kanal === 'dm' ? 'DM gönderildi olarak işaretlendi.' : 'Gönderildi olarak işaretlendi.');
}
async function gelenEkle(id) {
  const ta = $('#f-gelen');
  const metin = ta.value.trim();
  if (!metin) { toast('Önce gelen cevabı yapıştır.'); ta.focus(); return; }
  const d = S.adaylar.get(id);
  const yama = { yazisma: (d.yazisma || []).concat([{ yon: 'gelen', tarih: simdi(), metin: alintiyiAt(metin), kaynak: 'elle' }]) };
  if (!['anlasildi', 'olumsuz'].includes(d.durum)) yama.durum = 'cevap';
  if (await guncelle(id, yama)) { ta.value = ''; toast('Cevap eklendi.'); }
}
async function claudeKisisel(id) {
  if (!S.ai.configured) return;
  const anahtar = id + ':mail';
  if (S.isler[anahtar]) return;
  await hepsiniYaz();
  if (!S.adaylar.get(id)) return;
  S.isler[anahtar] = {};
  drawerTazele();
  try {
    const r = await api('ai', { body: { kind: 'kisisel', id } });
    for (const sel of ['#f-konu', '#f-govde']) { const el = $(sel); if (el && S.acik === id) el.dataset.kirli = ''; }
    if (await guncelle(id, { mail: { konu: r.konu, govde: r.govde, uretim: 'claude', tarih: simdi() } })) toast('Claude maili bu kişiye göre yeniden yazdı.');
  } catch (e) { hata(e); }
  finally { delete S.isler[anahtar]; drawerTazele(); }
}
async function claudeCevap(id) {
  if (!S.ai.configured) return;
  const anahtar = id + ':cevap';
  if (S.isler[anahtar]) return;
  await hepsiniYaz();
  if (!S.adaylar.get(id)) return;
  S.isler[anahtar] = {};
  drawerTazele();
  try {
    const r = await api('ai', { body: { kind: 'cevap', id } });
    const son = S.adaylar.get(id);
    const y = (son.yazisma || []).slice();
    if (r.ozet) {
      for (let i = y.length - 1; i >= 0; i--) if (y[i].yon === 'gelen' && !y[i].teslimHatasi && !y[i].otomatik) { if (!y[i].ozet) y[i] = Object.assign({}, y[i], { ozet: String(r.ozet).slice(0, 300) }); break; }
    }
    y.push({ yon: 'taslak', tarih: simdi(), metin: r.govde, kaynak: 'claude' });
    if (['anlasildi', 'olumsuz'].includes(r.durum)) S.durumOneri[id] = r.durum;
    if (await guncelle(id, { yazisma: y })) toast('Cevap taslağı hazır; kontrol edip gönder.');
  } catch (e) { hata(e); }
  finally { delete S.isler[anahtar]; drawerTazele(); }
}
async function sablonYenile(id) {
  if (!S.sablonOnay) {
    S.sablonOnay = true;
    drawerTazele();
    setTimeout(() => { S.sablonOnay = false; if (S.acik === id) drawerTazele(); }, 4500);
    return;
  }
  S.sablonOnay = false;
  const d = S.adaylar.get(id);
  for (const sel of ['#f-konu', '#f-govde', '#f-dm']) { const el = $(sel); if (el) el.dataset.kirli = ''; }
  for (const k of Array.from(bekleyen.keys())) if (k.startsWith(id + ':m:')) { clearTimeout(bekleyen.get(k).t); bekleyen.delete(k); }
  if (await guncelle(id, { mail: Object.assign(mailUret(d, S.ayar), { uretim: 'sablon', tarih: simdi() }) })) toast('Mail şablondan yeniden hazırlandı.');
}
async function sil(id) {
  try {
    await api('influencer', { body: { action: 'delete', id } });
    S.adaylar.delete(id);
    S.silOnay = false;
    await drawerKapat();
    toast('Aday silindi.');
  } catch (e) { hata(e); }
}
function tlYamasi(id, i, fn) {
  const d = S.adaylar.get(id);
  if (!d) return null;
  const y = (d.yazisma || []).slice();
  if (!y[i]) return null;
  fn(y, d);
  return y;
}
async function kopyala(metin, el) {
  try { await navigator.clipboard.writeText(metin); toast('Kopyalandı.'); }
  catch (e) {
    if (el && el.select) { el.focus(); el.select(); toast('Metin seçildi; kopyalamak için Ctrl/Cmd + C.'); }
    else toast('Kopyalanamadı.');
  }
}

/* ---------- Gmail ---------- */

const gmailVar = () => !!S.gmail.connected;
const gunlukLimit = () => Math.max(1, Number(S.ayar.gunluk) || 20);
const bugunGiden = () => Number(S.today.sent) || 0;
function gonderilebilir(id, d) {
  return !!d && !d.ornek && gecerliEmail(d.email) && !GIDILDI.includes(d.durum) && d.durum !== 'arsiv' && !d.gonderim
    && !!(d.mail && d.mail.govde && d.mail.konu) && !S.yeniGiden.has(id);
}
function gmailHata(e) {
  if (!e || e.code === 'login') return;
  if (e.code === 'gmail_connect') { S.gmail.connected = false; planla(); }
  if (e.code === 'limit') S.today.sent = Math.max(bugunGiden(), gunlukLimit());
  toast(e.message || 'Gmail\'e şu an ulaşılamıyor; biraz sonra tekrar dene.');
}

/* İlk maili gönderir. Sunucu kilit tutar: aynı kişiye ikinci kez ilk mail gitmez. */
async function tekGonder(id) {
  const d = S.adaylar.get(id);
  if (!gonderilebilir(id, d)) return { ok: false };
  const anahtar = id + ':gonder';
  S.isler[anahtar] = {};
  if (S.acik === id) drawerTazele();
  try {
    const r = await api('gmail', { body: { action: 'send', id, konu: d.mail.konu, govde: d.mail.govde } });
    S.yeniGiden.add(id);
    uygula(r.person);
    S.today.sent = bugunGiden() + 1;
    return { ok: true };
  } catch (e) {
    gmailHata(e);
    if (['gmail_unknown', 'sent', 'unknown', 'busy'].includes(e.code)) await yukle();
    return { ok: false, kod: e.code };
  } finally {
    delete S.isler[anahtar];
    if (S.acik === id) drawerTazele();
    planla();
  }
}
let gonderZ = 0;
async function gmailGonder(id) {
  const d = S.adaylar.get(id);
  if (!d) return;
  if (d.ornek) { toast('Örnek adaylara mail gönderilmez.'); return; }
  if (!gecerliEmail(d.email)) { toast('Önce e-posta adresini ekle.'); return; }
  if (bugunGiden() >= gunlukLimit()) { toast(`Bugünkü gönderim sınırı doldu (${gunlukLimit()}). Ayarlar'dan artırabilirsin.`); return; }
  if (S.gonderOnay !== id) {
    S.gonderOnay = id;
    drawerTazele();
    clearTimeout(gonderZ);
    gonderZ = setTimeout(() => { S.gonderOnay = null; if (S.acik) drawerTazele(); }, 5000);
    return;
  }
  S.gonderOnay = null;
  clearTimeout(gonderZ);
  await hepsiniYaz();
  const r = await tekGonder(id);
  if (r.ok) toast('Mail Gmail\'den gönderildi.');
}
function siraListesi() {
  const kalan = Math.max(0, gunlukLimit() - bugunGiden());
  return tumu().filter((a) => a.durum === 'onay' && !a.gonderimBelirsiz && gonderilebilir(a.id, a)).sort(puanaGore).slice(0, kalan).map((a) => a.id);
}
async function bekleVeyaDur(ms) {
  const son = Date.now() + ms;
  while (Date.now() < son) { if (!S.toplu || S.toplu.dur) return; await bekle(250); }
}
let topluZ = 0;
async function siradakileriGonder() {
  if (S.toplu) return;
  const liste = siraListesi();
  if (!liste.length) { toast(bugunGiden() >= gunlukLimit() ? 'Bugünkü gönderim sınırı doldu.' : 'Sırada gönderilecek mail yok.'); return; }
  if (!S.topluOnay) {
    S.topluOnay = true;
    cizGonderim();
    clearTimeout(topluZ);
    topluZ = setTimeout(() => { S.topluOnay = false; cizGonderim(); }, 6000);
    return;
  }
  S.topluOnay = false;
  clearTimeout(topluZ);
  await hepsiniYaz();
  S.toplu = { toplam: liste.length, bitti: 0, dur: false };
  cizGonderim();
  for (let i = 0; i < liste.length; i++) {
    if (!S.toplu || S.toplu.dur) break;
    const id = liste[i];
    const d = S.adaylar.get(id);
    if (!d || d.durum !== 'onay' || d.gonderimBelirsiz || !gonderilebilir(id, d)) continue;
    if (bugunGiden() >= gunlukLimit()) break;
    const r = await tekGonder(id);
    if (!r.ok) break;
    S.toplu.bitti++;
    cizGonderim();
    if (i < liste.length - 1) await bekleVeyaDur(6000 + Math.random() * 6000);
  }
  const n = S.toplu ? S.toplu.bitti : 0;
  const durdu = S.toplu ? S.toplu.dur : false;
  S.toplu = null;
  cizGonderim();
  if (n) toast(`${n} mail Gmail'den gönderildi${durdu ? '; kalanlar sırada bekliyor' : ''}.`);
}

/* Gönderilmiş maillerin Gmail yazışmalarını okur: yeni cevaplar ve ulaşmayan mailler adaya işlenir. */
async function cevaplariKontrolEt(tekId) {
  if (S.kontrol) return;
  if (!gmailVar()) { toast('Önce Gmail\'i bağla (Ayarlar).'); return; }
  const DOKSAN_GUN = 90 * 864e5;
  const kaynak = tekId ? [Object.assign({ id: tekId }, S.adaylar.get(tekId) || {})] : tumu();
  const hedef = kaynak.filter((a) => a && !a.ornek && gecerliEmail(a.email) && (a.gonderimBelirsiz
    || (a.gonderim && a.durum !== 'arsiv' && (tekId || Date.now() - new Date(a.gonderim.tarih).getTime() < DOKSAN_GUN))));
  if (!hedef.length) { toast(tekId ? 'Bu adayla Gmail\'de yazışma yok.' : 'Kontrol edilecek gönderilmiş mail yok.'); return; }
  S.kontrol = { toplam: hedef.length, bitti: 0 };
  cizGonderim();
  if (S.acik) drawerTazele();
  let yeni = 0, hataVar = null, sorun = 0;
  for (let i = 0; i < hedef.length; i += 8) {
    const ids = hedef.slice(i, i + 8).map((a) => a.id);
    try {
      const r = await api('gmail', { body: { action: 'sync', ids } });
      for (const p of r.people || []) uygula(p);
      yeni += r.yeni || 0;
      sorun += (r.errors || []).length;
    } catch (e) { hataVar = e; break; }
    if (S.kontrol) {
      S.kontrol.bitti = Math.min(hedef.length, i + ids.length);
      const bar = $('#kontrolBar');
      if (bar) bar.style.width = Math.round(S.kontrol.bitti / S.kontrol.toplam * 100) + '%';
    }
  }
  S.kontrol = null;
  S.sonKontrol = simdi();
  if (hataVar) gmailHata(hataVar);
  else toast((yeni ? `${yeni} yeni cevap geldi.` : 'Yeni cevap yok.') + (sorun ? ` ${sorun} yazışma okunamadı.` : ''));
  planla();
}

async function tlGmailGonder(id, i) {
  const k = id + ':' + i;
  if (S.tlOnay !== k) {
    S.tlOnay = k;
    tlYenidenCiz();
    setTimeout(() => { if (S.tlOnay === k) { S.tlOnay = null; tlYenidenCiz(); } }, 5000);
    return;
  }
  S.tlOnay = null;
  await hepsiniYaz();
  const d = S.adaylar.get(id);
  const e = d && (d.yazisma || [])[i];
  if (!e || e.yon !== 'taslak') return;
  const el = $('#tl-' + i);
  const metin = String(el ? el.value : e.metin || '').trim();
  if (!metin) { toast('Taslak boş.'); return; }
  S.isler[id + ':tl'] = {};
  tlYenidenCiz();
  try {
    const r = await api('gmail', { body: { action: 'reply', id, metin, i } });
    uygula(r.person);
    toast('Cevap Gmail\'den gönderildi.');
  } catch (err) { gmailHata(err); }
  finally { delete S.isler[id + ':tl']; tlYenidenCiz(); planla(); }
}
function tlYenidenCiz() {
  const tl = $('#tl');
  if (tl) tl.dataset.iz = '';
  if (S.acik) drawerTazele();
}

async function gmailBagla() {
  try {
    const r = await api('gmail', { body: { action: 'connect' } });
    location.href = r.url;
  } catch (e) { hata(e); }
}
async function gmailBitir(o) {
  sekmeAc('ayarlar');
  if (o.error) { toast(o.error === 'access_denied' ? 'Gmail izni verilmedi.' : 'Google bağlantıyı tamamlamadı (' + o.error + ').'); return; }
  try {
    const r = await api('gmail', { body: { action: 'finish', code: o.code, state: o.state } });
    S.gmail.connected = true;
    S.gmail.email = r.email;
    toast('Gmail bağlandı: ' + r.email);
  } catch (e) { hata(e); }
  cizAyarlar();
}
let kesZ = 0;
async function gmailKes() {
  if (!S.kesOnay) {
    S.kesOnay = true;
    gmailAyarCiz();
    clearTimeout(kesZ);
    kesZ = setTimeout(() => { S.kesOnay = false; gmailAyarCiz(); }, 5000);
    return;
  }
  S.kesOnay = false;
  try {
    await api('gmail', { body: { action: 'disconnect' } });
    S.gmail.connected = false;
    S.gmail.email = '';
    toast('Gmail bağlantısı kesildi.');
  } catch (e) { hata(e); }
  ciz();
}
async function gmailTest() {
  const b = $('#btnGmailTest');
  if (b) b.disabled = true;
  try {
    const r = await api('gmail', { body: { action: 'test' } });
    toast('Deneme maili gönderildi: ' + r.to + '. Gelen kutuna bak.');
  } catch (e) { gmailHata(e); }
  finally { if (b) b.disabled = false; }
}

/* ---------- İçe aktar ---------- */

function cizEkle(zorla) {
  const ssUygun = !!S.ai.configured;
  const drop = $('#dropSS');
  drop.setAttribute('aria-disabled', String(!ssUygun));
  $('#fileSS').disabled = !ssUygun;
  $('#ssNot').textContent = ssUygun
    ? `Claude tek seferde ${GORSEL.grup} görsel okur; fazlası sırayla işlenir.`
    : 'Ekran görüntüsü okumak için Claude bağlantısı gerekli (Ayarlar → Claude). O zamana kadar “Elle ekle” ile girebilirsin.';
  const kap = $('#inceleme');
  const I = S.inceleme;
  if (!I) { kap.innerHTML = ''; kap.dataset.iz = ''; return; }
  const iz = incelemeIzi(I);
  if (!zorla && kap.dataset.iz === iz) return;
  if (!zorla && kap.contains(document.activeElement) && document.activeElement.matches('input,textarea,select')) return;
  kap.dataset.iz = iz;
  kap.innerHTML = I.tur === 'ekran' ? ekranIncelemeHtml(I) : csvIncelemeHtml(I);
  genislik(kap);
}
function incelemeIzi(I) {
  if (I.tur === 'ekran') return ['e', I.durum, I.bitti, I.kartlar.length, I.kartlar.map((k) => k.eklendi || (S.adaylar.has(docId(k.d)) ? 'v' : '-')).join('')].join('|');
  return ['c', I.adaylar.length, I.secim.size, JSON.stringify(I.esleme), I.ilerleme ? I.ilerleme.bitti : '-', I.sonuc ? JSON.stringify(I.sonuc) : '-', I.adaylar.filter((x) => S.adaylar.has(x.id)).length].join('|');
}
function kartDurumHtml(k) {
  if (k.eklendi === 'eklendi') return 'Eklendi.';
  if (k.eklendi === 'guncellendi') return 'Listedeki kayıt güncellendi.';
  if (S.adaylar.has(docId(k.d))) return 'Zaten listede; eklersen boş bilgileri tamamlanır.';
  return gecerliEmail(k.d.email) ? 'Kişiye özel mail hazırlanacak.' : 'E-posta yok: DM metniyle ulaşabilirsin.';
}
function ekranIncelemeHtml(I) {
  const okunuyor = I.durum === 'okunuyor';
  const kalan = I.kartlar.filter((k) => !k.eklendi).length;
  const baslik = okunuyor ? `Okunuyor: ${I.bitti}/${I.toplam} görsel` : `Kontrol et: ${I.kartlar.length} hesap bulundu`;
  const nisOps = (sec) => Object.keys(NISLER).map((k) => `<option value="${k}"${k === sec ? ' selected' : ''}>${esc(NISLER[k].ad)}</option>`).join('');
  const kartlar = I.kartlar.map((k, i) => {
    const d = k.d;
    const thumbs = k.gorseller.filter((n) => I.onizler[n]).slice(0, 3).map((n) => `<img src="${esc(I.onizler[n])}" alt="Yüklenen ekran görüntüsü ${n + 1}">`).join('');
    const ek = k.eklendi;
    return `<article class="rcard${ek ? ' eklendi' : ''}" data-kart="${i}">
      <div class="rc-thumbs">${thumbs}</div>
      <div class="rc-body">
        <div class="rc-head">${avHtml(d)}<div class="who"><span class="nm">${esc(d.ad || '@' + d.handle)}</span><span class="hd">${d.handle ? '@' + esc(d.handle) + ' · ' : ''}${esc(PLATFORM_AD[d.platform] || '')}${d.takipci != null ? ' · ' + esc(fmtSayi(d.takipci)) + ' takipçi' : ''}</span></div><span class="rc-puan">uyum ${d.puan}</span></div>
        ${ek ? '' : `<div class="rc-grid">
          <label class="f">Ad<input data-kf="ad" value="${esc(d.ad)}" autocomplete="off"></label>
          <label class="f">Kullanıcı adı<input data-kf="handle" value="${esc(d.handle)}" autocomplete="off"></label>
          <label class="f">E-posta<input data-kf="email" type="email" value="${esc(d.email)}" autocomplete="off"></label>
          <label class="f">Takipçi<input data-kf="takipci" inputmode="decimal" value="${d.takipci == null ? '' : esc(d.takipci)}" autocomplete="off"></label>
          <label class="f">Şehir<input data-kf="sehir" value="${esc(d.sehir)}" autocomplete="off"></label>
          <label class="f">İçerik alanı<select data-kf="nis">${nisOps(d.nis)}</select></label>
          <label class="f full">Bio<textarea data-kf="bio" rows="2" dir="auto">${esc(d.bio)}</textarea></label>
        </div>`}
        <div class="rc-foot"><span class="rc-durum">${esc(kartDurumHtml(k))}</span>${ek
          ? `<button class="btn btn-s" type="button" data-act="ac" data-id="${esc(k.id || docId(d))}">Aç</button>`
          : `<button class="btn btn-gold" type="button" data-act="kartEkle" data-k="${i}">${S.adaylar.has(docId(d)) ? 'Güncelle' : 'Ekle'}</button><button class="btn btn-quiet" type="button" data-act="kartCikar" data-k="${i}">Çıkar</button>`}</div>
      </div>
    </article>`;
  }).join('');
  const bos = !okunuyor && !I.kartlar.length ? '<p class="bos-satir">Görsellerde profil bilgisi bulunamadı. Kullanıcı adı ve takipçi sayısı görünecek şekilde profilin üst kısmını çek.</p>' : '';
  const atlanan = I.atlanan && I.atlanan.length ? `<p class="not">Okunamayan dosya: ${esc(I.atlanan.join(', '))}. PNG, JPG ya da WebP kullan.</p>` : '';
  return `<div class="review">
    <div class="review-head"><div><h2>${esc(baslik)}</h2>${okunuyor ? '<p>Claude görselleri okuyor; birkaç saniye sürebilir.</p>' : ''}</div>
      <div class="actions m0">${okunuyor ? '<button class="btn" type="button" data-act="ekranDurdur">Durdur</button>' : ''}${!okunuyor && kalan > 1 ? `<button class="btn btn-gold" type="button" data-act="hepsiniEkle">Hepsini ekle (${kalan})</button>` : ''}${!okunuyor ? '<button class="btn btn-quiet" type="button" data-act="incelemeKapat">Kapat</button>' : ''}</div></div>
    ${okunuyor ? ilerlemeHtml(I.bitti, I.toplam, 'Okuma') : ''}
    ${atlanan}${bos}<div class="rcards">${kartlar}</div></div>`;
}

function blobB64(blob) {
  return new Promise((ok, no) => {
    const r = new FileReader();
    r.onload = () => ok(String(r.result).split(',')[1] || '');
    r.onerror = () => no(r.error);
    r.readAsDataURL(blob);
  });
}
// phone screenshots are large: send them at most 1568 px on the long side, as JPEG (what Claude reads anyway)
async function kucult(dosya) {
  const url = URL.createObjectURL(dosya);
  try {
    const img = await new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = no; i.src = url; });
    const k = Math.min(1, GORSEL.kenar / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * k)), h = Math.max(1, Math.round(img.naturalHeight * k));
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const g = c.getContext('2d');
    g.fillStyle = '#fff';
    g.fillRect(0, 0, w, h);
    g.drawImage(img, 0, 0, w, h);
    const blob = await new Promise((ok) => c.toBlob(ok, 'image/jpeg', 0.86));
    return { type: 'image/jpeg', data: await blobB64(blob) };
  } finally {
    URL.revokeObjectURL(url);
  }
}
async function ekranOku(dosyalar) {
  if (!S.ai.configured) { toast('Ekran görüntüsü okumak için Claude bağlantısı gerekli (Ayarlar → Claude).'); return; }
  if (S.inceleme && S.inceleme.durum === 'okunuyor') { toast('Önceki görseller hâlâ okunuyor.'); return; }
  const uygun = [], atlanan = [];
  for (const f of dosyalar) {
    if (GORSEL.tipler.includes(f.type) && f.size <= 25 * 1024 * 1024) uygun.push(f);
    else atlanan.push(f.name || 'görsel');
  }
  if (!uygun.length) { toast('Görseller okunamadı: PNG, JPG ya da WebP seç.'); return; }
  const gruplar = [];
  for (let i = 0; i < uygun.length; i += GORSEL.grup) gruplar.push(uygun.slice(i, i + GORSEL.grup));
  if (S.inceleme && S.inceleme.onizler) S.inceleme.onizler.forEach((u) => { try { URL.revokeObjectURL(u); } catch (e) { /* yok */ } });
  const I = { tur: 'ekran', durum: 'okunuyor', dur: false, toplam: uygun.length, bitti: 0, kartlar: [], atlanan, onizler: uygun.map((f) => URL.createObjectURL(f)) };
  S.inceleme = I;
  sekmeAc('ekle');
  let taban = 0;
  try {
    for (const grup of gruplar) {
      if (I.dur) break;
      const images = [];
      for (const f of grup) {
        try { images.push(await kucult(f)); } catch (e) { atlanan.push(f.name || 'görsel'); images.push(null); }
      }
      const gecerli = images.filter(Boolean);
      if (gecerli.length) {
        const r = await api('ai', { body: { kind: 'ekran', images: gecerli } });
        if (S.inceleme !== I) return;
        // image numbers in the answer count only the images that were sent
        const sira = images.map((x, j) => (x ? taban + j : -1)).filter((n) => n >= 0);
        for (const p of r.profiles || []) {
          const d = adayOlustur(p, 'ekran', S.ayar);
          if (!d.handle && !d.email) continue;
          const gorseller = (Array.isArray(p.gorsel) ? p.gorsel : []).map((n) => sira[Number(n) - 1]).filter((n) => n != null);
          kartBirlestir(I, d, gorseller.length ? gorseller : [sira[0]]);
        }
      }
      taban += grup.length;
      I.bitti = taban;
      cizEkle(true);
    }
  } catch (e) { hata(e); }
  if (S.inceleme !== I) return;
  I.durum = 'hazir';
  cizEkle(true);
}
function kartBirlestir(I, d, gorseller) {
  const id = docId(d);
  const k = I.kartlar.find((x) => docId(x.d) === id);
  if (!k) { I.kartlar.push({ d, gorseller, eklendi: false }); return; }
  for (const f of ['ad', 'bio', 'email', 'sehir', 'ulke', 'kategori']) if (!k.d[f] && d[f]) k.d[f] = d[f];
  if (d.takipci != null) k.d.takipci = d.takipci;
  k.gorseller = k.gorseller.concat(gorseller);
  yenidenHesapla(k.d);
}
function yenidenHesapla(d) {
  d.hitapAdi = hitapAdiBul(d.ad, d.handle);
  d.profil = profilUrl(d.platform, d.handle);
  d.puan = puanHesapla(d).toplam;
  d.mail = Object.assign(mailUret(d, S.ayar), { uretim: 'sablon' });
  d.durum = gecerliEmail(d.email) ? 'hazir' : 'yeni';
}
function kartAlan(el) {
  const kartEl = el.closest('[data-kart]');
  const I = S.inceleme;
  if (!kartEl || !I) return;
  const k = I.kartlar[+kartEl.dataset.kart];
  const f = el.dataset.kf;
  let v = el.value;
  if (f === 'takipci') v = yuvarla(parseSayi(v), 0);
  else if (f === 'handle') v = normHandle(v);
  else if (f === 'email') v = String(v).trim().toLowerCase();
  k.d[f] = v;
  yenidenHesapla(k.d);
  $('.rc-puan', kartEl).textContent = 'uyum ' + k.d.puan;
  $('.rc-durum', kartEl).textContent = kartDurumHtml(k);
}
async function kartKaydet(i) {
  const I = S.inceleme;
  const k = I && I.kartlar[i];
  if (!k || k.eklendi) return;
  const d = k.d;
  if (!d.handle && !d.email) { toast('Kullanıcı adı ya da e-posta gerekli.'); return; }
  const id = docId(d);
  k.id = id;
  try {
    if (S.adaylar.has(id)) { await yazHam(id, birlestirYamasi(S.adaylar.get(id), d)); k.eklendi = 'guncellendi'; }
    else { await adayYaz(id, d); k.eklendi = 'eklendi'; }
  } catch (e) { hata(e); }
  cizEkle(true);
}
function incelemeKapat() {
  if (S.inceleme && S.inceleme.onizler) S.inceleme.onizler.forEach((u) => { try { URL.revokeObjectURL(u); } catch (e) { /* yok */ } });
  S.inceleme = null;
  cizEkle(true);
}

async function csvYukle(dosya) {
  if (/\.xlsx?$/i.test(dosya.name)) { toast('Modash\'tan CSV olarak dışa aktarıp onu bırak.'); return; }
  let metin = '';
  try { metin = await dosya.text(); } catch (e) { toast('Dosya okunamadı.'); return; }
  const satirlar = csvAyir(metin);
  if (satirlar.length < 2) { toast('CSV\'de aday satırı bulunamadı.'); return; }
  const basliklar = satirlar[0].map((s) => String(s).trim());
  const veri = satirlar.slice(1);
  S.inceleme = { tur: 'csv', dosya: dosya.name, basliklar, veri, esleme: sutunEsle(basliklar, veri) };
  csvHesapla();
  sekmeAc('ekle');
}
function csvHesapla() {
  const I = S.inceleme;
  I.adaylar = csvAdaylari(I.veri, I.esleme, S.ayar);
  I.secim = new Set(I.adaylar.filter((x) => !S.adaylar.has(x.id)).map((x) => x.id));
  I.sonuc = null;
}
function csvIncelemeHtml(I) {
  const varOlan = I.adaylar.filter((x) => S.adaylar.has(x.id)).length;
  const yeni = I.adaylar.length - varOlan;
  const eksik = I.esleme.handle == null && I.esleme.profil == null;
  const esleme = HEDEF_ALANLAR.map((h) => `<label class="f">${esc(h.ad)}<select data-esle="${h.k}"><option value="">Yok</option>${I.basliklar.map((b, i) => `<option value="${i}"${I.esleme[h.k] === i ? ' selected' : ''}>${esc(b || 'Sütun ' + (i + 1))}</option>`).join('')}</select></label>`).join('');
  const goster = I.adaylar.slice(0, 250);
  const satirlar = goster.map((x) => {
    const d = x.d, v = S.adaylar.has(x.id);
    return `<tr class="${v ? 'var-olan' : ''}"><td><input type="checkbox" data-csv-sec="${esc(x.id)}" aria-label="${esc(d.handle || d.email)} seç"${I.secim.has(x.id) ? ' checked' : ''}></td><td>${d.handle ? '@' + esc(d.handle) : '–'}</td><td>${esc(d.ad)}</td><td class="num">${esc(fmtSayi(d.takipci))}</td><td class="num">${esc(fmtYuzde(d.etkilesim))}</td><td>${gecerliEmail(d.email) ? esc(d.email) : '<span class="warn">yok</span>'}</td><td>${esc((NISLER[d.nis] || NISLER.diger).ad)}</td><td>${esc(DIL_AD[d.dil])}</td><td class="num">${d.puan}</td><td>${v ? 'Listede' : 'Yeni'}</td></tr>`;
  }).join('');
  const ilerleme = I.ilerleme ? ilerlemeHtml(I.ilerleme.bitti, I.ilerleme.toplam, 'Ekleniyor') : '';
  const sonuc = I.sonuc ? `<div class="sonuc"><span><b>${I.sonuc.eklenen}</b> aday eklendi${I.sonuc.guncellenen ? `, <b>${I.sonuc.guncellenen}</b> kayıt güncellendi` : ''}${I.sonuc.hata ? `, <b>${I.sonuc.hata}</b> kayıt yazılamadı` : ''}.</span><button class="btn btn-s" type="button" data-act="tab" data-tab="adaylar">Adaylara git</button></div>` : '';
  return `<div class="review">
    <div class="review-head"><div><h2>Kontrol et: ${esc(I.dosya)}</h2><p>${I.adaylar.length} kişi bulundu · ${yeni} yeni · ${varOlan} zaten listede${I.veri.length > I.adaylar.length ? ` · ${I.veri.length - I.adaylar.length} satırda kullanıcı adı ya da e-posta yok` : ''}</p></div>
      <div class="actions m0"><button class="btn btn-quiet" type="button" data-act="incelemeKapat">Kapat</button></div></div>
    <details class="esleme-kap"${eksik ? ' open' : ''}><summary>Sütun eşleştirme${eksik ? ': kullanıcı adı sütununu seç' : ''}</summary><div class="esleme">${esleme}</div></details>
    ${I.adaylar.length ? `<div class="tablo-kap"><table><thead><tr><th><input type="checkbox" data-csv-tumu aria-label="Tümünü seç"${I.secim.size === I.adaylar.length ? ' checked' : ''}></th><th>Kullanıcı adı</th><th>Ad</th><th class="num">Takipçi</th><th class="num">Etkileşim</th><th>E-posta</th><th>İçerik</th><th>Mail dili</th><th class="num">Uyum</th><th>Durum</th></tr></thead><tbody>${satirlar}</tbody></table></div>${I.adaylar.length > goster.length ? `<p class="not mt8">İlk ${goster.length} satır gösteriliyor; seçim hepsine uygulanır.</p>` : ''}` : '<p class="bos-satir">Eşleşen aday çıkmadı. Sütun eşleştirmeden kullanıcı adı ya da profil sütununu seç.</p>'}
    ${ilerleme}
    <div class="actions">${I.ilerleme ? '' : `<button class="btn btn-primary" type="button" data-act="csvEkle"${I.secim.size ? '' : ' disabled'}>Seçilen ${I.secim.size} kişiyi ekle</button>`}</div>
    ${sonuc}</div>`;
}
async function csvIceAktar() {
  const I = S.inceleme;
  const liste = I.adaylar.filter((x) => I.secim.has(x.id));
  if (!liste.length) { toast('Eklenecek kişi seçilmedi.'); return; }
  const islemler = liste.map((x) => (S.adaylar.has(x.id)
    ? { op: 'patch', id: x.id, patch: birlestirYamasi(S.adaylar.get(x.id), x.d) }
    : { op: 'create', id: x.id, data: x.d }));
  const guncellenecek = islemler.filter((x) => x.op === 'patch').length;
  I.ilerleme = { bitti: 0, toplam: liste.length };
  cizEkle(true);
  let sonuc;
  try {
    sonuc = await topluYaz(islemler, (b, t) => {
      I.ilerleme = { bitti: b, toplam: t };
      const bar = $('#inceleme .ilerleme i');
      if (bar) bar.style.width = Math.round(b / t * 100) + '%';
    });
  } catch (e) { hata(e); sonuc = { tamam: 0, hata: [{}] }; }
  I.ilerleme = null;
  const guncellenen = Math.min(guncellenecek, sonuc.tamam);
  I.sonuc = { eklenen: sonuc.tamam - guncellenen, guncellenen, hata: sonuc.hata.length };
  I.secim = new Set();
  if (sonuc.hata.length && sonuc.hata[0].message) toast(sonuc.hata[0].message);
  else if (!sonuc.hata.length) toast(`${sonuc.tamam} aday işlendi.`);
  cizEkle(true);
}

async function elleEkle(ev) {
  ev.preventDefault();
  const form = ev.target;
  const g = Object.fromEntries(new FormData(form).entries());
  if (/^https?:/i.test(g.handle || '') || /\.com\//i.test(g.handle || '')) {
    g.profil = g.handle;
    if (/tiktok|youtube/i.test(g.handle)) g.platform = '';
  }
  if (!g.nis) delete g.nis;
  if (g.platform === 'web') { g.tur = 'medya'; if (!g.profil && /\./.test(g.handle || '')) g.profil = 'https://' + String(g.handle).replace(/^https?:\/\//, ''); }
  const d = adayOlustur(g, 'elle', S.ayar);
  if (d.tur === 'medya') { d.hitap = 'siz'; d.hitapAdi = (temizAd(d.ad) || d.handle) + ' ekibi'; d.mail = Object.assign(mailUret(d, S.ayar), { uretim: 'sablon' }); }
  if (!d.handle && !d.email) { toast('Kullanıcı adı ya da e-posta gir.'); return; }
  const id = docId(d);
  if (S.adaylar.has(id)) { toast('Bu kişi zaten listede.'); drawerAc(id); return; }
  try {
    await adayYaz(id, d);
    form.reset();
    toast('Aday eklendi; maili hazır.');
    sekmeAc('adaylar');
    drawerAc(id);
  } catch (e) { hata(e); }
}

// a backup made with "Yedek indir" (or the old claude.ai panel's export): people not on the list are added
async function yedekYukle(dosya) {
  let j;
  try { j = JSON.parse(await dosya.text()); } catch (e) { toast('Yedek dosyası okunamadı.'); return; }
  const liste = Array.isArray(j) ? j : Array.isArray(j && j.people) ? j.people : [];
  const islemler = [];
  for (const x of liste) {
    const d = x && (x.d || x.data || (x.handle || x.email ? x : null));
    if (!d || typeof d !== 'object') continue;
    const id = (x.id && /^[A-Za-z0-9_.:@+-]{1,100}$/.test(x.id)) ? x.id : docId(d);
    if (S.adaylar.has(id)) continue;
    islemler.push({ op: 'create', id, data: d });
  }
  if (!islemler.length) { toast(liste.length ? 'Yedekteki herkes zaten listede.' : 'Yedekte kişi bulunamadı.'); return; }
  toast(`${islemler.length} kişi ekleniyor…`);
  try {
    const r = await topluYaz(islemler);
    toast(`${r.tamam} kişi eklendi${r.hata.length ? `, ${r.hata.length} kayıt eklenemedi` : ''}.`);
    sekmeAc('adaylar');
  } catch (e) { hata(e); }
}

/* ---------- Gönderim ---------- */

function sonGelen(a) {
  const y = (a.yazisma || []).filter((e) => e.yon === 'gelen' && !e.teslimHatasi && !e.otomatik);
  return y.length ? y[y.length - 1] : null;
}
function gmailDurumHtml() {
  if (S.gmail.connected) return { sinif: '', metin: `Gmail bağlı: mailler <b>${esc(S.gmail.email || S.ayar.gonderenEmail)}</b> adresinden gider, cevaplar buradan okunur.` };
  if (!S.gmail.configured) return { sinif: ' uyari', metin: 'Gmail bağlantısı kurulmamış: Cloudflare\'e Google anahtarları eklenmeli (Ayarlar\'da adımlar var). O zamana kadar “Gmail\'de aç” ile gönderebilirsin.' };
  return { sinif: ' uyari', metin: 'Gmail bağlı değil. <button class="btn btn-s btn-gold" type="button" data-act="gmailBagla">Gmail\'i bağla</button>' };
}
function cizGonderim() {
  const t = tumu();
  const limit = gunlukLimit();
  const bugun = bugunGiden();
  const onayli = t.filter((a) => a.durum === 'onay').sort(puanaGore);
  const cevap = t.filter((a) => a.durum === 'cevap').sort((a, b) => String((sonGelen(b) || {}).tarih || '').localeCompare(String((sonGelen(a) || {}).tarih || '')));
  const kalan = Math.max(0, limit - bugun - onayli.length);
  const hazir = t.filter((a) => a.durum === 'hazir' && gecerliEmail(a.email) && !a.ornek).sort(puanaGore);
  const oneriler = hazir.slice(0, kalan);
  for (const a of oneriler) if (!S.oneriGorulen.has(a.id)) { S.oneriGorulen.add(a.id); S.oneriSecim.add(a.id); }
  $('#stGun').textContent = `${bugun} / ${limit}`;
  $('#stOnay').textContent = onayli.length;
  $('#stCevap').textContent = cevap.length;

  const oe = $('#oneriler');
  const odak = oe.contains(document.activeElement) ? document.activeElement.id : '';
  const secili = oneriler.filter((a) => S.oneriSecim.has(a.id)).length;
  oe.innerHTML = oneriler.length
    ? `<div class="mini-liste">${oneriler.map((a) => `<div class="mrow"><input type="checkbox" id="on-${esc(a.id)}" data-oneri="${esc(a.id)}"${S.oneriSecim.has(a.id) ? ' checked' : ''} aria-label="${esc(a.ad || a.handle)} seç">${avHtml(a)}<span class="who"><label for="on-${esc(a.id)}" class="nm">${esc(a.ad || '@' + a.handle)}</label><span class="hd">${a.handle ? '@' + esc(a.handle) + ' · ' : ''}${esc((NISLER[a.nis] || NISLER.diger).ad)} · ${esc(fmtSayi(a.takipci))} takipçi · ${esc(DIL_AD[a.dil] || '')}</span></span><span class="c-score">${skorHtml(a.puan)}</span><span class="acts"><button class="btn btn-s btn-quiet" type="button" data-act="ac" data-id="${esc(a.id)}">Maili gör</button></span></div>`).join('')}</div><div class="actions"><button class="btn btn-gold" type="button" id="btnOnerOnay" data-act="secilenleriOnayla"${secili ? '' : ' disabled'}>Seçilen ${secili} maili onayla</button></div>`
    : `<p class="bos-satir">${hazir.length ? 'Bugünkü sınır doldu. Yarın yeni öneriler gelir; sınırı Ayarlar\'dan değiştirebilirsin.' : 'Maili hazır aday yok. İçe aktar sekmesinden aday ekle.'}</p>`;
  genislik(oe);
  if (odak) { const el = document.getElementById(odak); if (el) el.focus({ preventScroll: true }); }

  const gm = gmailVar();
  const gd = gmailDurumHtml();
  const el = $('#gmailDurum');
  el.className = 'gmail-durum' + gd.sinif + (gm ? '' : ' kapali');
  el.innerHTML = '<span class="gmail-dot" aria-hidden="true"></span><span>' + gd.metin + '</span>';
  const otoNot = gm && S.ayar.oto ? `Otomatik gönderim açık: hafta içi ${S.ayar.otoBas}:00–${S.ayar.otoBit}:00 arasında ${S.ayar.otoKapsam === 'onay' ? 'onayladığın' : 'maili hazır olan'} kişilere günde en fazla ${limit} mail kendiliğinden, aralara yayılarak gider. ` : '';
  $('#siraAciklama').textContent = otoNot + (gm
    ? `Onayladığın mailler burada bekler. “Sıradakileri Gmail'den gönder” dediğinde ${S.gmail.email || 'bağlı hesap'} adresinden tek tek, aralarında birkaç saniye bırakarak gider; bitene kadar sayfa açık kalmalı.`
    : 'Onayladığın mailler burada bekler. Gmail bağlanınca tek tuşla gönderilir; o zamana kadar “Gmail\'de aç” ile gönderip “Gönderildi say” diyebilirsin.');
  $('#cevapAciklama').textContent = gm
    ? 'Gönderilen maillerin Gmail yazışmalarına bakar, gelen cevapları ve ulaşmayan mailleri ilgili adaya işler. Açıp Claude\'a cevap taslağı yazdırabilir, taslağı buradan Gmail\'le gönderebilirsin.'
    : 'Cevap gelen adaylar. Gelen maili adayın yazışmasına yapıştırıp Claude\'a cevap taslağı yazdırabilirsin.';
  const siraN = siraListesi().length;
  const se = $('#siraEylem');
  if (!gm || !onayli.length) se.innerHTML = '';
  else if (S.toplu) se.innerHTML = `<div class="eylem">${ilerlemeHtml(S.toplu.bitti, S.toplu.toplam, 'Gönderim')}<span class="not">${S.toplu.bitti}/${S.toplu.toplam} gönderildi${S.toplu.dur ? ' · durduruluyor' : ' · aralarda birkaç saniye bekleniyor'}</span><button class="btn btn-s" type="button" data-act="topluDur"${S.toplu.dur ? ' disabled' : ''}>Durdur</button></div>`;
  else if (siraN) se.innerHTML = `<div class="eylem"><button class="btn btn-primary" type="button" data-act="siraGmail">${S.topluOnay ? `Evet, ${siraN} kişiye şimdi gönder` : `Sıradakileri Gmail'den gönder (${siraN})`}</button>${onayli.length > siraN ? `<span class="not">${onayli.length - siraN} mail günlük sınır, örnek kayıt ya da sonucu belirsiz gönderim yüzünden bekliyor.</span>` : ''}</div>`;
  else se.innerHTML = `<div class="eylem"><span class="not">${bugun >= limit ? `Bugünkü gönderim sınırı doldu (${limit}); kalanlar yarın gidebilir.` : 'Sıradaki mailler gönderilemiyor: örnek kayıt ya da sonucu belirsiz gönderim. Satırlardan kontrol et.'}</span></div>`;
  genislik(se);
  $('#sira').innerHTML = onayli.length
    ? `<div class="mini-liste">${onayli.map((a) => `<div class="mrow no-check">${avHtml(a)}<span class="who"><span class="nm">${esc(a.ad || '@' + a.handle)}${a.ornek ? '<em class="ornek">ÖRNEK</em>' : ''}${a.gonderimBelirsiz ? '<em class="etiket-uyari">SONUÇ BELİRSİZ</em>' : ''}</span><span class="hd">${esc(a.email)} · ${esc((a.mail && a.mail.konu) || '')}</span></span><span class="acts">${gm
      ? `<button class="btn btn-s btn-quiet" type="button" data-act="ac" data-id="${esc(a.id)}">Maili gör</button>${a.gonderimBelirsiz ? `<button class="btn btn-s" type="button" data-act="gmailYenile" data-id="${esc(a.id)}">Gmail'den kontrol et</button>` : ''}`
      : `<a class="btn btn-s" target="_blank" rel="noopener" href="${esc(gmailLink(a.email, (a.mail && a.mail.konu) || '', (a.mail && a.mail.govde) || '', S.ayar.gonderenEmail))}">Gmail'de aç</a><button class="btn btn-s btn-gold" type="button" data-act="siraGonderildi" data-id="${esc(a.id)}">Gönderildi say</button>`}<button class="btn btn-s btn-quiet" type="button" data-act="siraGeriAl" data-id="${esc(a.id)}">Geri al</button></span></div>`).join('')}</div>`
    : '<p class="bos-satir">Sırada onaylı mail yok. Yukarıdaki önerilerden seç ya da aday ayrıntısından onayla.</p>';
  const ce = $('#cevapEylem');
  const kontrolN = t.filter((a) => !a.ornek && gecerliEmail(a.email) && a.durum !== 'arsiv' && (a.gonderimBelirsiz || a.gonderim)).length;
  if (!gm) ce.innerHTML = '';
  else if (S.kontrol) ce.innerHTML = `<div class="eylem">${ilerlemeHtml(S.kontrol.bitti, S.kontrol.toplam, 'Gmail kontrolü', 'kontrolBar')}<span class="not">Gmail'deki yazışmalara bakılıyor…</span></div>`;
  else ce.innerHTML = `<div class="eylem"><button class="btn btn-gold" type="button" data-act="cevapKontrol"${kontrolN ? '' : ' disabled'}>Cevapları Gmail'den al</button><span class="not">${kontrolN ? `${kontrolN} gönderilmiş yazışmaya bakılır.` : 'Henüz gönderilmiş mail yok.'}${S.sonKontrol ? ' Son bakış: ' + esc(fmtTarih(S.sonKontrol)) + '.' : ''}</span></div>`;
  genislik(ce);
  $('#cevaplar').innerHTML = cevap.length
    ? `<div class="mini-liste">${cevap.map((a) => { const g = sonGelen(a); return `<div class="mrow no-check">${avHtml(a)}<span class="who"><span class="nm">${esc(a.ad || '@' + a.handle)}</span><span class="alinti" dir="auto">${esc(g ? (g.ozet || g.metin || '') : '')}</span></span><span class="acts"><button class="btn btn-s btn-primary" type="button" data-act="cevapYaz" data-id="${esc(a.id)}">Cevap yaz</button></span></div>`; }).join('')}</div>`
    : '<p class="bos-satir">Cevap bekleyen yazışma yok.</p>';
}
async function secilenleriOnayla() {
  await hepsiniYaz();
  const ids = Array.from(S.oneriSecim).filter((id) => { const d = S.adaylar.get(id); return d && d.durum === 'hazir' && gecerliEmail(d.email) && d.mail && d.mail.govde; });
  if (!ids.length) { toast('Onaylanacak mail seçilmedi.'); return; }
  const t = simdi();
  try {
    const r = await topluYaz(ids.map((id) => ({ op: 'patch', id, patch: { durum: 'onay', mail: { onayTarih: t } } })));
    for (const id of ids) S.oneriSecim.delete(id);
    toast(r.hata.length ? `${r.tamam} mail onaylandı, ${r.hata.length} kayıt yazılamadı.` : `${ids.length} mail onaylandı ve gönderim sırasına girdi.`);
  } catch (e) { hata(e); }
}

/* ---------- Ayarlar ---------- */

function cizAyarlar() {
  gmailAyarCiz();
  claudeAyarCiz();
  otoCiz();
  ayarFormDoldur();
  onizlemeCiz();
  bannerCiz();
}
function gmailAyarCiz() {
  const el = $('#gmailAyar');
  if (!el) return;
  const g = S.gmail;
  if (!g.configured) {
    el.innerHTML = `<p class="durum-satir"><span class="bad">Kurulmamış.</span> Cloudflare'de eksik: <code>${esc((g.missing || []).join(', ') || 'GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET')}</code></p>
      <ol class="steps"><li>Google Cloud'da (lulosmac.com hesabıyla) bir proje aç, <b>Gmail API</b>'yi etkinleştir.</li><li><b>OAuth consent screen</b>: kullanıcı türü <b>Internal</b>.</li><li><b>Credentials → OAuth client ID</b>, tür <b>Web application</b>, yönlendirme adresi: <code>${esc(location.origin + '/admin/influencer/')}</code></li><li>Client ID ve secret'ı Cloudflare Pages → Settings → Variables and Secrets'a <b>Secret</b> olarak ekle: <code>GOOGLE_CLIENT_ID</code>, <code>GOOGLE_CLIENT_SECRET</code>; sonra son yayını yeniden başlat.</li></ol>`;
    return;
  }
  if (!g.connected) {
    el.innerHTML = '<p class="durum-satir"><span class="bad">Bağlı değil.</span> Mailler support@lulosmac.com kutusundan gitsin diye bir kez bağlaman yeter. Google iki izin sorar: mail gönderme ve okuma.</p><div class="actions"><button class="btn btn-gold" type="button" data-act="gmailBagla">Gmail\'i bağla</button></div>';
    return;
  }
  const farkli = S.ayar.gonderenEmail && g.email && S.ayar.gonderenEmail.toLowerCase() !== g.email.toLowerCase();
  el.innerHTML = `<p class="durum-satir"><span class="ok">Bağlı:</span> <b>${esc(g.email)}</b></p>${farkli ? `<p class="not">Dikkat: imzadaki gönderen e-posta ${esc(S.ayar.gonderenEmail)}, bağlı hesap ${esc(g.email)}.</p>` : ''}
    <div class="actions"><button class="btn" type="button" id="btnGmailTest" data-act="gmailTest">Kendime deneme maili gönder</button><button class="btn ${S.kesOnay ? 'btn-danger-solid' : 'btn-quiet'}" type="button" data-act="gmailKes">${S.kesOnay ? 'Evet, bağlantıyı kes' : 'Bağlantıyı kes'}</button></div>`;
}
function claudeAyarCiz() {
  const el = $('#claudeAyar');
  if (!el) return;
  el.innerHTML = S.ai.configured
    ? `<p class="durum-satir"><span class="ok">Bağlı.</span> Ekran görüntüsü okuma, kişiselleştirme ve cevap taslakları açık${S.ai.model ? ` (model: ${esc(S.ai.model)})` : ''}.</p>`
    : '<p class="durum-satir"><b>İsteğe bağlı, şu an kapalı.</b></p>'
      + '<p class="not">Şablon mailler, gönderim, cevap takibi, CSV ve elle ekleme bunsuz da çalışır. Açarsan ekran görüntüsünden aday çıkarma, kişiye özel mail ve cevap taslakları eklenir.</p>'
      + '<p class="not">Açmak için <a href="https://platform.claude.com/settings/keys" target="_blank" rel="noopener">platform.claude.com → API keys</a> sayfasından bir anahtar al, Cloudflare\'de <a href="https://dash.cloudflare.com/?to=/:account/pages/view/lulosmac-yonetim/settings/environment-variables" target="_blank" rel="noopener">Variables and secrets</a> bölümüne <code>ANTHROPIC_API_KEY</code> adıyla Secret olarak ekle.</p>';
}
const ADIM_AD = { gonder: 'gönderim', kontrol: 'cevap kontrolü', taslak: 'Claude taslağı' };
function otoCiz() {
  const el = $('#otoAyar');
  if (!el) return;
  const d = S.oto.durum || {}, k = S.oto.anahtar || {};
  const not = $('#otoGonderNot');
  if (not) not.textContent = `Hafta içi ${S.ayar.otoBas}:00–${S.ayar.otoBit}:00 arasında, günlük sınır (${gunlukLimit()}) kadar mail güne yayılarak tek tek gider.`;
  const p = [];
  if (!k.var) p.push('<p class="durum-satir"><b>Zamanlayıcı bağlı değil.</b></p><p class="not">Otomasyonun çalışması için bir anahtar oluşturup Cloudflare\'deki lulo-otomasyon Worker\'ına eklemek gerekiyor.</p>');
  else if (!d.sonCalisma) p.push('<p class="durum-satir"><b>Anahtar hazır; zamanlayıcı henüz çalışmadı.</b></p><p class="not">Worker anahtarla birlikte 10 dakikada bir buraya uğrar.</p>');
  else p.push(`<p class="durum-satir"><span class="ok">Zamanlayıcı çalışıyor.</span> Son çalışma: ${esc(fmtTarih(d.sonCalisma))}</p>`);
  const b = [];
  if (d.sonGonderim) b.push(`Son otomatik mail: ${esc(d.sonGonderim.ad)} · ${esc(fmtTarih(d.sonGonderim.tarih))}`);
  if (S.ayar.oto && d.sonraki && Date.parse(d.sonraki) > Date.now()) b.push(`Sıradaki mail en erken: ${esc(fmtTarih(d.sonraki))}`);
  if (d.sonCevap) b.push(`Son yeni cevap: ${esc(fmtTarih(d.sonCevap.tarih))}`);
  if (d.sonTaslak) b.push(`Son Claude taslağı: ${esc(d.sonTaslak.ad)} · ${esc(fmtTarih(d.sonTaslak.tarih))}`);
  if (b.length) p.push(`<p class="not">${b.join('<br>')}</p>`);
  if (d.hata) p.push(`<p class="not uyari">Son hata (${esc(ADIM_AD[d.hata.adim] || d.hata.adim || '')}, ${esc(fmtTarih(d.hata.tarih))}): ${esc(d.hata.mesaj || '')}</p>`);
  if (S.yeniAnahtar) {
    p.push(`<div class="anahtar-kutu"><label class="f">Yeni anahtar <small>Yalnızca şimdi görünür. Kopyala ve Cloudflare'de lulo-otomasyon Worker'ının INF_CRON_KEY secret'ına yapıştır.</small><input id="otoAnahtar" readonly autocomplete="off" spellcheck="false" value="${esc(S.yeniAnahtar)}"></label><div class="actions"><button class="btn btn-gold btn-s" type="button" data-act="otoKopyala">Kopyala</button></div></div>`);
  } else {
    const sinif = k.var ? (S.anahtarOnay ? 'btn-danger-solid' : 'btn-quiet') : 'btn-gold';
    const yazi = k.var ? (S.anahtarOnay ? 'Evet, yeni anahtar oluştur (eskisi çalışmaz)' : 'Yeni anahtar oluştur') : 'Anahtar oluştur';
    p.push(`<div class="actions"><button class="btn btn-s ${sinif}" type="button" data-act="otoAnahtar">${yazi}</button></div>`);
  }
  el.innerHTML = p.join('');
}
let anahtarZ = 0;
async function otoAnahtar() {
  if (S.oto.anahtar.var && !S.anahtarOnay) {
    S.anahtarOnay = true;
    otoCiz();
    clearTimeout(anahtarZ);
    anahtarZ = setTimeout(() => { S.anahtarOnay = false; otoCiz(); }, 5000);
    return;
  }
  S.anahtarOnay = false;
  clearTimeout(anahtarZ);
  try {
    const r = await api('influencer', { body: { action: 'cronKey' } });
    S.yeniAnahtar = r.key;
    S.oto.anahtar = Object.assign({ var: true }, r.anahtar || {});
    otoCiz();
    const inp = $('#otoAnahtar');
    if (inp) { inp.focus(); inp.select(); }
    toast('Anahtar oluşturuldu; kopyalayıp Cloudflare\'e yapıştır.');
  } catch (e) { hata(e); }
}
async function otoKopyala() {
  const inp = $('#otoAnahtar');
  if (!inp) return;
  try {
    await navigator.clipboard.writeText(inp.value);
    toast('Anahtar kopyalandı.');
  } catch (e) {
    inp.focus();
    inp.select();
    toast('Kopyalanamadı; seçili metni Cmd+C ile kopyala.');
  }
}
function ayarFormDoldur() {
  for (const k of Object.keys(AYAR_VARSAYILAN)) {
    const el = $('#a-' + k);
    if (!el || document.activeElement === el || bekleyen.has('ayar')) continue;
    const v = S.ayar[k];
    if (el.type === 'checkbox') el.checked = !!v;
    else el.value = v == null ? '' : v;
  }
}
function ayarDegisti(el) {
  const k = el.id.slice(2);
  let v = el.type === 'checkbox' ? el.checked : el.value;
  if (k === 'gunluk') v = Math.max(1, Math.min(100, parseInt(v, 10) || 20));
  else if (typeof v === 'string') v = v.trim();
  S.ayar[k] = v;
  onizlemeCiz();
  bannerCiz();
  otoCiz();
  geciktir('ayar', ayarKaydet, 700);
}
async function ayarKaydet() {
  const govde = {};
  for (const k of Object.keys(AYAR_VARSAYILAN)) govde[k] = S.ayar[k];
  try {
    const r = await api('influencer', { body: { action: 'settings', settings: govde } });
    if (!bekleyen.has('ayar')) S.ayar = Object.assign({}, AYAR_VARSAYILAN, r.settings || {});
    kayitYaz('Kaydedildi');
    toast('Ayarlar kaydedildi.');
    planla();
  } catch (e) { hata(e); }
}
function onizlemeCiz() {
  const kap = $('#oniz');
  if (!kap) return;
  for (const b of $$('#onizSeg button')) b.setAttribute('aria-pressed', String(b.dataset.d === S.onizDil));
  const dil = S.onizDil;
  const kisi = { hitapAdi: dil === 'en' ? 'Alex' : 'Deniz', ad: '', handle: 'ornek', nis: 'aile', sehir: '', ulke: dil === 'en' ? 'US' : 'TR', dil, hitap: S.ayar.hitap, bio: '' };
  const m = mailUret(kisi, S.ayar);
  const yon = dil === 'ar' ? 'rtl' : 'ltr';
  kap.innerHTML = `<div class="mailcard"><div class="mc-meta"><span>Kimden: <b>${esc((gmailVar() && S.gmail.email) || S.ayar.gonderenEmail || '–')}</b></span><span>Örnek alıcı: <b>${esc(kisi.hitapAdi)}</b>, aile içerikleri</span></div><div class="mc-konu-s" dir="${yon}">${esc(m.konu)}</div><pre class="mc-onizleme" dir="${yon}">${esc(m.govde)}</pre></div>`;
}
function bannerCiz() {
  const b = $('#yenileBanner');
  if (!b) return;
  const eski = [];
  for (const [id, d] of S.adaylar) if (sablonMu(d) && d.mail && d.mail.govde && mailUret(d, S.ayar).govde !== d.mail.govde) eski.push(id);
  S.eskiMailler = eski;
  b.hidden = !eski.length;
  $('#yenileSayi').textContent = eski.length;
}
async function mailleriGuncelle() {
  await hepsiniYaz();
  const ids = S.eskiMailler.slice();
  if (!ids.length) return;
  const t = simdi();
  const islemler = ids.map((id) => ({ op: 'patch', id, patch: { mail: Object.assign(mailUret(S.adaylar.get(id), S.ayar), { uretim: 'sablon', tarih: t }) } })).filter((x) => x.patch.mail);
  try {
    const r = await topluYaz(islemler);
    toast(r.hata.length ? `${r.tamam} mail güncellendi, ${r.hata.length} kayıt yazılamadı.` : `${ids.length} mail yeni ayarlarla güncellendi.`);
  } catch (e) { hata(e); }
}

/* ---------- CSV, yedek, örnekler ---------- */

function csvIndir() {
  const basliklar = ['Kullanıcı adı', 'Ad', 'Platform', 'Takipçi', 'Etkileşim (%)', 'E-posta', 'Şehir', 'Ülke', 'İçerik', 'Mail dili', 'Uyum', 'Durum', 'Konu', 'Profil'];
  const satirlar = tumu().sort(puanaGore).map((a) => [a.handle, a.ad, PLATFORM_AD[a.platform] || '', a.takipci, a.etkilesim, a.email, a.sehir, a.ulke, (NISLER[a.nis] || NISLER.diger).ad, DIL_AD[a.dil] || '', a.puan, DURUM_AD[a.durum] || a.durum, (a.mail && a.mail.konu) || '', a.profil]);
  indir('lulo-influencer-' + new Date().toISOString().slice(0, 10) + '.csv', '﻿' + csvYaz([basliklar].concat(satirlar)), 'text/csv;charset=utf-8');
  toast('CSV indirildi.');
}
function yedekIndir() {
  const people = Array.from(S.adaylar.entries()).map(([id, d]) => ({ id, d }));
  indir('lulo-influencer-yedek-' + new Date().toISOString().slice(0, 10) + '.json', JSON.stringify({ tur: 'lulo-influencer', tarih: simdi(), people }, null, 1), 'application/json');
  toast(`${people.length} kişinin yedeği indirildi.`);
}
let ornekZ = 0;
async function ornekSil() {
  const ids = Array.from(S.adaylar.entries()).filter(([, d]) => d.ornek).map(([id]) => id);
  if (!ids.length) return;
  if (!S.ornekSilOnay) {
    S.ornekSilOnay = true;
    cizAdaylar();
    clearTimeout(ornekZ);
    ornekZ = setTimeout(() => { S.ornekSilOnay = false; cizAdaylar(); }, 5000);
    return;
  }
  S.ornekSilOnay = false;
  clearTimeout(ornekZ);
  if (S.acik && ids.includes(S.acik)) await drawerKapat();
  try {
    const r = await topluYaz(ids.map((id) => ({ op: 'delete', id })));
    toast(r.hata.length ? 'Bazı örnekler silinemedi.' : 'Örnek adaylar silindi.');
  } catch (e) { hata(e); }
  cizAdaylar();
}

/* ---------- olaylar ---------- */

function olaylar() {
  document.addEventListener('click', (ev) => {
    const t = ev.target.closest('[data-act]');
    if (!t) return;
    if (t.tagName === 'A' && t.getAttribute('aria-disabled') === 'true') { ev.preventDefault(); toast('Önce e-posta adresini ekle.'); return; }
    const act = t.dataset.act;
    const id = S.acik;
    switch (act) {
      case 'tab': sekmeAc(t.dataset.tab); break;
      case 'filtre': S.filtre = t.dataset.k; cizAdaylar(); break;
      case 'ac': S.sonOdak = t; drawerAc(t.dataset.id); break;
      case 'kapat': drawerKapat(); break;
      case 'mailSekme': S.mailSekme = t.dataset.s; mailSekmeCiz(); break;
      case 'onayla': onayla(id); break;
      case 'onayGeriAl': guncelle(id, { durum: 'hazir' }); break;
      case 'kopyalaMail': kopyala($('#f-govde').value, $('#f-govde')); break;
      case 'kopyalaDm': kopyala($('#f-dm').value, $('#f-dm')); break;
      case 'claudeKisisel': claudeKisisel(id); break;
      case 'sablonYenile': sablonYenile(id); break;
      case 'gelenEkle': gelenEkle(id); break;
      case 'claudeCevap': claudeCevap(id); break;
      case 'gonderildiSay': gonderildiSay(id, 'elle'); break;
      case 'dmGonderildi': gonderildiSay(id, 'dm'); break;
      case 'tlKopyala': { const el = $('#tl-' + t.dataset.i); if (el) kopyala(el.value, el); break; }
      case 'tlGonderildi': {
        const i = +t.dataset.i;
        const el = $('#tl-' + i);
        const y = tlYamasi(id, i, (yy, d) => { yy[i] = Object.assign({}, yy[i], { yon: 'giden', tarih: simdi(), konu: 'Re: ' + ((d.mail && d.mail.konu) || ''), metin: el ? el.value : yy[i].metin, kaynak: 'elle' }); });
        if (y) { const d = S.adaylar.get(id); guncelle(id, Object.assign({ yazisma: y }, d.durum === 'cevap' ? { durum: 'gonderildi' } : {})).then((ok) => ok && toast('Cevap gönderildi olarak işaretlendi.')); }
        break;
      }
      case 'tlSil': { const i = +t.dataset.i; const y = tlYamasi(id, i, (yy) => yy.splice(i, 1)); if (y) guncelle(id, { yazisma: y }); break; }
      case 'durumUygula': guncelle(id, { durum: t.dataset.d }); delete S.durumOneri[id]; break;
      case 'sil': S.silOnay = true; drawerTazele(); break;
      case 'silVazgec': S.silOnay = false; drawerTazele(); break;
      case 'silEvet': sil(id); break;
      case 'arsivle': { const d = S.adaylar.get(id); if (d) guncelle(id, { durum: d.durum === 'arsiv' ? (d.gonderim ? 'gonderildi' : gecerliEmail(d.email) ? 'hazir' : 'yeni') : 'arsiv' }); break; }
      case 'csvIndir': csvIndir(); break;
      case 'yedekIndir': yedekIndir(); break;
      case 'ornekSil': ornekSil(); break;
      case 'secilenleriOnayla': secilenleriOnayla(); break;
      case 'siraGonderildi': gonderildiSay(t.dataset.id, 'elle'); break;
      case 'siraGeriAl': guncelle(t.dataset.id, { durum: 'hazir' }); break;
      case 'cevapYaz': S.sonOdak = t; drawerAc(t.dataset.id, 'yazisma'); break;
      case 'kartEkle': kartKaydet(+t.dataset.k); break;
      case 'kartCikar': if (S.inceleme) { S.inceleme.kartlar.splice(+t.dataset.k, 1); cizEkle(true); } break;
      case 'hepsiniEkle': (async () => { const I = S.inceleme; for (let i = 0; i < I.kartlar.length; i++) if (!I.kartlar[i].eklendi) await kartKaydet(i); toast('Hesaplar eklendi.'); })(); break;
      case 'ekranDurdur': if (S.inceleme) { S.inceleme.dur = true; toast('Kalan görseller okunmayacak.'); } break;
      case 'incelemeKapat': incelemeKapat(); break;
      case 'csvEkle': csvIceAktar(); break;
      case 'mailleriGuncelle': mailleriGuncelle(); break;
      case 'onizDil': S.onizDil = t.dataset.d; onizlemeCiz(); break;
      case 'gmailGonder': gmailGonder(id); break;
      case 'siraGmail': siradakileriGonder(); break;
      case 'topluDur': if (S.toplu) { S.toplu.dur = true; cizGonderim(); } break;
      case 'cevapKontrol': cevaplariKontrolEt(); break;
      case 'gmailYenile': cevaplariKontrolEt(t.dataset.id || id); break;
      case 'tlGmailGonder': tlGmailGonder(id, +t.dataset.i); break;
      case 'gmailBagla': gmailBagla(); break;
      case 'gmailKes': gmailKes(); break;
      case 'gmailTest': gmailTest(); break;
      case 'otoAnahtar': otoAnahtar(); break;
      case 'otoKopyala': otoKopyala(); break;
      case 'yenidenDene': yukle(true); break;
      default: break;
    }
  });

  document.addEventListener('input', (ev) => {
    const el = ev.target;
    if (el.id === 'ara') { S.ara = el.value; cizAdaylar(); return; }
    if (el.dataset.f && S.acik) {
      const id = S.acik, f = el.dataset.f;
      el.dataset.kirli = '1';
      geciktir(id + ':f:' + f, async () => { await alanKaydet(id, f, el.value); el.dataset.kirli = ''; });
      return;
    }
    if (el.dataset.m && S.acik) {
      const id = S.acik, m = el.dataset.m;
      el.dataset.kirli = '1';
      if (m !== 'dm') gmailLinkGuncelle();
      geciktir(id + ':m:' + m, async () => { await guncelle(id, { mail: { [m]: el.value, uretim: 'elle', tarih: simdi() } }); el.dataset.kirli = ''; });
      return;
    }
    if (el.dataset.tl != null && S.acik) {
      const id = S.acik, i = +el.dataset.tl;
      geciktir(id + ':tl:' + i, async () => { const y = tlYamasi(id, i, (yy) => { yy[i] = Object.assign({}, yy[i], { metin: el.value }); }); if (y) await guncelle(id, { yazisma: y }); });
      return;
    }
    if (el.dataset.kf != null && el.tagName !== 'SELECT') { kartAlan(el); return; }
    if (el.id && el.id.startsWith('a-')) { ayarDegisti(el); }
  });

  document.addEventListener('change', (ev) => {
    const el = ev.target;
    if (el.dataset.sel && S.acik) {
      const id = S.acik, f = el.dataset.sel;
      if (f === 'durum') guncelle(id, { durum: el.value });
      else alanKaydet(id, f, el.value);
      return;
    }
    if (el.id === 'sirala') { S.sirala = el.value; cizAdaylar(); return; }
    if (el.dataset.oneri) {
      if (el.checked) S.oneriSecim.add(el.dataset.oneri); else S.oneriSecim.delete(el.dataset.oneri);
      const b = $('[data-act="secilenleriOnayla"]');
      if (b) { const n = Array.from(S.oneriSecim).filter((x) => S.adaylar.has(x) && S.adaylar.get(x).durum === 'hazir').length; b.textContent = `Seçilen ${n} maili onayla`; b.disabled = !n; }
      return;
    }
    if (el.dataset.csvSec != null && S.inceleme) { if (el.checked) S.inceleme.secim.add(el.dataset.csvSec); else S.inceleme.secim.delete(el.dataset.csvSec); cizEkle(true); return; }
    if (el.dataset.csvTumu != null && S.inceleme) { S.inceleme.secim = el.checked ? new Set(S.inceleme.adaylar.map((x) => x.id)) : new Set(); cizEkle(true); return; }
    if (el.dataset.esle && S.inceleme) { const v = el.value; if (v === '') delete S.inceleme.esleme[el.dataset.esle]; else S.inceleme.esleme[el.dataset.esle] = +v; csvHesapla(); cizEkle(true); return; }
    if (el.dataset.kf != null && el.tagName === 'SELECT') { kartAlan(el); return; }
    if (el.id === 'fileSS') { const fs = Array.from(el.files || []); el.value = ''; if (fs.length) ekranOku(fs); return; }
    if (el.id === 'fileCSV') { const f = el.files && el.files[0]; el.value = ''; if (f) csvYukle(f); return; }
    if (el.id === 'fileJSON') { const f = el.files && el.files[0]; el.value = ''; if (f) yedekYukle(f); }
  });

  $('#elleForm').addEventListener('submit', elleEkle);
  $('#ayarForm').addEventListener('submit', (ev) => ev.preventDefault());
  $('#scrim').addEventListener('click', () => drawerKapat());
  document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && S.acik) drawerKapat(); });

  $('#loginForm').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const pw = $('#pw').value;
    const msg = $('#loginMsg');
    if (!pw.trim()) { msg.className = 'msg err'; msg.textContent = 'Şifreyi yaz.'; return; }
    $('#loginBtn').disabled = true;
    msg.textContent = '';
    try {
      await api('login', { body: { password: pw } });
      $('#pw').value = '';
      await yukle(true);
    } catch (e) {
      msg.className = 'msg err';
      msg.textContent = e.message;
    } finally {
      $('#loginBtn').disabled = false;
    }
  });
  $('#logout').addEventListener('click', async () => {
    await hepsiniYaz();
    try { await api('logout', { body: {} }); } catch (e) { /* çıkılmış sayılır */ }
    S.hazir = false;
    $('#who').textContent = '';
    girisGoster('');
    const m = $('#loginMsg');
    m.className = 'msg ok';
    m.textContent = 'Çıkış yapıldı.';
  });

  const alanlar = [['dropSS', (fs) => ekranOku(fs)], ['dropCSV', (fs) => fs[0] && csvYukle(fs[0])], ['dropJSON', (fs) => fs[0] && yedekYukle(fs[0])]];
  for (const [kimlik, fn] of alanlar) {
    const z = $('#' + kimlik);
    z.addEventListener('dragover', (ev) => { ev.preventDefault(); z.classList.add('uzerinde'); });
    z.addEventListener('dragleave', () => z.classList.remove('uzerinde'));
    z.addEventListener('drop', (ev) => {
      ev.preventDefault();
      z.classList.remove('uzerinde');
      if (z.getAttribute('aria-disabled') === 'true') { toast('Ekran görüntüsü okumak için Claude bağlantısı gerekli.'); return; }
      const fs = Array.from((ev.dataTransfer && ev.dataTransfer.files) || []);
      if (fs.length) fn(fs);
    });
  }
  document.addEventListener('paste', (ev) => {
    if (S.tab !== 'ekle' || !S.hazir) return;
    const hedef = ev.target;
    if (hedef && (hedef.tagName === 'INPUT' || hedef.tagName === 'TEXTAREA')) return;
    const fs = Array.from((ev.clipboardData && ev.clipboardData.files) || []).filter((f) => /^image\//.test(f.type));
    if (fs.length) { ev.preventDefault(); ekranOku(fs); }
  });
  // coming back to the tab: pick up changes made elsewhere (another device, a finished send)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible' || !S.hazir || Date.now() - S.sonYukleme < 30000) return;
    if (bekleyen.size || S.toplu || S.kontrol || Object.keys(S.isler).length) return;
    const ae = document.activeElement;
    if (S.acik && ae && ae.matches && ae.matches('input,textarea')) return;
    yukle();
  });
}

basla();
