// POST /admin/api/login {password} -> session cookie
import { checkPassword, fail, json, missingSecrets, newSession, readJson } from '../../../lib/admin.js';

const pause = (ms) => new Promise((r) => setTimeout(r, ms));

export async function onRequestPost({ request, env }) {
  const missing = missingSecrets(env).filter((k) => k === 'ADMIN_PASSWORD_HASH' || k === 'ADMIN_SESSION_KEY');
  if (missing.length) return fail(503, 'setup', 'Panel henüz kurulmadı.', { missing });
  let body;
  try {
    body = await readJson(request, 4096);
  } catch (e) {
    return fail(400, 'invalid', e.message);
  }
  if (!(await checkPassword(env, body && body.password))) {
    await pause(600);   // slows down guessing; the password itself has 100 random bits
    return fail(401, 'password', 'Şifre yanlış.');
  }
  const s = await newSession(env);
  return json({ ok: true, exp: s.exp }, 200, { 'Set-Cookie': s.cookie });
}
