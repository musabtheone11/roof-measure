import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import { verifyRoster, requestOrganizationRole } from './provider.mjs';
import {isDecisionModel,FREE_DREX_DECISION_MODEL,FREE_DREX_DECISION_PROTOCOL} from './decision-provider.mjs';
import {POLICY,ALLOWANCE_QUOTE_URL} from './allowance-calculation.mjs';
import {getModelCatalogEntry} from './model-catalog.mjs';

const hash = 'a'.repeat(64);
const task = { schemaVersion: 1, id: 'task1', role: 'engineering', actorId: 'engineer1', sourceRevision: 'commit1', datasetRevision: 'data1', candidateHash: hash, policyVersion: 'policy1', inputHashes: [hash] };
const output = () => ({ schemaVersion: 1, taskId: task.id, role: task.role, sourceRevision: task.sourceRevision, datasetRevision: task.datasetRevision, candidateHash: hash, policyVersion: task.policyVersion, inputHashes: [hash], decision: 'needs-human', findings: [], artifactRefs: [], summary: 'No independently measured reference is supplied.', payload: { hypothesis: 'Inspect source registration.', patchArtifact: null, predictedMetric: 'Lower registration error.' } });
const json = (data, init = {}) => new Response(JSON.stringify(data), { status: 200, ...init,headers:{'content-type':'application/json',...init.headers} });
test('incomplete output retains actual finish reason before rejection',async()=>{
  let original;
  const f=fixture({chat:async()=>json({model:'gpt-6.2-astra',usage:{cost_tokens:3,completion_tokens:2000},choices:[{finish_reason:'length',message:{content:'{"summary":"cut'}}]})});
  await assert.rejects(requestOrganizationRole(task,{...f.options,onResponse:record=>{original=record;}}),{code:'INVALID_AGENT_OUTPUT'});
  assert.equal(original.execution.finishReason,'length');assert.equal(original.content,'{"summary":"cut');
  assert.equal(original.execution.reportedUsd,.000003);
});
test('design visual review binds bounded image bytes to task hashes and refuses unsupported vision',async()=>{
  const png=Buffer.from([137,80,78,71,13,10,26,10,0,0,0,0]);
  const sha=createHash('sha256').update(png).digest('hex'),t={...task,inputHashes:[hash,sha]};
  const f=fixture({chat:async()=>json({model:'gpt-6.2-astra',usage:{cost_tokens:1},choices:[{finish_reason:'stop',message:{content:JSON.stringify({...output(),inputHashes:t.inputHashes})}}]})});
  await requestOrganizationRole(t,{...f.options,images:[{mimeType:'image/png',data:png}]});
  const user=JSON.parse(f.calls.find(c=>c.url.endsWith('/chat/completions')).init.body).messages[1].content;
  assert.equal(user[1].type,'image_url');assert.match(user[1].image_url.url,/^data:image\/png;base64,/);
  await requestOrganizationRole(t,{...f.options,images:Array.from({length:6},()=>({mimeType:'image/png',data:png}))});
  const fullReview=JSON.parse(f.calls.filter(c=>c.url.endsWith('/chat/completions')).at(-1).init.body);
  assert.match(fullReview.messages[0].content,/at most 6 findings/,'Six-image review must allow one separate finding per image.');
  const before=f.calls.length;
  await assert.rejects(requestOrganizationRole(task,{...f.options,images:[{mimeType:'image/png',data:png}]}),{code:'INVALID_DESIGN_IMAGES'});
  await assert.rejects(requestOrganizationRole(t,{...f.options,model:'free/glm-5.3',images:[{mimeType:'image/png',data:png}]}),{code:'VISION_UNSUPPORTED'});
  await assert.rejects(requestOrganizationRole(t,{...f.options,images:[{mimeType:'image/png',data:Buffer.alloc(4*1024*1024+1)}]}),{code:'INVALID_DESIGN_IMAGES'});
  assert.equal(f.calls.length,before,'Invalid images must fail before network or reservation.');
});
function fixture({ chat, roster, subscription, reserve, onUsage, onDispatch } = {}) {
  const calls = [], events = [];
  const options = {
    apiKey: 'test-secret-not-real',
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      if (url.endsWith('/models')) return roster ? roster(url, init) : json({ data: [{ id: 'gpt-6.2-astra' }] });
      if (url.endsWith('/subscription')) return subscription ? subscription(url,init) : json({allowed:true,mode:'subscription',unlimited:false,tokens_remaining:100000000,expires_at_utc:new Date(Date.now()+3600000).toISOString()});
      events.push('post');
      return chat ? chat(url, init) : json({ id: 'request1', model: 'gpt-6.2-astra', usage: { cost_tokens: 123 }, choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(output()) } }] });
    },
    reserve: reserve ?? (async input => { events.push(['reserve', input]); return 'reservation1'; }),
    onDispatch: onDispatch ?? (async id => { events.push(['dispatch', id]); }),
    onUsage: onUsage ?? (async (id, usage) => { events.push(['usage', id, usage]); }),
  };
  return { options, calls, events };
}

test('roster verifies exact IDs without exposing credentials or following redirects', async () => {
  const { options, calls } = fixture();
  const result = await verifyRoster(options);
  assert.deepEqual(result.ids, ['gpt-6.2-astra']);
  assert.ok(Date.parse(result.checkedAt));
  assert.equal(calls[0].init.redirect, 'error');
  assert.equal(calls[0].init.method, 'GET');
  await assert.rejects(verifyRoster({ ...options, baseUrl: 'https://other.example/v1' }), { code: 'ENDPOINT_NOT_VERIFIED' });
  assert.equal(calls.length, 1);
});

