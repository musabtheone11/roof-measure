import {createHash} from 'node:crypto';
import {mkdir,readFile,writeFile,readdir,lstat,rm} from 'node:fs/promises';
import {resolve,join,relative,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {CATALOG_METADATA} from './model-catalog.mjs';
const execute=promisify(execFile);
const WORKFLOW='roof-cloud.yml',BUDGET_VERSION='roof-cloud-budget-v1';
const MANIFEST='cloud-checkpoint.json',BOOTSTRAP='cloud-bootstrap.json';
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const repoOK=repo=>typeof repo==='string'&&/^[\w.-]+\/[\w.-]+$/.test(repo);
const fail=message=>{throw new Error(message);};
function context(env=process.env) {
  if(!repoOK(env.GITHUB_REPOSITORY)||!/^\d+$/.test(env.GITHUB_RUN_ID||'')||!/^\d+$/.test(env.GITHUB_RUN_ATTEMPT||''))fail('GitHub repository/run/attempt context is required');
  return {repository:env.GITHUB_REPOSITORY,runId:String(env.GITHUB_RUN_ID),runAttempt:Number(env.GITHUB_RUN_ATTEMPT),branch:env.GITHUB_REF_NAME||'unknown',sourceRevision:env.ROOF_SOURCE_REVISION||env.GITHUB_SHA||'unknown'};
}
export function previousExecution(current,runs,{priorAttempts={}}={}) {
  // A rerun follows its own prior attempt unless newer executions already advanced
  // the shared ledger. Never assume only successful runs could have incurred cost.
  const others=runs.filter(r=>String(r.id)!==String(current.id));
  const unstarted=new Set(['queued','pending','waiting','requested']);
  const candidates=others.flatMap(r=>{
    const attempt=Number(r.run_attempt||1);
    if(unstarted.has(r.status)) {
      // A first-attempt queued successor has not dispatched work. A queued rerun
      // may have an earlier paid attempt, so retain that completed predecessor.
      if(attempt>1&&!priorAttempts[r.id])fail('Queued rerun prior-attempt chronology is unavailable');
      return attempt>1?[{...r,...priorAttempts[r.id],status:'completed',attempt:attempt-1}]:[];
    }
    return [{...r,attempt}];
  });
  if(Number(current.run_attempt)>1) {
    if(!priorAttempts[current.id])fail('Current rerun prior-attempt chronology is unavailable');
    candidates.push({...current,...priorAttempts[current.id],attempt:Number(current.run_attempt)-1,status:'completed'});
  }
  const time=x=>{const t=Date.parse(x.updated_at||'');if(!Number.isFinite(t))fail('Execution chronology is unavailable; paid processing remains blocked');return t;};
  for(const candidate of candidates)time(candidate);
  candidates.sort((a,b)=>time(b)-time(a));
  if(candidates.length>1&&time(candidates[0])===time(candidates[1]))fail('Latest execution timestamps are ambiguous; paid processing remains blocked');
  return candidates[0]||null;
}
export function selectStateArtifact(run,artifacts) {
  if(!run)return null;
  if(run.status!=='completed')fail('Previous cloud execution is not completed; paid processing remains blocked');
  const name=`roof-cloud-state-${run.id}-${run.attempt||run.run_attempt||1}`;
  const matches=artifacts.filter(a=>a.name===name&&!a.expired);
  if(matches.length!==1)fail('Latest cloud execution has no unique unexpired checkpoint; paid processing remains blocked');
  return matches[0];
}
async function filesIn(directory,prefix='') {
  const files=[];
  for(const entry of await readdir(join(directory,prefix),{withFileTypes:true})) {
    const name=prefix?`${prefix}/${entry.name}`:entry.name;
    if(name===MANIFEST)continue;
    if(entry.isSymbolicLink())fail('Checkpoint contains symbolic links');
    if(entry.isDirectory())files.push(...await filesIn(directory,name));
    else if(entry.isFile()) {
      const bytes=await readFile(join(directory,name));
      if(bytes.length>16*1024*1024)fail('Checkpoint file exceeds limit');
      files.push({path:name,size:bytes.length,sha256:digest(bytes)});
    }else fail('Unsupported checkpoint entry');
  }
  if(files.length>10000||files.reduce((n,f)=>n+f.size,0)>64*1024*1024)fail('Checkpoint exceeds bounded storage');
  return files.sort((a,b)=>a.path.localeCompare(b.path));
}
export async function verifyCheckpoint(directory,manifest,{repository,runId,runAttempt}={}) {
  if(!manifest||manifest.schemaVersion!==1||manifest.workflow!==WORKFLOW||manifest.budgetVersion!==BUDGET_VERSION||manifest.repository!==repository||String(manifest.runId)!==String(runId)||manifest.runAttempt!==runAttempt||typeof manifest.paidLedgerEligible!=='boolean')fail('Checkpoint provenance or budget version mismatch');
  const actual=await filesIn(directory);
  if(JSON.stringify(actual)!==JSON.stringify(manifest.files))fail('Checkpoint checksums or file inventory mismatch');
  for(const file of actual)if(file.path.endsWith('.sqlite-wal')&&file.size)fail('SQLite WAL was not closed/checkpointed before upload');
  return {paidAllowed:manifest.paidLedgerEligible,reason:manifest.lineageReason||null};
}
async function githubJSON(path,{env=process.env,fetchImpl=fetch}={}) {
  const token=env.GH_TOKEN||env.GITHUB_TOKEN;
  if(!token)fail('GitHub Actions read credential is unavailable');
  const response=await fetchImpl('https://api.github.com'+path,{headers:{Authorization:`Bearer ${token}`,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'},redirect:'error',signal:AbortSignal.timeout(20000)});
  if(!response.ok)fail(`GitHub checkpoint discovery failed with HTTP ${response.status}`);
  const text=await response.text();if(Buffer.byteLength(text)>2*1024*1024)fail('GitHub response exceeds limit');
  return JSON.parse(text);
}
async function downloadArtifact(repository,artifact,directory,{env=process.env}={}) {
  const archive=join(directory,'checkpoint-download.zip');
  try {
    const result=await execute('gh',['api',`repos/${repository}/actions/artifacts/${artifact.id}/zip`],{env,encoding:'buffer',maxBuffer:64*1024*1024,timeout:60000});
    await writeFile(archive,result.stdout,{mode:0o600});
    // Extract only bounded regular files; no path traversal or archive symlinks.
    const script=`import zipfile,sys,pathlib,stat\np=pathlib.Path(sys.argv[2]).resolve()\nwith zipfile.ZipFile(sys.argv[1]) as z:\n items=z.infolist()\n if len(items)>10000 or sum(x.file_size for x in items)>67108864: raise Exception('archive limit')\n for i in items:\n  t=(p/i.filename).resolve()\n  if not t.is_relative_to(p) or stat.S_ISLNK(i.external_attr>>16) or i.file_size>16777216: raise Exception('unsafe archive')\n for i in items:\n  if not i.is_dir():\n   t=p/i.filename;t.parent.mkdir(parents=True,exist_ok=True);t.write_bytes(z.read(i))\n`;
    await execute('python3',['-c',script,archive,directory],{timeout:30000,maxBuffer:100000});
  }catch{fail('Checkpoint download/extraction failed; prior budget history cannot be reset');}
  finally{await rm(archive,{force:true});}
}
export async function bootstrapCloud(directory,{env=process.env,getJSON=githubJSON,download=downloadArtifact}={}) {
  const ctx=context(env);await mkdir(directory,{recursive:true,mode:0o700});
  if((await lstat(directory)).isSymbolicLink())fail('Cloud state root cannot be a symbolic link');
  if((await readdir(directory)).length)fail('Bootstrap requires a fresh directory; never erase an existing budget ledger');
  let paidAllowed=false,reason=null,previous=null;
  try {
    const current=await getJSON(`/repos/${ctx.repository}/actions/runs/${ctx.runId}`,{env});
    if(String(current.id)!==ctx.runId||Number(current.run_attempt)!==ctx.runAttempt)fail('Current workflow attempt cannot be verified');
    let total=null;const history=[],seen=new Set();
    for(let page=1;page<=100;page++) {
      const batch=await getJSON(`/repos/${ctx.repository}/actions/workflows/${current.workflow_id}/runs?per_page=100&page=${page}`,{env});
      if(total===null)total=Number(batch.total_count);
      if(!Number.isInteger(total)||total<1||total>10000||!Array.isArray(batch.workflow_runs))fail('Cloud history exceeds the verified reconciliation window');
      for(const run of batch.workflow_runs) {
        if(seen.has(String(run.id)))fail('Cloud history changed during pagination; retry reconciliation without paid processing');
        seen.add(String(run.id));history.push(run);
      }
      if(history.length>=total)break;
      if(!batch.workflow_runs.length||page===100)fail('Cloud history is incomplete; paid processing remains blocked');
    }
    const unstarted=new Set(['queued','pending','waiting','requested']),priorAttempts={};
    if(!seen.has(ctx.runId))fail('Current execution is absent from reconciled history');
    if(history.some(r=>String(r.id)!==ctx.runId&&!unstarted.has(r.status)&&r.status!=='completed'))fail('Another cloud execution has an unresolved running outcome');
    const needPrior=[...history.filter(r=>String(r.id)!==ctx.runId&&unstarted.has(r.status)&&Number(r.run_attempt)>1),...(ctx.runAttempt>1?[current]:[])];
    if(needPrior.length>10)fail('Too many pending reruns require checkpoint reconciliation');
    for(const run of needPrior) {
      const attempt=Number(run.run_attempt)-1;
      const prior=await getJSON(`/repos/${ctx.repository}/actions/runs/${run.id}/attempts/${attempt}`,{env});
      if(String(prior.id)!==String(run.id)||Number(prior.run_attempt)!==attempt||prior.status!=='completed')fail('Prior-attempt outcome cannot be verified');
      priorAttempts[run.id]=prior;
    }
    const previousRun=previousExecution(current,history,{priorAttempts});
    if(!previousRun) {
      const completeEmptyHistory=total===history.length&&history.some(r=>String(r.id)===ctx.runId)&&history.every(r=>String(r.id)===ctx.runId||(unstarted.has(r.status)&&Number(r.run_attempt||1)===1));
      if(!completeEmptyHistory||ctx.runAttempt>1)fail('Cloud history is incomplete; first-use initialization cannot be established');
      paidAllowed=true;
    }else {
      const listing=await getJSON(`/repos/${ctx.repository}/actions/runs/${previousRun.id}/artifacts?per_page=100`,{env});
      const artifact=selectStateArtifact(previousRun,listing.artifacts||[]);
      await download(ctx.repository,artifact,directory,{env});
      const manifest=JSON.parse(await readFile(join(directory,MANIFEST),'utf8'));
      const checked=await verifyCheckpoint(directory,manifest,{repository:ctx.repository,runId:previousRun.id,runAttempt:previousRun.attempt});
      paidAllowed=checked.paidAllowed;reason=checked.reason;
      previous={runId:String(previousRun.id),runAttempt:previousRun.attempt,artifactId:artifact.id,manifestHash:digest(JSON.stringify(manifest))};
    }
  }catch(error) {
    paidAllowed=false;reason=error.message;
    // A partial download is never considered a valid ledger. Retain it for audit,
    // but the blocked receipt must survive every later deterministic checkpoint.
  }
  const receipt={schemaVersion:1,...ctx,workflow:WORKFLOW,budgetVersion:BUDGET_VERSION,paidAllowed,reason,previous,checkedAt:new Date().toISOString()};
  await writeFile(join(directory,BOOTSTRAP),JSON.stringify(receipt,null,2),{mode:0o600});
  return receipt;
}
export async function checkpointCloud(directory,{env=process.env}={}) {
  const ctx=context(env),receipt=JSON.parse(await readFile(join(directory,BOOTSTRAP),'utf8'));
  if(receipt.repository!==ctx.repository||receipt.runId!==ctx.runId||receipt.runAttempt!==ctx.runAttempt)fail('Current bootstrap receipt mismatch');
  const files=await filesIn(directory);
  if(files.some(f=>f.path.endsWith('.sqlite-wal')&&f.size))fail('Close SQLite before creating the cloud checkpoint');
  const manifest={schemaVersion:1,...ctx,workflow:WORKFLOW,budgetVersion:BUDGET_VERSION,paidLedgerEligible:receipt.paidAllowed===true,
    lineageReason:receipt.reason||null,previous:receipt.previous||null,checkpointAt:new Date().toISOString(),files};
  await writeFile(join(directory,MANIFEST),JSON.stringify(manifest,null,2),{mode:0o600});
  return manifest;
}
export async function packReports(directory,output) {
  if(relative(resolve(directory),resolve(output)).split(/[\\/]/)[0]!=='..'&&!isAbsolute(relative(resolve(directory),resolve(output))))fail('Report ZIP must be outside its source directory');
  await execute('python3',['-m','zipfile','-c',resolve(output),resolve(directory)],{timeout:60000,maxBuffer:100000});
  return {path:resolve(output),sha256:digest(await readFile(output))};
}
const STATUS_BRANCH='roof-cloud-status',STATUS_FILE='latest-status.json';
const QUALIFICATION_FILE='latest-qualification.json';
const QUALIFICATION_PROFILES=new Set(['allowance-qualification','allowance-roster']);
const WORK_FILE='latest-work.json',WORK_PROFILE='allowance-work';
const RECOVERY_FILE='latest-recovery.json',RECOVERY_PROFILE='allowance-recovery';
const RECOVERY_MODELS=new Set(['free/drex-v2.0','free/gemini-4-hydrogen','free/hy4-flash']);
const SCOPED_PROFILES=new Set([...QUALIFICATION_PROFILES,WORK_PROFILE,RECOVERY_PROFILE]);
function operationProfile(cycle,env) {
  const declared=env.ROOF_CLOUD_PUBLIC_PROFILE,actual=cycle?.executionProfile;
  if(declared&&!['cycle','review-existing',...SCOPED_PROFILES].includes(declared))fail('Unknown public operation profile');
  if(actual&&!['all-models','text-fleet','two-role',...SCOPED_PROFILES].includes(actual))fail('Unknown cycle execution profile');
  if(SCOPED_PROFILES.has(declared)&&cycle&&actual!==declared)fail('Public scoped profile conflicts with its cycle artifact');
  if(declared&&!SCOPED_PROFILES.has(declared)&&SCOPED_PROFILES.has(actual))fail('A scoped operation cannot replace the full journal');
  return SCOPED_PROFILES.has(actual)?actual:SCOPED_PROFILES.has(declared)?declared:null;
}
const boundedCount=value=>Number.isSafeInteger(value)&&value>=0&&value<=1000000?value:null;
const publicLabel=(value,max)=>typeof value==='string'&&value.length<=max&&!/[\x00-\x1f<>]/.test(value)?value:null;
const publicModel=value=>typeof value==='string'&&/^[a-z0-9][a-z0-9/_.:-]{0,199}$/.test(value)?value:'unknown';
export function publicCloudStatus(cycle,{env=process.env,now=Date.now}={}) {
  const ctx=context(env);
  if(!/^[a-f0-9]{40}$/.test(ctx.sourceRevision))fail('Public status requires the exact checked-out source revision');
  if(cycle&&cycle.sourceRevision!==ctx.sourceRevision)fail('Cycle status source revision mismatch');
  const runURL=`https://github.com/${ctx.repository}/actions/runs/${ctx.runId}`;
  const allowedDecision=new Set(['review-required','synthetic-monitoring-pass']);
  const allowedRole=new Set(['ceo','extraction','reference','engineering','critique','verification','reporting','operations']);
  const allowedStatus=new Set(['complete','rejected','failed','blocked','disabled','needs-human','deferred','running','pending','unknown']);
  const allowedResult=new Set(['pass','revise','reject','needs-human']);
  const pipelineResult=new Set(['success','failure','cancelled','skipped']).has(env.ROOF_CLOUD_GENERATION_RESULT)?env.ROOF_CLOUD_GENERATION_RESULT:'unknown';
  const browserResult=new Set(['success','failure','cancelled','skipped']).has(env.ROOF_CLOUD_BROWSER_STATUS)?env.ROOF_CLOUD_BROWSER_STATUS:'unknown';
  const status={schemaVersion:1,repository:ctx.repository,workflow:WORKFLOW,generatedAt:new Date(now()).toISOString(),
    sourceRevision:ctx.sourceRevision,run:{id:ctx.runId,attempt:ctx.runAttempt,url:runURL,pipelineResult},
    reportArtifact:{name:`roof-cloud-reports-${ctx.runId}-${ctx.runAttempt}`,available:env.ROOF_CLOUD_ARTIFACT_AVAILABLE==='true',url:runURL+'#artifacts'},
    evaluation:{status:allowedDecision.has(cycle?.decision?.status)?cycle.decision.status:'cycle-unavailable',
      attempted:boundedCount(cycle?.metrics?.attempted),diagnosticPasses:boundedCount(cycle?.metrics?.diagnosticPasses),
      traceFailures:boundedCount(cycle?.metrics?.traceFailures),generatedCustomerPDFs:boundedCount(cycle?.metrics?.generatedCustomerPDFs),
      pdfChecked:boundedCount(cycle?.pdfReview?.checked),pdfFailed:boundedCount(cycle?.pdfReview?.failed),browserResult,
      productionReleaseApproved:false,fieldAccuracyValidated:false},
    models:(Array.isArray(cycle?.reviews)?cycle.reviews:[]).slice(0,256).map(r=>({
      role:allowedRole.has(r.role)?r.role:'unknown',model:publicModel(r.model),
      team:publicLabel(r.team,100),task:publicLabel(r.task,600),reviewerModel:(r.reviewerModel||r.proposedReviewerModel)?publicModel(r.reviewerModel||r.proposedReviewerModel):null,
      status:allowedStatus.has(r.status)?r.status:'unknown',decision:allowedResult.has(r.decision)?r.decision:null,
      code:typeof r.code==='string'&&/^[A-Z0-9_:-]{1,100}$/.test(r.code)?r.code:null,
      httpStatus:Number.isInteger(r.errorDetails?.httpStatus)&&r.errorDetails.httpStatus>=100&&r.errorDetails.httpStatus<=599?r.errorDetails.httpStatus:null,
      attempted:r.attempted===true,contributionValidated:typeof r.primaryValidated==='boolean'?r.primaryValidated:null,
      reviewStatus:new Set(['complete','pending','unavailable','failed','blocked']).has(r.reviewStatus)?r.reviewStatus:null,
      reviewCode:typeof r.reviewCode==='string'&&/^[A-Z0-9_:-]{1,100}$/.test(r.reviewCode)?r.reviewCode:null,
      reportedUsd:Number.isFinite(r.reportedUsd)&&r.reportedUsd>=0?r.reportedUsd:null})),
    scope:'Generated synthetic monitoring only; no field accuracy certification or production code promotion'};
  if(cycle?.fleet) {
    const fleet=cycle.fleet,catalog=fleet.catalog||{},coverage=fleet.coverage||{};
    status.fleet={mode:'all-models',catalogCheckedAt:publicLabel(catalog.checkedAt,100),
      catalogHash:typeof catalog.hash==='string'&&/^[a-f0-9]{64}$/.test(catalog.hash)?catalog.hash:null,
      rosterCount:boundedCount(coverage.rosterCount??catalog.rosterCount??status.models.length),
      assignedCount:status.models.length,attemptedCount:status.models.filter(m=>m.attempted).length,
      validCount:status.models.filter(m=>m.contributionValidated===true||(m.contributionValidated===null&&['complete','rejected'].includes(m.status))).length,
      blockedCount:status.models.filter(m=>['blocked','disabled','deferred'].includes(m.status)).length,
      reviewedCount:status.models.filter(m=>m.reviewStatus==='complete').length,
      textModelCount:boundedCount(catalog.textRosterCount??catalog.authenticatedCount),
      designModelCount:boundedCount(catalog.designModelCount),
      unavailableModels:(CATALOG_METADATA.documentedUnavailableModels||[]).map(publicModel).filter(m=>m!=='unknown')};
    if(fleet.design)status.design={assigned:boundedCount(fleet.design.coverage?.assigned),generated:boundedCount(fleet.design.coverage?.generated),
      attempted:boundedCount(fleet.design.coverage?.attempted),reviewerModel:publicModel(fleet.designReview?.reviewerModel),
      reviewCompleted:fleet.designReview?.reviewCompleted===true,reviewStatus:publicLabel(fleet.designReview?.status,100),
      conceptOnly:true,measurementUse:false,productionApproved:false,artifactURL:runURL+'#artifacts'};
  }
  if(cycle?.followup&&cycle?.baseline) {
    const prior=cycle.baseline,runId=/^\d+$/.test(String(prior.runId||''))?String(prior.runId):null;
    status.baseline={runId,sourceRevision:/^[a-f0-9]{40}$/.test(prior.sourceRevision||'')?prior.sourceRevision:null,
      evaluationHash:/^[a-f0-9]{64}$/.test(prior.evaluationHash||'')?prior.evaluationHash:null,
      url:runId?`https://github.com/${ctx.repository}/actions/runs/${runId}`:null};
    status.evaluation.evidenceMode='retained-baseline';
    status.evaluation.retainedCustomerPDFs=boundedCount(cycle.metrics?.generatedCustomerPDFs);
    status.evaluation.generatedCustomerPDFs=0;
    status.evaluation.newlyGeneratedCases=0;status.evaluation.newlyGeneratedConcepts=boundedCount(cycle.followup.newlyGeneratedConcepts)??0;
    status.scope='Retained measurement baseline; new model reviews and explicitly requested design qualifications only. No new measurements, PDF rendering, field accuracy certification or production code promotion.';
  }
  if(Buffer.byteLength(JSON.stringify(status))>131072)fail('Public cloud status exceeds128KiB');
  return status;
}
export function publicQualificationStatus(cycle,{env=process.env,now=Date.now}={}) {
  const executionProfile=operationProfile(cycle,env);
  if(!QUALIFICATION_PROFILES.has(executionProfile))fail('A known subscription qualification profile is required');
  const base=publicCloudStatus(cycle,{env,now});
  if(base.models.some(row=>!row.model.startsWith('free/')))fail('A subscription qualification cannot include paid-model rows');
  const models=base.models.map(({model,status,attempted,contributionValidated,reviewStatus,code})=>({model,status,attempted,contributionValidated,reviewStatus,code}));
  return {schemaVersion:1,repository:base.repository,workflow:base.workflow,executionProfile,generatedAt:base.generatedAt,
    sourceRevision:base.sourceRevision,run:base.run,reportArtifact:base.reportArtifact,models,
    summary:{selectedCount:models.length,attemptedCount:models.filter(row=>row.attempted).length,
      validCount:models.filter(row=>row.contributionValidated===true).length,reviewedCount:models.filter(row=>row.reviewStatus==='complete').length},
    scope:'Selected subscription model results only; paid and image evidence remains in the separately dated full-roster journal. No field accuracy or production approval.'};
}
export function publicRecoveryStatus(cycle,{env=process.env,now=Date.now}={}) {
  if(operationProfile(cycle,env)!==RECOVERY_PROFILE)fail('A known route recovery profile is required');
  const base=publicCloudStatus(cycle,{env,now}),rows=cycle?.reviews;
  if(!Array.isArray(rows)) {
    if(rows!=null)fail('Invalid recovery model records');
    if(env.ROOF_CLOUD_PUBLIC_PROFILE!==RECOVERY_PROFILE||!['failure','unknown'].includes(base.run.pipelineResult))fail('Missing recovery results require a declared failed or unknown recovery run');
  }
  const recorded=rows||[];
  if(recorded.length>RECOVERY_MODELS.size||recorded.some(row=>!row||typeof row!=='object'||!RECOVERY_MODELS.has(row.model))||new Set(recorded.map(row=>row.model)).size!==recorded.length)fail('Recovery qualification contains an unselected route or duplicate model record');
  if(base.run.pipelineResult==='success'&&recorded.length!==RECOVERY_MODELS.size)fail('A successful recovery run requires all three selected route records');
  const models=base.models.map(({model,status,attempted,contributionValidated,reviewStatus,code})=>({model,status,attempted,contributionValidated,reviewStatus,code}));
  return {schemaVersion:1,repository:base.repository,workflow:base.workflow,executionProfile:RECOVERY_PROFILE,generatedAt:base.generatedAt,
    sourceRevision:base.sourceRevision,run:base.run,reportArtifact:base.reportArtifact,models,
    summary:{selectedCount:models.length,attemptedCount:models.filter(row=>row.attempted).length,
      validCount:models.filter(row=>row.contributionValidated===true).length,reviewedCount:models.filter(row=>row.reviewStatus==='complete').length},
    scope:'Recovery journal for three selected subscription routes; counts cover only the model records published by this run. Broad subscription, full-roster and productive-work journals remain separately dated. No field accuracy or production approval.'};
}
export function publicWorkStatus(cycle,{env=process.env,now=Date.now}={}) {
  if(operationProfile(cycle,env)!==WORK_PROFILE)fail('A known productive work profile is required');
  const base=publicCloudStatus(cycle,{env,now}),work=cycle?.caseWork;
  const countKeys=['uniqueModels','workItems','authorTasks','reviewTasks','dispatchedTasks','validatedTasks','independentlyReviewed','awaitingIndependentReview','failed'];
  let models=[],summary=Object.fromEntries(countKeys.map(key=>[key,0]));
  if(!work) {
    if(env.ROOF_CLOUD_PUBLIC_PROFILE!==WORK_PROFILE||base.run.pipelineResult==='success')fail('Missing productive work results require a declared non-success work run');
  }else {
    if(typeof work!=='object'||Array.isArray(work)||work.sourceRevision!==base.sourceRevision)fail('Productive work source revision mismatch');
    if(!Array.isArray(work.models)||work.models.length>256||!Array.isArray(work.workItems))fail('Invalid productive work model or question counts');
    summary=Object.fromEntries(countKeys.map(key=>{
      const value=boundedCount(work.counts?.[key]);if(value===null)fail('Invalid productive work count');return [key,value];
    }));
    models=work.models.map(row=>{
      const model=publicModel(row?.model),taskCount=boundedCount(row?.taskCount),validatedTaskCount=boundedCount(row?.validatedTaskCount);
      if(model==='unknown'||taskCount===null||taskCount<1||validatedTaskCount===null||validatedTaskCount>taskCount)fail('Invalid productive work model counts');
      return {model,taskCount,validatedTaskCount};
    });
    if(new Set(models.map(row=>row.model)).size!==models.length||summary.uniqueModels!==models.length||summary.workItems!==work.workItems.length)fail('Productive work aggregate counts do not match its recorded models or questions');
    const modelTasks=models.reduce((total,row)=>total+row.taskCount,0),validatedModelTasks=models.reduce((total,row)=>total+row.validatedTaskCount,0);
    if(modelTasks!==summary.dispatchedTasks||validatedModelTasks!==summary.validatedTasks||summary.dispatchedTasks>summary.authorTasks+summary.reviewTasks||summary.validatedTasks>summary.dispatchedTasks)fail('Productive work aggregate task counts do not match its dispatched or validated tasks');
  }
  // Model answers and review records are proposals, not applied or released fixes.
  summary.completedFixes=0;
  return {schemaVersion:1,repository:base.repository,workflow:base.workflow,executionProfile:WORK_PROFILE,generatedAt:base.generatedAt,
    sourceRevision:base.sourceRevision,run:base.run,reportArtifact:base.reportArtifact,summary,models,
    scope:'Scoped productive engineering work; accepted proposals and reviews are not implemented or released fixes. No field accuracy or production approval.'};
}
export async function publishCloudStatus(cycle,{env=process.env,fetchImpl=fetch,now=Date.now}={}) {
  const profile=operationProfile(cycle,env),qualification=QUALIFICATION_PROFILES.has(profile),productive=profile===WORK_PROFILE,recovery=profile===RECOVERY_PROFILE;
  const status=recovery?publicRecoveryStatus(cycle,{env,now}):productive?publicWorkStatus(cycle,{env,now}):qualification?publicQualificationStatus(cycle,{env,now}):publicCloudStatus(cycle,{env,now}),
    statusFile=recovery?RECOVERY_FILE:productive?WORK_FILE:qualification?QUALIFICATION_FILE:STATUS_FILE,token=env.GH_TOKEN||env.GITHUB_TOKEN;
  if(!token)fail('GitHub status-publishing credential is unavailable');
  const base=`https://api.github.com/repos/${status.repository}`;
  async function request(path,{method='GET',body,allow404=false}={}) {
    const response=await fetchImpl(base+path,{method,redirect:'error',signal:AbortSignal.timeout(20000),
      headers:{Authorization:`Bearer ${token}`,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28',...(body?{'Content-Type':'application/json'}:{})},
      ...(body?{body:JSON.stringify(body)}:{})});
    if(allow404&&response.status===404)return null;
    if(!response.ok)fail(`GitHub status publish failed with HTTP ${response.status}; prior status was not overwritten`);
    const text=await response.text();if(Buffer.byteLength(text)>100000)fail('GitHub status response exceeds limit');
    return text?JSON.parse(text):{};
  }
  const execution=await request(`/actions/runs/${status.run.id}/attempts/${status.run.attempt}`);
  const started=Date.parse(execution.run_started_at||'');
  if(String(execution.id)!==status.run.id||Number(execution.run_attempt)!==status.run.attempt||!Number.isFinite(started)||execution.head_sha!==env.GITHUB_SHA)fail('Public status execution provenance cannot be verified');
  status.run.startedAt=new Date(started).toISOString();
  const branch=await request(`/git/ref/heads/${STATUS_BRANCH}`,{allow404:true});
  if(!branch)await request('/git/refs',{method:'POST',body:{ref:`refs/heads/${STATUS_BRANCH}`,sha:status.sourceRevision}});
  const previous=await request(`/contents/${statusFile}?ref=${STATUS_BRANCH}`,{allow404:true});
  if(previous) {
    if(previous.type!=='file'||!/^([a-f0-9]{40})$/.test(previous.sha||'')||previous.encoding!=='base64'||typeof previous.content!=='string'||previous.content.length>200000)fail('Existing public status has invalid content metadata; refusing replacement');
    let old;try{old=JSON.parse(Buffer.from(previous.content,'base64').toString('utf8'));}catch{fail('Existing public status is unreadable; refusing replacement');}
    const wrongProfile=recovery?old.executionProfile!==RECOVERY_PROFILE:productive?old.executionProfile!==WORK_PROFILE:qualification?!QUALIFICATION_PROFILES.has(old.executionProfile):SCOPED_PROFILES.has(old.executionProfile);
    if(old.schemaVersion!==1||old.repository!==status.repository||old.workflow!==WORKFLOW||wrongProfile||typeof old.run?.id!=='string'||!/^[1-9]\d*$/.test(old.run.id)||!Number.isInteger(old.run?.attempt)||old.run.attempt<1||!/^([a-f0-9]{40})$/.test(old.sourceRevision||'')||!Number.isFinite(Date.parse(old.run.startedAt||'')))fail('Existing public status provenance mismatch; refusing replacement');
    const oldStarted=Date.parse(old.run.startedAt);
    if(oldStarted>started||(oldStarted===started&&(old.run.id!==status.run.id||old.run.attempt!==status.run.attempt)))fail('A newer or chronologically ambiguous cloud status exists; refusing stale replacement');
  }
  const content=Buffer.from(JSON.stringify(status,null,2)+'\n').toString('base64');
  const result=await request(`/contents/${statusFile}`,{method:'PUT',body:{message:`Record roof evaluation ${status.run.id}/${status.run.attempt}`,branch:STATUS_BRANCH,content,...(previous?{sha:previous.sha}:{})}});
  return {statusURL:`https://github.com/${status.repository}/blob/${STATUS_BRANCH}/${statusFile}`,commit:result.commit?.sha||null,
    runURL:status.run.url,reportArtifactURL:status.reportArtifact.url};
}
async function main() {
  const command=process.argv[2],arg=name=>{const i=process.argv.indexOf(name);return i<0?null:process.argv[i+1];};
  const directory=resolve(arg('--state')||'.cloud-state');
  if(command==='bootstrap') {
    const receipt=await bootstrapCloud(directory);
    if(process.env.GITHUB_OUTPUT)await writeFile(process.env.GITHUB_OUTPUT,`paid_allowed=${receipt.paidAllowed}\n`,{flag:'a'});
    console.log(JSON.stringify({paidAllowed:receipt.paidAllowed,reason:receipt.reason,previous:receipt.previous}));
  }else if(command==='checkpoint') {
    const manifest=await checkpointCloud(directory);console.log(JSON.stringify({paidLedgerEligible:manifest.paidLedgerEligible,files:manifest.files.length}));
  }else if(command==='pack')console.log(JSON.stringify(await packReports(resolve(arg('--output')||'cloud-output'),resolve(arg('--archive')||'roof-cloud-reports.zip'))));
  else if(command==='publish-status') {
    let cycle=null;const path=resolve(arg('--cycle')||'cloud-output/cycle.json');
    try {const bytes=await readFile(path);if(bytes.length>2*1024*1024)fail('Cycle status exceeds limit');cycle=JSON.parse(bytes.toString('utf8'));}
    catch(error){if(error.code!=='ENOENT')throw error;}
    console.log(JSON.stringify(await publishCloudStatus(cycle)));
  }else fail('Commands: bootstrap, checkpoint, pack, publish-status');
}
if(process.argv[1]===fileURLToPath(import.meta.url))main().catch(error=>{console.error(error.message);process.exitCode=1;});
