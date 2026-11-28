import {createHash} from 'node:crypto';
import {setTimeout as wait} from 'node:timers/promises';
import {MODEL_CATALOG,textAllowanceReservationUnits} from './model-catalog.mjs';
import {requestOrganizationRole,verifyRoster} from './provider.mjs';
import {auditModelCatalog} from './catalog-audit.mjs';
import {validateResult} from './contracts.mjs';
import {buildMetricFacts,validateMetricClaims,buildFleetAssignments} from './model-fleet.mjs';
import {reconcileLegacyFreeAllowance} from './allowance-legacy.mjs';

export const CASE_WORK_PROTOCOL='development-case-work-v1';
const SHA=/^[a-f0-9]{64}$/,MAX_PACKET=128*1024;
const fail=(code,message)=>{throw Object.assign(new Error(message),{code});};
const copy=value=>JSON.parse(JSON.stringify(value));
const bounded=(value,max=200)=>typeof value==='string'&&value.trim().length>0&&value.length<=max;
function canonical(value,depth=0){
  if(depth>20)fail('CASE_WORK_PACKET_LIMIT','Packet nesting exceeds20levels');
  if(value===null||typeof value==='boolean'||typeof value==='string')return value;
  if(typeof value==='number'){if(!Number.isFinite(value))fail('CASE_WORK_INVALID_PACKET','Nonfinite evidence is forbidden');return value;}
  if(Array.isArray(value))return value.map(v=>canonical(v,depth+1));
  if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k],depth+1)]));
  fail('CASE_WORK_INVALID_PACKET','Packet evidence must be JSON data');
}
const hash=value=>createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
export function hashCaseWorkPacket(packet){const {packetHash,...body}=packet;return hash(body);}
function noHeldout(value,depth=0){
  if(depth>20)fail('CASE_WORK_PACKET_LIMIT','Evidence nesting exceeds20levels');
  if(!value||typeof value!=='object')return;
  if(['holdout','validation','quarantine'].includes(value.split))fail('CASE_WORK_SPLIT_FORBIDDEN','Only development cases may enter productive model work');
  if(value.splits&&(value.splits.holdout?.cases>0||value.splits.validation?.cases>0))fail('CASE_WORK_SPLIT_FORBIDDEN','Held-out metrics cannot enter a case packet');
  for(const child of Object.values(value))noHeldout(child,depth+1);
}
function packetOf(packet){
  if(!packet||packet.schemaVersion!==1||packet.split!=='development'||!bounded(packet.caseId)||!bounded(packet.propertyGroup)||
    !bounded(packet.measurementSourceRevision)||!SHA.test(packet.caseHash||'')||!SHA.test(packet.packetHash||'')||!SHA.test(packet.sourceManifestHash||'')||
    !Array.isArray(packet.inputHashes)||packet.inputHashes.length<1||packet.inputHashes.length>50||
    packet.inputHashes.some(v=>!SHA.test(v))||new Set(packet.inputHashes).size!==packet.inputHashes.length||!packet.inputHashes.includes(packet.caseHash)||!packet.inputHashes.includes(packet.sourceManifestHash))
    fail('CASE_WORK_INVALID_PACKET','Case packet requires exact development identity and immutable input hashes');
  noHeldout(packet);
  if(Buffer.byteLength(JSON.stringify(packet))>MAX_PACKET)fail('CASE_WORK_PACKET_LIMIT','Case packet exceeds128KiB');
  if(hashCaseWorkPacket(packet)!==packet.packetHash)fail('CASE_WORK_PACKET_HASH_MISMATCH','Case packet evidence differs from its canonical hash');
  buildMetricFacts(packet);return copy(packet);
}
function membership(store,packet,measurementIdentityHash){
  const bytes=store.readArtifact(packet.sourceManifestHash);if(bytes.length>1024*1024)fail('CASE_WORK_MEMBERSHIP_LIMIT','Membership manifest exceeds1MiB');
  const manifest=JSON.parse(bytes);
  if(manifest.protocol!=='cloud-case-work-membership-v1'||manifest.schemaVersion!==1||hash(manifest.measurementIdentity)!==measurementIdentityHash||
    !Array.isArray(manifest.cases)||manifest.cases.length>1000)fail('CASE_WORK_MEMBERSHIP_MISMATCH','Source manifest does not bind this measurement engine');
  const found=manifest.cases.filter(c=>c.caseId===packet.caseId);
  if(found.length!==1||found[0].propertyGroup!==packet.propertyGroup||found[0].split!=='development'||!SHA.test(found[0].inputHash||'')||
    !packet.inputHashes.includes(found[0].inputHash)||manifest.cases.some(c=>c.propertyGroup===packet.propertyGroup&&c.split!=='development'))
    fail('CASE_WORK_MEMBERSHIP_MISMATCH','Case/property does not belong exclusively to the declared development source');
}
const QUESTIONS=Object.freeze([
  {id:'edge-fit-drift:v1',codes:['EDGE_LENGTH_OUTSIDE_DIAGNOSTIC_TOLERANCE','EDGE_CORRESPONDENCE_OUTSIDE_TOLERANCE'],
    instruction:'Explain the supplied edge-fit counterexample. Propose one minimal deterministic regression and a bounded fitting hypothesis that preserves the supported boundary. Do not invent corrected measurements or claim a fix ran.'},
  {id:'spurious-roof-segment:v1',codes:['EXTRAEDGES'],
    instruction:'Explain the extra physical roof segment in the supplied evidence. Propose a rejection or connectivity invariant and a minimal counterexample test. Preserve genuine short edges and separate diagnostic obstructions from roof measurements.'},
  {id:'facet-topology:v1',codes:['FACET_COUNT_MISMATCH','FACET_CORRESPONDENCE_OUTSIDE_TOLERANCE','REUSED_PREDICTED_FACET','MISSING_OR_DUPLICATE_EDGE','EDGE_TYPE_MISMATCH','MISSEDFACETS','EXTRAFACETS','MISSEDEDGES'],
    instruction:'Analyze the explicit facet/edge topology failure. Propose one closure, shared-edge or adjacency invariant and a minimal regression fixture. Unsupported connections remain uncertain.'},
  {id:'sloped-area-fit:v1',codes:['AREA_OUTSIDE_DIAGNOSTIC_TOLERANCE'],
    instruction:'Analyze the observed area/pitch inconsistency using the supplied analytic synthetic reference and actual output. Propose a targeted regression and fitting hypothesis; distinguish projected area from sloped area. Do not invent replacement quantities.'},
  {id:'trace-failure:v1',codes:['TRACE_ERROR'],
    instruction:'Analyze the recorded trace failure. Identify a minimal reproduction and a bounded recovery hypothesis that keeps unknown measurements unknown. Do not claim successful tracing or testing.'},
]);

