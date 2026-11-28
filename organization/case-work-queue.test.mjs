import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {OrgStore} from './store.mjs';
import {MODEL_CATALOG,textAllowanceReservationUnits} from './model-catalog.mjs';
import {buildMetricFacts} from './model-fleet.mjs';
import {CASE_WORK_PROTOCOL,hashCaseWorkPacket,qualifyCaseWorkers,buildCaseWorkPlan,runCaseWorkQueue} from './case-work-queue.mjs';
const digest=x=>createHash('sha256').update(x).digest('hex');
const QWEN='free/qwen-3.8-max',GEMINI='free/gemini-3.8-flash';
const identity={engineSourceHashes:{'autotrace.js':'a'.repeat(64)},generatorSourceSha256:'b'.repeat(64)};
function result(task,context){return{schemaVersion:1,taskId:task.id,role:task.role,sourceRevision:task.sourceRevision,datasetRevision:task.datasetRevision,
  candidateHash:task.candidateHash,policyVersion:task.policyVersion,inputHashes:task.inputHashes,decision:'revise',findings:[{code:'COUNTEREXAMPLE',severity:'warning',message:'A targeted regression is required.',evidence:['verification']}],
  artifactRefs:[],summary:'A bounded engineering hypothesis; no implemented fix.',metricClaims:context.trustedMetricFacts,
  payload:task.role==='engineering'?{hypothesis:'Boundary fitting can shorten the supported edge; test a constrained fitting invariant.',patchArtifact:null,predictedMetric:'Compare the supplied edge correspondence with the unchanged oracle.'}:{counterexamples:['Keep the noisy edge case in regression.'],recommendation:'Validate the proposed invariant in the deterministic harness.'},
  ...(task.constraints.reviewTaskId?{peerReview:{taskId:task.constraints.reviewTaskId,decision:'pass',findings:['The hypothesis is grounded in the exact supplied counterexample; it remains unimplemented.']}}:{})};}
