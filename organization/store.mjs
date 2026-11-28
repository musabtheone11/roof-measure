import { DatabaseSync } from 'node:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import { constants, openSync, closeSync, readFileSync, writeFileSync, lstatSync, mkdirSync, chmodSync, existsSync, fsyncSync } from 'node:fs';
import { resolve, join, parse } from 'node:path';

const HASH = /^[a-f0-9]{64}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$/;
const MODES = new Set(['running', 'paused', 'stopped']);
const TERMINAL = new Set(['complete', 'needs-human', 'failed', 'cancelled', 'rejected']);
const MAX_ARTIFACT = 16 * 1024 * 1024;
const fail = (code, message) => { const e = new Error(message); e.code = code; throw e; };
const id = value => { if (typeof value !== 'string' || !ID.test(value)) fail('INVALID_ID', 'Invalid bounded identifier'); return value; };
const finite = (n, name) => { if (!Number.isFinite(n) || n < 0) fail('INVALID_LIMIT', `${name} must be finite and nonnegative`); return n; };
const json = value => { const s = JSON.stringify(value); if (typeof s !== 'string' || Buffer.byteLength(s) > 1024 * 1024) fail('INVALID_DATA', 'JSON data exceeds the storage bound'); return s; };
const stageLimit = row => { const task=JSON.parse(row.body); return Math.min(2, task.maxAttempts ?? 2, task.constraints?.maxAttempts ?? 2); };
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
export const ALLOWANCE_LIMITS = Object.freeze({workflowUnits:500000000,dayUnits:1000000000,weekUnits:1000000000});
const units = (value,name) => { if(!Number.isSafeInteger(value)||value<0)fail('INVALID_ALLOWANCE',`${name} must be a nonnegative safe integer`);return value; };
const allowanceSnapshot = (value,now) => {
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!['reservedUnits','remainingUnits','observedAt','expiresAt','periodKey','unlimited'].includes(key)))fail('INVALID_ALLOWANCE','A bounded host-observed allowance snapshot is required');
  units(value.reservedUnits,'reservedUnits');
  if(value.reservedUnits===0)fail('INVALID_ALLOWANCE','Every free request requires a positive conservative allowance reservation');
  if(typeof value.unlimited!=='boolean')fail('INVALID_ALLOWANCE','unlimited must be an explicit boolean');
  if(!value.unlimited||value.remainingUnits!=null)units(value.remainingUnits,'remainingUnits');
  if(!Number.isSafeInteger(value.observedAt)||value.observedAt<0||value.observedAt>now||now-value.observedAt>60000||
    !Number.isSafeInteger(value.expiresAt)||value.expiresAt<=now||value.expiresAt<=value.observedAt)fail('ALLOWANCE_SNAPSHOT_STALE','Allowance observation must be at most60seconds old and unexpired');
  id(value.periodKey);return value;
};

function noSymlinkPath(path) {
  const absolute = resolve(path), root = parse(absolute).root;
  let current = root;
  for (const part of absolute.slice(root.length).split(/[\\/]/).filter(Boolean)) {
    current = join(current, part);
    try { if (lstatSync(current).isSymbolicLink()) fail('UNSAFE_PATH', 'Symbolic links are not permitted in storage paths'); }
    catch (e) { if (e.code !== 'ENOENT') throw e; }
  }
  return absolute;
}

