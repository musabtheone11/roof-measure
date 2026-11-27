// Runtime organization contracts. Models recommend; trusted host adapters issue evidence.
export const ROLES = Object.freeze(['ceo','extraction','reference','engineering','critique','verification','reporting','operations']);
export const MODEL_BY_ROLE = Object.freeze(Object.fromEntries(ROLES.map(role=>[role,['engineering','verification','operations'].includes(role)?'gpt-6.2-astra':'claude-opus-5.5'])));
export const BINDING_KEYS = Object.freeze(['sourceRevision','datasetRevision','candidateHash','policyVersion','inputHashes']);
export const REQUIRED_RELEASE_CHECKS = Object.freeze(['baseline','verification','holdout','numerical','report','staging','source-rights','repository-policy']);
export class OrganizationContractError extends Error {
  constructor(message) { super(message); this.name='OrganizationContractError'; this.code='INVALID_ORGANIZATION_CONTRACT'; }
}
const fail=message=>{throw new OrganizationContractError(message);};
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const text=(v,max=2000)=>typeof v==='string'&&v.trim().length>0&&v.length<=max;
const finite=v=>typeof v==='number'&&Number.isFinite(v);
const hash=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
function keys(v,required,optional=[]) {
  if(!object(v)||required.some(k=>!Object.hasOwn(v,k))||Object.keys(v).some(k=>!required.includes(k)&&!optional.includes(k)))fail('Unexpected or missing fields');
}
function strings(v,max=100,length=2000) {
  if(!Array.isArray(v)||v.length>max||!v.every(x=>text(x,length)))fail('Invalid bounded string list');
}
function hashes(v) {
  if(!Array.isArray(v)||!v.length||v.length>100||!v.every(hash)||new Set(v).size!==v.length)fail('Invalid input hashes');
}
function binding(v) {
  for(const k of ['sourceRevision','datasetRevision','policyVersion'])if(!text(v[k],200))fail('Invalid '+k);
  if(!hash(v.candidateHash))fail('Invalid candidateHash');
  hashes(v.inputHashes);
}
export function sameBinding(a,b) {
  return ['sourceRevision','datasetRevision','candidateHash','policyVersion'].every(k=>a?.[k]===b?.[k])&&Array.isArray(a?.inputHashes)&&Array.isArray(b?.inputHashes)&&a.inputHashes.length===b.inputHashes.length&&[...a.inputHashes].sort().every((v,i)=>v===[...b.inputHashes].sort()[i]);
}
export function validateTask(task) {
  keys(task,['schemaVersion','id','role','actorId',...BINDING_KEYS],['stage','artifacts','constraints','priorFindings','workflowId','maxAttempts']);
  if(task.schemaVersion!==1||!text(task.id,160)||!ROLES.includes(task.role)||!text(task.actorId,160))fail('Invalid task identity');
  binding(task);
  if(task.workflowId!==undefined&&!text(task.workflowId,160))fail('Invalid workflowId');
  if(task.maxAttempts!==undefined&&(!Number.isInteger(task.maxAttempts)||task.maxAttempts<1||task.maxAttempts>2))fail('Invalid maxAttempts');
  if(task.stage!==undefined&&!text(task.stage,100))fail('Invalid stage');
  if(task.artifacts!==undefined)strings(task.artifacts,100,200);
  if(task.priorFindings!==undefined)strings(task.priorFindings,100,2000);
  if(task.constraints!==undefined) {
    keys(task.constraints,[],['maxAttempts','maxRuntimeMs','maxOutputTokens','maxRevisions','extension','actors','externalProcessingAuthorized','cycles','stageCount','previousTaskId','sourceHashes']);
    const maxima={maxAttempts:2,maxRuntimeMs:120000,maxOutputTokens:2000,maxRevisions:2};
    for(const [k,v]of Object.entries(task.constraints))if(Object.hasOwn(maxima,k)&&(!Number.isInteger(v)||v<0||v>maxima[k]))fail('Invalid explicit task constraint');
    const c=task.constraints;
    if(c.extension!==undefined&&!['.txt','.pdf','.json'].includes(c.extension))fail('Invalid source extension');
    if(c.actors!==undefined) {
      keys(c.actors,[],ROLES);
      if(!Object.values(c.actors).every(v=>text(v,160)))fail('Invalid assigned actor');
    }
    if(c.externalProcessingAuthorized!==undefined&&typeof c.externalProcessingAuthorized!=='boolean')fail('Invalid external processing authorization');
    if(c.cycles!==undefined&&(!Number.isInteger(c.cycles)||c.cycles<0||c.cycles>2))fail('Invalid revision cycles');
    if(c.stageCount!==undefined&&(!Number.isInteger(c.stageCount)||c.stageCount<1||c.stageCount>16))fail('Invalid stage count');
    if(c.previousTaskId!==undefined&&!text(c.previousTaskId,160))fail('Invalid previous task reference');
    if(c.sourceHashes!==undefined)hashes(c.sourceHashes);
  }
  if(Buffer.byteLength(JSON.stringify(task))>65536)fail('Task exceeds 64 KiB');
  return structuredClone(task);
}

