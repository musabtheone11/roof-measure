import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,readdir,cp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {previousExecution,selectStateArtifact,bootstrapCloud,checkpointCloud,verifyCheckpoint,packReports,publicCloudStatus,publicQualificationStatus,publicRecoveryStatus,publicWorkStatus,publishCloudStatus} from './cloud-operations.mjs';

const stamped=r=>({updated_at:new Date(Number(r.id)*10000).toISOString(),...r});
const env=(id,attempt=1)=>({GITHUB_REPOSITORY:'owner/roof',GITHUB_RUN_ID:String(id),GITHUB_RUN_ATTEMPT:String(attempt),GITHUB_REF_NAME:'work',GITHUB_SHA:'a'.repeat(40)});
async function fixture(t) {const root=await mkdtemp(join(tmpdir(),'roof-cloud-state-'));t.after(()=>rm(root,{recursive:true,force:true}));return root;}
async function createCheckpoint(dir,id,{paid=true,reason=null,attempt=1}={}) {
  await mkdir(dir,{recursive:true});
  await writeFile(join(dir,'cloud-bootstrap.json'),JSON.stringify({repository:'owner/roof',runId:String(id),runAttempt:attempt,paidAllowed:paid,reason,previous:null}));
  await writeFile(join(dir,'ledger.json'),JSON.stringify({paidUsd:3,unknownUsd:.5}));
  return checkpointCloud(dir,{env:env(id,attempt)});
}
test('global predecessor includes failed/cancelled runs and actual attempt chronology',()=>{
  const current=stamped({id:20,run_attempt:1});
  assert.equal(previousExecution(current,[{id:10,status:'completed',conclusion:'success'},{id:19,status:'completed',conclusion:'failure'}].map(stamped)).id,19);
  assert.equal(previousExecution(stamped({id:20,run_attempt:2}),[{id:20,run_attempt:2},{id:19}].map(stamped),{priorAttempts:{20:stamped({id:20,run_attempt:1})}}).attempt,1);
  assert.equal(previousExecution(stamped({id:10,run_attempt:2}),[{id:20,status:'completed'},{id:10,run_attempt:2}].map(stamped),{priorAttempts:{10:stamped({id:10,run_attempt:1})}}).id,20);
  assert.equal(previousExecution(current,[{id:20,status:'in_progress'},{id:21,status:'queued',run_attempt:1},{id:19,status:'completed',run_attempt:1}].map(stamped)).id,19);
  const queuedRerun=previousExecution(current,[{id:21,status:'queued',run_attempt:2},{id:19,status:'completed'}].map(stamped),{priorAttempts:{21:stamped({id:21,run_attempt:1})}});
  assert.equal(queuedRerun.id,21);assert.equal(queuedRerun.attempt,1);
  const newerPaidRerun=previousExecution({id:30,run_attempt:1},[{id:10,run_attempt:2,status:'completed',updated_at:'2026-11-27T12:00:00Z'},{id:20,run_attempt:1,status:'completed',updated_at:'2026-11-26T12:00:00Z'}]);
  assert.equal(newerPaidRerun.id,10);
  const oldCurrentRerun=previousExecution({id:10,run_attempt:2,updated_at:'2026-11-28T12:00:00Z'},[{id:20,run_attempt:1,status:'completed',updated_at:'2026-11-27T12:00:00Z'}],{priorAttempts:{10:{id:10,run_attempt:1,updated_at:'2026-11-26T12:00:00Z'}}});
  assert.equal(oldCurrentRerun.id,20);
  assert.throws(()=>previousExecution(current,[{id:10,updated_at:'2026-11-27T12:00:00Z'},{id:19,updated_at:'2026-11-27T12:00:00Z'}]),/ambiguous/);
  assert.throws(()=>previousExecution(current,[{id:19,status:'completed'}]),/chronology/);
  assert.throws(()=>selectStateArtifact({id:19,status:'completed',attempt:1},[{name:'roof-cloud-state-10-1',expired:false}]));
  assert.throws(()=>selectStateArtifact({id:19,status:'in_progress',attempt:1},[]));
  assert.throws(()=>selectStateArtifact({id:19,status:'completed',attempt:1},[{name:'roof-cloud-state-19-1',expired:true}]));
});
test('first-use paid ledger initialization requires verified empty history',async t=>{
  const root=await fixture(t),dir=join(root,'new');
  const getJSON=async path=>path.includes('/workflows/')?{total_count:1,workflow_runs:[{id:1,run_attempt:1}].map(stamped)}:{id:1,run_attempt:1,workflow_id:7};
  const receipt=await bootstrapCloud(dir,{env:env(1),getJSON});assert.equal(receipt.paidAllowed,true);
  const queued=await bootstrapCloud(join(root,'first-with-queued'),{env:env(1),getJSON:async path=>path.includes('/workflows/')?{total_count:2,workflow_runs:[{id:1,run_attempt:1},{id:2,run_attempt:1,status:'queued'}].map(stamped)}:{id:1,run_attempt:1,workflow_id:7}});
  assert.equal(queued.paidAllowed,true);
  await assert.rejects(bootstrapCloud(dir,{env:env(1),getJSON}),/fresh directory/);
  const blocked=await bootstrapCloud(join(root,'unknown-history'),{env:env(1),getJSON:async()=>{throw new Error('Read unavailable');}});
  assert.equal(blocked.paidAllowed,false);assert.match(blocked.reason,/Read unavailable/);
});
test('restore latest failed execution validates manifest, provenance and checksum',async t=>{
  const root=await fixture(t),prior=join(root,'prior'),dir=join(root,'restore');
  const manifest=await createCheckpoint(prior,19);
  const getJSON=async path=>path.endsWith('/runs/20')?{id:20,run_attempt:1,workflow_id:7}:path.includes('/artifacts?')?{artifacts:[{id:50,name:'roof-cloud-state-19-1',expired:false}]}:{total_count:3,workflow_runs:[{id:20,run_attempt:1},{id:19,status:'completed',conclusion:'failure',run_attempt:1},{id:10,status:'completed',conclusion:'success',run_attempt:1}].map(stamped)};
  const restored=await bootstrapCloud(dir,{env:env(20),getJSON,download:async(repo,a,target)=>{assert.equal(a.id,50);await cp(prior,target,{recursive:true});}});
  assert.equal(restored.paidAllowed,true);assert.equal(restored.previous.runId,'19');
  const checkpoint=await checkpointCloud(dir,{env:env(20)});
  assert.equal((await verifyCheckpoint(dir,checkpoint,{repository:'owner/roof',runId:20,runAttempt:1})).paidAllowed,true);
  await writeFile(join(dir,'ledger.json'),'tampered');
  await assert.rejects(verifyCheckpoint(dir,checkpoint,{repository:'owner/roof',runId:20,runAttempt:1}),/checksums/);
  await assert.rejects(verifyCheckpoint(prior,manifest,{repository:'other/roof',runId:19,runAttempt:1}),/provenance/);
});
test('full history pagination finds newest paid rerun outside the first100created runs',async t=>{
  const root=await fixture(t),prior=join(root,'prior'),target=join(root,'next');await createCheckpoint(prior,10,{attempt:2});
  const history=[stamped({id:200,run_attempt:1,status:'in_progress'}),...Array.from({length:100},(_,i)=>stamped({id:199-i,status:'completed',run_attempt:1})),
    {id:10,run_attempt:2,status:'completed',updated_at:'2026-11-27T12:00:00Z'}];
  const pages=[];
  const getJSON=async path=>{
    if(path.endsWith('/runs/200'))return {id:200,run_attempt:1,workflow_id:7};
    if(path.includes('/workflows/')){const page=Number(path.match(/page=(\d+)$/)[1]);pages.push(page);return {total_count:history.length,workflow_runs:history.slice((page-1)*100,page*100)};}
    if(path.includes('/runs/10/artifacts'))return {artifacts:[{id:90,name:'roof-cloud-state-10-2',expired:false}]};
    throw new Error('Unexpected API request');
  };
  const result=await bootstrapCloud(target,{env:env(200),getJSON,download:async(repo,a,dir)=>cp(prior,dir,{recursive:true})});
  assert.deepEqual(pages,[1,2]);assert.equal(result.paidAllowed,true);assert.equal(result.previous.runId,'10');assert.equal(result.previous.runAttempt,2);
});
test('current rerun fetches prior attempt metadata and refuses stale current-attempt API data',async t=>{
  const root=await fixture(t),prior=join(root,'prior');await createCheckpoint(prior,21);
  const paths=[];
  const getJSON=async path=>{
    paths.push(path);
    if(path.endsWith('/runs/20'))return {id:20,run_attempt:2,workflow_id:7};
    if(path.endsWith('/attempts/1'))return {id:20,run_attempt:1,status:'completed',updated_at:'2026-11-25T12:00:00Z'};
    if(path.includes('/artifacts'))return {artifacts:[{id:91,name:'roof-cloud-state-21-1',expired:false}]};
    return {total_count:2,workflow_runs:[{id:20,run_attempt:2,status:'in_progress',updated_at:'2026-11-28T12:00:00Z'},{id:21,run_attempt:1,status:'completed',updated_at:'2026-11-27T12:00:00Z'}]};
  };
  const result=await bootstrapCloud(join(root,'next'),{env:env(20,2),getJSON,download:async(repo,a,dir)=>cp(prior,dir,{recursive:true})});
  assert.equal(result.paidAllowed,true);assert.equal(result.previous.runId,'21');assert.ok(paths.some(p=>p.endsWith('/runs/20/attempts/1')));
  const stale=await bootstrapCloud(join(root,'stale'),{env:env(20,2),getJSON:async()=>({id:20,run_attempt:1})});
  assert.equal(stale.paidAllowed,false);assert.match(stale.reason,/attempt/);
});
test('missing latest state remains blocked after deterministic continuation; no laundering',async t=>{
  const root=await fixture(t),lost=join(root,'lost'),continued=join(root,'continued');
  const getJSON=async path=>path.endsWith('/runs/20')?{id:20,run_attempt:1,workflow_id:7}:path.includes('/artifacts?')?{artifacts:[]}:{total_count:2,workflow_runs:[{id:20,run_attempt:1},{id:19,status:'completed',run_attempt:1}].map(stamped)};
  const blocked=await bootstrapCloud(lost,{env:env(20),getJSON});assert.equal(blocked.paidAllowed,false);
  const checkpoint=await checkpointCloud(lost,{env:env(20)});assert.equal(checkpoint.paidLedgerEligible,false);
  const nextJSON=async path=>path.endsWith('/runs/21')?{id:21,run_attempt:1,workflow_id:7}:path.includes('/artifacts?')?{artifacts:[{id:51,name:'roof-cloud-state-20-1',expired:false}]}:{total_count:2,workflow_runs:[{id:21,run_attempt:1},{id:20,status:'completed',run_attempt:1}].map(stamped)};
  const next=await bootstrapCloud(continued,{env:env(21),getJSON:nextJSON,download:async(repo,a,target)=>cp(lost,target,{recursive:true})});
  assert.equal(next.paidAllowed,false);assert.match(next.reason,/checkpoint/);
});
test('unclosed SQLite WAL blocks checkpoint and report archive excludes itself',async t=>{
  const root=await fixture(t),state=join(root,'state');await createCheckpoint(state,1);
  await writeFile(join(state,'organization.sqlite-wal'),'uncheckpointed');
  await assert.rejects(checkpointCloud(state,{env:env(1)}),/Close SQLite/);
  const reports=join(root,'reports');await mkdir(reports);await writeFile(join(reports,'report.txt'),'synthetic');
  await assert.rejects(packReports(reports,join(reports,'nested.zip')),/outside/);
  const zipped=await packReports(reports,join(root,'reports.zip'));assert.match(zipped.sha256,/^[a-f0-9]{64}$/);
});

