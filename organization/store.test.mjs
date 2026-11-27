import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, symlinkSync, writeFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OrgStore } from './store.mjs';

function setup(t) {
  const root = mkdtempSync(join(tmpdir(), 'roof-org-store-'));
  let now = 100000;
  const store = new OrgStore(join(root, 'state'), { now: () => now });
  t.after(() => { try { store.close(); } catch {} rmSync(root, { recursive: true, force: true }); });
  return { root, store, advance: n => { now += n; }, clock: () => now };
}
const task = (id = 'task1', workflowId = 'workflow1') => ({ id, workflowId, role: 'engineering', sourceRevision: 'revision-a', inputHashes: [] });
const limits = { usd: 0.5, requestLimit: 4, maxUsd: 1, hourUsd: 1, dayUsd: 1, weekUsd: 1, monthUsd: 1 };

test('store starts paused; task identifiers bind immutable input and duplicate enqueue is idempotent', t => {
  const { store } = setup(t);
  assert.equal(store.getControl(), 'paused');
  assert.equal(store.enqueue(task()).status, 'pending');
  assert.equal(store.enqueue(task()).id, 'task1');
  assert.throws(() => store.enqueue({ ...task(), sourceRevision: 'changed' }), { code: 'TASK_CONFLICT' });
  assert.equal(store.listTasks().length, 1);
  assert.equal(store.claim('worker'), null);
  store.setControl('running');
  const lease = store.claim('worker');
  assert.equal(lease.fence, 1);
  assert.equal(store.claim('another-worker'), null);
  assert.throws(() => store.finish(lease.id, 'another-worker', lease.fence, { status: 'complete' }), { code: 'STALE_LEASE' });
  assert.equal(store.finish(lease.id, 'worker', lease.fence, { status: 'complete', result: { valid: true } }).status, 'complete');
  assert.ok(store.events('task1').some(e => e.kind === 'finished'));
});

test('expired leases are fenced and undispatched recovery has a two-acquisition ceiling', t => {
  const { store, advance } = setup(t);
  store.enqueue(task()); store.setControl('running');
  const first = store.claim('first', { leaseMs: 10 });
  advance(11);
  assert.throws(() => store.heartbeat(first.id, 'first', first.fence), { code: 'STALE_LEASE' });
  assert.equal(store.recover(), 1);
  const second = store.claim('second', { leaseMs: 10 });
  assert.equal(second.fence, first.fence + 1);
  assert.throws(() => store.finish(first.id, 'first', first.fence, { status: 'complete' }), { code: 'STALE_LEASE' });
  advance(11); store.recover();
  assert.equal(store.getTask(first.id).status, 'needs-human');
  assert.equal(store.claim('third'), null);
});

test('pre-send reservations are released on crash but dispatched uncertainty survives restart', t => {
  const { store, advance, root, clock } = setup(t);
  store.enqueue(task('not-sent')); store.enqueue(task('sent')); store.setControl('running');
  const a = store.claim('worker', { leaseMs: 10 });
  store.reserve(a.id, 'worker', a.fence, limits);
  advance(11); store.recover();
  assert.equal(store.getTask(a.id).status, 'pending');
  assert.equal(store.ledger(a.id).reservedUsd, 0);
  // Complete the recovered pre-send task locally to isolate the sent task.
  const recovered = store.claim('worker'); store.finish(recovered.id, 'worker', recovered.fence, { status: 'complete' });
  const b = store.claim('worker', { leaseMs: 10 });
  const attempt = store.reserve(b.id, 'worker', b.fence, limits);
  store.dispatch(attempt, 'worker', b.fence);
  advance(11); store.close();
  const reopened = new OrgStore(join(root, 'state'), { now: clock });
  try {
    reopened.recover();
    assert.equal(reopened.getTask(b.id).status, 'needs-human');
    assert.equal(reopened.ledger(b.id).unknownBillingRequests, 1);
    assert.equal(reopened.ledger(b.id).reservedUsd, 0.5);
    assert.equal(reopened.claim('new-worker'), null);
    assert.throws(() => reopened.settle(attempt, 'worker', b.fence, { reportedUsd: 0 }), { code: 'STALE_LEASE' });
  } finally { reopened.close(); }
});

