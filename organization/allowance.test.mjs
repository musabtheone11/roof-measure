import test from 'node:test';
import assert from 'node:assert/strict';
import {verifySubscriptionAllowance,buildAllowanceReservation,allowanceUsage} from './allowance.mjs';

const NOW=Date.parse('2026-11-28T12:00:00Z'),EXPIRY='2026-12-01T12:00:00Z',RESET='2026-11-29T00:00:00Z';
const response=value=>new Response(JSON.stringify(value),{status:200});
const access={allowed:true,mode:'subscription',unlimited:false,token_limit:10000000,tokens_used:1000000,tokens_remaining:9000000,expires_at_utc:EXPIRY,resets_at_utc:null};
async function snapshot(value=access,extra={}){return verifySubscriptionAllowance({apiKey:'test-allowance-key',now:()=>NOW,fetchImpl:async()=>response(value),...extra});}
test('fixed authenticated GET returns only the private normalized allowance admission fields',async()=>{
  let calls=0;const got=await snapshot({...access,email:'private@example.test',api_key:'do-not-copy',plan_name:'private-plan'}, {fetchImpl:async(url,init)=>{
    calls++;assert.equal(url,'https://api.apinex.bond/v1/subscription');assert.equal(init.method,'GET');assert.equal(init.redirect,'error');assert.equal(init.headers.Authorization,'Bearer test-allowance-key');return response({...access,email:'private@example.test',plan_name:'private-plan'});
  }});
  assert.equal(calls,1);assert.deepEqual(got,{remainingUnits:9000000,observedAt:NOW,expiresAt:Date.parse(EXPIRY),periodKey:`apinex-allowance-v1:subscription:${Date.parse(EXPIRY)}`,unlimited:false,mode:'subscription',allowed:true,resetsAt:null});
  assert.doesNotMatch(JSON.stringify(got),/private@example|private-plan|test-allowance-key/);
});
test('subscription reservations stay in their expiry period across UTC midnight; daily free tier uses reset time',async()=>{
  const one=await snapshot(),two=await snapshot(access,{now:()=>NOW+13*3600000});assert.equal(one.periodKey,two.periodKey);
  const free=await snapshot({...access,mode:'free',expires_at_utc:null,resets_at_utc:RESET});assert.equal(free.expiresAt,Date.parse(RESET));assert.equal(free.periodKey,`apinex-allowance-v1:free:${Date.parse(RESET)}`);
  assert.throws(()=>buildAllowanceReservation(free,{reservedUnits:10,subscriptionRequired:true,now:()=>NOW}),{code:'SUBSCRIPTION_REQUIRED'});
});
test('missing/expired/contradictory access, periods and unsafe quota values fail closed',async()=>{
  for(const value of [{...access,allowed:false},{...access,mode:'unknown'},{...access,unlimited:'true'},{...access,tokens_remaining:null},{...access,tokens_remaining:NaN},{...access,tokens_remaining:10000001},{...access,token_limit:-1},{...access,tokens_used:-1},{...access,tokens_used:10000001},{...access,tokens_used:2000000},{...access,expires_at_utc:null},{...access,expires_at_utc:'not-a-date'},{...access,expires_at_utc:'2027-02-30T00:00:00Z'},{...access,expires_at_utc:'2026-11-27T00:00:00Z'},{...access,mode:'free',resets_at_utc:null}])
    await assert.rejects(snapshot(value),e=>['ALLOWANCE_UNVERIFIED','SUBSCRIPTION_REQUIRED'].includes(e.code));
});
test('fresh reservations have exact six fields and cannot overdraw, forge a period or reuse stale/future evidence',async()=>{
  const s=await snapshot();const r=buildAllowanceReservation(s,{reservedUnits:5000000,subscriptionRequired:true,now:()=>NOW+60000});
  assert.deepEqual(Object.keys(r).sort(),['reservedUnits','remainingUnits','observedAt','expiresAt','periodKey','unlimited'].sort());assert.equal(r.reservedUnits,5000000);
  assert.throws(()=>buildAllowanceReservation(s,{reservedUnits:9000001,now:()=>NOW}),{code:'ALLOWANCE_EXHAUSTED'});
  assert.throws(()=>buildAllowanceReservation(s,{reservedUnits:1,now:()=>NOW+60001}),{code:'ALLOWANCE_STALE'});
  assert.throws(()=>buildAllowanceReservation(s,{reservedUnits:1,now:()=>NOW-1}),{code:'ALLOWANCE_STALE'});
  assert.throws(()=>buildAllowanceReservation({...s,periodKey:'new-job-reset'},{reservedUnits:1,now:()=>NOW}),{code:'ALLOWANCE_UNVERIFIED'});
  for(const n of [-1,0,1.5,Number.MAX_SAFE_INTEGER+1])assert.throws(()=>buildAllowanceReservation(s,{reservedUnits:n,now:()=>NOW}),{code:'ALLOWANCE_UNVERIFIED'});
});
test('unlimited capacity remains explicit, period-bound and subscription-gated',async()=>{
  const s=await snapshot({...access,unlimited:true,token_limit:null,tokens_remaining:null});const r=buildAllowanceReservation(s,{reservedUnits:Number.MAX_SAFE_INTEGER,subscriptionRequired:true,now:()=>NOW});
  assert.equal(r.remainingUnits,null);assert.equal(r.unlimited,true);assert.ok(Number.isSafeInteger(r.expiresAt));
  await assert.rejects(snapshot({...access,unlimited:true,tokens_remaining:null,expires_at_utc:null}),{code:'ALLOWANCE_UNVERIFIED'});
});
test('HTTP diagnostics are redacted and permanent errors, redirects and missing credentials never retry',async()=>{
  let calls=0;await assert.rejects(snapshot(access,{fetchImpl:async()=>{calls++;return new Response('{"error":{"code":"denied","message":"test-allowance-key Bearer secret-token"}}',{status:403,headers:{'x-request-id':'allowance-denied'}});}}),e=>{
    assert.equal(e.status,403);assert.equal(e.code,'UPSTREAM_HTTP');assert.equal(e.retryable,false);assert.equal(e.errorDetails.requestId,'allowance-denied');assert.doesNotMatch(JSON.stringify(e.errorDetails),/test-allowance-key|secret-token/);return true;
  });assert.equal(calls,1);
  await assert.rejects(snapshot(access,{fetchImpl:async()=>{throw new Error('redirect with test-allowance-key');}}),e=>e.code==='NETWORK_ERROR'&&!e.message.includes('test-allowance-key'));
  await assert.rejects(snapshot(access,{apiKey:'',fetchImpl:async()=>{throw new Error('must not fetch');}}),{code:'MISSING_API_KEY'});
});
test('oversized, malformed, timeout and cancelled snapshots cannot authorize generation',async()=>{
  await assert.rejects(snapshot(access,{fetchImpl:async()=>new Response('x'.repeat(65537))}),{code:'ALLOWANCE_RESPONSE_TOO_LARGE'});
  await assert.rejects(snapshot(access,{fetchImpl:async()=>new Response('not JSON')}),{code:'ALLOWANCE_UNVERIFIED'});
  await assert.rejects(snapshot(access,{timeoutMs:5,fetchImpl:async(url,{signal})=>new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(new Error('aborted')),{once:true}))}),{code:'TIMEOUT'});
  const controller=new AbortController();controller.abort();await assert.rejects(snapshot(access,{signal:controller.signal}),{code:'CANCELLED'});
});
test('usage exposes estimates only; undocumented allowance_tokens and wallet zero never settle allowance holds',()=>{
  assert.deepEqual(allowanceUsage({total_tokens:51,cost_tokens:0,allowance_tokens:153},{weight:3}),{reportedAllowanceUnits:null,estimatedAllowanceUnits:153});
  assert.deepEqual(allowanceUsage({allowance_tokens:0,cost_tokens:0},{flatUnits:5000000}),{reportedAllowanceUnits:null,estimatedAllowanceUnits:5000000});
  assert.deepEqual(allowanceUsage({prompt_tokens:10,completion_tokens:20},{weight:3}),{reportedAllowanceUnits:null,estimatedAllowanceUnits:null});
  for(const value of [NaN,-1,1.5,Number.MAX_SAFE_INTEGER+1])assert.equal(allowanceUsage({total_tokens:value},{weight:3}).estimatedAllowanceUnits,null);
  assert.equal(allowanceUsage({total_tokens:Number.MAX_SAFE_INTEGER},{weight:3}).estimatedAllowanceUnits,null);
});
