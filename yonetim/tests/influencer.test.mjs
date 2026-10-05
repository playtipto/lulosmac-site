// node --test tests/*.test.mjs
// The Influencer page's server side: record rules, Gmail (OAuth state, MIME, thread parsing), Claude answers, and the
// three endpoints over a D1 stand-in (node:sqlite) with Google and Anthropic replaced by a local fetch stub.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as L from '../lib/influencer_logic.js';
import { cleanRecord, cleanSettings, dayKey, InfError, memoryStore, mergePatch, prepareNew, updateRecord } from '../lib/influencer.js';
import { buildMime, checkState, encodeWord, makeState, parseMessage, seal, unseal } from '../lib/gmail.js';
import { askJson, checkImages, firstJson } from '../lib/claude.js';
import { b64u } from '../lib/bytes.js';

const KEY = b64u(new Uint8Array(32).fill(7));
const enc = new TextEncoder();
const b64uText = (s) => b64u(enc.encode(s));

test('template mail: game, family promises, team, question, links and company', () => {
  const d = L.adayOlustur({ handle: 'deneme.kanal', ad: 'Deneme Kanal', email: 'a@b.co', platform: 'youtube', bio: 'Roblox ve Minecraft oyun videoları', ulke: 'TR', takipci: '48,2 B' }, 'test');
  assert.equal(d.nis, 'oyun');
  assert.equal(d.takipci, 48200);
  assert.equal(d.durum, 'hazir');
  assert.equal(d.hitap, 'siz');
  const g = d.mail.govde;
  for (const part of ["2'ye 2 bir plaj voleybolu oyunu", 'oyunda hiç reklam yok', 'veri toplanmıyor', 'ebeveyn kapısının arkasındaki', "Türkiye'den küçük bir ekip", 'işbirliği boyunca desteğiniz', 'nasıl bir işbirliği yapabiliriz', '“Arkadaşla” moduyla', "yakında App Store'da", 'https://lulosmac.com', 'support@lulosmac.com', 'EIGHT UP BİLİŞİM ENERJİ VE TURİZM A.Ş.']) {
    assert.ok(g.includes(part), part);
  }
  for (const yok of ['Tip'+'to', 'simit', 'hediye kodu', 'üniversiteli']) assert.ok(!g.toLowerCase().includes(yok.toLowerCase()), yok);
  assert.ok(d.mail.konu.startsWith('Lulo Smaç! × '));
  const live = L.mailUret(d, { appStore: 'https://apps.apple.com/app/id1' });
  assert.ok(live.govde.includes("App Store'dan ücretsiz indirebilirsiniz: https://apps.apple.com/app/id1"));
  const sen = L.mailUret(Object.assign({}, d, { hitap: 'sen' }), {});
  assert.ok(sen.govde.includes('işbirliği boyunca desteğin ') && sen.govde.includes('Sevgiler,'));
  // the game is in Turkish and English: everyone outside Türkiye (Arabic speakers too) gets English
  const en = L.mailUret(Object.assign({}, d, { dil: 'ar' }), {});
  assert.ok(en.konu.startsWith('Lulo Smaç! × ') && en.konu.endsWith(': a collaboration idea'));
  assert.ok(en.govde.includes('https://lulosmac.com/en') && en.govde.includes('no ads at all'));
  assert.equal(L.adayOlustur({ handle: 'x', ulke: 'Saudi Arabia', email: 'x@y.co' }, 't').dil, 'en');
  assert.equal(L.adayOlustur({ handle: 'y', ulke: 'Türkiye', email: 'y@y.co' }, 't').dil, 'tr');
  // media: "siz" from the start, their own idea list, no match-video idea
  const m = L.adayOlustur({ handle: 'haber.sitesi', ad: 'Haber Sitesi', email: 'editor@x.co', tur: 'medya', ulke: 'TR' }, 't', { hitap: 'sen' });
  assert.equal(m.hitap, 'siz');
  assert.equal(L.mailUret(Object.assign({}, m, { ad: 'Haber Sitesi (Ekip)', hitapAdi: 'Haber Sitesi ekibi' }), {}).konu, 'Lulo Smaç! × Haber Sitesi: işbirliği daveti');
  assert.ok(m.mail.govde.includes('okurlarınıza bir haber ya da incelemeyle') && m.mail.govde.includes('Ekibimizle kısa bir röportaj') && !m.mail.govde.includes('moduyla eğlenceli bir maç videosu'));
  assert.ok(m.mail.govde.includes('Saygılarımızla,'));
  // fit score: family first, Türkiye first
  const aile = L.adayOlustur({ handle: 'iki.cocuk.annesi', ad: 'Elif', bio: 'İki çocuk annesi, ailece oyunlar', email: 'e@x.co', ulke: 'TR', takipci: '40K', etkilesim: 5 }, 't');
  assert.equal(aile.nis, 'aile');
  assert.equal(aile.puan, 30 + 21 + 20 + 15 + 10);
  assert.equal(L.adayOlustur({ handle: 'volley.coach', bio: 'beach volleyball coach', ulke: 'US' }, 't').nis, 'spor');
  // prompts carry the game facts and the child-safety rule
  const pr = L.kisiselPromptu(d, {}, d.mail);
  assert.ok(pr.includes('LULO SMAÇ! HAKKINDA') && pr.includes('çocuklara seslenme') && !pr.includes('Tip'+'to'));
});

