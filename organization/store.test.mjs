import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, symlinkSync, writeFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OrgStore, ALLOWANCE_LIMITS } from './store.mjs';
import {createHash} from 'node:crypto';
import {POLICY as CALC_POLICY,ALLOWANCE_QUOTE_URL} from './allowance-calculation.mjs';
import {getModelCatalogEntry,textAllowanceReservationUnits} from './model-catalog.mjs';

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

const freeLimits={usd:0,requestLimit:64,maxUsd:20,hourUsd:20,dayUsd:20,weekUsd:20,monthUsd:80};
const snapshot=(clock,reservedUnits,extra={})=>({reservedUnits,remainingUnits:2000000000,observedAt:clock(),expiresAt:clock()+86400000,periodKey:'subscription-original',unlimited:false,...extra});
function freeTask(store,name,flow=name){store.enqueue(task(name,flow));store.setControl('running');return store.claim('allowance-worker');}
function reserveFree(store,lease,allowance){return store.reserve(lease.id,'allowance-worker',lease.fence,{...freeLimits,allowance});}
function completeFree(store,lease,attempt,usage={reportedUsd:0}){store.dispatch(attempt,'allowance-worker',lease.fence);store.settle(attempt,'allowance-worker',lease.fence,usage);store.finish(lease.id,'allowance-worker',lease.fence,{status:'complete'});}

test('allowance admission is atomic across connections and does not create a USD attempt on rejection',t=>{
  const {store,root,clock}=setup(t),lease=freeTask(store,'allowance-atomic');
  const other=new OrgStore(join(root,'state'),{now:clock});t.after(()=>other.close());
  const first=reserveFree(store,lease,snapshot(clock,600,{remainingUnits:1000}));
  assert.equal(other.allowanceLedger().reservedUnits,600);
  const before=JSON.stringify(other.ledger());
  assert.throws(()=>other.reserve(lease.id,'allowance-worker',lease.fence,{...freeLimits,allowance:snapshot(clock,500,{remainingUnits:1000})}),{code:'ALLOWANCE_EXHAUSTED'});
  assert.equal(JSON.stringify(other.ledger()),before);assert.equal(other.allowanceLedger().requests,1);
  assert.equal(other.allowanceLedger().attempts[0].attempt_id,first);
});

test('allowance snapshots validate freshness, expiry, integers and fixed caps even for unlimited subscriptions',t=>{
  const {store,clock,advance}=setup(t),lease=freeTask(store,'allowance-validate');
  for(const change of [{reservedUnits:0},{reservedUnits:1.1},{remainingUnits:-1},{reservedUnits:Number.MAX_SAFE_INTEGER+1},{unlimited:'true'},{workflowUnits:9999999999}])
    assert.throws(()=>reserveFree(store,lease,snapshot(clock,1,change)),{code:'INVALID_ALLOWANCE'});
  assert.throws(()=>reserveFree(store,lease,snapshot(clock,1,{observedAt:clock()-60001})),{code:'ALLOWANCE_SNAPSHOT_STALE'});
  assert.throws(()=>reserveFree(store,lease,snapshot(clock,1,{expiresAt:clock()})),{code:'ALLOWANCE_SNAPSHOT_STALE'});
  assert.throws(()=>reserveFree(store,lease,snapshot(clock,1,{observedAt:clock()+1})),{code:'ALLOWANCE_SNAPSHOT_STALE'});
  assert.throws(()=>reserveFree(store,lease,snapshot(clock,ALLOWANCE_LIMITS.workflowUnits+1,{unlimited:true,remainingUnits:null})),{code:'ALLOWANCE_LIMIT'});
  const attempt=reserveFree(store,lease,snapshot(clock,10));advance(60001);
  assert.throws(()=>store.dispatch(attempt,'allowance-worker',lease.fence),{code:'ALLOWANCE_SNAPSHOT_STALE'});
  assert.equal(store.ledger().attempts[0].state,'reserved');assert.equal(store.allowanceLedger().pendingUnits,10);
});

test('estimates and missing allowance usage retain full unknown holds while exact usage alone releases them',t=>{
  const {store,clock}=setup(t);let lease=freeTask(store,'estimated');
  let attempt=reserveFree(store,lease,snapshot(clock,1000));
  completeFree(store,lease,attempt,{reportedUsd:0,reportedAllowanceUnits:null,estimatedAllowanceUnits:12});
  assert.equal(store.ledger().unknownBillingRequests,0);assert.equal(store.allowanceLedger().unknownAllowanceRequests,1);
  assert.equal(store.allowanceLedger().reservedUnits,1000);assert.equal(store.allowanceLedger().estimatedUnits,12);assert.equal(store.allowanceLedger().reportedUnits,0);
  lease=freeTask(store,'exact');attempt=reserveFree(store,lease,snapshot(clock,1000));
  completeFree(store,lease,attempt,{reportedUsd:0,reportedAllowanceUnits:75,estimatedAllowanceUnits:40});
  assert.equal(store.allowanceLedger().reservedUnits,1075);assert.equal(store.allowanceLedger().reportedUnits,75);
  assert.equal(store.allowanceLedger('exact').unknownAllowanceRequests,0);
  assert.throws(()=>store.retryFailed('estimated',{operatorId:'owner',evidence:'Try again'}),{code:'INVALID_STATUS'});
});

