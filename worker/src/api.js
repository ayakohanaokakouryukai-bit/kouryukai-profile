// Participant API. Mirrors gas/Service.js; all state lives in D1 and auth is checked on every request.
import { normalizeEmail, validateProfile, isVisible, isExpired, toPublicProfile, canSendToday } from './rules.js';
import {
  getApplicant, getTokenRowByToken, getTokenRowByEmail, getProfile, upsertProfile, listVisibleProfiles,
  setConsentOff, replacePhoto, clearPhoto, createTokenIfAbsent, claimPending,
} from './db.js';

const MAX_PHOTO_BASE64_CHARS = 2000000;

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
  await setConsentOff(env.DB, auth.email, deps.now().toISOString());
  return { ok: true };
}

function base64ToBytes_(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function uploadPhoto_(req, env, deps) {
  const auth = await authorize(env, deps, req.token);
  if (!auth.ok) return auth;
  const b64 = req.base64;
  if (req.mimeType !== 'image/jpeg' || typeof b64 !== 'string' || b64 === '') return fail_('bad_image');
  // JPEG starts FF D8 FF, which is '/9j/' in base64.
  if (b64.length > MAX_PHOTO_BASE64_CHARS || b64.indexOf('/9j/') !== 0) return fail_('bad_image');
  let bytes;
  try {
    bytes = base64ToBytes_(b64);
  } catch (e) {
    return fail_('bad_image');
  }
  const id = deps.newId();
  await replacePhoto(env.DB, auth.email, id, bytes, deps.now().toISOString());
  return { ok: true, photoUrl: '/api/photo/' + id };
}

async function deletePhoto_(req, env, deps) {
  const auth = await authorize(env, deps, req.token);
  if (!auth.ok) return auth;
  await clearPhoto(env.DB, auth.email, deps.now().toISOString());
  return { ok: true };
}

async function requestLinkWork_(req, env, deps) {
  const email = normalizeEmail(req.email);
  const now = deps.now();
  if (!email || isExpired(now, env.EXPIRES_AT)) return;
  const applicant = await getApplicant(env.DB, email);
  if (!applicant || applicant.canceled) return;
  await createTokenIfAbsent(env.DB, { email, token: deps.newToken(), issuedAt: now.toISOString() });
  const row = await getTokenRowByEmail(env.DB, email);
  if (!row || row.pending || !canSendToday(row.lastSentDate, now)) return;
  if (!(await claimPending(env.DB, email, now.toISOString()))) return;
  const url = env.APP_BASE_URL + '/me.html#t=' + row.token;
  let p;
  try {
    p = Promise.resolve(deps.sendMail({ email, url }));
  } catch (err) {
    p = Promise.reject(err);
  }
  deps.waitUntil(p.catch((err) => console.error('sendMail failed: ' + (err && err.message))));
}

async function requestLink_(req, env, deps) {
  try {
    await requestLinkWork_(req, env, deps);
  } catch (err) {
    console.error('requestLink failed: ' + (err && err.message));
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
      case 'uploadPhoto': return await uploadPhoto_(req, env, deps);
      case 'deletePhoto': return await deletePhoto_(req, env, deps);
      case 'requestLink': return await requestLink_(req, env, deps);
      case 'getList': return await getList_(req, env, deps);
      default: return fail_('server_error');
    }
  } catch (err) {
    console.error('handleApi failed: ' + (err && err.message));
    return fail_('server_error');
  }
}
