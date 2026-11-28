import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,symlinkSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {OrgStore} from './store.mjs';
import {reviewDesignConcepts,DESIGN_REVIEW_MODEL} from './design-review.mjs';

const PIXEL=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZbWQAAAAASUVORK5CYII=','base64');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
function setup(t,count=6) {
  const root=mkdtempSync(join(tmpdir(),'roof-design-review-')),outputDir=join(root,'output'),state=join(root,'state');
  mkdirSync(join(outputDir,'design'),{recursive:true});
  const store=new OrgStore(state);store.setControl('running');
  const stores=[store];t.after(()=>{for(const s of stores)try{s.close();}catch{}rmSync(root,{recursive:true,force:true});});
  const evaluationHash=sha(Buffer.from('generated-design-evaluation')),sourceRevision='independent-design-source';
  const artifacts=Array.from({length:count},(_,index)=>{
    const path=`design/model-${index}.png`;writeFileSync(join(outputDir,path),PIXEL);
    return {model:'image-model-'+index,taskId:'generated-image-task-'+index,path,mimeType:'image/png',extension:'png',
      sha256:sha(PIXEL),bytes:PIXEL.length,width:1,height:1,sourceRevision,artifactKind:'raster-design-concept',reviewStatus:'pending',measurementUse:false};
  });
  return {root,state,stores,store,outputDir,evaluationHash,sourceRevision,inputHash:sha(Buffer.from('source-image-request')),
    designFleet:{workflowId:'shared-text-and-design-budget',evaluationHash,artifacts},
    paidAllowed:true,apiKey:'test-value-no-network',limits:{requestLimit:64,maxUsd:2,hourUsd:2,dayUsd:3,weekUsd:20,monthUsd:80}};
}
function response(task,options,{omitLast=false,identity=DESIGN_REVIEW_MODEL}={}) {
  const manifest=options.context.images;
  return {result:{schemaVersion:1,taskId:task.id,role:task.role,
    ...Object.fromEntries(['sourceRevision','datasetRevision','candidateHash','policyVersion','inputHashes'].map(k=>[k,task[k]])),
    decision:'revise',findings:(omitLast?manifest.slice(0,-1):manifest).map((image,index)=>({code:'VISUAL_'+index,severity:'info',
      evidence:[image.evidenceRef],message:'The supplied raster concept remains a prototype requiring actual implementation and browser validation.'})),
    artifactRefs:[],summary:'Prototype review only.',payload:{counterexamples:[],recommendation:'Retain clear review status and verify implemented contrast.'}},
    execution:{requestedModel:DESIGN_REVIEW_MODEL,returnedModel:identity,reportedUsd:.001}};
}
async function recorded(options,{unknown=false}={}) {
  const attempt=await options.reserve({usd:.17825792});await options.onDispatch(attempt);
  if(!unknown)await options.onUsage(attempt,{reportedUsd:.001});
}

test('independent review sends all six actual image byte buffers, binds hashes and reuses completion',async t=>{
  const fixture=setup(t);let calls=0;
  const requestRole=async(task,options)=>{
    calls++;assert.equal(task.role,'critique');assert.equal(options.model,DESIGN_REVIEW_MODEL);
    assert.equal(task.workflowId,fixture.designFleet.workflowId);assert.equal(options.images.length,6);
    for(const image of options.images) {assert.ok(Buffer.isBuffer(image.data));assert.ok(image.data.equals(PIXEL));assert.ok(task.inputHashes.includes(sha(image.data)));}
    assert.equal(options.context.images.length,6);assert.equal(options.context.measurementUse,false);
    await recorded(options);return response(task,options);
  };
  const reviewed=await reviewDesignConcepts({...fixture,requestRole});
  assert.equal(calls,1);assert.equal(reviewed.attempted,true);assert.equal(reviewed.reviewCompleted,true);
  assert.equal(reviewed.reviewerModel,DESIGN_REVIEW_MODEL);assert.equal(reviewed.reviewedImages.length,6);
  assert.equal(reviewed.decision,'revise');assert.equal(reviewed.reportedUsd,.001);
  assert.equal(reviewed.prototypeOnly,true);assert.equal(reviewed.measurementUse,false);assert.equal(reviewed.productionReleaseApproved,false);
  assert.match(reviewed.resultHash,/^[a-f0-9]{64}$/);
  const replay=await reviewDesignConcepts({...fixture,requestRole});assert.equal(calls,1);assert.equal(replay.reused,true);assert.equal(replay.reviewCompleted,true);
  const readOnly=await reviewDesignConcepts({...fixture,paidAllowed:false,apiKey:null,requestRole});
  assert.equal(readOnly.reviewCompleted,true);assert.equal(readOnly.reused,true);assert.equal(calls,1);
});

