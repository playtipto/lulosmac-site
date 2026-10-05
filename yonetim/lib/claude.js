// Claude for the Influencer page: reads profile screenshots, personalises an outreach mail, drafts a reply. Calls the
// Anthropic API with the secret ANTHROPIC_API_KEY (optional; without it the page works with the templates only).
// ANTHROPIC_MODEL (plain variable) picks the model; the default suits writing in Turkish, English and Arabic.
import { InfError } from './influencer.js';

export const DEFAULT_MODEL = 'claude-sonnet-5-5';
export const AI_LIMITS = { images: 8, imageBytes: 1500000, body: 8 * 1024 * 1024 };
const TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

const apiUrl = (env) => {
  const t = String((env && env.INF_TEST_API) || '').trim().replace(/\/+$/, '');
  return /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(t) ? t + '/anthropic/v1/messages' : 'https://api.anthropic.com/v1/messages';
};
export const aiReady = (env) => !!String((env && env.ANTHROPIC_API_KEY) || '').trim();
export const modelOf = (env) => String((env && env.ANTHROPIC_MODEL) || DEFAULT_MODEL).trim();

// raw line breaks and tabs inside JSON strings (a common slip when the value is a long letter) written as escapes
export function escapeRawInStrings(s) {
  let out = '', inStr = false, esc = false;
  for (const c of String(s)) {
    if (!inStr) { if (c === '"') inStr = true; out += c; continue; }
    if (esc) { esc = false; out += c; continue; }
    if (c === '\\') { esc = true; out += c; continue; }
    if (c === '"') { inStr = false; out += c; continue; }
    if (c === '\n') out += '\\n';
    else if (c === '\t') out += '\\t';
    else if (c === '\r') continue;
    else if (c < ' ') out += '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0');
    else out += c;
  }
  return out;
}

const parse = (s) => {
  try { return JSON.parse(s); } catch (e) { /* try once more with raw line breaks escaped */ }
  try { return JSON.parse(escapeRawInStrings(s)); } catch (e) { return undefined; }
};

