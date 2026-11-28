import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {OrgStore} from './store.mjs';
import {textAllowanceReservationUnits} from './model-catalog.mjs';
import {PLAIN_CLASSIFIER_PROTOCOL} from './plain-classifier.mjs';
import {FREE_DREX_DECISION_MODEL as MODEL,FREE_DREX_DECISION_PROTOCOL as PROTOCOL,validateDecisionResponse} from './decision-provider.mjs';
import {FREE_DREX_ROUTING_MESSAGE,findFreeDrexRoutingEvidence,freeDrexDecisionAdmission,consumeFreeDrexDecisionDispatch,
  authorizeFreeDrexDecisionDispatch,recordFreeDrexDecisionQualification} from './route-evidence.mjs';

const SHA='a'.repeat(64),context={metrics:{attempted:1,diagnosticPasses:0},pdfReview:{checked:1,failed:0}};
const limits={requestLimit:20,maxUsd:0,hourUsd:3,dayUsd:3,weekUsd:20,monthUsd:80};
function fixture(t){const directory=mkdtempSync(join(tmpdir(),'roof-route-proof-')),now=Date.now(),store=new OrgStore(directory,{now:()=>now});store.setControl('running');t.after(()=>{store.close();rmSync(directory,{recursive:true,force:true});});return store;}
const hold=store=>({reservedUnits:textAllowanceReservationUnits(MODEL,8000),remainingUnits:1000000000,observedAt:store.now(),expiresAt:store.now()+3600000,periodKey:'fixture-period',unlimited:false});
function retained(store,{status=400,type='invalid_request_error',message=FREE_DREX_ROUTING_MESSAGE,dispatch=true}={}){
  const task={schemaVersion:1,id:'retained-chat-task',role:'operations',actorId:'old-worker',sourceRevision:'old-source',datasetRevision:'old-data',candidateHash:SHA,policyVersion:'old-policy',inputHashes:[SHA]};
  store.enqueue(task);const lease=store.claim('old-worker');let attemptId=null;
  if(dispatch){attemptId=store.reserve(task.id,'old-worker',lease.fence,{...limits,allowance:hold(store)});store.dispatch(attemptId,'old-worker',lease.fence);store.event(task.id,'fleet-dispatched',{model:MODEL,requestProtocol:PLAIN_CLASSIFIER_PROTOCOL});store.settle(attemptId,'old-worker',lease.fence,{reportedUsd:null});}
  store.finish(task.id,'old-worker',lease.fence,{status:'failed',error:'UPSTREAM_HTTP',result:{code:'UPSTREAM_HTTP',errorDetails:{httpStatus:status,type,message,bodyStatus:'parsed'}}});
  store.event(null,'fleet-model-circuit-open',{model:MODEL,status,code:'UPSTREAM_HTTP',requestProtocol:PLAIN_CLASSIFIER_PROTOCOL});return {task,attemptId};
}
function candidate(store,{id='new-typed-task',bind=true}={}){
  const proof=findFreeDrexRoutingEvidence(store),saved=store.putArtifact(proof.bytes),packet=store.putArtifact(Buffer.from(JSON.stringify(context)));
  const task={schemaVersion:1,id,role:'operations',actorId:'new-worker',sourceRevision:'new-source',datasetRevision:'new-data',candidateHash:'b'.repeat(64),policyVersion:PROTOCOL,
    inputHashes:[SHA,packet.hash,...(bind?[saved.hash]:[])],artifacts:[packet.hash,saved.hash],stage:'fleet-decision-route-primary'};
  store.enqueue(task);const lease=store.claim('new-worker');assert.equal(lease.id,id);
  const attemptId=store.reserve(id,'new-worker',lease.fence,{...limits,allowance:hold(store)});return {task,lease,attemptId,proof};
}
function dispatch(store,c){return store.dispatch(c.attemptId,'new-worker',c.lease.fence,{beforeDispatch:()=>consumeFreeDrexDecisionDispatch(store,{taskId:c.task.id,attemptId:c.attemptId,workerId:'new-worker',fence:c.lease.fence})});}
function complete(store,c,{rawMissing=false}={}){
  const receipt=authorizeFreeDrexDecisionDispatch(store,{taskId:c.task.id,attemptId:c.attemptId});
  const rawDecision={object:'decision',model:MODEL,answers:{review_queue:{type:'choice',choice:'geometry_review'}}};
  const execution={requestedModel:MODEL,returnedModel:MODEL,settings:{route:'decisions',protocol:PROTOCOL},routeMigration:receipt};
  const response={...validateDecisionResponse(rawDecision,context,{model:MODEL}),execution};
  const saved=store.putArtifact(Buffer.from(JSON.stringify(response))),original=store.putArtifact(Buffer.from(JSON.stringify({execution,content:JSON.stringify(rawDecision)})));
  store.settle(c.attemptId,'new-worker',c.lease.fence,{reportedUsd:0});
  store.finish(c.task.id,'new-worker',c.lease.fence,{status:'complete',result:{primaryValidated:true,resultHash:saved.hash,rawResponseHash:rawMissing?null:original.hash}});
}
test('captured real routing error shape resolves only from a dispatched fenced failed task',t=>{
  const store=fixture(t),old=retained(store),proof=findFreeDrexRoutingEvidence(store);
  assert.equal(proof.model,MODEL);assert.equal(proof.failedTaskId,old.task.id);assert.equal(proof.failedAttemptId,old.attemptId);assert.match(proof.evidenceHash,/^[a-f0-9]{64}$/);
  assert.equal(proof.error.message,FREE_DREX_ROUTING_MESSAGE);assert.equal(freeDrexDecisionAdmission(store).qualified,false);
  const missing=fixture(t);retained(missing,{dispatch:false});assert.equal(findFreeDrexRoutingEvidence(missing),null);
  for(const edit of [{status:403},{type:'other_error'},{message:FREE_DREX_ROUTING_MESSAGE.replace('free/drex-v2.0','drex-v2.0')}]){const forged=fixture(t);retained(forged,edit);assert.equal(findFreeDrexRoutingEvidence(forged),null);}
});
test('migration consumption and generic dispatch commit atomically or both roll back',t=>{
  const store=fixture(t);retained(store);const c=candidate(store);
  assert.throws(()=>store.dispatch(c.attemptId,'new-worker',c.lease.fence,{beforeDispatch:()=>{consumeFreeDrexDecisionDispatch(store,{taskId:c.task.id,attemptId:c.attemptId,workerId:'new-worker',fence:c.lease.fence});throw Error('Rollback fixture');}}));
  assert.equal(store.events().some(e=>e.kind==='decision-route-probe-dispatched'),false);assert.equal(store.ledger(c.task.id).attempts[0].state,'reserved');
  dispatch(store,c);assert.equal(store.events().filter(e=>e.kind==='decision-route-probe-dispatched').length,1);assert.equal(store.ledger(c.task.id).attempts[0].state,'dispatched');
  assert.equal(authorizeFreeDrexDecisionDispatch(store,{taskId:c.task.id,attemptId:c.attemptId}).evidenceHash,c.proof.evidenceHash);
});
test('an unrelated task cannot attach a valid routing proof or consume the probe',t=>{
  const store=fixture(t);retained(store);const c=candidate(store,{bind:false});
  assert.throws(()=>dispatch(store,c),{code:'ROUTE_MIGRATION_BINDING_MISMATCH'});assert.equal(store.events().some(e=>e.kind==='decision-route-probe-dispatched'),false);
  assert.throws(()=>authorizeFreeDrexDecisionDispatch(store,{taskId:c.task.id,attemptId:c.attemptId}),{code:'ROUTE_MIGRATION_REQUIRED'});
});
test('cancellation keeps consumed one-shot and unknown allowance while qualification stays absent',t=>{
  const store=fixture(t);retained(store);const c=candidate(store);dispatch(store,c);store.cancel(c.task.id);
  assert.equal(freeDrexDecisionAdmission(store).ready,false);assert.equal(store.allowanceLedger().attempts.find(a=>a.attempt_id===c.attemptId).state,'unknown');
  assert.throws(()=>recordFreeDrexDecisionQualification(store,c.task.id));
  const next=candidate(store,{id:'different-evaluation'});assert.throws(()=>dispatch(store,next));assert.equal(store.events().filter(e=>e.kind==='decision-route-probe-dispatched').length,1);
});
test('only original typed evidence and fenced completion qualifies; marker or flags alone do not',t=>{
  const store=fixture(t);retained(store);const c=candidate(store);dispatch(store,c);complete(store,c);
  assert.equal(freeDrexDecisionAdmission(store).qualified,true);recordFreeDrexDecisionQualification(store,c.task.id);recordFreeDrexDecisionQualification(store,c.task.id);
  assert.equal(store.events().filter(e=>e.kind==='decision-route-qualified').length,1);
  const missing=fixture(t);retained(missing);const other=candidate(missing);dispatch(missing,other);complete(missing,other,{rawMissing:true});
  assert.equal(freeDrexDecisionAdmission(missing).ready,false);assert.throws(()=>recordFreeDrexDecisionQualification(missing,other.task.id));
  const forged=fixture(t);retained(forged);forged.event('invented','decision-route-qualified',{model:MODEL,protocol:PROTOCOL,evidenceHash:'f'.repeat(64)});
  assert.equal(freeDrexDecisionAdmission(forged).ready,false);
});
test('later authentication,403,identity or new-route failure always wins over an old valid proof',t=>{
  for(const [kind,detail]of [['fleet-provider-circuit-open',{status:401}],['fleet-model-circuit-open',{model:MODEL,status:403}],['fleet-model-circuit-open',{model:MODEL,code:'MODEL_MISMATCH'}],['decision-route-failed',{model:MODEL,protocol:PROTOCOL,code:'TIMEOUT'}]]){
    const store=fixture(t);retained(store);const c=candidate(store);dispatch(store,c);complete(store,c);recordFreeDrexDecisionQualification(store,c.task.id);store.event(null,kind,detail);
    assert.equal(freeDrexDecisionAdmission(store).ready,false);
  }
});