test('reservation and dispatch commit before the only POST, runtime owns actor identity', async () => {
  const { options, calls, events } = fixture();
  const result = await requestOrganizationRole(task, options);
  assert.equal(result.result.actorId, task.actorId);
  assert.equal(result.execution.reportedUsd, 0.000123);
  assert.deepEqual(events.map(e => Array.isArray(e) ? e[0] : e), ['reserve', 'dispatch', 'post', 'usage']);
  assert.equal(events[0][1].usd, 0.524288);
  assert.equal(calls.filter(c => c.init.method === 'POST').length, 1);
  const body = JSON.parse(calls[1].init.body);
  assert.equal(body.max_tokens, 2000);
  assert.equal(body.model, 'gpt-6.2-astra');
});

test('zero budget, missing durable callbacks, and explicit zero limits send no POST', async () => {
  const f = fixture({ reserve: async () => { throw Object.assign(new Error('Budget is zero'), { code: 'BUDGET_LIMIT' }); } });
  await assert.rejects(requestOrganizationRole(task, f.options), { code: 'BUDGET_LIMIT' });
  assert.equal(f.calls.filter(c => c.init.method === 'POST').length, 0);
  await assert.rejects(requestOrganizationRole(task, { ...f.options, reserve: undefined }), { code: 'BUDGET_DISABLED' });
  await assert.rejects(requestOrganizationRole({ ...task, constraints: { maxOutputTokens: 0 } }, f.options), { code: 'BUDGET_DISABLED' });
  assert.equal(f.calls.length, 1);
});

test('absent roster model and unknown pricing cannot dispatch', async () => {
  const f = fixture({ roster: async () => json({ data: [] }) });
  await assert.rejects(requestOrganizationRole(task, f.options), { code: 'MODEL_UNAVAILABLE' });
  assert.equal(f.events.length, 0);
  await assert.rejects(requestOrganizationRole(task, { ...f.options, model: 'unverified-model' }), { code: 'PRICING_UNKNOWN' });
  assert.equal(f.calls.length, 1);
});

test('permanent 401, 403, 400 failures never retry and retain unknown billing', async () => {
  for (const status of [400, 401, 403]) {
    const f = fixture({ chat: async () => new Response('secret upstream debug', { status }) });
    await assert.rejects(requestOrganizationRole(task, f.options), error => error.code === 'UPSTREAM_HTTP' && error.status === status && error.retryable === false && !error.message.includes('secret'));
    assert.equal(f.calls.filter(c => c.init.method === 'POST').length, 1);
    assert.equal(f.events.at(-1)[2].reportedUsd, null);
  }
});

test('429 exposes retry delay for worker scheduling but never retries internally', async () => {
  const f = fixture({ chat: async () => new Response('', { status: 429, headers: { 'Retry-After': '30' } }) });
  await assert.rejects(requestOrganizationRole(task, f.options), error => error.code === 'UPSTREAM_HTTP' && error.retryable === true && error.retryAfterMs === 30000 && !error.automaticRetryAllowed);
  assert.equal(f.calls.filter(c => c.init.method === 'POST').length, 1);
});

test('bounded provider body and structured content reject, without claiming free usage', async () => {
  const oversize = fixture({ chat: async () => new Response('x'.repeat(2 * 1024 * 1024 + 1)) });
  await assert.rejects(requestOrganizationRole(task, oversize.options), { code: 'RESPONSE_TOO_LARGE' });
  assert.equal(oversize.events.at(-1)[2].reportedUsd, null);
  const content = fixture({ chat: async () => json({ model: 'gpt-6.2-astra', usage: { cost_tokens: 42 }, choices: [{ finish_reason: 'stop', message: { content: 'x'.repeat(65537) } }] }) });
  await assert.rejects(requestOrganizationRole(task, content.options), { code: 'OUTPUT_TOO_LARGE' });
  assert.equal(content.events.at(-1)[2].reportedUsd, 0.000042);
});

test('malformed model JSON and forged actor fail strict local validation', async () => {
  const badJSON = fixture({ chat: async () => json({ model: 'gpt-6.2-astra', choices: [{ finish_reason: 'stop', message: { content: '```json\n{"unfinished":\n```' } }] }) });
  await assert.rejects(requestOrganizationRole(task, badJSON.options), { code: 'INVALID_AGENT_OUTPUT' });
  const forged = fixture({ chat: async () => json({ model: 'gpt-6.2-astra', choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ ...output(), actorId: 'verifier' }) } }] }) });
  await assert.rejects(requestOrganizationRole(task, forged.options), { code: 'INVALID_ORGANIZATION_CONTRACT' });
});

test('pre-dispatch cancellation sends nothing and post-dispatch cancellation retains reservation', async () => {
  const controller = new AbortController();
  controller.abort();
  const before = fixture();
  await assert.rejects(requestOrganizationRole(task, { ...before.options, signal: controller.signal }), { code: 'CANCELLED' });
  assert.equal(before.calls.length, 0);
  const active = new AbortController();
  const after = fixture({ chat: async () => { active.abort(); throw new Error('abort'); } });
  await assert.rejects(requestOrganizationRole(task, { ...after.options, signal: active.signal }), { code: 'CANCELLED' });
  assert.equal(after.events.at(-1)[2].reportedUsd, null);
});

test('usage settlement failures propagate once, without a second callback or retry', async () => {
  let usageCalls = 0;
  const f = fixture({ onUsage: async () => { usageCalls++; throw Object.assign(new Error('Fenced out'), { code: 'STALE_LEASE' }); } });
  await assert.rejects(requestOrganizationRole(task, f.options), { code: 'STALE_LEASE' });
  assert.equal(usageCalls, 1);
  assert.equal(f.calls.filter(c => c.init.method === 'POST').length, 1);
});

