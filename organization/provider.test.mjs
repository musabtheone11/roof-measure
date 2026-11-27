import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyRoster, requestOrganizationRole } from './provider.mjs';

const hash = 'a'.repeat(64);
const task = { schemaVersion: 1, id: 'task1', role: 'engineering', actorId: 'engineer1', sourceRevision: 'commit1', datasetRevision: 'data1', candidateHash: hash, policyVersion: 'policy1', inputHashes: [hash] };
const output = () => ({ schemaVersion: 1, taskId: task.id, role: task.role, sourceRevision: task.sourceRevision, datasetRevision: task.datasetRevision, candidateHash: hash, policyVersion: task.policyVersion, inputHashes: [hash], decision: 'needs-human', findings: [], artifactRefs: [], summary: 'No independently measured reference is supplied.', payload: { hypothesis: 'Inspect source registration.', patchArtifact: null, predictedMetric: 'Lower registration error.' } });
const json = (data, init = {}) => new Response(JSON.stringify(data), { status: 200, ...init });
function fixture({ chat, roster, reserve, onUsage, onDispatch } = {}) {
  const calls = [], events = [];
  const options = {
    apiKey: 'test-secret-not-real',
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      if (url.endsWith('/models')) return roster ? roster(url, init) : json({ data: [{ id: 'gpt-6.2-astra' }] });
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
  const content = fixture({ chat: async () => json({ usage: { cost_tokens: 42 }, choices: [{ finish_reason: 'stop', message: { content: 'x'.repeat(65537) } }] }) });
  await assert.rejects(requestOrganizationRole(task, content.options), { code: 'OUTPUT_TOO_LARGE' });
  assert.equal(content.events.at(-1)[2].reportedUsd, 0.000042);
});

test('malformed model JSON and forged actor fail strict local validation', async () => {
  const badJSON = fixture({ chat: async () => json({ choices: [{ finish_reason: 'stop', message: { content: '```json\n{"unfinished":\n```' } }] }) });
  await assert.rejects(requestOrganizationRole(task, badJSON.options), { code: 'INVALID_AGENT_OUTPUT' });
  const forged = fixture({ chat: async () => json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ ...output(), actorId: 'verifier' }) } }] }) });
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
  const f = fixture({ chat: async () => json({ usage: { prompt_tokens: 10, completion_tokens: 10 }, choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(output()) } }] }) });
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
  const bad=fixture({chat:async()=>json({choices:[{finish_reason:'stop',message:{content:'Here is JSON:\n'+JSON.stringify(output())}}]})});
  await assert.rejects(requestOrganizationRole(task,bad.options),{code:'INVALID_AGENT_OUTPUT'});
});