/** Single-host, durable organization state. This is NOT encrypted SQLite. */
export class OrgStore {
  constructor(directory, { now = Date.now } = {}) {
    if (typeof directory !== 'string' || !directory) fail('UNSAFE_PATH', 'A storage directory is required');
    this.directory = noSymlinkPath(directory);
    mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    chmodSync(this.directory, 0o700);
    this.blobDirectory = join(this.directory, 'artifacts');
    noSymlinkPath(this.blobDirectory);
    mkdirSync(this.blobDirectory, { mode: 0o700, recursive: true });
    chmodSync(this.blobDirectory, 0o700);
    this.now = now;
    const path = noSymlinkPath(join(this.directory, 'organization.sqlite'));
    if (!existsSync(path)) { const fd = openSync(path, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600); closeSync(fd); }
    if (!lstatSync(path).isFile()) fail('UNSAFE_PATH', 'Database must be a regular file');
    chmodSync(path, 0o600);
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;');
    const version = this.db.prepare('PRAGMA user_version').get().user_version;
    if (version !== 0 && version !== 1) { this.db.close(); fail('SCHEMA_VERSION', 'Unsupported organization schema version; back up before migration'); }
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY, workflow_id TEXT NOT NULL, body TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0,
        fence INTEGER NOT NULL DEFAULT 0, worker TEXT, lease_until INTEGER,
        result TEXT, error TEXT, created INTEGER NOT NULL, updated INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS attempts (
        id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id),
        workflow_id TEXT NOT NULL, worker TEXT NOT NULL, fence INTEGER NOT NULL,
        state TEXT NOT NULL, reserve_usd REAL NOT NULL, charged_usd REAL NOT NULL,
        reported_usd REAL, created INTEGER NOT NULL, updated INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS attempts_workflow ON attempts(workflow_id,created);
      CREATE TABLE IF NOT EXISTS events (
        seq INTEGER PRIMARY KEY AUTOINCREMENT, task_id TEXT, kind TEXT NOT NULL,
        detail TEXT NOT NULL, created INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS attempt_allowances (
        attempt_id TEXT PRIMARY KEY REFERENCES attempts(id), task_id TEXT NOT NULL REFERENCES tasks(id),
        workflow_id TEXT NOT NULL, state TEXT NOT NULL,
        reserved_units INTEGER NOT NULL, charged_units INTEGER NOT NULL,
        reported_units INTEGER, estimated_units INTEGER,
        remaining_units INTEGER, observed_at INTEGER, expires_at INTEGER,
        period_key TEXT NOT NULL, unlimited INTEGER NOT NULL DEFAULT 0,
        model TEXT, evidence TEXT, legacy INTEGER NOT NULL DEFAULT 0,
        created INTEGER NOT NULL, updated INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS allowance_workflow ON attempt_allowances(workflow_id,created);
      INSERT OR IGNORE INTO settings(key,value) VALUES ('control','paused');
      INSERT OR IGNORE INTO settings(key,value) VALUES ('budgetIncident','false');
      INSERT OR IGNORE INTO settings(key,value) VALUES ('allowanceIncident','false');
      PRAGMA user_version=1;
    `);
    if (!this.db.prepare('PRAGMA table_info(tasks)').all().some(column => column.name === 'not_before')) this.db.exec('ALTER TABLE tasks ADD COLUMN not_before INTEGER NOT NULL DEFAULT 0');
  }

  close() { this.db.close(); }
  transaction(fn) {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); this.db.exec('COMMIT'); return result; }
    catch (e) { this.db.exec('ROLLBACK'); throw e; }
  }
  event(taskId, kind, detail = {}) {
    this.db.prepare('INSERT INTO events(task_id,kind,detail,created) VALUES (?,?,?,?)').run(taskId, kind, json(detail), this.now());
  }
  events(taskId) {
    const rows = taskId ? this.db.prepare('SELECT * FROM events WHERE task_id=? ORDER BY seq').all(id(taskId)) : this.db.prepare('SELECT * FROM events ORDER BY seq').all();
    return rows.map(row => ({ ...row, detail: JSON.parse(row.detail) }));
  }
  putArtifact(value) {
    if (!(value instanceof Uint8Array) && typeof value !== 'string') fail('INVALID_DATA', 'Artifact must be bytes or text');
    const bytes = Buffer.from(value);
    if (bytes.length > MAX_ARTIFACT) fail('ARTIFACT_LIMIT', 'Artifact exceeds 16 MiB');
    const hash = digest(bytes), path = noSymlinkPath(join(this.blobDirectory, hash));
    try {
      const fd = openSync(path, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | (constants.O_NOFOLLOW || 0), 0o600);
      try { writeFileSync(fd, bytes); fsyncSync(fd); } finally { closeSync(fd); }
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      if (digest(this.readArtifact(hash)) !== hash) fail('ARTIFACT_CORRUPT', 'Existing artifact hash is invalid');
    }
    return { hash, bytes: bytes.length };
  }
  readArtifact(hash) {
    if (typeof hash !== 'string' || !HASH.test(hash)) fail('INVALID_HASH', 'Invalid artifact hash');
    const path = noSymlinkPath(join(this.blobDirectory, hash)), stat = lstatSync(path);
    if (!stat.isFile() || stat.size > MAX_ARTIFACT) fail('UNSAFE_PATH', 'Artifact must be a bounded regular file');
    const fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
    let bytes;
    try { bytes = readFileSync(fd); } finally { closeSync(fd); }
    if (bytes.length > MAX_ARTIFACT || digest(bytes) !== hash) fail('ARTIFACT_CORRUPT', 'Artifact content does not match its hash');
    return bytes;
  }
  enqueue(task) {
    if (!task || typeof task !== 'object' || Array.isArray(task)) fail('INVALID_TASK', 'Task must be an object');
    const taskId = id(task.id), workflowId = id(task.workflowId ?? taskId), body = json(task), now = this.now();
    return this.transaction(() => {
      const old = this.db.prepare('SELECT body FROM tasks WHERE id=?').get(taskId);
      if (old) { if (old.body !== body) fail('TASK_CONFLICT', 'Task identifier already binds different inputs'); return this.getTask(taskId); }
      this.db.prepare('INSERT INTO tasks(id,workflow_id,body,created,updated) VALUES (?,?,?,?,?)').run(taskId, workflowId, body, now, now);
      this.event(taskId, 'queued');
      return this.getTask(taskId);
    });
  }
  decode(row) {
    if (!row) return null;
    return { ...JSON.parse(row.body), status: row.status, attempts: row.attempts, fence: row.fence, workerId: row.worker,
      leaseUntil: row.lease_until, result: row.result ? JSON.parse(row.result) : null, error: row.error,
      createdAt: row.created, updatedAt: row.updated, notBefore: row.not_before };
  }
  getTask(taskId) { return this.decode(this.db.prepare('SELECT * FROM tasks WHERE id=?').get(id(taskId))); }
  listTasks() { return this.db.prepare('SELECT * FROM tasks ORDER BY created,id').all().map(row => this.decode(row)); }
  getControl() { return this.db.prepare("SELECT value FROM settings WHERE key='control'").get().value; }
  setControl(mode) {
    if (!MODES.has(mode)) fail('INVALID_CONTROL', 'Control must be running, paused, or stopped');
    return this.transaction(() => { this.db.prepare("UPDATE settings SET value=? WHERE key='control'").run(mode); this.event(null, 'control', { mode }); return mode; });
  }
  requireLease(taskId, workerId, fence) {
    const row = this.db.prepare('SELECT * FROM tasks WHERE id=?').get(id(taskId));
    if (!row || row.status !== 'leased' || row.worker !== id(workerId) || row.fence !== fence || row.lease_until <= this.now()) fail('STALE_LEASE', 'Lease is expired or belongs to another worker/fence');
    return row;
  }
  releaseUndispatchedAllowance(taskId,fence=null) {
    const clause=fence===null?'':' AND fence=?',parameters=fence===null?[taskId]:[taskId,fence];
    this.db.prepare(`UPDATE attempt_allowances SET state='cancelled',charged_units=0,updated=? WHERE state='reserved' AND attempt_id IN (SELECT id FROM attempts WHERE task_id=?${clause} AND state='reserved')`).run(this.now(),...parameters);
    this.db.prepare(`UPDATE attempt_allowances SET state='unknown',updated=? WHERE state='dispatched' AND attempt_id IN (SELECT id FROM attempts WHERE task_id=?${clause} AND state='dispatched')`).run(this.now(),...parameters);
  }
  checkAllowance(row,snapshot,additionalUnits=snapshot.reservedUnits) {
    const held="state IN ('reserved','dispatched','unknown')";
    const flow=this.db.prepare('SELECT coalesce(sum(charged_units),0) AS n FROM attempt_allowances WHERE workflow_id=?').get(row.workflow_id).n;
    const day=this.db.prepare('SELECT coalesce(sum(charged_units),0) AS n FROM attempt_allowances WHERE created>=?').get(this.now()-86400000).n;
    const week=this.db.prepare('SELECT coalesce(sum(charged_units),0) AS n FROM attempt_allowances WHERE created>=?').get(this.now()-7*86400000).n;
    if(flow+additionalUnits>ALLOWANCE_LIMITS.workflowUnits||day+additionalUnits>ALLOWANCE_LIMITS.dayUnits||week+additionalUnits>ALLOWANCE_LIMITS.weekUnits)fail('ALLOWANCE_LIMIT','A fixed workflow, rolling-day or rolling-seven-day allowance ceiling prevents dispatch');
    // Exact usage settled before this snapshot is already reflected by the
    // provider. Later settlements must still be counted when reusing a snapshot.
    const outstanding=this.db.prepare(`SELECT coalesce(sum(charged_units),0) AS n FROM attempt_allowances WHERE ${held} OR (state='settled' AND updated>=?)`).get(snapshot.observedAt).n;
    if(!snapshot.unlimited&&outstanding+additionalUnits>snapshot.remainingUnits)fail('ALLOWANCE_EXHAUSTED','Fresh provider remaining allowance cannot cover unresolved holds and new work');
  }
  claim(workerId, { leaseMs = 120000 } = {}) {
    id(workerId); if (!Number.isInteger(leaseMs) || leaseMs < 1 || leaseMs > 120000) fail('INVALID_LIMIT', 'Lease must be 1–120000 ms');
    return this.transaction(() => {
      if (this.getControl() !== 'running') return null;
      // Admission is serialized across processes, not merely within one worker.
      // Expired leases must be reconciled by recover() before another claim.
      if (this.db.prepare("SELECT count(*) AS n FROM tasks WHERE status='leased'").get().n >= 1) return null;
      const row = this.db.prepare("SELECT * FROM tasks WHERE status='pending' AND attempts<2 AND not_before<=? ORDER BY created,id").all(this.now()).find(candidate => {
        if (candidate.attempts >= stageLimit(candidate)) return false;
        const previous = JSON.parse(candidate.body).constraints?.previousTaskId;
        if (previous == null) return true;
        return this.db.prepare('SELECT status FROM tasks WHERE id=?').get(String(previous))?.status === 'complete';
      });
      if (!row) return null;
      const until = this.now() + leaseMs;
      this.db.prepare("UPDATE tasks SET status='leased',attempts=attempts+1,fence=fence+1,worker=?,lease_until=?,updated=? WHERE id=?").run(workerId, until, this.now(), row.id);
      this.event(row.id, 'leased', { workerId, fence: row.fence + 1 });
      return this.getTask(row.id);
    });
  }
  heartbeat(taskId, workerId, fence, leaseMs = 120000) {
    if (!Number.isInteger(leaseMs) || leaseMs < 1 || leaseMs > 120000) fail('INVALID_LIMIT', 'Invalid heartbeat lease');
    return this.transaction(() => { this.requireLease(taskId, workerId, fence); const until = this.now() + leaseMs; this.db.prepare('UPDATE tasks SET lease_until=?,updated=? WHERE id=?').run(until, this.now(), taskId); return until; });
  }
  finish(taskId, workerId, fence, { status, result = null, error = null, nextTask = null } = {}) {
    if (!TERMINAL.has(status)) fail('INVALID_STATUS', 'Finish requires an explicit terminal state');
    const resultText = result == null ? null : json(result), errorText = error == null ? null : String(error).slice(0, 4000);
    return this.transaction(() => {
      this.requireLease(taskId, workerId, fence);
      if (nextTask !== null) {
        if (status !== 'complete' || !nextTask || typeof nextTask !== 'object' || nextTask.constraints?.previousTaskId !== taskId) fail('INVALID_DEPENDENCY', 'Atomic handoff requires a completed parent and matching previousTaskId');
        const nextId = id(nextTask.id), nextWorkflow = id(nextTask.workflowId ?? nextId), body = json(nextTask);
        if (nextId === taskId) fail('INVALID_DEPENDENCY', 'A task cannot depend on itself');
        const old = this.db.prepare('SELECT body FROM tasks WHERE id=?').get(nextId);
        if (old && old.body !== body) fail('TASK_CONFLICT', 'Next task identifier already binds different inputs');
        if (!old) {
          this.db.prepare('INSERT INTO tasks(id,workflow_id,body,created,updated) VALUES (?,?,?,?,?)').run(nextId, nextWorkflow, body, this.now(), this.now());
          this.event(nextId, 'queued', { previousTaskId: taskId });
        }
      }
      this.db.prepare('UPDATE tasks SET status=?,result=?,error=?,worker=NULL,lease_until=NULL,updated=? WHERE id=?').run(status, resultText, errorText, this.now(), taskId);
      this.releaseUndispatchedAllowance(taskId,fence);
      this.db.prepare("UPDATE attempts SET state='unknown',updated=? WHERE task_id=? AND fence=? AND state='dispatched'").run(this.now(), taskId, fence);
      this.db.prepare("UPDATE attempts SET state='cancelled',charged_usd=0,updated=? WHERE task_id=? AND fence=? AND state='reserved'").run(this.now(), taskId, fence);
      this.event(taskId, 'finished', { status, fence });
      return this.getTask(taskId);
    });
  }
  cancel(taskId, { onlyUndispatchedPending = false } = {}) {
    return this.transaction(() => {
      const row = this.db.prepare('SELECT * FROM tasks WHERE id=?').get(id(taskId));
      if (!row) fail('TASK_MISSING', 'Task does not exist');
      // Optional worker quarantine is a conditional mutation inside the same
      // write transaction as cancellation; another connection cannot claim or
      // dispatch between the eligibility check and the fence change.
      if (onlyUndispatchedPending && (row.status !== 'pending' ||
        this.db.prepare("SELECT count(*) AS n FROM attempts WHERE task_id=? AND state IN ('dispatched','unknown','settled')").get(taskId).n ||
        this.db.prepare("SELECT count(*) AS n FROM events WHERE task_id=? AND kind='dispatched'").get(taskId).n ||
        this.db.prepare("SELECT count(*) AS n FROM attempt_allowances WHERE task_id=? AND state IN ('dispatched','unknown','settled')").get(taskId).n)) return null;
      if (TERMINAL.has(row.status)) return this.getTask(taskId);
      this.db.prepare("UPDATE tasks SET status='cancelled',worker=NULL,lease_until=NULL,fence=fence+1,updated=? WHERE id=?").run(this.now(), taskId);
      this.releaseUndispatchedAllowance(taskId);
      this.db.prepare("UPDATE attempts SET state='unknown',updated=? WHERE task_id=? AND state='dispatched'").run(this.now(), taskId);
      this.db.prepare("UPDATE attempts SET state='cancelled',charged_usd=0,updated=? WHERE task_id=? AND state='reserved'").run(this.now(), taskId);
      this.event(taskId, 'cancelled'); return this.getTask(taskId);
    });
  }
  retry(taskId, workerId, fence, { notBefore = this.now(), error = null } = {}) {
    finite(notBefore, 'notBefore');
    return this.transaction(() => {
      const row = this.requireLease(taskId, workerId, fence);
      if (row.attempts >= stageLimit(row)) fail('ATTEMPT_LIMIT', 'Stage acquisition limit exhausted');
      const unknown = this.db.prepare("SELECT count(*) AS n FROM attempts WHERE task_id=? AND state IN ('dispatched','unknown')").get(taskId).n;
      if (unknown) fail('UNKNOWN_BILLING', 'Ambiguous dispatched requests cannot be retried automatically');
      if(this.db.prepare("SELECT count(*) AS n FROM attempt_allowances WHERE task_id=? AND state IN ('dispatched','unknown')").get(taskId).n)fail('UNKNOWN_ALLOWANCE','Ambiguous allowance usage cannot be retried automatically');
      this.releaseUndispatchedAllowance(taskId);
      this.db.prepare("UPDATE attempts SET state='cancelled',charged_usd=0,updated=? WHERE task_id=? AND state='reserved'").run(this.now(), taskId);
      this.db.prepare("UPDATE tasks SET status='pending',worker=NULL,lease_until=NULL,not_before=?,error=?,updated=? WHERE id=?").run(notBefore, error == null ? null : String(error).slice(0, 4000), this.now(), taskId);
      this.event(taskId, 'retry-scheduled', { notBefore, fence }); return this.getTask(taskId);
    });
  }
  retryFailed(taskId, { operatorId, evidence, notBefore = this.now() } = {}) {
    id(operatorId); finite(notBefore, 'notBefore');
    if (typeof evidence !== 'string' || !evidence.trim() || evidence.length > 4000) fail('REVIEW_REQUIRED', 'A bounded operator explanation is required');
    return this.transaction(() => {
      const row = this.db.prepare('SELECT * FROM tasks WHERE id=?').get(id(taskId));
      if (!row || !['failed', 'needs-human'].includes(row.status)) fail('INVALID_STATUS', 'Only a failed or needs-human task can be explicitly retried');
      if (row.attempts >= stageLimit(row)) fail('ATTEMPT_LIMIT', 'Stage attempt limit remains binding after human review');
      if (this.db.prepare("SELECT count(*) AS n FROM attempts WHERE task_id=? AND state IN ('dispatched','unknown')").get(taskId).n) fail('UNKNOWN_BILLING', 'Ambiguous requests require separate billing reconciliation before retry');
      if(this.db.prepare("SELECT count(*) AS n FROM attempt_allowances WHERE task_id=? AND state IN ('dispatched','unknown')").get(taskId).n)fail('UNKNOWN_ALLOWANCE','Ambiguous allowance usage requires separate reconciliation before retry');
      this.db.prepare("UPDATE tasks SET status='pending',worker=NULL,lease_until=NULL,not_before=?,updated=? WHERE id=?").run(notBefore, this.now(), taskId);
      this.event(taskId, 'operator-retry', { operatorId, evidence, notBefore });
      return this.getTask(taskId);
    });
  }
  recover() {
    return this.transaction(() => {
      const rows = this.db.prepare("SELECT * FROM tasks WHERE status='leased' AND lease_until<=?").all(this.now());
      for (const row of rows) {
        const sent = this.db.prepare("SELECT count(*) AS n FROM attempts WHERE task_id=? AND fence=? AND state IN ('dispatched','unknown','settled')").get(row.id, row.fence).n;
        const status = sent || row.attempts >= stageLimit(row) ? 'needs-human' : 'pending';
        this.db.prepare('UPDATE tasks SET status=?,worker=NULL,lease_until=NULL,updated=?,error=? WHERE id=?').run(status, this.now(), sent ? 'Ambiguous dispatched attempt; reconcile without automatic resubmission' : row.attempts >= stageLimit(row) ? 'Stage attempt limit exhausted' : null, row.id);
        this.releaseUndispatchedAllowance(row.id);
        this.db.prepare("UPDATE attempts SET state='unknown',updated=? WHERE task_id=? AND state='dispatched'").run(this.now(), row.id);
        this.db.prepare("UPDATE attempts SET state='cancelled',charged_usd=0,updated=? WHERE task_id=? AND state='reserved'").run(this.now(), row.id);
        this.event(row.id, 'recovered', { status, fence: row.fence });
      }
      return rows.length;
    });
  }
  reserve(taskId, workerId, fence, { usd = 0, requestLimit = 0, maxUsd = 0, hourUsd = 0, dayUsd = 0, weekUsd = 0, monthUsd = 0, allowance = null, allowanceHeadroomUnits = 0 } = {}) {
    for (const [name, value] of Object.entries({ usd, requestLimit, maxUsd, hourUsd, dayUsd, weekUsd, monthUsd })) finite(value, name);
    if (!Number.isInteger(requestLimit)) fail('INVALID_LIMIT', 'Request limit must be an integer');
    units(allowanceHeadroomUnits,'allowanceHeadroomUnits');
    if(allowanceHeadroomUnits>ALLOWANCE_LIMITS.workflowUnits||(allowance===null&&allowanceHeadroomUnits!==0))fail('INVALID_ALLOWANCE','Allowance headroom requires a bounded allowance reservation');
    return this.transaction(() => {
      const row = this.requireLease(taskId, workerId, fence);
      if (this.getControl() !== 'running') fail('PAUSED', 'Admission is paused or stopped');
      if (this.db.prepare("SELECT value FROM settings WHERE key='budgetIncident'").get().value === 'true') fail('BUDGET_INCIDENT', 'Usage exceeded a reservation; operator investigation required');
      if(this.db.prepare("SELECT value FROM settings WHERE key='allowanceIncident'").get().value==='true')fail('ALLOWANCE_INCIDENT','Allowance usage exceeded its reservation; operator investigation required');
      const snapshot=allowance===null?null:allowanceSnapshot(allowance,this.now());
      const workflow = this.db.prepare('SELECT count(*) AS requests,coalesce(sum(charged_usd),0) AS usd FROM attempts WHERE workflow_id=?').get(row.workflow_id);
      const stage = this.db.prepare('SELECT count(*) AS requests FROM attempts WHERE task_id=?').get(taskId);
      const hour = this.db.prepare('SELECT coalesce(sum(charged_usd),0) AS usd FROM attempts WHERE created>=?').get(this.now() - 3600000).usd;
      const day = this.db.prepare('SELECT coalesce(sum(charged_usd),0) AS usd FROM attempts WHERE created>=?').get(this.now() - 86400000).usd;
      const week = this.db.prepare('SELECT coalesce(sum(charged_usd),0) AS usd FROM attempts WHERE created>=?').get(this.now() - 7 * 86400000).usd;
      const date = new Date(this.now()), monthStart = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1);
      const month = this.db.prepare('SELECT coalesce(sum(charged_usd),0) AS usd FROM attempts WHERE created>=?').get(monthStart).usd;
      if (workflow.requests + 1 > requestLimit || stage.requests >= stageLimit(row) || workflow.usd + usd > maxUsd || hour + usd > hourUsd || day + usd > dayUsd || week + usd > weekUsd || month + usd > monthUsd) fail('BUDGET_LIMIT', 'A persisted workflow, stage, hourly, daily, rolling-seven-day, or UTC-calendar-month ceiling prevents dispatch');
      if(snapshot)this.checkAllowance(row,snapshot);
      if(snapshot&&allowanceHeadroomUnits>0) {
        try{this.checkAllowance(row,{...snapshot,reservedUnits:snapshot.reservedUnits+allowanceHeadroomUnits});}
        catch(error){if(['ALLOWANCE_LIMIT','ALLOWANCE_EXHAUSTED'].includes(error.code))fail('ALLOWANCE_DESIGN_CAPACITY_RESERVED','Allowance capacity is protected for the design phase');throw error;}
      }
      const attemptId = randomUUID();
      this.db.prepare("INSERT INTO attempts(id,task_id,workflow_id,worker,fence,state,reserve_usd,charged_usd,created,updated) VALUES (?,?,?,?,?,'reserved',?,?,?,?)").run(attemptId, taskId, row.workflow_id, workerId, fence, usd, usd, this.now(), this.now());
      if(snapshot){
        this.db.prepare("INSERT INTO attempt_allowances(attempt_id,task_id,workflow_id,state,reserved_units,charged_units,remaining_units,observed_at,expires_at,period_key,unlimited,created,updated) VALUES (?,?,?,'reserved',?,?,?,?,?,?,?,?,?)").run(attemptId,taskId,row.workflow_id,snapshot.reservedUnits,snapshot.reservedUnits,snapshot.remainingUnits??null,snapshot.observedAt,snapshot.expiresAt,snapshot.periodKey,snapshot.unlimited?1:0,this.now(),this.now());
        this.event(taskId,'allowance-reserved',{attemptId,reservedUnits:snapshot.reservedUnits,periodKey:snapshot.periodKey});
      }
      this.event(taskId, 'reserved', { attemptId, usd }); return attemptId;
    });
  }
  requireAttempt(attemptId, workerId, fence) {
    const attempt = this.db.prepare('SELECT * FROM attempts WHERE id=?').get(id(attemptId));
    if (!attempt || attempt.worker !== workerId || attempt.fence !== fence) fail('STALE_LEASE', 'Attempt does not belong to this worker/fence');
    this.requireLease(attempt.task_id, workerId, fence); return attempt;
  }
  dispatch(attemptId, workerId, fence, {beforeDispatch} = {}) {
    if(beforeDispatch!==undefined&&(typeof beforeDispatch!=='function'||beforeDispatch.constructor?.name==='AsyncFunction'))fail('INVALID_DISPATCH_HOOK','The trusted beforeDispatch hook must be synchronous');
    return this.transaction(() => {
      const attempt = this.requireAttempt(attemptId, workerId, fence);
      if (this.getControl() !== 'running') fail('PAUSED', 'Admission is paused or stopped');
      if (attempt.state !== 'reserved') fail('ATTEMPT_STATE', 'Only a reserved attempt can be dispatched once');
      if(this.db.prepare("SELECT value FROM settings WHERE key='allowanceIncident'").get().value==='true')fail('ALLOWANCE_INCIDENT','Allowance reservation breach requires reconciliation before dispatch');
      const storedAllowance=this.db.prepare('SELECT * FROM attempt_allowances WHERE attempt_id=?').get(attemptId);
      if(storedAllowance){
        const snapshot=allowanceSnapshot({reservedUnits:storedAllowance.reserved_units,remainingUnits:storedAllowance.remaining_units,
          observedAt:storedAllowance.observed_at,expiresAt:storedAllowance.expires_at,periodKey:storedAllowance.period_key,unlimited:storedAllowance.unlimited===1},this.now());
        this.checkAllowance(attempt,snapshot,0);
      }
      // Trusted host-only coordination. Its marker and dispatch commit together;
      // a failure rolls back both, before any external provider operation.
      if(beforeDispatch){
        const result=beforeDispatch({attemptId:attempt.id,taskId:attempt.task_id,workflowId:attempt.workflow_id});
        if(result&&typeof result.then==='function')fail('INVALID_DISPATCH_HOOK','The trusted beforeDispatch hook cannot return asynchronous work');
      }
      this.db.prepare("UPDATE attempts SET state='dispatched',updated=? WHERE id=?").run(this.now(), attemptId);
      this.db.prepare("UPDATE attempt_allowances SET state='dispatched',updated=? WHERE attempt_id=? AND state='reserved'").run(this.now(),attemptId);
      this.event(attempt.task_id, 'dispatched', { attemptId }); return attemptId;
    });
  }
  settle(attemptId, workerId, fence, { reportedUsd = null, reportedAllowanceUnits = null, estimatedAllowanceUnits = null } = {}) {
    if (reportedUsd !== null) finite(reportedUsd, 'reportedUsd');
    if(reportedAllowanceUnits!==null)units(reportedAllowanceUnits,'reportedAllowanceUnits');
    if(estimatedAllowanceUnits!==null)units(estimatedAllowanceUnits,'estimatedAllowanceUnits');
    return this.transaction(() => {
      const attempt = this.requireAttempt(attemptId, workerId, fence);
      if (attempt.state !== 'dispatched') fail('ATTEMPT_STATE', 'Only a dispatched attempt can be settled once');
      const state = reportedUsd === null ? 'unknown' : 'settled', charged = reportedUsd ?? attempt.reserve_usd;
      this.db.prepare('UPDATE attempts SET state=?,reported_usd=?,charged_usd=?,updated=? WHERE id=?').run(state, reportedUsd, charged, this.now(), attemptId);
      if (reportedUsd !== null && reportedUsd > attempt.reserve_usd) this.db.prepare("UPDATE settings SET value='true' WHERE key='budgetIncident'").run();
      const allowance=this.db.prepare('SELECT * FROM attempt_allowances WHERE attempt_id=?').get(attemptId);
      if(allowance){
        const allowanceState=reportedAllowanceUnits===null?'unknown':'settled',chargedUnits=reportedAllowanceUnits??allowance.reserved_units;
        this.db.prepare('UPDATE attempt_allowances SET state=?,reported_units=?,estimated_units=?,charged_units=?,updated=? WHERE attempt_id=?').run(allowanceState,reportedAllowanceUnits,estimatedAllowanceUnits,chargedUnits,this.now(),attemptId);
        if((reportedAllowanceUnits!==null&&reportedAllowanceUnits>allowance.reserved_units)||(estimatedAllowanceUnits!==null&&estimatedAllowanceUnits>allowance.reserved_units)){
          this.db.prepare("UPDATE settings SET value='true' WHERE key='allowanceIncident'").run();
          this.event(attempt.task_id,'allowance-reservation-breach',{attemptId,reservedUnits:allowance.reserved_units,reportedAllowanceUnits,estimatedAllowanceUnits});
        }
        this.event(attempt.task_id,'allowance-'+allowanceState,{attemptId,reportedAllowanceUnits,estimatedAllowanceUnits});
      }else if(reportedAllowanceUnits!==null||estimatedAllowanceUnits!==null)fail('ALLOWANCE_RESERVATION_MISSING','Allowance usage cannot settle without its original reservation');
      this.event(attempt.task_id, state, { attemptId, reportedUsd }); return this.ledger(attempt.task_id);
    });
  }
  ledger(taskId) {
    const rows = taskId ? this.db.prepare('SELECT * FROM attempts WHERE task_id=? ORDER BY created,id').all(id(taskId)) : this.db.prepare('SELECT * FROM attempts ORDER BY created,id').all();
    return { requests: rows.length, reservedUsd: rows.reduce((s, a) => s + a.charged_usd, 0),
      reportedUsd: rows.reduce((s, a) => s + (a.reported_usd ?? 0), 0),
      unknownBillingRequests: rows.filter(a => a.state === 'dispatched' || a.state === 'unknown').length,
      budgetIncident: this.db.prepare("SELECT value FROM settings WHERE key='budgetIncident'").get().value === 'true', attempts: rows };
  }
  allowanceLedger(taskId) {
    const rows=taskId?this.db.prepare('SELECT * FROM attempt_allowances WHERE task_id=? ORDER BY created,attempt_id').all(id(taskId)):
      this.db.prepare('SELECT * FROM attempt_allowances ORDER BY created,attempt_id').all();
    const sum=(items,key)=>items.reduce((total,row)=>total+(row[key]??0),0),unknown=rows.filter(row=>['dispatched','unknown'].includes(row.state));
    return {requests:rows.length,reservedUnits:sum(rows,'charged_units'),reportedUnits:sum(rows,'reported_units'),estimatedUnits:sum(rows,'estimated_units'),
      unknownAllowanceRequests:unknown.length,unknownUnits:sum(unknown,'charged_units'),pendingUnits:sum(rows.filter(row=>row.state==='reserved'),'charged_units'),
      rollingDayUnits:sum(rows.filter(row=>row.created>=this.now()-86400000),'charged_units'),
      rollingWeekUnits:sum(rows.filter(row=>row.created>=this.now()-7*86400000),'charged_units'),
      incident:this.db.prepare("SELECT value FROM settings WHERE key='allowanceIncident'").get().value==='true',limits:ALLOWANCE_LIMITS,attempts:rows};
  }
  backfillLegacyAllowance({attemptId,model,reservedUnits,evidence}={}) {
    id(attemptId);units(reservedUnits,'reservedUnits');
    if(reservedUnits===0)fail('INVALID_ALLOWANCE_BACKFILL','Legacy free requests require a positive conservative allowance hold');
    if(typeof model!=='string'||!/^free\/[A-Za-z0-9][A-Za-z0-9_.:-]{0,194}$/.test(model))fail('INVALID_ALLOWANCE_BACKFILL','Legacy allowance backfill is restricted to exact free model IDs');
    const evidenceText=json(evidence);
    if(evidence==null||(typeof evidence==='string'?!evidence.trim():typeof evidence!=='object'||Array.isArray(evidence)||Object.keys(evidence).length===0)||Buffer.byteLength(evidenceText)>4000)fail('INVALID_ALLOWANCE_BACKFILL','Bounded dispatch/model provenance is required');
    return this.transaction(()=>{
      const attempt=this.db.prepare('SELECT * FROM attempts WHERE id=?').get(attemptId);
      if(!attempt||!['dispatched','unknown','settled'].includes(attempt.state)||!this.events(attempt.task_id).some(e=>e.kind==='dispatched'&&e.detail.attemptId===attemptId))fail('INVALID_ALLOWANCE_BACKFILL','Only a durably dispatched original attempt may receive a legacy hold');
      const old=this.db.prepare('SELECT * FROM attempt_allowances WHERE attempt_id=?').get(attemptId);
      if(old){if(!old.legacy||old.model!==model||old.reserved_units!==reservedUnits||old.evidence!==evidenceText)fail('ALLOWANCE_BACKFILL_CONFLICT','Existing allowance history cannot be replaced');return this.allowanceLedger(attempt.task_id);}
      this.db.prepare("INSERT INTO attempt_allowances(attempt_id,task_id,workflow_id,state,reserved_units,charged_units,period_key,model,evidence,legacy,created,updated) VALUES (?,?,?,'unknown',?,?,'legacy-unresolved',?,?,1,?,?)").run(attemptId,attempt.task_id,attempt.workflow_id,reservedUnits,reservedUnits,model,evidenceText,attempt.created,this.now());
      this.event(attempt.task_id,'allowance-legacy-backfilled',{attemptId,model,reservedUnits,evidence});return this.allowanceLedger(attempt.task_id);
    });
  }
}
