import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {OrgStore} from './store.mjs';
import {MODEL_CATALOG,textAllowanceReservationUnits} from './model-catalog.mjs';
import {runModelFleet,buildFleetAssignments,buildMetricFacts,validateMetricClaims} from './model-fleet.mjs';

const contexts={developmentContext:{metrics:{attempted:6,diagnosticPasses:2,misclassifiedEdges:0},pdfReview:{checked:6,failed:0}},
  aggregateContext:{metrics:{attempted:12,diagnosticPasses:4,reviewRequired:8,misclassifiedEdges:0,
    splits:{validation:{cases:3,diagnosticPasses:1},holdout:{cases:3,diagnosticPasses:2}}},pdfReview:{checked:12,failed:0}}};
const THREE=MODEL_CATALOG.filter(m=>['gpt-6.2-astra','gemini-4-hydrogen','claude-opus-5.5'].includes(m.id));
function fixture(t){const directory=mkdtempSync(path.join(tmpdir(),'roof-fleet-')),store=new OrgStore(directory);
  t.after(()=>{store.close();rmSync(directory,{recursive:true,force:true});});return store;}
function payload(role){return {
  ceo:{priority:90,requestedDecision:'approve'},extraction:{observations:[]},reference:{propertyGroup:'generated',referenceTier:'synthetic',split:'development',contradictions:[]},
  engineering:{hypothesis:'Investigate unsupported edges.',patchArtifact:null,predictedMetric:'Reduce extra edges without dropping cases.'},
  critique:{counterexamples:[],recommendation:'Run independent checks.'},verification:{evidenceIds:[]},reporting:{reportArtifact:null},
  operations:{operation:'diagnose',targetRevision:null,rollbackTarget:null}}[role];}
function response(task,options){
  const result={schemaVersion:1,taskId:task.id,role:task.role,sourceRevision:task.sourceRevision,datasetRevision:task.datasetRevision,
    candidateHash:task.candidateHash,policyVersion:task.policyVersion,inputHashes:task.inputHashes,decision:'pass',findings:[],artifactRefs:[],summary:'Advisory synthetic result.',
    payload:payload(task.role),metricClaims:{...options.context.trustedMetricFacts}};
  if(task.constraints.reviewTaskId)result.peerReview={taskId:task.constraints.reviewTaskId,decision:'pass',findings:['Compared the supplied deterministic counts and source scope for this exact task.']};
  return {result,execution:{requestedModel:options.model,returnedModel:options.model,reportedUsd:.0001}};
}
function freeHold(model){return {reservedUnits:textAllowanceReservationUnits(model),remainingUnits:1000000000,observedAt:Date.now(),expiresAt:Date.now()+3600000,periodKey:'test-subscription-period',unlimited:false};}
function options(store,catalog=THREE,extra={}){return {store,catalog,evaluationHash:'a'.repeat(64),sourceRevision:'test-source',inputHash:'b'.repeat(64),...contexts,
  paidAllowed:true,apiKey:'not-real-test-key',minimumDispatchIntervalMs:0,
  verifyModels:async()=>({ids:catalog.map(m=>m.id),checkedAt:new Date().toISOString()}),
  requestRole:async(task,opts)=>{const free=opts.model.startsWith('free/');const id=await opts.reserve({usd:free?0:.01,...(free?{allowance:freeHold(opts.model)}:{})});await opts.onDispatch(id);await opts.onUsage(id,{reportedUsd:free?0:.0001,...(free?{reportedAllowanceUnits:0}:{})});return response(task,opts);},...extra};}
