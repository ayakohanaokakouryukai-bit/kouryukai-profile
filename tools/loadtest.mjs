// 負荷テスト: node tools/loadtest.mjs --url <GAS_URL> --token <合鍵> --n 100
// getList を同時に n 件送り、1回ずつの結果を測る（やり直しはしない）。
import { pathToFileURL } from 'node:url';

export function summarize(durationsMs, okCount) {
  const n = durationsMs.length;
  if (n === 0) return { ok: 0, failed: 0, p50: 0, p95: 0, max: 0 };
  const sorted = [...durationsMs].sort((a, b) => a - b);
  const pct = (p) => sorted[Math.max(0, Math.ceil((p / 100) * n) - 1)];
  return { ok: okCount, failed: n - okCount, p50: pct(50), p95: pct(95), max: sorted[n - 1] };
}

export function formatSummary(s) {
  return `ok=${s.ok} failed=${s.failed} p50=${Math.round(s.p50)} p95=${Math.round(s.p95)} max=${Math.round(s.max)}`;
}

function parseArgs(argv) {
  const out = { n: 100 };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--url') out.url = argv[++i];
    else if (argv[i] === '--token') out.token = argv[++i];
    else if (argv[i] === '--n') out.n = Number(argv[++i]);
  }
  return out;
}

async function one(url, token) {
  const start = performance.now();
  let ok = false;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action: 'getList', token }),
      redirect: 'follow',
    });
    if (res.status === 200) {
      const json = await res.json();
      ok = json && json.ok === true;
    }
  } catch (_) {
    ok = false;
  }
  return { ok, ms: performance.now() - start };
}

async function main() {
  const { url, token, n } = parseArgs(process.argv.slice(2));
  if (!url || !token || !Number.isInteger(n) || n < 1) {
    console.error('使い方: node tools/loadtest.mjs --url <GAS_URL> --token <合鍵> --n 100');
    process.exit(2);
  }
  const results = await Promise.all(Array.from({ length: n }, () => one(url, token)));
  const summary = summarize(results.map((r) => r.ms), results.filter((r) => r.ok).length);
  console.log(formatSummary(summary));
  process.exit(summary.failed > 0 ? 1 : 0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