export const ROLE_PAYLOAD_CONTRACTS = Object.freeze({
  ceo:'{priority: integer 0..100, requestedDecision: "approve"|"revise"|"reject"|"needs-human"}',
  extraction:'{observations:[{page: positive integer, region: [x,y,width,height]|null, literal: string, unit: string|null, ambiguity: string|null}]}',
  reference:'{propertyGroup:string|null, referenceTier:"verified"|"source-claim"|"synthetic"|"excluded"|"needs-human", split:"development"|"validation"|"holdout"|"quarantine", contradictions:string[]}',
  engineering:'{hypothesis:string, patchArtifact:string|null, predictedMetric:string}',
  critique:'{counterexamples:string[], recommendation:string}',
  verification:'{evidenceIds:string[]}',
  reporting:'{reportArtifact:string|null}',
  operations:'{operation:"diagnose"|"reconcile"|"stage"|"release"|"rollback"|"pause", targetRevision:string|null, rollbackTarget:string|null}'
});
function nullableText(v,max=2000) {return v===null||text(v,max);}
function payload(role,p) {
  switch(role) {
    case 'ceo':
      keys(p,['priority','requestedDecision']);
      if(!Number.isInteger(p.priority)||p.priority<0||p.priority>100||!['approve','revise','reject','needs-human'].includes(p.requestedDecision))fail('Invalid CEO payload');
      break;
    case 'extraction':
      keys(p,['observations']);
      if(!Array.isArray(p.observations)||p.observations.length>100)fail('Invalid observations');
      for(const v of p.observations) {
        keys(v,['page','region','literal','unit','ambiguity']);
        if(!Number.isInteger(v.page)||v.page<1||v.page>1000||!text(v.literal)||!nullableText(v.unit,100)||!nullableText(v.ambiguity))fail('Invalid source observation');
        if(v.region!==null&&(!Array.isArray(v.region)||v.region.length!==4||!v.region.every(finite)||v.region.some(x=>x<0)||v.region[2]===0||v.region[3]===0))fail('Invalid source region');
      }
      break;
    case 'reference':
      keys(p,['propertyGroup','referenceTier','split','contradictions']);
      if(!nullableText(p.propertyGroup,200)||!['verified','source-claim','synthetic','excluded','needs-human'].includes(p.referenceTier)||!['development','validation','holdout','quarantine'].includes(p.split))fail('Invalid reference payload');
      if(p.propertyGroup===null&&p.split!=='quarantine')fail('Missing property identity requires quarantine');
      strings(p.contradictions);break;
    case 'engineering':
      keys(p,['hypothesis','patchArtifact','predictedMetric']);
      if(!text(p.hypothesis)||!nullableText(p.patchArtifact,200)||!text(p.predictedMetric))fail('Invalid engineering payload');
      break;
    case 'critique':keys(p,['counterexamples','recommendation']);strings(p.counterexamples);if(!text(p.recommendation))fail('Invalid critique payload');break;
    case 'verification':keys(p,['evidenceIds']);strings(p.evidenceIds,100,200);break;
    case 'reporting':keys(p,['reportArtifact']);if(!nullableText(p.reportArtifact,200))fail('Invalid report payload');break;
    case 'operations':
      keys(p,['operation','targetRevision','rollbackTarget']);
      if(!['diagnose','reconcile','stage','release','rollback','pause'].includes(p.operation)||!nullableText(p.targetRevision,200)||!nullableText(p.rollbackTarget,200))fail('Invalid operations payload');
      if(p.operation==='rollback'&&p.rollbackTarget===null)fail('Rollback requires recorded target');
  }
}
export function validateResult(result,task) {
  validateTask(task);
  keys(result,['schemaVersion','taskId','role',...BINDING_KEYS,'decision','findings','artifactRefs','summary','payload']);
  if(Buffer.byteLength(JSON.stringify(result))>65536)fail('Result exceeds 64 KiB');
  binding(result);
  if(result.schemaVersion!==1||result.taskId!==task.id||result.role!==task.role||!sameBinding(result,task))fail('Result is not bound to the assigned task');
  if(!['pass','revise','reject','needs-human'].includes(result.decision)||!text(result.summary,8000))fail('Invalid result decision or summary');
  if(!Array.isArray(result.findings)||result.findings.length>100)fail('Invalid findings');
  for(const finding of result.findings) {
    keys(finding,['code','severity','evidence','message']);
    if(!text(finding.code,100)||!['info','warning','critical'].includes(finding.severity)||!text(finding.message))fail('Invalid finding');
    strings(finding.evidence,20,2000);if(!finding.evidence.length)fail('Findings require evidence');
  }
  if(result.decision==='pass'&&result.findings.some(f=>f.severity==='critical'))fail('Critical findings cannot pass');
  strings(result.artifactRefs,100,200);payload(result.role,result.payload);
  if(result.role==='ceo'&&result.payload.requestedDecision!==({pass:'approve',revise:'revise',reject:'reject','needs-human':'needs-human'})[result.decision])fail('CEO envelope and requested decision disagree');
  // No response actor field is accepted; identity comes exclusively from assignment.
  return {...structuredClone(result),actorId:task.actorId};
}

