import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createContext, runInContext } from 'node:vm';

const GAS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'gas');

// Loads every gas/*.js file (sorted by filename) into one vm context and returns it.
// `globals` injects fakes such as Utilities or ContentService.
export function loadGas(globals = {}) {
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
