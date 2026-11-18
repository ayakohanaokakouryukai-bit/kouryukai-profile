// SNS accounts: shared by the page (input, display) and the Worker (validation). Pure functions only.

export const SNS_LIST = [
  { key: 'instagram', label: 'Instagram', at: true, hosts: ['instagram.com'], re: /^[a-z0-9._]{1,30}$/i,
    url: (id) => `https://www.instagram.com/${id}/` },
  { key: 'x', label: 'X', at: true, hosts: ['x.com', 'twitter.com'], re: /^[a-z0-9_]{1,15}$/i,
    url: (id) => `https://x.com/${id}` },
  { key: 'threads', label: 'Threads', at: true, hosts: ['threads.com', 'threads.net'], re: /^[a-z0-9._]{1,30}$/i,
    url: (id) => `https://www.threads.com/@${id}` },
  { key: 'facebook', label: 'Facebook', at: false, hosts: ['facebook.com', 'fb.com'],
    re: /^([a-z0-9.]{1,50}|profile\.php\?id=\d{1,20})$/i,
    url: (id) => `https://www.facebook.com/${id}` },
];

export const SNS_KEYS = SNS_LIST.map((s) => s.key);

const ERR = {
  instagram: '英数字・ピリオド・アンダーバーのID（30文字まで）を入力してください',
  x: '英数字・アンダーバーのID（15文字まで）を入力してください',
  threads: '英数字・ピリオド・アンダーバーのID（30文字まで）を入力してください',
  facebook: 'facebook.com/ のあとのユーザー名を入力してください',
};

function hostOk_(host, hosts) {
  host = host.toLowerCase().replace(/^(www|m|mobile|web)\./, '');
  return hosts.includes(host);
}

// Turns "@id", "id", or a pasted profile URL into the bare id. Returns { ok, value } or { ok:false, error }.
export function normalizeSnsId(key, raw) {
  const def = SNS_LIST.find((s) => s.key === key);
  if (!def) return { ok: false, error: 'unknown' };
  if (raw == null) return { ok: true, value: '' };
  if (typeof raw !== 'string') return { ok: false, error: ERR[key] };
  let v = raw.normalize('NFKC').trim();
  if (v === '') return { ok: true, value: '' };
  const looksUrl = /^https?:\/\//i.test(v) || /^(www\.|m\.)?[a-z0-9.-]+\.(com|net)\//i.test(v);
  if (looksUrl) {
    let u;
    try { u = new URL(/^https?:\/\//i.test(v) ? v : 'https://' + v); } catch (e) { return { ok: false, error: ERR[key] }; }
    if (!hostOk_(u.hostname, def.hosts)) return { ok: false, error: ERR[key] };
    const seg = u.pathname.split('/').filter(Boolean);
    if (key === 'facebook' && seg[0] === 'profile.php' && u.searchParams.get('id')) {
      v = 'profile.php?id=' + u.searchParams.get('id');
    } else {
      v = seg[0] || '';
    }
  }
  v = v.replace(/^@+/, '');
  if (!def.re.test(v)) return { ok: false, error: ERR[key] };
  return { ok: true, value: v };
}

// Validates an sns object; unknown keys are ignored. Returns { ok, value } or { ok:false, errors:{key:msg} }.
export function validateSns(sns) {
  const value = {};
  const errors = {};
  const src = sns && typeof sns === 'object' ? sns : {};
  for (const key of SNS_KEYS) {
    const r = normalizeSnsId(key, src[key]);
    if (r.ok) { if (r.value) value[key] = r.value; } else errors[key] = r.error;
  }
  return Object.keys(errors).length ? { ok: false, errors } : { ok: true, value };
}

// Parses the stored JSON; anything malformed becomes {} so display never breaks.
export function parseSns(s) {
  try {
    const o = typeof s === 'string' ? JSON.parse(s || '{}') : s;
    const r = validateSns(o);
    return r.ok ? r.value : {};
  } catch (e) {
    return {};
  }
}

export function snsUrl(key, id) {
  const def = SNS_LIST.find((s) => s.key === key);
  return def && id ? def.url(id) : '';
}

// Display entries in a fixed order: [{ key, label, id, url }]
export function snsEntries(sns) {
  const o = sns || {};
  return SNS_LIST.filter((s) => o[s.key]).map((s) => ({ key: s.key, label: s.label, id: o[s.key], url: s.url(o[s.key]) }));
}
