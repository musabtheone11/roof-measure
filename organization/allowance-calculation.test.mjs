import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {POLICY,ALLOWANCE_QUOTE_URL,verifyAllowanceCalculationQuote,validateAllowanceCalculationReservation,calculateDocumentedAllowance} from './allowance-calculation.mjs';
import {getModelCatalogEntry,textAllowanceReservationUnits} from './model-catalog.mjs';

const NOW=Date.parse('2026-11-28T12:00:00Z'),MODEL='free/qwen-3.8-max',HASH='a'.repeat(64);
const sha=v=>createHash('sha256').update(v).digest('hex');
const entry=getModelCatalogEntry(MODEL);
const row=(extra={})=>({id:MODEL,provider:'Free',allowFree:true,dollarsPer1M:0,outputDollarsPer1M:0,weight:entry.allowanceWeight,contextWindow:String(entry.contextTokens),...extra});
function quote(rows=[row()]){const body=JSON.stringify({models:rows});return {schemaVersion:1,policy:POLICY,sourceUrl:ALLOWANCE_QUOTE_URL,observedAt:NOW,body,bodySha256:sha(body)};}
const auth=(extra={})=>({policy:POLICY,model:MODEL,weight:entry.allowanceWeight,quoteArtifactHash:HASH,...extra});
function response({usage={prompt_tokens:17,completion_tokens:23,total_tokens:40},finish='stop',transport='json',extra={}}={}){
  return {attemptBinding:{attemptId:'attempt1',taskId:'task1',model:MODEL,protocol:'chat/completions'},
    usage,rawResponse:{model:MODEL,id:'request1',usage,choices:[{index:0,finish_reason:finish,message:{content:'incomplete prose is separate from billing'}}]},
    execution:{requestedModel:MODEL,returnedModel:MODEL,requestId:'request1',finishReason:finish,settings:{route:'chat/completions'},transportComplete:true,transport,
      reportedUsd:0,billingTier:'free-allowance',usage:{promptTokens:usage.prompt_tokens??null,completionTokens:usage.completion_tokens??null,totalTokens:usage.total_tokens??null,
        inputTokens:usage.input_tokens??null,outputTokens:usage.output_tokens??null},...extra}};
}
const calculate=(r=response(),extra={})=>calculateDocumentedAllowance({authorization:auth(),quoteArtifact:quote(),responseArtifact:r,dispatchAt:NOW+1000,attemptId:'attempt1',taskId:'task1',...extra});

