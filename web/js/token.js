const KEY = 'kp_token';
const PATTERN = /^[0-9a-f]{32}$/;

export function readToken(location, storage) {
  let fromHash = null;
  try {
    const t = new URLSearchParams(String(location.hash || '').replace(/^#/, '')).get('t');
    if (t && PATTERN.test(t)) fromHash = t;
  } catch (e) { /* ignore */ }
  if (fromHash) {
    try { storage.setItem(KEY, fromHash); } catch (e) { /* ignore */ }
    return fromHash;
  }
  try {
    const saved = storage.getItem(KEY);
    if (saved && PATTERN.test(saved)) return saved;
  } catch (e) { /* ignore */ }
  return null;
}

export function clearToken(storage) {
  try { storage.removeItem(KEY); } catch (e) { /* ignore */ }
}
