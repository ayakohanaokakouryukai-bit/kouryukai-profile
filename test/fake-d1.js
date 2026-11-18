// Minimal D1Database-like fake built on node:sqlite, for tests only.
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

// Suppress only the node:sqlite ExperimentalWarning.
const origEmit = process.emitWarning;
process.emitWarning = function (w, ...rest) {
  const type = typeof rest[0] === 'string' ? rest[0] : rest[0] && rest[0].type;
  if (type === 'ExperimentalWarning' && /SQLite/i.test(String(w))) return;
  return origEmit.call(process, w, ...rest);
};
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite');
process.emitWarning = origEmit;

const toParam = (v) => (v === undefined ? null : v instanceof ArrayBuffer ? new Uint8Array(v) : v);

class Statement {
  constructor(db, sql, args = []) {
    this.db = db;
    this.sql = sql;
    this.args = args;
  }
  bind(...args) {
    return new Statement(this.db, this.sql, args.map(toParam));
  }
  _run() {
    return this.db.prepare(this.sql).run(...this.args);
  }
  async first() {
    const row = this.db.prepare(this.sql).get(...this.args);
    return row === undefined ? null : { ...row };
  }
  async all() {
    const results = this.db.prepare(this.sql).all(...this.args).map((r) => ({ ...r }));
    return { results, success: true, meta: { changes: 0 } };
  }
  async run() {
    const r = this._run();
    return { results: [], success: true, meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } };
  }
}

export function makeFakeD1(sqlFiles) {
  const db = new DatabaseSync(':memory:');
  for (const f of sqlFiles) db.exec(readFileSync(f, 'utf8'));
  return {
    prepare: (sql) => new Statement(db, sql),
    async batch(stmts) {
      db.exec('BEGIN');
      try {
        const out = [];
        for (const s of stmts) {
          if (/^\s*(select|with|pragma)/i.test(s.sql)) {
            out.push({ results: db.prepare(s.sql).all(...s.args).map((r) => ({ ...r })), success: true, meta: { changes: 0 } });
          } else {
            const r = s._run();
            out.push({ results: [], success: true, meta: { changes: Number(r.changes) } });
          }
        }
        db.exec('COMMIT');
        return out;
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
    },
  };
}