test('subscription resets and restart do not release unknown allowance older than seven days',t=>{
  const {store,clock,advance,root}=setup(t),lease=freeTask(store,'old-period'),attempt=reserveFree(store,lease,snapshot(clock,900));
  completeFree(store,lease,attempt);advance(8*86400000);store.close();
  const reopened=new OrgStore(join(root,'state'),{now:clock});t.after(()=>reopened.close());
  const next=freeTask(reopened,'new-period');
  assert.throws(()=>reserveFree(reopened,next,snapshot(clock,200,{remainingUnits:1000,periodKey:'new-subscription-period'})),{code:'ALLOWANCE_EXHAUSTED'});
  assert.equal(reopened.allowanceLedger().unknownUnits,900);assert.equal(reopened.ledger().requests,1);
});

test('cancellation and expired recovery release only undispatched allowance reservations',t=>{
  const {store,clock,advance}=setup(t),lease=freeTask(store,'cancel-allowance');
  const sent=reserveFree(store,lease,snapshot(clock,600)),notSent=reserveFree(store,lease,snapshot(clock,300));store.dispatch(sent,'allowance-worker',lease.fence);store.cancel(lease.id);
  const ledger=store.allowanceLedger();assert.equal(ledger.reservedUnits,600);assert.equal(ledger.unknownUnits,600);assert.equal(ledger.attempts.find(a=>a.attempt_id===notSent).state,'cancelled');
  const recovered=freeTask(store,'recover-allowance'),held=reserveFree(store,recovered,snapshot(clock,200));advance(120001);store.recover();
  assert.equal(store.allowanceLedger().attempts.find(a=>a.attempt_id===held).state,'cancelled');assert.equal(store.allowanceLedger().reservedUnits,600);
});

test('allowance overrun records actual units and blocks all later admission without modifying USD billing',t=>{
  const {store,clock}=setup(t),lease=freeTask(store,'allowance-breach'),attempt=reserveFree(store,lease,snapshot(clock,100));
  store.dispatch(attempt,'allowance-worker',lease.fence);store.settle(attempt,'allowance-worker',lease.fence,{reportedUsd:0,reportedAllowanceUnits:101});
  assert.equal(store.allowanceLedger().incident,true);assert.equal(store.allowanceLedger().reportedUnits,101);assert.equal(store.ledger().budgetIncident,false);
  assert.throws(()=>store.reserve(lease.id,'allowance-worker',lease.fence,freeLimits),{code:'ALLOWANCE_INCIDENT'});
});

test('fresh finite allowance snapshots cannot be reused to overspend known settlements after observation',t=>{
  const {store,clock,advance}=setup(t),snap=snapshot(clock,600,{remainingUnits:1000}),lease=freeTask(store,'snapshot-first'),attempt=reserveFree(store,lease,snap);
  completeFree(store,lease,attempt,{reportedUsd:0,reportedAllowanceUnits:600});advance(1);
  const next=freeTask(store,'snapshot-next');
  assert.throws(()=>reserveFree(store,next,{...snap,reservedUnits:500}),{code:'ALLOWANCE_EXHAUSTED'});
  // A genuinely newer provider balance already incorporates that exact charge.
  assert.ok(reserveFree(store,next,snapshot(clock,400,{remainingUnits:400})));
});

test('legacy free backfill is idempotent, uses original chronology and preserves all existing USD records',t=>{
  const {store,clock,advance}=setup(t),lease=freeTask(store,'legacy-free');
  const attempt=store.reserve(lease.id,'allowance-worker',lease.fence,freeLimits);completeFree(store,lease,attempt,{reportedUsd:0});
  const before=JSON.stringify(store.ledger()),original=store.ledger().attempts[0].created;advance(9*86400000);
  const input={attemptId:attempt,model:'free/glm-5.3',reservedUnits:900,evidence:{source:'authenticated-model-catalog',event:'durable dispatch'}};
  store.backfillLegacyAllowance(input);store.backfillLegacyAllowance(input);
  assert.equal(store.allowanceLedger().requests,1);assert.equal(store.allowanceLedger().unknownUnits,900);assert.equal(store.allowanceLedger().attempts[0].created,original);
  assert.equal(JSON.stringify(store.ledger()),before);assert.equal(store.events().filter(e=>e.kind==='allowance-legacy-backfilled').length,1);
  assert.throws(()=>store.backfillLegacyAllowance({...input,reservedUnits:901}),{code:'ALLOWANCE_BACKFILL_CONFLICT'});
  assert.throws(()=>store.backfillLegacyAllowance({...input,model:'glm-5.3'}),{code:'INVALID_ALLOWANCE_BACKFILL'});
  assert.throws(()=>store.backfillLegacyAllowance({...input,reservedUnits:0}),{code:'INVALID_ALLOWANCE_BACKFILL'});
  const next=freeTask(store,'legacy-unsent'),unsent=store.reserve(next.id,'allowance-worker',next.fence,freeLimits);
  assert.throws(()=>store.backfillLegacyAllowance({...input,attemptId:unsent}),{code:'INVALID_ALLOWANCE_BACKFILL'});
});

test('fixed rolling day and week allowance ceilings remain independent of provider unlimited metadata',t=>{
  const {store,clock,advance}=setup(t);
  const amount=ALLOWANCE_LIMITS.workflowUnits,calls=ALLOWANCE_LIMITS.weekUnits/amount;
  for(let i=0;i<calls;i++){
    const lease=freeTask(store,'fixed-'+i),attempt=reserveFree(store,lease,snapshot(clock,amount,{unlimited:true,remainingUnits:null}));
    completeFree(store,lease,attempt,{reportedUsd:0,reportedAllowanceUnits:amount});
  }
  const day=freeTask(store,'day-limit');assert.throws(()=>reserveFree(store,day,snapshot(clock,1,{unlimited:true,remainingUnits:null})),{code:'ALLOWANCE_LIMIT'});store.finish(day.id,'allowance-worker',day.fence,{status:'complete'});
  advance(86400001);const last=freeTask(store,'week-limit');assert.throws(()=>reserveFree(store,last,snapshot(clock,1,{unlimited:true,remainingUnits:null})),{code:'ALLOWANCE_LIMIT'});
  assert.equal(store.allowanceLedger().reportedUnits,ALLOWANCE_LIMITS.weekUnits);
});