test('all catalog IDs receive distinct concrete assignments, one CEO last and alias reviewers excluded',()=>{
  const assignments=buildFleetAssignments();assert.equal(assignments.length,MODEL_CATALOG.length);
  assert.equal(new Set(assignments.map(a=>a.model)).size,MODEL_CATALOG.length);
  assert.equal(new Set(assignments.map(a=>a.task)).size,MODEL_CATALOG.length);
  assert.equal(assignments.at(-1).role,'ceo');assert.equal(assignments.filter(a=>a.role==='ceo').length,1);
  for(const model of ['drex-v2.0','jev-1.13','free/hy4-flash'])assert.equal(assignments.find(a=>a.model===model).mayReview,false);
});
test('metric claims preserve exact numerical zeros and reject contradicted claims or invented keys',()=>{
  const facts=buildMetricFacts(contexts.aggregateContext);assert.equal(facts['metrics.reviewRequired'],8);assert.equal(facts['metrics.misclassifiedEdges'],0);
  assert.equal(validateMetricClaims({...facts},facts),true);
  assert.throws(()=>validateMetricClaims({...facts,'metrics.reviewRequired':6},facts),{code:'METRIC_CLAIMS_MISMATCH'});
  assert.throws(()=>validateMetricClaims({...facts,invented:1},facts),{code:'METRIC_CLAIMS_MISMATCH'});
  assert.throws(()=>buildMetricFacts({metrics:{attempted:12,diagnosticPasses:4,reviewRequired:6}}),{code:'TRUSTED_FACT_CONTRADICTION'});
});
test('three real store assignments dispatch once each, CEO last, and independent closing review completes coverage',async t=>{
  const store=fixture(t),calls=[];const base=options(store);
  const result=await runModelFleet({...base,requestRole:async(task,opts)=>{calls.push({model:opts.model,task,context:opts.context});return base.requestRole(task,opts);}});
  assert.equal(result.coverage.assigned,3);assert.equal(result.coverage.attempted,3);assert.equal(result.coverage.validContributions,3,JSON.stringify(result.agents.map(a=>({model:a.model,code:a.code,status:a.status}))));
  assert.equal(result.coverage.independentlyReviewed,3);assert.equal(result.coverage.complete,true);
  assert.equal(result.agents.at(-1).role,'ceo');assert.ok(calls.length>3&&calls.length<=6);
  for(const row of result.agents){assert.equal(row.attempted,true);assert.equal(row.reviewStatus,'complete');assert.notEqual(row.model,row.reviewerModel);}
  assert.equal(calls.filter(c=>c.task.stage==='fleet-primary').at(-1).task.role,'ceo');
  assert.equal(calls.find(c=>c.task.role==='ceo').context.trustedMetricFacts['metrics.reviewRequired'],8);
  assert.equal(calls.find(c=>c.task.role!=='ceo').context.trustedMetricFacts['metrics.attempted'],6);
});
test('same evaluation reuses results despite durable rotation and does not dispatch or charge again',async t=>{
  const store=fixture(t);let sent=0;const base=options(store),requestRole=async(task,opts)=>{sent++;return base.requestRole(task,opts);};
  const first=await runModelFleet({...base,requestRole}),count=sent,charge=store.ledger().reportedUsd;
  const second=await runModelFleet({...base,requestRole});
  assert.equal(first.planHash,second.planHash);assert.equal(sent,count);assert.equal(store.ledger().reportedUsd,charge);
  assert.equal(second.coverage.complete,true);assert.ok(second.agents.every(a=>a.reused));
});
test('explicit zero request limit never dispatches and still reports every assigned model',async t=>{
  const store=fixture(t);let calls=0;const result=await runModelFleet(options(store,THREE,{limits:{requestLimit:0},requestRole:async()=>{calls++;}}));
  assert.equal(calls,0);assert.equal(result.coverage.attempted,0);assert.equal(result.agents.length,3);assert.ok(result.agents.every(a=>a.code==='CYCLE_REQUEST_LIMIT'));
});
test('reserving without a dispatch never counts as model use or a valid completed contribution',async t=>{
  const store=fixture(t);const result=await runModelFleet(options(store,THREE,{requestRole:async(task,opts)=>{await opts.reserve({usd:.01});return response(task,opts);}}));
  assert.equal(result.coverage.attempted,0);assert.equal(result.coverage.validContributions,0);assert.ok(result.agents.every(a=>a.code==='DISPATCH_EVIDENCE_MISSING'));
});
test('model-specific403 blocks only that model across new evaluations',async t=>{
  const store=fixture(t),base=options(store);let failed=0;
  const requestRole=async(task,opts)=>{if(opts.model==='gemini-4-hydrogen'){failed++;const id=await opts.reserve({usd:.01});await opts.onDispatch(id);await opts.onUsage(id,{reportedUsd:0});throw Object.assign(new Error('Entitlement denied'),{status:403,code:'UPSTREAM_HTTP'});}return base.requestRole(task,opts);};
  const first=await runModelFleet({...base,requestRole});assert.equal(first.agents.find(a=>a.model==='gemini-4-hydrogen').code,'UPSTREAM_HTTP');
  assert.ok(first.agents.some(a=>a.model!=='gemini-4-hydrogen'&&a.attempted));
  const second=await runModelFleet({...base,evaluationHash:'c'.repeat(64),requestRole});assert.equal(failed,1);
  assert.equal(second.agents.find(a=>a.model==='gemini-4-hydrogen').code,'MODEL_RECONCILIATION_REQUIRED');
});
test('provider401 prevents hammering unrelated models, preserves actual first dispatch',async t=>{
  const store=fixture(t);let sent=0;
  const result=await runModelFleet(options(store,THREE,{requestRole:async(task,opts)=>{sent++;const id=await opts.reserve({usd:.01});await opts.onDispatch(id);await opts.onUsage(id,{reportedUsd:0});throw Object.assign(new Error('Auth denied'),{status:401,code:'UPSTREAM_HTTP'});}}));
  assert.equal(sent,1);assert.equal(result.coverage.attempted,1);assert.equal(result.agents.filter(a=>a.code==='PROVIDER_AUTH_RECONCILIATION_REQUIRED').length,2);
});
test('unknown billing survives crash recovery and same-model dispatch is not replayed',async t=>{
  const store=fixture(t);let sent=0;
  const base=options(store,THREE,{requestRole:async(task,opts)=>{sent++;const id=await opts.reserve({usd:.01});await opts.onDispatch(id);throw Object.assign(new Error('Unknown network outcome'),{code:'NETWORK_ERROR'});}});
  await runModelFleet(base);const count=sent;assert.ok(store.ledger().unknownBillingRequests>0);
  await runModelFleet(base);assert.equal(sent,count);
});
test('a new free evaluation can use separately held allowance after a timeout without replaying the old request',async t=>{
  const store=fixture(t),catalog=MODEL_CATALOG.filter(m=>m.id==='free/gpt-6-luna');let calls=0;
  const first=options(store,catalog,{requestRole:async(task,opts)=>{calls++;const id=await opts.reserve({usd:0,allowance:freeHold(opts.model)});await opts.onDispatch(id);await opts.onUsage(id,{reportedUsd:null});throw Object.assign(new Error('Ambiguous free response'),{code:'TIMEOUT'});}});
  await runModelFleet(first);const old=JSON.stringify(store.ledger().attempts);await runModelFleet(first);assert.equal(calls,1);
  const fresh=await runModelFleet({...options(store,catalog),evaluationHash:'c'.repeat(64)});
  assert.equal(fresh.coverage.attempted,1);assert.equal(fresh.coverage.validContributions,1);
  assert.equal(JSON.stringify(store.ledger().attempts.slice(0,1)),old);assert.ok(store.allowanceLedger().unknownUnits>0);
});
test('free allowance cannot bypass permanent model errors or omit its weighted hold',async t=>{
  const store=fixture(t),catalog=MODEL_CATALOG.filter(m=>m.id==='free/gpt-6-luna');
  const noHold=await runModelFleet(options(store,catalog,{requestRole:async(task,opts)=>{await opts.reserve({usd:0});}}));
  assert.equal(noHold.coverage.attempted,0);assert.equal(noHold.agents[0].code,'ALLOWANCE_RESERVATION_MISSING');
  const denied=options(store,catalog,{evaluationHash:'d'.repeat(64),requestRole:async(task,opts)=>{const id=await opts.reserve({usd:0,allowance:freeHold(opts.model)});await opts.onDispatch(id);await opts.onUsage(id,{reportedUsd:0});throw Object.assign(new Error('Denied'),{code:'UPSTREAM_HTTP',status:403});}});
  await runModelFleet(denied);const again=await runModelFleet({...options(store,catalog),evaluationHash:'e'.repeat(64)});
  assert.equal(again.coverage.attempted,0);assert.equal(again.agents[0].code,'MODEL_RECONCILIATION_REQUIRED');
});
test('allowance qualification rejects paid or malformed selections before roster or inference',async t=>{
  const store=fixture(t);let calls=0;
  for(const selectedModelIds of [['gpt-6.2-astra'],[],['free/gpt-6-luna','free/gpt-6-luna'],[123]])
    await assert.rejects(runModelFleet(options(store,MODEL_CATALOG,{selectedModelIds,verifyModels:async()=>{calls++;}})),{code:'INVALID_ALLOWANCE_SELECTION'});
  assert.equal(calls,0);
});
test('design headroom defers free text and cached replay preserves its reason without new work',async t=>{
  const store=fixture(t),catalog=MODEL_CATALOG.filter(m=>m.id==='free/gpt-6-luna');let calls=0;
  const base=options(store,catalog,{allowanceReserveUnits:5000000,requestRole:async(task,opts)=>{
    calls++;await opts.reserve({usd:0,allowance:freeHold(opts.model)});
  }});
  const planned=await runModelFleet({...base,paidAllowed:false});
  store.enqueue({id:'prime-design-capacity',workflowId:'fleet-'+planned.planHash.slice(0,32)});const lease=store.claim('prime-worker');
  const id=store.reserve(lease.id,'prime-worker',lease.fence,{usd:0,requestLimit:64,maxUsd:3,hourUsd:3,dayUsd:3,weekUsd:20,monthUsd:80,allowance:{...freeHold(catalog[0].id),reservedUnits:90000000}});
  store.dispatch(id,'prime-worker',lease.fence);store.settle(id,'prime-worker',lease.fence,{reportedUsd:0});store.finish(lease.id,'prime-worker',lease.fence,{status:'complete'});
  const first=await runModelFleet(base),again=await runModelFleet(base);
  for(const result of [first,again]){assert.equal(result.agents[0].status,'deferred',JSON.stringify(result.agents[0]));assert.equal(result.agents[0].code,'ALLOWANCE_DESIGN_CAPACITY_RESERVED');assert.equal(result.agents[0].attempted,false);}
  assert.equal(calls,1);assert.equal(store.allowanceLedger().reservedUnits,90000000);assert.equal(store.ledger().requests,1);
});
test('all45 models can contribute, typed routes and fallback alias do not perform peer review',async t=>{
  const store=fixture(t),base=options(store,MODEL_CATALOG);const primary=[];
  const result=await runModelFleet({...base,requestRole:async(task,opts)=>{
    if(task.stage==='fleet-primary')primary.push(opts.model);
    if(['drex-v2.0','jev-1.13'].includes(opts.model)){
      assert.equal(task.constraints.reviewTaskId,undefined);const id=await opts.reserve({usd:.01});await opts.onDispatch(id);await opts.onUsage(id,{reportedUsd:.0001});
      return {contributionKind:'typed-decision',typedDecision:{question:'review_queue',choice:'geometry_review'},validation:{valid:true,expectedLabel:'geometry_review',agreesWithExpected:true},execution:{requestedModel:opts.model,returnedModel:opts.model,reportedUsd:.0001}};
    }
    if(opts.model==='free/hy4-flash')assert.equal(task.constraints.reviewTaskId,undefined);
    return base.requestRole(task,opts);
  }});
  assert.equal(new Set(primary).size,MODEL_CATALOG.length);assert.equal(result.coverage.attempted,MODEL_CATALOG.length);
  assert.equal(result.coverage.validContributions,MODEL_CATALOG.length);assert.equal(result.coverage.independentlyReviewed,MODEL_CATALOG.length);
  assert.ok(result.closingReviews.length>=4);assert.ok(store.ledger().requests<=64);
});
test('fresh roster unknown IDs remain visible without invented pricing and removed IDs never dispatch',async t=>{
  const store=fixture(t);const result=await runModelFleet(options(store,THREE,{verifyModels:async()=>({ids:['gpt-6.2-astra','claude-opus-5.5','new-unknown-model'],checkedAt:new Date().toISOString()})}));
  assert.equal(result.agents.find(a=>a.model==='new-unknown-model').code,'PRICING_UNKNOWN');
  assert.equal(result.agents.find(a=>a.model==='gemini-4-hydrogen').code,'MODEL_ABSENT_FROM_ROSTER');assert.equal(result.coverage.assigned,4);
});
test('held-out case details are rejected before any roster or model request',async t=>{
  const store=fixture(t);let calls=0;
  await assert.rejects(runModelFleet(options(store,THREE,{developmentContext:{metrics:{attempted:1,diagnosticPasses:1},cases:[{split:'holdout'}]},verifyModels:async()=>{calls++;}})),{code:'HOLDOUT_LEAKAGE_BLOCKED'});
  assert.equal(calls,0);
});

