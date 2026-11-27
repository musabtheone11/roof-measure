import test from 'node:test';
import assert from 'node:assert/strict';
import {ROLES,MODEL_BY_ROLE,validateTask,validateResult,evaluateRelease,REQUIRED_RELEASE_CHECKS} from './contracts.mjs';

const a='a'.repeat(64),b='b'.repeat(64);
const binding={sourceRevision:'commit-1',datasetRevision:'data-1',candidateHash:a,policyVersion:'policy-1',inputHashes:[b]};
const task=(role='engineering')=>({schemaVersion:1,id:'task-1',role,actorId:role+'-actor',...binding});
const payloads={ceo:{priority:1,requestedDecision:'needs-human'},extraction:{observations:[{page:1,region:[0,0,20,10],literal:'5/12',unit:null,ambiguity:null}]},reference:{propertyGroup:'property-1',referenceTier:'source-claim',split:'development',contradictions:[]},engineering:{hypothesis:'Numerical issue',patchArtifact:null,predictedMetric:'Preserve known area'},critique:{counterexamples:[],recommendation:'Run analytic test'},verification:{evidenceIds:[]},reporting:{reportArtifact:null},operations:{operation:'diagnose',targetRevision:null,rollbackTarget:null}};
const result=(t=task())=>({schemaVersion:1,taskId:t.id,role:t.role,...binding,decision:'needs-human',findings:[],artifactRefs:[],summary:'Needs trusted execution',payload:payloads[t.role]});

test('every role has strict bounded contracts and runtime-injected identity',()=>{
  assert.equal(Object.keys(MODEL_BY_ROLE).length,8);
  for(const role of ROLES) {
    const t=task(role);assert.deepEqual(validateTask(t),t);
    assert.equal(validateResult(result(t),t).actorId,t.actorId);
    assert.throws(()=>validateResult({...result(t),actorId:'forged-verifier'},t));
    assert.throws(()=>validateResult({...result(t),payload:{...payloads[role],approve:true}},t));
  }
});
test('changed candidate, dataset, policy and inputs invalidate prior result',()=>{
  for(const changed of [{candidateHash:b},{datasetRevision:'changed'},{policyVersion:'changed'},{inputHashes:[a]},{sourceRevision:'changed'}])assert.throws(()=>validateResult({...result(),...changed},task()));
});
test('workflow metadata is strictly typed and original source hashes remain bounded',()=>{
  const constraints={extension:'.txt',actors:Object.fromEntries(ROLES.map(r=>[r,r+'-actor'])),externalProcessingAuthorized:false,cycles:0,stageCount:1,previousTaskId:'previous',sourceHashes:[a,b]};
  assert.deepEqual(validateTask({...task(),constraints}).constraints,constraints);
  for(const changed of [{extension:'.exe'},{actors:{admin:'x'}},{actors:{engineering:1}},{externalProcessingAuthorized:'true'},{cycles:3},{cycles:-1},{stageCount:0},{stageCount:17},{previousTaskId:''},{sourceHashes:[]},{sourceHashes:['not-a-hash']},{sourceHashes:[a,a]},{unknown:true}])assert.throws(()=>validateTask({...task(),constraints:{...constraints,...changed}}));
});
test('CEO envelope must agree with requested decision',()=>{
  const t=task('ceo');
  for(const [decision,requestedDecision]of Object.entries({pass:'approve',revise:'revise',reject:'reject','needs-human':'needs-human'})) {
    assert.equal(validateResult({...result(t),decision,payload:{priority:5,requestedDecision}},t).decision,decision);
    for(const other of ['approve','revise','reject','needs-human'].filter(x=>x!==requestedDecision))assert.throws(()=>validateResult({...result(t),decision,payload:{priority:5,requestedDecision:other}},t));
  }
});
test('limits, evidence, identities, and missing reference identity fail closed',()=>{
  assert.throws(()=>validateTask({...task(),constraints:{maxAttempts:3}}));
  assert.throws(()=>validateTask({...task(),constraints:{maxOutputTokens:-1}}));
  assert.throws(()=>validateTask({...task(),inputHashes:[]}));
  assert.throws(()=>validateResult({...result(),summary:'x'.repeat(65537)},task()));
  assert.throws(()=>validateResult({...result(),decision:'pass',findings:[{code:'bad',severity:'critical',evidence:['source'],message:'Must block'}]},task()));
  assert.throws(()=>validateResult({...result(),findings:[{code:'bad',severity:'warning',evidence:[],message:'No evidence'}]},task()));
  const t=task('reference');assert.throws(()=>validateResult({...result(t),payload:{...payloads.reference,propertyGroup:null}},t));
});

