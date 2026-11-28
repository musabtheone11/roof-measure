import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,readdir,cp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {previousExecution,selectStateArtifact,bootstrapCloud,checkpointCloud,verifyCheckpoint,packReports,publicCloudStatus,publishCloudStatus} from './cloud-operations.mjs';

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