function fixture(t,{reviewer=true}={}){
  const dir=mkdtempSync(join(tmpdir(),'roof-case-work-')),store=new OrgStore(join(dir,'state'));store.setControl('running');t.after(()=>{store.close();rmSync(dir,{recursive:true,force:true});});
  const catalog=MODEL_CATALOG.filter(m=>[QWEN,GEMINI,'free/drex-v2.0'].includes(m.id)),roster={ids:catalog.map(m=>m.id),checkedAt:new Date().toISOString()},catalogAudit={status:'verified',checkedAt:roster.checkedAt,hash:'c'.repeat(64),issuesByModel:{}};
  function hold(model){return{reservedUnits:textAllowanceReservationUnits(model,8000),remainingUnits:2000000000,observedAt:store.now(),expiresAt:store.now()+3600000,periodKey:'test-period',unlimited:false};}
  function qualify(model,role){
    const context={metrics:{attempted:1,diagnosticPasses:0,reviewRequired:1},pdfReview:{checked:1,failed:0}};context.trustedMetricFacts=buildMetricFacts(context);
    const saved=store.putArtifact(JSON.stringify(context)),task={schemaVersion:1,id:'qualified-'+role+'-'+digest(model).slice(0,12),workflowId:'qualification-'+role,role,actorId:'fleet-'+digest(model).slice(0,24),sourceRevision:'original-engine-source',datasetRevision:'qualified-test',candidateHash:'d'.repeat(64),policyVersion:'qualified-test',inputHashes:[saved.hash],artifacts:[saved.hash],maxAttempts:1,constraints:{requireMetricClaims:true,maxOutputTokens:8000}};
    store.enqueue(task);const lease=store.claim('qualification-worker'),attempt=store.reserve(task.id,'qualification-worker',lease.fence,{usd:0,requestLimit:8,maxUsd:0,hourUsd:3,dayUsd:3,weekUsd:20,monthUsd:80,allowance:hold(model)});
    store.dispatch(attempt,'qualification-worker',lease.fence);store.event(task.id,'fleet-dispatched',{model});store.settle(attempt,'qualification-worker',lease.fence,{reportedUsd:0});
    const response={result:result(task,context),execution:{requestedModel:model,returnedModel:model,promptVersion:'organization-v2-compact',settings:{route:'chat/completions',responseFormat:'json_object'},transport:'json'}};
    const artifact=store.putArtifact(JSON.stringify(response));store.finish(task.id,'qualification-worker',lease.fence,{status:'complete',result:{resultHash:artifact.hash,primaryValidated:true}});return {task,response,artifact};
  }
  const authorProof=qualify(QWEN,'engineering');if(reviewer)qualify(GEMINI,'critique');
  function packet(caseId='roof-1',extra={}){
    const input=store.putArtifact('stable-generated-input-'+caseId),caseHash=input.hash,propertyGroup='synthetic:'+caseId;
    const manifest=store.putArtifact(JSON.stringify({schemaVersion:1,protocol:'cloud-case-work-membership-v1',measurementIdentity:identity,cases:[{caseId,propertyGroup,split:'development',inputHash:input.hash}]}));
    const packet={schemaVersion:1,split:'development',caseId,propertyGroup,caseHash,measurementSourceRevision:'measurement-original',sourceManifestHash:manifest.hash,
      metrics:{attempted:1,diagnosticPasses:0,reviewRequired:1,extraRoofEdges:1},pdfReview:{checked:1,failed:0},
      verification:{diagnosticPass:false,issues:[{code:'EDGE_LENGTH_OUTSIDE_DIAGNOSTIC_TOLERANCE',detail:'BC'},{code:'EXTRAEDGES',detail:[{type:'eave',estimatedFt:1.29}]}]},
      actual:{projectedAreaSqFt:100,slopedAreaSqFt:120},reportObservation:{status:'REVIEW REQUIRED',quantities:[]},inputHashes:[input.hash,manifest.hash],...extra};packet.packetHash=hashCaseWorkPacket(packet);return packet;
  }
  const calls=[];const requestRole=async(task,options)=>{
    calls.push({task,model:options.model,context:options.context});const attempt=await options.reserve({usd:0,allowance:hold(options.model)});await options.onDispatch(attempt);await options.onUsage(attempt,{reportedUsd:0,reportedAllowanceUnits:null,estimatedAllowanceUnits:200});
    const response={result:result(task,options.context),execution:{requestedModel:options.model,returnedModel:options.model,promptVersion:'organization-v2-compact',settings:{route:'chat/completions',responseFormat:'json_object'},transport:'json'}};
    options.onResponse?.({execution:response.execution,content:JSON.stringify(response.result)});return response;
  };
  return{store,catalog,roster,catalogAudit,hold,packet,calls,requestRole,authorProof,qualify,options:{store,catalog,roster,catalogAudit,sourceRevision:'operator-1',apiKey:'mock-no-network',paidAllowed:true,requestRole,minimumDispatchIntervalMs:0}};
}
test('hash-verified exact-role workers qualify and literal/forged role evidence does not',t=>{
  const f=fixture(t),qualified=qualifyCaseWorkers(f);assert.deepEqual(qualified.workers.map(w=>[w.model,w.role]).sort(),[[GEMINI,'critique'],[QWEN,'engineering']].sort(),JSON.stringify(qualified.excluded));
  assert.ok(qualified.excluded.some(r=>r.model==='free/drex-v2.0'&&r.code==='ROLE_PROTOCOL_NOT_ELIGIBLE'));
  const db=f.store.db;db.prepare('UPDATE tasks SET result=? WHERE id=?').run(JSON.stringify({resultHash:'e'.repeat(64),primaryValidated:true}),f.authorProof.task.id);
  assert.equal(qualifyCaseWorkers(f).workers.some(w=>w.model===QWEN),false);
});
test('plans bind distinct geometry questions and reuse original evidence on operator-only source changes',t=>{
  const f=fixture(t),p=f.packet(),first=buildCaseWorkPlan({store:f.store,measurementIdentity:identity,casePackets:[p]});
  assert.equal(first.items.length,2);assert.equal(new Set(first.items.map(i=>i.workId)).size,2);
  const moved={...p,measurementSourceRevision:'operator-only-new-commit'};moved.packetHash=hashCaseWorkPacket(moved);
  const second=buildCaseWorkPlan({store:f.store,measurementIdentity:identity,casePackets:[moved]});assert.deepEqual(second,first);assert.equal(second.items[0].measurementSourceRevision,'measurement-original');
  const changed={...p,actual:{projectedAreaSqFt:101,slopedAreaSqFt:120}};changed.packetHash=hashCaseWorkPacket(changed);
  assert.throws(()=>buildCaseWorkPlan({store:f.store,measurementIdentity:identity,casePackets:[changed]}),{code:'CASE_WORK_EVIDENCE_CONFLICT'});
});
test('tampered packets, duplicate packets and undeclared development membership fail before inference',t=>{
  const f=fixture(t),p=f.packet();
  assert.throws(()=>buildCaseWorkPlan({store:f.store,measurementIdentity:identity,casePackets:[{...p,actual:{wrong:1}}]}),{code:'CASE_WORK_PACKET_HASH_MISMATCH'});
  assert.throws(()=>buildCaseWorkPlan({store:f.store,measurementIdentity:identity,casePackets:[p,p]}),{code:'CASE_WORK_DUPLICATE_PACKET'});
  const heldout=f.packet('heldout',{split:'holdout'});assert.throws(()=>buildCaseWorkPlan({store:f.store,measurementIdentity:identity,casePackets:[heldout]}),{code:'CASE_WORK_INVALID_PACKET'});
  const manifest=f.store.putArtifact(JSON.stringify({schemaVersion:1,protocol:'cloud-case-work-membership-v1',measurementIdentity:identity,cases:[{caseId:p.caseId,propertyGroup:p.propertyGroup,split:'holdout',inputHash:p.caseHash}]}));
  const falseDev={...p,sourceManifestHash:manifest.hash,inputHashes:[p.caseHash,manifest.hash]};falseDev.packetHash=hashCaseWorkPacket(falseDev);
  assert.throws(()=>buildCaseWorkPlan({store:f.store,measurementIdentity:identity,casePackets:[falseDev]}),{code:'CASE_WORK_MEMBERSHIP_MISMATCH'});assert.equal(f.calls.length,0);
});
test('one healthy author handles multiple distinct jobs with cross-family critique and zero wallet cost; replay never charges',async t=>{
  const f=fixture(t),plan=buildCaseWorkPlan({store:f.store,measurementIdentity:identity,casePackets:[f.packet()]}),before=f.store.ledger().requests;
  const first=await runCaseWorkQueue({...f.options,plan});assert.equal(f.calls.length,4);assert.equal(first.counts.uniqueModels,2);assert.equal(first.counts.dispatchedTasks,4);
  assert.equal(first.counts.authorTasks,2);assert.equal(first.counts.independentlyReviewed,2);assert.equal(first.budget.reportedUsd,0);assert.equal(first.budget.committedUsd,0);assert.equal(first.budget.totalRequests,before+4);
  assert.ok(f.calls.every(c=>c.task.sourceRevision==='measurement-original'&&c.task.constraints.maxOutputTokens===8000));assert.ok(first.workItems.every(w=>w.assignment.author.family!==w.assignment.reviewer.family));
  assert.equal(first.productionReleaseApproved,false);assert.equal(first.fieldAccuracyValidated,false);assert.equal(first.allowance.attempts,undefined);
  const replay=await runCaseWorkQueue({...f.options,plan,sourceRevision:'operator-2'});assert.equal(f.calls.length,4);assert.equal(replay.counts.newDispatches,0);assert.equal(replay.sourceRevision,'operator-2');
});
test('missing cross-family reviewer leaves useful author proposals explicitly awaiting independent review',async t=>{
  const f=fixture(t,{reviewer:false}),plan=buildCaseWorkPlan({store:f.store,measurementIdentity:identity,casePackets:[f.packet()]});
  const output=await runCaseWorkQueue({...f.options,plan});assert.equal(f.calls.length,2);assert.equal(output.counts.uniqueModels,1);assert.equal(output.counts.awaitingIndependentReview,2);assert.equal(output.counts.independentlyReviewed,0);
});
test('ambiguous dispatched outcome retains weighted hold and never replays or substitutes the author',async t=>{
  const f=fixture(t),plan=buildCaseWorkPlan({store:f.store,measurementIdentity:identity,casePackets:[f.packet()],maxItems:1});let calls=0;
  const requestRole=async(task,options)=>{calls++;const id=await options.reserve({usd:0,allowance:f.hold(options.model)});await options.onDispatch(id);throw Object.assign(new Error('Unknown upstream outcome'),{code:'NETWORK_ERROR'});};
  const before=f.store.allowanceLedger().unknownUnits,first=await runCaseWorkQueue({...f.options,plan,requestRole});assert.equal(calls,1);assert.equal(first.workItems[0].author.code,'NETWORK_ERROR');assert.ok(f.store.allowanceLedger().unknownUnits>before);
  await runCaseWorkQueue({...f.options,plan,requestRole,sourceRevision:'new-operator'});assert.equal(calls,1);
});
test('current circuits, wrong claims and invented evidence cannot qualify or approve work',async t=>{
  const f=fixture(t),plan=buildCaseWorkPlan({store:f.store,measurementIdentity:identity,casePackets:[f.packet()],maxItems:1});
  f.store.event(null,'fleet-model-circuit-open',{model:GEMINI,status:403});
  const output=await runCaseWorkQueue({...f.options,plan,requestRole:async(task,options)=>{const response=await f.requestRole(task,options);response.result.findings[0].evidence=['fabricated-test-run'];return response;}});
  assert.equal(output.workItems[0].author.code,'CASE_WORK_EVIDENCE_MISMATCH');assert.equal(output.counts.independentlyReviewed,0);assert.equal(f.calls.length,1);
});
test('disabled admission and explicit zero request cap make no model calls',async t=>{
  const f=fixture(t),plan=buildCaseWorkPlan({store:f.store,measurementIdentity:identity,casePackets:[f.packet()],maxItems:1});
  const disabled=await runCaseWorkQueue({...f.options,plan,paidAllowed:false});assert.equal(disabled.counts.newDispatches,0);
  const zero=await runCaseWorkQueue({...f.options,plan,limits:{requestLimit:0}});assert.equal(zero.counts.newDispatches,0);assert.equal(f.calls.length,0);
});
test('qualified engineering assignments balance distinct jobs and same-family critique cannot self-approve',async t=>{
  const f=fixture(t);f.qualify(GEMINI,'engineering');
  const plan=buildCaseWorkPlan({store:f.store,measurementIdentity:identity,casePackets:[f.packet()]});
  const output=await runCaseWorkQueue({...f.options,plan});assert.equal(new Set(output.workItems.map(w=>w.assignment.author.model)).size,2);
  assert.ok(output.workItems.every(w=>!w.assignment.reviewer||w.assignment.author.family!==w.assignment.reviewer.family));
  assert.ok(output.workItems.some(w=>w.state==='awaiting-independent-review'));
});
test('validated JSON response to a streaming request qualifies and stale admission caches refresh without inference retry',async t=>{
  const f=fixture(t),proof=copy(f.authorProof.response);proof.execution.transport='json-response-to-stream-request';
  const artifact=f.store.putArtifact(JSON.stringify(proof));f.store.db.prepare('UPDATE tasks SET result=? WHERE id=?').run(JSON.stringify({primaryValidated:true,resultHash:artifact.hash}),f.authorProof.task.id);
  assert.ok(qualifyCaseWorkers(f).workers.some(w=>w.model===QWEN));
  const old=new Date(Date.now()-9*60000).toISOString(),plan=buildCaseWorkPlan({store:f.store,measurementIdentity:identity,casePackets:[f.packet()],maxItems:1});let rosterReads=0,catalogReads=0;
  const output=await runCaseWorkQueue({...f.options,plan,roster:{...f.roster,checkedAt:old},catalogAudit:{...f.catalogAudit,checkedAt:old},
    verifyModels:async()=>{rosterReads++;return {...f.roster,checkedAt:new Date().toISOString()};},catalogAuditor:async()=>{catalogReads++;return {...f.catalogAudit,checkedAt:new Date().toISOString()};}});
  assert.equal(rosterReads,1);assert.equal(catalogReads,1);assert.equal(output.counts.newDispatches,2);
});
function copy(value){return JSON.parse(JSON.stringify(value));}
test('cancellation after provider response cannot validate author work or dispatch a reviewer',async t=>{
  const f=fixture(t),plan=buildCaseWorkPlan({store:f.store,measurementIdentity:identity,casePackets:[f.packet()],maxItems:1});
  const requestRole=async(task,options)=>{const response=await f.requestRole(task,options);f.store.cancel(task.id);return response;};
  const first=await runCaseWorkQueue({...f.options,plan,requestRole});assert.equal(f.calls.length,1);assert.equal(first.workItems[0].author.primaryValidated,false);
  assert.equal(first.counts.validatedTasks,0);assert.equal(first.counts.independentlyReviewed,0);assert.equal(first.workItems[0].state,'author-failed');
  const replay=await runCaseWorkQueue({...f.options,plan,requestRole});assert.equal(f.calls.length,1);assert.equal(replay.counts.validatedTasks,0);
});
test('new cross-family critic attaches durably to completed author work without replaying authors',async t=>{
  const f=fixture(t,{reviewer:false}),plan=buildCaseWorkPlan({store:f.store,measurementIdentity:identity,casePackets:[f.packet()]});
  const first=await runCaseWorkQueue({...f.options,plan});assert.equal(f.calls.length,2);assert.equal(first.counts.awaitingIndependentReview,2);
  f.qualify(GEMINI,'critique');const second=await runCaseWorkQueue({...f.options,plan,sourceRevision:'new-operator'});
  assert.equal(f.calls.length,4);assert.ok(f.calls.slice(2).every(c=>c.task.role==='critique'));assert.equal(second.counts.independentlyReviewed,2);
  for(let i=0;i<2;i++){assert.equal(second.workItems[i].author.resultHash,first.workItems[i].author.resultHash);assert.equal(second.workItems[i].author.reused,true);}
  assert.equal(f.store.events().filter(e=>e.kind==='case-work-review-assigned').length,2);
  await runCaseWorkQueue({...f.options,plan});assert.equal(f.calls.length,4);
});
test('a larger valid membership manifest does not recharge unchanged case questions',t=>{
  const f=fixture(t),p=f.packet(),first=buildCaseWorkPlan({store:f.store,measurementIdentity:identity,casePackets:[p]});
  const manifest=f.store.putArtifact(JSON.stringify({schemaVersion:1,protocol:'cloud-case-work-membership-v1',measurementIdentity:identity,cases:[
    {caseId:p.caseId,propertyGroup:p.propertyGroup,split:'development',inputHash:p.caseHash},
    {caseId:'other-roof',propertyGroup:'other-property',split:'development',inputHash:'f'.repeat(64)}]}));
  const expanded={...p,sourceManifestHash:manifest.hash,inputHashes:p.inputHashes.filter(h=>h!==p.sourceManifestHash).concat(manifest.hash)};expanded.packetHash=hashCaseWorkPacket(expanded);
  const second=buildCaseWorkPlan({store:f.store,measurementIdentity:identity,casePackets:[expanded]});assert.deepEqual(second,first);
});
test('demonstrably undispatched transient admission resumes once after a durable cooldown',async t=>{
  const f=fixture(t),plan=buildCaseWorkPlan({store:f.store,measurementIdentity:identity,casePackets:[f.packet()],maxItems:1});let clock=Date.now(),invocations=0;
  f.store.now=()=>clock;
  const requestRole=async(task,options)=>{invocations++;if(invocations===1)throw Object.assign(new Error('Readonly preflight unavailable'),{code:'NETWORK_ERROR'});return f.requestRole(task,options);};
  const options={...f.options,plan,requestRole,now:()=>clock};
  const first=await runCaseWorkQueue(options);assert.equal(first.workItems[0].author.status,'deferred');assert.equal(first.counts.newDispatches,0);
  assert.equal(f.store.listTasks().some(t=>t.status==='pending'||t.status==='leased'),false);
  await runCaseWorkQueue(options);assert.equal(invocations,1);
  clock+=61001;const resumed=await runCaseWorkQueue(options);assert.equal(invocations,3);assert.equal(resumed.counts.newDispatches,2);assert.equal(resumed.counts.independentlyReviewed,1);
  assert.equal(f.store.getTask(plan.items[0].workId+'-author').attempts,2);
});
test('a later daily plan resumes original undispatched backlog before new cases without leaving shared pending work',async t=>{
  const f=fixture(t),firstPlan=buildCaseWorkPlan({store:f.store,measurementIdentity:identity,casePackets:[f.packet('yesterday')],maxItems:1});let clock=Date.now();f.store.now=()=>clock;
  await runCaseWorkQueue({...f.options,plan:firstPlan,now:()=>clock,requestRole:async()=>{throw Object.assign(new Error('Readonly preflight unavailable'),{code:'NETWORK_ERROR'});}});
  assert.equal(f.store.listTasks().some(t=>t.status==='pending'||t.status==='leased'),false);
  const nextPlan=buildCaseWorkPlan({store:f.store,measurementIdentity:identity,casePackets:[f.packet('today')],maxItems:1});
  const early=await runCaseWorkQueue({...f.options,plan:nextPlan,now:()=>clock});assert.equal(early.counts.newDispatches,2);assert.equal(f.calls.length,2);
  clock+=61001;const resumed=await runCaseWorkQueue({...f.options,plan:nextPlan,now:()=>clock});
  assert.equal(resumed.workItems[0].caseId,'yesterday');assert.equal(resumed.workItems[0].backlog,true);assert.equal(resumed.counts.newDispatches,2);
  assert.equal(resumed.workItems[1].caseId,'today');assert.equal(resumed.counts.independentlyReviewed,2);assert.equal(f.store.listTasks().some(t=>t.status==='pending'||t.status==='leased'),false);
});
test('recovered own undispatched pending work resumes before a later plan without touching another operation',async t=>{
  const f=fixture(t),oldPlan=buildCaseWorkPlan({store:f.store,measurementIdentity:identity,casePackets:[f.packet('crashed')],maxItems:1});
  await runCaseWorkQueue({...f.options,plan:oldPlan,requestRole:async()=>{throw Object.assign(new Error('Preflight'),{code:'NETWORK_ERROR'});}});
  const id=oldPlan.items[0].workId+'-author';f.store.retryFailed(id,{operatorId:'crash-fixture',evidence:'Simulate hard death after bounded host requeue but before claiming.'});
  const newPlan=buildCaseWorkPlan({store:f.store,measurementIdentity:identity,casePackets:[f.packet('new-day')],maxItems:1});
  const output=await runCaseWorkQueue({...f.options,plan:newPlan});assert.equal(output.workItems[0].caseId,'crashed');assert.equal(output.counts.newDispatches,4);
  assert.equal(f.store.getTask(id).attempts,2);assert.equal(f.store.listTasks().some(t=>t.status==='pending'||t.status==='leased'),false);
});
test('a blocked old model never starves fresh qualified authors and unsafe-to-run own pending work is quarantined unsent',async t=>{
  const f=fixture(t),oldPlan=buildCaseWorkPlan({store:f.store,measurementIdentity:identity,casePackets:[f.packet('blocked-old')],maxItems:1});
  await runCaseWorkQueue({...f.options,plan:oldPlan,requestRole:async()=>{throw Object.assign(new Error('Preflight'),{code:'NETWORK_ERROR'});}});
  const oldId=oldPlan.items[0].workId+'-author';f.qualify(GEMINI,'engineering');
  f.store.retryFailed(oldId,{operatorId:'crash-fixture',evidence:'Simulate pending own case work before restart.'});f.store.event(null,'fleet-model-circuit-open',{model:QWEN,status:403});
  const newPlan=buildCaseWorkPlan({store:f.store,measurementIdentity:identity,casePackets:[f.packet('healthy-new')],maxItems:1});
  const output=await runCaseWorkQueue({...f.options,plan:newPlan});assert.equal(f.calls.length,1);assert.equal(f.calls[0].model,GEMINI);
  assert.equal(output.workItems[0].assignment.author.model,QWEN);assert.equal(output.workItems[0].author.quarantined,true);assert.equal(f.store.getTask(oldId).status,'cancelled');
  assert.equal(f.store.events(oldId).some(e=>e.kind==='dispatched'),false);assert.equal(f.store.listTasks().some(t=>t.status==='pending'||t.status==='leased'),false);
});
test('a completed critical revision counts as independent review without accepting or implementing the proposal',async t=>{
  const f=fixture(t),plan=buildCaseWorkPlan({store:f.store,measurementIdentity:identity,casePackets:[f.packet()],maxItems:1});
  const requestRole=async(task,options)=>{const response=await f.requestRole(task,options);if(task.role==='critique')response.result.peerReview.decision='revise';return response;};
  const output=await runCaseWorkQueue({...f.options,plan,requestRole});assert.equal(output.workItems[0].state,'revision-required');
  assert.equal(output.counts.independentlyReviewed,1);assert.equal(output.counts.acceptedProposals,0);assert.equal(output.productionReleaseApproved,false);assert.equal(output.fieldAccuracyValidated,false);
});
