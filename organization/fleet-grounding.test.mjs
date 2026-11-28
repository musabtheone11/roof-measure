// Independent regressions for the hosted 46085806692 numerical misread.
// No uploaded/private files, inference, or network calls are needed by these tests.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {OrgStore} from './store.mjs';
import {validateTask,validateResult} from './contracts.mjs';
import {validateDecisionResponse} from './decision-provider.mjs';
import {buildMetricFacts,validateMetricClaims,runModelFleet} from './model-fleet.mjs';
import {MODEL_CATALOG} from './model-catalog.mjs';

const SOURCE='1ed393399b72cb9ee413d18c1f3df6bbedd9e2a1';
const binding={sourceRevision:SOURCE,datasetRevision:'hosted-regression-46085806692',
  candidateHash:'a'.repeat(64),policyVersion:'fleet-regression-v1',inputHashes:['b'.repeat(64)]};
const ceoTask=()=>({schemaVersion:1,id:'ceo-regression',role:'ceo',actorId:'assigned-ceo',...binding,
  constraints:{requireMetricClaims:true,reviewTaskId:'critic-independent'}});
function ceoResult(task,claims) {
  return {schemaVersion:1,taskId:task.id,role:task.role,...binding,decision:'reject',findings:[],artifactRefs:[],
    summary:'The trusted numerical gates remain authoritative.',payload:{priority:10,requestedDecision:'reject'},metricClaims:claims,
    peerReview:{taskId:task.constraints.reviewTaskId,decision:'revise',findings:['Reconcile the case inventory with its independent evidence.']}};
}

// Frozen counts from the actual hosted artifact. They deliberately differ from
// the schema-valid CEO's incorrect prose (4 failed; no evaluation-split passes).
const HOSTED_CONTEXT={metrics:{attempted:12,diagnosticPasses:4,reviewRequired:8,traceFailures:0,misclassifiedEdges:0,
  splits:{development:{cases:6,diagnosticPasses:1,reviewRequired:5},
    validation:{cases:3,diagnosticPasses:1,reviewRequired:2},holdout:{cases:3,diagnosticPasses:2,reviewRequired:1}}},
  pdfReview:{checked:12,failed:0}};
const DEVELOPMENT_CONTEXT={metrics:{scope:'development-only',attempted:6,diagnosticPasses:1,reviewRequired:5,traceFailures:0,misclassifiedEdges:0},pdfReview:{checked:6,failed:0}};

test('hosted 4-pass/8-review facts reject the CEO misread and unsupported split/classification claims',()=>{
  const facts=buildMetricFacts(HOSTED_CONTEXT);
  assert.equal(facts['metrics.attempted'],12);
  assert.equal(facts['metrics.diagnosticPasses'],4);
  assert.equal(facts['metrics.reviewRequired'],8);
  assert.equal(facts['metrics.splits.validation.diagnosticPasses'],1);
  assert.equal(facts['metrics.splits.holdout.diagnosticPasses'],2);
  assert.equal(facts['metrics.misclassifiedEdges'],0);
  assert.equal(validateMetricClaims({...facts},facts),true);
  for(const wrong of [{'metrics.reviewRequired':4},
    {'metrics.splits.validation.diagnosticPasses':0},{'metrics.splits.holdout.diagnosticPasses':0},
    {'metrics.misclassifiedEdges':1},{'metrics.diagnosticPasses':'4'},{'metrics.diagnosticPasses':NaN}])
    assert.throws(()=>validateMetricClaims({...facts,...wrong},facts),{code:'METRIC_CLAIMS_MISMATCH'});
  for(const missingOrInvented of [{},{...facts,imaginedConfidence:99}])
    assert.throws(()=>validateMetricClaims(missingOrInvented,facts),{code:'METRIC_CLAIMS_MISMATCH'});
  const missing={...facts};delete missing['metrics.reviewRequired'];
  assert.throws(()=>validateMetricClaims(missing,facts),{code:'METRIC_CLAIMS_MISMATCH'});
});

