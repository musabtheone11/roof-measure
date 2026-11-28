import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import { verifyRoster, requestOrganizationRole } from './provider.mjs';

const hash = 'a'.repeat(64);
const task = { schemaVersion: 1, id: 'task1', role: 'engineering', actorId: 'engineer1', sourceRevision: 'commit1', datasetRevision: 'data1', candidateHash: hash, policyVersion: 'policy1', inputHashes: [hash] };
const output = () => ({ schemaVersion: 1, taskId: task.id, role: task.role, sourceRevision: task.sourceRevision, datasetRevision: task.datasetRevision, candidateHash: hash, policyVersion: task.policyVersion, inputHashes: [hash], decision: 'needs-human', findings: [], artifactRefs: [], summary: 'No independently measured reference is supplied.', payload: { hypothesis: 'Inspect source registration.', patchArtifact: null, predictedMetric: 'Lower registration error.' } });
const json = (data, init = {}) => new Response(JSON.stringify(data), { status: 200, ...init });
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
    const typed=model.routeClaim==='decisions';
    const f=fixture({chat:async()=>json(typed?{object:'decision',model:model.id,usage:{cost_tokens:0},answers:{review_queue:{type:'choice',choice:'geometry_review',confidence:.8}}}:{model:model.id,usage:{cost_tokens:0},choices:[{finish_reason:'stop',message:{content:JSON.stringify(output())}}]})});
    const response=await requestOrganizationRole(task,{...f.options,model:model.id,verifiedRoster,context:{metrics:{attempted:12,diagnosticPasses:4},pdfReview:{checked:12,failed:0}}});
    const price=getVerifiedModelPrice(model.id);assert.equal(f.events[0][1].usd,price.contextTokens*price.maxRate/1e6);
    assert.equal(response.execution.returnedModel,model.id);assert.equal(response.execution.billingTier,model.billingTier);
    assert.equal(f.calls.length,model.billingTier==='free-allowance'?2:1);assert.equal(f.calls.at(-1).url.endsWith(typed?'/decisions':'/chat/completions'),true);
    if(typed){assert.equal(response.contributionKind,'typed-decision');assert.equal(Object.hasOwn(response,'result'),false);}
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