function releaseFixture(scope='production') {
  const actors={author:'author',critic:'critic',verifier:'verifier',ceo:'ceo'};
  const evidence=new Map(REQUIRED_RELEASE_CHECKS.map(check=>[check,{id:check,issuer:'trusted-harness',...binding,check,actorId:check==='baseline'?'baseline-verifier':'verifier',commandId:'harness-'+check,harnessVersion:'v1',artifactHash:b,startedAt:1,finishedAt:2,exitCode:0}]));
  const approval={id:'approval',issuer:'authenticated-human',...binding,actorId:'owner',scope,decision:'approve',approvedAt:3};
  const bundle={...binding,scope,actors,ceoDecision:'approve',criticalFindings:[],budget:{capUsd:1,spentUsd:0.1,reservedUsd:0.2},holdoutIsolationVerified:true,evidenceIds:[...evidence.keys()],approvalId:'approval'};
  const callbacks={lookupEvidence:id=>evidence.get(id),lookupApproval:id=>id===approval.id?approval:null};
  return {bundle,evidence,approval,callbacks};
}
test('trusted complete evidence and scoped human approval permit exact bundle',()=>{
  const f=releaseFixture();assert.deepEqual(evaluateRelease(f.bundle,f.callbacks),{eligible:true,status:'eligible',reasons:[]});
  const s=releaseFixture('staging');s.bundle.evidenceIds=s.bundle.evidenceIds.filter(x=>x!=='staging');assert.equal(evaluateRelease(s.bundle,s.callbacks).eligible,true);
});
test('model/CLI pass booleans and CEO approval cannot override missing or failing checks',()=>{
  const f=releaseFixture();
  assert.equal(evaluateRelease({...f.bundle,allChecksPassed:true}).eligible,false);
  f.evidence.get('verification').exitCode=1;
  assert.equal(evaluateRelease(f.bundle,f.callbacks).eligible,false);
  f.evidence.delete('verification');assert.equal(evaluateRelease(f.bundle,f.callbacks).eligible,false);
});
test('stale or forged evidence, self review, missing isolation and unknown budgets block release',()=>{
  for(const field of ['candidateHash','datasetRevision','policyVersion','sourceRevision']) {
    const f=releaseFixture();f.evidence.get('verification')[field]=field==='candidateHash'?b:'changed';
    assert.equal(evaluateRelease(f.bundle,f.callbacks).eligible,false);
  }
  const f=releaseFixture();f.bundle.actors.verifier='author';assert.equal(evaluateRelease(f.bundle,f.callbacks).eligible,false);
  const g=releaseFixture();g.evidence.get('verification').issuer='model';assert.equal(evaluateRelease(g.bundle,g.callbacks).eligible,false);
  const h=releaseFixture();h.evidence.get('baseline').actorId='verifier';assert.equal(evaluateRelease(h.bundle,h.callbacks).eligible,false);
  const i=releaseFixture();i.bundle.holdoutIsolationVerified=false;assert.equal(evaluateRelease(i.bundle,i.callbacks).eligible,false);
  const j=releaseFixture();j.bundle.budget.reservedUsd=2;assert.equal(evaluateRelease(j.bundle,j.callbacks).eligible,false);
  const k=releaseFixture();k.bundle.criticalFindings=['unresolved'];assert.equal(evaluateRelease(k.bundle,k.callbacks).eligible,false);
});
test('human approvals bind exact scope and immutable candidate/dataset/policy',()=>{
  for(const change of [{scope:'staging'},{candidateHash:b},{datasetRevision:'other'},{policyVersion:'other'},{issuer:'model'},{decision:'reject'}]) {
    const f=releaseFixture();Object.assign(f.approval,change);assert.equal(evaluateRelease(f.bundle,f.callbacks).eligible,false);
  }
  const f=releaseFixture();assert.equal(evaluateRelease({...f.bundle,approvalId:null},f.callbacks).eligible,false);
});
