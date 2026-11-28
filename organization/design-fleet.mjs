import {createHash} from 'node:crypto';
import {mkdirSync,lstatSync,writeFileSync,renameSync} from 'node:fs';
import {resolve,join,parse} from 'node:path';
import {setTimeout as wait} from 'node:timers/promises';
import {DESIGN_CATALOG,DESIGN_CATALOG_METADATA,auditDesignCatalog} from './design-catalog.mjs';
import {requestDesignConcept,inspectDesignImage} from './design-provider.mjs';

export const DESIGN_PROTOCOL='roof-design-concepts-v1';
export const DESIGN_LIMITS=Object.freeze({requestLimit:6,maxUsd:2,hourUsd:2,dayUsd:3,weekUsd:20,monthUsd:80});
const MAX_IMAGE_BYTES=4*1024*1024,MAX_TOTAL_IMAGE_BYTES=24*1024*1024;
const hash=value=>createHash('sha256').update(Buffer.isBuffer(value)||typeof value==='string'?value:JSON.stringify(value)).digest('hex');
const fail=(code,message)=>{const error=new Error(message);error.code=code;throw error;};
const text=(value,max=200)=>typeof value==='string'&&value.length>0&&value.length<=max;
const COMMON='Create a single polished raster DESIGN CONCEPT for Diversity Contracting Roof Measure. Use only synthetic placeholders: Example property, source pending, and em dashes for every quantity. No real addresses, customer information, roof measurements, accuracy percentages, certification, purchasing claims or production approval. Make the word CONCEPT clearly visible. All content is a visual proposal requiring independent review. Do not depict a customer roof divided into planes or sections. Use restrained grayscale branding, clear hierarchy and readable labels. Output one coherent design board, not a collage of unrelated styles.';
export const DESIGN_ASSIGNMENTS=Object.freeze([
  {model:'free/nano-banana-2',team:'mobile workspace and accessibility',
    task:'Design an accessible mobile roof-review workspace.',
    prompt:'Show a mobile-first internal review workspace with a neutral generic roof outline, source selection, large touch controls, keyboard-focus treatment, undo, review status and clear export action. Use Example property and unknown quantities. Show accessibility through spacing, text labels and contrast, never color alone. Keep source review and final export visually distinct. No satellite photo or segmented roof plan.'},
  {model:'nano-banana-2',team:'customer report cover and branding',
    task:'Design a professional customer report cover and brand hierarchy.',
    prompt:'Compose a portrait US Letter report cover centered within the square image. Use Diversity Contracting as text branding with a generic monogram placeholder, a Roof Measurement Review title, Example property, source/date placeholders and Review required status. Show projected area, sloped area and roof squares as separate elegant summary cards with em dashes. Include no roof illustration, aerial image, segmented geometry or invented logo.'},
  {model:'gpt-image-2.6-flare',team:'icons and roof-edge glossary',
    task:'Design a consistent icon and roof-edge legend system.',
    prompt:'Create a disciplined vector-style icon concept sheet for the internal application: eave, rake, ridge, hip, valley, perimeter, source review, correction, undo and export. Pair abstract standalone line glyphs with readable labels. Keep stroke weights, spacing and visual language consistent; include a simple monochrome and high-contrast usage example. Do not draw a roof divided into sections, dimensions or a fake measurement diagram.'},
  {model:'gpt-image-2.6-sunburst',team:'Letter typography and measurement schedules',
    task:'Design professional Letter report typography and summary schedules.',
    prompt:'Show one portrait US Letter measurement report page centered inside the square canvas. Establish clear typography, aligned summary cards, generous margins, a concise area/pitch table, an edge-length schedule, unavailable-value treatment and source/review notes. Values must all be em dashes or Unknown. Distinguish footprint from sloped area and inferred from reviewed status. No imagery, diagrams, segmented roof drawing or numeric measurement claims.'},
  {model:'seedream-5',team:'grayscale report consistency',
    task:'Design a consistent grayscale report identity across pages.',
    prompt:'Create a cohesive grayscale brand-system board with three coordinated portrait report-page thumbnails: cover, measurement schedule and source/review notes. Reuse the same text branding, type hierarchy, rules, margins, footer and status treatment. Use only Example property, generic text placeholders and em dashes for quantities. The pages must feel like one professional roofing report, with no photographs, roof diagrams or plane segmentation.'},
  {model:'grok-imagine-2',team:'uncertainty and manual review experience',
    task:'Design actionable error, uncertainty and manual-review screens.',
    prompt:'Show a calm desktop roof-review application concept for an ambiguous source and unavailable scale or pitch. Include clear Review required status, a concise explanation, preserved-job feedback and visible actions to review source, choose the building, correct the outline, enter supported calibration, retry or cancel. Use synthetic placeholders and unknown quantities. Make the safe next step obvious, preserve useful work, and avoid implying that missing measurements are zero or accurate.'},
]);