test('an oversized usage estimate cannot lower the hold and quarantines further admission',t=>{
  const {store,clock}=setup(t),lease=freeTask(store,'estimated-breach'),attempt=reserveFree(store,lease,snapshot(clock,100));
  completeFree(store,lease,attempt,{reportedUsd:0,reportedAllowanceUnits:null,estimatedAllowanceUnits:101});
  assert.equal(store.allowanceLedger().reservedUnits,100);assert.equal(store.allowanceLedger().reportedUnits,0);
  assert.equal(store.allowanceLedger().estimatedUnits,101);assert.equal(store.allowanceLedger().incident,true);
  const next=freeTask(store,'estimate-blocked');assert.throws(()=>reserveFree(store,next,snapshot(clock,1)),{code:'ALLOWANCE_INCIDENT'});
});

test('old unknown holds age out of daily telemetry while the weekly cap and provider holds remain binding',t=>{
  const {store,clock,advance}=setup(t);
  const amount=ALLOWANCE_LIMITS.workflowUnits,calls=ALLOWANCE_LIMITS.dayUnits/amount;
  for(let i=0;i<calls;i++){
    const lease=freeTask(store,'unknown-day-'+i),attempt=reserveFree(store,lease,snapshot(clock,amount));completeFree(store,lease,attempt);
  }
  assert.equal(store.allowanceLedger().rollingDayUnits,ALLOWANCE_LIMITS.dayUnits);
  const blocked=freeTask(store,'day-still-full');assert.throws(()=>reserveFree(store,blocked,snapshot(clock,1)),{code:'ALLOWANCE_LIMIT'});
  store.finish(blocked.id,'allowance-worker',blocked.fence,{status:'complete'});advance(86400001);
  const next=freeTask(store,'after-day');
  assert.equal(store.allowanceLedger().rollingDayUnits,0);assert.equal(store.allowanceLedger().rollingWeekUnits,ALLOWANCE_LIMITS.dayUnits);
  // Equal daily and weekly caps make the weekly cap remain binding after24h.
  assert.throws(()=>reserveFree(store,next,snapshot(clock,1)),{code:'ALLOWANCE_LIMIT'});
  assert.equal(store.allowanceLedger().unknownUnits,ALLOWANCE_LIMITS.dayUnits);
});

test('old unknown holds age out of the rolling week cap without refunding any historical provider hold',t=>{
  const {store,clock,advance}=setup(t);
  const amount=ALLOWANCE_LIMITS.workflowUnits,calls=ALLOWANCE_LIMITS.weekUnits/amount;
  for(let i=0;i<calls;i++){
    const lease=freeTask(store,'unknown-week-'+i),attempt=reserveFree(store,lease,snapshot(clock,amount));completeFree(store,lease,attempt);
  }
  advance(86400001);
  const blocked=freeTask(store,'week-still-full');assert.throws(()=>reserveFree(store,blocked,snapshot(clock,1)),{code:'ALLOWANCE_LIMIT'});
  store.finish(blocked.id,'allowance-worker',blocked.fence,{status:'complete'});advance(7*86400000);
  const next=freeTask(store,'after-week');
  assert.equal(store.allowanceLedger().rollingWeekUnits,0);
  assert.throws(()=>reserveFree(store,next,snapshot(clock,1,{remainingUnits:ALLOWANCE_LIMITS.weekUnits,periodKey:'renewed-subscription'})),{code:'ALLOWANCE_EXHAUSTED'});
  assert.ok(reserveFree(store,next,snapshot(clock,1,{remainingUnits:ALLOWANCE_LIMITS.weekUnits+1,periodKey:'renewed-subscription'})));
  assert.equal(store.allowanceLedger().unknownUnits,ALLOWANCE_LIMITS.weekUnits);assert.equal(store.allowanceLedger().requests,calls+1);
});

test('text headroom protects a real image reservation atomically without recording a phantom hold',t=>{
  const {store,clock}=setup(t),prime=freeTask(store,'prime-design','shared-design');
  const initial=ALLOWANCE_LIMITS.workflowUnits-10000000,old=reserveFree(store,prime,snapshot(clock,initial));completeFree(store,prime,old);
  const text=freeTask(store,'text-before-image','shared-design'),before=JSON.stringify(store.ledger());
  assert.throws(()=>store.reserve(text.id,'allowance-worker',text.fence,{...freeLimits,allowance:snapshot(clock,6291456),allowanceHeadroomUnits:5000000}),{code:'ALLOWANCE_DESIGN_CAPACITY_RESERVED'});
  assert.equal(JSON.stringify(store.ledger()),before);assert.equal(store.allowanceLedger().reservedUnits,initial);
  store.finish(text.id,'allowance-worker',text.fence,{status:'needs-human'});
  const image=freeTask(store,'real-image','shared-design');assert.ok(reserveFree(store,image,snapshot(clock,5000000)));
  assert.equal(store.allowanceLedger().reservedUnits,initial+5000000);
});

