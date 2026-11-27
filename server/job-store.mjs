import { DatabaseSync } from 'node:sqlite';
import { chmodSync, mkdirSync } from 'node:fs';
import path from 'node:path';

// A single-instance preview can recover admitted requests without replaying inference.
// Store the accepted result and session binding, never the uploaded request body or key.
export function openJobStore(filename, publicRoot) {
  const absolute = path.resolve(filename);
  const relative = path.relative(publicRoot, absolute);
  if (!relative.startsWith('..' + path.sep) && !path.isAbsolute(relative) &&
      !relative.startsWith('.devcache' + path.sep)) {
    throw Error('Place the job database outside the served files or inside .devcache.');
  }
  mkdirSync(path.dirname(absolute), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(absolute);
  chmodSync(absolute, 0o600);
  db.exec(`PRAGMA synchronous=FULL;
    CREATE TABLE IF NOT EXISTS records(
      kind TEXT NOT NULL, id TEXT NOT NULL, created INTEGER NOT NULL,
      value TEXT NOT NULL, PRIMARY KEY(kind,id)
    ) WITHOUT ROWID`);
  const write = db.prepare('INSERT OR REPLACE INTO records VALUES(?,?,?,?)');
  const read = db.prepare('SELECT id,value FROM records WHERE kind=?');
  const prune = db.prepare("DELETE FROM records WHERE (kind='session' AND created<=?) OR (kind<>'session' AND created<=?)");
  const save = (kind, id, data) => {
    const {controller, ...record} = data;
    write.run(kind, id, record.created, JSON.stringify(record));
  };
  return {
    prune(now) { prune.run(now - 3600000, now - 900000); },
    load(kind) { return new Map(read.all(kind).map(row => [row.id, JSON.parse(row.value)])); },
    save,
    admit(job, ownerSession, request) {
      db.exec('BEGIN IMMEDIATE');
      try {
        save('session', job.owner, ownerSession);
        save('job', job.id, job);
        if (request) save('request', job.requestKey, request);
        db.exec('COMMIT');
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },
    close() { db.close(); }
  };
}