test('missing provider billing stays unknown even when token counts exist', async () => {
  const f = fixture({ chat: async () => json({ model: 'gpt-6.2-astra', usage: { prompt_tokens: 10, completion_tokens: 10 }, choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(output()) } }] }) });
  const result = await requestOrganizationRole(task, f.options);
  assert.equal(result.execution.reportedUsd, null);
  assert.equal(result.execution.billingStatus, 'unknown');
});

test('returned model mismatch is visible after billing settlement, never silently accepted', async () => {
  const f = fixture({ chat: async () => json({ model: 'different-model', usage: { cost_tokens: 18 }, choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(output()) } }] }) });
  await assert.rejects(requestOrganizationRole(task, f.options), { code: 'MODEL_MISMATCH' });
  assert.equal(f.events.at(-1)[2].reportedUsd, 0.000018);
  assert.equal(f.events.at(-1)[2].returnedModel, 'different-model');
});

test('bounded original response is retained before invalid role output rejects', async () => {
  const f=fixture({chat:async()=>json({model:'gpt-6.2-astra',usage:{cost_tokens:12},choices:[{finish_reason:'stop',message:{content:'not JSON'}}]})});
  let record;
  await assert.rejects(requestOrganizationRole(task,{...f.options,onResponse:r=>{record=r;}}),{code:'INVALID_AGENT_OUTPUT'});
  assert.equal(record.content,'not JSON'); assert.equal(record.execution.reportedUsd,.000012);
  assert.equal(f.events.at(-1)[0],'usage');
});

test('single JSON fence normalization preserves original evidence and rejects extra prose',async()=>{
  const good=fixture({chat:async()=>json({model:'gpt-6.2-astra',usage:{cost_tokens:1},choices:[{finish_reason:'stop',message:{content:'```json\n'+JSON.stringify(output())+'\n```'}}]})});
  let original;const result=await requestOrganizationRole(task,{...good.options,onResponse:r=>{original=r.content;}});
  assert.equal(result.execution.normalization,'single-json-code-fence');assert.ok(original.startsWith('```json'));
  const bad=fixture({chat:async()=>json({model:'gpt-6.2-astra',choices:[{finish_reason:'stop',message:{content:'Here is JSON:\n'+JSON.stringify(output())}}]})});
  await assert.rejects(requestOrganizationRole(task,bad.options),{code:'INVALID_AGENT_OUTPUT'});
});

test('all45 verified models reserve their own rate and use the documented response contribution type',async()=>{
  const {MODEL_CATALOG,getVerifiedModelPrice}=await import('./model-catalog.mjs');
  const verifiedRoster={ids:MODEL_CATALOG.map(m=>m.id),checkedAt:new Date().toISOString()};
  for(const model of MODEL_CATALOG) {
    const typed=isDecisionModel(model.id),freeDecision=model.id===FREE_DREX_DECISION_MODEL;
    const f=fixture({chat:async()=>json(typed?{object:'decision',model:model.id,usage:{cost_tokens:0},answers:{review_queue:{type:'choice',choice:'geometry_review',confidence:.8}}}:{model:model.id,usage:{cost_tokens:0},choices:[{finish_reason:'stop',message:{content:JSON.stringify(output())}}]})});
    const active=freeDecision?{...task,policyVersion:FREE_DREX_DECISION_PROTOCOL,inputHashes:[hash,'e'.repeat(64)]}:task;
    const response=await requestOrganizationRole(active,{...f.options,model:model.id,verifiedRoster,context:{metrics:{attempted:12,diagnosticPasses:4},pdfReview:{checked:12,failed:0}},...(freeDecision?{authorizeDecisionRoute:async({attemptId})=>({model:model.id,protocol:FREE_DREX_DECISION_PROTOCOL,taskId:active.id,attemptId,evidenceHash:'e'.repeat(64)})}:{})});
    const price=getVerifiedModelPrice(model.id);assert.equal(f.events[0][1].usd,price.contextTokens*price.maxRate/1e6);
    assert.equal(response.execution.returnedModel,model.id);assert.equal(response.execution.billingTier,model.billingTier);
    assert.equal(f.calls.length,model.billingTier==='free-allowance'?2:1);assert.equal(f.calls.at(-1).url.endsWith(typed?'/decisions':'/chat/completions'),true);
    if(typed){assert.equal(response.contributionKind,'typed-decision');assert.equal(Object.hasOwn(response,'result'),false);}
    if(freeDecision){assert.equal(response.protocol,FREE_DREX_DECISION_PROTOCOL);assert.equal(Object.hasOwn(response,'result'),false);}
  }
});

test('free text reserves weighted subscription units independently of zero wallet cost',async()=>{
  const model='free/gpt-6-luna',f=fixture({chat:async()=>json({model,usage:{cost_tokens:0,total_tokens:120,allowance_tokens:0},choices:[{finish_reason:'stop',message:{content:JSON.stringify(output())}}]})});
  const r=await requestOrganizationRole(task,{...f.options,model,verifiedRoster:{ids:[model],checkedAt:new Date().toISOString()}});
  const reserve=f.events.find(e=>e[0]==='reserve')[1],usage=f.events.find(e=>e[0]==='usage')[2];
  assert.equal(reserve.usd,0);assert.equal(reserve.allowance.reservedUnits,2*1048576*3);
  assert.equal(usage.reportedAllowanceUnits,null,'An undocumented allowance field cannot release a hold.');
  assert.equal(usage.estimatedAllowanceUnits,360);assert.equal(r.execution.allowanceReservedUnits,reserve.allowance.reservedUnits);
  const body=JSON.parse(f.calls.at(-1).init.body);assert.ok(!JSON.stringify(body).includes('tokens_remaining'));
});
test('exhausted or expired subscription blocks free text before reservation and inference',async()=>{
  const model='free/gpt-6-luna';
  for(const subscription of [{allowed:false,mode:'subscription'},{allowed:true,mode:'subscription',unlimited:false,tokens_remaining:1,expires_at_utc:new Date(Date.now()+3600000).toISOString()},
    {allowed:true,mode:'subscription',unlimited:false,tokens_remaining:100000000,expires_at_utc:new Date(Date.now()-1000).toISOString()}]) {
    const f=fixture({subscription:async()=>json(subscription)});
    await assert.rejects(requestOrganizationRole(task,{...f.options,model,verifiedRoster:{ids:[model],checkedAt:new Date().toISOString()}}));
    assert.equal(f.events.length,0);assert.equal(f.calls.length,1);assert.ok(f.calls[0].url.endsWith('/subscription'));
  }
});