test('raised lifetime workflow allowance cap is atomic across independent connections',t=>{
  const {store,root,clock}=setup(t),lease=freeTask(store,'raised-cap');
  const other=new OrgStore(join(root,'state'),{now:clock});t.after(()=>other.close());
  reserveFree(store,lease,snapshot(clock,ALLOWANCE_LIMITS.workflowUnits-1));const before=JSON.stringify(store.ledger());
  assert.throws(()=>other.reserve(lease.id,'allowance-worker',lease.fence,{...freeLimits,allowance:snapshot(clock,2)}),{code:'ALLOWANCE_LIMIT'});
  assert.equal(JSON.stringify(store.ledger()),before);assert.equal(store.allowanceLedger().reservedUnits,ALLOWANCE_LIMITS.workflowUnits-1);
});

test('trusted synchronous dispatch hook commits its marker atomically with normal dispatch',t=>{
  const {store}=setup(t),lease=freeTask(store,'hook-dispatch'),attempt=store.reserve(lease.id,'allowance-worker',lease.fence,freeLimits);
  let calls=0;
  store.dispatch(attempt,'allowance-worker',lease.fence,{beforeDispatch:binding=>{
    calls++;assert.deepEqual(binding,{attemptId:attempt,taskId:lease.id,workflowId:lease.workflowId});
    assert.equal(store.ledger().attempts[0].state,'reserved');store.event(lease.id,'protocol-probe-once',{attemptId:attempt});
  }});
  assert.equal(calls,1);assert.equal(store.ledger().attempts[0].state,'dispatched');
  const events=store.events(lease.id);assert.ok(events.find(e=>e.kind==='protocol-probe-once').seq<events.find(e=>e.kind==='dispatched').seq);
  assert.throws(()=>store.dispatch(attempt,'allowance-worker',lease.fence,{beforeDispatch:()=>{calls++;}}),{code:'ATTEMPT_STATE'});assert.equal(calls,1);
});

test('dispatch hook throws roll back markers and both ledgers without consuming the reserved attempt',t=>{
  const {store,clock}=setup(t),lease=freeTask(store,'hook-rollback'),attempt=reserveFree(store,lease,snapshot(clock,100));
  const usdBefore=JSON.stringify(store.ledger()),allowanceBefore=JSON.stringify(store.allowanceLedger()),eventsBefore=JSON.stringify(store.events());
  assert.throws(()=>store.dispatch(attempt,'allowance-worker',lease.fence,{beforeDispatch:()=>{
    store.event(lease.id,'must-not-survive',{attemptId:attempt});throw Object.assign(new Error('Probe already consumed'),{code:'PROBE_USED'});
  }}),{code:'PROBE_USED'});
  assert.equal(JSON.stringify(store.ledger()),usdBefore);assert.equal(JSON.stringify(store.allowanceLedger()),allowanceBefore);assert.equal(JSON.stringify(store.events()),eventsBefore);
});

test('stale leases, paused admission and stale snapshots cannot invoke a dispatch hook',t=>{
  const {store,clock,advance}=setup(t),lease=freeTask(store,'hook-fenced'),attempt=reserveFree(store,lease,snapshot(clock,100));let calls=0;
  const options={beforeDispatch:()=>{calls++;}};
  store.setControl('paused');assert.throws(()=>store.dispatch(attempt,'allowance-worker',lease.fence,options),{code:'PAUSED'});
  store.setControl('running');advance(60001);assert.throws(()=>store.dispatch(attempt,'allowance-worker',lease.fence,options),{code:'ALLOWANCE_SNAPSHOT_STALE'});
  advance(60000);assert.throws(()=>store.dispatch(attempt,'allowance-worker',lease.fence,options),{code:'STALE_LEASE'});assert.equal(calls,0);
});

test('dispatch hooks reject asynchronous/nonfunction callbacks and roll back thenable markers',t=>{
  const {store}=setup(t),lease=freeTask(store,'hook-invalid'),attempt=store.reserve(lease.id,'allowance-worker',lease.fence,freeLimits);let called=false;
  for(const hook of [null,true,'callback',async()=>{called=true;}])assert.throws(()=>store.dispatch(attempt,'allowance-worker',lease.fence,{beforeDispatch:hook}),{code:'INVALID_DISPATCH_HOOK'});
  assert.equal(called,false);
  assert.throws(()=>store.dispatch(attempt,'allowance-worker',lease.fence,{beforeDispatch:()=>{store.event(lease.id,'async-marker');return {then(){}};}}),{code:'INVALID_DISPATCH_HOOK'});
  assert.equal(store.events().some(e=>e.kind==='async-marker'),false);assert.equal(store.ledger().attempts[0].state,'reserved');
});

test('undispatched pending quarantine atomically rejects another connection’s acquired or dispatched task', t => {
  const {store,root,clock}=setup(t);store.enqueue(task('quarantine-safe'));
  assert.equal(store.cancel('quarantine-safe',{onlyUndispatchedPending:true}).status,'cancelled');
  store.enqueue(task('quarantine-race'));store.setControl('running');
  const other=new OrgStore(join(root,'state'),{now:clock});
  try {
    const lease=other.claim('other');
    assert.equal(store.cancel(lease.id,{onlyUndispatchedPending:true}),null);assert.equal(other.getTask(lease.id).status,'leased');
    const attempt=other.reserve(lease.id,'other',lease.fence,limits);other.dispatch(attempt,'other',lease.fence);
    const before=other.ledger();assert.equal(store.cancel(lease.id,{onlyUndispatchedPending:true}),null);
    assert.deepEqual(other.ledger(),before);assert.equal(other.getTask(lease.id).fence,lease.fence);
    other.finish(lease.id,'other',lease.fence,{status:'needs-human'});
    assert.equal(store.cancel(lease.id,{onlyUndispatchedPending:true}),null);assert.equal(other.getTask(lease.id).status,'needs-human');
  } finally {other.close();}
});