test('review-required is derived from trusted attempted/pass counts, never from model prose',()=>{
  const facts=buildMetricFacts({metrics:{attempted:12,diagnosticPasses:4}});
  assert.equal(facts['metrics.reviewRequired'],8);
  assert.throws(()=>buildMetricFacts({metrics:{attempted:12,diagnosticPasses:4,reviewRequired:4}}));
  assert.throws(()=>buildMetricFacts({metrics:{attempted:12,diagnosticPasses:13}}));
  assert.throws(()=>buildMetricFacts({metrics:{attempted:12,diagnosticPasses:NaN}}));
});

function fleetFixture(t,ids=['gpt-6.2-astra','gemini-4-argon','claude-opus-5.5']) {
  const root=mkdtempSync(join(tmpdir(),'roof-fleet-blackbox-')),store=new OrgStore(root);
  t.after(()=>{store.close();rmSync(root,{recursive:true,force:true});});
  const catalog=ids.map(id=>structuredClone(MODEL_CATALOG.find(m=>m.id===id)));
  return {store,catalog,evaluationHash:'hosted-grounding-evaluation',sourceRevision:SOURCE,inputHash:'b'.repeat(64),
    minimumDispatchIntervalMs:0,
    paidAllowed:true,apiKey:'test-key-never-used-for-network',developmentContext:DEVELOPMENT_CONTEXT,aggregateContext:HOSTED_CONTEXT,
    verifyModels:async()=>({ids:catalog.map(m=>m.id),checkedAt:new Date().toISOString()})};
}
function rolePayload(role) {
  return {ceo:{priority:1,requestedDecision:'approve'},engineering:{hypothesis:'Check the known fragment inventory.',patchArtifact:null,predictedMetric:'Fewer missed roof edges.'},
    critique:{counterexamples:['An accurate area can accompany missed edges.'],recommendation:'Check the independent per-edge oracle.'},
    reference:{propertyGroup:null,referenceTier:'needs-human',split:'quarantine',contradictions:[]},
    extraction:{observations:[]},verification:{evidenceIds:[]},reporting:{reportArtifact:null},
    operations:{operation:'diagnose',targetRevision:null,rollbackTarget:null}}[role];
}
function validModelResponse(task,options) {
  const result={schemaVersion:1,taskId:task.id,role:task.role,
    ...Object.fromEntries(['sourceRevision','datasetRevision','candidateHash','policyVersion','inputHashes'].map(k=>[k,task[k]])),
    decision:'pass',findings:[],artifactRefs:[],summary:'Advisory evidence check only.',payload:rolePayload(task.role),
    metricClaims:{...options.context.trustedMetricFacts}};
  if(task.constraints.reviewTaskId)result.peerReview={taskId:task.constraints.reviewTaskId,decision:'pass',findings:['The peer contribution remains bound to the supplied deterministic evidence.']};
  return {result,execution:{requestedModel:options.model,returnedModel:options.model,reportedUsd:.0001}};
}
async function dispatchRecorded(options) {
  const reservation=await options.reserve({usd:.5});await options.onDispatch(reservation);await options.onUsage(reservation,{reportedUsd:.0001});
}

test('a schema-valid CEO numerical contradiction is quarantined after actual recorded dispatch',async t=>{
  const fixture=fleetFixture(t,['claude-opus-5.5']);let calls=0;
  const report=await runModelFleet({...fixture,requestRole:async(task,options)=>{
    calls++;await dispatchRecorded(options);const response=validModelResponse(task,options);
    response.result.metricClaims['metrics.reviewRequired']=4;
    return response;
  }});
  assert.equal(calls,1);assert.equal(report.coverage.assigned,1);assert.equal(report.coverage.attempted,1);
  assert.equal(report.coverage.validContributions,0);
  assert.equal(report.agents[0].code,'METRIC_CLAIMS_MISMATCH');
  assert.equal(report.agents[0].primaryValidated,false);
  assert.equal(report.productionReleaseApproved,false);
  assert.equal(fixture.store.ledger().requests,1);
});

