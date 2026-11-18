import { handleApi } from './api.js';
import { handleAdmin } from './admin.js';
import { getPhotoData } from './db.js';
import { makeSendMail } from './mail.js';

const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };
const json_ = (obj) => new Response(JSON.stringify(obj), { status: 200, headers: JSON_HEADERS });

const notFound_ = () => new Response('Not found', { status: 404, headers: { 'Cache-Control': 'no-store' } });

async function servePhoto_(env, id) {
  if (!/^[0-9a-f]{32}$/.test(id)) return notFound_();
  const data = await getPhotoData(env.DB, id);
  if (!data) return notFound_();
  return new Response(new Uint8Array(data), {
    status: 200,
    headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'public, max-age=31536000, immutable' },
  });
}

function makeDeps_(env, ctx) {
  const id = () => crypto.randomUUID().replaceAll('-', '');
  const now = () => new Date();
  return {
    now,
    newToken: id,
    newId: id,
    sendMail: makeSendMail(env, env.DB, now),
    waitUntil: ctx.waitUntil.bind(ctx),
  };
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method === 'POST' && url.pathname === '/api') {
      let body;
      try {
        body = JSON.parse(await request.text());
      } catch (e) {
        return json_({ ok: false, error: 'server_error' });
      }
      return json_(await handleApi(body, env, makeDeps_(env, ctx)));
    }
    if (request.method === 'GET' && url.pathname.startsWith('/api/photo/')) {
      return servePhoto_(env, url.pathname.slice('/api/photo/'.length));
    }
    if (url.pathname === '/admin' || url.pathname.startsWith('/admin/')) return handleAdmin(request, env, makeDeps_(env, ctx));
    if (url.pathname === '/api' || url.pathname.startsWith('/api/')) return notFound_();
    return env.ASSETS.fetch(request);
  },
};