const cycle=()=>({sourceRevision:'a'.repeat(40),metrics:{attempted:12,diagnosticPasses:9,traceFailures:1,generatedCustomerPDFs:12},
  pdfReview:{checked:12,failed:0},decision:{status:'review-required'},
  reviews:[{role:'critique',model:'gpt-6.2-astra',status:'complete',decision:'revise',summary:'PRIVATE_MODEL_TEXT'}],
  image:'PRIVATE_IMAGE',apiKey:'DO_NOT_PUBLISH',notes:'RAW_SOURCE_CONTENT'});
const reply=(body,status=200)=>new Response(JSON.stringify(body),{status});
const executionReply=url=>reply({id:Number(url.match(/runs\/(\d+)/)[1]),run_attempt:Number(url.match(/attempts\/(\d+)/)[1]),run_started_at:'2026-11-28T12:00:00Z',head_sha:'a'.repeat(40)});
function oldContent(runId='19',repository='owner/roof') {return {type:'file',sha:'b'.repeat(40),encoding:'base64',
  content:Buffer.from(JSON.stringify({schemaVersion:1,repository,workflow:'roof-cloud.yml',sourceRevision:'a'.repeat(40),run:{id:runId,attempt:1,startedAt:runId==='21'?'2026-11-29T12:00:00Z':'2026-11-27T12:00:00Z'}})).toString('base64')};}