test('model text without evidence for every supplied image cannot mark a batch visually reviewed',async t=>{
  const fixture=setup(t);let calls=0;
  const requestRole=async(task,options)=>{calls++;await recorded(options);return response(task,options,{omitLast:true});};
  const result=await reviewDesignConcepts({...fixture,requestRole});
  assert.equal(result.attempted,true);assert.equal(result.reviewCompleted,false);assert.equal(result.reviewedImages.length,0);
  assert.equal(result.code,'DESIGN_REVIEW_COVERAGE_INCOMPLETE');assert.equal(result.reportedUsd,.001);assert.ok(result.resultHash);
  const repeated=await reviewDesignConcepts({...fixture,requestRole});assert.equal(calls,1);assert.equal(repeated.reused,true);assert.equal(repeated.reviewCompleted,false);
});

test('an ambiguous dispatched visual request preserves its reservation across restart and never resends',async t=>{
  const fixture=setup(t,1);let calls=0;
  const requestRole=async(task,options)=>{calls++;await recorded(options,{unknown:true});throw Object.assign(new Error('No response'),{code:'NETWORK_ERROR'});};
  const first=await reviewDesignConcepts({...fixture,requestRole});
  assert.equal(first.reviewCompleted,false);assert.equal(first.unknownBillingRequests,1);assert.equal(first.reportedUsd,null);
  assert.equal(fixture.store.ledger().reservedUsd,.17825792);
  fixture.store.close();const reopened=new OrgStore(fixture.state);fixture.stores.push(reopened);
  const second=await reviewDesignConcepts({...fixture,store:reopened,requestRole});
  assert.equal(calls,1);assert.equal(second.reused,true);assert.equal(second.attempted,true);
  assert.equal(second.unknownBillingRequests,1);assert.equal(second.reportedUsd,null);assert.equal(reopened.ledger().reservedUsd,.17825792);
});

test('tampered pixels, wrong source/MIME, escaping paths and self-review block before inference',async t=>{
  const fixture=setup(t,1);let calls=0;
  const requestRole=async()=>{calls++;throw new Error('Must not run');};
  const original=fixture.designFleet.artifacts[0];
  for(const [change,code] of [[{sha256:'0'.repeat(64)},'DESIGN_IMAGE_HASH_MISMATCH'],
    [{sourceRevision:'stale-source'},'DESIGN_IMAGE_SOURCE_REVISION_MISMATCH'],[{mimeType:'image/jpeg'},'DESIGN_IMAGE_MIME_MISMATCH'],
    [{path:'../escape.png'},'UNSAFE_DESIGN_PATH'],[{model:DESIGN_REVIEW_MODEL},'DESIGN_SELF_REVIEW_BLOCKED'],
    [{measurementUse:true},'INVALID_DESIGN_ARTIFACT']]) {
    const designFleet={...fixture.designFleet,artifacts:[{...original,...change}]};
    const result=await reviewDesignConcepts({...fixture,designFleet,requestRole});assert.equal(result.code,code);assert.equal(result.attempted,false);
  }
  const target=join(fixture.outputDir,'design','linked.png');symlinkSync(join(fixture.outputDir,original.path),target);
  const result=await reviewDesignConcepts({...fixture,designFleet:{...fixture.designFleet,artifacts:[{...original,path:'design/linked.png'}]},requestRole});
  assert.equal(result.code,'UNSAFE_DESIGN_PATH');assert.equal(calls,0);
});

test('per-image and aggregate byte caps block oversized review without silently dropping concepts',async t=>{
  const fixture=setup(t,6);let calls=0;
  const requestRole=async()=>{calls++;throw new Error('Must not run');};
  const oversized=Buffer.alloc(4*1024*1024+1);PIXEL.copy(oversized);const first=fixture.designFleet.artifacts[0];
  writeFileSync(join(fixture.outputDir,first.path),oversized);
  let result=await reviewDesignConcepts({...fixture,requestRole});assert.equal(result.code,'DESIGN_IMAGE_TOO_LARGE');
  const threeMiB=Buffer.alloc(3*1024*1024);PIXEL.copy(threeMiB);
  for(const artifact of fixture.designFleet.artifacts) {writeFileSync(join(fixture.outputDir,artifact.path),threeMiB);artifact.sha256=sha(threeMiB);artifact.bytes=threeMiB.length;}
  result=await reviewDesignConcepts({...fixture,requestRole});assert.equal(result.code,'DESIGN_IMAGE_BATCH_TOO_LARGE');assert.equal(calls,0);
});