test('zero runtime disables roster and inference and exposes every deferred model',async t=>{
  const store=fixture(t);let calls=0;
  const result=await runModelFleet(options(store,THREE,{runtimeMs:0,verifyModels:async()=>{calls++;},requestRole:async()=>{calls++;}}));
  assert.equal(calls,0);assert.equal(result.coverage.attempted,0);assert.ok(result.agents.every(a=>a.code==='FLEET_RUNTIME_LIMIT'));
});

test('advancing deadline never starts a new45second call without remaining time',async t=>{
  const store=fixture(t);let clock=100000,calls=0;const base=options(store);
  const result=await runModelFleet({...base,runtimeMs:90000,now:()=>clock,requestRole:async(task,opts)=>{calls++;const response=await base.requestRole(task,opts);clock+=50000;return response;}});
  assert.equal(calls,1);assert.equal(result.coverage.attempted,1);assert.ok(result.agents.slice(1).every(a=>a.code==='FLEET_RUNTIME_LIMIT'));
});

test('fresh public-catalog verification gates each dispatch and never silently uses stale prices',async t=>{
  const store=fixture(t);let calls=0;
  const blocked=await runModelFleet(options(store,THREE,{catalogAudit:{status:'unavailable',hash:'audit-unavailable'},requestRole:async()=>{calls++;}}));
  assert.equal(calls,0);assert.ok(blocked.agents.every(a=>a.code==='PUBLIC_CATALOG_UNVERIFIED'));
  const base=options(store);const partial=await runModelFleet({...base,evaluationHash:'d'.repeat(64),catalogAudit:{status:'verified',hash:'fresh-audit',issuesByModel:{'gemini-4-hydrogen':'PUBLISHED_PRICE_CHANGED'}},requestRole:async(task,opts)=>{calls++;return base.requestRole(task,opts);}});
  assert.equal(partial.agents.find(a=>a.model==='gemini-4-hydrogen').code,'PUBLISHED_PRICE_CHANGED');
  assert.ok(partial.agents.some(a=>a.model!=='gemini-4-hydrogen'&&a.attempted));
});

test('an empty or unavailable roster cannot claim zero-of-zero fleet completeness',async t=>{
  const store=fixture(t);await assert.rejects(runModelFleet(options(store,[],{paidAllowed:false})),{code:'INVALID_FLEET_CATALOG'});
  const blocked=await runModelFleet(options(store,THREE,{verifyModels:async()=>({ids:[],checkedAt:new Date().toISOString()})}));
  assert.equal(blocked.coverage.complete,false);assert.equal(blocked.coverage.attempted,0);
});