export function buildCaseWorkPlan({store,measurementIdentity,casePackets,maxItems=8}={}){
  if(!store||!Number.isInteger(maxItems)||maxItems<0||maxItems>24||!Array.isArray(casePackets)||casePackets.length>48)
    fail('CASE_WORK_INVALID_PLAN','A durable store, at most48packets and0..24work items are required');
  if(!measurementIdentity||Object.keys(measurementIdentity).sort().join(',')!=='engineSourceHashes,generatorSourceSha256'||
    !SHA.test(measurementIdentity.generatorSourceSha256||'')||!measurementIdentity.engineSourceHashes||
    !Object.keys(measurementIdentity.engineSourceHashes).length||Object.values(measurementIdentity.engineSourceHashes).some(v=>!SHA.test(v)))
    fail('CASE_WORK_INVALID_MEASUREMENT_IDENTITY','Measurement identity requires generator and engine hashes without operator metadata');
  const packets=casePackets.map(packetOf),seen=new Set();
  for(const packet of packets){const key=packet.propertyGroup+':'+packet.caseHash;if(seen.has(key)||seen.has('id:'+packet.caseId))fail('CASE_WORK_DUPLICATE_PACKET','Duplicate case evidence cannot create extra paid work');seen.add(key);seen.add('id:'+packet.caseId);}
  const measurementIdentityHash=hash(measurementIdentity),items=[],events=store.events();
  for(const packet of packets){
    membership(store,packet,measurementIdentityHash);
    if(packet.verification?.diagnosticPass!==false||!Array.isArray(packet.verification.issues))continue;
    for(const question of QUESTIONS){
      if(items.length>=maxItems)break;
      const issues=packet.verification.issues.filter(i=>question.codes.includes(i.code));if(!issues.length)continue;
      if(question.id==='spurious-roof-segment:v1'&&issues.every(i=>Array.isArray(i.detail)&&i.detail.every(e=>e.type==='obstruction')))continue;
      const workId='casework-'+hash({measurementIdentityHash,propertyGroup:packet.propertyGroup,caseHash:packet.caseHash,question:question.id}).slice(0,48);
      const {measurementSourceRevision,packetHash,sourceManifestHash,...stableEvidence}=packet;
      stableEvidence.inputHashes=packet.inputHashes.filter(ref=>ref!==sourceManifestHash);
      const evidenceHash=hash(stableEvidence);
      const prior=events.find(e=>e.kind==='case-work-item'&&e.detail.workId===workId);
      if(prior){const item=JSON.parse(store.readArtifact(prior.detail.itemHash));if(item.evidenceHash!==evidenceHash)fail('CASE_WORK_EVIDENCE_CONFLICT','Identical measurement/case identity now contains different numerical evidence');items.push(item);continue;}
      const artifact=store.putArtifact(Buffer.from(JSON.stringify(packet)));
      const item={workId,caseId:packet.caseId,propertyGroup:packet.propertyGroup,caseHash:packet.caseHash,questionId:question.id,
        instruction:question.instruction,packetArtifactHash:artifact.hash,measurementSourceRevision:packet.measurementSourceRevision,
        measurementIdentityHash,evidenceHash};
      const saved=store.putArtifact(Buffer.from(JSON.stringify(item)));store.event(null,'case-work-item',{workId,itemHash:saved.hash});items.push(item);
    }
  }
  const planHash=hash({protocol:CASE_WORK_PROTOCOL,measurementIdentityHash,items:items.map(i=>i.workId)});
  return {protocol:CASE_WORK_PROTOCOL,planHash,workflowId:'casebatch-'+planHash.slice(0,32),measurementIdentityHash,items};
}

