import test from 'node:test';
import assert from 'node:assert/strict';
import {MODEL_CATALOG} from './model-catalog.mjs';
import {auditModelCatalog,contextTokensFromClaim} from './catalog-audit.mjs';
const currentRows=()=>MODEL_CATALOG.map(m=>({id:m.id,provider:m.provider,contextWindow:m.contextWindowClaim,
  dollarsPer1M:m.inputPerMillion,outputDollarsPer1M:m.outputPerMillion,allowFree:m.allowWithoutSubscription,
  weight:m.allowanceWeight,supportsVision:m.capabilities.visionClaim,supportsTools:m.capabilities.toolsClaim}));
const json=data=>new Response(JSON.stringify(data),{status:200});
test('a live audit verifies all45 without credentials, arbitrary URLs or discount assumptions',async()=>{
  let options;
  const result=await auditModelCatalog({fetchImpl:async(url,init)=>{assert.equal(url,'https://apinex.bond/api/public/models');options=init;return json({models:currentRows()});}});
  assert.equal(result.status,'verified');assert.deepEqual(result.issuesByModel,{});assert.match(result.hash,/^[a-f0-9]{64}$/);
  assert.equal(options.redirect,'error');assert.equal(Object.hasOwn(options.headers,'Authorization'),false);
  assert.equal(contextTokensFromClaim('1M'),1048576);assert.equal(contextTokensFromClaim('131K'),134144);assert.equal(contextTokensFromClaim('unknown'),null);
});
test('higher base price or context blocks only that model, while conservative decreases remain safe',async()=>{
  const rows=currentRows();rows.find(m=>m.id==='gpt-6.2-astra').dollarsPer1M=2;
  rows.find(m=>m.id==='gpt-6.2-sol').contextWindow='2M';
  const lower=rows.find(m=>m.id==='claude-opus-5.5');lower.dollarsPer1M=.25;lower.outputDollarsPer1M=.25;lower.discountDollarsPer1M=0;
  const result=await auditModelCatalog({fetchImpl:async()=>json({models:rows})});
  assert.equal(result.status,'verified');assert.equal(result.issuesByModel['gpt-6.2-astra'],'PRICING_CHANGED_REVERIFY');
  assert.equal(result.issuesByModel['gpt-6.2-sol'],'PRICING_CHANGED_REVERIFY');assert.equal(result.issuesByModel['claude-opus-5.5'],undefined);
});
test('missing, duplicate, malformed and changed free-wallet metadata fail closed',async()=>{
  const rows=currentRows().filter(m=>m.id!=='grok-4.7');
  rows.find(m=>m.id==='glm-5.3').dollarsPer1M='0.1';
  rows.find(m=>m.id==='free/gpt-6-luna').dollarsPer1M=.01;
  rows.find(m=>m.id==='free/glm-5.3').contextWindow='unlimited';
  rows.push({...rows.find(m=>m.id==='gpt-6.2-astra')});
  const result=await auditModelCatalog({fetchImpl:async()=>json({models:rows})});
  assert.equal(result.issuesByModel['grok-4.7'],'MODEL_ABSENT_PUBLIC_CATALOG');
  for(const id of ['glm-5.3','free/glm-5.3','gpt-6.2-astra'])assert.equal(result.issuesByModel[id],'CATALOG_UNVERIFIED');
  assert.equal(result.issuesByModel['free/gpt-6-luna'],'PRICING_CHANGED_REVERIFY');
});
test('redirect, malformed JSON, oversize and unavailable catalogue block all dispatch without preventing reports',async()=>{
  const attempts=[async()=>new Response('',{status:302,headers:{Location:'https://untrusted.example'}}),
    async()=>new Response('not JSON',{status:200}),async()=>new Response('',{status:200,headers:{'content-length':String(2*1024*1024+1)}}),
    async()=>{throw new Error('network failure');}];
  for(const fetchImpl of attempts){const result=await auditModelCatalog({fetchImpl});assert.equal(result.status,'unavailable');assert.equal(Object.keys(result.issuesByModel).length,45);}
});
test('timeout and cancellation are bounded and never retry',async()=>{
  let calls=0;
  const result=await auditModelCatalog({timeoutMs:5,fetchImpl:async(url,{signal})=>{calls++;return new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(new Error('aborted')),{once:true}));}});
  assert.equal(result.status,'unavailable');assert.equal(calls,1);
  const controller=new AbortController();controller.abort();
  const cancelled=await auditModelCatalog({signal:controller.signal,fetchImpl:async()=>{throw new Error('must not call');}});assert.equal(cancelled.status,'unavailable');
});