test('missing exact model identity fails after cost recording and stale host roster cannot dispatch',async()=>{
  const missing=fixture({chat:async()=>new Response(JSON.stringify({usage:{cost_tokens:7},choices:[{finish_reason:'stop',message:{content:JSON.stringify(output())}}]}),{status:200})});
  await assert.rejects(requestOrganizationRole(task,missing.options),{code:'MODEL_MISMATCH'});
  assert.equal(missing.events.at(-1)[2].reportedUsd,.000007);
  const stale=fixture();
  await assert.rejects(requestOrganizationRole(task,{...stale.options,verifiedRoster:{ids:['gpt-6.2-astra'],checkedAt:new Date(Date.now()-11*60*1000).toISOString()}}),{code:'INVALID_ROSTER'});
  assert.equal(stale.calls.length,0);
});

test('fleet task constraints add literal metric claims and named peer challenge instructions',async()=>{
  const bound={...task,constraints:{requireMetricClaims:true,reviewTaskId:'prior-task'}};
  const valid={...output(),metricClaims:{attempted:12},peerReview:{taskId:'prior-task',decision:'revise',findings:['Prior counts conflict with literal facts.']}};
  const f=fixture({chat:async()=>json({model:'gpt-6.2-astra',usage:{cost_tokens:1},choices:[{finish_reason:'stop',message:{content:JSON.stringify(valid)}}]})});
  const result=await requestOrganizationRole(bound,f.options);assert.equal(result.result.metricClaims.attempted,12);
  const body=JSON.parse(f.calls[1].init.body);assert.match(body.messages[0].content,/metricClaims/);assert.match(body.messages[0].content,/prior-task/);
});
function sseChat(model,content,{usage={cost_tokens:0,total_tokens:120},finish='stop',done=true,bytes=5}={}){
  const event=x=>'data: '+(typeof x==='string'?x:JSON.stringify(x))+'\r\n\r\n';
  const wire=event({id:'stream-test',model,choices:[{index:0,delta:{role:'assistant',content},finish_reason:null}]})+
    event({id:'stream-test',model,choices:[{index:0,delta:{},finish_reason:finish}]})+
    (usage?event({id:'stream-test',model,choices:[],usage}):'')+(done?event('[DONE]'):'');
  const raw=Buffer.from(wire);return new Response(new ReadableStream({start(c){for(let i=0;i<raw.length;i+=bytes)c.enqueue(raw.subarray(i,i+bytes));c.close();}}),{headers:{'content-type':'text/event-stream; charset=utf-8'}});
}
test('free streaming preserves original text/hash/model/usage and private allowance admission before its single POST',async()=>{
  const model='free/gpt-6-luna',original='```json\n'+JSON.stringify(output())+'\n```';let record;
  const f=fixture({chat:async()=>sseChat(model,original)});
  const r=await requestOrganizationRole(task,{...f.options,model,verifiedRoster:{ids:[model],checkedAt:new Date().toISOString()},onResponse:x=>{record=x;}});
  const post=f.calls.find(c=>c.init.method==='POST'),body=JSON.parse(post.init.body);
  assert.equal(body.stream,true);assert.deepEqual(body.stream_options,{include_usage:true});assert.equal(body.response_format.type,'json_object');assert.equal(body.max_tokens,8000);
  assert.equal(r.execution.transport,'sse');assert.equal(r.execution.settings.stream,true);assert.equal(r.execution.returnedModel,model);assert.equal(r.execution.requestId,'stream-test');assert.equal(r.execution.finishReason,'stop');
  assert.equal(record.content,original);assert.equal(record.contentSha256,createHash('sha256').update(original).digest('hex'));assert.equal(r.execution.normalization,'single-json-code-fence');assert.equal(record.execution.streamEvidence.complete,true);
  assert.equal(f.events.find(e=>e[0]==='reserve')[1].allowance.reservedUnits,6291456);assert.equal(f.events.filter(e=>e[0]==='usage').length,1);
  assert.equal(r.execution.reportedAllowanceUnits,null);assert.equal(r.execution.estimatedAllowanceUnits,360);assert.equal(f.calls.filter(c=>c.init.method==='POST').length,1);
});
test('HTTP200 JSON to a streaming request uses the same response and records actual transport without another POST',async()=>{
  const model='free/minimax-m3.1-flash',f=fixture({chat:async()=>json({model,usage:{cost_tokens:0},choices:[{finish_reason:'stop',message:{content:JSON.stringify(output())}}],streamEvidence:{protocol:'forged'}})});
  const r=await requestOrganizationRole(task,{...f.options,model,verifiedRoster:{ids:[model],checkedAt:new Date().toISOString()}});
  assert.equal(r.execution.settings.stream,true);assert.equal(r.execution.transport,'json-response-to-stream-request');assert.equal(r.execution.streamEvidence,undefined);assert.equal(f.calls.filter(c=>c.init.method==='POST').length,1);
});
test('incomplete streaming keeps one unknown hold and retained partial evidence without retry or JSON reinterpretation',async()=>{
  const model='free/gpt-6-luna';let record;
  const f=fixture({chat:async()=>sseChat(model,'{"partial":true}',{done:false})});
  await assert.rejects(requestOrganizationRole(task,{...f.options,model,verifiedRoster:{ids:[model],checkedAt:new Date().toISOString()},onResponse:x=>{record=x;}}),{code:'STREAM_INCOMPLETE'});
  assert.equal(record.content,'{"partial":true}');assert.equal(record.execution.finishReason,'stop');assert.equal(record.execution.streamEvidence.complete,false);assert.equal(record.failureCode,'STREAM_INCOMPLETE');
  assert.equal(f.events.filter(e=>e[0]==='usage').length,1);assert.equal(f.events.find(e=>e[0]==='usage')[2].reportedUsd,null);assert.equal(f.calls.filter(c=>c.init.method==='POST').length,1);
});
test('streaming missing usage remains unknown and a terminal length reason retains known billing before role rejection',async()=>{
  const model='free/gpt-6-luna',f=fixture({chat:async()=>sseChat(model,JSON.stringify(output()),{usage:null})});
  const r=await requestOrganizationRole(task,{...f.options,model,verifiedRoster:{ids:[model],checkedAt:new Date().toISOString()}});assert.equal(r.execution.reportedUsd,null);assert.equal(r.execution.billingStatus,'unknown');
  let record;const cut=fixture({chat:async()=>sseChat(model,'{"cut":',{usage:{cost_tokens:0,total_tokens:10},finish:'length'})});
  await assert.rejects(requestOrganizationRole(task,{...cut.options,model,verifiedRoster:{ids:[model],checkedAt:new Date().toISOString()},onResponse:x=>{record=x;}}),{code:'INVALID_AGENT_OUTPUT'});
  assert.equal(record.execution.finishReason,'length');assert.equal(cut.events.find(e=>e[0]==='usage')[2].reportedUsd,0);
});
test('free streaming deadline cancels its reader, retains partial data and never resubmits',async()=>{
  const model='free/gpt-6-luna';let record,cancelled=false;
  const f=fixture({chat:async()=>new Response(new ReadableStream({start(c){c.enqueue(Buffer.from('data: '+JSON.stringify({id:'slow',model,choices:[{index:0,delta:{content:'partial'},finish_reason:null}]})+'\n\n'));},cancel(){cancelled=true;}}),{headers:{'content-type':'text/event-stream'}})});
  await assert.rejects(requestOrganizationRole(task,{...f.options,model,timeoutMs:20,verifiedRoster:{ids:[model],checkedAt:new Date().toISOString()},onResponse:x=>{record=x;}}),{code:'TIMEOUT'});
  assert.equal(cancelled,true);assert.equal(record.content,'partial');assert.equal(record.failureCode,'TIMEOUT');assert.equal(f.events.find(e=>e[0]==='usage')[2].reportedUsd,null);assert.equal(f.calls.filter(c=>c.init.method==='POST').length,1);
});
test('paid deadlines and explicit streaming remain bounded and Decisions never use chat SSE',async()=>{
  const f=fixture();await assert.rejects(requestOrganizationRole(task,{...f.options,timeoutMs:45001}),{code:'INVALID_LIMIT'});assert.equal(f.calls.length,0);
  await assert.rejects(requestOrganizationRole(task,{...f.options,stream:true,timeoutMs:120001}),{code:'INVALID_LIMIT'});assert.equal(f.calls.length,0);
  await assert.rejects(requestOrganizationRole(task,{...f.options,model:'jev-1.13',stream:true}),{code:'STREAM_UNSUPPORTED'});assert.equal(f.calls.length,0);
  await assert.rejects(requestOrganizationRole({...task,constraints:{maxOutputTokens:8000}},f.options),{code:'INVALID_LIMIT'});assert.equal(f.calls.length,0);
  const paid=fixture({chat:async()=>sseChat('gpt-6.2-astra',JSON.stringify(output()),{usage:{cost_tokens:3}})});
  const r=await requestOrganizationRole(task,{...paid.options,stream:true,timeoutMs:120000});assert.equal(r.execution.transport,'sse');assert.equal(r.execution.settings.maxOutputTokens,2000);
});
test('a fenced unknown-usage callback cannot discard partial SSE evidence or trigger another usage call/POST',async()=>{
  const model='free/gpt-6-luna',partial='{"partial":true}';let record,calls=0;
  const f=fixture({chat:async()=>sseChat(model,partial,{done:false}),onUsage:async()=>{calls++;throw Object.assign(new Error('Lease fence rejected settlement'),{code:'STALE_LEASE'});}});
  await assert.rejects(requestOrganizationRole(task,{...f.options,model,verifiedRoster:{ids:[model],checkedAt:new Date().toISOString()},onResponse:r=>{record=r;}}),{code:'STALE_LEASE'});
  assert.equal(calls,1);assert.equal(record.content,partial);assert.equal(record.contentSha256,createHash('sha256').update(partial).digest('hex'));assert.equal(record.execution.streamEvidence.complete,false);assert.equal(record.streamErrorCode,'STREAM_INCOMPLETE');
  assert.equal(f.calls.filter(c=>c.init.method==='POST').length,1);
});
test('free Drex requires a committed receipt and sends only the real typed Decisions envelope',async()=>{
  const model=FREE_DREX_DECISION_MODEL,evidenceHash='e'.repeat(64),active={...task,policyVersion:FREE_DREX_DECISION_PROTOCOL,inputHashes:[hash,evidenceHash]};let original;
  const raw={object:'decision',model,usage:{cost_tokens:0,total_tokens:100},answers:{review_queue:{type:'choice',choice:'geometry_review'}}};
  const f=fixture({chat:async()=>json(raw)});
  const result=await requestOrganizationRole(active,{...f.options,model,verifiedRoster:{ids:[model],checkedAt:new Date().toISOString()},context:{metrics:{attempted:12,diagnosticPasses:4},pdfReview:{checked:12,failed:0}},
    authorizeDecisionRoute:async({taskId,attemptId})=>{assert.equal(f.events.at(-1)[0],'dispatch');return {model,protocol:FREE_DREX_DECISION_PROTOCOL,taskId,attemptId,evidenceHash};},onResponse:r=>{original=r;}});
  const post=f.calls.find(c=>c.init.method==='POST');assert.equal(post.url,'https://api.apinex.bond/v1/decisions');
  const body=JSON.parse(post.init.body);assert.deepEqual(Object.keys(body).sort(),['model','questions','state']);assert.equal(body.questions.review_queue.type,'choice');
  assert.equal(result.contributionKind,'typed-decision');assert.equal(result.protocol,FREE_DREX_DECISION_PROTOCOL);assert.equal(result.result,undefined);assert.equal(result.peerReview,undefined);assert.equal(result.metricClaims,undefined);
  assert.equal(result.execution.settings.protocol,FREE_DREX_DECISION_PROTOCOL);assert.equal(result.execution.settings.requestOutputTokenLimit,null);assert.equal(result.execution.routeMigration.evidenceHash,evidenceHash);
  assert.deepEqual(JSON.parse(original.content),raw);assert.equal(result.validation.peerReviewApplicable,false);assert.equal(result.validation.releaseAuthority,false);
  assert.equal(f.events.find(e=>e[0]==='reserve')[1].usd,0);assert.equal(f.events.find(e=>e[0]==='reserve')[1].allowance.reservedUnits,268288);
  assert.equal(f.calls.filter(c=>c.init.method==='POST').length,1);
});
test('new free typed route cannot bypass receipt binding, force SSE or repair a chat answer',async()=>{
  const model=FREE_DREX_DECISION_MODEL,evidenceHash='e'.repeat(64),active={...task,policyVersion:FREE_DREX_DECISION_PROTOCOL,inputHashes:[hash,evidenceHash]};
  const base={model,verifiedRoster:{ids:[model],checkedAt:new Date().toISOString()},context:{metrics:{attempted:1,diagnosticPasses:0},pdfReview:{checked:1,failed:0}},authorizeDecisionRoute:async({taskId,attemptId})=>({model,protocol:FREE_DREX_DECISION_PROTOCOL,taskId,attemptId,evidenceHash})};
  const missing=fixture();await assert.rejects(requestOrganizationRole(active,{...missing.options,...base,authorizeDecisionRoute:undefined}),{code:'ROUTE_MIGRATION_REQUIRED'});assert.equal(missing.calls.length,0);
  const forced=fixture();await assert.rejects(requestOrganizationRole(active,{...forced.options,...base,stream:true}),{code:'STREAM_UNSUPPORTED'});assert.equal(forced.calls.length,0);
  const forged=fixture();await assert.rejects(requestOrganizationRole(active,{...forged.options,...base,authorizeDecisionRoute:async({taskId,attemptId})=>({model,protocol:FREE_DREX_DECISION_PROTOCOL,taskId,attemptId,evidenceHash:'f'.repeat(64)})}),{code:'ROUTE_MIGRATION_REQUIRED'});
  assert.equal(forged.calls.filter(c=>c.init.method==='POST').length,0);assert.equal(forged.events.at(-1)[2].reportedUsd,null);
  const chat=fixture({chat:async()=>json({model,usage:{cost_tokens:0},choices:[{finish_reason:'stop',message:{content:'geometry_review'}}]})});
  await assert.rejects(requestOrganizationRole(active,{...chat.options,...base}),{code:'INVALID_DECISION_OUTPUT'});assert.equal(chat.calls.filter(c=>c.init.method==='POST').length,1);
  const mismatch=fixture({chat:async()=>json({object:'decision',model:'drex-v2.0',usage:{cost_tokens:0},answers:{review_queue:{type:'choice',choice:'geometry_review'}}})});
  await assert.rejects(requestOrganizationRole(active,{...mismatch.options,...base}),{code:'MODEL_MISMATCH'});assert.equal(mismatch.events.at(-1)[2].reportedUsd,0);
});
test('JSON compatibility responses require one assistant text choice and never accept tools, refusal or ambiguous choices',async()=>{
  const model='free/gpt-6-luna',good={index:0,finish_reason:'stop',message:{role:'assistant',content:JSON.stringify(output())}};
  for(const choices of [
    [{...good,message:{...good.message,role:'user'}}],
    [{...good,message:{...good.message,tool_calls:[{function:{name:'run',arguments:'{}'}}]}}],
    [{...good,message:{...good.message,function_call:{name:'run'}}}],
    [{...good,message:{...good.message,refusal:'Cannot comply'}}],
    [good,good],[{...good,index:1}],
  ]){
    const f=fixture({chat:async()=>json({model,usage:{cost_tokens:0},choices})});let record;
    await assert.rejects(requestOrganizationRole(task,{...f.options,model,verifiedRoster:{ids:[model],checkedAt:new Date().toISOString()},onResponse:r=>{record=r;}}),{code:'INVALID_AGENT_OUTPUT'});
    assert.equal(f.events.find(e=>e[0]==='usage')[2].reportedUsd,0);assert.equal(record.execution.transport,'json-response-to-stream-request');assert.equal(f.calls.filter(c=>c.init.method==='POST').length,1);
  }
});
test('oversized JSON compatibility evidence has a bounded UTF-8 prefix and truthful hashes before rejection',async()=>{
  const model='free/gpt-6-luna',original='é'.repeat(40000);let record;
  const f=fixture({chat:async()=>json({model,usage:{cost_tokens:0},choices:[{finish_reason:'stop',message:{content:original}}]})});
  await assert.rejects(requestOrganizationRole(task,{...f.options,model,verifiedRoster:{ids:[model],checkedAt:new Date().toISOString()},onResponse:r=>{record=r;}}),{code:'OUTPUT_TOO_LARGE'});
  assert.ok(Buffer.byteLength(record.content)<=65536);assert.equal(record.content.includes('\ufffd'),false);assert.equal(record.contentTruncated,true);
  assert.equal(record.contentSha256,createHash('sha256').update(record.content).digest('hex'));assert.equal(record.originalContentSha256,createHash('sha256').update(original).digest('hex'));assert.equal(record.originalContentBytes,80000);
});

