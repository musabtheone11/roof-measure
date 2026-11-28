import {createHash} from 'node:crypto';
import {PLAIN_CLASSIFIER_PROTOCOL} from './plain-classifier.mjs';
import {FREE_DREX_DECISION_MODEL as MODEL,FREE_DREX_DECISION_PROTOCOL as PROTOCOL,validateDecisionResponse} from './decision-provider.mjs';

export const FREE_DREX_ROUTING_MESSAGE="Model 'free/drex-v2.0' is a Jev Group Decision model and cannot be called on /v1/chat/completions. Please use POST /v1/decisions instead (docs: https://apinex.bond/developers/models/decisions).";
const SHA=/^[a-f0-9]{64}$/;
const digest=value=>createHash('sha256').update(value).digest('hex');
const fail=(code,message)=>{throw Object.assign(new Error(message),{code});};
const relevant=e=>e.detail?.model===MODEL;
const probe=e=>e.kind==='decision-route-probe-dispatched'&&relevant(e)&&e.detail.protocol===PROTOCOL;
const typed=e=>e.kind==='decision-route-dispatched'&&relevant(e)&&e.detail.protocol===PROTOCOL;
const legacy=e=>e.detail.status===400&&e.detail.code==='UPSTREAM_HTTP'&&
  (e.detail.requestProtocol==null||e.detail.requestProtocol===PLAIN_CLASSIFIER_PROTOCOL);
function permanentBlock(events){
  if(events.some(e=>['fleet-provider-circuit-open','cloud-provider-circuit-open','design-provider-circuit-open'].includes(e.kind)))return 'PROVIDER_AUTH_RECONCILIATION_REQUIRED';
  if(events.some(e=>relevant(e)&&['fleet-model-circuit-open','design-model-circuit-open'].includes(e.kind)&&!legacy(e)))return 'MODEL_RECONCILIATION_REQUIRED';
  return null;
}

/** Resolve host-retained HTTP evidence; caller/model supplied error prose is never admission. */
export function findFreeDrexRoutingEvidence(store){
  const events=store.events();
  for(const task of store.listTasks().filter(t=>t.status==='failed'&&t.error==='UPSTREAM_HTTP')){
    const error=task.result?.errorDetails;
    if(task.result?.code!=='UPSTREAM_HTTP'||error?.httpStatus!==400||error.type!=='invalid_request_error'||error.message!==FREE_DREX_ROUTING_MESSAGE||
      typeof task.sourceRevision!=='string'||!task.sourceRevision||task.sourceRevision.length>200||!SHA.test(task.candidateHash||'')||
      !Array.isArray(task.inputHashes)||!task.inputHashes.length||task.inputHashes.some(h=>!SHA.test(h)))continue;
    const ownEvents=events.filter(e=>e.task_id===task.id);
    const modelEvent=ownEvents.find(e=>e.kind==='fleet-dispatched'&&relevant(e)&&e.detail.requestProtocol===PLAIN_CLASSIFIER_PROTOCOL);
    if(!modelEvent||!ownEvents.some(e=>e.kind==='finished'&&e.detail.status==='failed'))continue;
    const attempts=store.ledger(task.id).attempts.filter(a=>a.task_id===task.id&&a.reserve_usd===0&&['unknown','settled'].includes(a.state)&&
      ownEvents.some(e=>e.kind==='dispatched'&&e.detail.attemptId===a.id&&e.seq<modelEvent.seq)&&
      ownEvents.some(e=>e.kind==='finished'&&e.detail.status==='failed'&&e.detail.fence===a.fence&&e.seq>modelEvent.seq));
    if(attempts.length!==1)continue;
    const body={schemaVersion:1,model:MODEL,fromRoute:'chat/completions',fromProtocol:PLAIN_CLASSIFIER_PROTOCOL,
      toRoute:'decisions',toProtocol:PROTOCOL,failedTaskId:task.id,failedAttemptId:attempts[0].id,
      sourceRevision:task.sourceRevision,candidateHash:task.candidateHash,inputHashes:task.inputHashes,
      dispatchEventSeq:modelEvent.seq,error:{httpStatus:400,type:error.type,message:error.message},
      documentationURL:'https://apinex.bond/developers/models/decisions'};
    const bytes=Buffer.from(JSON.stringify(body));return {...body,evidenceHash:digest(bytes),bytes};
  }
  return null;
}
function verifyMarker(store,event,evidence){
  if(!event||!evidence||event.detail.evidenceHash!==evidence.evidenceHash||event.detail.failedTaskId!==evidence.failedTaskId||
    event.detail.failedAttemptId!==evidence.failedAttemptId||!SHA.test(event.detail.evidenceHash||''))return false;
  try{return store.readArtifact(event.detail.evidenceHash).equals(evidence.bytes);}catch{return false;}
}
function boundTask(task,evidence){return task?.policyVersion===PROTOCOL&&task.stage==='fleet-decision-route-primary'&&
  task.inputHashes?.includes(evidence.evidenceHash)&&task.artifacts?.includes(evidence.evidenceHash);}
