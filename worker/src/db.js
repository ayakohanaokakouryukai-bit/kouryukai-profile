// D1 access. Emails are stored normalized by the callers.

const photoUrlOf_ = (id) => (id ? '/api/photo/' + id : '');

function parseFields_(s) {
  try {
    const v = JSON.parse(s || '[]');
    return Array.isArray(v) ? v : [];
  } catch (e) {
    return [];
  }
}

export async function getApplicant(db, email) {
  const r = await db.prepare('SELECT email, canceled FROM applicants WHERE email = ?').bind(email).first();
  return r ? { email: r.email, canceled: !!r.canceled } : null;
}

function tokenRow_(r) {
  return r ? {
    email: r.email, token: r.token, issuedAt: r.issued_at,
    lastSentDate: r.last_sent_date, pending: !!r.pending, requestedAt: r.requested_at,
  } : null;
}

export async function getTokenRowByToken(db, token) {
  return tokenRow_(await db.prepare('SELECT * FROM tokens WHERE token = ?').bind(token).first());
}

export async function getTokenRowByEmail(db, email) {
  return tokenRow_(await db.prepare('SELECT * FROM tokens WHERE email = ?').bind(email).first());
}

export async function upsertToken(db, row) {
  await db.prepare(
    'INSERT INTO tokens (email, token, issued_at, last_sent_date, pending, requested_at) VALUES (?, ?, ?, ?, ?, ?) ' +
    'ON CONFLICT(email) DO UPDATE SET token = excluded.token, issued_at = excluded.issued_at, ' +
    'last_sent_date = excluded.last_sent_date, pending = excluded.pending, requested_at = excluded.requested_at'
  ).bind(row.email, row.token, row.issuedAt || '', row.lastSentDate || '', row.pending ? 1 : 0, row.requestedAt || '').run();
}

function profileRow_(r) {
  if (!r) return null;
  const hasText = r.name != null;
  const hasPhoto = !!r.photo_id;
  const s_ = (v) => (v == null ? '' : v);
  return {
    email: r.email,
    // A photo-only row still yields a profile object (empty text fields) so the photo is not lost.
    profile: hasText || hasPhoto ? {
      name: s_(r.name), job: s_(r.job), fields: parseFields_(r.fields), challenge: s_(r.challenge),
      strengths: s_(r.strengths), needs: s_(r.needs), link: r.link || '', photoUrl: photoUrlOf_(r.photo_id),
    } : null,
    photoId: r.photo_id || '',
    consent: r.consent === 1,
    consentAt: r.consent_at || '',
    updatedAt: r.updated_at || '',
  };
}

export async function getProfile(db, email) {
  return profileRow_(await db.prepare('SELECT * FROM profiles WHERE email = ?').bind(email).first());
}

// row.profile may be null (e.g. photo-only or consent-only row): text columns are then stored as NULL.
export async function upsertProfile(db, row) {
  const p = row.profile;
  await db.prepare(
    'INSERT INTO profiles (email, name, job, fields, challenge, strengths, needs, link, photo_id, consent, consent_at, updated_at) ' +
    'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ' +
    'ON CONFLICT(email) DO UPDATE SET name = excluded.name, job = excluded.job, fields = excluded.fields, ' +
    'challenge = excluded.challenge, strengths = excluded.strengths, needs = excluded.needs, link = excluded.link, ' +
    'photo_id = excluded.photo_id, consent = excluded.consent, consent_at = excluded.consent_at, updated_at = excluded.updated_at'
  ).bind(
    row.email,
    p ? p.name : null, p ? p.job : null, p ? JSON.stringify(p.fields || []) : null,
    p ? p.challenge : null, p ? p.strengths : null, p ? p.needs : null, p ? (p.link || '') : null,
    row.photoId || '', row.consent ? 1 : 0, row.consentAt || '', row.updatedAt || ''
  ).run();
}

// Narrow writes: only the named columns change, so they cannot clobber a concurrent saveProfile.
export async function setConsentOff(db, email, updatedAt) {
  await db.prepare('UPDATE profiles SET consent = 0, updated_at = ? WHERE email = ?').bind(updatedAt, email).run();
}

// Stores the photo, points the profile at it (minimal row if none exists), and returns the previous photo id.
// The old photo row is deleted after the profile points away; that delete is best effort.
export async function replacePhoto(db, email, id, bytes, nowIso) {
  const old = await db.prepare('SELECT photo_id FROM profiles WHERE email = ?').bind(email).first();
  await db.prepare('INSERT INTO photos (id, data, created_at) VALUES (?, ?, ?)').bind(id, bytes.buffer, nowIso).run();
  await db.prepare(
    'INSERT INTO profiles (email, photo_id, updated_at) VALUES (?, ?, ?) ' +
    'ON CONFLICT(email) DO UPDATE SET photo_id = excluded.photo_id, updated_at = excluded.updated_at'
  ).bind(email, id, nowIso).run();
  await deletePhotoRow_(db, old && old.photo_id);
}

