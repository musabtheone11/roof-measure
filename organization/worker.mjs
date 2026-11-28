import {extractIsolated} from './extract.mjs';
import {requestOrganizationRole} from './provider.mjs';
import {digest, nextTask} from './workflow.mjs';
import {evaluateRelease} from './contracts.mjs';
import {normalizeSourceClaims} from './normalize.mjs';

const MODEL_STAGES = new Set(['proposal', 'critique', 'ceo']);
function originalInputsMatch(bundle, task) {
  const hashes = task.constraints?.sourceHashes;
  return Array.isArray(hashes) && Array.isArray(bundle.inputHashes) && hashes.length === bundle.inputHashes.length &&
    [...hashes].sort().every((h, i) => h === [...bundle.inputHashes].sort()[i]);
}
export async function workOnce(store, {workerId = 'local-worker', signal, provider = requestOrganizationRole,
  budget = {}, adapters = {}, now = Date.now} = {}) {
  store.recover();
  if (signal?.aborted || store.getControl() !== 'running') return null;
  const leased = store.claim(workerId, {leaseMs: 120000});
  if (!leased) return null;
  const task = Object.fromEntries(['schemaVersion', 'id', 'role', 'actorId', 'sourceRevision', 'datasetRevision',
    'candidateHash', 'policyVersion', 'inputHashes', 'stage', 'artifacts', 'constraints', 'priorFindings', 'workflowId', 'maxAttempts']
    .filter(k => Object.hasOwn(leased, k)).map(k => [k, leased[k]]));
  task.fence = leased.fence;
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, {once: true});
  const timeout = setTimeout(abort, Math.min(120000, task.constraints?.maxRuntimeMs ?? 120000));
  const heartbeat = setInterval(() => {
    try {
      if (store.getControl() === 'stopped') abort();
      else store.heartbeat(task.id, workerId, task.fence, 120000);
    } catch { abort(); }
  }, 1000);
  let result, responseArtifact, settled = false;
  try {
    if (task.constraints?.maxRuntimeMs === 0) throw Object.assign(new Error('Explicit zero runtime disables task execution'), {code:'BUDGET_DISABLED'});
    if (['staging', 'release'].includes(task.stage)) {
      if (!adapters.releaseBundle || !adapters.lookupEvidence || !adapters.lookupApproval)
        throw Object.assign(new Error('Trusted release evidence and human approval adapters are missing'), {code: 'RELEASE_GATE_BLOCKED'});
      const bundle = await adapters.releaseBundle(task);
      const expectedScope = task.stage === 'staging' ? 'staging' : 'production';
      const gate = evaluateRelease(bundle, {lookupEvidence: adapters.lookupEvidence, lookupApproval: adapters.lookupApproval});
      if (bundle.scope !== expectedScope || !gate.eligible || !originalInputsMatch(bundle, task) || bundle.candidateHash !== task.candidateHash ||
          bundle.datasetRevision !== task.datasetRevision || bundle.policyVersion !== task.policyVersion || bundle.sourceRevision !== task.sourceRevision)
        throw Object.assign(new Error('Release policy blocked: ' + gate.reasons.join(', ')), {code: 'RELEASE_GATE_BLOCKED'});
    }
    if (task.stage === 'extraction') {
      const extracted = await extractIsolated(store.readArtifact(task.inputHashes[0]), task.constraints.extension, {signal: controller.signal});
      extracted.normalized = normalizeSourceClaims(extracted, task.inputHashes[0]);
      const artifact = store.putArtifact(Buffer.from(JSON.stringify(extracted)));
      result = {decision: 'pass', outputHash: artifact.hash, summary: 'Local extraction retained as unverified source claims'};
    } else if (adapters[task.stage]) {
      // Adapter registration is trusted implementation configuration, never model output.
      result = await adapters[task.stage](task, {store, signal: controller.signal});
    } else if (MODEL_STAGES.has(task.stage)) {
      if (task.constraints.externalProcessingAuthorized !== true) throw Object.assign(new Error('Explicit source-processing authorization is missing'), {code: 'SOURCE_AUTHORIZATION_REQUIRED'});
      const context = {artifactHashes: task.inputHashes, priorFindings: task.priorFindings || []};
      // Do not pass source contents until a role-aware, permission-checked resolver is installed.
      if (!adapters.resolveContext) throw Object.assign(new Error('Authorized role-aware context resolver is not installed'), {code: 'CONTEXT_ADAPTER_REQUIRED'});
      const resolved = await adapters.resolveContext(task, context);
      const {fence: runtimeFence, ...providerTask} = task;
      const response = await provider(providerTask, {signal: controller.signal, context: resolved,
        reserve: ({usd,allowance}) => store.reserve(task.id, workerId, task.fence, {
          usd,...(allowance?{allowance}:{}), requestLimit: budget.requestLimit ?? 0, maxUsd: budget.maxUsd ?? 0,
          hourUsd: budget.hourUsd ?? 0, dayUsd: budget.dayUsd ?? 0, monthUsd: budget.monthUsd ?? 0, weekUsd: budget.weekUsd ?? 0}),
        onDispatch: id => store.dispatch(id, workerId, task.fence),
        onResponse: record => { responseArtifact = store.putArtifact(Buffer.from(JSON.stringify(record))); },
        onUsage: (id, usage) => store.settle(id, workerId, task.fence, usage)});
      const artifact = store.putArtifact(Buffer.from(JSON.stringify(response)));
      result = {decision: response.result.decision, outputHash: artifact.hash, summary: response.result.summary};
    } else {
      throw Object.assign(new Error(`Stage ${task.stage} requires its trusted adapter or human evidence; model opinions cannot complete it`), {code: 'ADAPTER_REQUIRED'});
    }
    if (controller.signal.aborted) throw Object.assign(new Error('Worker stopped or deadline exceeded'), {code: 'CANCELLED'});
    if (!result || !['pass', 'revise', 'reject', 'needs-human'].includes(result.decision) || !/^[a-f0-9]{64}$/.test(result.outputHash || ''))
      throw new Error('Adapter returned invalid result or missing artifact hash');
    // Read back the artifact; a fabricated reference cannot become a handoff.
    const bytes = store.readArtifact(result.outputHash);
    if (digest(bytes) !== result.outputHash) throw new Error('Adapter artifact integrity mismatch');
    if (task.stage === 'ceo' && result.decision === 'pass') {
      // CEO recommendation is saved, but staging is never admitted without trusted evidence.
      if (!adapters.releaseBundle || !adapters.lookupEvidence || !adapters.lookupApproval)
        throw Object.assign(new Error('CEO recommendation cannot bypass missing release evidence/approval adapters'), {code: 'RELEASE_GATE_BLOCKED'});
      const bundle = await adapters.releaseBundle(task);
      const gate = evaluateRelease(bundle, {lookupEvidence: adapters.lookupEvidence, lookupApproval: adapters.lookupApproval});
      if (!gate.eligible || bundle.scope !== 'staging' || !originalInputsMatch(bundle, task) || bundle.candidateHash !== task.candidateHash ||
          bundle.datasetRevision !== task.datasetRevision || bundle.policyVersion !== task.policyVersion || bundle.sourceRevision !== task.sourceRevision)
        throw Object.assign(new Error('CEO recommendation failed policy: ' + gate.reasons.join(', ')), {code: 'RELEASE_GATE_BLOCKED'});
    }
    const {fence: runtimeFence, ...workflowTask} = task;
    const next = nextTask(workflowTask, result);
    const blocked = result.decision === 'needs-human' || (result.decision === 'revise' && !next);
    // Parent checkpoint and next-stage admission are one database transaction.
    const status = result.decision === 'reject' ? 'rejected' : blocked ? 'needs-human' : 'complete';
    store.finish(task.id, workerId, task.fence, {status, result, nextTask: next}); settled = true;
    return {taskId: task.id, status, nextTaskId: next?.id || null};
  } catch (error) {
    const code = error.code || 'TASK_FAILED';
    if (error.retryable === true && error.automaticRetryAllowed !== false && !controller.signal.aborted) {
      try {
        const wait = Math.max(error.retryAfterMs || 0, 1000 * 2 ** Math.max(0, leased.attempts - 1) + Math.floor(Math.random() * 250));
        if (wait <= 10000) {
          store.retry(task.id, workerId, task.fence, {notBefore: now() + wait, error: code});
          return {taskId:task.id,status:'pending',code,retryAfterMs:wait};
        }
      } catch { /* Unknown billing and exhausted attempts intentionally prevent automatic retry. */ }
    }
    const status = ['ADAPTER_REQUIRED', 'CONTEXT_ADAPTER_REQUIRED', 'SOURCE_AUTHORIZATION_REQUIRED', 'BUDGET_LIMIT', 'BUDGET_DISABLED', 'RELEASE_GATE_BLOCKED'].includes(code) ? 'needs-human' : 'failed';
    try { store.finish(task.id, workerId, task.fence, {status, result: result || (responseArtifact ? {rawResponseHash: responseArtifact.hash} : null), error: JSON.stringify({code, message: error.message.slice(0, 500)})}); settled = true; } catch { /* expired fence remains recoverable; never overwrite its successor */ }
    return {taskId: task.id, status: settled ? status : 'lease-lost', code};
  } finally {
    clearTimeout(timeout); clearInterval(heartbeat); signal?.removeEventListener('abort', abort);
  }
}
