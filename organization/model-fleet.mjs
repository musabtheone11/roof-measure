import {MODEL_CATALOG,CATALOG_METADATA,getVerifiedModelPrice} from './model-catalog.mjs';
import {verifyRoster,requestOrganizationRole} from './provider.mjs';
import {validateResult} from './contracts.mjs';
import {createHash} from 'node:crypto';
import {setTimeout as wait} from 'node:timers/promises';

export const FLEET_PROTOCOL='apinex-model-fleet-v1';
export const FLEET_LIMITS=Object.freeze({requestLimit:64,maxUsd:3,hourUsd:3,dayUsd:3,weekUsd:20,monthUsd:80});
export class FleetError extends Error {constructor(code,message){super(message);this.name='FleetError';this.code=code;}}
const fail=(code,message)=>{throw new FleetError(code,message);};
const hash=value=>createHash('sha256').update(typeof value==='string'?value:JSON.stringify(value)).digest('hex');
const own=(value,key)=>Object.hasOwn(value,key);
const clone=value=>JSON.parse(JSON.stringify(value));
const text=(value,max=200)=>typeof value==='string'&&value.length>0&&value.length<=max;
const roleByTeam={'roof engineering':'engineering','real-case testing':'verification',extraction:'extraction','reference data':'reference','independent critique':'critique',reporting:'reporting',operations:'operations'};
const familyOf=(entry,assignment)=>assignment?.canonicalFamily||String(entry.family||entry.provider||entry.id).toLowerCase().replace(/^free\//,'').replace(/[^a-z0-9]+/g,'-');
function routeOf(entry){return entry.routeClaim==='decisions'||['drex-v2.0','jev-1.13'].includes(entry.id)?'decisions':'chat-completions';}

/** Numeric claims bind only supplied deterministic facts; prose remains advisory. */
export function buildMetricFacts(context={}) {
  const facts={};
  function visit(value,prefix,depth=0){
    if(depth>7)fail('FACT_MAP_LIMIT','Metric nesting exceeds the bounded fact contract');
    if(typeof value==='number'){
      if(!Number.isFinite(value))fail('INVALID_TRUSTED_FACT','Trusted metric contains a nonfinite number');
      if(!/^[-a-zA-Z0-9_.]{1,160}$/.test(prefix))fail('INVALID_TRUSTED_FACT','Trusted metric key is not a bounded fact ID');
      facts[prefix]=value;
    }else if(value&&typeof value==='object'&&!Array.isArray(value))for(const [key,item]of Object.entries(value)){
      // Count and split facts are the release-relevant compact contract. Full
      // distribution statistics remain supplied evidence, not required echoes.
      if(prefix==='metrics'&&['absoluteEdgeErrorFt','absoluteAreaErrorPct','perEdgeType'].includes(key))continue;
      visit(item,prefix+'.'+key,depth+1);
    }
  }
  visit(context.metrics||{},'metrics');
  const attempted=context.metrics?.attempted,passed=context.metrics?.diagnosticPasses;
  if(Number.isFinite(attempted)&&Number.isFinite(passed)){
    if(attempted<0||passed<0||passed>attempted)fail('INVALID_TRUSTED_FACT','Diagnostic counts are inconsistent');
    const required=attempted-passed;
    if(own(facts,'metrics.reviewRequired')&&facts['metrics.reviewRequired']!==required)fail('TRUSTED_FACT_CONTRADICTION','Review-required count conflicts with attempted minus diagnostic passes');
    facts['metrics.reviewRequired']=required;
  }
  for(const key of ['checked','failed'])if(context.pdfReview?.[key]!==undefined){
    const value=context.pdfReview[key];if(!Number.isFinite(value)||value<0)fail('INVALID_TRUSTED_FACT','Invalid PDF count');facts['pdfReview.'+key]=value;
  }
  if(Object.keys(facts).length>100)fail('FACT_MAP_LIMIT','More than100 numeric facts requires a narrower scoped packet');
  return Object.freeze(facts);
}
export function validateMetricClaims(claims,facts) {
  if(!claims||typeof claims!=='object'||Array.isArray(claims))fail('METRIC_CLAIMS_MISMATCH','Typed metric claims are missing');
  const expected=Object.keys(facts).sort(),actual=Object.keys(claims).sort();
  if(JSON.stringify(expected)!==JSON.stringify(actual)||expected.some(key=>!Number.isFinite(claims[key])||claims[key]!==facts[key]))
    fail('METRIC_CLAIMS_MISMATCH','Typed model claims disagree with the scoped deterministic evidence');
  return true;
}
function validateDevelopmentContext(context) {
  function scan(value,key='',depth=0){
    if(depth>16)fail('CONTEXT_LIMIT','Development packet nesting exceeds limit');
    if(!value||typeof value!=='object')return;
    if(value.split==='holdout'||value.split==='validation')fail('HOLDOUT_LEAKAGE_BLOCKED','Primary model packets are development-only');
    if(key==='splits'&&((value.holdout?.cases||value.holdout?.propertyFamilies||0)>0||(value.validation?.cases||value.validation?.propertyFamilies||0)>0))
      fail('HOLDOUT_LEAKAGE_BLOCKED','Primary metrics contain validation or holdout rows');
    for(const [child,item]of Object.entries(value))scan(item,child,depth+1);
  }
  scan(context);
}
function metadata(catalog) {
  const models=Array.isArray(catalog)?catalog:catalog?.models;
  if(!Array.isArray(models)||models.length<1||models.length>10000||models.some(m=>!text(m?.id))||new Set(models.map(m=>m.id)).size!==models.length)
    fail('INVALID_FLEET_CATALOG','Catalog must contain unique bounded exact model IDs');
  return {models,checkedAt:catalog?.checkedAt||CATALOG_METADATA.checkedAt,catalogHash:hash(models)};
}
export function buildFleetAssignments(catalog=MODEL_CATALOG,{events=[]}={}) {
  const {models}=metadata(catalog),assigned=new Map(ASSIGNMENT_ROWS.map(row=>[row.model,row]));
  const lastDispatch=new Map();for(const event of events)if(event.kind==='fleet-dispatched'&&text(event.detail?.model))lastDispatch.set(event.detail.model,Math.max(lastDispatch.get(event.detail.model)||0,event.created||0));
  const rows=models.map(entry=>{
    const known=assigned.get(entry.id),fallbackTeams=Object.keys(roleByTeam),team=known?.team||fallbackTeams[parseInt(hash(entry.id).slice(0,8),16)%fallbackTeams.length];
    return {model:entry.id,team,role:roleByTeam[team],task:known?known.assignment+': '+known.task:
      'Qualify the exact model on a bounded '+team+' review using supplied development evidence; identify unsupported claims and concrete verification steps.',
      acceptance:known?.acceptance||'Strict contract, exact metric claims, cited source evidence and explicit uncertainty.',
      reviewerModel:known?.reviewer||null,family:familyOf(entry,known),
      mayReview:known?.mayActAsIndependentReviewer!==false&&routeOf(entry)!=='decisions',
      contributionKind:routeOf(entry)==='decisions'?'typed-decision':'structured-review',lastDispatched:lastDispatch.get(entry.id)||0};
  });
  const preferred=rows.find(row=>row.model==='claude-opus-5.5'&&row.mayReview)||[...rows].sort((a,b)=>a.model.localeCompare(b.model)).find(row=>row.mayReview);
  if(preferred){preferred.role='ceo';preferred.team='executive review';preferred.task='Audit deterministic aggregate metrics and validated specialist findings, prioritize actionable changes, and reject unsupported acceptance. No numeric, quota or release gate can be overridden.';}
  return rows.sort((a,b)=>(a===preferred?1:0)-(b===preferred?1:0)||a.lastDispatched-b.lastDispatched||a.model.localeCompare(b.model));
}
function limitsOf(limits,count) {
  const result={...FLEET_LIMITS,...limits};
  for(const [key,value]of Object.entries(result))if(!own(FLEET_LIMITS,key)||!Number.isFinite(value)||value<0)fail('INVALID_FLEET_LIMIT','Invalid fleet limit');
  if(!Number.isInteger(result.requestLimit)||result.requestLimit>64||result.weekUsd>20||result.monthUsd>80)fail('INVALID_FLEET_LIMIT','Fleet request or authorized spending ceiling exceeded');
  result.requestLimit=Math.min(result.requestLimit,Math.max(0,count*2));return result;
}
function hasDispatched(store,id){return store.events(id).some(event=>event.kind==='dispatched');}
function cost(store,id){const ledger=store.ledger(id);return {reportedUsd:ledger.unknownBillingRequests?null:ledger.reportedUsd,unknownBillingRequests:ledger.unknownBillingRequests};}
function priceOf(entry){
  const published=getVerifiedModelPrice(entry.id);
  if(published)return published;
  if(entry.pricingStatus!=='verified-published'||!Number.isInteger(entry.contextTokens)||entry.contextTokens<128||
    ![entry.inputPerMillion,entry.outputPerMillion].every(n=>Number.isFinite(n)&&n>=0))return null;
  return {...entry,maxRate:Math.max(entry.inputPerMillion,entry.outputPerMillion)};
}
function budgetCheck(store,workflowId,usd,limits,now) {
  const ledger=store.ledger();if(ledger.budgetIncident)return 'BUDGET_INCIDENT';
  const attempts=ledger.attempts,work=attempts.filter(a=>a.workflow_id===workflowId),sum=rows=>rows.reduce((s,a)=>s+a.charged_usd,0);
  const day=new Date(now),month=Date.UTC(day.getUTCFullYear(),day.getUTCMonth(),1);
  if(work.length>=limits.requestLimit)return 'CYCLE_REQUEST_LIMIT';
  if(sum(work)+usd>limits.maxUsd||sum(attempts.filter(a=>a.created>=now-3600000))+usd>limits.hourUsd||
    sum(attempts.filter(a=>a.created>=now-86400000))+usd>limits.dayUsd||sum(attempts.filter(a=>a.created>=now-7*86400000))+usd>limits.weekUsd||
    sum(attempts.filter(a=>a.created>=month))+usd>limits.monthUsd)return 'BUDGET_LIMIT';
  return null;
}
function minimalAgent(row){return {model:row.model,team:row.team,role:row.role,status:row.status,code:row.code||null,decision:row.decision||null,
  reviewStatus:row.reviewStatus,taskId:row.taskId,resultHash:row.resultHash||null,summary:row.summary?.slice(0,400)||null};}

/** All inference is explicit, sequential, durably reserved and supplied through requestRole. */
export async function runModelFleet({store,catalog=MODEL_CATALOG,evaluationHash,sourceRevision,inputHash,
  developmentContext={},aggregateContext={},paidAllowed=false,apiKey=process.env.APINEX_API_KEY,
  requestRole=requestOrganizationRole,verifyModels=verifyRoster,checkpoint=async()=>{},limits={},now=Date.now,signal,
  minimumDispatchIntervalMs=4200,waitImpl=(ms,options)=>wait(ms,null,options),runtimeMs=40*60000,catalogAudit}={}) {
  if(!text(evaluationHash,200)||!text(sourceRevision,200)||!/^([a-f0-9]{64})$/.test(inputHash||''))fail('INVALID_FLEET_INPUT','Frozen evaluation/source/input bindings are required');
  if(!Number.isInteger(runtimeMs)||runtimeMs<0||runtimeMs>40*60000)fail('INVALID_FLEET_LIMIT','Fleet runtime must be 0..40minutes');
  const deadline=now()+runtimeMs,timeout=AbortSignal.timeout(Math.max(1,runtimeMs));
  const fleetSignal=signal?AbortSignal.any([signal,timeout]):timeout;
  validateDevelopmentContext(developmentContext);const devFacts=buildMetricFacts(developmentContext),aggregateFacts=buildMetricFacts(aggregateContext);
  const catalogData=metadata(catalog),entries=new Map(catalogData.models.map(m=>[m.id,m]));
  let roster=null,rosterFailure=null;
  if(runtimeMs>=45000&&paidAllowed&&apiKey&&store)try{roster=await verifyModels({apiKey,signal:fleetSignal});}catch(error){rosterFailure=error;}
  const runtimeIds=new Set(roster?.ids||catalogData.models.map(m=>m.id));
  const completeEntries=[...catalogData.models,...[...runtimeIds].filter(id=>!entries.has(id)).map(id=>({id,family:'unqualified',pricingStatus:'unknown',routeClaim:'unverified'}))];
  if(!Number.isFinite(minimumDispatchIntervalMs)||minimumDispatchIntervalMs<0||minimumDispatchIntervalMs>10000)fail('INVALID_FLEET_LIMIT','Dispatch pacing must be 0..10000ms');
  let all=buildFleetAssignments(completeEntries,{events:store?.events()||[]});
  const actualLimits=limitsOf(limits,all.length),planBinding={protocol:FLEET_PROTOCOL,evaluationHash,sourceRevision,inputHash,
    catalogHash:catalogData.catalogHash,catalogAuditHash:catalogAudit?.hash||null,developmentContextHash:hash(developmentContext),aggregateContextHash:hash(aggregateContext),
    assignmentHash:hash([...all].sort((a,b)=>a.model.localeCompare(b.model)).map(({lastDispatched,...a})=>a))};
  const planHash=hash(planBinding),workflowId='fleet-'+planHash.slice(0,32),pending=[],responses=new Map(),agents=[],closingReviews=[];
  let providerBlocked=rosterFailure?.status===401?'PROVIDER_AUTH_RECONCILIATION_REQUIRED':null,providerCooldown=false,freeCooldown=false;
  const existingEvents=store?.events()||[];
  if(existingEvents.some(e=>['fleet-provider-circuit-open','cloud-provider-circuit-open'].includes(e.kind)))providerBlocked='PROVIDER_AUTH_RECONCILIATION_REQUIRED';
  for(const event of existingEvents)if(event.kind==='fleet-quota-cooldown'&&event.detail?.notBefore>now()){
    if(event.detail.scope==='free-allowance')freeCooldown=true;else providerCooldown=true;
  }
  if(store){
    store.recover();store.setControl('running');
    const priorPlan=existingEvents.find(e=>e.kind==='fleet-plan'&&e.detail?.planHash===planHash);
    if(priorPlan)all=JSON.parse(store.readArtifact(priorPlan.detail.artifactHash)).assignments;
    else{const artifact=store.putArtifact(Buffer.from(JSON.stringify({planBinding,assignments:all})));store.event(null,'fleet-plan',{planHash,artifactHash:artifact.hash,assigned:all.length});}
  }
  const circuitFor=model=>existingEvents.some(e=>['fleet-model-circuit-open','fleet-model-ambiguous-billing'].includes(e.kind)&&e.detail?.model===model);
  function taskId(assignment,suffix='primary'){return 'fleet-'+planHash.slice(0,24)+'-'+hash(assignment.model).slice(0,20)+'-'+suffix;}
  function baseRow(assignment){return {...assignment,proposedReviewerModel:assignment.reviewerModel,reviewerModel:null,taskId:taskId(assignment),status:'blocked',code:null,attempted:false,decision:null,reportedUsd:0,
    execution:null,resultHash:null,reviewStatus:'pending',primaryValidated:false};}
  function reviewTarget(assignment){return assignment.mayReview?pending.find(row=>row.model!==assignment.model&&row.family!==assignment.family&&row.reviewStatus==='pending'):null;}
  function applyReview(reviewer,response,target) {
    const review=response?.result?.peerReview;
    if(!target||!review)return;
    if(reviewer.model===target.model||reviewer.family===target.family||!reviewer.mayReview||review.taskId!==target.taskId)
      fail('INDEPENDENT_REVIEW_MISMATCH','Peer review identity or named-lineage separation failed');
    target.reviewStatus='complete';target.reviewerModel=reviewer.model;target.reviewTaskId=reviewer.taskId;target.peerReviewDecision=review.decision;
    if(review.decision!=='pass'&&target.status==='complete'){target.status='needs-human';target.code='PEER_REVIEW_REVISION_REQUIRED';}
  }
  async function invoke(assignment,row,{target=null,closing=false}={}) {
    const entry=entries.get(assignment.model),price=entry?priceOf(entry):null;
    let response=null,rawArtifact=null,lease=null,dispatched=false;
    const aggregateScope=assignment.role==='ceo'||(closing&&target?.role==='ceo');
    const base=aggregateScope?aggregateContext:developmentContext,facts=aggregateScope?aggregateFacts:devFacts;
    const context={...clone(base),trustedMetricFacts:facts,assignment:{team:assignment.team,task:assignment.task,acceptance:assignment.acceptance},
      ...(assignment.role==='ceo'?{specialistResults:agents.map(minimalAgent)}:{}),
      ...(target?{peerReviewTarget:{taskId:target.taskId,model:target.model,resultHash:target.resultHash,
        contribution:responses.get(target.taskId),trustedMetricFacts:target.role==='ceo'?aggregateFacts:devFacts,
        scope:target.role==='ceo'?'aggregate-only governance':'development-only',instruction:'Independently challenge this exact earlier contribution; do not approve because another model agreed.'}}:{})};
    const contextArtifact=store?store.putArtifact(Buffer.from(JSON.stringify(context))):{hash:hash(context)};
    const task={schemaVersion:1,id:row.taskId,workflowId,maxAttempts:2,role:assignment.role,
      actorId:closing?'fleet-review-'+hash(assignment.model).slice(0,16)+'-'+hash(target.taskId).slice(0,8):'fleet-'+hash(assignment.model).slice(0,24),
      sourceRevision,datasetRevision:FLEET_PROTOCOL,candidateHash:hash(planBinding),policyVersion:FLEET_PROTOCOL,
      inputHashes:[...new Set([inputHash,contextArtifact.hash])],stage:closing?'fleet-closing-review':'fleet-primary',artifacts:[contextArtifact.hash],
      constraints:{maxAttempts:2,maxRuntimeMs:45000,maxOutputTokens:2000,sourceHashes:[inputHash],
        ...(assignment.contributionKind==='typed-decision'?{}:{requireMetricClaims:true,...(target?{reviewTaskId:target.taskId}:{})})}};
    const old=store?.getTask(row.taskId);
    if(old){
      row.errorDetails=old.result?.errorDetails||null;
      row.attempted=hasDispatched(store,row.taskId);Object.assign(row,cost(store,row.taskId));
      if(old.result?.resultHash){
        response=JSON.parse(store.readArtifact(old.result.resultHash));
        row.resultHash=old.result.resultHash;row.rawResponseHash=old.result.rawResponseHash||null;row.execution=response.execution||null;row.decision=old.result.decision;
        row.status=old.status;row.code=old.result.code||null;row.primaryValidated=old.result.primaryValidated===true;row.reused=true;row.summary=response.result?.summary||null;
        if(row.primaryValidated){
          responses.set(row.taskId,response);
          const priorTarget=response.result?.peerReview?.taskId;
          applyReview(row,response,priorTarget?agents.find(a=>a.taskId===priorTarget)||pending.find(a=>a.taskId===priorTarget):null);
          if(!closing)pending.push(row);
        }
        return;
      }
      if(old.status!=='pending'||row.attempted){row.status=old.status;row.code=row.attempted?'DISPATCHED_OUTCOME_NOT_REPLAYED':'EARLIER_TERMINAL_TASK';row.reused=true;return;}
    }
    if(!paidAllowed||!apiKey||!store){row.status='disabled';row.code=!paidAllowed?'CHECKPOINT_LINEAGE_BLOCKED':!apiKey?'CLOUD_SECRET_NOT_CONFIGURED':'DURABLE_STORE_UNAVAILABLE';return;}
    if(signal?.aborted){row.code='CANCELLED';return;}
    if(timeout.aborted||now()+45000>deadline){row.code='FLEET_RUNTIME_LIMIT';row.deferred=true;return;}
    if(rosterFailure){row.code=rosterFailure.code||'ROSTER_UNAVAILABLE';return;}
    if(!runtimeIds.has(assignment.model)){row.code='MODEL_ABSENT_FROM_ROSTER';return;}
    if(catalogAudit&&catalogAudit.status!=='verified'){row.code='PUBLIC_CATALOG_UNVERIFIED';return;}
    if(catalogAudit?.issuesByModel?.[assignment.model]){row.code=String(catalogAudit.issuesByModel[assignment.model]).slice(0,100);return;}
    if(!entry||!price){row.code='PRICING_UNKNOWN';return;}
    if(providerBlocked){row.code=providerBlocked;return;}
    if(circuitFor(assignment.model)){row.code='MODEL_RECONCILIATION_REQUIRED';return;}
    if(providerCooldown||(freeCooldown&&entry.billingTier==='free-allowance')){row.code='RATE_LIMIT_COOLDOWN';return;}
    const denied=budgetCheck(store,workflowId,price.contextTokens*price.maxRate/1e6,actualLimits,now());
    if(denied){row.code=denied;row.deferred=true;return;}
    const priorDispatch=store.events().filter(e=>e.kind==='fleet-dispatched').at(-1)?.created;
    const pacingDelay=priorDispatch==null||minimumDispatchIntervalMs===0?0:Math.max(0,priorDispatch+minimumDispatchIntervalMs-now());
    if(now()+pacingDelay+45000>deadline){row.code='FLEET_RUNTIME_LIMIT';row.deferred=true;return;}
    try{
      if(roster&&now()-Date.parse(roster.checkedAt)>8*60000){roster=await verifyModels({apiKey,signal:fleetSignal});runtimeIds.clear();for(const id of roster.ids)runtimeIds.add(id);if(!runtimeIds.has(assignment.model))fail('MODEL_UNAVAILABLE','Model disappeared from refreshed authenticated roster');}
      if(timeout.aborted||now()+45000>deadline)fail('FLEET_RUNTIME_LIMIT','Insufficient fleet runtime remains for a bounded model request');
      if(!old)store.enqueue(task);
      lease=store.claim('fleet-worker',{leaseMs:120000});
      if(!lease||lease.id!==task.id)fail('UNRESOLVED_QUEUE_WORK','Earlier queue work must be reconciled before fleet dispatch');
      const last=store.events().filter(e=>e.kind==='fleet-dispatched').at(-1)?.created;
      const delay=last==null||minimumDispatchIntervalMs===0?0:Math.max(0,last+minimumDispatchIntervalMs-now());
      if(delay)await waitImpl(delay,{signal:fleetSignal});
      const responseValue=await requestRole(task,{apiKey,model:assignment.model,context,signal:fleetSignal,verifiedRoster:roster,
        reserve:async({usd})=>{const id=store.reserve(task.id,'fleet-worker',lease.fence,{usd,...actualLimits});await checkpoint({phase:'reserved',taskId:task.id,model:assignment.model});return id;},
        onDispatch:async id=>{if(timeout.aborted||now()+45000>deadline)fail('FLEET_RUNTIME_LIMIT','Insufficient remaining runtime before model dispatch');store.dispatch(id,'fleet-worker',lease.fence);dispatched=true;row.attempted=true;store.event(task.id,'fleet-dispatched',{model:assignment.model,planHash});await checkpoint({phase:'dispatched',taskId:task.id,model:assignment.model});},
        onUsage:async(id,usage)=>{store.settle(id,'fleet-worker',lease.fence,usage);await checkpoint({phase:'settled',taskId:task.id,model:assignment.model});},
        onResponse:record=>{rawArtifact=store.putArtifact(Buffer.from(JSON.stringify(record)));}});
      response=responseValue;
      const saved=store.putArtifact(Buffer.from(JSON.stringify(response)));row.resultHash=saved.hash;row.execution=response.execution||null;
      if(!dispatched)fail('DISPATCH_EVIDENCE_MISSING','An adapter response is not proof that a model request was dispatched');
      if(response.execution?.requestedModel!==assignment.model||response.execution?.returnedModel!==assignment.model)fail('MODEL_MISMATCH','Exact requested and returned model identity is required');
      if(assignment.contributionKind==='typed-decision'){
        if(response.contributionKind!=='typed-decision'||response.validation?.valid!==true||!response.typedDecision)fail('INVALID_TYPED_CONTRIBUTION','Typed route did not return a validated original classification');
        if(response.validation.agreesWithExpected===false)fail('DECISION_GROUNDING_MISMATCH','Original typed classification disagrees with trusted routing facts');
        row.decision=response.validation.agreesWithExpected===true?'pass':'needs-human';
        row.decisionBasis='Trusted comparison of original typed classification, not a fabricated model role response';
      }else{
        const {actorId,...rawResult}=response.result||{};if(actorId!==undefined&&actorId!==task.actorId)fail('ACTOR_IDENTITY_MISMATCH','Provider result actor differs from trusted assignment');
        response.result=validateResult(rawResult,task);validateMetricClaims(response.result.metricClaims,facts);row.decision=response.result.decision;
      }
      row.primaryValidated=true;row.status=row.decision==='reject'?'rejected':row.decision==='needs-human'?'needs-human':'complete';
      row.summary=response.result?.summary||null;
      applyReview(row,response,target);responses.set(row.taskId,response);
      row.rawResponseHash=rawArtifact?.hash||null;
      store.finish(task.id,'fleet-worker',lease.fence,{status:row.status,result:{resultHash:row.resultHash,rawResponseHash:row.rawResponseHash,decision:row.decision,primaryValidated:true,code:null}});
      if(!closing)pending.push(row);
    }catch(error){
      row.code=error.code||'FLEET_REVIEW_FAILED';row.status='failed';row.primaryValidated=false;row.errorDetails=error.errorDetails||null;
      row.rawResponseHash=rawArtifact?.hash||null;
      if(row.code==='FLEET_RUNTIME_LIMIT'&&!dispatched){row.status='blocked';row.deferred=true;}
      if(store&&lease?.id===task.id){
        try{store.finish(task.id,'fleet-worker',lease.fence,{status:row.deferred?'needs-human':'failed',result:{resultHash:row.resultHash,rawResponseHash:rawArtifact?.hash||null,decision:row.decision,primaryValidated:false,code:row.code,errorDetails:row.errorDetails},error:row.code});}catch{row.code='LEASE_LOST_RECONCILIATION_REQUIRED';}
      }
      if(error.status===401){providerBlocked='PROVIDER_AUTH_RECONCILIATION_REQUIRED';store?.event(null,'fleet-provider-circuit-open',{code:row.code,status:401});}
      else if([400,403].includes(error.status)||['MODEL_MISMATCH','MODEL_UNAVAILABLE','PRICING_UNKNOWN'].includes(row.code))store?.event(null,'fleet-model-circuit-open',{model:assignment.model,code:row.code,status:error.status||null});
      if(error.status===429){if(error.quotaScope==='free-allowance')freeCooldown=true;else providerCooldown=true;store?.event(null,'fleet-quota-cooldown',{scope:freeCooldown?'free-allowance':'provider',notBefore:now()+Math.max(60000,error.retryAfterMs||0)});}
      if(store&&store.ledger(task.id).unknownBillingRequests)store.event(null,'fleet-model-ambiguous-billing',{model:assignment.model,taskId:task.id});
    }finally{
      if(store){row.attempted=hasDispatched(store,row.taskId);Object.assign(row,cost(store,row.taskId));}
      await checkpoint({phase:'fleet-task-finished',taskId:task.id,model:assignment.model});
    }
  }
  for(const assignment of all){const row=baseRow(assignment);agents.push(row);await invoke(assignment,row,{target:reviewTarget(assignment)});}
  for(const target of pending.filter(row=>row.reviewStatus==='pending')){
    const reviewer=agents.find(row=>row.primaryValidated&&row.mayReview&&row.model!==target.model&&row.family!==target.family&&!circuitFor(row.model));
    if(!reviewer){target.reviewStatus='blocked';target.reviewCode='NO_QUALIFIED_DISTINCT_REVIEWER';continue;}
    const assignment={...reviewer,role:'critique',team:'independent closing review',task:'Challenge the exact earlier contribution against its deterministic numeric evidence. An advisory approval cannot override failed checks.'};
    const closing=baseRow(assignment);closing.taskId=taskId(assignment,'review-'+hash(target.taskId).slice(0,16));closingReviews.push(closing);
    await invoke(assignment,closing,{target,closing:true});
    if(target.reviewStatus==='pending'){target.reviewStatus='blocked';target.reviewCode=closing.code||'PEER_REVIEW_INCOMPLETE';}
  }
  const ledger=store?store.ledger():{requests:null,reportedUsd:null,reservedUsd:null,unknownBillingRequests:null};
  const report={protocol:FLEET_PROTOCOL,planHash,catalog:{checkedAt:roster?.checkedAt||catalogData.checkedAt,catalogCheckedAt:catalogData.checkedAt,
    hash:catalogData.catalogHash,rosterCount:roster?.ids.length??null,count:all.length,catalogCount:catalogData.models.length,authenticatedCount:roster?.ids.length??null,catalogHash:catalogData.catalogHash,
    authenticatedRosterHash:roster?hash([...roster.ids].sort()):null,rosterVerified:!!roster,catalogAuditStatus:catalogAudit?.status||'trusted-snapshot',catalogAuditHash:catalogAudit?.hash||null},
    coverage:{rosterCount:roster?.ids.length??null,assigned:agents.length,attempted:agents.filter(a=>a.attempted).length,validContributions:agents.filter(a=>a.primaryValidated).length,
      independentlyReviewed:agents.filter(a=>a.reviewStatus==='complete').length,notAttempted:agents.filter(a=>!a.attempted).length,
      blocked:agents.filter(a=>a.status==='blocked'||a.status==='disabled').length,failed:agents.filter(a=>a.status==='failed').length,
      complete:agents.length>0&&!!roster&&agents.every(a=>a.attempted&&a.primaryValidated&&a.reviewStatus==='complete')},agents,closingReviews,
    budget:{...actualLimits,runtimeMs,totalRequests:ledger.requests,reportedUsd:ledger.reportedUsd,committedUsd:ledger.reservedUsd,unknownBillingRequests:ledger.unknownBillingRequests},
    productionReleaseApproved:false,fieldAccuracyValidated:false};
  if(store){const artifact=store.putArtifact(Buffer.from(JSON.stringify(report)));store.event(null,'fleet-evaluation-finished',{planHash,artifactHash:artifact.hash,coverage:report.coverage});}
  return report;
}

const ASSIGNMENT_ROWS=[
  {
    "model": "claude-fable-5.2",
    "team": "independent critique",
    "assignment": "Audit the revision-to-approval dependency graph",
    "task": "Given scale, source and geometry revisions, enumerate invalid approvals and every downstream quantity/report requiring fresh verification.",
    "acceptance": "No inherited approval survives a changed dependency; cite both old and current revision.",
    "reviewer": "grok-4.7",
    "canonicalFamily": "claude",
    "mayActAsIndependentReviewer": true
  },
  {
    "model": "claude-opus-5.5",
    "team": "extraction",
    "assignment": "Adjudicate conflicting sketch dimensions",
    "task": "Return each conflicting dimension with page/region/file revision, competing values, authority, and an unresolved decision; do not average or complete missing pitch.",
    "acceptance": "Preserve all conflicting readings and withhold unsupported physical quantities.",
    "reviewer": "gpt-6.2-astra",
    "canonicalFamily": "claude",
    "mayActAsIndependentReviewer": true
  },
  {
    "model": "claude-sonnet-5.5",
    "team": "extraction",
    "assignment": "Propose a multipage selection and rotation correction",
    "task": "Map selected rendered page regions back to source pages with intrinsic rotation, user rotation, crop and scale separated; propose a narrow ingestion patch and regression fixture.",
    "acceptance": "A page is transformed exactly once; selected and conflicting unselected pages remain traceable.",
    "reviewer": "free/gemini-3.1-pro",
    "canonicalFamily": "claude",
    "mayActAsIndependentReviewer": true
  },
  {
    "model": "deepseek-v4-flash",
    "team": "operations",
    "assignment": "Classify provider failures and bounded retries",
    "task": "Classify supplied HTTP errors, Retry-After headers, network interruptions and ambiguous dispatch outcomes into stop, retry, pause or human review.",
    "acceptance": "Permanent authorization/format failures never retry; unknown committed dispatch never automatically duplicates.",
    "reviewer": "free/glm-5.3-flashx",
    "canonicalFamily": "deepseek",
    "mayActAsIndependentReviewer": true
  },
  {
    "model": "deepseek-v4-pro",
    "team": "roof engineering",
    "assignment": "Derive a closed-form measurement oracle",
    "task": "Derive plan and sloped facet area, slope factors, shared-edge lengths and opening deductions from declared analytic roof geometry.",
    "acceptance": "Formula derivation separates plan from surface area and leaves unknown-pitch surface area unknown.",
    "reviewer": "free/glm-5.3",
    "canonicalFamily": "deepseek",
    "mayActAsIndependentReviewer": true
  },
  {
    "model": "deepseek-v4.1-flash",
    "team": "real-case testing",
    "assignment": "Generate geometry metamorphic tests",
    "task": "Create translated, rotated, reflected and rescaled roof families with explicit invariants for area, edge classification and facet adjacency.",
    "acceptance": "Tests distinguish invariant quantities from scale-dependent quantities and do not use engine output as expected truth.",
    "reviewer": "free/claude-sonnet-4.6",
    "canonicalFamily": "deepseek",
    "mayActAsIndependentReviewer": true
  },
  {
    "model": "free/claude-opus-4.6",
    "team": "independent critique",
    "assignment": "Challenge a proposal for hidden uncertainty",
    "task": "Review another agent's dimension/boundary proposal for lost conflicts, invented scale/pitch, unsupported closure and unjustified certainty.",
    "acceptance": "List source-bound objections and revision requirements; cannot approve its own authored proposal.",
    "reviewer": "gpt-6.2-astra",
    "canonicalFamily": "claude",
    "mayActAsIndependentReviewer": true
  },
  {
    "model": "free/claude-sonnet-4.6",
    "team": "real-case testing",
    "assignment": "Review coordinate patch regressions independently",
    "task": "Challenge the patch against a separate pen/raster coordinate test bank, deriving expected source points from transform definitions.",
    "acceptance": "At least one mutation that reintroduces each confirmed defect fails; author examples alone do not suffice.",
    "reviewer": "free/gemini-3.1-pro",
    "canonicalFamily": "claude",
    "mayActAsIndependentReviewer": true
  },
  {
    "model": "free/deepseek-v4-flash-0731",
    "team": "operations",
    "assignment": "Generate permanent-error retry counterexamples",
    "task": "Construct account, model, schema and endpoint error scenarios that must stop instead of retrying or silently switching provider.",
    "acceptance": "Cases include 400/401/403/404 permanent errors and preserve their actionable cause.",
    "reviewer": "free/glm-5.3",
    "canonicalFamily": "deepseek",
    "mayActAsIndependentReviewer": true
  },
  {
    "model": "free/deepseek-v4-pro-0813",
    "team": "roof engineering",
    "assignment": "Review area and edge formulas independently",
    "task": "Re-derive analytic area and true-length results without seeing engine answers, then challenge unit factors, opening scope and shared-edge double counting.",
    "acceptance": "Return derivation plus exact/interval expectations; unknown pitch never receives a numeric surface-area oracle.",
    "reviewer": "free/claude-opus-4.6",
    "canonicalFamily": "deepseek",
    "mayActAsIndependentReviewer": true
  },
  {
    "model": "free/deepseek-v4.1-flash",
    "team": "real-case testing",
    "assignment": "Generate shared-edge and tiny-facet counterexamples",
    "task": "Create adjacent concave facets, short edge stubs, near-touching components and excluded openings that expose duplicate edges and lost geometry.",
    "acceptance": "Each fixture declares independent adjacency and length/area expectations with tolerances justified by scale.",
    "reviewer": "free/gemini-3.1-pro",
    "canonicalFamily": "deepseek",
    "mayActAsIndependentReviewer": true
  },
  {
    "model": "free/drex-v2.0",
    "team": "operations",
    "assignment": "Classify unsupported target selections",
    "task": "Classify precomputed pin-to-box/mask evidence into retry same source, repick, alternate source or manual review; do not infer boundaries.",
    "acceptance": "An unsupported explicit target never routes to neighbor tracing; every held job has an actionable recovery path.",
    "reviewer": "free/glm-5.3",
    "canonicalFamily": "jev-group",
    "mayActAsIndependentReviewer": true
  },
  {
    "model": "free/glm-5.3",
    "team": "reference data",
    "assignment": "Audit serialized evidence coverage",
    "task": "Compare accepted job artifacts, saved/reopened job schema and report manifests for omitted provenance, unknown statuses, model IDs or source revisions.",
    "acceptance": "Roundtrip preserves every required evidence field; absence cannot silently default to measured.",
    "reviewer": "free/deepseek-v4-pro-0813",
    "canonicalFamily": "glm",
    "mayActAsIndependentReviewer": true
  },
  {
    "model": "free/glm-5.3-flashx",
    "team": "operations",
    "assignment": "Generate malformed model-output parser cases",
    "task": "Propose JSON/schema adversarial samples including fences, duplicate keys, NaN, wrong units, extra properties, excessive coordinates and out-of-bounds values.",
    "acceptance": "Every malformed sample has an expected rejection reason; provider JSON mode is never treated as validation.",
    "reviewer": "free/claude-sonnet-4.6",
    "canonicalFamily": "glm",
    "mayActAsIndependentReviewer": true
  },
  {
    "model": "free/glm-5.3-flash",
    "team": "extraction",
    "assignment": "Audit normalized pitch and units independently",
    "task": "Cross-check normalized labels against supplied source crops/OCR alternatives and recompute feet/inches/metric conversions using deterministic rules.",
    "acceptance": "Flag mismatched dimension kinds and retain OCR alternatives rather than fabricate an authoritative reading.",
    "reviewer": "free/gpt-6-luna",
    "canonicalFamily": "glm",
    "mayActAsIndependentReviewer": true
  },
  {
    "model": "free/gemini-3.1-pro",
    "team": "reference data",
    "assignment": "Validate extracted multipage dimensions",
    "task": "Cross-check each extracted value and connecting line against its source page/region and identify contradictory or missing dimensions across pages.",
    "acceptance": "Every accepted dimension has a locator and verified relation to the intended roof edge.",
    "reviewer": "free/claude-opus-4.6",
    "canonicalFamily": "gemini",
    "mayActAsIndependentReviewer": true
  },
  {
    "model": "free/gemini-3.8-flash",
    "team": "extraction",
    "assignment": "Challenge page rotation and crop mappings",
    "task": "Independently verify crop bounds and label coordinates after intrinsic rotation, additional user rotation and rendering resize.",
    "acceptance": "Detect double rotation, wrong-page references and out-of-source coordinates.",
    "reviewer": "free/claude-sonnet-4.6",
    "canonicalFamily": "gemini",
    "mayActAsIndependentReviewer": true
  },
  {
    "model": "free/gemini-4-hydrogen",
    "team": "real-case testing",
    "assignment": "Generate wrong-building selection challenges",
    "task": "Construct selected pin versus provider bbox/mask scenarios including larger neighbors, stale records, missing target, courtyard points and datum displacement.",
    "acceptance": "Cases preserve the selection guard while distinguishing uncertain address points from explicit visible-roof selections.",
    "reviewer": "free/qwen-3.8-max",
    "canonicalFamily": "gemini",
    "mayActAsIndependentReviewer": true
  },
  {
    "model": "free/gpt-6-luna",
    "team": "reporting",
    "assignment": "Verify exported summary and schedules independently",
    "task": "Read supplied PDF text/box extraction and compare all printed quantities and statuses to the frozen manifest, including subtotal, excluded area and waste.",
    "acceptance": "Every printed quantity matches its manifest source or produces a reproducible discrepancy.",
    "reviewer": "free/glm-5.3-flash",
    "canonicalFamily": "gpt",
    "mayActAsIndependentReviewer": true
  },
  {
    "model": "free/hy4",
    "team": "reporting",
    "assignment": "Review ambiguous manual correction paths",
    "task": "Challenge correction instructions for canopy, conflicting pitch or missing scale; ensure unresolved states remain visible through save and export.",
    "acceptance": "Instructions require evidence or explicit manual input, never force an unsupported roof closure.",
    "reviewer": "free/claude-opus-4.6",
    "canonicalFamily": "hy4",
    "mayActAsIndependentReviewer": true
  },
  {
    "model": "free/hy4-flash",
    "team": "reporting",
    "assignment": "Draft actionable recovery instructions",
    "task": "Translate a typed diagnostic into concise user actions for repicking, manual tracing, changing dated imagery or correcting a source reference.",
    "acceptance": "Copy names the next available control and resulting state; alias identity is not treated as independent verification.",
    "reviewer": "free/claude-sonnet-4.6",
    "canonicalFamily": "hy4",
    "mayActAsIndependentReviewer": false
  },
  {
    "model": "free/kimi-k2.8",
    "team": "reference data",
    "assignment": "Audit reference retention across job history",
    "task": "Check object/content hash, property split, acquisition date and permission metadata as files are deduplicated, superseded and restored.",
    "acceptance": "No superseded evidence silently becomes current; property-family leakage remains detectable.",
    "reviewer": "free/deepseek-v4.1-flash",
    "canonicalFamily": "kimi",
    "mayActAsIndependentReviewer": true
  },
  {
    "model": "free/kimi-k3",
    "team": "operations",
    "assignment": "Validate rollback and checkpoint recovery",
    "task": "Review deployment/checkpoint event traces for repeat jobs, older-run reruns, interrupted writes and rollback to a prior verified artifact.",
    "acceptance": "Rollback restores a compatible app/state/artifact set and a rerun cannot regress the latest checkpoint by run ID alone.",
    "reviewer": "free/claude-sonnet-4.6",
    "canonicalFamily": "kimi",
    "mayActAsIndependentReviewer": true
  },
  {
    "model": "free/mimo-v2.6-flash",
    "team": "real-case testing",
    "assignment": "Generate upload and parser boundary fixtures",
    "task": "Specify malformed, rotated, oversized, low-resolution and multipage inputs that challenge selected-page extraction and resource limits.",
    "acceptance": "Every fixture has a bounded expected rejection/review result and no untrusted document instruction becomes authority.",
    "reviewer": "free/glm-5.3-flashx",
    "canonicalFamily": "mimo",
    "mayActAsIndependentReviewer": true
  },
  {
    "model": "free/mimo-v2.6-pro",
    "team": "real-case testing",
    "assignment": "Verify save/reopen and stale-result consistency",
    "task": "Design event-order tests across job switch, same coordinates, same filename, edits during inference, reopening and old async completions.",
    "acceptance": "An accepted result is bound to job identity plus revision and never follows a later selection.",
    "reviewer": "free/kimi-k2.8",
    "canonicalFamily": "mimo",
    "mayActAsIndependentReviewer": true
  },
  {
    "model": "free/minimax-m3",
    "team": "reporting",
    "assignment": "Audit keyboard correction and undo accessibility",
    "task": "Review declared UI controls and event traces for keyboard entry, nearest-vertex selection, escape, undo, redo and recovery after errors.",
    "acceptance": "Every modifying action has a reachable review/revert path; partial provider health is a blocker, not a skipped pass.",
    "reviewer": "free/gpt-6-luna",
    "canonicalFamily": "minimax",
    "mayActAsIndependentReviewer": true
  },
  {
    "model": "free/minimax-m3.1-flash",
    "team": "operations",
    "assignment": "Design interrupted-dispatch recovery tests",
    "task": "Challenge durable dispatch records, reservation release and outcome-unknown jobs when a worker exits between send and response persistence.",
    "acceptance": "Unknown provider outcome is held for reconciliation and never auto-replayed without verified idempotency.",
    "reviewer": "free/deepseek-v4-flash-0731",
    "canonicalFamily": "minimax",
    "mayActAsIndependentReviewer": true
  },
  {
    "model": "free/muse-spark-1.3",
    "team": "reporting",
    "assignment": "Review rendered plan label legibility",
    "task": "Independently inspect A4/Letter and narrow-screen report exports for collisions, clipped legends, unreadable labels and distorted roof aspect ratio.",
    "acceptance": "Return page/box coordinates for issues and preserve customer report exclusion of segmentation imagery.",
    "reviewer": "free/gpt-6-luna",
    "canonicalFamily": "muse",
    "mayActAsIndependentReviewer": true
  },
  {
    "model": "free/qwen-3.8-max",
    "team": "roof engineering",
    "assignment": "Propose calibrated visible roof outline candidates",
    "task": "From declared overhead source pixels, return only visible outline/facet candidate coordinates with source locators and uncertain intervals; physical quantities are delegated to deterministic code.",
    "acceptance": "Strict schema, in-source bounds and known-scale policy pass; a hidden or shadowed boundary remains unresolved.",
    "reviewer": "free/claude-opus-4.6",
    "canonicalFamily": "qwen",
    "mayActAsIndependentReviewer": true
  },
  {
    "model": "glm-5.3",
    "team": "reference data",
    "assignment": "Audit the cross-stage quantity contract",
    "task": "Trace each required quantity from extraction through geometry and serialization into the report manifest, detecting missing units, provenance, status or dependencies.",
    "acceptance": "No exact physical quantity appears without scale/evidence, and unknown differs from zero.",
    "reviewer": "free/deepseek-v4-pro-0813",
    "canonicalFamily": "glm",
    "mayActAsIndependentReviewer": true
  },
  {
    "model": "glm-5.3-flash",
    "team": "extraction",
    "assignment": "Normalize pitch and dimension labels",
    "task": "Parse supplied OCR candidates into typed pitch, length, area and dimensionless values, retaining original text and explicit ambiguity.",
    "acceptance": "6:12 pitch is never 6 feet; feet/inches, metric conversion and absent labels remain distinct.",
    "reviewer": "free/gpt-6-luna",
    "canonicalFamily": "glm",
    "mayActAsIndependentReviewer": true
  },
  {
    "model": "gpt-6-luna",
    "team": "reporting",
    "assignment": "Reconcile report detail with summary quantities",
    "task": "Review a report manifest and schedules for area, squares, waste, pitch breakdown and edge totals, with explicit unknown quantities excluded from complete totals.",
    "acceptance": "Every displayed total reconciles to included quantities and uses the same unit/rounding policy.",
    "reviewer": "free/glm-5.3-flash",
    "canonicalFamily": "gpt",
    "mayActAsIndependentReviewer": true
  },
  {
    "model": "gpt-6.1-terra",
    "team": "real-case testing",
    "assignment": "Design the pen coordinate regression matrix",
    "task": "Specify pointer tests across canvas offsets, letterboxing, pan, zoom, CSS scaling, device pixel ratio, rotation and nearest-handle selection.",
    "acceptance": "Every case has source coordinates and an independently derived expected result, including undo and cancellation.",
    "reviewer": "free/gemini-3.8-flash",
    "canonicalFamily": "gpt",
    "mayActAsIndependentReviewer": true
  },
  {
    "model": "gpt-6.2-astra",
    "team": "roof engineering",
    "assignment": "Audit raster registration and facet topology",
    "task": "Challenge CRS, affine inverse, point-sample offset, raster origin, target pin, shared edges, polygon closure and resulting plan/sloped quantities using supplied deterministic evidence.",
    "acceptance": "Each defect has a minimal reproduction, expected invariant and uncertainty classification; no source identity inferred from size.",
    "reviewer": "free/claude-opus-4.6",
    "canonicalFamily": "gpt",
    "mayActAsIndependentReviewer": true
  },
  {
    "model": "gpt-6.2-sol",
    "team": "roof engineering",
    "assignment": "Propose the smallest registration defect patch",
    "task": "Using a confirmed failing raster/pin fixture, produce a constrained patch plan and adversarial regression cases covering both the defect and currently correct transforms.",
    "acceptance": "Patch proposal addresses the reproduced invariant without relaxing building selection or evidence checks.",
    "reviewer": "free/claude-sonnet-4.6",
    "canonicalFamily": "gpt",
    "mayActAsIndependentReviewer": true
  },
  {
    "model": "gemini-3.8-flash",
    "team": "extraction",
    "assignment": "Triage report pages and orientation",
    "task": "Create a page inventory with page purpose, printed page number, intrinsic/display rotation and all geometry/dimension-bearing regions, including cluttered pages.",
    "acceptance": "No contradictory dimension page is dropped and uncertain orientation is flagged.",
    "reviewer": "free/kimi-k2.8",
    "canonicalFamily": "gemini",
    "mayActAsIndependentReviewer": true
  },
  {
    "model": "gemini-4-argon",
    "team": "roof engineering",
    "assignment": "Challenge occluded roof boundaries",
    "task": "From supplied image and candidate masks, identify shadow, tree occlusion, touching structures and unsupported connections; propose visible boundary candidates only.",
    "acceptance": "Hidden surfaces remain unresolved and no inferred ridge or physical measurement is presented as observed.",
    "reviewer": "free/qwen-3.8-max",
    "canonicalFamily": "gemini",
    "mayActAsIndependentReviewer": true
  },
  {
    "model": "gemini-4-carbon",
    "team": "independent critique",
    "assignment": "Resolve segmentation disagreements into review issues",
    "task": "Compare independent candidate outlines against source evidence, localize divergent boundary intervals and specify the extra view or manual correction needed.",
    "acceptance": "Disagreement is retained explicitly rather than averaged into a false consensus outline.",
    "reviewer": "free/claude-opus-4.6",
    "canonicalFamily": "gemini",
    "mayActAsIndependentReviewer": true
  },
  {
    "model": "gemini-4-hydrogen",
    "team": "roof engineering",
    "assignment": "Separate selected house from accessory roofs",
    "task": "Check target pin, dated source, mask components and source witnesses to identify main roof versus detached garage, pool structure or neighboring house.",
    "acceptance": "The largest or nearest source component cannot replace an unsupported explicit pin.",
    "reviewer": "free/claude-sonnet-4.6",
    "canonicalFamily": "gemini",
    "mayActAsIndependentReviewer": true
  },
  {
    "model": "grok-4.7",
    "team": "independent critique",
    "assignment": "Red-team unsupported completion claims",
    "task": "Find claims that turn synthetic pass, model agreement, visual similarity or API success into field accuracy, completed measurement or deployment success.",
    "acceptance": "Each challenged claim cites missing evidence and the exact check required; never overrides deterministic failures.",
    "reviewer": "claude-fable-5.2",
    "canonicalFamily": "grok",
    "mayActAsIndependentReviewer": true
  },
  {
    "model": "drex-v2.0",
    "team": "operations",
    "assignment": "Route invalid polygon jobs using typed decisions",
    "task": "Classify precomputed polygon diagnostics into reject input, request correction or eligible for deterministic measurement.",
    "acceptance": "Degenerate/self-intersecting/unclosed geometry never routes to completed measurement.",
    "reviewer": "free/glm-5.3",
    "canonicalFamily": "jev-group",
    "mayActAsIndependentReviewer": true
  },
  {
    "model": "jev-1.13",
    "team": "reporting",
    "assignment": "Route incomplete report manifests using typed decisions",
    "task": "Classify precomputed manifest coverage and reconciliation facts into complete, review required or failed.",
    "acceptance": "Missing pitch/scale or an unreconciled total cannot become complete.",
    "reviewer": "free/deepseek-v4-pro-0813",
    "canonicalFamily": "jev-group",
    "mayActAsIndependentReviewer": true
  },
  {
    "model": "kimi-k3.1-pro",
    "team": "reference data",
    "assignment": "Audit source and revision provenance",
    "task": "Check page/region references, content hashes, property identity, dated imagery and file replacement against the current job revision.",
    "acceptance": "Same filename or same job revision number alone cannot reuse evidence from another object or property.",
    "reviewer": "free/deepseek-v4.1-flash",
    "canonicalFamily": "kimi",
    "mayActAsIndependentReviewer": true
  },
  {
    "model": "muse-spark-1.3",
    "team": "reporting",
    "assignment": "Propose a plan-first report layout",
    "task": "Use supplied rendered boxes and report manifest to place plan, dimensions, facet keys, legends and schedules without changing roof geometry or including segmentation imagery.",
    "acceptance": "A4 and Letter layouts retain aspect ratio and no required text clips or overlaps.",
    "reviewer": "free/gpt-6-luna",
    "canonicalFamily": "muse",
    "mayActAsIndependentReviewer": true
  },
  {
    "model": "hy4-preview",
    "team": "reporting",
    "assignment": "Design uncertainty correction and recovery steps",
    "task": "For unsupported roof boundaries or failed lookups, specify visible repick, manual-trace and evidence-review steps with clear preserved/changed job state.",
    "acceptance": "A user can continue without accepting unsupported measurements, and cancellation has an explicit effect.",
    "reviewer": "free/claude-sonnet-4.6",
    "canonicalFamily": "hy4",
    "mayActAsIndependentReviewer": true
  }
];