const CALC_MODEL='free/qwen-3.8-max',CALC_ENTRY=getModelCatalogEntry(CALC_MODEL),CALC_RESERVE=textAllowanceReservationUnits(CALC_MODEL);
const calcSha=bytes=>createHash('sha256').update(bytes).digest('hex');
function calcQuote(store,clock,{changes={},observedAt=clock(),weight=CALC_ENTRY.allowanceWeight}={}){
  const body=JSON.stringify({models:[{id:CALC_MODEL,provider:'Free',allowFree:true,dollarsPer1M:0,outputDollarsPer1M:0,
    weight,contextWindow:String(CALC_ENTRY.contextTokens),...changes}]});
  const quote={schemaVersion:1,policy:CALC_POLICY,sourceUrl:ALLOWANCE_QUOTE_URL,observedAt,body,bodySha256:calcSha(body)};
  const artifact=store.putArtifact(Buffer.from(JSON.stringify(quote,null,2)));
  return{quote,authorization:{policy:CALC_POLICY,model:CALC_MODEL,weight,quoteArtifactHash:artifact.hash}};
}
function reserveCalculated(store,lease,clock,quote=calcQuote(store,clock),{reserved=CALC_RESERVE,remaining=2000000000}={}){
  const attempt=store.reserve(lease.id,'allowance-worker',lease.fence,{...freeLimits,
    allowance:snapshot(clock,reserved,{remainingUnits:remaining}),allowanceCalculationReservation:quote.authorization});
  return{attempt,quote};
}
function calcResponse(store,lease,attempt,{usage={prompt_tokens:17,completion_tokens:23,total_tokens:40},mutate=()=>{}}={}){
  const response={attemptBinding:{attemptId:attempt,taskId:lease.id,model:CALC_MODEL,protocol:'chat/completions'},
    usage,rawResponse:{model:CALC_MODEL,id:'request-'+attempt,usage,choices:[{index:0,finish_reason:'stop',message:{content:'a model proposal, not measurement certification'}}]},
    execution:{requestedModel:CALC_MODEL,returnedModel:CALC_MODEL,requestId:'request-'+attempt,finishReason:'stop',
      settings:{route:'chat/completions'},transportComplete:true,transport:'json',reportedUsd:0,billingTier:'free-allowance',
      usage:{promptTokens:usage.prompt_tokens,completionTokens:usage.completion_tokens,totalTokens:usage.total_tokens,
        inputTokens:usage.input_tokens??null,outputTokens:usage.output_tokens??null}}};
  mutate(response);return store.putArtifact(Buffer.from(JSON.stringify(response))).hash;
}
function calcSettlement(quote,responseArtifactHash,extra={}){return{reportedUsd:0,allowanceCalculation:{policy:CALC_POLICY,quoteArtifactHash:quote.authorization.quoteArtifactHash,responseArtifactHash,...extra}};}

test('new opted-in reservation calculates from durable raw evidence and never calls it a direct allowance receipt',t=>{
  const {store,clock,advance}=setup(t),lease=freeTask(store,'new-documented');const {attempt,quote}=reserveCalculated(store,lease,clock);
  assert.equal(store.allowanceCalculations().authorizations.length,1);assert.equal(store.allowanceCalculations().dispatches.length,0);
  store.dispatch(attempt,'allowance-worker',lease.fence);advance(70000);
  const response=calcResponse(store,lease,attempt);store.settle(attempt,'allowance-worker',lease.fence,calcSettlement(quote,response));
  const ledger=store.allowanceLedger(),row=ledger.attempts[0],units=40*CALC_ENTRY.allowanceWeight;
  assert.equal(row.state,'settled');assert.equal(row.reserved_units,CALC_RESERVE);assert.equal(row.charged_units,units);assert.equal(row.reported_units,null);
  assert.equal(ledger.reportedUnits,0);assert.equal(ledger.calculatedUnits,units);assert.equal(ledger.calculatedAllowanceRequests,1);assert.equal(ledger.unknownAllowanceRequests,0);
  const proof=store.allowanceCalculations().calculations[0],artifact=JSON.parse(store.readArtifact(proof.proof_artifact_hash));
  assert.equal(artifact.calculatedUnits,units);assert.equal(artifact.directlyReported,false);assert.equal(artifact.attemptBinding.attemptId,attempt);
  assert.equal(artifact.responseArtifactHash,response);assert.equal(artifact.formulaDocumentSha256.length,64);
  assert.equal(store.ledger().reportedUsd,0);assert.equal(store.ledger().budgetIncident,false);
  assert.ok(store.events().some(e=>e.kind==='allowance-documented-calculated'));
  assert.equal(store.events().some(e=>e.kind==='allowance-settled'),false);
  assert.equal(Object.hasOwn(row,'calculated_units'),false,'Existing allowance row shape is unchanged');
});