test('quote verifier uses only fixed unauthenticated endpoint and retains bounded original public bytes',async()=>{
  const body=JSON.stringify({models:[row()]},null,2);let calls=0;
  const verified=await verifyAllowanceCalculationQuote({model:MODEL,now:()=>NOW,fetchImpl:async(url,init)=>{calls++;assert.equal(url,ALLOWANCE_QUOTE_URL);assert.equal(init.method,'GET');assert.equal(init.redirect,'error');assert.deepEqual(init.headers,{Accept:'application/json'});return new Response(body);}});
  assert.equal(calls,1);assert.equal(verified.eligible,true);assert.equal(verified.quoteArtifact.body,body);assert.equal(verified.quoteArtifact.bodySha256,sha(body));
  const got=validateAllowanceCalculationReservation({authorization:auth(),quoteArtifact:verified.quoteArtifact,at:NOW+60000});
  assert.equal(got.eligible,true);assert.equal(got.minimumReservationUnits,textAllowanceReservationUnits(MODEL));assert.equal(got.publishedWeight,entry.allowanceWeight);
});
test('positive adverse price, weight, and context evidence blocks dispatch even with malformed sibling fields or duplicate ID',()=>{
  for(const change of [{dollarsPer1M:.001},{outputDollarsPer1M:.01},{weight:entry.allowanceWeight+1},{contextWindow:String(entry.contextTokens+1)}]){
    for(const rows of [[row({...change,provider:null})],[row(),row(change)]]){
      const got=validateAllowanceCalculationReservation({authorization:auth(),quoteArtifact:quote(rows),at:NOW});
      assert.deepEqual(got,{eligible:false,reason:'PRICING_CHANGED_REVERIFY',blockDispatch:true});
    }
  }
});
test('malformed or absent quote is ineligible rather than a zero-charge receipt',()=>{
  for(const q of [null,{}, {...quote(),bodySha256:'0'.repeat(64)}, {...quote(),sourceUrl:'https://evil.test/models'},quote([]),quote([row(),row()]),
    quote([row({weight:0})]),quote([row({weight:'3'})]),quote([row({dollarsPer1M:null})]),quote([row({contextWindow:'unknown'})])])
    assert.equal(validateAllowanceCalculationReservation({authorization:auth(),quoteArtifact:q,at:NOW}).eligible,false);
  for(const at of [NOW-1,NOW+60001,NaN])assert.equal(validateAllowanceCalculationReservation({authorization:auth(),quoteArtifact:quote(),at}).eligible,false);
  for(const a of [auth({policy:'old'}),auth({model:'gpt-6.2-astra'}),auth({model:'free/drex-v2.0'}),auth({quoteArtifactHash:'bad'}),auth({weight:1})])
    assert.equal(validateAllowanceCalculationReservation({authorization:a,quoteArtifact:quote(),at:NOW}).eligible,false);
});
test('lower freshly verified weight can calculate while conservative reservation retains published weight',()=>{
  const q=quote([row({weight:1})]);const checked=validateAllowanceCalculationReservation({authorization:auth({weight:1}),quoteArtifact:q,at:NOW});
  assert.equal(checked.eligible,true);assert.equal(checked.weight,1);assert.equal(checked.publishedWeight,entry.allowanceWeight);assert.equal(checked.minimumReservationUnits,textAllowanceReservationUnits(MODEL));
  assert.equal(calculate(response(),{authorization:auth({weight:1}),quoteArtifact:q}).units,40);
});
test('unavailable/malformed/oversize public quote cannot calculate and never retries',async()=>{
  for(const fetchImpl of [async()=>new Response('unavailable',{status:503}),async()=>new Response('not JSON'),async()=>new Response('x'.repeat(2*1024*1024+1)),async()=>{throw Error('network');}]){
    let calls=0;const got=await verifyAllowanceCalculationQuote({model:MODEL,now:()=>NOW,fetchImpl:async(...args)=>{calls++;return fetchImpl(...args);}});assert.equal(got.eligible,false);assert.equal(calls,1);
  }
  assert.equal((await verifyAllowanceCalculationQuote({model:'free/drex-v2.0',fetchImpl:()=>assert.fail('typed route must not fetch')})).eligible,false);
});
test('quote rejection never awaits a nonsettling response cancellation promise',async()=>{
  for(const status of [503,200]){
    const got=await Promise.race([verifyAllowanceCalculationQuote({model:MODEL,fetchImpl:async()=>({ok:status===200,headers:new Headers({'content-length':String(2*1024*1024+1)}),body:{cancel:()=>new Promise(()=>{})}})}),new Promise((_,reject)=>{const timer=setTimeout(()=>reject(Error('cancel hung')),100);timer.unref();})]);
    assert.equal(got.eligible,false);
  }
});
test('documented formula uses each top-level input/output token exactly once and distinguishes calculated from direct debit',()=>{
  const usage={prompt_tokens:17,completion_tokens:23,total_tokens:40,input_tokens:17,output_tokens:23,cost_tokens:0,allowance_tokens:999999,
    prompt_tokens_details:{cached_tokens:10},completion_tokens_details:{reasoning_tokens:20}};
  const got=calculate(response({usage}));assert.equal(got.eligible,true);assert.equal(got.units,40*entry.allowanceWeight);
  assert.equal(got.proof.formula,'ceil((prompt_tokens + completion_tokens) * weight)');assert.equal(got.proof.formulaDocumentSha256.length,64);assert.equal(got.proof.quoteArtifactHash,HASH);
  assert.equal(Object.hasOwn(got,'reportedAllowanceUnits'),false);
  assert.equal(calculate(response({usage:{prompt_tokens:0,completion_tokens:0,total_tokens:0}})).units,0);
  assert.equal(calculate(response({finish:'length'})).eligible,true,'fully received length output can bill despite invalid role JSON');
});
test('partial, contradictory, unsafe and impossible token telemetry retains full hold',()=>{
  for(const usage of [null,{}, {prompt_tokens:1,completion_tokens:2},{prompt_tokens:1,completion_tokens:2,total_tokens:4},
    {prompt_tokens:1,completion_tokens:2,total_tokens:3,input_tokens:2},{prompt_tokens:1,completion_tokens:2,total_tokens:3,output_tokens:1},
    {prompt_tokens:1,completion_tokens:2,total_tokens:3,prompt_tokens_details:{cached_tokens:2}},
    {prompt_tokens:1,completion_tokens:2,total_tokens:3,completion_tokens_details:{reasoning_tokens:3}},
    {prompt_tokens:1,completion_tokens:2,total_tokens:3,completion_tokens_details:{reasoning_tokens:1},output_tokens_details:{reasoning_tokens:2}},
    ...[-1,.1,NaN,Number.MAX_SAFE_INTEGER+1].map(n=>({prompt_tokens:n,completion_tokens:2,total_tokens:n+2})),
    {prompt_tokens:Number.MAX_SAFE_INTEGER,completion_tokens:0,total_tokens:Number.MAX_SAFE_INTEGER}]){
      assert.equal(calculate(response({usage:usage??{}})).eligible,false,JSON.stringify(usage));
  }
});
test('exact attempt, model and original usage binding are required independently of supplied summaries',()=>{
  for(const mutate of [r=>r.attemptBinding.attemptId='old',r=>r.attemptBinding.taskId='old',r=>r.attemptBinding.protocol='decisions',
    r=>r.execution.returnedModel='alias',r=>r.rawResponse.model='alias',r=>r.rawResponse.id='other',r=>r.rawResponse.choices.push(r.rawResponse.choices[0]),
    r=>r.execution.usage.promptTokens=0,r=>r.usage={prompt_tokens:0,completion_tokens:0,total_tokens:0}]){
    const r=response();mutate(r);assert.equal(calculate(r).eligible,false);
  }
});
test('unknown/paid billing, incomplete transport and unsupported finish never release a hold',()=>{
  for(const mutate of [r=>r.execution.transportComplete=false,r=>r.execution.transport='unknown',r=>r.execution.finishReason='tool_calls',
    r=>r.failureCode='TIMEOUT',r=>r.execution.reportedUsd=.001,r=>r.rawResponse.usage.cost_tokens=10,r=>r.rawResponse.cost_tokens=1,
    r=>r.execution.billingTier='paid']){const r=response();mutate(r);assert.equal(calculate(r).eligible,false);}
});
test('SSE requires verified complete DONE evidence and exact model/id/finish',()=>{
  const stream={protocol:'openai-chat-sse-v1',complete:true,doneReceived:true,model:MODEL,id:'request1',finishReason:'stop',transportBytes:100,eventCount:3,transportSha256:HASH};
  assert.equal(calculate(response({transport:'sse',extra:{streamEvidence:stream}})).eligible,true);
  for(const change of [{complete:false},{doneReceived:false},{model:'alias'},{id:'other'},{finishReason:'length'},{transportBytes:0},{eventCount:0},{transportSha256:'bad'}])
    assert.equal(calculate(response({transport:'sse',extra:{streamEvidence:{...stream,...change}}})).eligible,false);
});