test('public status is an allowlisted summary with source/run provenance and no raw content',()=>{
  const status=publicCloudStatus(cycle(),{env:{...env(20),ROOF_CLOUD_ARTIFACT_AVAILABLE:'true',ROOF_CLOUD_BROWSER_STATUS:'success'},now:()=>0});
  assert.equal(status.sourceRevision,'a'.repeat(40));assert.equal(status.evaluation.attempted,12);assert.equal(status.evaluation.fieldAccuracyValidated,false);
  assert.equal(status.reportArtifact.available,true);assert.equal(status.evaluation.browserResult,'success');
  const json=JSON.stringify(status);for(const secret of ['PRIVATE_MODEL_TEXT','PRIVATE_IMAGE','DO_NOT_PUBLISH','RAW_SOURCE_CONTENT'])assert.equal(json.includes(secret),false);
  assert.throws(()=>publicCloudStatus({...cycle(),sourceRevision:'c'.repeat(40)},{env:env(20)}),/source revision mismatch/);
  assert.equal(publicCloudStatus(null,{env:env(20)}).evaluation.status,'cycle-unavailable');
});
test('all-model public status exposes assignments and actual dispatch separately without model prose',()=>{
  const data=cycle();
  data.reviews=Array.from({length:45},(_,i)=>({model:'fixture/model-'+i,role:'engineering',team:'Roof engineering',task:'Review evidence-bound topology failures.',reviewerModel:'fixture/model-'+((i+1)%45),status:i<40?'complete':'blocked',attempted:i<40,reviewStatus:i<39?'complete':'pending',decision:i<40?'revise':null,code:i<40?null:'BUDGET_LIMIT',reportedUsd:i<40?.001:null,summary:'PRIVATE_FLEET_PROSE',execution:{apiKey:'DO_NOT_PUBLISH'}}));
  data.fleet={catalog:{checkedAt:'2026-11-27T23:00:00Z',hash:'b'.repeat(64)},coverage:{rosterCount:45}};
  const status=publicCloudStatus(data,{env:env(20)});
  assert.equal(status.models.length,45);assert.equal(status.fleet.rosterCount,45);assert.equal(status.fleet.attemptedCount,40);assert.equal(status.fleet.validCount,40);assert.equal(status.fleet.blockedCount,5);assert.equal(status.fleet.reviewedCount,39);
  assert.equal(status.models[0].task,data.reviews[0].task);
  assert.equal(JSON.stringify(status).includes('PRIVATE_FLEET_PROSE'),false);assert.equal(JSON.stringify(status).includes('DO_NOT_PUBLISH'),false);
});
test('follow-up status preserves baseline provenance and cannot claim retained reports were newly generated',()=>{
 const data=cycle();data.followup={newlyGeneratedCases:0,newlyGeneratedCustomerPDFs:0};
 data.baseline={runId:'123',sourceRevision:'b'.repeat(40),evaluationHash:'c'.repeat(64)};
 const status=publicCloudStatus(data,{env:env(20)});
 assert.equal(status.sourceRevision,'a'.repeat(40));assert.equal(status.baseline.sourceRevision,'b'.repeat(40));
 assert.equal(status.evaluation.evidenceMode,'retained-baseline');assert.equal(status.evaluation.generatedCustomerPDFs,0);
 assert.equal(status.evaluation.retainedCustomerPDFs,12);assert.equal(status.evaluation.newlyGeneratedCases,0);
 assert.match(status.scope,/No new measurements/);
});
test('subscription journal counts valid review-needed proposals and omits private data',()=>{
 const data=cycle();data.executionProfile='allowance-roster';data.allowance={remainingUnits:1155000000,periodKey:'PRIVATE_PERIOD'};
 data.reviews=[{model:'free/qwen-3.8-max',status:'needs-human',primaryValidated:true,attempted:true,reviewStatus:'pending',summary:'PRIVATE_MODEL_TEXT'},
  {model:'free/gpt-6-luna',status:'failed',primaryValidated:false,attempted:true,reviewStatus:'pending',code:'TIMEOUT'},
  {model:'free/drex-v2.0',status:'blocked',primaryValidated:false,attempted:false,code:'MODEL_RECONCILIATION_REQUIRED'}];
 const status=publicQualificationStatus(data,{env:env(20)});
 assert.equal(status.executionProfile,'allowance-roster');assert.deepEqual(status.summary,{selectedCount:3,attemptedCount:2,validCount:1,reviewedCount:0});
 assert.equal(status.models[0].status,'needs-human');assert.equal(status.models[0].contributionValidated,true);
 for(const value of ['PRIVATE_MODEL_TEXT','PRIVATE_PERIOD','remainingUnits','1155000000'])assert.ok(!JSON.stringify(status).includes(value));
 data.reviews.push({model:'gpt-6.2-astra',status:'complete'});assert.throws(()=>publicQualificationStatus(data,{env:env(20)}),/paid-model/);
});
test('subscription publication uses its separate fixed journal without replacing the full roster',async()=>{
 const data=cycle();data.executionProfile='allowance-qualification';data.reviews=[{model:'free/qwen-3.8-max',status:'needs-human',primaryValidated:true,attempted:true}];
 const paths=[];let put;
 const result=await publishCloudStatus(data,{env:{...env(20),GITHUB_TOKEN:'private-test-token'},fetchImpl:async(url,init)=>{
   paths.push(url);if(url.includes('/attempts/'))return executionReply(url);
   if(url.includes('/git/ref/'))return reply({ref:'refs/heads/roof-cloud-status'});
   if(init.method==='GET')return reply({},404);put=JSON.parse(init.body);return reply({commit:{sha:'c'.repeat(40)}},201);
 }});
 assert.ok(paths.some(path=>path.includes('/contents/latest-qualification.json')));assert.ok(paths.every(path=>!path.includes('latest-status.json')));
 assert.match(result.statusURL,/latest-qualification.json$/);assert.equal(put.branch,'roof-cloud-status');
 const published=JSON.parse(Buffer.from(put.content,'base64'));assert.equal(published.summary.validCount,1);assert.equal(published.run.startedAt,'2026-11-28T12:00:00.000Z');
});
test('failed subscription runs keep their scoped journal and mismatched profiles cannot overwrite either journal',async()=>{
 const paths=[];
 await publishCloudStatus(null,{env:{...env(20),GITHUB_TOKEN:'token',ROOF_CLOUD_PUBLIC_PROFILE:'allowance-roster',ROOF_CLOUD_GENERATION_RESULT:'failure'},fetchImpl:async(url,init)=>{
   paths.push(url);if(url.includes('/attempts/'))return executionReply(url);if(url.includes('/git/ref/'))return reply({});
   return init.method==='GET'?reply({},404):reply({commit:{sha:'c'.repeat(40)}},201);
 }});
 assert.ok(paths.some(path=>path.includes('latest-qualification.json')));assert.ok(paths.every(path=>!path.includes('latest-status.json')));
 for(const [profile,actual]of [['allowance-roster','all-models'],['cycle','allowance-roster'],['allowance-qualification','allowance-roster']]) {
   let calls=0;await assert.rejects(publishCloudStatus({...cycle(),executionProfile:actual},{env:{...env(20),GITHUB_TOKEN:'token',ROOF_CLOUD_PUBLIC_PROFILE:profile},fetchImpl:async()=>{calls++;}}));assert.equal(calls,0);
 }
});
const workCycle=()=>({...cycle(),executionProfile:'allowance-work',caseWork:{protocol:'PRIVATE_PROTOCOL',planHash:'PRIVATE_PLAN_HASH',sourceRevision:'a'.repeat(40),
  workItems:[{taskId:'PRIVATE_TASK_1',packet:{prompt:'PRIVATE_QUESTION_1'}},{taskId:'PRIVATE_TASK_2',packet:{prompt:'PRIVATE_QUESTION_2'}},{taskId:'PRIVATE_TASK_3',packet:{prompt:'PRIVATE_QUESTION_3'}}],
  models:[{model:'free/qwen-3.8-max',taskCount:3,validatedTaskCount:2,prompt:'PRIVATE_MODEL_PROMPT'},
    {model:'free/gpt-6-luna',taskCount:2,validatedTaskCount:2,remainingUnits:'PRIVATE_MODEL_BALANCE'}],
  counts:{uniqueModels:2,workItems:3,authorTasks:3,reviewTasks:3,dispatchedTasks:5,validatedTasks:4,independentlyReviewed:1,awaitingIndependentReview:1,failed:1,completedFixes:999},
  budget:{private:'PRIVATE_BUDGET'},allowance:{remainingUnits:'PRIVATE_ALLOWANCE',periodKey:'PRIVATE_PERIOD'},productionReleaseApproved:true}});
