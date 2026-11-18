// Admin endpoints for the GAS bridge. Every route requires the X-Sync-Secret header.
import { normalizeEmail, jstDate, isExpired } from './rules.js';
import {
  getProfile, upsertProfile, upsertToken, markSent, listAllTokens, listAllProfiles, resetToken,
  countApplicants, replaceApplicants, claimStalePending, deletePhotoById, listStalePending,
} from './db.js';

const HEADERS = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };
const reply_ = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: HEADERS });
const fail_ = (error, status = 200) => reply_({ ok: false, error }, status);

const RESEND_AFTER_MS = 15 * 60 * 1000;
const MAX_MAILS_PER_CALL = 20; // keeps one invocation well under D1's 50-queries limit

// Constant-time: compares byte lengths and XORs over every byte, no early exit.
function secretMatches_(given, expected) {
  if (typeof expected !== 'string' || expected === '' || typeof given !== 'string') return false;
  const enc = new TextEncoder();
  const a = enc.encode(given);
  const b = enc.encode(expected);
  let diff = a.length ^ b.length;
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) diff |= (i < a.length ? a[i] : 0) ^ (i < b.length ? b[i] : 0);
  return diff === 0;
}

const urlOf_ = (env, token) => env.APP_BASE_URL + '/me.html#t=' + token;

function base64ToBytes_(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function applicants_(body, env) {
  const list = Array.isArray(body.applicants) ? body.applicants : [];
  const merged = new Map(); // email -> canceled (active if any duplicate is not canceled)
  for (const a of list) {
    const email = normalizeEmail(a && a.email);
    if (!email) continue;
    const canceled = !!(a && a.canceled);
    merged.set(email, merged.has(email) ? merged.get(email) && canceled : canceled);
  }
  const received = merged.size;
  const current = await countApplicants(env.DB);
  if (received === 0 || (current > 0 && received < current / 2)) {
    return { ok: false, error: 'suspicious_shrink', current, received };
  }
  await replaceApplicants(env.DB, [...merged].map(([email, canceled]) => ({ email, canceled })));
  return { ok: true, count: received };
}

async function resetToken_(body, env) {
  return { ok: true, found: await resetToken(env.DB, normalizeEmail(body.email)) };
}

async function export_(env) {
  const tokens = (await listAllTokens(env.DB)).map((t) => ({
    email: t.email, url: urlOf_(env, t.token), issuedAt: t.issuedAt, lastSentDate: t.lastSentDate, pending: t.pending,
  }));
  const profiles = (await listAllProfiles(env.DB)).map((p) => {
    const pr = p.profile || {};
    return {
      email: p.email, name: pr.name == null ? '' : pr.name, job: pr.job == null ? '' : pr.job, fields: pr.fields || [],
      challenge: pr.challenge == null ? '' : pr.challenge, strengths: pr.strengths == null ? '' : pr.strengths,
      needs: pr.needs == null ? '' : pr.needs, link: pr.link || '', sns: pr.sns || {}, hasPhoto: !!p.photoId,
      consent: p.consent, consentAt: p.consentAt, updatedAt: p.updatedAt,
    };
  });
  return { ok: true, tokens, profiles };
}

async function pendingMails_(env, deps) {
  const now = deps.now();
  if (isExpired(now, env.EXPIRES_AT)) return { ok: true, mails: [] };
  const cutoffIso = new Date(now.getTime() - RESEND_AFTER_MS).toISOString();
  const mails = [];
  for (const row of await listStalePending(env.DB, cutoffIso, MAX_MAILS_PER_CALL)) {
    // Compare-and-set so two overlapping polls cannot both return the same mail.
    if (await claimStalePending(env.DB, row.email, row.requestedAt, now.toISOString())) {
      mails.push({ email: row.email, url: urlOf_(env, row.token) });
    }
  }
  return { ok: true, mails };
}

async function mailResult_(body, env, deps) {
  const email = normalizeEmail(body.email);
  if (body.sent === true && email) await markSent(env.DB, email, jstDate(deps.now()));
  return { ok: true };
}

async function import_(body, env, deps) {
  const tokens = Array.isArray(body.tokens) ? body.tokens : [];
  const profiles = Array.isArray(body.profiles) ? body.profiles : [];
  let nt = 0;
  for (const t of tokens) {
    const email = normalizeEmail(t && t.email);
    if (!email || typeof t.token !== 'string' || t.token === '') continue;
    await upsertToken(env.DB, { email, token: t.token, issuedAt: t.issuedAt || '', lastSentDate: t.lastSentDate || '', pending: false, requestedAt: '' });
    nt++;
  }
  let np = 0;
  for (const p of profiles) {
    const email = normalizeEmail(p && p.email);
    if (!email) continue;
    const existing = await getProfile(env.DB, email);
    let photoId = (existing && existing.photoId) || '';
    let oldPhotoId = '';
    if (typeof p.photoBase64 === 'string' && p.photoBase64 !== '') {
      const id = deps.newId();
      await env.DB.prepare('INSERT INTO photos (id, data, created_at) VALUES (?, ?, ?)')
        .bind(id, base64ToBytes_(p.photoBase64).buffer, deps.now().toISOString()).run();
      oldPhotoId = photoId;
      photoId = id;
    }
    await upsertProfile(env.DB, {
      email, profile: p.profile || null, photoId, consent: p.consent === true,
      consentAt: p.consentAt || '', updatedAt: p.updatedAt || '',
    });
    if (oldPhotoId) await deletePhotoById(env.DB, oldPhotoId);
    np++;
  }
  return { ok: true, tokens: nt, profiles: np };
}

export async function handleAdmin(request, env, deps) {
  if (!secretMatches_(request.headers.get('X-Sync-Secret'), env.SYNC_SECRET)) return fail_('unauthorized', 401);
  try {
    const path = new URL(request.url).pathname;
    const get = request.method === 'GET';
    const post = request.method === 'POST';
    if (get && path === '/admin/export') return reply_(await export_(env));
    if (get && path === '/admin/pending-mails') return reply_(await pendingMails_(env, deps));
    const routes = {
      '/admin/applicants': (b) => applicants_(b, env),
      '/admin/reset-token': (b) => resetToken_(b, env),
      '/admin/mail-result': (b) => mailResult_(b, env, deps),
      '/admin/import': (b) => import_(b, env, deps),
    };
    if (post && routes[path]) {
      let body;
      try {
        body = JSON.parse(await request.text());
      } catch (e) {
        return fail_('bad_request', 400);
      }
      return reply_(await routes[path](body && typeof body === 'object' ? body : {}));
    }
    return fail_('not_found', 404);
  } catch (err) {
    console.error('handleAdmin failed: ' + (err && err.message));
    return fail_('server_error', 500);
  }
}
