import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync,unlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {deflateSync} from 'node:zlib';
import {OrgStore} from './store.mjs';
import {DESIGN_CATALOG} from './design-catalog.mjs';
import {DESIGN_ASSIGNMENTS,runDesignFleet} from './design-fleet.mjs';

function png(){
  const crc=bytes=>{let c=0xffffffff;for(const byte of bytes){c^=byte;for(let i=0;i<8;i++)c=(c&1)?0xedb88320^(c>>>1):c>>>1;}return(c^0xffffffff)>>>0;};
  const chunk=(kind,data)=>{const type=Buffer.from(kind),length=Buffer.alloc(4),sum=Buffer.alloc(4);length.writeUInt32BE(data.length);sum.writeUInt32BE(crc(Buffer.concat([type,data])));return Buffer.concat([length,type,data,sum]);};
  const header=Buffer.alloc(13);header.writeUInt32BE(512,0);header.writeUInt32BE(512,4);header[8]=8;header[9]=2;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(Buffer.alloc(512*(512*3+1)))),chunk('IEND',Buffer.alloc(0))]);
}
const IMAGE=png(),SHA=createHash('sha256').update(IMAGE).digest('hex');
function fixture(t){const root=mkdtempSync(join(tmpdir(),'roof-design-fleet-')),store=new OrgStore(join(root,'state'));t.after(()=>{store.close();rmSync(root,{recursive:true,force:true});});return {root,store};}
function options(t,catalog=DESIGN_CATALOG,extra={}){
  const {root,store}=fixture(t);let calls=0;
  const base={store,catalog,evaluationHash:'a'.repeat(64),sourceRevision:'design-source',inputHash:'b'.repeat(64),outputDir:join(root,'output'),
    paidAllowed:true,apiKey:'test-key-not-real',minimumDispatchIntervalMs:0,
    catalogAudit:{ok:true,readyIds:catalog.map(m=>m.id),blocked:[],hash:'verified-design-catalog',checkedAt:new Date().toISOString(),unknownIds:[]},
    archiveRef:{repository:'owner/repo',runId:'123',runAttempt:'1',reportArtifactName:'roof-cloud-reports-123-1'},
    requestDesign:async(task,opts)=>{
      calls++;const entry=catalog.find(m=>m.id===opts.model),id=await opts.reserve({usd:entry.reserveUsd,model:entry.id});
      await opts.onDispatch(id);await opts.onUsage(id,{reportedUsd:entry.priceUsd});
      return {contributionKind:'design-concept',imageBytes:IMAGE,extension:'png',width:512,height:512,sha256:SHA,
        execution:{requestedModel:opts.model,returnedModel:null,identityStatus:'not-reported',reportedUsd:entry.priceUsd},
        artifactMetadata:{artifactKind:'raster-design-concept',requiresVisualReview:true,measurementUse:false}};
    },...extra};
  return {base,root,store,calls:()=>calls};
}
test('six verified model assignments have distinct useful concept duties and no real source data',()=>{
  assert.equal(DESIGN_ASSIGNMENTS.length,6);assert.equal(new Set(DESIGN_ASSIGNMENTS.map(a=>a.model)).size,6);
  assert.equal(new Set(DESIGN_ASSIGNMENTS.map(a=>a.task)).size,6);
  assert.deepEqual([...DESIGN_ASSIGNMENTS.map(a=>a.model)].sort(),[...DESIGN_CATALOG.map(m=>m.id)].sort());
});
test('all six image adapters dispatch with exact flat holds and retain actual PNGs plus review-pending gallery',async t=>{
  const {base,store,calls}=options(t);const result=await runDesignFleet(base);
  assert.equal(calls(),6);assert.equal(result.coverage.attempted,6);assert.equal(result.coverage.generated,6);assert.equal(result.coverage.complete,true);
  assert.equal(result.measurementUse,false);assert.equal(result.productionApproved,false);assert.equal(result.reviewStatus,'pending');
  for(const artifact of result.artifacts){assert.equal(artifact.sha256,SHA);assert.deepEqual(readFileSync(join(base.outputDir,artifact.path)),IMAGE);assert.equal(artifact.reviewStatus,'pending');assert.equal(artifact.measurementUse,false);}
  const html=readFileSync(join(base.outputDir,result.galleryPath),'utf8');assert.match(html,/review pending/);assert.equal((html.match(/<img /g)||[]).length,6);assert.doesNotMatch(html,/<script/i);
  const sun=store.ledger().attempts.find(a=>Math.abs(a.reserve_usd-.07)<1e-9);assert.ok(sun);assert.equal(sun.reported_usd,.065);
  assert.equal(store.events().filter(e=>e.kind==='design-image-cached').length,6);
});
test('same design evaluation reuses cached raster artifacts without new dispatch or charge',async t=>{
  const {base,store,calls}=options(t);const first=await runDesignFleet(base),charge=store.ledger().reportedUsd;
  const second=await runDesignFleet(base);assert.equal(calls(),6);assert.equal(second.coverage.generated,6);assert.ok(second.agents.every(a=>a.reused));
  assert.equal(first.workflowId,second.workflowId);assert.equal(store.ledger().reportedUsd,charge);
});
test('archived old image cache exposes its original artifact reference and never regenerates',async t=>{
  const {base,store,calls}=options(t,DESIGN_CATALOG.filter(m=>m.id==='nano-banana-2'));
  await runDesignFleet(base);unlinkSync(join(store.blobDirectory,SHA));
  const second=await runDesignFleet(base);assert.equal(calls(),1);assert.equal(second.coverage.archived,1);assert.equal(second.coverage.generated,0);
  assert.equal(second.agents[0].code,'ARTIFACT_ARCHIVED');assert.equal(second.agents[0].archivedArtifact.archiveRef.runId,'123');
});
test('explicit zero requests and zero runtime disable generation while retaining truthful assignment status',async t=>{
  const one=options(t);const zero=await runDesignFleet({...one.base,limits:{requestLimit:0}});assert.equal(one.calls(),0);assert.equal(zero.coverage.attempted,0);
  assert.ok(zero.agents.every(a=>a.code==='DESIGN_REQUEST_LIMIT'));
  const two=options(t);let auditCalls=0;const runtime=await runDesignFleet({...two.base,runtimeMs:0,catalogAudit:null,auditCatalog:async()=>{auditCalls++;}});
  assert.equal(two.calls(),0);assert.equal(auditCalls,0);assert.ok(runtime.agents.every(a=>a.code==='DESIGN_RUNTIME_LIMIT'));
});
test('failed or changed public catalog blocks only unverified image calls',async t=>{
  const all=options(t);const result=await runDesignFleet({...all.base,catalogAudit:{readyIds:['seedream-5'],blocked:DESIGN_CATALOG.filter(m=>m.id!=='seedream-5').map(m=>({id:m.id,code:'DESIGN_PRICE_INCREASED'})),hash:'fresh'}});
  assert.equal(all.calls(),1);assert.equal(result.coverage.generated,1);assert.equal(result.agents.filter(a=>a.code==='DESIGN_PRICE_INCREASED').length,5);
});
test('unknown flat-price charges remain reserved, same task never repeats and new evaluation may do bounded new work',async t=>{
  const one=options(t,DESIGN_CATALOG.filter(m=>m.id==='nano-banana-2'));let calls=0;
  const requestDesign=async(task,opts)=>{calls++;const id=await opts.reserve({usd:.03});await opts.onDispatch(id);await opts.onUsage(id,{reportedUsd:null});return {contributionKind:'design-concept',imageBytes:IMAGE,extension:'png',width:512,height:512,sha256:SHA,execution:{requestedModel:opts.model,returnedModel:null,identityStatus:'not-reported',reportedUsd:null}};};
  const first=await runDesignFleet({...one.base,requestDesign});assert.equal(first.agents[0].reportedUsd,null);assert.equal(one.store.ledger().reservedUsd,.03);
  await runDesignFleet({...one.base,requestDesign});assert.equal(calls,1);
  await runDesignFleet({...one.base,evaluationHash:'c'.repeat(64),requestDesign});assert.equal(calls,2);assert.equal(one.store.ledger().reservedUsd,.06);
});
test('model-specific403 does not substitute or stop other verified image models',async t=>{
  const one=options(t);const original=one.base.requestDesign;
  const result=await runDesignFleet({...one.base,requestDesign:async(task,opts)=>{
    if(opts.model==='free/nano-banana-2')throw Object.assign(new Error('Not entitled'),{status:403,code:'DESIGN_ACCESS_DENIED'});
    return original(task,opts);
  }});
  assert.equal(result.agents.find(a=>a.model==='free/nano-banana-2').attempted,false);assert.equal(result.coverage.generated,5);
  assert.ok(result.agents.filter(a=>a.model!=='free/nano-banana-2').every(a=>a.status==='complete'));
});
test('provider401 stops further image calls and leaves a durable global authentication circuit',async t=>{
  const one=options(t);let calls=0;const result=await runDesignFleet({...one.base,requestDesign:async()=>{calls++;throw Object.assign(new Error('Authentication failed'),{status:401,code:'DESIGN_HTTP_ERROR'});}});
  assert.equal(calls,1);assert.equal(result.coverage.attempted,0);assert.ok(one.store.events().some(e=>e.kind==='fleet-provider-circuit-open'));
});
test('an adapter response without dispatch or mismatched raster metadata cannot count as generated work',async t=>{
  const one=options(t,DESIGN_CATALOG.filter(m=>m.id==='nano-banana-2'));const original=one.base.requestDesign;
  const result=await runDesignFleet({...one.base,requestDesign:async(task,opts)=>{const response=await original(task,opts);response.width=1024;return response;}});
  assert.equal(result.coverage.attempted,1);assert.equal(result.coverage.generated,0);assert.equal(result.agents[0].code,'DESIGN_IMAGE_METADATA_MISMATCH');
  const two=options(t,DESIGN_CATALOG.filter(m=>m.id==='nano-banana-2'));
  const noDispatch=await runDesignFleet({...two.base,requestDesign:async()=>({contributionKind:'design-concept',imageBytes:IMAGE})});
  assert.equal(noDispatch.coverage.attempted,0);assert.equal(noDispatch.coverage.generated,0);assert.equal(noDispatch.agents[0].code,'DESIGN_DISPATCH_EVIDENCE_MISSING');
});
test('shared weekly ledger prevents new image charges and image byte bounds cannot bypass validation',async t=>{
  const one=options(t,DESIGN_CATALOG.filter(m=>m.id==='nano-banana-2'));
  one.store.setControl('running');one.store.enqueue({id:'prior-spend'});const prior=one.store.claim('prior');const id=one.store.reserve('prior-spend','prior',prior.fence,{usd:20,requestLimit:1,maxUsd:20,hourUsd:20,dayUsd:20,weekUsd:20,monthUsd:80});
  one.store.dispatch(id,'prior',prior.fence);one.store.settle(id,'prior',prior.fence,{reportedUsd:20});one.store.finish('prior-spend','prior',prior.fence,{status:'complete'});
  const blocked=await runDesignFleet(one.base);assert.equal(one.calls(),0);assert.equal(blocked.agents[0].code,'BUDGET_LIMIT');
  const two=options(t,DESIGN_CATALOG.filter(m=>m.id==='nano-banana-2'));const original=two.base.requestDesign;
  const bad=await runDesignFleet({...two.base,requestDesign:async(task,opts)=>{const response=await original(task,opts);response.imageBytes=Buffer.alloc(4*1024*1024+1);return response;}});
  assert.equal(bad.coverage.generated,0);assert.equal(bad.agents[0].code,'DESIGN_IMAGE_SIZE_LIMIT');
});