test('zero complete token counts can settle only a new authorized documented calculation',t=>{
  const {store,clock}=setup(t),lease=freeTask(store,'new-zero');const {attempt,quote}=reserveCalculated(store,lease,clock);store.dispatch(attempt,'allowance-worker',lease.fence);
  const response=calcResponse(store,lease,attempt,{usage:{prompt_tokens:0,completion_tokens:0,total_tokens:0}});
  store.settle(attempt,'allowance-worker',lease.fence,calcSettlement(quote,response));
  assert.equal(store.allowanceLedger().calculatedAllowanceRequests,1);assert.equal(store.allowanceLedger().calculatedUnits,0);
  assert.equal(store.allowanceLedger().reservedUnits,0);assert.equal(store.allowanceLedger().attempts[0].reserved_units,CALC_RESERVE);assert.equal(store.allowanceLedger().attempts[0].reported_units,null);
});

test('authorization is prospective; an existing attempt cannot opt in at settlement',t=>{
  const {store,clock}=setup(t),lease=freeTask(store,'old-unopted'),attempt=reserveFree(store,lease,snapshot(clock,CALC_RESERVE));
  const quote=calcQuote(store,clock);store.dispatch(attempt,'allowance-worker',lease.fence);
  store.settle(attempt,'allowance-worker',lease.fence,calcSettlement(quote,calcResponse(store,lease,attempt)));
  assert.equal(store.allowanceCalculations().authorizations.length,0);assert.equal(store.allowanceCalculations().calculations.length,0);
  assert.equal(store.allowanceLedger().reservedUnits,CALC_RESERVE);assert.equal(store.allowanceLedger().calculationRejectedRequests,1);
  assert.equal(store.allowanceCalculations().rejected[0].detail.reason,'PROSPECTIVE_AUTHORIZATION_MISSING');
  assert.equal(store.ledger().unknownBillingRequests,0,'Valid dollar telemetry still settles independently');
});

test('quote must be fresh at durable dispatch; stale quote keeps conservative route without calculation eligibility',t=>{
  const {store,clock,advance}=setup(t),lease=freeTask(store,'stale-dispatch-quote');
  const quote=calcQuote(store,clock,{observedAt:clock()-50000}),{attempt}=reserveCalculated(store,lease,clock,quote);
  advance(10001);store.dispatch(attempt,'allowance-worker',lease.fence);
  assert.equal(store.allowanceCalculations().dispatches.length,0);assert.ok(store.events().some(e=>e.kind==='allowance-calculation-dispatch-ineligible'));
  store.settle(attempt,'allowance-worker',lease.fence,calcSettlement(quote,calcResponse(store,lease,attempt)));
  assert.equal(store.allowanceLedger().reservedUnits,CALC_RESERVE);assert.equal(store.allowanceCalculations().calculations.length,0);
});

test('invalid opt-in quote preserves a hold, while adverse quote or an undersized reservation cannot dispatch',t=>{
  const {store,clock}=setup(t),lease=freeTask(store,'quote-reserve-guards');
  const bad=store.putArtifact(Buffer.from('not JSON'));
  const attempt=store.reserve(lease.id,'allowance-worker',lease.fence,{...freeLimits,allowance:snapshot(clock,CALC_RESERVE),
    allowanceCalculationReservation:{policy:CALC_POLICY,model:CALC_MODEL,weight:CALC_ENTRY.allowanceWeight,quoteArtifactHash:bad.hash}});
  assert.equal(store.allowanceCalculations().authorizations.length,0);store.dispatch(attempt,'allowance-worker',lease.fence);
  store.settle(attempt,'allowance-worker',lease.fence,{reportedUsd:0});assert.equal(store.allowanceLedger().reservedUnits,CALC_RESERVE);
  store.finish(lease.id,'allowance-worker',lease.fence,{status:'complete'});
  const next=freeTask(store,'adverse-reserve-quote');
  for(const changes of [{dollarsPer1M:.01},{weight:CALC_ENTRY.allowanceWeight+1},{contextWindow:String(CALC_ENTRY.contextTokens+1)}]){
    const quote=calcQuote(store,clock,{changes});const before=JSON.stringify(store.ledger());
    assert.throws(()=>reserveCalculated(store,next,clock,quote),{code:'ALLOWANCE_CALCULATION_DISPATCH_BLOCKED'});assert.equal(JSON.stringify(store.ledger()),before);
  }
  assert.throws(()=>reserveCalculated(store,next,clock,calcQuote(store,clock),{reserved:CALC_RESERVE-1}),{code:'ALLOWANCE_CALCULATION_RESERVATION_INSUFFICIENT'});
});

test('forged hashes, bindings, protocol, usage and caller-provided charge cannot release an allowance hold',t=>{
  const {store,clock}=setup(t);
  const variants=[r=>{r.attemptBinding.attemptId='another-attempt';},r=>{r.attemptBinding.taskId='another-task';},
    r=>{r.attemptBinding.model='free/glm-5.3';},r=>{r.attemptBinding.protocol='decisions';},
    r=>{r.rawResponse.usage={prompt_tokens:17,completion_tokens:23,total_tokens:41};},r=>{r.execution.transportComplete=false;},
    r=>{r.rawResponse.model='free/glm-5.3';},r=>{r.rawResponse.usage={prompt_tokens:17,completion_tokens:23,total_tokens:40,input_tokens:18};}];
  for(const [i,mutate]of variants.entries()){
    const lease=freeTask(store,'invalid-proof-'+i),{attempt,quote}=reserveCalculated(store,lease,clock);store.dispatch(attempt,'allowance-worker',lease.fence);
    store.settle(attempt,'allowance-worker',lease.fence,calcSettlement(quote,calcResponse(store,lease,attempt,{mutate})));
    assert.equal(store.allowanceLedger(lease.id).reservedUnits,CALC_RESERVE);assert.equal(store.allowanceCalculations(lease.id).calculations.length,0);
    assert.equal(store.allowanceLedger(lease.id).calculationRejectedRequests,1);store.finish(lease.id,'allowance-worker',lease.fence,{status:'complete'});
  }
  const lease=freeTask(store,'caller-charge'),{attempt,quote}=reserveCalculated(store,lease,clock);store.dispatch(attempt,'allowance-worker',lease.fence);
  store.settle(attempt,'allowance-worker',lease.fence,calcSettlement(quote,calcResponse(store,lease,attempt),{calculatedUnits:0}));
  assert.equal(store.allowanceLedger(lease.id).reservedUnits,CALC_RESERVE);assert.equal(store.allowanceCalculations(lease.id).calculations.length,0);
});