function oldWorkContent(runId='19',{profile='allowance-work',repository='owner/roof'}={}) {
 const old=oldContent(runId,repository),value=JSON.parse(Buffer.from(old.content,'base64'));if(profile)value.executionProfile=profile;
 return {...old,content:Buffer.from(JSON.stringify(value)).toString('base64')};
}
test('productive work public summary distinguishes questions, tasks and unique models without exporting private packets',()=>{
 const status=publicWorkStatus(workCycle(),{env:{...env(20),ROOF_CLOUD_GENERATION_RESULT:'success'},now:()=>0});
 assert.equal(status.executionProfile,'allowance-work');assert.equal(status.sourceRevision,'a'.repeat(40));assert.equal(status.generatedAt,'1970-01-01T00:00:00.000Z');
 assert.deepEqual(status.summary,{uniqueModels:2,workItems:3,authorTasks:3,reviewTasks:3,dispatchedTasks:5,validatedTasks:4,independentlyReviewed:1,awaitingIndependentReview:1,failed:1,completedFixes:0});
 assert.deepEqual(status.models,[{model:'free/qwen-3.8-max',taskCount:3,validatedTaskCount:2},{model:'free/gpt-6-luna',taskCount:2,validatedTaskCount:2}]);
 assert.deepEqual(Object.keys(status).sort(),['schemaVersion','repository','workflow','executionProfile','generatedAt','sourceRevision','run','reportArtifact','summary','models','scope'].sort());
 for(const marker of ['PRIVATE_','DO_NOT_PUBLISH','RAW_SOURCE_CONTENT','remainingUnits','periodKey','taskId','planHash','productionReleaseApproved'])assert.equal(JSON.stringify(status).includes(marker),false,marker);
 assert.match(status.scope,/not implemented or released fixes/);
});
test('productive work summary fails closed on malformed counts, duplicate models and source conflicts',()=>{
 for(const mutate of [
  data=>{data.caseWork.sourceRevision='b'.repeat(40);},
  data=>{data.caseWork.counts.uniqueModels=3;},
  data=>{data.caseWork.counts.workItems=4;},
  data=>{data.caseWork.models[1].model=data.caseWork.models[0].model;},
  data=>{data.caseWork.models[0].taskCount=0;},
  data=>{data.caseWork.models[0].validatedTaskCount=4;},
  data=>{data.caseWork.models[0].model='<private-model>';},
  data=>{data.caseWork.counts.validatedTasks=NaN;},
  data=>{data.caseWork.counts.failed=-1;},
  data=>{data.caseWork.counts.dispatchedTasks=1000001;},
  data=>{data.caseWork.counts.dispatchedTasks=6;},
  data=>{data.caseWork.counts.validatedTasks=3;},
  data=>{data.caseWork.counts.authorTasks=2;data.caseWork.counts.reviewTasks=2;},
  data=>{data.caseWork.counts.validatedTasks=6;}
 ]){const data=workCycle();mutate(data);assert.throws(()=>publicWorkStatus(data,{env:env(20)}));}
});
test('productive work preserves explicit zero dispatches or zero questions even when its pipeline succeeds',()=>{
 const deferred=workCycle();deferred.caseWork.models=[];
 deferred.caseWork.counts={uniqueModels:0,workItems:3,authorTasks:3,reviewTasks:0,dispatchedTasks:0,validatedTasks:0,independentlyReviewed:0,awaitingIndependentReview:0,failed:0};
 const awaiting=publicWorkStatus(deferred,{env:{...env(20),ROOF_CLOUD_GENERATION_RESULT:'success'}});
 assert.equal(awaiting.run.pipelineResult,'success');assert.equal(awaiting.summary.workItems,3);assert.equal(awaiting.summary.dispatchedTasks,0);assert.deepEqual(awaiting.models,[]);
 const empty=workCycle();empty.caseWork.models=[];empty.caseWork.workItems=[];empty.caseWork.counts=Object.fromEntries(Object.keys(empty.caseWork.counts).map(key=>[key,0]));
 const noQuestions=publicWorkStatus(empty,{env:{...env(20),ROOF_CLOUD_GENERATION_RESULT:'success'}});
 assert.equal(noQuestions.run.pipelineResult,'success');assert.deepEqual(noQuestions.models,[]);assert.ok(Object.values(noQuestions.summary).every(value=>value===0));
});
test('failed productive work without cycle output requires its declared profile and publishes honest zero results',()=>{
 for(const result of ['failure','unknown']) {
  const status=publicWorkStatus(null,{env:{...env(20),ROOF_CLOUD_PUBLIC_PROFILE:'allowance-work',ROOF_CLOUD_GENERATION_RESULT:result}});
  assert.equal(status.run.pipelineResult,result);assert.deepEqual(status.models,[]);assert.ok(Object.values(status.summary).every(value=>value===0));
 }
 assert.throws(()=>publicWorkStatus(null,{env:{...env(20),ROOF_CLOUD_PUBLIC_PROFILE:'allowance-work',ROOF_CLOUD_GENERATION_RESULT:'success'}}),/non-success/);
 const missing=workCycle();delete missing.caseWork;
 assert.throws(()=>publicWorkStatus(missing,{env:env(20)}),/declared non-success/);
 assert.deepEqual(publicWorkStatus(missing,{env:{...env(20),ROOF_CLOUD_PUBLIC_PROFILE:'allowance-work',ROOF_CLOUD_GENERATION_RESULT:'failure'}}).models,[]);
});
test('productive work publication writes only its fixed journal with source provenance and CAS',async()=>{
 const paths=[];let put;
 const result=await publishCloudStatus(workCycle(),{env:{...env(20),GITHUB_TOKEN:'PRIVATE_TOKEN',ROOF_CLOUD_PUBLIC_PROFILE:'allowance-work'},fetchImpl:async(url,init)=>{
  paths.push(url);if(url.includes('/attempts/'))return executionReply(url);if(url.includes('/git/ref/'))return reply({ref:'refs/heads/roof-cloud-status'});
  if(init.method==='GET')return reply(oldWorkContent());put=JSON.parse(init.body);return reply({commit:{sha:'c'.repeat(40)}},201);
 }});
 assert.ok(paths.some(path=>path.includes('/contents/latest-work.json')));assert.ok(paths.every(path=>!path.includes('latest-status.json')&&!path.includes('latest-qualification.json')));
 assert.match(result.statusURL,/roof-cloud-status\/latest-work.json$/);assert.equal(put.sha,'b'.repeat(40));assert.equal(put.branch,'roof-cloud-status');assert.equal(Object.hasOwn(put,'force'),false);
 const published=JSON.parse(Buffer.from(put.content,'base64'));assert.equal(published.run.startedAt,'2026-11-28T12:00:00.000Z');assert.equal(published.summary.workItems,3);assert.equal(published.summary.uniqueModels,2);assert.equal(published.summary.completedFixes,0);
 assert.equal(JSON.stringify(published).includes('PRIVATE_'),false);
});
test('failed productive work routes its empty publication separately and rejects cross-profile artifacts before network access',async()=>{
 const paths=[];let published;
 await publishCloudStatus(null,{env:{...env(20),GITHUB_TOKEN:'token',ROOF_CLOUD_PUBLIC_PROFILE:'allowance-work',ROOF_CLOUD_GENERATION_RESULT:'failure'},fetchImpl:async(url,init)=>{
  paths.push(url);if(url.includes('/attempts/'))return executionReply(url);if(url.includes('/git/ref/'))return reply({});
  if(init.method==='GET')return reply({},404);published=JSON.parse(Buffer.from(JSON.parse(init.body).content,'base64'));return reply({commit:{sha:'c'.repeat(40)}},201);
 }});
 assert.ok(paths.some(path=>path.includes('latest-work.json')));assert.ok(paths.every(path=>!path.includes('latest-status.json')&&!path.includes('latest-qualification.json')));assert.deepEqual(published.models,[]);
 for(const [declared,actual]of [['allowance-work','all-models'],['allowance-work','allowance-roster'],['allowance-roster','allowance-work'],['allowance-qualification','allowance-work'],['cycle','allowance-work']]) {
  let calls=0;await assert.rejects(publishCloudStatus({...workCycle(),executionProfile:actual},{env:{...env(20),GITHUB_TOKEN:'token',ROOF_CLOUD_PUBLIC_PROFILE:declared},fetchImpl:async()=>{calls++;}}));assert.equal(calls,0);
 }
});
test('productive work journal refuses foreign scope, repository, newer execution and CAS conflicts',async()=>{
 for(const previous of [oldWorkContent('19',{profile:'allowance-roster'}),oldWorkContent('19',{profile:null}),oldWorkContent('19',{repository:'another/roof'}),oldWorkContent('21')]) {
  const requests=[];
  await assert.rejects(publishCloudStatus(workCycle(),{env:{...env(20),GITHUB_TOKEN:'token'},fetchImpl:async(url,init)=>{
   if(url.includes('/attempts/'))return executionReply(url);requests.push({url,method:init.method});return requests.length===1?reply({ref:'refs/heads/roof-cloud-status'}):reply(previous);
  }}),/refusing/);
  assert.equal(requests.some(request=>request.method==='PUT'),false);assert.ok(requests.every(request=>!request.url.includes('latest-status.json')&&!request.url.includes('latest-qualification.json')));
 }
 const requests=[];
 await assert.rejects(publishCloudStatus(workCycle(),{env:{...env(20),GITHUB_TOKEN:'token'},fetchImpl:async(url,init)=>{
  if(url.includes('/attempts/'))return executionReply(url);requests.push({url,init});return requests.length===1?reply({}):requests.length===2?reply(oldWorkContent()):reply({},409);
 }}),/409/);
 assert.equal(requests.filter(request=>request.init.method==='PUT').length,1);assert.equal(JSON.parse(requests.at(-1).init.body).sha,'b'.repeat(40));
});
test('status journal creates only its fixed branch from the checked-out revision and writes CAS content',async()=>{
  const calls=[];
  const fetchImpl=async(url,init)=>{
    if(url.includes('/attempts/'))return executionReply(url);
    calls.push({url,init});
    if(calls.length===1)return reply({},404);
    if(calls.length===2)return reply({ref:'refs/heads/roof-cloud-status'},201);
    if(calls.length===3)return reply({},404);
    return reply({commit:{sha:'c'.repeat(40)}},201);
  };
  const result=await publishCloudStatus(cycle(),{env:{...env(20),GITHUB_TOKEN:'test-private-token'},fetchImpl});
  const create=JSON.parse(calls[1].init.body),put=JSON.parse(calls[3].init.body);
  assert.deepEqual(create,{ref:'refs/heads/roof-cloud-status',sha:'a'.repeat(40)});
  assert.equal(put.branch,'roof-cloud-status');assert.equal(Object.hasOwn(put,'sha'),false);assert.equal(Object.hasOwn(put,'force'),false);
  assert.equal(Buffer.from(put.content,'base64').toString().includes('test-private-token'),false);
  assert.equal(result.commit,'c'.repeat(40));assert.match(result.statusURL,/roof-cloud-status\/latest-status.json$/);
});
test('status publishing authentication/conflict failures never force or silently replace prior status',async()=>{
  let calls=0;
  await assert.rejects(publishCloudStatus(cycle(),{env:{...env(20),GITHUB_TOKEN:'test-private-token'},fetchImpl:async()=>{calls++;return reply({secret:'test-private-token'},401);}}),error=>/401/.test(error.message)&&!error.message.includes('test-private-token'));
  assert.equal(calls,1);
  const requests=[];
  const fetchImpl=async(url,init)=>{if(url.includes('/attempts/'))return executionReply(url);requests.push({url,init});return requests.length===1?reply({ref:'refs/heads/roof-cloud-status'}):requests.length===2?reply(oldContent()):reply({message:'Conflict'},409);};
  await assert.rejects(publishCloudStatus(cycle(),{env:{...env(20),GITHUB_TOKEN:'token'},fetchImpl}),/409/);
  assert.equal(requests.filter(x=>x.init.method==='PUT').length,1);
  const put=JSON.parse(requests[2].init.body);assert.equal(put.sha,'b'.repeat(40));assert.equal(put.branch,'roof-cloud-status');assert.equal(Object.hasOwn(put,'force'),false);
});
test('newer or foreign status provenance cannot be overwritten by a stale publisher',async()=>{
  for(const prior of [oldContent('21'),oldContent('19','other/repository')]) {
    const calls=[];
    await assert.rejects(publishCloudStatus(cycle(),{env:{...env(20),GITHUB_TOKEN:'token'},fetchImpl:async(url,init)=>{if(url.includes('/attempts/'))return executionReply(url);calls.push(init.method);return calls.length===1?reply({ref:'refs/heads/roof-cloud-status'}):reply(prior);}}),/refusing/);
    assert.equal(calls.includes('PUT'),false);
  }
});
test('an older runID with a genuinely newer verified execution can publish its latest status',async()=>{
  const calls=[];
  const fetchImpl=async(url,init)=>{
    if(url.includes('/attempts/'))return executionReply(url);
    calls.push({url,init});
    return calls.length===1?reply({ref:'refs/heads/roof-cloud-status'}):calls.length===2?reply(oldContent('20')):reply({commit:{sha:'c'.repeat(40)}});
  };
  const result=await publishCloudStatus(cycle(),{env:{...env(10,2),GITHUB_TOKEN:'token'},fetchImpl});
  assert.equal(result.commit,'c'.repeat(40));assert.equal(calls.filter(c=>c.init.method==='PUT').length,1);
  const body=JSON.parse(calls[2].init.body),published=JSON.parse(Buffer.from(body.content,'base64'));
  assert.equal(published.run.id,'10');assert.equal(published.run.attempt,2);assert.equal(published.run.startedAt,'2026-11-28T12:00:00.000Z');
});

