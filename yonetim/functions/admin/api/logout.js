// POST /admin/api/logout
import { endSession, json } from '../../../lib/admin.js';

export function onRequestPost() {
  return json({ ok: true }, 200, { 'Set-Cookie': endSession() });
}
