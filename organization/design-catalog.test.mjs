import test from 'node:test';
import assert from 'node:assert/strict';
import {DESIGN_CATALOG,DESIGN_CATALOG_METADATA,getDesignModel,auditDesignCatalog} from './design-catalog.mjs';

const raw=()=>({models:DESIGN_CATALOG.map(model=>({id:model.id,...model.publishedMetadata}))});
const serve=value=>async(url,init)=>{
  assert.equal(url,'https://apinex.bond/api/user/media/models');assert.equal(init.method,'GET');
  assert.equal(init.redirect,'error');assert.equal(Object.keys(init.headers).some(k=>k.toLowerCase()==='authorization'),false);
  return new Response(JSON.stringify(value));
};
test('separate image catalog preserves all six exact live IDs and per-image billing evidence',()=>{
  assert.equal(DESIGN_CATALOG.length,6);assert.equal(new Set(DESIGN_CATALOG.map(m=>m.id)).size,6);
  assert.deepEqual(DESIGN_CATALOG.map(m=>[m.id,m.priceUsd]),[
    ['free/nano-banana-2',0],['nano-banana-2',.03],['gpt-image-2.6-flare',.05],
    ['gpt-image-2.6-sunburst',.065],['seedream-5',.02],['grok-imagine-2',.02]]);
  assert.equal(getDesignModel('gpt-image-2.6-sunburst').reserveUsd,.07);
  const free=getDesignModel('free/nano-banana-2');assert.equal(free.allowanceTokens,5000000);assert.equal(free.subscriptionRequired,true);assert.equal(free.billingTier,'free-allowance');
  assert.equal(getDesignModel('nano-banana-2').allowanceTokens,0);assert.equal(getDesignModel('unknown'),null);assert.equal(getDesignModel('__proto__'),null);
  assert.throws(()=>{free.priceUsd=1;});assert.throws(()=>DESIGN_CATALOG.push({}));
  assert.match(DESIGN_CATALOG_METADATA.sourceHashes.catalogSha256,/^[a-f0-9]{64}$/);
  assert.ok(Date.parse(DESIGN_CATALOG_METADATA.checkedAt));
  assert.equal(DESIGN_CATALOG_METADATA.apiCapabilities.asynchronousPollingDocumented,false);
  for(const model of DESIGN_CATALOG){assert.deepEqual(model.sizes,['1024x1024']);assert.equal(model.sizeConstraints.type,'string');assert.equal(model.sizeConstraints.perModelSupportVerified,false);assert.deepEqual(model.responseFormats,['b64_json']);}
});
test('public audit validates rates and metadata without credentials or image dispatch',async()=>{
  const audit=await auditDesignCatalog({fetchImpl:serve(raw())});assert.equal(audit.ok,true);assert.equal(audit.readyIds.length,6);assert.equal(audit.blocked.length,0);assert.match(audit.hash,/^[a-f0-9]{64}$/);
});
test('rate increase and missing model fail closed while independent unchanged models remain ready',async()=>{
  const input=raw();input.models[1].priceTokens=30001;input.models.pop();
  const audit=await auditDesignCatalog({fetchImpl:serve(input)});assert.equal(audit.ok,false);
  assert.deepEqual(audit.blocked,[{id:'nano-banana-2',code:'DESIGN_PRICE_INCREASED'},{id:'grok-imagine-2',code:'DESIGN_MODEL_MISSING'}]);
  assert.equal(audit.readyIds.length,4);
});
test('free allowance and subscription changes are not silently accepted',async()=>{
  for(const mutate of [m=>{m.baseTokens++;},m=>{m.allowFree=true;},m=>{m.priceTokens=1;},m=>{m.tokenWeight=1;}]){
    const input=raw();mutate(input.models[0]);const result=await auditDesignCatalog({fetchImpl:serve(input)});
    assert.equal(result.models[0].ready,false);assert.ok(['DESIGN_ALLOWANCE_CHANGED','DESIGN_PRICE_INCREASED'].includes(result.models[0].code));
  }
});
test('identity, billing terms and nonlive health block the affected model',async()=>{
  for(const [field,value,code]of [['category','other','DESIGN_MODEL_IDENTITY_CHANGED'],['tokenWeight',.5,'DESIGN_BILLING_TERMS_CHANGED'],['health','partial','DESIGN_MODEL_NOT_LIVE']]){
    const input=raw();input.models[1][field]=value;const result=await auditDesignCatalog({fetchImpl:serve(input)});assert.equal(result.models[1].code,code);
  }
});
test('new image IDs are quarantined, never implicitly added to the dispatch registry',async()=>{
  const input=raw();input.models.push({...input.models[1],id:'new-image-model'});const result=await auditDesignCatalog({fetchImpl:serve(input)});
  assert.equal(result.ok,true);assert.deepEqual(result.unknownIds,['new-image-model']);assert.equal(result.readyIds.includes('new-image-model'),false);assert.equal(getDesignModel('new-image-model'),null);
});
test('invalid catalogs, oversized bodies, HTTP errors and redirects are rejected',async()=>{
  const duplicate=raw();duplicate.models.push(duplicate.models[0]);
  const invalid=raw();invalid.models[0].priceTokens=NaN;
  for(const value of [{},duplicate,invalid])await assert.rejects(auditDesignCatalog({fetchImpl:serve(value)}),{code:'INVALID_DESIGN_CATALOG_RESPONSE'});
  await assert.rejects(auditDesignCatalog({fetchImpl:async()=>new Response('x'.repeat(65537))}),{code:'DESIGN_CATALOG_TOO_LARGE'});
  await assert.rejects(auditDesignCatalog({fetchImpl:async()=>new Response('',{status:503})}),{code:'DESIGN_CATALOG_HTTP'});
  await assert.rejects(auditDesignCatalog({fetchImpl:async()=>{throw new Error('redirect');}}),{code:'DESIGN_CATALOG_UNAVAILABLE'});
});
test('cancelled audits do not make a request',async()=>{
  const signal=AbortSignal.abort();await assert.rejects(auditDesignCatalog({signal,fetchImpl:()=>assert.fail('Cancelled catalog was requested')}),{code:'DESIGN_CATALOG_ABORTED'});
});