test('budgets are atomic across SQLite connections and unknown billing never becomes free', t => {
  const { store, root, clock } = setup(t);
  store.enqueue(task('a', 'one')); store.enqueue(task('b', 'two')); store.setControl('running');
  const other = new OrgStore(join(root, 'state'), { now: clock });
  try {
    const a = store.claim('first');
    assert.equal(other.claim('second'), null, 'Global active lease ceiling applies across SQLite connections');
    assert.throws(() => store.reserve(a.id, 'first', a.fence), { code: 'BUDGET_LIMIT' });
    const attempt = store.reserve(a.id, 'first', a.fence, { ...limits, usd: 0.75 });
    store.dispatch(attempt, 'first', a.fence);
    store.settle(attempt, 'first', a.fence, {});
    assert.equal(other.ledger().reservedUsd, 0.75);
    assert.equal(other.ledger().unknownBillingRequests, 1);
    assert.throws(() => store.dispatch(attempt, 'first', a.fence), { code: 'ATTEMPT_STATE' });
    assert.throws(() => store.reserve(a.id, 'first', a.fence, { ...limits, usd: -1 }), { code: 'INVALID_LIMIT' });
    store.finish(a.id, 'first', a.fence, { status: 'needs-human' });
    const b = other.claim('second');
    assert.notEqual(a.id, b.id);
    assert.throws(() => other.reserve(b.id, 'second', b.fence, { ...limits, usd: 0.5 }), { code: 'BUDGET_LIMIT' });
  } finally { other.close(); }
});

test('known usage settles cost while reservation breach blocks all further admission', t => {
  const { store } = setup(t);
  store.enqueue(task()); store.setControl('running');
  const lease = store.claim('worker');
  const attempt = store.reserve(lease.id, 'worker', lease.fence, limits);
  store.dispatch(attempt, 'worker', lease.fence);
  const ledger = store.settle(attempt, 'worker', lease.fence, { reportedUsd: 0.6 });
  assert.equal(ledger.reportedUsd, 0.6);
  assert.equal(ledger.unknownBillingRequests, 0);
  assert.equal(ledger.budgetIncident, true);
  assert.throws(() => store.reserve(lease.id, 'worker', lease.fence, limits), { code: 'BUDGET_INCIDENT' });
});

test('cancel fences late completion and preserves only sent reservations', t => {
  const { store } = setup(t);
  store.enqueue(task()); store.setControl('running');
  const lease = store.claim('worker');
  const sent = store.reserve(lease.id, 'worker', lease.fence, { ...limits, usd: 0.3 });
  const notSent = store.reserve(lease.id, 'worker', lease.fence, { ...limits, usd: 0.2 });
  store.dispatch(sent, 'worker', lease.fence);
  store.cancel(lease.id);
  const ledger = store.ledger(lease.id);
  assert.equal(ledger.reservedUsd, 0.3);
  assert.equal(ledger.attempts.find(a => a.id === notSent).state, 'cancelled');
  assert.equal(ledger.unknownBillingRequests, 1);
  assert.throws(() => store.finish(lease.id, 'worker', lease.fence, { status: 'complete' }), { code: 'STALE_LEASE' });
});

test('private content-addressed artifacts reject traversal, symlinks and tampering', t => {
  const { store, root } = setup(t);
  const artifact = store.putArtifact(Buffer.from('private synthetic fixture'));
  assert.equal(store.putArtifact('private synthetic fixture').hash, artifact.hash);
  assert.equal(store.readArtifact(artifact.hash).toString(), 'private synthetic fixture');
  assert.throws(() => store.readArtifact('../outside'), { code: 'INVALID_HASH' });
  assert.equal(statSync(join(root, 'state', 'organization.sqlite')).mode & 0o777, 0o600);
  assert.equal(statSync(join(root, 'state')).mode & 0o777, 0o700);
  writeFileSync(join(root, 'state', 'artifacts', artifact.hash), 'tampered');
  assert.throws(() => store.readArtifact(artifact.hash), { code: 'ARTIFACT_CORRUPT' });
  const linkedHash = 'a'.repeat(64);
  symlinkSync(join(root, 'outside'), join(root, 'state', 'artifacts', linkedHash));
  assert.throws(() => store.readArtifact(linkedHash), { code: 'UNSAFE_PATH' });
  symlinkSync(join(root, 'state'), join(root, 'linked'));
  assert.throws(() => new OrgStore(join(root, 'linked')), { code: 'UNSAFE_PATH' });
});

test('dependent tasks cannot run early and atomic handoff rolls back on conflicting input', t => {
  const { store } = setup(t);
  const next = { ...task('next'), constraints: { previousTaskId: 'parent' } };
  store.enqueue(next); store.enqueue(task('parent')); store.setControl('running');
  const lease = store.claim('worker');
  assert.equal(lease.id, 'parent');
  assert.equal(store.claim('another'), null);
  assert.throws(() => store.finish('parent', 'worker', lease.fence, { status: 'complete', nextTask: { ...next, sourceRevision: 'conflict' } }), { code: 'TASK_CONFLICT' });
  assert.equal(store.getTask('parent').status, 'leased');
  store.finish('parent', 'worker', lease.fence, { status: 'complete', nextTask: next });
  assert.equal(store.claim('another').id, 'next');
});

