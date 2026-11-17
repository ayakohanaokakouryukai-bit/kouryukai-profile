const KEY = 'kp_list';

export function loadList(storage) {
  try {
    const v = JSON.parse(storage.getItem(KEY));
    return v && typeof v === 'object' && Array.isArray(v.participants) ? v : null;
  } catch (e) {
    return null;
  }
}

export function saveList(storage, data) {
  try { storage.setItem(KEY, JSON.stringify(data)); } catch (e) { /* ignore quota etc. */ }
}

export function clearList(storage) {
  try { storage.removeItem(KEY); } catch (e) { /* ignore */ }
}