test('a later cheaper quote, invalid artifact hash or contradictory direct debit cannot replace reservation proof',t=>{
  const {store,clock}=setup(t);
  for(const variant of ['cheaper','missing','direct']){
    const lease=freeTask(store,'quote-swap-'+variant),{attempt,quote}=reserveCalculated(store,lease,clock);store.dispatch(attempt,'allowance-worker',lease.fence);
    const raw=calcResponse(store,lease,attempt);const usage=calcSettlement(quote,raw);
    if(variant==='cheaper')usage.allowanceCalculation.quoteArtifactHash=calcQuote(store,clock,{weight:1}).authorization.quoteArtifactHash;
    if(variant==='missing')usage.allowanceCalculation.responseArtifactHash='f'.repeat(64);
    if(variant==='direct')usage.reportedAllowanceUnits=0;
    store.settle(attempt,'allowance-worker',lease.fence,usage);
    assert.equal(store.allowanceLedger(lease.id).reservedUnits,CALC_RESERVE);assert.equal(store.allowanceLedger(lease.id).reportedUnits,0);assert.equal(store.allowanceCalculations(lease.id).calculations.length,0);
    store.finish(lease.id,'allowance-worker',lease.fence,{status:'complete'});
  }
});

test('calculated usage beyond its reservation records the charge and incident without changing wallet billing',t=>{
  const {store,clock}=setup(t),lease=freeTask(store,'calculated-breach'),{attempt,quote}=reserveCalculated(store,lease,clock);store.dispatch(attempt,'allowance-worker',lease.fence);
  const total=2*CALC_ENTRY.contextTokens+1,response=calcResponse(store,lease,attempt,{usage:{prompt_tokens:total,completion_tokens:0,total_tokens:total}});
  store.settle(attempt,'allowance-worker',lease.fence,calcSettlement(quote,response));
  assert.ok(store.allowanceLedger().calculatedUnits>CALC_RESERVE);assert.equal(store.allowanceLedger().incident,true);assert.equal(store.allowanceLedger().reportedUnits,0);
  assert.equal(store.ledger().reportedUsd,0);assert.equal(store.ledger().budgetIncident,false);
  assert.throws(()=>store.reserve(lease.id,'allowance-worker',lease.fence,freeLimits),{code:'ALLOWANCE_INCIDENT'});
});

test('fences, cancellation and second settlement guard calculated proof insertion',t=>{
  const {store,clock}=setup(t);let lease=freeTask(store,'cancel-calculated');let {attempt,quote}=reserveCalculated(store,lease,clock);store.dispatch(attempt,'allowance-worker',lease.fence);
  const usage=calcSettlement(quote,calcResponse(store,lease,attempt));store.cancel(lease.id);const before=JSON.stringify(store.allowanceLedger());
  assert.throws(()=>store.settle(attempt,'allowance-worker',lease.fence,usage),{code:'STALE_LEASE'});assert.equal(JSON.stringify(store.allowanceLedger()),before);assert.equal(store.allowanceCalculations().calculations.length,0);
  lease=freeTask(store,'once-calculated');({attempt,quote}=reserveCalculated(store,lease,clock));store.dispatch(attempt,'allowance-worker',lease.fence);
  const valid=calcSettlement(quote,calcResponse(store,lease,attempt));store.settle(attempt,'allowance-worker',lease.fence,valid);const settled=JSON.stringify(store.allowanceLedger());
  assert.throws(()=>store.settle(attempt,'allowance-worker',lease.fence,valid),{code:'ATTEMPT_STATE'});assert.equal(JSON.stringify(store.allowanceLedger()),settled);assert.equal(store.allowanceCalculations().calculations.length,1);
});

test('calculation insertion and settlement roll back atomically on proof-write failure',t=>{
  const {store,clock}=setup(t),lease=freeTask(store,'calculation-rollback'),{attempt,quote}=reserveCalculated(store,lease,clock);store.dispatch(attempt,'allowance-worker',lease.fence);
  const usage=calcSettlement(quote,calcResponse(store,lease,attempt));const before={usd:JSON.stringify(store.ledger()),allowance:JSON.stringify(store.allowanceLedger()),events:JSON.stringify(store.events())};
  store.db.exec("CREATE TRIGGER reject_test_calculation BEFORE INSERT ON allowance_calculations BEGIN SELECT RAISE(ABORT,'test calculation write failure'); END;");
  assert.throws(()=>store.settle(attempt,'allowance-worker',lease.fence,usage),/test calculation write failure/);
  assert.equal(JSON.stringify(store.ledger()),before.usd);assert.equal(JSON.stringify(store.allowanceLedger()),before.allowance);assert.equal(JSON.stringify(store.events()),before.events);assert.equal(store.allowanceCalculations().calculations.length,0);
  store.db.exec('DROP TRIGGER reject_test_calculation');store.settle(attempt,'allowance-worker',lease.fence,usage);assert.equal(store.allowanceCalculations().calculations.length,1);
});

