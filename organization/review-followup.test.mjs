import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {deflateSync} from 'node:zlib';
import {OrgStore} from './store.mjs';
import {MODEL_CATALOG} from './model-catalog.mjs';
import {DESIGN_CATALOG} from './design-catalog.mjs';
import {getVerifiedModelPrice} from './model-catalog.mjs';
import {runReviewFollowup} from './review-followup.mjs';

const OLD='c'.repeat(40),CURRENT='a'.repeat(40),RUN='46089368732';
const hash=x=>createHash('sha256').update(Buffer.isBuffer(x)||typeof x==='string'?x:JSON.stringify(x)).digest('hex');
const PNG=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aHioAAAAASUVORK5CYII=','base64');
function conceptPNG(){
  const crc=bytes=>{let c=0xffffffff;for(const byte of bytes){c^=byte;for(let i=0;i<8;i++)c=(c&1)?0xedb88320^(c>>>1):c>>>1;}return(c^0xffffffff)>>>0;};
  const chunk=(kind,data)=>{const type=Buffer.from(kind),length=Buffer.alloc(4),sum=Buffer.alloc(4);length.writeUInt32BE(data.length);sum.writeUInt32BE(crc(Buffer.concat([type,data])));return Buffer.concat([length,type,data,sum]);};
  const h=Buffer.alloc(13);h.writeUInt32BE(512);h.writeUInt32BE(512,4);h[8]=8;h[9]=2;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',h),chunk('IDAT',deflateSync(Buffer.alloc(512*(512*3+1)))),chunk('IEND',Buffer.alloc(0))]);
}
const CONCEPT=conceptPNG();
function fixture(t){
  const root=mkdtempSync(join(tmpdir(),'roof-followup-')),baseline=join(root,'baseline'),output=join(root,'output'),state=join(root,'state');mkdirSync(baseline);
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  function file(name,bytes){const p=join(baseline,name);mkdirSync(join(p,'..'),{recursive:true});const data=Buffer.isBuffer(bytes)?bytes:Buffer.from(JSON.stringify(bytes));writeFileSync(p,data);return {path:name,sha256:hash(data),bytes:data.length};}
  const summary={schemaVersion:1,sourceRevision:OLD,fixtureHash:'f'.repeat(64),generatorSourceSha256:'1'.repeat(64),engineSourceHashes:{engine:'2'.repeat(64)},policy:{id:'synthetic-only'},cases:[]};
  for(let i=0;i<12;i++)summary.cases.push({id:'roof-'+i,verification:{diagnosticPass:i<6},artifacts:{
    case:file('roof-'+i+'.case.json',{sourceRevision:OLD,synthetic:true}),oracle:file('roof-'+i+'.oracle.json',{synthetic:true}),
    customerData:file('roof-'+i+'.report.json',{revision:OLD,status:'REVIEW REQUIRED'}),customerPDF:file('roof-'+i+'.pdf',Buffer.from('%PDF-retained-fixture-'+i))}});
  file('summary.json',summary);file('index.html',Buffer.from('Original baseline report index'));
  const artifacts=['free/nano-banana-2','seedream-5','grok-imagine-2'].map((model,i)=>({...file('design/concept-'+i+'.png',PNG),model,taskId:'original-image-'+i,
    mimeType:'image/png',extension:'png',width:1,height:1,sourceRevision:OLD,artifactKind:'raster-design-concept',measurementUse:false,reviewStatus:'pending'}));
  file('design/gallery.html',Buffer.from('Original gallery; generation review pending'));
  const agents=MODEL_CATALOG.map(m=>({model:m.id,role:m.id==='claude-opus-5.5'?'ceo':'critique',taskId:'old-'+hash(m.id).slice(0,20),
    attempted:m.id!=='claude-opus-5.5',status:m.id==='claude-opus-5.5'?'blocked':m.id==='gpt-6.1-terra'?'failed':'complete',
    primaryValidated:!['claude-opus-5.5','gpt-6.1-terra'].includes(m.id),code:m.id==='claude-opus-5.5'?'BUDGET_LIMIT':m.id==='gpt-6.1-terra'?'ORIGINAL_FAILURE':null,
    reviewStatus:'pending',decision:null,reportedUsd:0}));
  agents.push(...DESIGN_CATALOG.map(m=>({model:m.id,role:'reporting',taskId:artifacts.find(a=>a.model===m.id)?.taskId||'old-design-'+hash(m.id).slice(0,20),attempted:true,
    status:artifacts.some(a=>a.model===m.id)?'complete':'failed',code:artifacts.some(a=>a.model===m.id)?null:'ORIGINAL_IMAGE_FAILURE',
    primaryValidated:artifacts.some(a=>a.model===m.id),artifact:artifacts.find(a=>a.model===m.id)||null,reviewStatus:'pending'})));
  const metrics={attempted:12,diagnosticPasses:6,reviewRequired:6,generatedCustomerPDFs:12,traceFailures:0,excludedCases:0,misclassifiedEdges:0,
    splits:{development:{cases:6,diagnosticPasses:4,reviewRequired:2},validation:{cases:3,diagnosticPasses:1,reviewRequired:2},holdout:{cases:3,diagnosticPasses:1,reviewRequired:2}}};
  const identity={protocol:'cloud-evaluation-v1',sourceRevision:OLD,seed:123,count:12,fixtureHash:summary.fixtureHash,generatorSourceSha256:summary.generatorSourceSha256,
    engineSourceHashes:summary.engineSourceHashes,metricsHash:hash(metrics),verificationPolicyHash:hash(summary.policy)};
  const evaluationHash=hash(identity),cycle={schemaVersion:1,protocol:identity.protocol,sourceRevision:OLD,seed:123,count:12,evaluationHash,metrics,pdfReview:{checked:12,failed:0},browserStatus:'passed',
    budget:{totalRequests:1,reportedUsd:0,committedUsd:1.8,unknownBillingRequests:1},fleet:{planHash:'9'.repeat(64),agents,coverage:{},
      // Real generator manifests omit primaryValidated; the trusted top-level
      // fleet rows carry that derived flag for retained raster validation.
      design:{workflowId:'fleet-retained',evaluationHash,sourceRevision:OLD,artifacts,agents:agents.filter(a=>a.role==='reporting').map(({primaryValidated,...row})=>row),galleryPath:'design/gallery.html'},
      designReview:{attempted:false,status:'failed',reviewCompleted:false,code:'BUDGET_LIMIT'}},reviews:agents,
    decision:{status:'review-required',fieldAccuracyValidated:false,productionReleaseApproved:false}};
  file('cycle.json',cycle);file('design-review.json',cycle.fleet.designReview);
  const store=new OrgStore(state);store.setControl('running');store.enqueue({id:'original-unknown',workflowId:'fleet-retained'});const lease=store.claim('old-worker');
  const attempt=store.reserve('original-unknown','old-worker',lease.fence,{usd:1.8,requestLimit:1,maxUsd:3,hourUsd:3,dayUsd:3,weekUsd:20,monthUsd:80});
  store.dispatch(attempt,'old-worker',lease.fence);store.settle(attempt,'old-worker',lease.fence,{reportedUsd:null});store.finish('original-unknown','old-worker',lease.fence,{status:'failed'});store.close();
  const calls=[];
  const requestRole=async(task,options)=>{
    calls.push({task,model:options.model,context:options.context,imageCount:options.images?.length||0});
    const p=getVerifiedModelPrice(options.model),attempt=await options.reserve({usd:p.contextTokens*p.maxRate/1e6});await options.onDispatch(attempt);await options.onUsage(attempt,{reportedUsd:.0002});
    const result={schemaVersion:1,taskId:task.id,role:task.role,sourceRevision:task.sourceRevision,datasetRevision:task.datasetRevision,candidateHash:task.candidateHash,
      policyVersion:task.policyVersion,inputHashes:task.inputHashes,decision:task.role==='ceo'?'reject':'revise',artifactRefs:[],summary:'Retained evidence requires review.',
      findings:task.role==='ceo'?[{code:'NUMERICAL_FAILURE',severity:'warning',message:'Recorded failures remain unresolved.',evidence:['retained-baseline']}]:
        options.context.images.map(image=>({code:'CONCEPT_REVIEW',severity:'info',message:'Concept remains an unimplemented visual proposal.',evidence:[image.evidenceRef]})),
      payload:task.role==='ceo'?{priority:90,requestedDecision:'reject'}:{counterexamples:[],recommendation:'Keep concepts provisional until implementation and browser verification.'}};
    if(task.constraints.requireMetricClaims)result.metricClaims=options.context.trustedMetricFacts;
    return {result,execution:{requestedModel:options.model,returnedModel:options.model,reportedUsd:.0002}};
  };
  return {root,baseline,output,state,cycle,summary,calls,requestRole,file,options:{stateDir:state,baselineDir:baseline,outputDir:output,sourceRevision:CURRENT,baselineRunId:RUN,paidAllowed:true,apiKey:'not-real-test-key',requestRole,
    catalogAuditor:async()=>({status:'verified',checkedAt:new Date().toISOString(),hash:'7'.repeat(64),issuesByModel:{}})}};
}
test('follow-up uses actual retained pixels and strict CEO facts with only two new dispatches and retained old holds',async t=>{
  const f=fixture(t),report=await runReviewFollowup(f.options);assert.equal(f.calls.length,2);
  assert.deepEqual(f.calls.map(c=>c.model),['gpt-6.1-terra','claude-opus-5.5']);assert.equal(f.calls[0].imageCount,3);
  assert.ok(f.calls.every(c=>c.task.sourceRevision===OLD&&c.task.workflowId==='fleet-retained'));
  assert.equal(f.calls[1].context.trustedMetricFacts['metrics.diagnosticPasses'],6);assert.equal(f.calls[1].context.trustedMetricFacts['metrics.reviewRequired'],6);
  assert.equal(report.sourceRevision,CURRENT);assert.equal(report.baseline.sourceRevision,OLD);assert.equal(report.executionMode,'review-existing');
  assert.equal(report.newlyGeneratedCases,0);assert.equal(report.newlyGeneratedCustomerPDFs,0);assert.equal(report.retainedCustomerPDFs,12);
  assert.equal(report.fleet.agents.length,51);assert.equal(new Set(report.fleet.agents.map(a=>a.model)).size,51);
  assert.equal(report.fleet.agents.find(a=>a.model==='claude-opus-5.5').attempted,true);
  assert.equal(report.fleet.agents.find(a=>a.model==='gpt-6.1-terra').code,'ORIGINAL_FAILURE');
  assert.equal(report.fleet.agents.find(a=>a.model==='gpt-6.1-terra').additionalReviews.length,1);
  assert.equal(report.fleet.designReview.reviewCompleted,true);assert.equal(report.fleet.agents.filter(a=>a.artifact&&a.reviewStatus==='complete').length,3);
  assert.equal(report.fleet.agents.filter(a=>a.artifact&&a.primaryValidated).length,3);
  assert.equal(report.fleet.coverage.validContributions,report.fleet.agents.filter(a=>a.primaryValidated).length);
  const manifest=JSON.parse(readFileSync(join(f.output,'design/manifest.json')));
  assert.equal(manifest.agents.length,6);assert.equal(manifest.artifacts.length,3);assert.equal(manifest.galleryPath,'design/review-gallery.html');
  assert.ok(manifest.agents.filter(a=>a.artifact).every(a=>a.reviewStatus==='complete'&&a.reviewerModel==='gpt-6.1-terra'));
  assert.ok(manifest.agents.filter(a=>a.artifact).every(a=>a.artifact.reviewStatus==='reviewed'&&a.artifact.reviewerModel==='gpt-6.1-terra'));
  assert.equal(report.fleet.agents.find(a=>a.model==='nano-banana-2').code,'ORIGINAL_IMAGE_FAILURE');
  assert.equal(report.budget.totalRequests,3);assert.equal(report.budget.unknownBillingRequests,1);assert.ok(report.budget.committedUsd>=1.8);
  assert.equal(report.decision.productionReleaseApproved,false);assert.equal(report.decision.fieldAccuracyValidated,false);
  for(const item of f.summary.cases)for(const ref of Object.values(item.artifacts))assert.equal(hash(readFileSync(join(f.output,ref.path))),ref.sha256);
  for(const image of f.cycle.fleet.design.artifacts)assert.equal(hash(readFileSync(join(f.output,image.path))),image.sha256);
  assert.deepEqual(JSON.parse(readFileSync(join(f.output,'baseline-evidence/cycle.json'))),f.cycle);
});
test('replaying the same baseline with a new operator revision reuses both reviews and never spends again',async t=>{
  const f=fixture(t),first=await runReviewFollowup(f.options),second=await runReviewFollowup({...f.options,sourceRevision:'d'.repeat(40)});
  assert.equal(f.calls.length,2);assert.equal(first.followup.evaluationHash,second.followup.evaluationHash);assert.equal(second.budget.totalRequests,3);
  assert.equal(first.budget.committedUsd,second.budget.committedUsd);assert.equal(second.baseline.sourceRevision,OLD);assert.equal(second.sourceRevision,'d'.repeat(40));
});
test('modified source bytes or a forged baseline evaluation hash block all paid review',async t=>{
  const first=fixture(t);writeFileSync(join(first.baseline,'roof-0.pdf'),'tampered');await assert.rejects(runReviewFollowup(first.options),{code:'INVALID_BASELINE_HASH'});assert.equal(first.calls.length,0);
  const second=fixture(t);second.cycle.evaluationHash='0'.repeat(64);second.file('cycle.json',second.cycle);await assert.rejects(runReviewFollowup(second.options),{code:'INVALID_BASELINE_HASH'});assert.equal(second.calls.length,0);
});
test('baseline path traversal and symlinked evidence are rejected before model calls',async t=>{
  const first=fixture(t);first.summary.cases[0].artifacts.customerPDF.path='../outside.pdf';first.file('summary.json',first.summary);
  await assert.rejects(runReviewFollowup(first.options),{code:'INVALID_BASELINE_PATH'});assert.equal(first.calls.length,0);
  const second=fixture(t);rmSync(join(second.baseline,'roof-0.pdf'));symlinkSync(join(second.baseline,'roof-1.pdf'),join(second.baseline,'roof-0.pdf'));
  await assert.rejects(runReviewFollowup(second.options),{code:'INVALID_BASELINE_PATH'});assert.equal(second.calls.length,0);
});
test('an empty spending directory cannot reset the retained baseline ledger',async t=>{
  const f=fixture(t);await assert.rejects(runReviewFollowup({...f.options,stateDir:join(f.root,'empty-state')}),{code:'BASELINE_LEDGER_MISSING'});assert.equal(f.calls.length,0);
});
test('unsupported CEO approval is retained as a failed contribution and never promotes recorded numerical failures',async t=>{
  const f=fixture(t),original=f.requestRole;
  const report=await runReviewFollowup({...f.options,requestRole:async(task,options)=>{const r=await original(task,options);if(task.role==='ceo'){r.result.decision='pass';r.result.payload.requestedDecision='approve';}return r;}});
  const ceo=report.fleet.agents.find(a=>a.model==='claude-opus-5.5');assert.equal(ceo.code,'UNSUPPORTED_CEO_APPROVAL');assert.equal(ceo.primaryValidated,false);assert.equal(report.decision.status,'review-required');
});
function qualificationOptions(f,imageCalls,{failModel}={}){
  for(const row of f.cycle.fleet.design.agents)if(!row.artifact)row.code='UPSTREAM_HTTP';
  for(const row of f.cycle.fleet.agents)if(row.role==='reporting'&&!row.artifact)row.code='UPSTREAM_HTTP';
  f.file('cycle.json',f.cycle);
  return {...f.options,generateMissingDesigns:true,minimumDispatchIntervalMs:0,
    auditCatalog:async()=>({readyIds:DESIGN_CATALOG.map(m=>m.id),blocked:[],hash:'8'.repeat(64),checkedAt:new Date().toISOString()}),
    requestDesign:async(task,options)=>{
      imageCalls.push({task,prompt:options.prompt,model:options.model});
      const model=DESIGN_CATALOG.find(m=>m.id===options.model),attempt=await options.reserve({usd:model.reserveUsd});await options.onDispatch(attempt);
      if(options.model===failModel){await options.onUsage(attempt,{reportedUsd:null});const e=new Error('Sanitized fixture upstream error');e.code='UPSTREAM_HTTP';e.status=503;e.errorDetails={httpStatus:503,requestId:'test-request'};throw e;}
      await options.onUsage(attempt,{reportedUsd:.001});
      return {contributionKind:'design-concept',imageBytes:CONCEPT,extension:'png',width:512,height:512,sha256:hash(CONCEPT),
        execution:{requestedModel:options.model,returnedModel:options.model},artifactMetadata:{conceptOnly:true}};
    }};
}
test('explicit qualification admits three distinct variants, retains all holds/history and replays without another call',async t=>{
  const f=fixture(t),imageCalls=[],options=qualificationOptions(f,imageCalls),report=await runReviewFollowup(options);
  assert.equal(imageCalls.length,3);assert.equal(f.calls.length,2);assert.equal(f.calls[0].imageCount,6,JSON.stringify(report.followup.qualification.agents));
  assert.equal(report.newlyGeneratedConcepts,3);assert.equal(report.followup.allowedAdditionalRequests,5);assert.equal(report.budget.totalRequests,6);
  assert.equal(report.budget.unknownBillingRequests,1);assert.ok(report.budget.committedUsd>=1.8);
  assert.equal(report.fleet.agents.length,51);assert.equal(report.fleet.design.artifacts.length,6);assert.equal(report.fleet.design.coverage.generated,6);
  assert.equal(report.fleet.agents.filter(a=>a.artifact&&a.primaryValidated).length,6);
  assert.equal(report.fleet.coverage.validContributions,report.fleet.agents.filter(a=>a.primaryValidated).length);
  const manifest=JSON.parse(readFileSync(join(f.output,'design/manifest.json')));
  assert.equal(manifest.agents.length,6);assert.equal(manifest.artifacts.length,6);
  assert.deepEqual(manifest.artifacts.map(a=>a.sha256),report.fleet.design.artifacts.map(a=>a.sha256));
  assert.ok(manifest.agents.filter(a=>a.artifact).every(a=>a.reviewStatus==='complete'&&a.reviewerModel==='gpt-6.1-terra'));
  assert.ok(manifest.agents.filter(a=>a.artifact).every(a=>a.artifact.reviewStatus==='reviewed'&&a.artifact.reviewerModel==='gpt-6.1-terra'));
  assert.ok(report.fleet.agents.filter(a=>a.artifact).every(a=>a.artifact.reviewStatus==='reviewed'&&a.artifact.reviewerModel==='gpt-6.1-terra'));
  assert.ok(imageCalls.every(call=>call.prompt.includes('distinct, simplified qualification concept')&&call.task.sourceRevision===OLD&&call.task.workflowId==='fleet-retained'));
  for(const model of ['nano-banana-2','gpt-image-2.6-flare','gpt-image-2.6-sunburst']){
    const row=report.fleet.agents.find(r=>r.model===model);assert.equal(row.history.at(-1).code,'UPSTREAM_HTTP');
    assert.equal(row.history.at(-1).taskId,row.originalTaskId);assert.notEqual(row.taskId,row.originalTaskId);assert.equal(row.status,'complete');
    assert.equal(row.artifact.generationOperatorSourceRevision,CURRENT);assert.equal(row.artifact.sourceRevision,OLD);assert.match(row.artifact.qualificationPromptHash,/^[a-f0-9]{64}$/);
  }
  for(const file of report.followup.copiedFiles)assert.equal(hash(readFileSync(join(f.output,file.outputPath))),file.sha256);
  const second=await runReviewFollowup({...options,sourceRevision:'d'.repeat(40)});
  assert.equal(imageCalls.length,3);assert.equal(f.calls.length,2);assert.equal(second.budget.totalRequests,6);assert.equal(second.newlyGeneratedConcepts,0);
  assert.equal(second.followup.qualifiedConceptsRelativeToBaseline,3);
  assert.equal(second.fleet.agents.find(row=>row.model==='nano-banana-2').operatorSourceRevision,CURRENT);
  assert.equal(report.followup.evaluationHash,second.followup.evaluationHash);
});
test('qualification excludes ambiguous original failures and permanent circuits, retaining a new explicit HTTP failure honestly',async t=>{
  const f=fixture(t),imageCalls=[],options=qualificationOptions(f,imageCalls,{failModel:'gpt-image-2.6-sunburst'});
  for(const rows of [f.cycle.fleet.agents,f.cycle.fleet.design.agents])rows.find(row=>row.model==='nano-banana-2').code='NETWORK_ERROR';
  f.file('cycle.json',f.cycle);
  const store=new OrgStore(f.state);store.event(null,'design-model-circuit-open',{model:'gpt-image-2.6-flare',status:403});store.close();
  const report=await runReviewFollowup(options);
  assert.deepEqual(imageCalls.map(c=>c.model),['gpt-image-2.6-sunburst']);assert.equal(f.calls[0].imageCount,3);assert.equal(report.newlyGeneratedConcepts,0);
  assert.equal(report.fleet.agents.find(row=>row.model==='nano-banana-2').code,'NETWORK_ERROR');
  assert.equal(report.fleet.agents.find(row=>row.model==='gpt-image-2.6-flare').taskId,f.cycle.fleet.agents.find(row=>row.model==='gpt-image-2.6-flare').taskId);
  const failed=report.fleet.agents.find(row=>row.model==='gpt-image-2.6-sunburst');assert.equal(failed.code,'UPSTREAM_HTTP');assert.equal(failed.history.at(-1).code,'UPSTREAM_HTTP');
  assert.equal(failed.errorDetails.httpStatus,503);assert.equal(report.budget.unknownBillingRequests,2);assert.ok(report.budget.committedUsd>=1.87);
  await runReviewFollowup(options);assert.equal(imageCalls.length,1);assert.equal(f.calls.length,2);
});
test('fresh text pricing audit blocks changed models independently and fails closed when unavailable',async t=>{
  const first=fixture(t);let audits=0;
  const changed=await runReviewFollowup({...first.options,catalogAuditor:async()=>{audits++;return {status:'verified',issuesByModel:{'claude-opus-5.5':'PRICING_CHANGED_REVERIFY'}};}});
  assert.equal(audits,1);assert.deepEqual(first.calls.map(c=>c.model),['gpt-6.1-terra']);assert.equal(changed.fleet.agents.find(a=>a.model==='claude-opus-5.5').code,'PRICING_CHANGED_REVERIFY');
  const second=fixture(t),unavailable=await runReviewFollowup({...second.options,catalogAuditor:async()=>({status:'unavailable',issuesByModel:{}})});
  assert.equal(second.calls.length,0);assert.equal(unavailable.fleet.designReview.code,'PUBLIC_CATALOG_UNVERIFIED');assert.equal(unavailable.budget.totalRequests,1);
});