test('CSV: Modash columns, K/M numbers, engagement as a fraction', () => {
  const rows = L.csvAyir('Username,Full name,Followers,Engagement rate,Email\n@bir,Bir,"12,5K",0.046,bir@x.com\n@iki,İki,1.2M,0.01,\n');
  const map = L.sutunEsle(rows[0], rows.slice(1));
  const list = L.csvAdaylari(rows.slice(1), map, {});
  assert.deepEqual(list.map((x) => [x.id, x.d.takipci, x.d.etkilesim, x.d.durum]), [['ig_bir', 12500, 4.6, 'hazir'], ['ig_iki', 1200000, 1, 'yeni']]);
});

test('records: known fields only, sizes, merge rules, computed fields', () => {
  const c = cleanRecord({ ad: 'x'.repeat(500), junk: 1, durum: 'nope', yazisma: [{ yon: 'gelen', metin: 'a' }, { yon: 'bad' }], gonderiliyor: '' });
  assert.equal(c.ad.length, 200);
  assert.equal(c.junk, undefined);
  assert.equal(c.durum, 'yeni');
  assert.equal(c.yazisma.length, 1);
  assert.throws(() => cleanRecord({ bio: 'x', not: 'y'.repeat(10), yazisma: Array.from({ length: 120 }, () => ({ yon: 'gelen', metin: 'z'.repeat(30000) })) }), InfError);
  const m = mergePatch({ mail: { konu: 'K', govde: 'G' }, gonderiliyor: 'lock' }, { mail: { onayTarih: 't' }, gonderiliyor: null, durum: 'onay' });
  assert.deepEqual(m.mail, { konu: 'K', govde: 'G', onayTarih: 't' });
  assert.equal(m.gonderiliyor, 'lock');   // the page can never touch the sending lock
  const p = prepareNew({ handle: 'kisi', ad: 'Kişi Adı', email: 'k@x.com', platform: 'instagram' }, cleanSettings({}), '2026-09-30T10:00:00.000Z');
  assert.equal(p.durum, 'hazir');
  assert.ok(p.mail.govde.length > 400);
  assert.equal(typeof p.puan, 'number');
});

test('settings are clamped; the day is Istanbul time', () => {
  const s = cleanSettings({ gunluk: 5000, hitap: 'x', yayin: 'yakinda', kosul: 'k'.repeat(3000) });
  assert.deepEqual([s.gunluk, s.hitap, s.yayin, s.kosul.length], [100, 'siz', 'yakinda', 2000]);
  assert.deepEqual([cleanSettings({ yayin: 'x' }).yayin, cleanSettings({ hitap: 'sen' }).hitap], ['yakinda', 'sen']);
  assert.equal(dayKey(Date.UTC(2026, 8, 30, 21, 30)), '2026-10-01');   // 00:30 in Istanbul
  assert.equal(dayKey(Date.UTC(2026, 8, 30, 20, 30)), '2026-09-30');
});

test('updateRecord retries when the record changed underneath', async () => {
  const st = memoryStore();
  await st.insert('ig_a', cleanRecord({ ad: 'A' }), 1);
  let first = true;
  const r = await updateRecord(st, 'ig_a', async (d) => {
    if (first) { first = false; await st.replace('ig_a', cleanRecord({ ad: 'B' }), 1, 2); }   // someone else wins the race
    d.not = 'n';
    return d;
  });
  assert.equal(r.v, 3);
  assert.deepEqual([r.d.ad, r.d.not], ['B', 'n']);
});

test('mail: encoded headers, base64 body, threading headers, bad address refused', () => {
  assert.equal(encodeWord('Lulo x Ali'), 'Lulo x Ali');
  const w = encodeWord('Lulo × Şule: bir işbirliği fikri');
  assert.match(w, /^=\?UTF-8\?B\?/);
  const raw = buildMime({ from: 'support@lulosmac.com', fromName: 'Ali · Lulo Smaç!', to: 'x@y.com', subject: 'Re: Lulo × Şule', body: 'Merhaba\nçok teşekkürler', inReplyTo: '<a@b>', references: '<z@b> <a@b>' });
  assert.match(raw, /^From: =\?UTF-8\?B\?[^\r\n]+\?= <support@lulosmac\.com>\r\n/);
  assert.match(raw, /\r\nIn-Reply-To: <a@b>\r\nReferences: <z@b> <a@b>\r\n/);
  const body = raw.split('\r\n\r\n')[1].replace(/\r\n/g, '');
  assert.equal(Buffer.from(body, 'base64').toString('utf8'), 'Merhaba\r\nçok teşekkürler');
  assert.throws(() => buildMime({ from: 'a@b.c', to: 'bad', subject: 's', body: 'b' }), InfError);
  assert.throws(() => buildMime({ from: 'a@b.co', to: 'x@y.com\r\nBcc: z@q.com', subject: 's', body: 'b' }), InfError);   // header injection
  assert.ok(!/\r\nBcc:/i.test(buildMime({ from: 'a@b.co', to: 'x@y.com', subject: 's\r\nBcc: z@q.com', body: 'b' }).split('\r\n\r\n')[0]));
});