test('an adapter invocation/reservation without dispatch cannot claim a model participated',async t=>{
  const fixture=fleetFixture(t,['claude-opus-5.5']);let calls=0;
  const report=await runModelFleet({...fixture,requestRole:async(task,options)=>{
    calls++;await options.reserve({usd:.5});return validModelResponse(task,options);
  }});
  assert.equal(calls,1);assert.equal(fixture.store.ledger().requests,1);
  assert.equal(report.coverage.attempted,0);assert.equal(report.coverage.validContributions,0);
  assert.equal(report.agents[0].code,'DISPATCH_EVIDENCE_MISSING');
  assert.equal(fixture.store.ledger().reservedUsd,0);
});

test('unpriced and absent models remain explicit assignments with no invented model call',async t=>{
  const fixture=fleetFixture(t,['claude-opus-5.5']);
  fixture.catalog.push({id:'new-unpriced-model',family:'unqualified',pricingStatus:'unknown',routeClaim:'unverified'});
  let calls=0;
  const report=await runModelFleet({...fixture,verifyModels:async()=>({ids:['new-unpriced-model'],checkedAt:new Date().toISOString()}),
    requestRole:async()=>{calls++;throw new Error('Should never dispatch');}});
  assert.equal(calls,0);assert.equal(report.coverage.assigned,2);assert.equal(report.coverage.attempted,0);
  assert.equal(report.agents.find(a=>a.model==='new-unpriced-model').code,'PRICING_UNKNOWN');
  assert.equal(report.agents.find(a=>a.model==='claude-opus-5.5').code,'MODEL_ABSENT_FROM_ROSTER');
});

test('valid role responses cannot qualify same-lineage peer approval as independent',async t=>{
  const fixture=fleetFixture(t,['gpt-6.2-astra','gpt-6.2-sol']);
  const report=await runModelFleet({...fixture,requestRole:async(task,options)=>{await dispatchRecorded(options);return validModelResponse(task,options);}});
  assert.equal(report.coverage.attempted,2);assert.equal(report.coverage.independentlyReviewed,0);
  assert.ok(report.agents.every(a=>a.reviewStatus==='blocked'));
  assert.ok(report.agents.every(a=>a.reviewCode==='NO_QUALIFIED_DISTINCT_REVIEWER'));
});

test('different-model peer scopes remain explicit and completed evaluations replay without more dispatch',async t=>{
  const fixture=fleetFixture(t);const calls=[];
  const requestRole=async(task,options)=>{
    calls.push({task:structuredClone(task),model:options.model,context:structuredClone(options.context)});
    await dispatchRecorded(options);return validModelResponse(task,options);
  };
  const report=await runModelFleet({...fixture,requestRole});
  assert.equal(report.coverage.assigned,3);assert.equal(report.coverage.attempted,3);
  assert.equal(report.coverage.validContributions,3);assert.equal(report.coverage.independentlyReviewed,3);
  assert.equal(report.closingReviews.length,1);assert.equal(calls.length,4);
  for(const call of calls) {
    const target=call.context.peerReviewTarget;
    const aggregate=call.task.role==='ceo'||(call.task.stage==='fleet-closing-review'&&target?.contribution?.result?.role==='ceo');
    assert.equal(call.context.trustedMetricFacts['metrics.attempted'],aggregate?12:6);
    assert.equal(Object.hasOwn(call.context.trustedMetricFacts,'metrics.splits.holdout.diagnosticPasses'),aggregate);
    if(target) {
      assert.notEqual(target.model,call.model);
      assert.equal(target.taskId,call.task.constraints.reviewTaskId);
      assert.deepEqual(target.trustedMetricFacts,target.contribution.result.metricClaims);
    }
  }
  const requestCount=fixture.store.ledger().requests;
  const replay=await runModelFleet({...fixture,requestRole});
  assert.equal(calls.length,4);assert.equal(fixture.store.ledger().requests,requestCount);
  assert.equal(replay.planHash,report.planHash);
  assert.ok(replay.agents.every(a=>a.reused));
  assert.equal(replay.coverage.independentlyReviewed,3);
});