export function validateFreeDrexDecisionOutput(response,raw,context,evidenceHash){
  const execution=response?.execution;
  if(response?.contributionKind!=='typed-decision'||response.protocol!==PROTOCOL||response.result!==undefined||response.metricClaims!==undefined||response.peerReview!==undefined||
    execution?.requestedModel!==MODEL||execution.returnedModel!==MODEL||execution.settings?.route!=='decisions'||execution.settings.protocol!==PROTOCOL||
    execution.routeMigration?.evidenceHash!==evidenceHash||raw?.execution?.requestedModel!==MODEL||raw.execution.returnedModel!==MODEL||
    raw.execution.settings?.route!=='decisions'||raw.execution.settings.protocol!==PROTOCOL||typeof raw.content!=='string')
    fail('INVALID_TYPED_CONTRIBUTION','Exact typed execution and original response evidence are required');
  let original;try{original=JSON.parse(raw.content);}catch{fail('INVALID_TYPED_CONTRIBUTION','Original typed response is not JSON');}
  if(JSON.stringify(original)!==JSON.stringify(response.rawDecision))fail('INVALID_TYPED_CONTRIBUTION','Typed contribution differs from its retained original');
  const checked=validateDecisionResponse(original,context,{model:MODEL});
  if(checked.validation.agreesWithExpected!==true||response.validation?.agreesWithExpected!==true||
    checked.typedDecision.choice!==response.typedDecision?.choice)
    fail('DECISION_GROUNDING_MISMATCH','The original typed answer must match the deterministic routing facts');
  return checked;
}
function successfulProof(store,marker,evidence){
  if(!verifyMarker(store,marker,evidence))return null;
  const task=store.getTask(marker.task_id),events=store.events(marker.task_id),result=task?.result;
  if(!boundTask(task,evidence)||task?.status!=='complete'||task.error||result?.primaryValidated!==true||!SHA.test(result.resultHash||'')||!SHA.test(result.rawResponseHash||''))return null;
  const attempt=store.ledger(task.id).attempts.find(a=>a.id===marker.detail.attemptId&&a.task_id===task.id&&a.fence===marker.detail.fence);
  if(!attempt||!events.some(e=>e.kind==='dispatched'&&e.detail.attemptId===attempt.id)||
    !events.some(e=>e.kind==='finished'&&e.detail.status==='complete'&&e.detail.fence===attempt.fence))return null;
  try{
    const response=JSON.parse(store.readArtifact(result.resultHash)),raw=JSON.parse(store.readArtifact(result.rawResponseHash));
    let context;
    for(const ref of task.artifacts||[]){if(!task.inputHashes.includes(ref))continue;try{const value=JSON.parse(store.readArtifact(ref));if(value.metrics&&value.pdfReview){context=value;break;}}catch{}}
    if(!context)return null;
    validateFreeDrexDecisionOutput(response,raw,context,evidence.evidenceHash);
    return {taskId:task.id,attemptId:attempt.id,resultHash:result.resultHash,evidenceHash:evidence.evidenceHash};
  }catch{return null;}
}

export function freeDrexDecisionAdmission(store){
  const events=store.events(),blocked=permanentBlock(events);
  if(blocked)return {ready:false,code:blocked};
  if(events.some(e=>e.kind==='decision-route-failed'&&relevant(e)&&e.detail.protocol===PROTOCOL))return {ready:false,code:'DECISION_ROUTE_FAILURE_REQUIRES_REVIEW'};
  const evidence=findFreeDrexRoutingEvidence(store);
  if(!evidence)return {ready:false,code:'ROUTE_MIGRATION_EVIDENCE_REQUIRED'};
  const probes=events.filter(probe);
  if(probes.length>1)return {ready:false,code:'ROUTE_MIGRATION_STATE_INVALID'};
  const proof=probes.length===1?successfulProof(store,probes[0],evidence):null;
  // A later failed typed request cannot inherit the initial qualification.
  for(const event of events.filter(typed)){
    if(probes.some(p=>p.detail.attemptId===event.detail.attemptId))continue;
    const task=store.getTask(event.task_id);
    if(task&&['failed','cancelled','needs-human','rejected'].includes(task.status)&&task.result?.primaryValidated!==true)
      return {ready:false,code:'DECISION_ROUTE_FAILURE_REQUIRES_REVIEW'};
  }
  if(probes.length&&!proof)return {ready:false,code:'MODEL_PROTOCOL_PROBE_ALREADY_USED'};
  if(events.some(e=>e.kind==='decision-route-qualified'&&relevant(e)&&e.detail.protocol===PROTOCOL)&&!proof)
    return {ready:false,code:'ROUTE_QUALIFICATION_INVALID'};
  return {ready:true,qualified:!!proof,evidence,proof};
}