function gate(store,model,now){
  for(const event of store.events()){
    if(['fleet-provider-circuit-open','cloud-provider-circuit-open','design-provider-circuit-open'].includes(event.kind))return 'PROVIDER_AUTH_RECONCILIATION_REQUIRED';
    if(['fleet-model-circuit-open','design-model-circuit-open'].includes(event.kind)&&event.detail?.model===model)return 'MODEL_RECONCILIATION_REQUIRED';
    if(['fleet-quota-cooldown','design-quota-cooldown'].includes(event.kind)&&event.detail?.notBefore>now)return 'RATE_LIMIT_COOLDOWN';
  }
  return null;
}
function fresh(value,now){const ms=Date.parse(value?.checkedAt||'');return Number.isFinite(ms)&&ms<=now&&now-ms<=10*60000;}
export function qualifyCaseWorkers({store,catalog=MODEL_CATALOG,roster,catalogAudit,now=Date.now}={}){
  if(!store)fail('CASE_WORK_STORE_REQUIRED','Model qualification requires original durable evidence');
  const workers=[],excluded=[],families=new Map(buildFleetAssignments(catalog).map(r=>[r.model,r]));
  for(const entry of catalog.filter(e=>e.billingTier==='free-allowance')){
    const model=entry.id,assignment=families.get(model),proofFailures=[];
    let reason=gate(store,model,now());
    if(!reason&&(!fresh(roster,now())||!roster.ids?.includes(model)))reason='MODEL_ABSENT_OR_STALE_ROSTER';
    if(!reason&&(catalogAudit?.status!=='verified'||!fresh(catalogAudit,now())||catalogAudit.issuesByModel?.[model]))reason='PUBLIC_CATALOG_UNVERIFIED';
    if(!reason&&(!model.startsWith('free/')||entry.inputPerMillion!==0||entry.outputPerMillion!==0||!assignment?.mayReview||assignment.contributionKind!=='structured-review'))reason='ROLE_PROTOCOL_NOT_ELIGIBLE';
    if(reason){excluded.push({model,code:reason});continue;}
    for(const role of ['engineering','critique']){
      const candidates=store.listTasks().filter(t=>t.role===role&&t.result?.primaryValidated===true&&['complete','needs-human','rejected'].includes(t.status)).sort((a,b)=>b.updatedAt-a.updatedAt);
      for(const task of candidates)try{
        const attempts=store.ledger(task.id).attempts,events=store.events(task.id);
        if(!attempts.some(a=>a.reserve_usd===0&&events.some(e=>e.kind==='dispatched'&&e.detail.attemptId===a.id)))continue;
        const response=JSON.parse(store.readArtifact(task.result.resultHash));
        if(response.execution?.requestedModel!==model||response.execution?.returnedModel!==model||!response.result||
          response.execution?.settings?.route!=='chat/completions'||response.execution.settings.responseFormat!=='json_object'||
          !['json','sse','json-response-to-stream-request'].includes(response.execution.transport)||!bounded(response.execution.promptVersion))continue;
        const {actorId,...raw}=response.result;if(actorId!==undefined&&actorId!==task.actorId)continue;
        // Decoded queue rows also contain status/lease/result metadata, which is
        // not part of the immutable strict model-task contract.
        const originalTask=JSON.parse(store.db.prepare('SELECT body FROM tasks WHERE id=?').get(task.id).body);
        const validated=validateResult(raw,originalTask);
        let context=null;
        for(const ref of task.artifacts||[]){if(!task.inputHashes.includes(ref))continue;try{const value=JSON.parse(store.readArtifact(ref));if(value.trustedMetricFacts&&value.metrics){context=value;break;}}catch{}}
        if(!context||task.constraints?.requireMetricClaims!==true)continue;
        noHeldout(context);const facts=buildMetricFacts(context);validateMetricClaims(validated.metricClaims,facts);
        workers.push({model,role,family:assignment.family,qualificationTaskId:task.id,qualificationResultHash:task.result.resultHash});break;
      }catch(error){proofFailures.push({taskId:task.id,code:error.code||'INVALID_QUALIFICATION_EVIDENCE',message:String(error.message).slice(0,160)});}
    }
    if(!workers.some(w=>w.model===model))excluded.push({model,code:'NO_HASH_VERIFIED_ROLE_EVIDENCE',proofFailures:proofFailures.slice(0,3)});
  }
  return {workers,excluded};
}