test('a schema-valid but incorrect typed routing answer is not a grounded contribution',async t=>{
  const fixture=fleetFixture(t,['drex-v2.0']);let calls=0;
  const report=await runModelFleet({...fixture,requestRole:async(task,options)=>{
    calls++;await dispatchRecorded(options);
    const context={metrics:{attempted:6,diagnosticPasses:1},pdfReview:{checked:6,failed:0}};
    const typed=validateDecisionResponse({object:'decision',answers:{review_queue:{type:'choice',choice:'source_review',confidence:.99}}},context);
    return {...typed,execution:{requestedModel:options.model,returnedModel:options.model,reportedUsd:.0001}};
  }});
  assert.equal(calls,1);assert.equal(report.coverage.attempted,1);
  assert.equal(report.coverage.validContributions,0);
  assert.equal(report.agents[0].code,'DECISION_GROUNDING_MISMATCH');
  assert.equal(report.agents[0].primaryValidated,false);
});

test('a fleet response cannot mint its actor, review itself, or reuse a different evidence bundle',()=>{
  const task=ceoTask(),result=ceoResult(task,{'metrics.attempted':12});
  assert.equal(validateResult(result,task).actorId,'assigned-ceo');
  for(const altered of [{...result,actorId:'independent-verifier'},
    {...result,peerReview:{...result.peerReview,taskId:task.id}},
    {...result,peerReview:{...result.peerReview,taskId:'unassigned-task'}},
    {...result,candidateHash:'c'.repeat(64)},
    {...result,datasetRevision:'later-data'}])assert.throws(()=>validateResult(altered,task));
  assert.throws(()=>validateTask({...task,constraints:{...task.constraints,reviewTaskId:task.id}}));
  for(const claims of [undefined,{'metrics.attempted':'12'},{'metrics.attempted':NaN}])
    assert.throws(()=>validateResult(ceoResult(task,claims),task));
});

test('typed Decision contributions never manufacture a prose review or metric echo',()=>{
  const context={metrics:{attempted:12,diagnosticPasses:4,reviewRequired:8},pdfReview:{checked:12,failed:0}};
  const response=choice=>({object:'decision',answers:{review_queue:{type:'choice',choice,confidence:.9}}});
  const correct=validateDecisionResponse(response('geometry_review'),context);
  assert.equal(correct.validation.agreesWithExpected,true);
  assert.equal(correct.validation.metricClaimsApplicable,false);
  assert.equal(correct.validation.peerReviewApplicable,false);
  assert.equal(correct.validation.releaseAuthority,false);
  assert.equal(Object.hasOwn(correct,'metricClaims'),false);
  assert.equal(Object.hasOwn(correct,'peerReview'),false);
  assert.equal(validateDecisionResponse(response('source_review'),context).validation.agreesWithExpected,false);
});

test('an unknown debit from one model blocks a different model under the same weekly ledger',t=>{
  const root=mkdtempSync(join(tmpdir(),'roof-fleet-shared-budget-'));
  const store=new OrgStore(root);
  t.after(()=>{store.close();rmSync(root,{recursive:true,force:true});});
  store.setControl('running');
  const limits={usd:.524288,requestLimit:64,maxUsd:2,hourUsd:2,dayUsd:3,weekUsd:.75,monthUsd:80};
  store.enqueue({id:'model-a',workflowId:'first-evaluation'});
  const first=store.claim('worker-a');
  const request=store.reserve(first.id,'worker-a',first.fence,limits);
  store.dispatch(request,'worker-a',first.fence);
  store.settle(request,'worker-a',first.fence,{reportedUsd:null});
  store.finish(first.id,'worker-a',first.fence,{status:'failed',error:'Unknown provider outcome'});
  store.enqueue({id:'model-b',workflowId:'another-evaluation'});
  const second=store.claim('worker-b');
  assert.throws(()=>store.reserve(second.id,'worker-b',second.fence,limits),{code:'BUDGET_LIMIT'});
  assert.equal(store.ledger().unknownBillingRequests,1);
  assert.equal(store.ledger().reservedUsd,.524288);
  assert.equal(store.ledger().requests,1);
});
