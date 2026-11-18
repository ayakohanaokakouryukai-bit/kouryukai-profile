import { handleApi } from './api.js';

const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };
const json_ = (obj) => new Response(JSON.stringify(obj), { status: 200, headers: JSON_HEADERS });

function makeDeps_(ctx) {
  const id = () => crypto.randomUUID().replaceAll('-', '');
  return {
    now: () => new Date(),
    newToken: id,
    newId: id,
    sendMail: async () => {}, // replaced by makeSendMail(env, env.DB, now) in Task 3
    waitUntil: (p) => ctx.waitUntil(p),
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
      return json_(await handleApi(body, env, makeDeps_(ctx)));
    }
    return env.ASSETS.fetch(request);
  },
};