/** Called synchronously INSIDE OrgStore.dispatch's transaction; never starts a nested transaction. */
export function consumeFreeDrexDecisionDispatch(store,{taskId,attemptId,workerId,fence}){
  store.requireLease(taskId,workerId,fence);
  const task=store.getTask(taskId),attempt=store.requireAttempt(attemptId,workerId,fence);
  if(attempt.task_id!==task.id||attempt.state!=='reserved'||attempt.reserve_usd!==0)fail('ROUTE_MIGRATION_STATE_INVALID','The new route requires this exact reserved free attempt');
  const admission=freeDrexDecisionAdmission(store);
  if(!admission.ready)fail(admission.code,'The exact new Decisions route is not admitted');
  if(!boundTask(task,admission.evidence))fail('ROUTE_MIGRATION_BINDING_MISMATCH','The new task must bind the exact routing protocol and evidence hash');
  const saved=store.putArtifact(admission.evidence.bytes);
  if(saved.hash!==admission.evidence.evidenceHash)fail('ROUTE_MIGRATION_STATE_INVALID','Routing proof hash differs');
  const detail={model:MODEL,protocol:PROTOCOL,route:'decisions',attemptId,fence,evidenceHash:saved.hash,
    failedTaskId:admission.evidence.failedTaskId,failedAttemptId:admission.evidence.failedAttemptId};
  if(!admission.qualified)store.event(taskId,'decision-route-probe-dispatched',detail);
  store.event(taskId,'decision-route-dispatched',detail);
  return detail;
}

/** Provider-side receipt is available only after the atomic marker and dispatch commit. */
export function authorizeFreeDrexDecisionDispatch(store,{taskId,attemptId}){
  const events=store.events(),blocked=permanentBlock(events);if(blocked)fail(blocked,'A permanent provider/model circuit still applies');
  const evidence=findFreeDrexRoutingEvidence(store),marker=events.find(e=>typed(e)&&e.task_id===taskId&&e.detail.attemptId===attemptId);
  const task=store.getTask(taskId),attempt=store.ledger(taskId).attempts.find(a=>a.id===attemptId);
  if(!verifyMarker(store,marker,evidence)||!boundTask(task,evidence)||task?.status!=='leased'||task.fence!==marker.detail.fence||attempt?.state!=='dispatched'||
    !store.events(taskId).some(e=>e.kind==='dispatched'&&e.detail.attemptId===attemptId))
    fail('ROUTE_MIGRATION_REQUIRED','A committed exact-task migration dispatch receipt is required');
  return {model:MODEL,protocol:PROTOCOL,taskId,attemptId,evidenceHash:evidence.evidenceHash,
    failedTaskId:evidence.failedTaskId,failedAttemptId:evidence.failedAttemptId};
}

export function recordFreeDrexDecisionQualification(store,taskId){
  return store.transaction(()=>{
    const admission=freeDrexDecisionAdmission(store);if(!admission.ready||!admission.qualified)fail(admission.code||'ROUTE_QUALIFICATION_INVALID','Current route admission must still allow the fenced success');
    const events=store.events(),evidence=findFreeDrexRoutingEvidence(store),marker=events.find(e=>probe(e)&&e.task_id===taskId);
    const proof=successfulProof(store,marker,evidence);
    if(!proof)fail('ROUTE_QUALIFICATION_INVALID','Only the successfully fenced original typed result qualifies the route');
    if(!events.some(e=>e.kind==='decision-route-qualified'&&relevant(e)&&e.detail.protocol===PROTOCOL))
      store.event(taskId,'decision-route-qualified',{model:MODEL,protocol:PROTOCOL,...proof});
    return proof;
  });
}
