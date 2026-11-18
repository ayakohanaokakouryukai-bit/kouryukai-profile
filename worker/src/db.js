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
  const hasProfile = r.name != null;
  return {
    email: r.email,
    profile: hasProfile ? {
      name: r.name, job: r.job, fields: parseFields_(r.fields), challenge: r.challenge,
      strengths: r.strengths, needs: r.needs, link: r.link || '', photoUrl: photoUrlOf_(r.photo_id),
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

export async function listVisibleProfiles(db) {
  const { results } = await db.prepare(
    'SELECT p.* FROM profiles p JOIN applicants a ON a.email = p.email ' +
    'WHERE a.canceled = 0 AND p.consent = 1 ORDER BY p.consent_at DESC'
  ).all();
  return results.map(profileRow_);
}