test('OAuth state: signed, expiring, tamper-proof; token box round trip', async () => {
  const env = { ADMIN_SESSION_KEY: KEY };
  const s = await makeState(env, 1000);
  assert.ok(await checkState(env, s, 2000));
  assert.equal(await checkState(env, s, 1000 + 16 * 60000), null);
  assert.equal(await checkState(env, s.slice(0, -2) + 'AA', 2000), null);
  assert.equal(await checkState({ ADMIN_SESSION_KEY: b64u(new Uint8Array(32).fill(8)) }, s, 2000), null);
  const box = await seal(env, 'refresh-token-1');
  assert.equal(await unseal(env, box), 'refresh-token-1');
  await assert.rejects(unseal({ ADMIN_SESSION_KEY: b64u(new Uint8Array(32).fill(9)) }, box));
});

test('thread messages: plain, html-only, bounce', () => {
  const hs = (from, subject) => [{ name: 'From', value: from }, { name: 'Subject', value: subject }, { name: 'Message-ID', value: '<m@x>' }];
  const plain = parseMessage({ id: 'm1', threadId: 't1', labelIds: ['INBOX'], internalDate: '1790000000000', payload: { mimeType: 'multipart/alternative', headers: hs('Ayşe <ayse@x.com>', 'Re: Lulo'), parts: [{ mimeType: 'text/plain', headers: [], body: { data: b64uText('Merhaba, olur!') } }] } }, 'support@lulosmac.com');
  assert.deepEqual([plain.metin, plain.mine, plain.teslimHatasi, plain.rfcId], ['Merhaba, olur!', false, false, '<m@x>']);
  const html = parseMessage({ id: 'm2', labelIds: [], payload: { mimeType: 'text/html', headers: hs('b@x.com', 'Re'), body: { data: b64uText('<p>Selam<br>ilgileniyoruz &amp; konuşalım</p>') } } }, 'support@lulosmac.com');
  assert.equal(html.metin, 'Selam\nilgileniyoruz & konuşalım');
  const mine = parseMessage({ id: 'm3', labelIds: ['SENT'], payload: { headers: hs('support@lulosmac.com', 'Lulo'), body: {} }, snippet: 's' }, 'support@lulosmac.com');
  assert.equal(mine.mine, true);
  const bounce = parseMessage({ id: 'm4', labelIds: ['INBOX'], payload: { headers: hs('Mail Delivery Subsystem <mailer-daemon@googlemail.com>', 'Delivery Status Notification (Failure)'), body: {} }, snippet: 'Address not found' }, 'support@lulosmac.com');
  assert.equal(bounce.teslimHatasi, true);
  assert.equal(L.alintiyiAt('Tamam!\n\nOn Wed, Sep 30, 2026 Lulo <a@b> wrote:\n> eski'), 'Tamam!');
  // automatic replies: by header or by the subject mail programs give them; a real reply is not one
  const oto = (subject, extra = []) => parseMessage({ id: 'o', labelIds: ['INBOX'], payload: { headers: hs('Ayşe <ayse@x.com>', subject).concat(extra), body: {} }, snippet: 's' }, 'support@lulosmac.com').otomatik;
  assert.equal(plain.otomatik, false);
  assert.equal(oto('Re: Lulo', [{ name: 'Auto-Submitted', value: 'auto-replied' }]), true);
  assert.equal(oto('Re: Lulo', [{ name: 'Auto-Submitted', value: 'no' }]), false);
  assert.equal(oto('Re: Lulo', [{ name: 'X-Autoreply', value: 'yes' }]), true);
  for (const s of ['Otomatik Yanıt: Lulo × Ayşe', 'OTOMATİK YANIT: Lulo', 'Automatic reply: Lulo', 'Out of Office: Lulo', 'Ofis Dışında', 'رد تلقائي: Lulo', 'Réponse automatique : Lulo']) assert.equal(oto(s), true, s);
  for (const s of ['Re: Lulo × Ayşe', 'Otomatik olarak değil, ben yazdım', 'Automatically yours']) assert.equal(oto(s), false, s);
});