/**
 * Pure release gate. lookupEvidence/lookupApproval are TRUSTED HOST callbacks,
 * never model/user supplied adapters. They resolve immutable records from the
 * operator-owned ledger. Caller-provided embedded pass flags are not evidence.
 * Same-OS-account arbitrary code execution is outside this process boundary.
 */
export function evaluateRelease(bundle,{lookupEvidence,lookupApproval}={}) {
  const reasons=[];
  const deny=message=>reasons.push(message);
  try{binding(bundle);}catch{deny('INVALID_BINDING');}
  const actors=bundle?.actors;
  if(!object(actors)||!['author','critic','verifier','ceo'].every(k=>text(actors[k],160))||new Set(Object.values(actors)).size!==4)deny('INDEPENDENT_ACTORS_REQUIRED');
  if(!['staging','production'].includes(bundle?.scope))deny('INVALID_RELEASE_SCOPE');
  if(bundle?.ceoDecision!=='approve')deny('CEO_APPROVAL_MISSING');
  if(!Array.isArray(bundle?.criticalFindings)||bundle.criticalFindings.length)deny('CRITICAL_FINDINGS_OR_MISSING_REVIEW');
  const budget=bundle?.budget;
  if(!object(budget)||!['capUsd','spentUsd','reservedUsd'].every(k=>finite(budget[k])&&budget[k]>=0)||budget.spentUsd+budget.reservedUsd>budget.capUsd)deny('BUDGET_BLOCKED');
  if(bundle?.holdoutIsolationVerified!==true)deny('HOLDOUT_ISOLATION_NOT_VERIFIED');
  if(typeof lookupEvidence!=='function'||!Array.isArray(bundle?.evidenceIds)||bundle.evidenceIds.length>100||new Set(bundle?.evidenceIds).size!==bundle?.evidenceIds?.length)deny('TRUSTED_EVIDENCE_REQUIRED');
  const checks=new Map();
  if(typeof lookupEvidence==='function'&&Array.isArray(bundle?.evidenceIds))for(const id of bundle.evidenceIds.slice(0,100)) {
    let record;try{record=lookupEvidence(id);}catch{deny('EVIDENCE_LOOKUP_FAILED');continue;}
    if(!object(record)||record.id!==id||record.issuer!=='trusted-harness'||!sameBinding(record,bundle)||!text(record.commandId,200)||!text(record.harnessVersion,200)||!hash(record.artifactHash)||!text(record.actorId,160)||!finite(record.startedAt)||!finite(record.finishedAt)||record.finishedAt<record.startedAt||record.exitCode!==0||!REQUIRED_RELEASE_CHECKS.includes(record.check)) {deny('INVALID_OR_FAILED_EVIDENCE:'+id);continue;}
    if(record.actorId!==actors?.verifier&&record.check!=='baseline')deny('VERIFIER_IDENTITY_MISMATCH:'+id);
    if(record.check==='baseline'&&[actors?.author,actors?.critic].includes(record.actorId))deny('BASELINE_NOT_INDEPENDENT');
    if(checks.has(record.check))deny('DUPLICATE_CHECK:'+record.check);
    checks.set(record.check,record);
  }
  for(const check of REQUIRED_RELEASE_CHECKS.filter(check=>bundle?.scope==='production'||check!=='staging'))if(!checks.has(check))deny('MISSING_CHECK:'+check);
  if(checks.get('baseline')?.actorId===checks.get('verification')?.actorId)deny('BASELINE_AND_CANDIDATE_ACTORS_MUST_DIFFER');
  let approval;
  if(typeof lookupApproval==='function'&&text(bundle?.approvalId,200))try{approval=lookupApproval(bundle.approvalId);}catch{deny('APPROVAL_LOOKUP_FAILED');}
  if(!object(approval)||approval.id!==bundle?.approvalId||approval.issuer!=='authenticated-human'||!text(approval.actorId,160)||!sameBinding(approval,bundle)||approval.scope!==bundle?.scope||approval.decision!=='approve'||!finite(approval.approvedAt))deny('SCOPED_HUMAN_APPROVAL_REQUIRED');
  return Object.freeze({eligible:reasons.length===0,status:reasons.length?'blocked':'eligible',reasons:Object.freeze([...new Set(reasons)])});
}