export async function clearPhoto(db, email, nowIso) {
  const old = await db.prepare('SELECT photo_id FROM profiles WHERE email = ?').bind(email).first();
  if (!old || !old.photo_id) return;
  await db.prepare("UPDATE profiles SET photo_id = '', updated_at = ? WHERE email = ?").bind(nowIso, email).run();
  await deletePhotoRow_(db, old.photo_id);
}

async function deletePhotoRow_(db, id) {
  if (!id) return;
  try {
    await db.prepare('DELETE FROM photos WHERE id = ?').bind(id).run();
  } catch (err) {
    console.error('photo delete failed: ' + (err && err.message));
  }
}

export async function getPhotoData(db, id) {
  const r = await db.prepare('SELECT data FROM photos WHERE id = ?').bind(id).first();
  return r ? r.data : null;
}

export async function createTokenIfAbsent(db, row) {
  await db.prepare(
    'INSERT INTO tokens (email, token, issued_at) VALUES (?, ?, ?) ON CONFLICT(email) DO NOTHING'
  ).bind(row.email, row.token, row.issuedAt).run();
}

// Atomically marks pending; true only for the caller that flipped pending 0 -> 1.
export async function claimPending(db, email, requestedAt) {
  const r = await db.prepare(
    'UPDATE tokens SET pending = 1, requested_at = ? WHERE email = ? AND pending = 0'
  ).bind(requestedAt, email).run();
  return r.meta.changes === 1;
}

export async function markSent(db, email, date) {
  await db.prepare(
    "UPDATE tokens SET pending = 0, requested_at = '', last_sent_date = ? WHERE email = ?"
  ).bind(date, email).run();
}

export async function listVisibleProfiles(db) {
  const { results } = await db.prepare(
    'SELECT p.* FROM profiles p JOIN applicants a ON a.email = p.email ' +
    'WHERE a.canceled = 0 AND p.consent = 1 ORDER BY p.consent_at DESC'
  ).all();
  return results.map(profileRow_);
}

// ---- admin helpers ----

export async function countApplicants(db) {
  return (await db.prepare('SELECT COUNT(*) AS n FROM applicants').first()).n;
}

// Atomic full replace (one batch = one transaction). Multi-row INSERTs keep the statement count low
// (D1 free plan: 50 queries per invocation; 100 bound parameters per statement -> 50 rows per INSERT).
const APPLICANT_CHUNK = 50;
export async function replaceApplicants(db, rows) {
  const stmts = [db.prepare('DELETE FROM applicants')];
  for (let i = 0; i < rows.length; i += APPLICANT_CHUNK) {
    const chunk = rows.slice(i, i + APPLICANT_CHUNK);
    const sql = 'INSERT INTO applicants (email, canceled) VALUES ' + chunk.map(() => '(?, ?)').join(', ');
    stmts.push(db.prepare(sql).bind(...chunk.flatMap((r) => [r.email, r.canceled ? 1 : 0])));
  }
  await db.batch(stmts);
}

// Tokens pending since cutoffIso or earlier whose applicant exists and is not canceled, oldest first.
export async function listStalePending(db, cutoffIso, limit) {
  const { results } = await db.prepare(
    "SELECT t.* FROM tokens t JOIN applicants a ON a.email = t.email " +
    "WHERE t.pending = 1 AND t.requested_at != '' AND t.requested_at <= ? AND a.canceled = 0 " +
    'ORDER BY t.requested_at, t.email LIMIT ?'
  ).bind(cutoffIso, limit).all();
  return results.map(tokenRow_);
}

// Deletes the token row (clearing lastSentDate and pending with it); true if one existed.
export async function resetToken(db, email) {
  const r = await db.prepare('DELETE FROM tokens WHERE email = ?').bind(email).run();
  return r.meta.changes === 1;
}

export async function listAllTokens(db) {
  const { results } = await db.prepare('SELECT * FROM tokens ORDER BY email').all();
  return results.map(tokenRow_);
}

export async function listAllProfiles(db) {
  const { results } = await db.prepare('SELECT * FROM profiles ORDER BY email').all();
  return results.map(profileRow_);
}

// Compare-and-set on requested_at: true only for the caller that moved it.
export async function claimStalePending(db, email, oldRequestedAt, newRequestedAt) {
  const r = await db.prepare(
    'UPDATE tokens SET requested_at = ? WHERE email = ? AND pending = 1 AND requested_at = ?'
  ).bind(newRequestedAt, email, oldRequestedAt).run();
  return r.meta.changes === 1;
}

export async function deletePhotoById(db, id) {
  await deletePhotoRow_(db, id);
}