function calculationFixture({usage,finish='stop',returnedModel,quoteChange={},quoteUnavailable=false,onResponse,onDispatch,chat}={}){
  const model='free/qwen-3.8-max',published=getModelCatalogEntry(model),records=[],order=[];
  const body=JSON.stringify({models:[{id:model,provider:'Free',allowFree:true,dollarsPer1M:0,outputDollarsPer1M:0,
    contextWindow:String(published.contextTokens),weight:published.allowanceWeight,...quoteChange}]});
  const quote={schemaVersion:1,policy:POLICY,sourceUrl:ALLOWANCE_QUOTE_URL,observedAt:Date.now(),body,bodySha256:createHash('sha256').update(body).digest('hex')};
  const f=fixture({roster:async()=>json({data:[{id:model}]}),chat:chat??(async()=>{order.push('post');return json({id:'request-calculation',model:returnedModel??model,
    usage:usage??{prompt_tokens:20,completion_tokens:30,total_tokens:50,cost_tokens:0},choices:[{index:0,finish_reason:finish,message:{content:finish==='length'?'cut':JSON.stringify(output())}}]});}),
    reserve:async value=>{order.push('reserve');records.push({kind:'reserve',value});return 'calculation-attempt';},
    onDispatch:async attempt=>{order.push('dispatch');if(onDispatch)await onDispatch(attempt);},
    onUsage:async(attempt,value)=>{order.push('usage');records.push({kind:'usage',attempt,value});}});
  return {...f,model,quote,records,order,options:{...f.options,model,stream:false,calculateAllowance:true,
    allowanceQuoteVerifier:async()=>{order.push('quote');return quoteUnavailable?{eligible:false,reason:'QUOTE_UNAVAILABLE'}:{quoteArtifact:quote};},
    onAllowanceCalculationQuote:async value=>{order.push('quote-ack');records.push({kind:'quote',value});return {hash:'b'.repeat(64)};},
    onResponse:async value=>{order.push('response-ack');records.push({kind:'response',value});return onResponse?onResponse(value):{hash:'c'.repeat(64)};}}};
}