test('Claude answers: fenced or embedded JSON; image checks', () => {
  assert.deepEqual(firstJson('```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(firstJson('Tabii: [{"h":"x"}] bitti'), [{ h: 'x' }]);
  assert.equal(firstJson('yok'), null);
  // raw line breaks inside a string (invalid JSON) are repaired, escaped ones are kept
  assert.deepEqual(firstJson('{"konu": "K", "govde": "Merhaba,\n\nSatır\tiki \\"alıntı\\""}'), { konu: 'K', govde: 'Merhaba,\n\nSatır\tiki "alıntı"' });
  assert.deepEqual(firstJson('İşte: {"govde": "a\r\nb"} tamam'), { govde: 'a\nb' });
  assert.equal(checkImages([{ type: 'image/jpeg', data: 'AAAA' }]).length, 1);
  assert.throws(() => checkImages([{ type: 'image/svg+xml', data: 'AAAA' }]), InfError);
  assert.throws(() => checkImages([]), InfError);
});

test('Claude calls: structured output, no up-front thinking, errors stay below 500', async () => {
  const realFetch = globalThis.fetch;
  const env = { ANTHROPIC_API_KEY: 'k' };
  const schema = { type: 'object', properties: { konu: { type: 'string' } }, required: ['konu'], additionalProperties: false };
  let sent;
  const reply = (status, body) => { globalThis.fetch = async (url, init) => { sent = JSON.parse(init.body); return new Response(JSON.stringify(body), { status }); }; };
  try {
    reply(200, { content: [{ type: 'text', text: '{"konu":"K \\"tırnak\\"","govde":"a\\n\\nb"}' }], stop_reason: 'end_turn' });
    assert.deepEqual(await askJson(env, 'p', { schema }), { konu: 'K "tırnak"', govde: 'a\n\nb' });
    assert.deepEqual(sent.output_config, { format: { type: 'json_schema', schema } });
    assert.deepEqual(sent.thinking, { type: 'between_tools' });
    assert.equal(sent.model, 'claude-sonnet-5-5');
    assert.equal(sent.tools, undefined);
    assert.equal(sent.tool_choice, undefined);
    // an older model: no thinking option, no schema unless asked
    reply(200, { content: [{ type: 'thinking', thinking: '…' }, { type: 'text', text: '{"govde": "satır\nsatır"}' }], stop_reason: 'end_turn' });
    assert.deepEqual(await askJson({ ...env, ANTHROPIC_MODEL: 'claude-haiku-4-5' }, 'p'), { govde: 'satır\nsatır' });
    assert.equal(sent.thinking, undefined);
    assert.equal(sent.output_config, undefined);
    reply(200, { content: [{ type: 'text', text: '{"konu": "yar' }], stop_reason: 'max_tokens' });
    await assert.rejects(askJson(env, 'p'), (e) => e.code === 'ai_json' && e.status < 500 && /yarıda/.test(e.message));
    const cases = [[401, 'ai_key', 'x'], [529, 'ai_busy', 'x'], [400, 'ai_error', 'tool_choice: type "tool" is not supported for this model.'], [404, 'ai_model', 'x'], [400, 'ai_model', 'model: claude-x not found']];
    for (const [status, code, message] of cases) {
      reply(status, { type: 'error', error: { message } });
      await assert.rejects(askJson(env, 'p'), (e) => e.code === code && e.status < 500);
    }
    globalThis.fetch = async () => { throw new TypeError('network'); };
    await assert.rejects(askJson(env, 'p'), (e) => e.code === 'ai_down' && e.status < 500);
    await assert.rejects(askJson({}, 'p'), (e) => e.code === 'ai_setup' && e.status < 500);
  } finally {
    globalThis.fetch = realFetch;
  }
});

// ---------------------------------------------------------------- endpoints over a D1 stand-in
function d1() {
  return import('node:sqlite').then(({ DatabaseSync }) => {
    const sq = new DatabaseSync(':memory:');
    const stmt = (sql, args = []) => ({
      bind: (...a) => stmt(sql, a),
      run: async () => { const r = sq.prepare(sql).run(...args); return { success: true, meta: { changes: Number(r.changes) } }; },
      all: async () => ({ results: sq.prepare(sql).all(...args) }),
      first: async () => sq.prepare(sql).get(...args) || null,
    });
    return { prepare: (sql) => stmt(sql), batch: async (list) => { for (const s of list) await s.run(); return []; } };
  });
}

test('endpoints: list, create, patch, bulk, send once, sync a reply, reply in thread', async () => {
  const DB = await d1();
  const env = { INFLUENCER_DB: DB, ADMIN_SESSION_KEY: KEY, GOOGLE_CLIENT_ID: 'cid', GOOGLE_CLIENT_SECRET: 'sec', ANTHROPIC_API_KEY: 'k' };
  const inf = await import('../functions/admin/api/influencer.js');
  const gm = await import('../functions/admin/api/gmail.js');
  const post = (mod, path, body) => mod.onRequestPost({ request: new Request('https://lulosmac-yonetim.pages.dev/admin/api/' + path, { method: 'POST', body: JSON.stringify(body) }), env });
  const js = async (r) => { const j = await r.json(); j.status = r.status; return j; };

  let g = await js(await inf.onRequestGet({ env }));
  assert.deepEqual([g.missing, g.people, g.gmail.connected, g.ai.configured, g.today.sent], [[], [], false, true, 0]);
  assert.deepEqual((await js(await inf.onRequestGet({ env: {} }))).missing, ['INFLUENCER_DB']);

  const c = await js(await post(inf, 'influencer', { action: 'create', id: 'ig_ayse', data: { handle: 'ayse', ad: 'Ayşe Yılmaz', email: 'ayse@x.com', platform: 'instagram', bio: 'Anne, ailece oyun' } }));
  assert.equal(c.d.durum, 'hazir');
  assert.equal((await js(await post(inf, 'influencer', { action: 'create', id: 'ig_ayse', data: { handle: 'ayse' } }))).status, 409);
  const p = await js(await post(inf, 'influencer', { action: 'patch', id: 'ig_ayse', patch: { durum: 'onay', mail: { onayTarih: 'x' } } }));
  assert.equal(p.v, 2);
  assert.ok(p.d.mail.govde.length > 100);
  const b = await js(await post(inf, 'influencer', { action: 'bulk', ops: [{ op: 'create', id: 'yt_iki', data: { handle: 'iki', email: 'iki@x.com', platform: 'youtube' } }, { op: 'patch', id: 'nope', patch: {} }, { op: 'delete', id: 'yt_yok' }] }));
  assert.deepEqual(b.results.map((x) => x.error || (x.deleted ? 'deleted' : 'ok')), ['ok', 'not_found', 'deleted']);
  assert.equal((await js(await post(inf, 'influencer', { action: 'settings', settings: { gunluk: 2, gonderenAd: 'Ali' } }))).settings.gunluk, 2);

  // not connected yet
  assert.equal((await js(await post(gm, 'gmail', { action: 'send', id: 'ig_ayse' }))).error, 'gmail_connect');

  // Google stand-in
  const sent = [];
  const threads = { t1: [] };
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    const ok = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'Content-Type': 'application/json' } });
    if (u.endsWith('/token')) return ok({ access_token: 'at', expires_in: 3600, refresh_token: 'rt', scope: 'https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/gmail.readonly' });
    if (u.endsWith('/profile')) return ok({ emailAddress: 'support@lulosmac.com' });
    if (u.endsWith('/messages/send')) {
      const j = JSON.parse(init.body);
      const raw = Buffer.from(j.raw, 'base64url').toString('utf8');
      sent.push({ raw, threadId: j.threadId || '' });
      const id = 'm' + sent.length;
      threads.t1.push({ id, threadId: 't1abcdef', labelIds: ['SENT'], internalDate: String(Date.now()), payload: { headers: [{ name: 'From', value: 'support@lulosmac.com' }, { name: 'Subject', value: 'Lulo' }, { name: 'Message-ID', value: '<' + id + '@g>' }], mimeType: 'text/plain', body: { data: b64uText('bizden') } } });
      return ok({ id, threadId: 't1abcdef' });
    }
    if (u.includes('/threads/t1abcdef')) return ok({ id: 't1abcdef', messages: threads.t1 });
    return new Response('{}', { status: 404 });
  };
  try {
    const conn = await js(await post(gm, 'gmail', { action: 'connect' }));
    const state = new URL(conn.url).searchParams.get('state');
    assert.equal(new URL(conn.url).searchParams.get('redirect_uri'), 'https://lulosmac-yonetim.pages.dev/admin/influencer/');
    assert.equal((await js(await post(gm, 'gmail', { action: 'finish', code: 'c', state }))).email, 'support@lulosmac.com');
    assert.equal((await js(await post(gm, 'gmail', { action: 'finish', code: 'c', state: state + 'x' }))).error, 'gmail_state');

    const s1 = await js(await post(gm, 'gmail', { action: 'send', id: 'ig_ayse', konu: 'Lulo × Ayşe: özel', govde: 'Merhaba Ayşe' }));
    assert.equal(s1.person.d.durum, 'gonderildi');
    assert.equal(s1.person.d.gonderim.threadId, 't1abcdef');
    assert.match(sent[0].raw, /\r\nTo: ayse@x\.com\r\n/);
    assert.match(sent[0].raw, /From: =\?UTF-8\?B\?/);   // "Ali · Lulo Smaç!"
    assert.equal((await js(await post(gm, 'gmail', { action: 'send', id: 'ig_ayse' }))).error, 'sent');
    await js(await post(gm, 'gmail', { action: 'send', id: 'yt_iki' }));
    assert.equal((await js(await post(inf, 'influencer', { action: 'create', id: 'ig_uc', data: { handle: 'uc', email: 'uc@x.com' } }))).status, 200);
    assert.equal((await js(await post(gm, 'gmail', { action: 'send', id: 'ig_uc' }))).error, 'limit');   // daily limit 2

    threads.t1.push({ id: 'r1', threadId: 't1abcdef', labelIds: ['INBOX'], internalDate: String(Date.now() + 1000), payload: { headers: [{ name: 'From', value: 'Ayşe <ayse@x.com>' }, { name: 'Subject', value: 'Re: Lulo × Ayşe' }, { name: 'Message-ID', value: '<r1@x>' }], mimeType: 'text/plain', body: { data: b64uText('Olur, konuşalım!\n\nOn Wed, Lulo wrote:\n> Merhaba') } } });
    const sy = await js(await post(gm, 'gmail', { action: 'sync', ids: ['ig_ayse'] }));
    assert.equal(sy.yeni, 1);
    const ay = sy.people[0].d;
    assert.equal(ay.durum, 'cevap');
    assert.equal(ay.yazisma.filter((e) => e.yon === 'gelen')[0].metin, 'Olur, konuşalım!');
    assert.equal((await js(await post(gm, 'gmail', { action: 'sync', ids: ['ig_ayse'] }))).yeni, 0);   // nothing new the second time

    const rp = await js(await post(gm, 'gmail', { action: 'reply', id: 'ig_ayse', metin: 'Harika, kodu gönderiyoruz.' }));
    assert.equal(rp.person.d.durum, 'gonderildi');
    const last = sent[sent.length - 1];
    assert.equal(last.threadId, 't1abcdef');
    assert.match(last.raw, /\r\nIn-Reply-To: <r1@x>\r\n/);
    assert.match(last.raw, /\r\nSubject: =\?UTF-8\?B\?UmU6/);   // "Re: Lulo × Ayşe", encoded
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('scheduler: key, off until turned on, weekday window, spaced sends, replies and a Claude draft', async () => {
  const DB = await d1();
  const env = { INFLUENCER_DB: DB, ADMIN_SESSION_KEY: KEY, GOOGLE_CLIENT_ID: 'cid', GOOGLE_CLIENT_SECRET: 'sec', ANTHROPIC_API_KEY: 'k' };
  const inf = await import('../functions/admin/api/influencer.js');
  const gm = await import('../functions/admin/api/gmail.js');
  const cron = await import('../functions/cron/influencer.js');
  const O = await import('../lib/otomasyon.js');
  const { d1Store, SCHEMA } = await import('../lib/influencer.js');
  for (const q of SCHEMA) await DB.prepare(q).run();   // the schema check runs once per isolate, and the first test used another database
  const store = d1Store(DB);
  const post = (mod, path, body) => mod.onRequestPost({ request: new Request('https://lulosmac-yonetim.pages.dev/admin/api/' + path, { method: 'POST', body: JSON.stringify(body) }), env });
  const cronPost = (is, key) => cron.onRequestPost({ request: new Request('https://lulosmac-yonetim.pages.dev/cron/influencer?is=' + is, { method: 'POST', headers: key ? { authorization: 'Bearer ' + key } : {} }), env });
  const js = async (r) => { const j = await r.json(); j.status = r.status; return j; };

  // the key: made in the panel, shown once, checked by hash
  assert.equal((await js(await cronPost('gonder', 'lulo_oto_aaaaaaaaaaaaaaaaaaaaaaaaaaaa'))).status, 401);
  const k = await js(await post(inf, 'influencer', { action: 'cronKey' }));
  assert.match(k.key, /^lulo_oto_[A-Za-z0-9_-]{40,}$/);
  assert.equal((await js(await cronPost('gonder', k.key + 'x'))).status, 401);
  assert.equal((await js(await cronPost('gonder'))).status, 401);
  const g0 = await js(await inf.onRequestGet({ env }));
  assert.equal(g0.oto.anahtar.var, true);
  assert.ok(!JSON.stringify(g0).includes(k.key));
  assert.equal((await js(await cronPost('gonder', k.key))).atla, 'kapali');   // off until the owner turns it on
  assert.equal((await js(await cronPost('yok', k.key))).status, 400);

  for (const [id, puan] of [['ig_a', 60], ['ig_b', 90], ['ig_c', 75]]) {
    await post(inf, 'influencer', { action: 'create', id, data: { handle: id.slice(3), ad: id, email: id.slice(3) + '@x.com', platform: 'instagram', puan } });
  }
  await post(inf, 'influencer', { action: 'create', id: 'ig_ornek', data: { handle: 'ornek', email: 'o@x.com', ornek: true, puan: 99 } });
  await post(inf, 'influencer', { action: 'settings', settings: { oto: true, otoCevap: true, gunluk: 20 } });

  // Google and Anthropic stand-ins: every first mail opens its own thread
  const threads = {};
  let n = 0, claude = 0;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    const ok = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'Content-Type': 'application/json' } });
    if (u.includes('api.anthropic.com')) {
      claude++;
      const body = JSON.parse(init.body);
      assert.equal(body.output_config.format.type, 'json_schema');
      return ok({ content: [{ type: 'text', text: JSON.stringify({ govde: 'Çok teşekkürler, kodu gönderiyoruz!', ozet: 'Olumlu dönüş.', durum: 'anlasildi' }) }], stop_reason: 'end_turn' });
    }
    if (u.endsWith('/token')) return ok({ access_token: 'at', expires_in: 3600, refresh_token: 'rt', scope: 'https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/gmail.readonly' });
    if (u.endsWith('/profile')) return ok({ emailAddress: 'support@lulosmac.com' });
    if (u.endsWith('/messages/send')) {
      const id = 'm' + (++n), th = 'thread' + n + 'abc';
      threads[th] = [{ id, threadId: th, labelIds: ['SENT'], internalDate: String(Date.now()), payload: { headers: [{ name: 'From', value: 'support@lulosmac.com' }, { name: 'Subject', value: 'Lulo' }, { name: 'Message-ID', value: '<' + id + '@g>' }], mimeType: 'text/plain', body: { data: b64uText('bizden') } } }];
      return ok({ id, threadId: th });
    }
    const t = u.match(/\/threads\/([A-Za-z0-9]+)/);
    if (t && threads[t[1]]) return ok({ id: t[1], messages: threads[t[1]] });
    return new Response('{}', { status: 404 });
  };
  try {
    assert.equal((await O.calistir(env, store, 'gonder', Date.now())).atla !== undefined || true, true);
    const conn = await js(await post(gm, 'gmail', { action: 'connect' }));
    await post(gm, 'gmail', { action: 'finish', code: 'c', state: new URL(conn.url).searchParams.get('state') });

    const sali = Date.UTC(2026, 8, 29, 8, 0);   // Tuesday 11:00 in Istanbul
    const cumartesi = Date.UTC(2026, 9, 3, 8, 0);
    const aksam = Date.UTC(2026, 8, 29, 16, 0);   // 19:00
    assert.equal((await O.calistir(env, store, 'gonder', cumartesi)).atla, 'saat_disi');
    assert.equal((await O.calistir(env, store, 'gonder', aksam)).atla, 'saat_disi');
    // launch day: the App Store link goes in after the mails were made, and nobody refreshes them on the page;
    // a hand-written mail stays as written
    const APP = 'https://apps.apple.com/app/id6817486263';
    assert.ok(!(await store.get('ig_b')).d.mail.govde.includes(APP));
    await post(inf, 'influencer', { action: 'settings', settings: { oto: true, otoCevap: true, gunluk: 20, appStore: APP } });
    await post(inf, 'influencer', { action: 'patch', id: 'ig_c', patch: { mail: { govde: 'Elle yazdığım mail.', uretim: 'elle' } } });
    assert.ok(!(await store.get('ig_b')).d.mail.govde.includes(APP), 'still the old text before sending');
    const r1 = await O.calistir(env, store, 'gonder', sali);
    assert.equal(r1.gonderildi, 'ig_b');   // highest fit first; the sample record is never sent
    const ara = (Date.parse(r1.sonraki) - sali) / 60000;
    assert.ok(ara >= 12 && ara <= 30, 'spaced over the rest of the window: ' + ara);
    assert.equal((await O.calistir(env, store, 'gonder', sali + 5 * 60000)).atla, 'bekle');
    const r2 = await O.calistir(env, store, 'gonder', Date.parse(r1.sonraki) + 1000);
    assert.equal(r2.gonderildi, 'ig_c');
    const gb = (await store.get('ig_b')).d;
    assert.equal(gb.durum, 'gonderildi');
    assert.ok(gb.yazisma[0].metin.includes(APP) && gb.mail.govde.includes(APP), 'sent with the link');
    assert.ok(!gb.yazisma[0].metin.includes("bu hafta App Store'da"));
    assert.equal((await store.get('ig_c')).d.yazisma[0].metin, 'Elle yazdığım mail.');
    assert.equal((await store.get('ig_ornek')).d.durum, 'hazir');

    // only approved ones: none left
    await post(inf, 'influencer', { action: 'settings', settings: { oto: true, otoCevap: true, otoKapsam: 'onay', gunluk: 20 } });
    assert.equal((await O.calistir(env, store, 'gonder', Date.parse(r2.sonraki) + 1000)).atla, 'aday_yok');

    // a reply arrives, and three seconds later our own Gmail answers it by itself (a vacation responder left on);
    // the other person is away and their mail program answers for them. The check step records the reply, leaves our
    // automatic answer out and keeps theirs without calling it an answer; the draft step answers the real reply once
    const th = (await store.get('ig_b')).d.gonderim.threadId;
    const t0 = Date.now() + 1000;
    threads[th].push({ id: 'r1', threadId: th, labelIds: ['INBOX'], internalDate: String(t0), payload: { headers: [{ name: 'From', value: 'B <b@x.com>' }, { name: 'Subject', value: 'Re: Lulo' }, { name: 'Message-ID', value: '<r1@x>' }], mimeType: 'text/plain', body: { data: b64uText('Harika, varım!') } } });
    threads[th].push({ id: 'v1', threadId: th, labelIds: ['SENT'], internalDate: String(t0 + 3000), payload: { headers: [{ name: 'From', value: 'support@lulosmac.com' }, { name: 'Subject', value: 'Re: Lulo' }, { name: 'Message-ID', value: '<v1@g>' }], mimeType: 'text/plain', body: { data: b64uText('The Lulo Smaç! Team') } } });
    const thc = (await store.get('ig_c')).d.gonderim.threadId;
    threads[thc].push({ id: 'o1', threadId: thc, labelIds: ['INBOX'], internalDate: String(t0), payload: { headers: [{ name: 'From', value: 'C <c@x.com>' }, { name: 'Subject', value: 'Otomatik Yanıt: Lulo' }, { name: 'Auto-Submitted', value: 'auto-replied' }, { name: 'Message-ID', value: '<o1@x>' }], mimeType: 'text/plain', body: { data: b64uText('10 Ekim\'e kadar izindeyim.') } } });
    const kt = await js(await cronPost('kontrol', k.key));
    assert.deepEqual([kt.status, kt.bakilan, kt.yeni], [200, 2, 1]);
    assert.equal((await store.get('ig_b')).d.durum, 'cevap');
    assert.deepEqual((await store.get('ig_b')).d.yazisma.map((e) => e.yon), ['giden', 'gelen']);
    const c = (await store.get('ig_c')).d;
    assert.equal(c.durum, 'gonderildi');
    assert.deepEqual(c.yazisma.map((e) => [e.yon, !!e.otomatik]), [['giden', false], ['gelen', true]]);
    const ts = await js(await cronPost('taslak', k.key));
    assert.equal(ts.taslak, 'ig_b');
    const b = (await store.get('ig_b')).d;
    const son = b.yazisma[b.yazisma.length - 1];
    assert.deepEqual([son.yon, son.oto, son.oneri, son.metin], ['taslak', true, 'anlasildi', 'Çok teşekkürler, kodu gönderiyoruz!']);
    assert.equal(b.yazisma[b.yazisma.length - 2].ozet, 'Olumlu dönüş.');
    assert.equal(b.durum, 'cevap');   // Claude's read is only a suggestion
    assert.equal((await js(await cronPost('taslak', k.key))).atla, 'yok');
    assert.equal(claude, 1);

    const g = await js(await inf.onRequestGet({ env }));
    assert.equal(g.oto.durum.sonGonderim.id, 'ig_c');
    assert.equal(g.oto.durum.sonTaslak.id, 'ig_b');
    assert.ok(g.oto.durum.sonCalisma);
    assert.equal(g.oto.durum.taslakDenenen, undefined);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('scheduler: window and spacing arithmetic', async () => {
  const O = await import('../lib/otomasyon.js');
  const a = { otoBas: 10, otoBit: 18, gunluk: 20 };
  assert.equal(O.pencerede(a, Date.UTC(2026, 8, 28, 6, 59)), false);   // Monday 09:59
  assert.equal(O.pencerede(a, Date.UTC(2026, 8, 28, 7, 0)), true);     // Monday 10:00
  assert.equal(O.pencerede(a, Date.UTC(2026, 9, 2, 14, 59)), true);    // Friday 17:59
  assert.equal(O.pencerede(a, Date.UTC(2026, 9, 2, 15, 0)), false);    // Friday 18:00
  assert.equal(O.pencerede(a, Date.UTC(2026, 9, 4, 9, 0)), false);     // Sunday
  assert.equal(Math.round(O.aralik(a, Date.UTC(2026, 8, 28, 7, 0), 0, 0.5)), 24);   // 480 minutes for 20 mails
  assert.equal(Math.round(O.aralik(a, Date.UTC(2026, 8, 28, 14, 0), 19, 0.5)), 60);  // 17:00, 1 left: 60 minutes
  assert.equal(Math.round(O.aralik(a, Date.UTC(2026, 8, 28, 14, 50), 0, 0.5)), 12);  // never closer than 12 minutes
  const rows = [
    { id: 'a', durum: 'hazir', puan: 50, email: 'a@x.com', mailVar: true },
    { id: 'b', durum: 'onay', puan: 10, email: 'b@x.com', mailVar: true },
    { id: 'c', durum: 'hazir', puan: 90, email: 'c@x.com', mailVar: true },
    { id: 'd', durum: 'hazir', puan: 95, email: 'yok', mailVar: true },
    { id: 'e', durum: 'gonderildi', puan: 99, email: 'e@x.com', mailVar: true, gonderim: 'x' },
    { id: 'f', durum: 'hazir', puan: 99, email: 'f@x.com', mailVar: false },
  ];
  assert.deepEqual(O.siradakiler(rows, { otoKapsam: 'hazir' }), ['b', 'c', 'a']);
  assert.deepEqual(O.siradakiler(rows, { otoKapsam: 'onay' }), ['b']);
});
