import { GAS_URL } from './config.js';

export async function callApi(action, payload, {
  fetchImpl = (...a) => fetch(...a),
  retries = 4,
  baseDelayMs = 2000,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  url = GAS_URL,
  onRetry,
} = {}) {
  const body = JSON.stringify({ action, ...payload });
  for (let k = 0; k <= retries; k++) {
    try {
      const res = await fetchImpl(url, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body,
        redirect: 'follow',
      });
      if (res.status < 500) {
        const json = await res.json();
        if (!(json && json.error === 'busy')) return json;
      }
    } catch (e) {
      // thrown fetch error or unparsable JSON: retry
    }
    if (k === retries) break;
    if (onRetry) onRetry(k + 1);
    await sleep(baseDelayMs * 2 ** k);
  }
  return { ok: false, error: 'network' };
}