test('generation and visual review share the exact same durable workflow spending cap',async t=>{
  const fixture=setup(t,1);let calls=0;
  fixture.store.enqueue({id:'prior-generation',workflowId:fixture.designFleet.workflowId});
  const lease=fixture.store.claim('image-generator'),limits={...fixture.limits,usd:2};
  const attempt=fixture.store.reserve(lease.id,'image-generator',lease.fence,limits);
  fixture.store.dispatch(attempt,'image-generator',lease.fence);fixture.store.settle(attempt,'image-generator',lease.fence,{reportedUsd:1.95});
  fixture.store.finish(lease.id,'image-generator',lease.fence,{status:'complete'});
  const result=await reviewDesignConcepts({...fixture,requestRole:async(task,options)=>{calls++;await recorded(options);return response(task,options);}});
  assert.equal(calls,1);assert.equal(result.code,'BUDGET_LIMIT');assert.equal(result.attempted,false);assert.equal(result.reviewCompleted,false);
  assert.equal(fixture.store.ledger().reportedUsd,1.95);
});

test('changing concept pixels within the same evaluation cannot replay a stale accepted review or issue a new call',async t=>{
  const fixture=setup(t,1);let calls=0;
  const requestRole=async(task,options)=>{calls++;await recorded(options);return response(task,options);};
  assert.equal((await reviewDesignConcepts({...fixture,requestRole})).reviewCompleted,true);
  const changed=Buffer.concat([PIXEL,Buffer.from([0])]),artifact=fixture.designFleet.artifacts[0];
  writeFileSync(join(fixture.outputDir,artifact.path),changed);artifact.sha256=sha(changed);artifact.bytes=changed.length;
  const result=await reviewDesignConcepts({...fixture,requestRole});assert.equal(result.code,'DESIGN_REVIEW_INPUT_CHANGED');
  assert.equal(result.reviewCompleted,false);assert.equal(calls,1);
});

test('disabled processing and an adapter reply without dispatch never claim visual review',async t=>{
  const fixture=setup(t,1);let calls=0;
  const requestRole=async(task,options)=>{calls++;return response(task,options);};
  const disabled=await reviewDesignConcepts({...fixture,paidAllowed:false,requestRole});assert.equal(disabled.code,'CHECKPOINT_LINEAGE_BLOCKED');assert.equal(calls,0);
  const fabricated=await reviewDesignConcepts({...fixture,requestRole});assert.equal(fabricated.code,'DISPATCH_EVIDENCE_MISSING');
  assert.equal(fabricated.attempted,false);assert.equal(fabricated.reviewCompleted,false);assert.equal(calls,1);
});

test('persisted provider faults and cooldowns gate visual review instead of repeating permanent failures',async t=>{
  const fixture=setup(t,1);let calls=0;
  const requestRole=async()=>{calls++;throw Object.assign(new Error('Authentication failed'),{code:'UPSTREAM_HTTP',status:401});};
  const first=await reviewDesignConcepts({...fixture,requestRole});assert.equal(first.attempted,false);assert.equal(calls,1);
  const later=await reviewDesignConcepts({...fixture,evaluationHash:sha(Buffer.from('later evaluation')),
    designFleet:{...fixture.designFleet,evaluationHash:sha(Buffer.from('later evaluation'))},requestRole});
  assert.equal(later.code,'PROVIDER_AUTH_RECONCILIATION_REQUIRED');assert.equal(calls,1);
});

test('one generic finding listing all hashes is not separate visual review of each concept',async t=>{
  const fixture=setup(t,3);
  const result=await reviewDesignConcepts({...fixture,requestRole:async(task,options)=>{
    await recorded(options);const reply=response(task,options);
    reply.result.findings=[{code:'GENERIC',severity:'info',message:'All concepts reviewed.',evidence:options.context.images.map(i=>i.evidenceRef)}];return reply;
  }});
  assert.equal(result.code,'DESIGN_REVIEW_COVERAGE_INCOMPLETE');assert.equal(result.reviewCompleted,false);
});
