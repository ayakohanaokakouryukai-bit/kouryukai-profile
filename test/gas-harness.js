import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createContext, runInContext } from 'node:vm';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// Loads every <dir>/*.js file (default gas/) (sorted by filename) into one vm context and returns it.
// `globals` injects fakes such as Utilities or ContentService.
export function loadGas(globals = {}, dir = 'gas') {
  const GAS_DIR = join(REPO_ROOT, dir);
  const ctx = createContext({ ...globals });
  const files = readdirSync(GAS_DIR)
    .filter((name) => name.endsWith('.js'))
    .sort();
  for (const name of files) {
    const source = readFileSync(join(GAS_DIR, name), 'utf8');
    runInContext(source, ctx, { filename: name });
  }
  return ctx;
}