test('prospective opt-in binds a fresh quote at reserve and durably persists attempt-bound original response before calculated settlement',async()=>{
  const f=calculationFixture();await requestOrganizationRole(task,f.options);
  assert.deepEqual(f.order,['quote','quote-ack','reserve','dispatch','post','response-ack','usage']);
  const reserve=f.records.find(r=>r.kind==='reserve').value;
  assert.deepEqual(reserve.allowanceCalculationReservation,{policy:POLICY,model:f.model,weight:getModelCatalogEntry(f.model).allowanceWeight,quoteArtifactHash:'b'.repeat(64)});
  assert.equal(reserve.allowance.reservedUnits,getModelCatalogEntry(f.model).contextTokens*2*getModelCatalogEntry(f.model).allowanceWeight);
  const raw=f.records.find(r=>r.kind==='response').value;
  assert.deepEqual(raw.attemptBinding,{attemptId:'calculation-attempt',taskId:task.id,model:f.model,protocol:'chat/completions'});
  assert.equal(raw.rawResponse.usage.total_tokens,50);assert.equal(raw.execution.transportComplete,true);
  const settled=f.records.find(r=>r.kind==='usage').value;
  assert.deepEqual(settled.allowanceCalculation,{policy:POLICY,quoteArtifactHash:'b'.repeat(64),responseArtifactHash:'c'.repeat(64)});
  assert.equal(settled.reportedAllowanceUnits,null);assert.equal(Object.hasOwn(settled.allowanceCalculation,'units'),false,'Caller never submits a calculated charge.');
});
test('default callers never request calculation quotes or alter existing allowance settlement',async()=>{
  const f=calculationFixture();await requestOrganizationRole(task,{...f.options,calculateAllowance:false});
  assert.deepEqual(f.order,['reserve','dispatch','post','usage','response-ack']);
  assert.equal(f.records.find(r=>r.kind==='reserve').value.allowanceCalculationReservation,undefined);
  assert.equal(f.records.find(r=>r.kind==='usage').value.allowanceCalculation,undefined);
  assert.equal(f.records.find(r=>r.kind==='response').value.attemptBinding,undefined);
  await assert.rejects(requestOrganizationRole(task,{...f.options,calculateAllowance:'true'}),{code:'INVALID_LIMIT'});
});
test('affirmative public price, weight or context increase blocks before reservation and POST',async()=>{
  for(const quoteChange of [{dollarsPer1M:.1},{outputDollarsPer1M:.1},{weight:9999},{contextWindow:'1024M'}]){
    const f=calculationFixture({quoteChange});await assert.rejects(requestOrganizationRole(task,f.options),{code:'PRICING_CHANGED_REVERIFY'});
    assert.equal(f.records.some(r=>r.kind==='reserve'),false);assert.equal(f.calls.some(c=>c.init.method==='POST'),false);
  }
});
test('unavailable/malformed quote or unacknowledged quote preserves the entire conservative reservation without opting in',async()=>{
  for(const options of [{quoteUnavailable:true},{quoteChange:{weight:'3'}},{}]){
    const f=calculationFixture(options);
    if(!Object.keys(options).length)f.options.onAllowanceCalculationQuote=async()=>undefined;
    await requestOrganizationRole(task,f.options);
    const r=f.records.find(r=>r.kind==='reserve').value,s=f.records.find(r=>r.kind==='usage').value;
    assert.ok(r.allowance.reservedUnits>0);assert.equal(r.allowanceCalculationReservation,undefined);assert.equal(s.allowanceCalculation,undefined);assert.equal(s.reportedAllowanceUnits,null);
  }
});
test('missing/failed durable response acknowledgement cannot produce a derived settlement or a successful task',async()=>{
  for(const onResponse of [async()=>undefined,async()=>{throw Error('disk unavailable');}]){
    const f=calculationFixture({onResponse});await assert.rejects(requestOrganizationRole(task,f.options),{code:'ALLOWANCE_RESPONSE_NOT_DURABLE'});
    const usages=f.records.filter(r=>r.kind==='usage');assert.equal(usages.length,1);assert.equal(usages[0].value.allowanceCalculation,undefined);assert.equal(usages[0].value.reportedAllowanceUnits,null);
  }
});
test('opted-in complete length output settles documented usage after raw acknowledgement even though role output is rejected',async()=>{
  const f=calculationFixture({finish:'length'});await assert.rejects(requestOrganizationRole(task,f.options),{code:'INVALID_AGENT_OUTPUT'});
  assert.equal(f.records.find(r=>r.kind==='usage').value.allowanceCalculation.policy,POLICY);
  assert.ok(f.order.indexOf('response-ack')<f.order.indexOf('usage'));
});
test('model mismatch, partial counts and contradictory aliases keep a full hold after raw evidence acknowledgement',async()=>{
  for(const options of [{returnedModel:'alias'}, {usage:{prompt_tokens:20,completion_tokens:30}},
    {usage:{prompt_tokens:20,completion_tokens:30,total_tokens:50,input_tokens:21}},
    {usage:{prompt_tokens:20,completion_tokens:30,total_tokens:50,cost_tokens:1}}]){
    const f=calculationFixture(options);
    if(options.returnedModel)await assert.rejects(requestOrganizationRole(task,f.options),{code:'MODEL_MISMATCH'});
    else await requestOrganizationRole(task,f.options);
    assert.equal(f.records.find(r=>r.kind==='usage').value.allowanceCalculation,undefined);assert.equal(f.records.filter(r=>r.kind==='usage').length,1);
    assert.ok(f.order.indexOf('response-ack')<f.order.indexOf('usage'));
  }
});
test('quote freshness is enforced again after durable dispatch callback before POST',async()=>{
  const original=Date.now;let clock=original();
  try{
    Date.now=()=>clock;
    const f=calculationFixture({onDispatch:async()=>{clock+=60001;}});
    await assert.rejects(requestOrganizationRole(task,f.options),{code:'ALLOWANCE_CALCULATION_QUOTE_STALE'});
    assert.equal(f.calls.some(c=>c.init.method==='POST'),false);assert.equal(f.records.find(r=>r.kind==='usage').value.allowanceCalculation,undefined);
  }finally{Date.now=original;}
});
test('cancellation after raw acknowledgement retains an unknown hold and never calculates or resends',async()=>{
  const controller=new AbortController(),f=calculationFixture({onResponse:async()=>{controller.abort();return {hash:'c'.repeat(64)};}});
  await assert.rejects(requestOrganizationRole(task,{...f.options,signal:controller.signal}),{code:'CANCELLED'});
  assert.equal(f.records.filter(r=>r.kind==='usage').length,1);assert.equal(f.records.find(r=>r.kind==='usage').value.allowanceCalculation,undefined);assert.equal(f.calls.filter(c=>c.init.method==='POST').length,1);
});
test('prospective streaming calculation requires DONE; complete JSON compatibility uses its single existing response',async()=>{
  const model='free/qwen-3.8-max',usage={prompt_tokens:20,completion_tokens:30,total_tokens:50,cost_tokens:0};
  const complete=calculationFixture({chat:async()=>sseChat(model,JSON.stringify(output()),{usage})});
  await requestOrganizationRole(task,{...complete.options,stream:true});
  assert.equal(complete.records.find(r=>r.kind==='response').value.execution.streamEvidence.doneReceived,true);
  assert.equal(complete.records.find(r=>r.kind==='usage').value.allowanceCalculation.policy,POLICY);
  const partial=calculationFixture({chat:async()=>sseChat(model,'partial',{usage,done:false})});
  await assert.rejects(requestOrganizationRole(task,{...partial.options,stream:true}),{code:'STREAM_INCOMPLETE'});
  const original=partial.records.find(r=>r.kind==='response').value;
  assert.equal(original.attemptBinding.attemptId,'calculation-attempt');assert.equal(original.execution.streamEvidence.complete,false);
  assert.equal(partial.records.find(r=>r.kind==='usage').value.allowanceCalculation,undefined);
  assert.ok(partial.order.indexOf('response-ack')<partial.order.indexOf('usage'));
  const compatibility=calculationFixture();await requestOrganizationRole(task,{...compatibility.options,stream:true});
  assert.equal(compatibility.records.find(r=>r.kind==='response').value.execution.transport,'json-response-to-stream-request');
  assert.equal(compatibility.records.find(r=>r.kind==='usage').value.allowanceCalculation.policy,POLICY);
  for(const f of [complete,partial,compatibility])assert.equal(f.calls.filter(c=>c.init.method==='POST').length,1);
});