function safeDirectory(directory){
  const absolute=resolve(directory),root=parse(absolute).root;let current=root;
  for(const part of absolute.slice(root.length).split(/[\\/]/).filter(Boolean)){
    current=join(current,part);
    try{if(lstatSync(current).isSymbolicLink())fail('UNSAFE_DESIGN_PATH','Design output cannot traverse symlinks');}catch(error){if(error.code!=='ENOENT')throw error;}
  }
  mkdirSync(absolute,{recursive:true,mode:0o700});return absolute;
}
function writeArtifact(directory,name,bytes){
  const destination=join(directory,name),temporary=destination+'.'+process.pid+'.tmp';
  writeFileSync(temporary,bytes,{mode:0o600});renameSync(temporary,destination);
}
function validateImage(bytes,response){
  if(!Buffer.isBuffer(bytes)||bytes.length<24||bytes.length>MAX_IMAGE_BYTES)fail('DESIGN_IMAGE_SIZE_LIMIT','Design image must be bounded nonempty raster bytes');
  const actual=inspectDesignImage(bytes);
  if(!Number.isInteger(actual.width)||!Number.isInteger(actual.height)||actual.width<1||actual.height<1||actual.width>8192||actual.height>8192||actual.width*actual.height>32*1024*1024)
    fail('DESIGN_IMAGE_DIMENSION_LIMIT','Raster dimensions exceed the concept safety bound');
  if(response.width!==actual.width||response.height!==actual.height||!['png','jpg','jpeg'].includes(response.extension)||
    (response.extension==='png')!==(actual.extension==='png')||response.sha256!==hash(bytes))
    fail('DESIGN_IMAGE_METADATA_MISMATCH','Generated raster metadata does not match its actual bytes');
  return actual;
}
function limitsOf(value){
  const limits={...DESIGN_LIMITS,...value};
  for(const [key,number]of Object.entries(limits))if(!Object.hasOwn(DESIGN_LIMITS,key)||!Number.isFinite(number)||number<0)fail('INVALID_DESIGN_LIMIT','Invalid design spending/request limit');
  if(!Number.isInteger(limits.requestLimit)||limits.requestLimit>6||limits.maxUsd>2||limits.hourUsd>2||limits.dayUsd>3||limits.weekUsd>20||limits.monthUsd>80)
    fail('INVALID_DESIGN_LIMIT','Design limits exceed the configured shared ceilings');
  return limits;
}
function dispatched(store,id){return store.events(id).some(event=>event.kind==='dispatched');}
function budgetBlock(store,workflowId,reservation,limits,now,requestCap){
  const ledger=store.ledger();if(ledger.budgetIncident)return 'BUDGET_INCIDENT';
  const attempts=ledger.attempts,work=attempts.filter(a=>a.workflow_id===workflowId),sum=rows=>rows.reduce((n,a)=>n+a.charged_usd,0);
  const date=new Date(now),month=Date.UTC(date.getUTCFullYear(),date.getUTCMonth(),1);
  if(work.length>=requestCap)return 'DESIGN_REQUEST_LIMIT';
  if(sum(work)+reservation>limits.maxUsd||sum(attempts.filter(a=>a.created>=now-3600000))+reservation>limits.hourUsd||
    sum(attempts.filter(a=>a.created>=now-86400000))+reservation>limits.dayUsd||sum(attempts.filter(a=>a.created>=now-7*86400000))+reservation>limits.weekUsd||
    sum(attempts.filter(a=>a.created>=month))+reservation>limits.monthUsd)return 'BUDGET_LIMIT';
  return null;
}
function gallery(directory,agents){
  const escape=value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
  const cards=agents.map(agent=>`<article><h2>${escape(agent.team)}</h2><p>${escape(agent.model)}</p><p>${escape(agent.task)}</p>${agent.artifact?`<a href="${escape(agent.artifact.path.split('/').at(-1))}"><img loading="lazy" src="${escape(agent.artifact.path.split('/').at(-1))}" alt="${escape(agent.task)} — unapproved design concept"></a>`:`<p class="status">${escape(agent.status)}: ${escape(agent.code)}</p>`}<p class="status">Concept only · Review pending · No measurement use</p></article>`).join('');
  writeArtifact(directory,'gallery.html',Buffer.from(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>Roof Measure design concepts</title><style>body{font:16px system-ui,sans-serif;max-width:1100px;margin:auto;padding:24px;color:#222;background:#f5f5f5}main{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:20px}article{background:white;padding:20px;border:1px solid #bbb;border-radius:10px}h2{font-size:20px}img{display:block;width:100%;height:auto}.status{font-weight:600}header{margin-bottom:28px}</style><header><h1>Design concepts — review pending</h1><p>Generated visual proposals for the Roof Measure application and report experience. These images are not roof measurements, reference reports, approved branding or application changes.</p></header><main>${cards}</main></html>`));
}

/** Six bounded concept requests, sharing the same durable account spending ledger. */
export async function runDesignFleet({store,evaluationHash,sourceRevision,inputHash,paidAllowed=false,apiKey=process.env.APINEX_API_KEY,
  checkpoint=async()=>{},requestDesign=requestDesignConcept,catalog=DESIGN_CATALOG,outputDir,now=Date.now,signal,limits={},workflowId,
  auditCatalog=auditDesignCatalog,catalogAudit,runtimeMs=15*60000,minimumDispatchIntervalMs=4200,
  waitImpl=(ms,options)=>wait(ms,null,options),archiveRef}={}){
  if(!text(evaluationHash,200)||!text(sourceRevision,200)||!/^([a-f0-9]{64})$/.test(inputHash||'')||!text(outputDir,2000))fail('INVALID_DESIGN_INPUT','Frozen source/input/evaluation and output directory are required');
  if(!Array.isArray(catalog)||!catalog.length||catalog.length>64||catalog.some(m=>!text(m?.id)||!Number.isFinite(m?.reserveUsd)||m.reserveUsd<0)||new Set(catalog.map(m=>m.id)).size!==catalog.length)
    fail('INVALID_DESIGN_CATALOG','Design models must have unique IDs and verified bounded flat-price reservations');
  if(!Number.isInteger(runtimeMs)||runtimeMs<0||runtimeMs>15*60000||!Number.isFinite(minimumDispatchIntervalMs)||minimumDispatchIntervalMs<0||minimumDispatchIntervalMs>10000)
    fail('INVALID_DESIGN_LIMIT','Design runtime is bounded to15minutes and pacing to0..10000ms');
  const actualLimits=limitsOf(limits),deadline=now()+runtimeMs,timeout=AbortSignal.timeout(Math.max(1,runtimeMs));
  const phaseSignal=signal?AbortSignal.any([signal,timeout]):timeout;
  const directory=safeDirectory(join(outputDir,'design')),assignments=new Map(DESIGN_ASSIGNMENTS.map(a=>[a.model,a]));
  const identity={protocol:DESIGN_PROTOCOL,evaluationHash,sourceRevision,inputHash,promptVersion:DESIGN_PROTOCOL};
  const archive=archiveRef||{repository:process.env.GITHUB_REPOSITORY||null,runId:process.env.GITHUB_RUN_ID||null,
    runAttempt:process.env.GITHUB_RUN_ATTEMPT||null,
    reportArtifactName:process.env.GITHUB_RUN_ID&&process.env.GITHUB_RUN_ATTEMPT?`roof-cloud-reports-${process.env.GITHUB_RUN_ID}-${process.env.GITHUB_RUN_ATTEMPT}`:null};
  workflowId=workflowId||'design-'+hash(identity).slice(0,32);
  if(!/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$/.test(workflowId))fail('INVALID_DESIGN_INPUT','Invalid shared workflow identity');
  let audit=catalogAudit||null,auditError=null;
  if(!audit&&paidAllowed&&apiKey&&store&&runtimeMs>=120000)try{audit=await auditCatalog({signal:phaseSignal});}catch(error){auditError=error.code||'DESIGN_CATALOG_UNAVAILABLE';}
  const existingEvents=store?.events()||[],agents=[],artifacts=[];let totalBytes=0,authBlocked=false,quotaUntil=0;
  if(existingEvents.some(e=>['design-provider-circuit-open','fleet-provider-circuit-open','cloud-provider-circuit-open'].includes(e.kind)))authBlocked=true;
  for(const event of existingEvents)if(event.kind==='design-quota-cooldown')quotaUntil=Math.max(quotaUntil,event.detail?.notBefore||0);
  if(store){store.recover();store.setControl('running');}
  const otherWorkflowRequests=store?store.ledger().attempts.filter(a=>a.workflow_id===workflowId&&store.getTask(a.task_id)?.stage!=='design-concept').length:0;
  const requestCap=Math.min(64,otherWorkflowRequests+actualLimits.requestLimit);
  function restoreImage(row,result){
    const bytes=store.readArtifact(result.imageHash),actual=validateImage(bytes,{...result,sha256:result.imageHash});
    if(totalBytes+bytes.length>MAX_TOTAL_IMAGE_BYTES)fail('DESIGN_ARCHIVE_LIMIT','Design raster output exceeds24MiB');
    const filename=hash(row.model).slice(0,16)+'-'+result.imageHash.slice(0,16)+'.'+actual.extension;
    writeArtifact(directory,filename,bytes);totalBytes+=bytes.length;
    const artifact={model:row.model,taskId:row.taskId,path:'design/'+filename,mimeType:actual.mimeType,extension:actual.extension,
      sha256:result.imageHash,bytes:bytes.length,width:actual.width,height:actual.height,sourceRevision,
      artifactKind:'raster-design-concept',reviewStatus:'pending',measurementUse:false};
    row.artifact=artifact;artifacts.push(artifact);return artifact;
  }
  for(const entry of catalog){
    const assignment=assignments.get(entry.id),prompt=assignment?COMMON+' '+assignment.prompt:null;
    const row={model:entry.id,team:assignment?.team||'unassigned design model',role:'reporting',task:assignment?.task||'A reviewed design assignment is required.',
      taskId:'design-'+hash({...identity,model:entry.id,prompt}).slice(0,48),status:'blocked',code:null,attempted:false,reportedUsd:0,execution:null,
      contributionKind:'design-concept',artifact:null,reviewStatus:'pending',measurementUse:false,productionApproved:false};agents.push(row);
    const old=store?.getTask(row.taskId);
    if(old){
      row.attempted=dispatched(store,row.taskId);const billed=store.ledger(row.taskId);row.reportedUsd=billed.unknownBillingRequests?null:billed.reportedUsd;
      row.status=old.status;row.code=old.result?.code||null;row.execution=old.result?.execution||null;row.reused=true;
      if(old.result?.imageHash)try{restoreImage(row,old.result);}catch(error){
        if(error.code==='ENOENT'){
          row.status='blocked';row.code='ARTIFACT_ARCHIVED';row.archivedArtifact={sha256:old.result.imageHash,archiveRef:old.result.archiveRef||null};
        }else{row.status='failed';row.code=error.code||'DESIGN_ARTIFACT_UNREADABLE';}
      }
      continue;
    }
    if(!assignment){row.code='DESIGN_ASSIGNMENT_REQUIRED';continue;}
    if(!paidAllowed||!apiKey||!store){row.status='disabled';row.code=!paidAllowed?'CHECKPOINT_LINEAGE_BLOCKED':!apiKey?'CLOUD_SECRET_NOT_CONFIGURED':'DURABLE_STORE_UNAVAILABLE';continue;}
    if(signal?.aborted){row.code='CANCELLED';continue;}
    if(timeout.aborted||now()+120000>deadline){row.code='DESIGN_RUNTIME_LIMIT';continue;}
    if(authBlocked){row.code='PROVIDER_AUTH_RECONCILIATION_REQUIRED';continue;}
    if(quotaUntil>now()){row.code='DESIGN_QUOTA_COOLDOWN';continue;}
    if(existingEvents.some(e=>e.kind==='design-model-circuit-open'&&e.detail?.model===entry.id)){row.code='DESIGN_MODEL_RECONCILIATION_REQUIRED';continue;}
    if(!audit||!Array.isArray(audit.readyIds)){row.code=auditError||'DESIGN_CATALOG_UNVERIFIED';continue;}
    if(!audit.readyIds.includes(entry.id)){row.code=audit.blocked?.find(m=>m.id===entry.id)?.code||'DESIGN_MODEL_NOT_READY';continue;}
    const blocked=budgetBlock(store,workflowId,entry.reserveUsd,actualLimits,now(),requestCap);
    if(blocked){row.code=blocked;continue;}
    const priorDispatch=store.events().filter(e=>['fleet-dispatched','design-dispatched'].includes(e.kind)).at(-1)?.created;
    const delay=priorDispatch==null||minimumDispatchIntervalMs===0?0:Math.max(0,priorDispatch+minimumDispatchIntervalMs-now());
    if(now()+delay+120000>deadline){row.code='DESIGN_RUNTIME_LIMIT';continue;}
    const promptArtifact=store.putArtifact(Buffer.from(JSON.stringify({protocol:DESIGN_PROTOCOL,model:entry.id,prompt,assignment:assignment.task,conceptOnly:true})));
    const task={schemaVersion:1,id:row.taskId,workflowId,maxAttempts:1,role:'reporting',actorId:'design-'+hash(entry.id).slice(0,24),sourceRevision,
      datasetRevision:DESIGN_PROTOCOL,candidateHash:hash({...identity,model:entry.id,prompt}),policyVersion:DESIGN_PROTOCOL,
      inputHashes:[...new Set([inputHash,promptArtifact.hash])],artifacts:[promptArtifact.hash],stage:'design-concept',constraints:{maxAttempts:1,maxRuntimeMs:120000,sourceHashes:[inputHash]}};
    let lease=null,heartbeat=null,response=null,rawMetadata=null,dispatchedNow=false;
    const localAbort=new AbortController(),callSignal=AbortSignal.any([phaseSignal,localAbort.signal]);
    try{
      if(store.listTasks().some(t=>['pending','leased'].includes(t.status)&&t.id!==task.id))fail('DESIGN_QUEUE_RECONCILIATION_REQUIRED','Earlier queue work must be reconciled before image admission');
      store.enqueue(task);lease=store.claim('design-worker',{leaseMs:120000});
      if(!lease||lease.id!==task.id)fail('DESIGN_QUEUE_RECONCILIATION_REQUIRED','Design lease could not be acquired');
      heartbeat=setInterval(()=>{try{if(store.getControl()==='stopped')localAbort.abort();else store.heartbeat(task.id,'design-worker',lease.fence,120000);}catch{localAbort.abort();}},15000);
      if(delay)await waitImpl(delay,{signal:callSignal});
      response=await requestDesign(task,{model:entry.id,prompt,apiKey,signal:callSignal,timeoutMs:120000,
        reserve:async({usd})=>{if(usd!==entry.reserveUsd)fail('DESIGN_RESERVATION_MISMATCH','Image reservation differs from verified flat-price hold');const id=store.reserve(task.id,'design-worker',lease.fence,{usd,...actualLimits,requestLimit:requestCap});await checkpoint({phase:'design-reserved',taskId:task.id,model:entry.id});return id;},
        onDispatch:async id=>{if(timeout.aborted||now()+120000>deadline)fail('DESIGN_RUNTIME_LIMIT','Insufficient design runtime before image dispatch');store.dispatch(id,'design-worker',lease.fence);dispatchedNow=true;row.attempted=true;store.event(task.id,'design-dispatched',{model:entry.id});await checkpoint({phase:'design-dispatched',taskId:task.id,model:entry.id});},
        onUsage:async(id,usage)=>{store.settle(id,'design-worker',lease.fence,usage);await checkpoint({phase:'design-settled',taskId:task.id,model:entry.id});},
        onResponse:record=>{rawMetadata=store.putArtifact(Buffer.from(JSON.stringify(record)));}});
      if(!dispatchedNow)fail('DESIGN_DISPATCH_EVIDENCE_MISSING','An adapter response without durable dispatch is not model participation');
      if(response.contributionKind!=='design-concept'||response.execution?.requestedModel!==entry.id||
        (response.execution.returnedModel!==null&&response.execution.returnedModel!==entry.id)||
        (response.execution.returnedModel===null&&response.execution.identityStatus!=='not-reported'))
        fail('DESIGN_MODEL_IDENTITY_MISMATCH','Image model identity is missing, changed or falsely asserted');
      const actual=validateImage(response.imageBytes,response),image=store.putArtifact(response.imageBytes);
      const result={imageHash:image.hash,extension:actual.extension,width:actual.width,height:actual.height,execution:response.execution,
        metadata:response.artifactMetadata||null,promptHash:promptArtifact.hash,expectedPriceUsd:entry.priceUsd,reservedUsd:entry.reserveUsd,
        catalogAuditHash:audit.hash||null,archiveRef:archive,conceptOnly:true,measurementUse:false,reviewStatus:'pending',code:null};
      restoreImage(row,result);row.status='complete';row.execution=response.execution;
      store.finish(task.id,'design-worker',lease.fence,{status:'complete',result});
      store.event(task.id,'design-image-cached',{hash:image.hash,taskId:task.id,evaluationHash,model:entry.id,archiveRef:archive});
    }catch(error){
      row.status='failed';row.code=error.code||'DESIGN_GENERATION_FAILED';
      if(lease?.id===task.id)try{store.finish(task.id,'design-worker',lease.fence,{status:'failed',result:{rawMetadataHash:rawMetadata?.hash||null,code:row.code},error:row.code});}catch{row.code='DESIGN_LEASE_RECONCILIATION_REQUIRED';store.recover();}
      if(error.status===401){authBlocked=true;store.event(null,'design-provider-circuit-open',{status:401,code:row.code});store.event(null,'fleet-provider-circuit-open',{status:401,code:row.code});}
      else if([400,403].includes(error.status)||['DESIGN_MODEL_IDENTITY_MISMATCH','MODEL_MISMATCH','SUBSCRIPTION_REQUIRED'].includes(row.code))store.event(null,'design-model-circuit-open',{model:entry.id,status:error.status||null,code:row.code});
      if(error.status===429){quotaUntil=now()+Math.max(60000,error.retryAfterMs||0);store.event(null,'design-quota-cooldown',{notBefore:quotaUntil,model:entry.id});}
      if(store.ledger(task.id).unknownBillingRequests)store.event(null,'design-unknown-flat-reservation-retained',{model:entry.id,taskId:task.id,reservedUsd:entry.reserveUsd});
    }finally{
      if(heartbeat)clearInterval(heartbeat);
      row.attempted=dispatched(store,row.taskId);const billed=store.ledger(row.taskId);row.reportedUsd=billed.unknownBillingRequests?null:billed.reportedUsd;
      await checkpoint({phase:'design-task-finished',taskId:task.id,model:entry.id});
    }
  }
  gallery(directory,agents);
  const ledger=store?.ledger()||{requests:null,reportedUsd:null,reservedUsd:null,unknownBillingRequests:null};
  const report={protocol:DESIGN_PROTOCOL,evaluationHash,sourceRevision,workflowId,
    catalog:{checkedAt:audit?.checkedAt||DESIGN_CATALOG_METADATA.checkedAt,auditHash:audit?.hash||null,verified:!!audit,unknownIds:audit?.unknownIds||[]},
    agents,coverage:{assigned:agents.length,attempted:agents.filter(a=>a.attempted).length,generated:artifacts.length,
      failed:agents.filter(a=>a.status==='failed').length,blocked:agents.filter(a=>a.status==='blocked'||a.status==='disabled').length,
      reviewPending:artifacts.length,archived:agents.filter(a=>a.code==='ARTIFACT_ARCHIVED').length,
      complete:agents.length===6&&agents.every(a=>a.attempted&&a.status==='complete'&&a.artifact)},
    artifacts,galleryPath:'design/gallery.html',budget:{...actualLimits,totalRequests:ledger.requests,reportedUsd:ledger.reportedUsd,
      committedUsd:ledger.reservedUsd,unknownBillingRequests:ledger.unknownBillingRequests},
    totalRasterBytes:totalBytes,measurementUse:false,productionApproved:false,reviewStatus:'pending'};
  writeArtifact(directory,'manifest.json',Buffer.from(JSON.stringify(report,null,2)));
  if(store){const artifact=store.putArtifact(Buffer.from(JSON.stringify(report)));store.event(null,'design-fleet-finished',{evaluationHash,manifestHash:artifact.hash,coverage:report.coverage});}
  return report;
}