test('retry checkpoints not-before and never retries ambiguous billing or exceeds stage attempts', t => {
  const { store, advance } = setup(t);
  store.enqueue(task()); store.setControl('running');
  const first = store.claim('worker');
  store.retry(first.id, 'worker', first.fence, { notBefore: 100100 });
  assert.equal(store.claim('worker'), null);
  advance(100);
  const second = store.claim('worker');
  assert.throws(() => store.retry(second.id, 'worker', second.fence), { code: 'ATTEMPT_LIMIT' });
  store.finish(second.id, 'worker', second.fence, { status: 'complete' });
  store.enqueue(task('ambiguous'));
  const lease = store.claim('worker');
  const attempt = store.reserve(lease.id, 'worker', lease.fence, limits);
  store.dispatch(attempt, 'worker', lease.fence);
  assert.throws(() => store.retry(lease.id, 'worker', lease.fence), { code: 'UNKNOWN_BILLING' });
});

test('monthly ceiling survives rolling day expiry and explicit retries preserve limits', t => {
  const { store, advance } = setup(t);
  store.enqueue(task('first', 'one')); store.setControl('running');
  const first = store.claim('worker');
  const attempt = store.reserve(first.id, 'worker', first.fence, { ...limits, usd: 0.75 });
  store.dispatch(attempt, 'worker', first.fence);
  store.settle(attempt, 'worker', first.fence, { reportedUsd: 0.75 });
  store.finish(first.id, 'worker', first.fence, { status: 'failed', error: 'Recoverable local validation issue' });
  assert.throws(() => store.retryFailed(first.id, { operatorId: 'owner' }), { code: 'REVIEW_REQUIRED' });
  store.retryFailed(first.id, { operatorId: 'owner', evidence: 'Fixed local parser; same input, no ambiguous billing' });
  const second = store.claim('worker');
  store.finish(second.id, 'worker', second.fence, { status: 'failed' });
  assert.throws(() => store.retryFailed(first.id, { operatorId: 'owner', evidence: 'Try again' }), { code: 'ATTEMPT_LIMIT' });
  advance(86400001);
  store.enqueue(task('new', 'two'));
  const later = store.claim('worker');
  assert.throws(() => store.reserve(later.id, 'worker', later.fence, { ...limits, usd: 0.5 }), { code: 'BUDGET_LIMIT' });
  assert.equal(store.ledger().reportedUsd, 0.75);
});


test('rolling-seven-day spending cap persists across daily windows and expires only after seven days', t => {
  const { store, advance } = setup(t);
  store.enqueue(task('old', 'old-flow')); store.setControl('running');
  const old = store.claim('worker');
  const a = store.reserve(old.id, 'worker', old.fence, { ...limits, usd: 0.75, monthUsd: 5 });
  store.dispatch(a, 'worker', old.fence);
  store.settle(a, 'worker', old.fence, { reportedUsd: 0.75 });
  store.finish(old.id, 'worker', old.fence, { status: 'complete' });
  advance(2 * 86400000);
  store.enqueue(task('new-week', 'new-flow'));
  const next = store.claim('worker');
  assert.throws(() => store.reserve(next.id, 'worker', next.fence, { ...limits, usd: 0.5, monthUsd: 5 }), { code: 'BUDGET_LIMIT' });
  store.finish(next.id, 'worker', next.fence, { status: 'complete' });
  advance(5 * 86400000 + 1);
  store.enqueue(task('after-week', 'last-flow'));
  const after = store.claim('worker');
  assert.ok(store.reserve(after.id, 'worker', after.fence, { ...limits, usd: 0.5, monthUsd: 5 }));
  assert.equal(store.ledger().reportedUsd, 0.75);
});

test('rejected results are terminal and cannot unblock dependent work', t => {
  const { store } = setup(t);
  store.enqueue(task('author'));
  store.enqueue({ ...task('child'), constraints: { previousTaskId: 'author' } });
  store.setControl('running');
  const lease = store.claim('worker');
  assert.equal(store.finish(lease.id, 'worker', lease.fence, { status: 'rejected' }).status, 'rejected');
  assert.equal(store.claim('worker'), null);
});

test('an explicit one-attempt task is never expanded to two acquisitions', t => {
  const dir=mkdtempSync(join(tmpdir(),'roof-org-one-attempt-'));let now=1000;const store=new OrgStore(dir,{now:()=>now});
  t.after(()=>{store.close();rmSync(dir,{recursive:true,force:true});});
  store.enqueue({id:'one',maxAttempts:1});store.setControl('running');const a=store.claim('w',{leaseMs:10});assert.ok(a);
  now+=11;store.recover();assert.equal(store.getTask('one').status,'needs-human');assert.equal(store.claim('next'),null);
  assert.throws(()=>store.retryFailed('one',{operatorId:'owner',evidence:'Retry requested'}),{code:'ATTEMPT_LIMIT'});
});
