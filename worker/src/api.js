// Participant API. Mirrors gas/Service.js; all state lives in D1 and auth is checked on every request.
import { normalizeEmail, validateProfile, isVisible, isExpired, toPublicProfile } from './rules.js';
import { getApplicant, getTokenRowByToken, getProfile, upsertProfile, listVisibleProfiles } from './db.js';

const fail_ = (error) => ({ ok: false, error });

export async function authorize(env, deps, token) {
  if (typeof token !== 'string' || token.trim() === '') return fail_('invalid_token');
  const row = await getTokenRowByToken(env.DB, token);
  if (!row) return fail_('invalid_token');
  const email = normalizeEmail(row.email);
  const applicant = await getApplicant(env.DB, email);
  if (!applicant || applicant.canceled) return fail_('invalid_token');
  if (isExpired(deps.now(), env.EXPIRES_AT)) return fail_('expired');
  return { ok: true, email };
}

async function getMe_(req, env, deps) {
  const auth = await authorize(env, deps, req.token);
  if (!auth.ok) return auth;
  const row = await getProfile(env.DB, auth.email);
  return {
    ok: true,
    profile: row && row.profile ? row.profile : null,
    consent: !!(row && row.consent),
    visible: isVisible(row),
    expiresAt: env.EXPIRES_AT,
  };
}

async function saveProfile_(req, env, deps) {
  const auth = await authorize(env, deps, req.token);
  if (!auth.ok) return auth;
  const existing = await getProfile(env.DB, auth.email);
  if (req.consent !== true && !(existing && existing.consent === true)) return fail_('consent_required');
  const v = validateProfile(req.profile);
  if (!v.ok) return { ok: false, error: 'validation', fieldErrors: v.fieldErrors };
  const nowIso = deps.now().toISOString();
  const photoId = (existing && existing.photoId) || '';
  const profile = v.value;
  profile.photoUrl = photoId ? '/api/photo/' + photoId : '';
  const row = {
    email: auth.email,
    profile,
    photoId,
    consent: true,
    consentAt: (existing && existing.consentAt) || nowIso,
    updatedAt: nowIso,
  };
  await upsertProfile(env.DB, row);
  return { ok: true, profile, visible: isVisible(row) };
}

async function withdrawConsent_(req, env, deps) {
  const auth = await authorize(env, deps, req.token);
  if (!auth.ok) return auth;
  const row = await getProfile(env.DB, auth.email);
  if (row) {
    row.consent = false;
    row.updatedAt = deps.now().toISOString();
    await upsertProfile(env.DB, row);
  }
  return { ok: true };
}

async function getList_(req, env, deps) {
  const auth = await authorize(env, deps, req.token);
  if (!auth.ok) return auth;
  if (!isVisible(await getProfile(env.DB, auth.email))) return fail_('not_visible');
  const rows = (await listVisibleProfiles(env.DB)).filter((r) => isVisible(r));
  return { ok: true, participants: rows.map(toPublicProfile), generatedAt: deps.now().toISOString() };
}

export async function handleApi(req, env, deps) {
  try {
    req = req || {};
    switch (req.action) {
      case 'getMe': return await getMe_(req, env, deps);
      case 'saveProfile': return await saveProfile_(req, env, deps);
      case 'withdrawConsent': return await withdrawConsent_(req, env, deps);
      case 'getList': return await getList_(req, env, deps);
      default: return fail_('server_error');
    }
  } catch (err) {
    console.error('handleApi failed: ' + (err && err.message));
    return fail_('server_error');
  }
}
