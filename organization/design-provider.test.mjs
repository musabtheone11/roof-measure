import test from 'node:test';
import assert from 'node:assert/strict';
import {deflateSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {requestDesignConcept,inspectDesignImage} from './design-provider.mjs';
import {DESIGN_CATALOG} from './design-catalog.mjs';

const task={schemaVersion:1,id:'design-test',role:'reporting',actorId:'designer',sourceRevision:'revision',datasetRevision:'synthetic-design',candidateHash:'a'.repeat(64),policyVersion:'design-v1',inputHashes:['b'.repeat(64)]};
function crc(bytes){let c=0xffffffff;for(const b of bytes){c^=b;for(let i=0;i<8;i++)c=(c&1)?0xedb88320^(c>>>1):c>>>1;}return (c^0xffffffff)>>>0;}
function chunk(name,data){const type=Buffer.from(name),size=Buffer.alloc(4),end=Buffer.alloc(4);size.writeUInt32BE(data.length);end.writeUInt32BE(crc(Buffer.concat([type,data])));return Buffer.concat([size,type,data,end]);}
function png(width=1024,height=1024){const h=Buffer.alloc(13);h.writeUInt32BE(width);h.writeUInt32BE(height,4);h[8]=8;h[9]=6;return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',h),chunk('IDAT',deflateSync(Buffer.alloc((width*4+1)*height))),chunk('IEND',Buffer.alloc(0))]);}
const image=png();
const json=data=>new Response(JSON.stringify(data),{status:200});
function fixture({model='nano-banana-2',response,access,reserve,onDispatch,onUsage,fetchImpl}={}) {
  const calls=[],events=[];
  return {calls,events,options:{apiKey:'test-image-secret',model,prompt:'An abstract grayscale brand-page layout using placeholder text only.',
    reserve:reserve||((value)=>{events.push({kind:'reserve',value});return 'image-attempt';}),
    onDispatch:onDispatch||((id)=>{events.push({kind:'dispatch',id});}),
    onUsage:onUsage||((id,value)=>{events.push({kind:'usage',id,value});}),
    onResponse:metadata=>events.push({kind:'response',metadata}),
    fetchImpl:async(url,init)=>{calls.push({url,init});if(fetchImpl)return fetchImpl(url,init);
      if(url.endsWith('/subscription'))return json(access||{allowed:true,mode:'subscription',unlimited:false,tokens_remaining:10000000,expires_at_utc:new Date(Date.now()+3600000).toISOString()});
      return response?response():json({model,id:'image-response',usage:{cost_tokens:30000},data:[{b64_json:image.toString('base64')}]});}}};
}
test('flat reservation commits before one fixed image POST; output bytes and metadata are bounded',async()=>{
  const f=fixture();const result=await requestDesignConcept(task,f.options);
  assert.deepEqual(f.events.map(e=>e.kind),['reserve','dispatch','usage','response']);assert.equal(f.events[0].value.usd,.03);
  assert.equal(f.calls.length,1);assert.equal(f.calls[0].url,'https://api.apinex.bond/v1/images/generations');assert.equal(f.calls[0].init.redirect,'error');
  const body=JSON.parse(f.calls[0].init.body);assert.equal(body.size,'1024x1024');assert.equal(body.aspect_ratio,'1:1');assert.equal(body.response_format,'b64_json');assert.equal(body.n,1);
  assert.equal(body.prompt.includes('test-image-secret'),false);assert.equal(result.contributionKind,'design-concept');
  assert.equal(result.width,1024);assert.equal(result.height,1024);assert.equal(result.extension,'png');assert.equal(result.sha256,createHash('sha256').update(image).digest('hex'));
  assert.equal(result.execution.reportedUsd,.03);assert.equal(result.execution.identityStatus,'exact-match');assert.equal(result.artifactMetadata.measurementEvidence,false);
  const metadata=JSON.stringify(f.events.at(-1).metadata);assert.ok(metadata.length<4096);assert.equal(metadata.includes(image.toString('base64')),false);assert.equal(metadata.includes('test-image-secret'),false);
});
test('all six model identities use their conservative flat per-image reservation',async()=>{
  for(const model of DESIGN_CATALOG) {
    const f=fixture({model:model.id,response:()=>json({data:[{b64_json:image.toString('base64')}],cost_tokens:0})});
    const result=await requestDesignConcept(task,f.options);
    assert.equal(f.events[0].value.usd,Math.max(model.priceUsd,model.reserveUsd));assert.equal(result.execution.requestedModel,model.id);
    assert.equal(result.execution.returnedModel,null);assert.equal(result.execution.identityStatus,'not-reported');
  }
});
test('missing usage remains unknown; expected flat price never becomes fabricated actual billing',async()=>{
  const f=fixture({response:()=>json({data:[{b64_json:image.toString('base64')}]})});const r=await requestDesignConcept(task,f.options);
  assert.equal(r.execution.reportedUsd,null);assert.equal(r.execution.billingStatus,'unknown');assert.equal(r.execution.pricing.reservedUsd,.03);
  assert.equal(f.events.find(e=>e.kind==='usage').value.reportedUsd,null);
});
test('free image checks subscription and five-million allowance separately from zero wallet cost',async()=>{
  const f=fixture({model:'free/nano-banana-2',response:()=>json({data:[{b64_json:image.toString('base64')}],usage:{cost_tokens:0}})});
  const r=await requestDesignConcept(task,f.options);assert.equal(f.calls[0].url,'https://api.apinex.bond/v1/subscription');assert.equal(f.calls[1].init.method,'POST');
  assert.equal(f.events[0].value.usd,0);assert.equal(f.events[0].value.allowanceTokens,5000000);assert.equal(r.execution.reportedUsd,0);
  for(const access of [{allowed:false},{allowed:true,mode:'free',unlimited:true},{allowed:true,mode:'subscription',unlimited:false,tokens_remaining:4999999}]) {
    const blocked=fixture({model:'free/nano-banana-2',access});await assert.rejects(requestDesignConcept(task,blocked.options),e=>['SUBSCRIPTION_REQUIRED','ALLOWANCE_EXHAUSTED'].includes(e.code));
    assert.equal(blocked.calls.filter(c=>c.init.method==='POST').length,0);assert.equal(blocked.events.length,0);
  }
});
test('unexpected model identity rejects after settlement; omitted identity is preserved as unreported',async()=>{
  const f=fixture({response:()=>json({model:'grok-imagine-2',usage:{cost_tokens:20000},data:[{b64_json:image.toString('base64')}]})});
  await assert.rejects(requestDesignConcept(task,f.options),{code:'MODEL_MISMATCH'});assert.equal(f.events.find(e=>e.kind==='usage').value.reportedUsd,.02);
});
test('bad images, extra outputs and URL-only/asynchronous responses reject without followup requests',async()=>{
  for(const data of [[{b64_json:Buffer.from('not an image').toString('base64')}],[{url:'https://untrusted.example/image.png'}],[],[{b64_json:image.toString('base64')},{b64_json:image.toString('base64')}],[{b64_json:'data:image/png;base64,'+image.toString('base64')}]]) {
    const f=fixture({response:()=>json({data})});await assert.rejects(requestDesignConcept(task,f.options));assert.equal(f.calls.length,1);assert.equal(f.events.find(e=>e.kind==='usage').value.reportedUsd,null);
  }
  const oversized=fixture({response:()=>json({data:[{b64_json:Buffer.alloc(4*1024*1024+1).toString('base64')}]})});
  await assert.rejects(requestDesignConcept(task,oversized.options),{code:'IMAGE_TOO_LARGE_OR_INVALID'});
  const badDimension=fixture({response:()=>json({data:[{b64_json:png(4096,512).toString('base64')}]})});
  await assert.rejects(requestDesignConcept(task,badDimension.options),{code:'INVALID_IMAGE_DIMENSIONS'});
});
test('PNG corruption and JPEG header bounds are checked without claiming full JPEG raster verification',()=>{
  const broken=Buffer.from(image);broken[broken.length-1]^=1;assert.throws(()=>inspectDesignImage(broken),{code:'INVALID_IMAGE_FORMAT'});
  const frame=Buffer.from([255,216,255,192,0,17,8,4,0,4,0,3,1,17,0,2,17,0,3,17,0,255,218,0,12,3,1,0,2,0,3,0,0,63,0,1,2,3,4,255,217]);
  const parsed=inspectDesignImage(frame);assert.equal(parsed.extension,'jpg');assert.equal(parsed.width,1024);assert.match(parsed.formatValidation,/independent visual inspection/);
});
test('response-body cap, timeout and cancellation retain unknown generation reservations without retries',async()=>{
  const huge=fixture({response:()=>new Response('',{status:200,headers:{'content-length':String(16*1024*1024+1)}})});
  await assert.rejects(requestDesignConcept(task,huge.options),{code:'RESPONSE_TOO_LARGE'});assert.equal(huge.events.at(-1).value.reportedUsd,null);
  const timeout=fixture({fetchImpl:async(url,{signal})=>new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(new Error('aborted')),{once:true}))});
  await assert.rejects(requestDesignConcept(task,{...timeout.options,timeoutMs:5}),{code:'TIMEOUT'});assert.equal(timeout.calls.length,1);assert.equal(timeout.events.at(-1).value.reportedUsd,null);
  const controller=new AbortController();controller.abort();const cancelled=fixture();await assert.rejects(requestDesignConcept(task,{...cancelled.options,signal:controller.signal}),{code:'CANCELLED'});assert.equal(cancelled.calls.length,0);
});
test('budgets, callbacks and unverified model/endpoint controls cannot leak credentials or create hidden calls',async()=>{
  const f=fixture({reserve:()=>{throw Object.assign(new Error('budget exhausted'),{code:'BUDGET_LIMIT'});}});await assert.rejects(requestDesignConcept(task,f.options),{code:'BUDGET_LIMIT'});assert.equal(f.calls.length,0);
  const missing=fixture();await assert.rejects(requestDesignConcept(task,{...missing.options,model:'unverified-image'}),{code:'DESIGN_MODEL_UNVERIFIED'});assert.equal(missing.calls.length,0);
  await assert.rejects(requestDesignConcept(task,{...missing.options,prompt:'test-image-secret'}),{code:'INVALID_DESIGN_PROMPT'});
  let usageCalls=0;const settlement=fixture({onUsage:()=>{usageCalls++;throw Object.assign(new Error('fenced'),{code:'STALE_LEASE'});}});
  await assert.rejects(requestDesignConcept(task,settlement.options),{code:'STALE_LEASE'});assert.equal(usageCalls,1);
  const redirect=fixture({fetchImpl:async()=>{throw new Error('untrusted redirect with secret debug');}});
  await assert.rejects(requestDesignConcept(task,redirect.options),e=>e.code==='NETWORK_ERROR'&&!e.message.includes('test-image-secret'));assert.equal(redirect.calls.length,1);
});
