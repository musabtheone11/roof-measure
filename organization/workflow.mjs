import {createHash} from 'node:crypto';
import {validateTask} from './contracts.mjs';

export const STAGES = Object.freeze([
  ['extraction', 'extraction'], ['reference', 'reference'], ['baseline', 'verification'],
  ['proposal', 'engineering'], ['critique', 'critique'], ['candidate', 'engineering'],
  ['verification', 'verification'], ['ceo', 'ceo'], ['staging', 'operations'],
  ['regression', 'verification'], ['release', 'operations'], ['monitoring', 'operations'],
]);
export const digest = x => createHash('sha256').update(typeof x === 'string' || Buffer.isBuffer(x) ? x : JSON.stringify(x)).digest('hex');
export function createWorkflow({id, sourceHash, sourceRevision, datasetRevision = 'unassigned', extension, actors}) {
  if (!/^[a-f0-9]{64}$/.test(sourceHash) || !id || !sourceRevision || !actors) throw new Error('Workflow source and actors are required');
  if (!actors.engineering || !actors.critique || !actors.verification || new Set([actors.engineering, actors.critique, actors.verification]).size !== 3)
    throw new Error('Author, critic and verifier must have distinct identities');
  const task = {schemaVersion: 1, id: `${id}:extraction`, workflowId: id, maxAttempts: 2,
    role: 'extraction', actorId: actors.extraction || 'extraction-local', stage: 'extraction', sourceRevision,
    datasetRevision, candidateHash: sourceHash, policyVersion: 'org-v1', inputHashes: [sourceHash],
    artifacts: [sourceHash], constraints: {extension, actors, sourceHashes: [sourceHash], externalProcessingAuthorized: false, cycles: 0, stageCount: 1}};
  validateTask(task); return task;
}

// Trusted controller chooses stages. The model cannot return a next-stage command.
export function nextTask(task, {decision, outputHash, candidateHash = task.candidateHash} = {}) {
  if (!['pass', 'revise', 'reject', 'needs-human'].includes(decision)) throw new Error('Invalid workflow decision');
  if (decision === 'reject' || decision === 'needs-human') return null;
  const stageIndex = STAGES.findIndex(([stage]) => stage === task.stage);
  if (stageIndex < 0) throw new Error('Unknown workflow stage');
  let index = stageIndex + 1, cycles = task.constraints?.cycles || 0;
  if (decision === 'revise') {
    if (!['critique', 'verification', 'ceo'].includes(task.stage)) return null;
    cycles++; index = STAGES.findIndex(([s]) => s === 'proposal');
    if (cycles > 2) return null;
  }
  const stageCount = (task.constraints?.stageCount || 1) + 1;
  if (index >= STAGES.length || stageCount > 16) return null;
  if (!/^[a-f0-9]{64}$/.test(outputHash || '') || !/^[a-f0-9]{64}$/.test(candidateHash)) throw new Error('Frozen output/candidate hash required');
  const [stage, role] = STAGES[index];
  const actorId = stage === 'baseline' ? 'baseline-independent' : task.constraints?.actors?.[role];
  if (!actorId) throw new Error('Explicit stage actor assignment required');
  const next = {...task, id: `${task.workflowId}:${stage}:${stageCount}`, stage, role, actorId,
    inputHashes: [outputHash], artifacts: [outputHash], candidateHash,
    constraints: {...task.constraints, cycles, stageCount, previousTaskId: task.id}};
  validateTask(next); return next;
}

export const CAPABILITIES = Object.freeze({
  discovery: 'implemented-local', extraction: 'implemented-local-text-and-pdf',
  reference: 'needs-human-property-identity-and-truth', baseline: 'trusted-harness-adapter-required',
  proposal: 'apinex-text-proposal-only', critique: 'apinex-text-proposal-only',
  candidate: 'isolated-code-application-adapter-required', verification: 'isolated-verification-adapter-required',
  ceo: 'apinex-advisory-only', staging: 'deployment-adapter-required', regression: 'staging-test-adapter-required',
  release: 'repository-policy-and-human-authority-required', monitoring: 'health-adapter-required',
  customerJSON: 'implemented-no-imagery', customerPDF: 'implemented-no-imagery',
  localOSService: 'not-installed', production: 'not-deployed',
});
