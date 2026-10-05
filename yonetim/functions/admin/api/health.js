// GET /admin/api/health: is the panel set up? Names the missing Cloudflare secrets (never their values).
import { json, missingSecrets } from '../../../lib/admin.js';

export function onRequestGet({ env }) {
  const missing = missingSecrets(env);
  return json({ ready: missing.length === 0, missing });
}