const recoveryCycle=()=>({...cycle(),executionProfile:'allowance-recovery',
 budget:{private:'PRIVATE_RECOVERY_BUDGET'},allowance:{remainingUnits:'PRIVATE_RECOVERY_ALLOWANCE',periodKey:'PRIVATE_RECOVERY_PERIOD'},
 packet:{prompt:'PRIVATE_RECOVERY_PROMPT',taskId:'PRIVATE_RECOVERY_TASK'},reviews:[
  {model:'free/drex-v2.0',role:'engineering',status:'needs-human',primaryValidated:true,attempted:true,reviewStatus:'complete',summary:'PRIVATE_RECOVERY_PROSE'},
  {model:'free/gemini-4-hydrogen',role:'critique',status:'failed',primaryValidated:false,attempted:true,reviewStatus:'pending',code:'TIMEOUT',errorDetails:{rawBody:'PRIVATE_PROVIDER_BODY'}},
  {model:'free/hy4-flash',role:'verification',status:'complete',primaryValidated:true,attempted:true,reviewStatus:'blocked',taskId:'PRIVATE_MODEL_TASK'}]});
const recoveryEnv=(result='success')=>({...env(20),ROOF_CLOUD_PUBLIC_PROFILE:'allowance-recovery',ROOF_CLOUD_GENERATION_RESULT:result});
test('route recovery summary exposes only the exact selected records and safe qualification fields',()=>{
 const status=publicRecoveryStatus(recoveryCycle(),{env:recoveryEnv(),now:()=>0});
 assert.equal(status.executionProfile,'allowance-recovery');assert.equal(status.sourceRevision,'a'.repeat(40));assert.equal(status.generatedAt,'1970-01-01T00:00:00.000Z');
 assert.deepEqual(status.models.map(row=>row.model),['free/drex-v2.0','free/gemini-4-hydrogen','free/hy4-flash']);
 assert.deepEqual(status.summary,{selectedCount:3,attemptedCount:3,validCount:2,reviewedCount:1});
 assert.equal(status.models[0].status,'needs-human');assert.equal(status.models[0].contributionValidated,true);assert.equal(status.models[1].code,'TIMEOUT');
 assert.deepEqual(Object.keys(status).sort(),['schemaVersion','repository','workflow','executionProfile','generatedAt','sourceRevision','run','reportArtifact','models','summary','scope'].sort());
 assert.deepEqual(Object.keys(status.models[0]).sort(),['model','status','attempted','contributionValidated','reviewStatus','code'].sort());
 for(const marker of ['PRIVATE_','DO_NOT_PUBLISH','RAW_SOURCE_CONTENT','remainingUnits','periodKey','taskId','budget','allowance":','packet'])assert.equal(JSON.stringify(status).includes(marker),false,marker);
 assert.match(status.scope,/counts cover only the model records published/);assert.match(status.scope,/No field accuracy or production approval/);
});
test('successful route recovery requires all three exact IDs and rejects substitutions, duplicates and hidden extra rows',()=>{
 for(const mutate of [
  data=>{data.reviews=[];},data=>{data.reviews.pop();},
  data=>{data.reviews[2].model='free/hy4';},data=>{data.reviews[0].model='drex-v2.0';},
  data=>{data.reviews[0].model='free/qwen-3.8-max';},
  data=>{data.reviews[2].model=data.reviews[0].model;},
  data=>{data.reviews.push({...data.reviews[0]});},
  data=>{data.reviews=Array.from({length:257},()=>({...data.reviews[0]}));},
  data=>{data.reviews=[null];},data=>{data.reviews={};}
 ]){const data=recoveryCycle();mutate(data);assert.throws(()=>publicRecoveryStatus(data,{env:recoveryEnv()}));}
 const privateRoute=recoveryCycle();privateRoute.reviews[0].model='free/private-route-identifier';
 assert.throws(()=>publicRecoveryStatus(privateRoute,{env:recoveryEnv('failure')}),error=>!error.message.includes('private-route-identifier'));
 const wrongSource=recoveryCycle();wrongSource.sourceRevision='b'.repeat(40);assert.throws(()=>publicRecoveryStatus(wrongSource,{env:recoveryEnv()}),/source revision mismatch/);
});
test('failed route recovery publishes only its recorded subset and missing-cycle emptiness requires a declared failed or unknown profile',()=>{
 for(const result of ['failure','unknown'])for(const length of [0,1,2,3]) {
  const data=recoveryCycle();data.reviews=data.reviews.slice(0,length);const status=publicRecoveryStatus(data,{env:recoveryEnv(result)});
  assert.equal(status.models.length,length);assert.equal(status.summary.selectedCount,length);assert.equal(status.summary.attemptedCount,length);assert.equal(status.run.pipelineResult,result);
 }
 for(const result of ['failure','unknown']) {
  const status=publicRecoveryStatus(null,{env:recoveryEnv(result)});assert.deepEqual(status.models,[]);assert.deepEqual(status.summary,{selectedCount:0,attemptedCount:0,validCount:0,reviewedCount:0});
  const missing=recoveryCycle();delete missing.reviews;assert.deepEqual(publicRecoveryStatus(missing,{env:recoveryEnv(result)}).models,[]);
 }
 for(const result of ['success','cancelled','skipped'])assert.throws(()=>publicRecoveryStatus(null,{env:recoveryEnv(result)}),/declared failed or unknown/);
 const missing=recoveryCycle();delete missing.reviews;
 assert.throws(()=>publicRecoveryStatus(missing,{env:{...env(20),ROOF_CLOUD_GENERATION_RESULT:'failure'}}),/declared failed or unknown/);
 assert.throws(()=>publicRecoveryStatus({...cycle(),executionProfile:'allowance-roster'},{env:env(20)}),/known route recovery profile/);
});
test('all four public journal destinations remain isolated, including targeted route recovery',async()=>{
 const qualification={...cycle(),executionProfile:'allowance-roster',reviews:[{model:'free/qwen-3.8-max',status:'needs-human',primaryValidated:true,attempted:true}]};
 for(const [data,file]of [[cycle(),'latest-status.json'],[qualification,'latest-qualification.json'],[workCycle(),'latest-work.json'],[recoveryCycle(),'latest-recovery.json']]) {
  const paths=[];let published;
  const result=await publishCloudStatus(data,{env:{...env(20),GITHUB_TOKEN:'PRIVATE_TEST_TOKEN',ROOF_CLOUD_GENERATION_RESULT:'success'},fetchImpl:async(url,init)=>{
   paths.push(url);if(url.includes('/attempts/'))return executionReply(url);if(url.includes('/git/ref/'))return reply({ref:'refs/heads/roof-cloud-status'});
   if(init.method==='GET')return reply({},404);published=JSON.parse(Buffer.from(JSON.parse(init.body).content,'base64'));return reply({commit:{sha:'c'.repeat(40)}},201);
  }});
  assert.deepEqual([...new Set(paths.filter(path=>path.includes('/contents/')).map(path=>new URL(path).pathname.split('/').at(-1)))],[file]);
  assert.equal(new URL(result.statusURL).pathname.split('/').at(-1),file);assert.equal(published.run.startedAt,'2026-11-28T12:00:00.000Z');
  if(file==='latest-recovery.json'){assert.equal(published.models.length,3);assert.equal(published.summary.validCount,2);assert.equal(JSON.stringify(published).includes('PRIVATE_'),false);}
 }
});
test('declared recovery failures retain their separate journal and mismatched profiles are rejected before networking',async()=>{
 const paths=[];let published;
 await publishCloudStatus(null,{env:{...recoveryEnv('failure'),GITHUB_TOKEN:'token'},fetchImpl:async(url,init)=>{
  paths.push(url);if(url.includes('/attempts/'))return executionReply(url);if(url.includes('/git/ref/'))return reply({});
  if(init.method==='GET')return reply({},404);published=JSON.parse(Buffer.from(JSON.parse(init.body).content,'base64'));return reply({commit:{sha:'c'.repeat(40)}},201);
 }});
 assert.ok(paths.some(path=>path.includes('/contents/latest-recovery.json')));assert.ok(paths.every(path=>!path.includes('latest-status.json')&&!path.includes('latest-qualification.json')&&!path.includes('latest-work.json')));
 assert.deepEqual(published.models,[]);assert.equal(published.run.pipelineResult,'failure');
 for(const [declared,actual]of [['allowance-recovery','allowance-roster'],['allowance-recovery','allowance-work'],['allowance-recovery','all-models'],['allowance-roster','allowance-recovery'],['allowance-qualification','allowance-recovery'],['allowance-work','allowance-recovery'],['cycle','allowance-recovery']]) {
  let calls=0;await assert.rejects(publishCloudStatus({...recoveryCycle(),executionProfile:actual},{env:{...env(20),GITHUB_TOKEN:'token',ROOF_CLOUD_PUBLIC_PROFILE:declared},fetchImpl:async()=>{calls++;}}));assert.equal(calls,0);
 }
});
test('recovery journal retains source/attempt chronology and CAS protections against foreign or newer records',async()=>{
 for(const previous of [oldWorkContent('19',{profile:'allowance-roster'}),oldWorkContent('19',{profile:'allowance-work'}),oldWorkContent('19',{profile:null}),oldWorkContent('19',{profile:'allowance-recovery',repository:'another/roof'}),oldWorkContent('21',{profile:'allowance-recovery'})]) {
  const methods=[];await assert.rejects(publishCloudStatus(recoveryCycle(),{env:{...recoveryEnv(),GITHUB_TOKEN:'token'},fetchImpl:async(url,init)=>{
   if(url.includes('/attempts/'))return executionReply(url);methods.push(init.method);return methods.length===1?reply({}):reply(previous);
  }}),/refusing/);assert.equal(methods.includes('PUT'),false);
 }
 for(const value of [{id:20,run_attempt:2,head_sha:'a'.repeat(40)},{id:20,run_attempt:1,head_sha:'b'.repeat(40)}]) {
  const methods=[];await assert.rejects(publishCloudStatus(recoveryCycle(),{env:{...recoveryEnv(),GITHUB_TOKEN:'token'},fetchImpl:async(url,init)=>{
   methods.push(init.method);return reply({...value,run_started_at:'2026-11-28T12:00:00Z'});
  }}),/execution provenance/);assert.deepEqual(methods,['GET']);
 }
 let put;const paths=[];
 const result=await publishCloudStatus(recoveryCycle(),{env:{...recoveryEnv(),GITHUB_TOKEN:'token'},fetchImpl:async(url,init)=>{
  paths.push(url);if(url.includes('/attempts/'))return executionReply(url);if(url.includes('/git/ref/'))return reply({});
  if(init.method==='GET')return reply(oldWorkContent('19',{profile:'allowance-recovery'}));put=JSON.parse(init.body);return reply({commit:{sha:'c'.repeat(40)}},201);
 }});
 assert.match(result.statusURL,/latest-recovery.json$/);assert.equal(put.sha,'b'.repeat(40));assert.equal(put.branch,'roof-cloud-status');assert.equal(Object.hasOwn(put,'force'),false);assert.ok(paths.some(path=>path.includes('/contents/latest-recovery.json')));
 let puts=0;await assert.rejects(publishCloudStatus(recoveryCycle(),{env:{...recoveryEnv(),GITHUB_TOKEN:'token'},fetchImpl:async(url,init)=>{
  if(url.includes('/attempts/'))return executionReply(url);if(url.includes('/git/ref/'))return reply({});if(init.method==='GET')return reply(oldWorkContent('19',{profile:'allowance-recovery'}));puts++;return reply({private:'PRIVATE_CONFLICT_BODY'},409);
 }}),error=>/409/.test(error.message)&&!error.message.includes('PRIVATE_CONFLICT_BODY'));assert.equal(puts,1);
});
test('a recovery-profile artifact cannot replace any of the other three journal files',async()=>{
 const qualification={...cycle(),executionProfile:'allowance-roster',reviews:[{model:'free/qwen-3.8-max',status:'complete'}]};
 for(const data of [cycle(),qualification,workCycle()]) {
  const methods=[];await assert.rejects(publishCloudStatus(data,{env:{...env(20),GITHUB_TOKEN:'token'},fetchImpl:async(url,init)=>{
   if(url.includes('/attempts/'))return executionReply(url);methods.push(init.method);return methods.length===1?reply({}):reply(oldWorkContent('19',{profile:'allowance-recovery'}));
  }}),/provenance mismatch/);assert.equal(methods.includes('PUT'),false);
 }
});