function ledgerAggregate(store){const a=store.allowanceLedger();return Object.fromEntries(['requests','reservedUnits','reportedUnits','estimatedUnits','unknownAllowanceRequests','unknownUnits','pendingUnits','rollingDayUnits','rollingWeekUnits','incident','limits'].map(k=>[k,a[k]]));}
function validateEvidence(result,refs){for(const finding of result.findings)if(finding.evidence.some(ref=>!refs.has(ref)))fail('CASE_WORK_EVIDENCE_MISMATCH','Proposal cited evidence outside its immutable case packet');}
function exactRoleResponse(response,model){return response?.execution?.requestedModel===model&&response.execution.returnedModel===model&&response.result&&
  response.execution.settings?.route==='chat/completions'&&response.execution.settings.responseFormat==='json_object'&&
  ['json','sse','json-response-to-stream-request'].includes(response.execution.transport)&&bounded(response.execution.promptVersion);}

export async function runCaseWorkQueue({store,plan,sourceRevision,apiKey=process.env.APINEX_API_KEY,paidAllowed=false,
  requestRole=requestOrganizationRole,checkpoint=async()=>{},now=Date.now,signal,catalog=MODEL_CATALOG,roster=null,catalogAudit=null,
  verifyModels=verifyRoster,catalogAuditor=auditModelCatalog,limits={},runtimeMs=60*60000,minimumDispatchIntervalMs=4200,
  waitImpl=(ms,options)=>wait(ms,null,options)}={}){
  if(!store||plan?.protocol!==CASE_WORK_PROTOCOL||!Array.isArray(plan.items)||plan.items.length>24||!bounded(sourceRevision)||
    plan.planHash!==hash({protocol:CASE_WORK_PROTOCOL,measurementIdentityHash:plan.measurementIdentityHash,items:plan.items.map(i=>i.workId)}))fail('CASE_WORK_INVALID_PLAN','An immutable bounded case-work plan is required');
  store.recover();store.setControl('running');
  const backlogIds=new Set(),backlog=[];
  for(const old of store.listTasks().filter(t=>t.attempts<2&&(t.status==='failed'&&t.result?.retryableUndispatched===true||t.status==='pending'&&['case-work-author','case-work-review'].includes(t.stage)))){
    if(store.events(old.id).some(e=>e.kind==='dispatched')||store.ledger(old.id).attempts.some(a=>['dispatched','unknown','settled'].includes(a.state)))continue;
    const binding=store.events().find(e=>e.kind==='case-work-assigned'&&(()=>{const a=JSON.parse(store.readArtifact(e.detail.assignmentHash));return a.authorTaskId===old.id||a.reviewTaskId===old.id;})());
    if(!binding||backlogIds.has(binding.detail.workId))continue;
    const saved=store.events().find(e=>e.kind==='case-work-item'&&e.detail.workId===binding.detail.workId);if(!saved)continue;
    backlog.push(JSON.parse(store.readArtifact(saved.detail.itemHash)));backlogIds.add(binding.detail.workId);if(backlog.length>=24)break;
  }
  const items=[...backlog,...plan.items.filter(i=>!backlogIds.has(i.workId))].slice(0,24);
  const budget={requestLimit:Math.min(48,items.length*4),maxUsd:0,hourUsd:3,dayUsd:3,weekUsd:20,monthUsd:80,...limits};
  if(budget.maxUsd!==0||!Number.isInteger(budget.requestLimit)||budget.requestLimit<0||budget.requestLimit>48||budget.hourUsd>3||budget.dayUsd>3||budget.weekUsd>20||budget.monthUsd>80||Object.values(budget).some(n=>!Number.isFinite(n)||n<0))fail('CASE_WORK_INVALID_LIMIT','Case work is bounded to48zero-dollar calls and existing account limits');
  if(!Number.isInteger(runtimeMs)||runtimeMs<0||runtimeMs>60*60000||!Number.isFinite(minimumDispatchIntervalMs)||minimumDispatchIntervalMs<0||minimumDispatchIntervalMs>10000)fail('CASE_WORK_INVALID_LIMIT','Invalid bounded runtime or dispatch pacing');
  const deadline=now()+runtimeMs,timeout=AbortSignal.timeout(Math.max(1,runtimeMs)),queueSignal=signal?AbortSignal.any([signal,timeout]):timeout;
  let setupError=null;
  if(paidAllowed&&apiKey&&runtimeMs>=120000)try{
    reconcileLegacyFreeAllowance(store);
    if(!roster||!fresh(roster,now())||now()-Date.parse(roster.checkedAt)>8*60000)roster=await verifyModels({apiKey,signal:queueSignal});
    if(!catalogAudit||!fresh(catalogAudit,now())||now()-Date.parse(catalogAudit.checkedAt)>8*60000)catalogAudit=await catalogAuditor({signal:queueSignal});
  }catch(error){setupError=error.code||'CASE_WORK_ADMISSION_UNAVAILABLE';}
  const qualification=qualifyCaseWorkers({store,catalog,roster,catalogAudit,now}),workItems=[];
  const workers=qualification.workers,workerId='case-work-worker';
  let dispatches=0;
  function quarantinePending(taskId,reason){
    const task=store.getTask(taskId);
    if(task?.status!=='pending'||!['case-work-author','case-work-review'].includes(task.stage)||store.events(taskId).some(e=>e.kind==='dispatched')||
      store.ledger(taskId).attempts.some(a=>['dispatched','unknown','settled'].includes(a.state)))return false;
    const cancelled=store.cancel(taskId,{onlyUndispatchedPending:true});if(!cancelled)return false;
    store.event(taskId,'case-work-undispatched-quarantined',{reason,scope:'Original own case-work assignment; no dispatched request was cancelled'});return true;
  }
  async function execute(item,assignment,kind,author=null){
    const model=kind==='author'?assignment.author.model:assignment.reviewer.model,taskId=kind==='author'?assignment.authorTaskId:assignment.reviewTaskId;
    const old=store.getTask(taskId);
    const resumable=(old?.status==='pending'&&old.notBefore<=now()||old?.status==='failed'&&old.result?.retryableUndispatched===true&&old.result.retryNotBefore<=now())&&old.attempts<2&&
      !store.events(taskId).some(e=>e.kind==='dispatched')&&!store.ledger(taskId).attempts.some(a=>['dispatched','unknown','settled'].includes(a.state));
    if(old&&!resumable){
      const recorded={...(old.result||{}),taskId,model,kind,status:old.status,reused:true,attempted:store.events(taskId).some(e=>e.kind==='dispatched')};
      if(old.status!=='complete')recorded.primaryValidated=false;
      if(old.status==='pending'||old.result?.retryableUndispatched){recorded.status='deferred';recorded.code=old.error||'CASE_WORK_ADMISSION_DEFERRED';}
      if(old.status==='pending')recorded.quarantined=quarantinePending(taskId,recorded.code);
      const quarantined=store.events(taskId).find(e=>e.kind==='case-work-undispatched-quarantined');if(quarantined){recorded.code=quarantined.detail.reason;recorded.quarantined=true;}
      if(recorded.primaryValidated)try{
        const originalTask=JSON.parse(store.db.prepare('SELECT body FROM tasks WHERE id=?').get(taskId).body),response=JSON.parse(store.readArtifact(recorded.resultHash));
        if(!exactRoleResponse(response,model)||!recorded.attempted)fail('CASE_WORK_STORED_EVIDENCE_INVALID','Stored response lacks exact protocol and dispatch proof');
        const {actorId,...raw}=response.result;if(actorId!==undefined&&actorId!==originalTask.actorId)fail('ACTOR_IDENTITY_MISMATCH','Stored actor differs');
        const result=validateResult(raw,originalTask),context=JSON.parse(store.readArtifact(originalTask.artifacts[0]));
        validateMetricClaims(result.metricClaims,buildMetricFacts(context));validateEvidence(result,new Set(context.evidenceRefs));
        if(author&&(result.peerReview?.taskId!==author.taskId||assignment.author.family===assignment.reviewer.family))fail('CASE_WORK_INDEPENDENT_REVIEW_MISMATCH','Stored critique does not bind this author');
      }catch{recorded.primaryValidated=false;recorded.status='failed';recorded.code='CASE_WORK_STORED_EVIDENCE_INVALID';}
      return recorded;
    }
    const row={taskId,model,kind,status:'deferred',attempted:false,primaryValidated:false,resultHash:null,code:null};
    const defer=code=>{row.code=code;if(old?.status==='pending')row.quarantined=quarantinePending(taskId,code);return row;};
    if(!paidAllowed||!apiKey)return defer(!paidAllowed?'CHECKPOINT_LINEAGE_BLOCKED':'CLOUD_SECRET_NOT_CONFIGURED');
    if(setupError)return defer(setupError);
    if(queueSignal.aborted||now()+120000>deadline)return defer('CASE_WORK_RUNTIME_LIMIT');
    try{
      if(now()-Date.parse(roster?.checkedAt||'')>8*60000)roster=await verifyModels({apiKey,signal:queueSignal});
      if(now()-Date.parse(catalogAudit?.checkedAt||'')>8*60000)catalogAudit=await catalogAuditor({signal:queueSignal});
    }catch(error){setupError=error.code||'CASE_WORK_ADMISSION_REFRESH_FAILED';return defer(setupError);}
    const freshWorkers=qualifyCaseWorkers({store,catalog,roster,catalogAudit,now}).workers;
    if(!freshWorkers.some(w=>w.model===model&&w.role===(kind==='author'?'engineering':'critique')))return defer('ASSIGNED_MODEL_NO_LONGER_QUALIFIED');
    if(dispatches>=budget.requestLimit)return defer('CASE_WORK_REQUEST_LIMIT');
    const packet=packetOf(JSON.parse(store.readArtifact(item.packetArtifactHash))),facts=buildMetricFacts(packet);
    const evidenceRefs=['case','verification','actual','reportObservation',...packet.inputHashes.map(h=>'sha256:'+h)];
    const context={protocol:CASE_WORK_PROTOCOL,scope:'development-only synthetic engineering proposal; no field truth or release authority',
      question:{id:item.questionId,instruction:item.instruction},caseId:item.caseId,propertyGroup:item.propertyGroup,metrics:packet.metrics,pdfReview:packet.pdfReview,
      verification:packet.verification,actual:packet.actual,reportObservation:packet.reportObservation??null,trustedMetricFacts:facts,evidenceRefs,
      instruction:'Use only supplied evidenceRefs in findings. Propose a concrete hypothesis and a minimal deterministic regression; do not restate locally computed facts as completed work. No code changes or tests were executed by this model.',
      ...(author?{peerReviewTarget:{taskId:author.taskId,model:author.model,resultHash:author.resultHash,contribution:JSON.parse(store.readArtifact(author.resultHash)).result,
        instruction:'Challenge this exact engineering proposal against the same case evidence. A peer opinion cannot fix the failing diagnostic or approve release.'}}:{})};
    const contextArtifact=store.putArtifact(Buffer.from(JSON.stringify(context)));
    const task={schemaVersion:1,id:taskId,workflowId:assignment.workflowId,maxAttempts:2,role:kind==='author'?'engineering':'critique',
      actorId:'casework-'+kind+'-'+hash(model).slice(0,16),sourceRevision:item.measurementSourceRevision,datasetRevision:CASE_WORK_PROTOCOL,
      candidateHash:hash({workId:item.workId,evidenceHash:item.evidenceHash}),policyVersion:CASE_WORK_PROTOCOL,
      inputHashes:[...new Set([...packet.inputHashes,item.packetArtifactHash,contextArtifact.hash,...(author?[author.resultHash]:[])])],artifacts:[contextArtifact.hash],stage:'case-work-'+kind,
      constraints:{maxAttempts:2,maxRuntimeMs:120000,maxOutputTokens:8000,sourceHashes:[item.packetArtifactHash],requireMetricClaims:true,
        ...(author?{reviewTaskId:author.taskId}:{})}};
    let lease=null,heartbeat=null,rawHash=null;
    const abort=new AbortController(),callSignal=AbortSignal.any([queueSignal,abort.signal]);
    try{
      if(store.listTasks().some(t=>t.id!==task.id&&(t.status==='leased'||t.status==='pending'&&t.notBefore<=now())))fail('CASE_WORK_QUEUE_RECONCILIATION_REQUIRED','Prior due queue work requires reconciliation');
      if(resumable&&old.status==='failed')store.retryFailed(task.id,{operatorId:'case-work-admission-recovery',evidence:'The original durable assignment and artifact bind a transient admission failure; no dispatch/unknown/settled inference attempt exists; this is the final bounded acquisition.'});
      store.enqueue(task);lease=store.claim(workerId,{leaseMs:120000});if(lease?.id!==task.id)fail('CASE_WORK_LEASE_UNAVAILABLE','Case-work lease is unavailable');
      heartbeat=setInterval(()=>{try{if(store.getControl()==='stopped')abort.abort();else store.heartbeat(task.id,workerId,lease.fence,120000);}catch{abort.abort();}},15000);
      const last=store.events().filter(e=>['fleet-dispatched','design-dispatched','case-work-dispatched'].includes(e.kind)).at(-1)?.created;
      const delay=last==null?0:Math.max(0,last+minimumDispatchIntervalMs-now());if(delay)await waitImpl(delay,{signal:callSignal});
      const response=await requestRole(task,{model,apiKey,context,signal:callSignal,timeoutMs:120000,verifiedRoster:roster,
        reserve:async({usd,allowance})=>{
          if(usd!==0||allowance?.reservedUnits!==textAllowanceReservationUnits(model,8000))fail('CASE_WORK_ALLOWANCE_REQUIRED','Exact free-model weighted reservation is required');
          const id=store.reserve(task.id,workerId,lease.fence,{usd,...budget,allowance});await checkpoint({phase:'case-work-reserved',taskId:task.id,model});return id;
        },
        onDispatch:async id=>{
          if(dispatches>=budget.requestLimit||queueSignal.aborted||now()+120000>deadline)fail('CASE_WORK_RUNTIME_OR_REQUEST_LIMIT','Case-work dispatch limit reached');
          store.dispatch(id,workerId,lease.fence,{beforeDispatch:()=>{const reason=gate(store,model,now());if(reason)fail(reason,'Persisted provider policy blocks this assignment');store.event(task.id,'case-work-dispatched',{model,workId:item.workId,kind});}});
          row.attempted=true;dispatches++;await checkpoint({phase:'case-work-dispatched',taskId:task.id,model});
        },
        onUsage:async(id,usage)=>{store.settle(id,workerId,lease.fence,usage);await checkpoint({phase:'case-work-settled',taskId:task.id,model});},
        onResponse:record=>{rawHash=store.putArtifact(Buffer.from(JSON.stringify(record))).hash;}});
      row.resultHash=store.putArtifact(Buffer.from(JSON.stringify(response))).hash;
      if(!row.attempted)fail('DISPATCH_EVIDENCE_MISSING','Adapter output is not evidence of a model dispatch');
      if(!exactRoleResponse(response,model))fail('MODEL_MISMATCH','Original structured response must match the assigned model and role protocol');
      const {actorId,...raw}=response.result;if(actorId!==undefined&&actorId!==task.actorId)fail('ACTOR_IDENTITY_MISMATCH','Response actor differs from the assignment');
      const result=validateResult(raw,task);validateMetricClaims(result.metricClaims,facts);validateEvidence(result,new Set(evidenceRefs));
      if(author&&(!result.peerReview||result.peerReview.taskId!==author.taskId||assignment.author.family===assignment.reviewer.family||assignment.author.model===model))fail('CASE_WORK_INDEPENDENT_REVIEW_MISMATCH','A different named family must review the exact author task');
      Object.assign(row,{status:'complete',primaryValidated:true,decision:result.decision,peerReviewDecision:result.peerReview?.decision??null,summary:result.summary,execution:response.execution,rawResponseHash:rawHash});
      store.finish(task.id,workerId,lease.fence,{status:'complete',result:row});
    }catch(error){
      row.status='failed';row.primaryValidated=false;row.code=error.code||'CASE_WORK_FAILED';row.rawResponseHash=rawHash;
      if(lease?.id===task.id)try{
        const transient=['NETWORK_ERROR','TIMEOUT','ALLOWANCE_STALE','ALLOWANCE_SNAPSHOT_STALE','ALLOWANCE_EXHAUSTED','ALLOWANCE_LIMIT','BUDGET_LIMIT','CASE_WORK_RUNTIME_OR_REQUEST_LIMIT'].includes(row.code)||
          row.code==='UPSTREAM_HTTP'&&(error.status===429||error.status>=500&&error.status<=599);
        const unsent=!store.events(task.id).some(e=>e.kind==='dispatched')&&!store.ledger(task.id).attempts.some(a=>['dispatched','unknown','settled'].includes(a.state));
        if(transient&&unsent&&lease.attempts<2){row.status='deferred';row.retryableUndispatched=true;row.retryNotBefore=now()+Math.max(60000,error.retryAfterMs||0);}
        store.finish(task.id,workerId,lease.fence,{status:'failed',result:row,error:row.code});
      }catch{row.code='CASE_WORK_LEASE_RECONCILIATION_REQUIRED';store.recover();}
      if(error.status===401)store.event(null,'fleet-provider-circuit-open',{status:401,code:row.code});
      else if([400,403].includes(error.status)||row.code==='MODEL_MISMATCH')store.event(null,'fleet-model-circuit-open',{model,status:error.status??null,code:row.code});
      if(error.status===429)store.event(null,'fleet-quota-cooldown',{scope:error.quotaScope||'provider',notBefore:now()+Math.max(60000,error.retryAfterMs||0)});
    }finally{if(heartbeat)clearInterval(heartbeat);await checkpoint({phase:'case-work-finished',taskId:task.id,model});}
    return row;
  }
  for(const item of items){
    const savedItem=store.events().find(e=>e.kind==='case-work-item'&&e.detail.workId===item.workId);
    if(!savedItem||hash(JSON.parse(store.readArtifact(savedItem.detail.itemHash)))!==hash(item))fail('CASE_WORK_ITEM_MISMATCH','Plan item differs from its immutable stored question');
    const packet=packetOf(JSON.parse(store.readArtifact(item.packetArtifactHash)));
    membership(store,packet,item.measurementIdentityHash);
    if(packet.caseHash!==item.caseHash||packet.propertyGroup!==item.propertyGroup||!backlogIds.has(item.workId)&&item.measurementIdentityHash!==plan.measurementIdentityHash)fail('CASE_WORK_ITEM_MISMATCH','Plan item differs from its saved case packet');
    let assignment;
    const prior=store.events().find(e=>e.kind==='case-work-assigned'&&e.detail.workId===item.workId);
    if(prior)assignment=JSON.parse(store.readArtifact(prior.detail.assignmentHash));
    else{
      const assignments=store.events().filter(e=>e.kind==='case-work-assigned').map(e=>JSON.parse(store.readArtifact(e.detail.assignmentHash)));
      const leastLoaded=(role,filter=()=>true)=>workers.filter(w=>w.role===role&&filter(w)).sort((a,b)=>
        assignments.filter(x=>(role==='engineering'?x.author:x.reviewer)?.model===a.model).length-
        assignments.filter(x=>(role==='engineering'?x.author:x.reviewer)?.model===b.model).length||a.model.localeCompare(b.model))[0];
      const author=leastLoaded('engineering'),reviewer=author?leastLoaded('critique',w=>w.model!==author.model&&w.family!==author.family):null;
      if(!author){workItems.push({...item,state:'awaiting-qualified-author',code:setupError||'NO_QUALIFIED_ENGINEERING_MODEL'});continue;}
      assignment={workId:item.workId,workflowId:plan.workflowId,author,reviewer,operatorSourceRevision:sourceRevision,measurementSourceRevision:item.measurementSourceRevision,
        authorTaskId:item.workId+'-author',reviewTaskId:item.workId+'-review'};
      const artifact=store.putArtifact(Buffer.from(JSON.stringify(assignment)));store.event(null,'case-work-assigned',{workId:item.workId,assignmentHash:artifact.hash});
      await checkpoint({phase:'case-work-assigned',workId:item.workId,model:author.model});
    }
    const author=await execute(item,assignment,'author');let reviewer=null,state='author-failed';
    if(author.primaryValidated&&!assignment.reviewer){
      // A later qualified critic may attach once to an already completed author.
      // An existing reviewer assignment/task is never silently replaced.
      assignment=store.transaction(()=>{
        const attached=store.events().find(e=>e.kind==='case-work-review-assigned'&&e.detail.workId===item.workId);
        if(attached){
          const saved=JSON.parse(store.readArtifact(attached.detail.attachmentHash));
          if(saved.authorTaskId!==author.taskId||saved.authorResultHash!==author.resultHash)fail('CASE_WORK_REVIEW_ATTACHMENT_CONFLICT','Reviewer attachment differs from the original author evidence');
          return {...assignment,reviewer:saved.reviewer};
        }
        if(store.getTask(assignment.reviewTaskId))return assignment;
        const pool=qualifyCaseWorkers({store,catalog,roster,catalogAudit,now}).workers.filter(w=>w.role==='critique'&&w.model!==assignment.author.model&&w.family!==assignment.author.family);
        const previous=store.events().filter(e=>e.kind==='case-work-review-assigned').map(e=>JSON.parse(store.readArtifact(e.detail.attachmentHash)));
        pool.sort((a,b)=>previous.filter(x=>x.reviewer.model===a.model).length-previous.filter(x=>x.reviewer.model===b.model).length||a.model.localeCompare(b.model));
        if(!pool.length)return assignment;
        const saved={workId:item.workId,authorTaskId:author.taskId,authorResultHash:author.resultHash,reviewTaskId:assignment.reviewTaskId,reviewer:pool[0]};
        const artifact=store.putArtifact(Buffer.from(JSON.stringify(saved)));store.event(null,'case-work-review-assigned',{workId:item.workId,attachmentHash:artifact.hash});
        return {...assignment,reviewer:pool[0]};
      });
      if(assignment.reviewer)await checkpoint({phase:'case-work-review-assigned',workId:item.workId,model:assignment.reviewer.model});
    }
    if(author.primaryValidated){state='awaiting-independent-review';if(assignment.reviewer){reviewer=await execute(item,assignment,'review',author);if(reviewer.primaryValidated)state=reviewer.peerReviewDecision==='pass'?'independently-reviewed-proposal':'revision-required';}}
    else if(author.status==='deferred')state='author-deferred';
    workItems.push({...item,state,assignment,author,reviewer,backlog:backlogIds.has(item.workId),productionReleaseApproved:false});
  }
  const tasks=workItems.flatMap(i=>[i.author,i.reviewer].filter(Boolean)),actual=tasks.filter(t=>t.attempted),unique=[...new Set(actual.map(t=>t.model))];
  const ledger=store.ledger();
  return {protocol:CASE_WORK_PROTOCOL,planHash:plan.planHash,sourceRevision,measurementIdentityHash:plan.measurementIdentityHash,workItems,
    models:unique.map(model=>({model,taskCount:actual.filter(t=>t.model===model).length,validatedTaskCount:actual.filter(t=>t.model===model&&t.primaryValidated).length})),
    counts:{uniqueModels:unique.length,workItems:workItems.length,authorTasks:tasks.filter(t=>t.kind==='author').length,reviewTasks:tasks.filter(t=>t.kind==='review').length,
      dispatchedTasks:actual.length,newDispatches:dispatches,validatedTasks:actual.filter(t=>t.primaryValidated).length,
      independentlyReviewed:workItems.filter(i=>i.reviewer?.primaryValidated===true).length,
      acceptedProposals:workItems.filter(i=>i.state==='independently-reviewed-proposal').length,
      awaitingIndependentReview:workItems.filter(i=>i.state==='awaiting-independent-review').length,failed:tasks.filter(t=>t.status==='failed').length},
    qualification,budget:{...budget,totalRequests:ledger.requests,reportedUsd:ledger.reportedUsd,committedUsd:ledger.reservedUsd,unknownBillingRequests:ledger.unknownBillingRequests},
    allowance:ledgerAggregate(store),productionReleaseApproved:false,fieldAccuracyValidated:false,
    scope:'Development-only engineering proposals and independent model critique; no measurement fix, code change, test execution or release is claimed'};
}
