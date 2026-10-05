// GET /admin/api/status: what the panel is set up with (missing secrets, when the session ends)
import { json, missingSecrets } from '../../../lib/admin.js';

export async function onRequestGet({ env, data }) {
  return json({ missing: missingSecrets(env), influencerDb: !!env.INFLUENCER_DB, gmail: !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET), claude: !!env.ANTHROPIC_API_KEY, sessionEnds: data.session.exp });
}
