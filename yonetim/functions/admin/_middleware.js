// Everything under /admin: strict headers on every response; the API needs a signed-in session (except sign-in itself
// and the setup check) and a custom header, so another site can never make the owner's browser call it.
import { adminHeaders, fail, readSession } from '../../lib/admin.js';

const OPEN = new Set(['/admin/api/login', '/admin/api/health']);

export async function onRequest(context) {
  const { request, env, next } = context;
  const url = new URL(request.url);
  if (url.pathname.startsWith('/admin/api/')) {
    if (request.headers.get('X-Lulo-Admin') !== '1') return adminHeaders(fail(403, 'forbidden', 'Bu adres yalnızca yönetim panelinden kullanılır.'));
    const origin = request.headers.get('Origin');
    if (request.method !== 'GET' && origin && origin !== url.origin) return adminHeaders(fail(403, 'forbidden', 'Başka bir siteden gelen istek.'));
    if (!OPEN.has(url.pathname)) {
      const session = await readSession(request, env);
      if (!session) return adminHeaders(fail(401, 'login', 'Oturum kapandı; tekrar giriş yap.'));
      context.data.session = session;
    }
  }
  let res;
  try {
    res = await next();
  } catch (e) {
    res = fail(500, 'server', 'Beklenmeyen bir hata oldu.');
  }
  return adminHeaders(res);
}
