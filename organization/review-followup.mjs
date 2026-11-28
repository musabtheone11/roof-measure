// Review retained evidence, optionally qualifying distinct concepts after explicit HTTP failures.
import {createHash} from 'node:crypto';
import {mkdirSync,readFileSync,readdirSync,lstatSync,realpathSync,copyFileSync,writeFileSync,existsSync} from 'node:fs';
import {resolve,relative,isAbsolute,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {zipSync} from '../vendor/fflate/browser.mjs';
import {OrgStore} from './store.mjs';
import {reviewDesignConcepts} from './design-review.mjs';
import {runDesignFleet} from './design-fleet.mjs';
import {DESIGN_CATALOG,auditDesignCatalog} from './design-catalog.mjs';
import {requestDesignConcept} from './design-provider.mjs';
import {auditModelCatalog} from './catalog-audit.mjs';
import {MODEL_CATALOG} from './model-catalog.mjs';
import {requestOrganizationRole} from './provider.mjs';
import {buildMetricFacts,validateMetricClaims} from './model-fleet.mjs';
import {validateResult} from './contracts.mjs';
import {monitoringDecision} from './cloud-cycle.mjs';

export const REVIEW_FOLLOWUP_PROTOCOL='retained-review-followup-v1';
const SHA=/^[a-f0-9]{64}$/,REV=/^[a-f0-9]{40}$/;
const LIMITS=Object.freeze({maxUsd:3,hourUsd:3,dayUsd:3,weekUsd:20,monthUsd:80});
const QUALIFICATION_POLICY='single-new-concept-variant-after-explicit-http-failure-v1';
const QUALIFICATION_SUFFIX=' This is a distinct, simplified qualification concept: focus on one coherent cover, icon panel or schedule specimen from your assigned specialty, with fewer labels and generous whitespace. Preserve all synthetic-only, CONCEPT, no measurements and independent-review requirements. Do not reproduce a previous image or infer any property geometry.';
const digest=value=>createHash('sha256').update(Buffer.isBuffer(value)||typeof value==='string'?value:JSON.stringify(value)).digest('hex');
const fail=(code,message)=>{const e=new Error(message);e.code=code;throw e;};
const clone=value=>JSON.parse(JSON.stringify(value));
function inside(root,name){
  if(typeof name!=='string'||!name||name.length>1000||isAbsolute(name)||name.split(/[\\/]/).some(p=>p==='..'||p==='.'||!p)||/[\x00-\x1f]/.test(name))fail('INVALID_BASELINE_PATH','Baseline paths must be bounded relative regular-file references');
  const target=resolve(root,name),rel=relative(root,target);if(!rel||rel.startsWith('..')||isAbsolute(rel))fail('INVALID_BASELINE_PATH','Baseline reference escapes its artifact root');
  let current=root;for(const part of rel.split(/[\\/]/)){current=join(current,part);if(lstatSync(current).isSymbolicLink())fail('INVALID_BASELINE_PATH','Baseline symlinks are forbidden');}
  const actual=realpathSync(target),actualRel=relative(realpathSync(root),actual);
  if(actualRel.startsWith('..')||isAbsolute(actualRel)||!lstatSync(actual).isFile())fail('INVALID_BASELINE_PATH','Baseline reference is not an in-root regular file');
  return actual;
}
function json(root,name){const bytes=readFileSync(inside(root,name));if(bytes.length>2*1024*1024)fail('BASELINE_SIZE_LIMIT','Baseline JSON exceeds2MiB');try{return JSON.parse(bytes);}catch{fail('INVALID_BASELINE_JSON','Baseline evidence is not valid JSON');}}
function inventory(root){
  const items=[];let total=0;
  function visit(dir,prefix=''){
    for(const entry of readdirSync(dir,{withFileTypes:true})){
      const name=prefix?prefix+'/'+entry.name:entry.name,p=join(dir,entry.name);
      if(entry.isSymbolicLink())fail('INVALID_BASELINE_PATH','Baseline symlinks are forbidden');
      if(entry.isDirectory())visit(p,name);
      else if(entry.isFile()){
        const path=inside(root,name),bytes=readFileSync(path);total+=bytes.length;
        if(bytes.length>16*1024*1024||total>32*1024*1024||items.length>=5000)fail('BASELINE_SIZE_LIMIT','Retained baseline exceeds bounded artifact size');
        items.push({path:name,sha256:digest(bytes),bytes:bytes.length});
      }else fail('INVALID_BASELINE_PATH','Unsupported retained baseline entry');
    }
  }
  visit(root);return items.sort((a,b)=>a.path.localeCompare(b.path));
}
function verifyRef(root,ref){
  if(!ref||!SHA.test(ref.sha256||''))fail('INVALID_BASELINE_HASH','Retained artifact requires an exact SHA256');
  const bytes=readFileSync(inside(root,ref.path));
  if(digest(bytes)!==ref.sha256||(ref.bytes!==undefined&&ref.bytes!==bytes.length))fail('INVALID_BASELINE_HASH','Retained artifact bytes differ from recorded evidence');
}
function loadBaseline(directory,runId){
  if(!/^[1-9]\d*$/.test(String(runId)))fail('INVALID_BASELINE_RUN','Verified original GitHub run ID is required');
  const root=resolve(existsSync(join(directory,'cloud-output','cycle.json'))?join(directory,'cloud-output'):directory);
  if(lstatSync(root).isSymbolicLink()||!lstatSync(root).isDirectory())fail('INVALID_BASELINE_PATH','Baseline root must be a real directory');
  const cycle=json(root,'cycle.json'),summary=json(root,'summary.json');
  if(cycle.schemaVersion!==1||!REV.test(cycle.sourceRevision||'')||cycle.sourceRevision!==summary.sourceRevision||!SHA.test(cycle.evaluationHash||'')||
    !Array.isArray(summary.cases)||!summary.cases.length||!Array.isArray(cycle.fleet?.agents)||!Array.isArray(cycle.fleet?.design?.artifacts))
    fail('INVALID_BASELINE_PROVENANCE','Baseline cycle, source, generated cases or design manifest is incomplete');
  const identity={protocol:cycle.protocol,sourceRevision:cycle.sourceRevision,seed:cycle.seed,count:cycle.count,fixtureHash:summary.fixtureHash,
    generatorSourceSha256:summary.generatorSourceSha256,engineSourceHashes:summary.engineSourceHashes,
    metricsHash:digest(cycle.metrics),verificationPolicyHash:digest(summary.policy||{})};
  if(digest(identity)!==cycle.evaluationHash)fail('INVALID_BASELINE_HASH','Baseline evaluation hash does not bind its actual metrics/source/policy');
  if(cycle.metrics?.attempted!==summary.cases.length||cycle.metrics?.generatedCustomerPDFs!==summary.cases.length||cycle.metrics?.diagnosticPasses!==summary.cases.filter(c=>c.verification?.diagnosticPass).length)
    fail('INVALID_BASELINE_COUNTS','Retained deterministic counts disagree with retained cases');
  for(const item of summary.cases)for(const ref of Object.values(item.artifacts||{}))verifyRef(root,ref);
  for(const image of cycle.fleet.design.artifacts){
    if(image.sourceRevision!==cycle.sourceRevision||image.measurementUse!==false||image.artifactKind!=='raster-design-concept')fail('INVALID_BASELINE_PROVENANCE','Concept provenance differs from the original evaluated source');
    verifyRef(root,image);
  }
  const models=cycle.fleet.agents.map(row=>row.model);
  if(new Set(models).size!==models.length||models.length!==51||!cycle.fleet.agents.some(row=>row.model==='claude-opus-5.5'&&row.role==='ceo'))
    fail('INVALID_BASELINE_MODELS','Retained baseline must contain51 unique model rows including the CEO');
  const files=inventory(root);
  return {root,cycle,summary,files,cycleHash:digest(readFileSync(inside(root,'cycle.json'))),manifestHash:digest(files),runId:String(runId)};
}
function writeJSON(path,value){mkdirSync(resolve(path,'..'),{recursive:true,mode:0o700});writeFileSync(path,JSON.stringify(value,null,2)+'\n',{mode:0o600});}
function copyBaseline(base,output,preserveDesign=false){
  mkdirSync(output,{recursive:true,mode:0o700});
  const preserve=new Set(['cycle.json','design-review.json','index.html',...(preserveDesign?['design/gallery.html','design/manifest.json']:[])]),copied=[];
  for(const file of base.files){
    if(file.path.endsWith('.zip'))continue;
    const outputPath=preserve.has(file.path)?'baseline-evidence/'+file.path:file.path,target=join(output,outputPath);
    mkdirSync(resolve(target,'..'),{recursive:true,mode:0o700});copyFileSync(inside(base.root,file.path),target);
    if(digest(readFileSync(target))!==file.sha256)fail('BASELINE_COPY_MISMATCH','Copied baseline artifact failed readback');
    copied.push({sourcePath:file.path,outputPath,sha256:file.sha256,bytes:file.bytes});
  }
  return copied;
}
function refreshCoverage(fleet){
  const rows=fleet.agents;
  fleet.coverage={...fleet.coverage,assigned:rows.length,attempted:rows.filter(r=>r.attempted).length,
    validContributions:rows.filter(r=>r.primaryValidated).length,independentlyReviewed:rows.filter(r=>r.reviewStatus==='complete').length,
    notAttempted:rows.filter(r=>!r.attempted).length,blocked:rows.filter(r=>['blocked','disabled','deferred'].includes(r.status)).length,
    failed:rows.filter(r=>r.status==='failed').length,complete:rows.length>0&&rows.every(r=>r.attempted&&r.primaryValidated&&r.reviewStatus==='complete')};
}
function packageOutput(output){
  const files={};let size=0;
  function visit(dir,prefix=''){for(const item of readdirSync(dir,{withFileTypes:true})){
    if(item.isSymbolicLink())fail('INVALID_FOLLOWUP_PATH','Output archive contains a symlink');
    const name=prefix?prefix+'/'+item.name:item.name;
    if(item.isDirectory())visit(join(dir,item.name),name);else if(item.isFile()&&!name.endsWith('.zip')){
      const data=readFileSync(join(dir,item.name));size+=data.length;if(size>32*1024*1024)fail('FOLLOWUP_ARCHIVE_LIMIT','Review bundle exceeds32MiB');files[name]=new Uint8Array(data);
    }
  }}visit(output);writeFileSync(join(output,'roof-reports.zip'),Buffer.from(zipSync(files,{level:6})),{mode:0o600});
}

export async function runReviewFollowup({stateDir,baselineDir,outputDir,sourceRevision,baselineRunId,paidAllowed=false,
  apiKey=process.env.APINEX_API_KEY,requestRole=requestOrganizationRole,requestDesign=requestDesignConcept,
  generateMissingDesigns=false,auditCatalog=auditDesignCatalog,minimumDispatchIntervalMs=4200,
  catalogAuditor=auditModelCatalog,
  checkpoint=async()=>{},now=Date.now,signal}={}){
  if(!stateDir||!baselineDir||!outputDir||!REV.test(sourceRevision||''))fail('INVALID_FOLLOWUP_INPUT','Explicit retained state/baseline/output and exact operator revision are required');
  const base=loadBaseline(resolve(baselineDir),baselineRunId),output=resolve(outputDir),state=resolve(stateDir);
  for(const [a,b]of [[base.root,output],[output,base.root],[state,output],[output,state]]){const rel=relative(a,b);if(!rel||(!rel.startsWith('..')&&!isAbsolute(rel)))fail('INVALID_FOLLOWUP_PATH','State, baseline and output directories must not overlap');}
  const copiedFiles=copyBaseline(base,output,generateMissingDesigns===true);
  const followupHash=digest({protocol:REVIEW_FOLLOWUP_PROTOCOL,baselineRunId:base.runId,baselineCycleHash:base.cycleHash,
    baselineEvaluationHash:base.cycle.evaluationHash,baselineSourceRevision:base.cycle.sourceRevision,budgetPolicy:'three-dollar-shared-review-v1',
    generateMissingDesigns:generateMissingDesigns===true,qualificationPolicy:generateMissingDesigns===true?QUALIFICATION_POLICY:null});
  const workflowId=base.cycle.fleet.design.workflowId||'fleet-'+base.cycle.fleet.planHash.slice(0,32);
  const ceoId='review-followup-ceo-'+followupHash.slice(0,40),visionId='design-review-'+digest({protocol:'design-visual-review-v1',evaluationHash:followupHash,sourceRevision:base.cycle.sourceRevision,reviewer:'gpt-6.1-terra'}).slice(0,40);
  const store=new OrgStore(state,{now});
  let visual,ceo,qualification=null;
  try{
    store.recover();store.setControl('running');
    const initial=store.ledger(),qualificationHash=digest({followupHash,policy:QUALIFICATION_POLICY}),
      priorRequests=initial.attempts.filter(a=>a.workflow_id===workflowId&&![ceoId,visionId].includes(a.task_id)&&
        !store.events(a.task_id).some(e=>e.kind==='followup-design-qualified'&&e.detail?.evaluationHash===qualificationHash)).length;
    const retainedBudget=base.cycle.budget;
    if(!retainedBudget||![retainedBudget.totalRequests,retainedBudget.reportedUsd,retainedBudget.committedUsd,retainedBudget.unknownBillingRequests].every(n=>Number.isFinite(n)&&n>=0)||
      initial.requests<retainedBudget.totalRequests||initial.reportedUsd+1e-9<retainedBudget.reportedUsd||initial.reservedUsd+1e-9<retainedBudget.committedUsd||initial.unknownBillingRequests<retainedBudget.unknownBillingRequests)
      fail('BASELINE_LEDGER_MISSING','Latest retained spending history cannot be reset or reduced for a review follow-up');
    const additionalLimit=generateMissingDesigns===true?5:2;
    const configured={...LIMITS,requestLimit:Math.min(64,priorRequests+additionalLimit)};
    const proof=store.putArtifact(Buffer.from(JSON.stringify({baselineRunId:base.runId,sourceRevision:base.cycle.sourceRevision,
      evaluationHash:base.cycle.evaluationHash,cycleHash:base.cycleHash,manifestHash:base.manifestHash,
      qualification:generateMissingDesigns===true?{policy:QUALIFICATION_POLICY,evaluationHash:qualificationHash,promptSuffix:QUALIFICATION_SUFFIX}:null,
      scope:'Retained measurement evidence; no new tracing, measurements or PDF generation'})));
    const combinedDesign=clone(base.cycle.fleet.design);
    if(generateMissingDesigns===true){
      const candidates=combinedDesign.agents.filter(row=>row.status==='failed'&&row.code==='UPSTREAM_HTTP'&&
        !combinedDesign.artifacts.some(a=>a.model===row.model)).slice(0,3);
      const catalog=DESIGN_CATALOG.filter(entry=>candidates.some(row=>row.model===entry.id));
      const events=store.events(),blocked=new Map();
      for(const entry of catalog){
        if(events.some(e=>['design-model-circuit-open','fleet-model-circuit-open'].includes(e.kind)&&e.detail?.model===entry.id))blocked.set(entry.id,'DESIGN_MODEL_RECONCILIATION_REQUIRED');
        if(events.some(e=>(e.kind==='design-quota-cooldown'||e.kind==='fleet-quota-cooldown'&&e.detail?.scope!=='free-allowance')&&e.detail?.notBefore>now()))blocked.set(entry.id,'DESIGN_QUOTA_COOLDOWN');
      }
      const eligible=catalog.filter(entry=>!blocked.has(entry.id));
      if(eligible.length){
        const actualDesign=async(task,options)=>{
          const prompt=options.prompt+QUALIFICATION_SUFFIX,original=candidates.find(row=>row.model===options.model);
          const actual=store.putArtifact(Buffer.from(JSON.stringify({policy:QUALIFICATION_POLICY,model:options.model,prompt,
            originalTaskId:original.taskId,originalCode:original.code,baselineSourceRevision:base.cycle.sourceRevision,operatorSourceRevision:sourceRevision})));
          store.event(task.id,'followup-design-qualified',{evaluationHash:qualificationHash,model:options.model,originalTaskId:original.taskId,
            promptHash:actual.hash,operatorSourceRevision:sourceRevision,baselineSourceRevision:base.cycle.sourceRevision});
          return requestDesign(task,{...options,prompt});
        };
        qualification=await runDesignFleet({store,evaluationHash:qualificationHash,sourceRevision:base.cycle.sourceRevision,inputHash:proof.hash,
          paidAllowed,apiKey,checkpoint,requestDesign:actualDesign,catalog:eligible,outputDir:output,now,signal,
          limits:{...LIMITS,requestLimit:3},workflowId,workflowRequestLimit:configured.requestLimit,auditCatalog,minimumDispatchIntervalMs});
      }else qualification={agents:[],artifacts:[],coverage:{assigned:0,attempted:0,generated:0}};
      for(const original of candidates){
        const next=qualification.agents.find(row=>row.model===original.model);
        if(!next){qualification.agents.push({...clone(original),attempted:false,code:blocked.get(original.model)||'DESIGN_QUALIFICATION_NOT_ADMITTED',status:'blocked',originalTaskId:original.taskId});continue;}
        const event=store.events(next.taskId).find(e=>e.kind==='followup-design-qualified');
        Object.assign(next,{originalTaskId:original.taskId,qualificationPolicy:QUALIFICATION_POLICY,
          history:[...(original.history||[]),clone(original)],primaryValidated:next.status==='complete'&&!!next.artifact,
          reviewerModel:'gpt-6.1-terra',reviewStatus:'pending',
          operatorSourceRevision:event?.detail?.operatorSourceRevision||sourceRevision,measurementSourceRevision:base.cycle.sourceRevision});
        if(next.artifact)Object.assign(next.artifact,{generationOrigin:'qualification',qualificationEvaluationHash:qualificationHash,
          generationOperatorSourceRevision:next.operatorSourceRevision,originalTaskId:original.taskId,measurementSourceRevision:base.cycle.sourceRevision,
          qualificationPromptHash:event?.detail?.promptHash||null});
        combinedDesign.agents=combinedDesign.agents.map(row=>row.model===next.model?next:row);
      }
      combinedDesign.artifacts.push(...qualification.artifacts);
      combinedDesign.qualification={policy:QUALIFICATION_POLICY,evaluationHash:qualificationHash,agents:qualification.agents,
        catalog:qualification.catalog||null,budget:qualification.budget||null};
      combinedDesign.coverage={...combinedDesign.coverage,assigned:combinedDesign.agents.length,
        attempted:combinedDesign.agents.filter(row=>row.attempted).length,generated:combinedDesign.artifacts.length,
        failed:combinedDesign.agents.filter(row=>row.status==='failed').length,
        blocked:combinedDesign.agents.filter(row=>['blocked','disabled'].includes(row.status)).length,
        reviewPending:combinedDesign.artifacts.length,complete:combinedDesign.agents.length===6&&combinedDesign.agents.every(row=>row.status==='complete'&&row.artifact)};
      combinedDesign.totalRasterBytes=combinedDesign.artifacts.reduce((sum,image)=>sum+image.bytes,0);
    }
    let catalogAudit=null;
    if(paidAllowed&&apiKey)try{catalogAudit=await catalogAuditor({catalog:MODEL_CATALOG.filter(m=>['gpt-6.1-terra','claude-opus-5.5'].includes(m.id)),signal});}catch{catalogAudit={status:'unavailable',issuesByModel:{}};}
    const auditIssue=model=>catalogAudit?.status!=='verified'?'PUBLIC_CATALOG_UNVERIFIED':catalogAudit.issuesByModel?.[model]||null;
    visual=base.cycle.fleet.designReview?.attempted?{...clone(base.cycle.fleet.designReview),followupBlockedCode:'BASELINE_VISUAL_REVIEW_ALREADY_DISPATCHED'}:
      paidAllowed&&apiKey&&auditIssue('gpt-6.1-terra')&&!store.getTask(visionId)?{reviewerModel:'gpt-6.1-terra',status:'blocked',code:auditIssue('gpt-6.1-terra'),attempted:false,
        reviewCompleted:false,findings:[],reviewedImages:[],imageManifest:[],reportedUsd:0}:await reviewDesignConcepts({store,designFleet:{...combinedDesign,workflowId,evaluationHash:followupHash},
      evaluationHash:followupHash,sourceRevision:base.cycle.sourceRevision,inputHash:proof.hash,outputDir:output,
      paidAllowed,apiKey,requestRole,checkpoint,now,limits:configured,workflowId,signal});
    writeJSON(join(output,'design-review.json'),visual);
    const factsContext={metrics:base.cycle.metrics,pdfReview:base.cycle.pdfReview},facts=buildMetricFacts(factsContext);
    const oldCEO=base.cycle.fleet.agents.find(row=>row.role==='ceo'&&row.model==='claude-opus-5.5');
    const specialistRows=base.cycle.fleet.agents.map(row=>combinedDesign.agents.find(d=>d.model===row.model)||row);
    const specialists=specialistRows.filter(row=>row.model!==oldCEO.model).map(row=>({model:row.model,role:row.role,status:row.status,
      code:row.code||null,decision:row.decision||null,primaryValidated:row.primaryValidated===true,reviewStatus:row.reviewStatus,
      resultHash:row.resultHash||null,summary:row.summary?.slice(0,300)||null}));
    const context={protocol:REVIEW_FOLLOWUP_PROTOCOL,sourceRevision:base.cycle.sourceRevision,baselineRunId:base.runId,
      baselineEvaluationHash:base.cycle.evaluationHash,metrics:base.cycle.metrics,pdfReview:base.cycle.pdfReview,
      browserStatus:base.cycle.browserStatus,specialists,trustedMetricFacts:facts,
      designVisualReview:{reviewerModel:visual.reviewerModel,status:visual.status,reviewCompleted:visual.reviewCompleted,decision:visual.decision,
        findings:visual.findings,resultHash:visual.resultHash,imageManifest:visual.imageManifest,execution:visual.execution||null},
      task:'Review the retained deterministic baseline, specialist results, any explicitly qualified new visual concepts and the new pixel-based design review. Prioritize concrete fixes. Reject acceptance when recorded numeric/topology/PDF/browser checks fail. Return concise output with at most five findings and exact supplied metricClaims. No measurements or customer PDFs were regenerated. No field accuracy or production release is being approved.'};
    const contextArtifact=store.putArtifact(Buffer.from(JSON.stringify(context)));
    const task={schemaVersion:1,id:ceoId,workflowId,maxAttempts:1,role:'ceo',actorId:'retained-evidence-ceo',sourceRevision:base.cycle.sourceRevision,
      datasetRevision:REVIEW_FOLLOWUP_PROTOCOL,candidateHash:followupHash,policyVersion:REVIEW_FOLLOWUP_PROTOCOL,
      inputHashes:[proof.hash,contextArtifact.hash],artifacts:[contextArtifact.hash],stage:'retained-baseline-ceo-review',
      constraints:{maxAttempts:1,maxRuntimeMs:45000,maxOutputTokens:2000,requireMetricClaims:true,sourceHashes:[proof.hash]}};
    ceo={...clone(oldCEO),taskId:ceoId,previousTaskId:oldCEO.taskId,attempted:false,status:'blocked',code:null,decision:null,
      primaryValidated:false,resultHash:null,execution:null,reportedUsd:0,reviewStatus:'pending',reviewerModel:null,
      generationSourceRevision:base.cycle.sourceRevision,operatorSourceRevision:sourceRevision};
    const old=store.getTask(ceoId);let lease,rawHash=null;
    if(old){Object.assign(ceo,old.result||{},{taskId:ceoId,reused:true,status:old.status});ceo.attempted=store.events(ceoId).some(e=>e.kind==='dispatched');}
    else if(oldCEO.attempted)ceo={...clone(oldCEO),followupBlockedCode:'BASELINE_CEO_ALREADY_DISPATCHED'};
    else if(!paidAllowed||!apiKey)ceo.code=!paidAllowed?'CHECKPOINT_LINEAGE_BLOCKED':'CLOUD_SECRET_NOT_CONFIGURED';
    else if(auditIssue('claude-opus-5.5'))ceo.code=auditIssue('claude-opus-5.5');
    else try{
      const events=store.events();
      if(events.some(e=>['fleet-provider-circuit-open','cloud-provider-circuit-open','design-provider-circuit-open'].includes(e.kind)))fail('PROVIDER_AUTH_RECONCILIATION_REQUIRED','Provider reconciliation remains required');
      if(events.some(e=>['fleet-model-circuit-open','fleet-model-ambiguous-billing'].includes(e.kind)&&e.detail?.model==='claude-opus-5.5'))fail('CEO_MODEL_RECONCILIATION_REQUIRED','An earlier CEO model fault requires reconciliation');
      if(events.some(e=>(e.kind==='design-quota-cooldown'||(e.kind==='fleet-quota-cooldown'&&e.detail?.scope!=='free-allowance'))&&e.detail?.notBefore>now()))fail('CEO_QUOTA_COOLDOWN','Provider quota cooldown remains active');
      store.enqueue(task);lease=store.claim('retained-ceo',{leaseMs:120000});if(!lease||lease.id!==ceoId)fail('UNRESOLVED_QUEUE_WORK','Earlier work requires reconciliation');
      const response=await requestRole(task,{apiKey,model:'claude-opus-5.5',context,signal,
        reserve:async({usd})=>{const id=store.reserve(ceoId,'retained-ceo',lease.fence,{usd,...configured});await checkpoint({phase:'followup-ceo-reserved',taskId:ceoId});return id;},
        onDispatch:async id=>{store.dispatch(id,'retained-ceo',lease.fence);ceo.attempted=true;await checkpoint({phase:'followup-ceo-dispatched',taskId:ceoId});},
        onUsage:async(id,usage)=>{store.settle(id,'retained-ceo',lease.fence,usage);await checkpoint({phase:'followup-ceo-settled',taskId:ceoId});},
        onResponse:record=>{rawHash=store.putArtifact(Buffer.from(JSON.stringify(record))).hash;}});
      ceo.resultHash=store.putArtifact(Buffer.from(JSON.stringify(response))).hash;
      if(!ceo.attempted)fail('DISPATCH_EVIDENCE_MISSING','A response alone is not a CEO model dispatch');
      if(response.execution?.requestedModel!=='claude-opus-5.5'||response.execution?.returnedModel!=='claude-opus-5.5')fail('MODEL_MISMATCH','CEO returned model identity differs');
      const {actorId,...raw}=response.result||{};if(actorId!==undefined&&actorId!==task.actorId)fail('ACTOR_IDENTITY_MISMATCH','CEO actor does not match trusted assignment');
      const result=validateResult(raw,task);validateMetricClaims(result.metricClaims,facts);
      if(result.decision==='pass'&&(base.cycle.metrics.diagnosticPasses!==base.cycle.metrics.attempted||base.cycle.pdfReview.failed!==0||base.cycle.browserStatus!=='passed'))fail('UNSUPPORTED_CEO_APPROVAL','CEO cannot approve recorded failed checks');
      Object.assign(ceo,{status:result.decision==='reject'?'rejected':result.decision==='needs-human'?'needs-human':'complete',decision:result.decision,
        primaryValidated:true,execution:response.execution,summary:result.summary});
      store.finish(ceoId,'retained-ceo',lease.fence,{status:ceo.status,result:ceo});
    }catch(error){
      ceo.status='failed';ceo.code=error.code||'FOLLOWUP_CEO_FAILED';ceo.primaryValidated=false;ceo.rawResponseHash=rawHash;
      if(lease?.id===ceoId)try{store.finish(ceoId,'retained-ceo',lease.fence,{status:'failed',result:ceo,error:ceo.code});}catch{ceo.code='FOLLOWUP_CEO_RECONCILIATION_REQUIRED';}
      if(error.status===401)store.event(ceoId,'fleet-provider-circuit-open',{status:401,code:ceo.code});
      else if([400,403].includes(error.status)||ceo.code==='MODEL_MISMATCH')store.event(ceoId,'fleet-model-circuit-open',{model:'claude-opus-5.5',status:error.status||null,code:ceo.code});
      if(error.status===429)store.event(ceoId,'fleet-quota-cooldown',{scope:'provider',notBefore:now()+Math.max(60000,error.retryAfterMs||0)});
      if(store.ledger(ceoId).unknownBillingRequests)store.event(ceoId,'fleet-model-ambiguous-billing',{model:'claude-opus-5.5',taskId:ceoId});
    }
    if(ceo.taskId===ceoId){const ceoCosts=store.ledger(ceoId);ceo.reportedUsd=ceoCosts.unknownBillingRequests?null:ceoCosts.reportedUsd;}
    const report=clone(base.cycle);report.sourceRevision=sourceRevision;report.generatedAt=new Date(now()).toISOString();
    report.baseline={runId:base.runId,sourceRevision:base.cycle.sourceRevision,evaluationHash:base.cycle.evaluationHash,cycleHash:base.cycleHash,
      manifestHash:base.manifestHash,artifactCount:base.files.length,source:'Retained repository workflow artifact; caller verifies download provenance, local hashes verified here'};
    const qualifiedConceptsRelativeToBaseline=qualification?.artifacts.length||0;
    const newlyGeneratedConcepts=qualification?.agents.filter(row=>row.artifact&&!row.reused).length||0;
    report.executionMode='review-existing';report.newlyGeneratedCases=0;report.newlyGeneratedCustomerPDFs=0;report.retainedCustomerPDFs=base.cycle.metrics.generatedCustomerPDFs;
    report.newlyGeneratedConcepts=newlyGeneratedConcepts;
    report.followup={protocol:REVIEW_FOLLOWUP_PROTOCOL,evaluationHash:followupHash,operatorSourceRevision:sourceRevision,
      measurementSourceRevision:base.cycle.sourceRevision,newlyGeneratedCases:0,newlyGeneratedCustomerPDFs:0,newlyGeneratedConcepts,
      qualifiedConceptsRelativeToBaseline,catalogAudit,
      generateMissingDesigns:generateMissingDesigns===true,qualification:qualification?{policy:QUALIFICATION_POLICY,evaluationHash:qualificationHash,
        agents:qualification.agents,catalog:qualification.catalog||null,artifacts:qualification.artifacts}:null,
      copiedFiles,originalFileInventory:base.files,omittedOriginalArchives:base.files.filter(file=>file.path.endsWith('.zip')),
      allowedAdditionalRequests:additionalLimit,visionTaskId:visionId,ceoTaskId:ceoId,baselineWorkflowId:workflowId};
    report.fleet.design=combinedDesign;
    report.fleet.agents=report.fleet.agents.map(row=>row.model==='claude-opus-5.5'&&row.role==='ceo'?ceo:
      combinedDesign.agents.find(d=>d.model===row.model)||row);
    const terra=report.fleet.agents.find(row=>row.model==='gpt-6.1-terra');
    if(terra){terra.additionalReviews=[...(terra.additionalReviews||[]).filter(r=>r.followupHash!==followupHash),{followupHash,kind:'design-visual-review',...visual}];}
    report.fleet.designReview={...visual,baselineSourceRevision:base.cycle.sourceRevision,baselineEvaluationHash:base.cycle.evaluationHash};
    if(visual.reviewCompleted){
      const hashes=new Set(visual.reviewedImages.map(image=>image.sha256));
      report.fleet.agents=report.fleet.agents.map(row=>row.artifact&&hashes.has(row.artifact.sha256)?{...row,reviewStatus:'complete',reviewerModel:visual.reviewerModel,designReviewDecision:visual.decision}:row);
      report.fleet.design.artifacts=report.fleet.design.artifacts.map(image=>hashes.has(image.sha256)?{...image,reviewStatus:'reviewed',reviewerModel:visual.reviewerModel}:image);
      report.fleet.design.reviewStatus='reviewed';
      report.fleet.design.coverage={...report.fleet.design.coverage,reviewPending:0};
    }
    refreshCoverage(report.fleet);report.reviews=clone(report.fleet.agents);
    const ledger=store.ledger();report.budget={...report.budget,...LIMITS,requestLimit:configured.requestLimit,totalRequests:ledger.requests,
      reportedUsd:ledger.reportedUsd,committedUsd:ledger.reservedUsd,unknownBillingRequests:ledger.unknownBillingRequests};
    report.fleet.budget={...report.fleet.budget,...report.budget};
    report.fleet.design.budget={...report.fleet.design.budget,...report.budget};
    report.decision=monitoringDecision(report.metrics,report.reviews,report.pdfReview,report.browserStatus,report.fleet);
    report.scope=`Retained baseline reports and measurements; ${newlyGeneratedConcepts} new qualification concepts, visual and CEO review. No new tracing, PDF rendering, field truth or production approval.`;
    const escape=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
    const cards=report.fleet.design.agents.map(row=>{
      const image=report.fleet.design.artifacts.find(a=>a.model===row.model);
      const notes=image?(visual.findings||[]).filter(f=>f.evidence?.includes(`model:${image.model};sha256:${image.sha256}`)):[];
      return `<article><h2>${escape(row.model)}</h2>${image?`<img loading="lazy" src="${escape(image.path.split('/').at(-1))}" alt="Unimplemented design concept"><p>${image.generationOrigin==='qualification'?'New bounded qualification concept':'Retained baseline concept'}. ${visual.reviewCompleted?'Independent pixel review recorded':'Visual review remains incomplete'}.</p>`:`<p>Generation ${escape(row.status)}: ${escape(row.code||'No image retained')}.</p>`}${(row.history||[]).length?'<p>Prior failed generation retained in the task history.</p>':''}${notes.map(f=>`<p>${escape(f.message)}</p>`).join('')}</article>`;
    }).join('');
    writeFileSync(join(output,'design','review-gallery.html'),`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none';img-src 'self';style-src 'unsafe-inline';base-uri 'none'"><title>Retained concept reviews</title><style>body{font:16px system-ui;max-width:1100px;margin:auto;padding:20px}main{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,280px),1fr));gap:20px}article{border:1px solid #bbb;padding:18px}img{width:100%;height:auto}</style><h1>Retained design concepts</h1><p>Original source ${escape(base.cycle.sourceRevision)}. New visual review: ${escape(visual.status)}. Concepts remain unimplemented and are not roof measurements or approved application changes.</p><main>${cards}</main>`,{mode:0o600});
    report.fleet.design.generationGalleryPath=generateMissingDesigns===true?'baseline-evidence/design/gallery.html':report.fleet.design.galleryPath;
    report.fleet.design.galleryPath='design/review-gallery.html';
    writeJSON(join(output,'cycle.json'),report);writeJSON(join(output,'followup.json'),report.followup);
    for(const [name,hash]of [['followup-ceo.json',ceo.resultHash],['followup-design-review.json',visual.resultHash]])if(hash)writeFileSync(join(output,name),store.readArtifact(hash),{mode:0o600});
    writeFileSync(join(output,'index.html'),`<!doctype html><meta charset="utf-8"><title>Retained roof evidence review</title><h1>Retained evidence review</h1><p>Original measurement source: ${escape(base.cycle.sourceRevision)}. Review operator: ${escape(sourceRevision)}.</p><p>No cases, measurements or customer reports were regenerated. ${newlyGeneratedConcepts} new qualification concepts. All original attempts and spending holds remain.</p><p><a href="roof-reports.zip">Download retained reports and new reviews</a> · <a href="design/review-gallery.html">Concept gallery and visual review</a></p><pre>${escape(JSON.stringify({baseline:report.baseline,metrics:report.metrics,visual:{status:visual.status,reviewCompleted:visual.reviewCompleted},ceo:{status:ceo.status,attempted:ceo.attempted,decision:ceo.decision},decision:report.decision,budget:report.budget},null,2))}</pre>`,{mode:0o600});
    packageOutput(output);await checkpoint({phase:'review-followup-complete',evaluationHash:followupHash});return report;
  }finally{store.setControl('paused');store.close();}
}

if(process.argv[1]===fileURLToPath(import.meta.url)){
  const args=process.argv.slice(2),arg=(name,fallback)=>{const i=args.indexOf(name);return i<0?fallback:args[i+1];};
  const sourceRevision=execFileSync('git',['rev-parse','HEAD'],{cwd:fileURLToPath(new URL('..',import.meta.url)),encoding:'utf8'}).trim();
  runReviewFollowup({stateDir:arg('--state','.cloud-state'),baselineDir:arg('--baseline','retained-baseline'),outputDir:arg('--output','cloud-output'),
    baselineRunId:arg('--baseline-run',null),sourceRevision,generateMissingDesigns:args.includes('--generate-missing-designs'),paidAllowed:process.env.ROOF_CLOUD_PAID_ALLOWED==='true',
    apiKey:process.env.ROOF_CLOUD_PAID_ALLOWED==='true'?process.env.APINEX_API_KEY:null}).then(report=>console.log(JSON.stringify({baseline:report.baseline,followup:report.followup,coverage:report.fleet.coverage,budget:report.budget})))
    .catch(error=>{console.error(error.message);process.exitCode=1;});
}