test('another connection counts calculated settlements against a reused provider snapshot',t=>{
  const {store,clock,advance,root}=setup(t),lease=freeTask(store,'calculated-snapshot');const quote=calcQuote(store,clock),snap=snapshot(clock,CALC_RESERVE,{remainingUnits:CALC_RESERVE+100});
  const attempt=store.reserve(lease.id,'allowance-worker',lease.fence,{...freeLimits,allowance:snap,allowanceCalculationReservation:quote.authorization});store.dispatch(attempt,'allowance-worker',lease.fence);
  store.settle(attempt,'allowance-worker',lease.fence,calcSettlement(quote,calcResponse(store,lease,attempt)));store.finish(lease.id,'allowance-worker',lease.fence,{status:'complete'});
  const other=new OrgStore(join(root,'state'),{now:clock});t.after(()=>other.close());const next=freeTask(other,'after-calculated-snapshot');
  assert.throws(()=>other.reserve(next.id,'allowance-worker',next.fence,{...freeLimits,allowance:snap}),{code:'ALLOWANCE_EXHAUSTED'});
  advance(1);assert.ok(reserveCalculated(other,next,clock,calcQuote(other,clock),{remaining:CALC_RESERVE+100}).attempt);
});

test('all 75 historical allowance rows and 129 wallet rows stay byte-for-byte unchanged after new calculation',t=>{
  const {store,clock,advance}=setup(t);const oldTaskIds=[];
  for(let i=0;i<129;i++){
    const lease=freeTask(store,'historical-'+i);oldTaskIds.push(lease.id);
    const amount=i<75?0:.01;const attempt=store.reserve(lease.id,'allowance-worker',lease.fence,{...freeLimits,usd:amount,...(i<75?{allowance:snapshot(clock,1)}:{})});
    store.dispatch(attempt,'allowance-worker',lease.fence);store.settle(attempt,'allowance-worker',lease.fence,{reportedUsd:amount});store.finish(lease.id,'allowance-worker',lease.fence,{status:'complete'});advance(1);
  }
  const original={usd:store.ledger().attempts,allowance:store.allowanceLedger().attempts,tasks:store.listTasks(),events:store.events()};
  assert.equal(original.usd.length,129);assert.equal(original.allowance.length,75);assert.equal(store.allowanceCalculations().authorizations.length,0);
  const lease=freeTask(store,'prospective-after-history'),{attempt,quote}=reserveCalculated(store,lease,clock);store.dispatch(attempt,'allowance-worker',lease.fence);
  store.settle(attempt,'allowance-worker',lease.fence,calcSettlement(quote,calcResponse(store,lease,attempt)));
  const old=new Set(oldTaskIds);
  assert.deepEqual(store.ledger().attempts.filter(r=>old.has(r.task_id)),original.usd);
  assert.deepEqual(store.allowanceLedger().attempts.filter(r=>old.has(r.task_id)),original.allowance);
  assert.deepEqual(store.listTasks().filter(r=>old.has(r.id)),original.tasks);
  assert.deepEqual(store.events().filter(r=>r.seq<=original.events.at(-1).seq),original.events);
  assert.equal(store.allowanceLedger().unknownUnits,75);assert.equal(store.allowanceCalculations().authorizations.length,1);assert.equal(store.allowanceCalculations().calculations.length,1);
  assert.equal(store.allowanceCalculations().authorizations[0].attempt_id,attempt);
});

test('positive monetary settlement contradicts a zero-dollar calculation artifact and keeps the full allowance hold',t=>{
  const {store,clock}=setup(t),lease=freeTask(store,'dollar-contradiction'),{attempt,quote}=reserveCalculated(store,lease,clock);store.dispatch(attempt,'allowance-worker',lease.fence);
  const usage={...calcSettlement(quote,calcResponse(store,lease,attempt)),reportedUsd:.01};store.settle(attempt,'allowance-worker',lease.fence,usage);
  assert.equal(store.allowanceLedger().reservedUnits,CALC_RESERVE);assert.equal(store.allowanceCalculations().calculations.length,0);
  assert.equal(store.allowanceCalculations().rejected[0].detail.reason,'CONFLICTING_WALLET_USAGE');assert.equal(store.ledger().reportedUsd,.01);assert.equal(store.ledger().budgetIncident,true);
});

test('calculation dispatch eligibility and trusted dispatch markers commit or roll back together',t=>{
  const {store,clock}=setup(t),lease=freeTask(store,'calculation-dispatch-rollback'),{attempt}=reserveCalculated(store,lease,clock);
  const before={usd:JSON.stringify(store.ledger()),allowance:JSON.stringify(store.allowanceLedger()),events:JSON.stringify(store.events())};
  assert.throws(()=>store.dispatch(attempt,'allowance-worker',lease.fence,{beforeDispatch:()=>{store.event(lease.id,'must-rollback');throw new Error('stop before send');}}),/stop before send/);
  assert.equal(JSON.stringify(store.ledger()),before.usd);assert.equal(JSON.stringify(store.allowanceLedger()),before.allowance);assert.equal(JSON.stringify(store.events()),before.events);assert.equal(store.allowanceCalculations().dispatches.length,0);
  store.dispatch(attempt,'allowance-worker',lease.fence);assert.equal(store.allowanceCalculations().dispatches.length,1);
});