// the first JSON value in a reply (the model sometimes wraps it in a code fence)
export function firstJson(text) {
  const t = String(text || '').replace(/^﻿/, '').trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fence ? fence[1].trim() : t;
  const whole = parse(body);
  if (whole !== undefined) return whole;
  const start = body.search(/[[{]/);
  if (start < 0) return null;
  const open = body[start], close = open === '[' ? ']' : '}';
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < body.length; i++) {
    const c = body[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
    } else if (c === '"') inStr = true;
    else if (c === open) depth++;
    else if (c === close && --depth === 0) {
      const v = parse(body.slice(start, i + 1));
      return v === undefined ? null : v;
    }
  }
  return null;
}

export function checkImages(images) {
  if (!Array.isArray(images) || !images.length) throw new InfError(400, 'invalid', 'Görsel gelmedi.');
  if (images.length > AI_LIMITS.images) throw new InfError(400, 'invalid', `Tek seferde en fazla ${AI_LIMITS.images} görsel.`);
  return images.map((im) => {
    const type = String(im && im.type || '');
    const data = String(im && im.data || '');
    if (!TYPES.includes(type) || !/^[A-Za-z0-9+/]+=*$/.test(data)) throw new InfError(400, 'invalid', 'Görsel okunamadı (PNG, JPG ya da WebP olmalı).');
    if (data.length * 0.75 > AI_LIMITS.imageBytes) throw new InfError(413, 'too_large', 'Görsel çok büyük.');
    return { type: 'image', source: { type: 'base64', media_type: type, data } };
  });
}

// The Claude 5 models think before answering unless told otherwise, and that thinking counts toward max_tokens; these
// short writing jobs don't need it, so it is turned off up front (their lowest setting; older models don't think by
// default and don't know the option).
export const thinksByDefault = (model) => /^claude-(opus|sonnet|fable|mythos)-5\b/.test(String(model));

// One question to Claude; returns the parsed JSON of the answer. With `schema` (a JSON schema: every object lists all its
// properties in `required` and sets additionalProperties: false) the answer is structured output, so the text is valid
// JSON of that shape whatever it holds (quotes, line breaks). The text is parsed either way.
// Statuses stay below 500 so Cloudflare passes the JSON error to the page instead of its own error page.
export async function askJson(env, prompt, { images = [], maxTokens = 4096, schema = null } = {}) {
  if (!aiReady(env)) throw new InfError(424, 'ai_setup', 'Claude için Cloudflare\'de ANTHROPIC_API_KEY eksik.');
  const content = images.concat([{ type: 'text', text: String(prompt) }]);
  const model = modelOf(env);
  const req = { model, max_tokens: maxTokens, messages: [{ role: 'user', content }] };
  if (thinksByDefault(model)) req.thinking = { type: 'between_tools' };
  if (schema) req.output_config = { format: { type: 'json_schema', schema } };
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 90000);
  let r;
  try {
    r = await fetch(apiUrl(env), {
      method: 'POST',
      signal: ctl.signal,
      headers: { 'x-api-key': String(env.ANTHROPIC_API_KEY).trim(), 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify(req),
    });
  } catch (e) {
    console.log('claude: request failed', ctl.signal.aborted ? 'timeout' : String(e && e.message || e));
    throw new InfError(424, 'ai_down', ctl.signal.aborted ? 'Claude zamanında cevap vermedi; tekrar dene.' : 'Claude\'a ulaşılamadı; biraz sonra tekrar dene.');
  } finally {
    clearTimeout(timer);
  }
  const j = await r.json().catch(() => null);
  if (!r.ok) {
    const msg = String((j && j.error && j.error.message) || '');
    console.log('claude: http', r.status, msg.slice(0, 300));
    if (r.status === 401 || r.status === 403) throw new InfError(424, 'ai_key', 'ANTHROPIC_API_KEY geçersiz ya da yetkisiz.');
    if (r.status === 400 && /credit|balance|billing/i.test(msg)) throw new InfError(402, 'ai_credit', 'Anthropic hesabında kredi kalmamış (platform.claude.com → Billing).');
    if (r.status === 404 || (r.status === 400 && /model/i.test(msg) && /not.?found|does not exist|unknown|invalid model/i.test(msg))) throw new InfError(424, 'ai_model', 'Model bulunamadı: ' + model + '. ANTHROPIC_MODEL değerini kontrol et.');
    if (r.status === 413) throw new InfError(413, 'too_large', 'İstek çok büyük; daha az görsel ya da daha kısa metin dene.');
    if (r.status === 429) throw new InfError(429, 'ai_rate', 'Claude\'a çok sık istek gitti; biraz sonra tekrar dene.');
    if (r.status === 529 || r.status >= 500) throw new InfError(424, 'ai_busy', 'Claude şu an yoğun; biraz sonra tekrar dene.');
    throw new InfError(424, 'ai_error', 'Claude isteği reddetti' + (msg ? ': ' + msg.slice(0, 160) : '.'));
  }
  const blocks = (j && Array.isArray(j.content)) ? j.content : [];
  if (j && j.stop_reason === 'refusal') throw new InfError(422, 'ai_refused', 'Claude bu isteği yanıtlamadı; içeriği değiştirip tekrar dene.');
  const text = blocks.filter((b) => b && b.type === 'text').map((b) => b.text).join('\n');
  const out = firstJson(text);
  if (out == null) {
    const stop = j && j.stop_reason;
    console.log('claude: unreadable answer', JSON.stringify({ stop, types: blocks.map((b) => b && b.type), usage: j && j.usage, text: text.slice(0, 300) }));
    throw new InfError(424, 'ai_json', stop === 'max_tokens' ? 'Claude\'un cevabı yarıda kesildi; tekrar dene.' : 'Claude\'un cevabı okunamadı; bir kez daha dene.');
  }
  return out;
}
