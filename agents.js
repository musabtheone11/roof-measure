'use strict';
(() => {
  const STATUS_URL='https://raw.githubusercontent.com/musabtheone11/roof-measure/roof-cloud-status/latest-status.json';
  const QUALIFICATION_URL='https://raw.githubusercontent.com/musabtheone11/roof-measure/roof-cloud-status/latest-qualification.json';
  const WORK_URL='https://raw.githubusercontent.com/musabtheone11/roof-measure/roof-cloud-status/latest-work.json';
  const WORKFLOW_URL='https://github.com/musabtheone11/roof-measure/actions/workflows/roof-cloud.yml';
  const POLL_MS=60_000, STALE_MS=36*60*60*1000;
  const $=id=>document.getElementById(id);
  let snapshot=null, qualification=null, work=null, inFlight=false, timer=null, lastAttempt=0;
  const text=(value,max=400)=>typeof value==='string'?value.slice(0,max):'';
  const count=value=>Number.isSafeInteger(value)&&value>=0?value:null;
  const usd=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0?value:null;
  const title=value=>text(value,100).replace(/[-_]+/g,' ').replace(/^\w/,letter=>letter.toUpperCase());
  const formatTime=value=>new Date(value).toLocaleString(undefined,{year:'numeric',month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short'});
  const categories={complete:'complete',completed:'complete',running:'running',in_progress:'running',blocked:'blocked',deferred:'blocked',failed:'failed',disabled:'disabled',rejected:'review','needs-human':'review','review-required':'review',queued:'queued',pending:'queued',scheduled:'queued'};
  const labels={complete:'Recorded complete',completed:'Recorded complete',running:'Running in record',in_progress:'Running in record',blocked:'Blocked',deferred:'Deferred',failed:'Execution failed',disabled:'Disabled',rejected:'Review rejected','needs-human':'Review needed','review-required':'Review needed',queued:'Queued',pending:'Pending',scheduled:'Scheduled'};
  const blockers={CLOUD_SECRET_NOT_CONFIGURED:'The cloud job has no configured APINEX credential.',CHECKPOINT_LINEAGE_BLOCKED:'Previous billing and workflow history could not be verified.',PERMANENT_PROVIDER_FAILURE_REQUIRES_RECONCILIATION:'A provider failure needs reconciliation before more requests.',MODEL_RECONCILIATION_REQUIRED:'A previous request for this model needs reconciliation before another request can run.',PEER_REVIEW_REVISION_REQUIRED:'The contribution was accepted; its peer reviewer requested revisions.',INVALID_AGENT_OUTPUT:'The response did not meet the required output contract.',TIMEOUT:'This request exceeded its runtime limit.',UPSTREAM_HTTP:'The provider returned an HTTP error.',PROVIDER_AUTH_RECONCILIATION_REQUIRED:'Provider authentication needs reconciliation before another request can run.',MODEL_UNAVAILABLE:'The configured model is unavailable.',PRICING_UNKNOWN:'Model pricing has not been verified.',BUDGET_EXCEEDED:'The authorized spending limit was reached.',BUDGET_LIMIT:'This request could not fit within the authorized budget.',CYCLE_REQUEST_LIMIT:'This cycle reached its bounded request limit; the assignment was deferred.',MODEL_NOT_SCHEDULED:'This model was not scheduled in the recorded cycle.'};
  const legacyRoles={critique:{team:'Independent verification',task:'Challenge synthetic evaluation evidence and unsupported conclusions.'},ceo:{team:'Engineering supervision',task:'Review recorded evidence and prioritize proposed improvements.'}};
  const make=(tag,className,value)=>{const element=document.createElement(tag);if(className)element.className=className;if(value!==undefined)element.textContent=value;return element;};
  function checkedStatus(data) {
    if(!data||typeof data!=='object'||Array.isArray(data)||data.schemaVersion!==1||!Array.isArray(data.models)||data.models.length>256)throw new Error('Invalid public status format');
    if(data.repository&&data.repository!=='musabtheone11/roof-measure')throw new Error('Status belongs to another project');
    if(data.models.some(row=>!row||typeof row!=='object'||!text(row.model,180)))throw new Error('Invalid model assignment');
    return data;
  }
  function checkedQualification(data) {
    checkedStatus(data);
    if(!['allowance-qualification','allowance-roster'].includes(data.executionProfile)||data.models.length>51||(data.models.length===0&&data.run?.pipelineResult==='success'))throw new Error('Invalid subscription run scope');
    if(!/^[a-f0-9]{40}$/.test(data.sourceRevision||'')||!Number.isFinite(timestamp(data)))throw new Error('Subscription source or publication time is missing');
    if(count(data.summary?.selectedCount)!==data.models.length||['attemptedCount','validCount','reviewedCount'].some(key=>count(data.summary?.[key])===null||data.summary[key]>data.models.length))throw new Error('Invalid subscription coverage counts');
    return data;
  }
  function checkedWork(data) {
    checkedStatus(data);
    if(data.executionProfile!=='allowance-work'||!/^([a-f0-9]{40})$/.test(data.sourceRevision||'')||!Number.isFinite(timestamp(data)))throw new Error('Invalid work journal provenance');
    const fields=['uniqueModels','workItems','authorTasks','reviewTasks','dispatchedTasks','validatedTasks','independentlyReviewed','awaitingIndependentReview','failed'];
    if(fields.some(key=>count(data.summary?.[key])===null||data.summary[key]>1000000)||data.summary.completedFixes!==0||data.summary.uniqueModels!==data.models.length||new Set(data.models.map(row=>row.model)).size!==data.models.length)throw new Error('Invalid productive work counts');
    if(data.models.some(row=>count(row.taskCount)===null||row.taskCount<1||count(row.validatedTaskCount)===null||row.validatedTaskCount>row.taskCount))throw new Error('Invalid work model counts');
    if(data.models.reduce((sum,row)=>sum+row.taskCount,0)!==data.summary.dispatchedTasks||data.models.reduce((sum,row)=>sum+row.validatedTaskCount,0)!==data.summary.validatedTasks||data.summary.dispatchedTasks>data.summary.authorTasks+data.summary.reviewTasks||data.summary.validatedTasks>data.summary.dispatchedTasks)throw new Error('Inconsistent work task totals');
    return data;
  }
  function isValid(row) {return row.contributionValidated===true;}
  function reviewState(row) {return typeof row.reviewStatus==='string'?row.reviewStatus:row.reviewStatus?.status;}
  function needsReview(row) {
    if(!isValid(row)&&['failed','blocked','disabled','deferred','pending','queued'].includes(row.status))return false;
    return ['needs-human','review-required','rejected'].includes(row.status)||['needs-human','revise','reject'].includes(row.decision)||
      (isValid(row)&&reviewState(row)!=='complete')||
      (['complete','completed'].includes(row.status)&&['pending','blocked','failed','unavailable'].includes(reviewState(row)));
  }
  function safeProjectURL(value) {
    try {const url=new URL(value);if(url.origin==='https://github.com'&&url.pathname.startsWith('/musabtheone11/roof-measure/')&&!url.username&&!url.password)return url.href;}catch (_) {}
    return null;
  }
  function timestamp(data) {return Date.parse(data.generatedAt||'');}
  function ageLabel(time) {
    if(!Number.isFinite(time))return 'Publication time unavailable';
    const age=Date.now()-time;
    if(age < -5*60*1000)return 'Publication time is ahead of this device';
    if(age<60_000)return 'Published less than a minute ago';
    if(age<60*60*1000)return `Published ${Math.floor(age/60_000)} minutes ago`;
    if(age<48*60*60*1000)return `Published ${Math.floor(age/(60*60*1000))} hours ago`;
    return `Published ${Math.floor(age/(24*60*60*1000))} days ago`;
  }
  function notice(message,kind='') {$('connection').textContent=message;$('connection').dataset.kind=kind;}
  function coverage(data) {
    const counts={complete:0,running:0,blocked:0,failed:0,disabled:0,review:0,queued:0,other:0};
    for(const row of data.models)counts[categories[row.status]||'other']++;
    const unique=new Set(data.models.map(row=>row.model)).size;
    const valid=count(data.fleet?.validCount)??(data.models.some(row=>typeof row.contributionValidated==='boolean')?data.models.filter(isValid).length:null);
    counts.needsReview=data.models.filter(needsReview).length;
    $('coverage').replaceChildren(...[[unique,'Models listed','models'],[valid,'Valid contributions','valid'],[counts.needsReview,'Review needed','review'],[counts.failed,'Execution failed','failed'],[counts.blocked+counts.disabled,'Blocked / deferred / disabled','blocked'],[counts.running,'Running in record','running']].map(([value,label,kind])=>{
      const item=make('div','coverage-item');item.dataset.kind=kind;item.append(make('strong','',value===null?'—':String(value)),make('span','',label));return item;
    }));
    const deferred=data.models.filter(row=>row.status==='deferred').length;
    const extra=[`${counts.complete} with lifecycle “complete”`,deferred?`${deferred} deferred (not running)`:null,counts.queued?`${counts.queued} queued or pending`:null,counts.other?`${counts.other} with unreported status`:null].filter(Boolean);
    const costs=data.models.map(row=>usd(row.reportedUsd)).filter(value=>value!==null);
    $('coverage-note').textContent=`${data.models.length} recorded assignment${data.models.length===1?'':'s'} across ${unique} model${unique===1?'':'s'}; ${extra.join('; ')}. Review-needed assignments can already have valid contributions. ${costs.length?`Reported assignment cost: $${costs.reduce((sum,value)=>sum+value,0).toFixed(4)} (${costs.length}/${data.models.length} cost records).`:'Model costs are not reported in this record.'}`;
    const fleet=data.fleet;
    $('fleet-coverage').hidden=!fleet||fleet.mode!=='all-models';
    if(fleet?.mode==='all-models') {
      const amount=value=>count(value)===null?'Not reported':String(value);
      $('fleet-coverage').textContent=`Catalog models: ${amount(fleet.rosterCount)} · Assigned: ${amount(fleet.assignedCount)} · Inference attempted: ${amount(fleet.attemptedCount)} · Valid contributions: ${amount(fleet.validCount)} · Recorded reviews: ${amount(fleet.reviewedCount)}. Accepted output and completed reviews do not establish roofing accuracy or release approval.`;
      const checked=Date.parse(fleet.catalogCheckedAt||'');
      if(Number.isFinite(checked))$('fleet-coverage').append(make('span','secondary',`Model catalog checked ${formatTime(checked)}.`));
    }
    const unavailable=[...new Set((Array.isArray(fleet?.unavailableModels)?fleet.unavailableModels:[])
      .filter(model=>typeof model==='string'&&model.length>0&&model.length<=180))].slice(0,256);
    $('unavailable-models').hidden=unavailable.length===0;
    $('unavailable-count').textContent=`(${unavailable.length})`;
    $('unavailable-list').replaceChildren(...unavailable.map(model=>make('li','',model)));
    return counts;
  }
  function modelRows() {
    return snapshot.models.map(row=>{const legacy=legacyRoles[row.role]||{};return {...row,model:text(row.model,180),team:text(row.team,120)||legacy.team||'Team not recorded',role:text(row.role,120)||'Role not recorded',task:text(row.task,600)||legacy.task||'The published record does not include a task.',reviewerModel:text(row.reviewerModel,180),category:categories[row.status]||'other'};});
  }
  function renderCards() {
    if(!snapshot)return;
    const search=$('search').value.trim().toLocaleLowerCase(),team=$('team').value,status=$('status').value;
    const rows=modelRows().filter(row=>(!team||row.team===team)&&(!status||(status==='valid'?isValid(row):status==='review'?needsReview(row):row.category===status))&&(!search||[row.model,row.team,row.role,row.task,row.reviewerModel,row.code].join(' ').toLocaleLowerCase().includes(search)));
    $('shown').textContent=`Showing ${rows.length} of ${snapshot.models.length} assignments`;
    $('agents').replaceChildren(...rows.map((row,index)=>{
      const card=make('article','agent-card');card.dataset.model=row.model;card.dataset.status=row.category;card.dataset.valid=isValid(row)?'true':row.contributionValidated===false?'false':'unknown';card.setAttribute('aria-labelledby',`model-${index}`);
      const top=make('div','agent-card-top'),states=make('div','card-statuses'),badge=make('span','badge',isValid(row)?'Valid contribution':labels[row.status]||'Not reported');badge.dataset.kind=isValid(row)?'valid':row.category;badge.dataset.state=text(row.status,30);
      states.append(badge);
      if(isValid(row)&&needsReview(row)) {const review=make('span','badge','Review needed');review.dataset.kind='review';states.append(review);}
      else if(isValid(row)&&['failed','blocked','disabled','running'].includes(row.category)) {const state=make('span','badge',labels[row.status]);state.dataset.kind=row.category;states.append(state);}
      top.append(make('span','team-name',row.team),states);
      const heading=make('h3','',row.model);heading.id=`model-${index}`;
      const details=make('dl');
      function detail(label,value,className='') {details.append(make('dt','',label),make('dd',className,value));}
      detail('Role',title(row.role));detail('Assigned task',row.task,'task');detail('Recorded lifecycle',title(row.status)||'Not reported');detail('Independent reviewer',row.reviewerModel||'Not recorded');
      if(row.reviewerModel===row.model)details.lastElementChild.append(make('span','reviewer-note','Same model as author; independence is not established.'));
      if(row.reviewStatus)details.lastElementChild.append(make('span','secondary',`Recorded review status: ${title(typeof row.reviewStatus==='string'?row.reviewStatus:row.reviewStatus.status)||'Not reported'}`));
      if(row.reviewCode)details.lastElementChild.append(make('span','secondary',`Review reason: ${text(row.reviewCode,100)}`));
      card.append(top,heading,details);
      const code=text(row.code,100);
      if(code) {const http=Number.isInteger(row.httpStatus)&&row.httpStatus>=100&&row.httpStatus<=599?` APINEX returned HTTP ${row.httpStatus}.`:'';const block=make('div','blocker',(blockers[code]||`Recorded reason: ${title(code)}.`)+http);block.append(make('code','',code));card.append(block);}
      const result=make('div','card-result');result.append(make('span','',row.decision?`Recommendation: ${title(row.decision)}`:'No recommendation recorded'));
      if(usd(row.reportedUsd)!==null)result.append(make('span','',`Reported $${row.reportedUsd.toFixed(4)}`));
      card.append(result);return card;
    }));
    $('agents').setAttribute('aria-busy','false');$('empty').hidden=rows.length>0;
    $('empty-title').textContent=snapshot.models.length?'No matching assignments':'No model assignments were published';
    $('empty-detail').textContent=snapshot.models.length?'Try a different search or filter.':'The workflow record contains no model rows. Open the cloud execution to check its outcome.';
  }
  function renderSnapshot() {
    const data=snapshot,time=timestamp(data),counts=coverage(data),fresh=Number.isFinite(time)&&Date.now()-time<=STALE_MS&&Date.now()-time>=-5*60*1000;
    const cycleState=title(data.evaluation?.status||'Status not reported');$('cycle-state').textContent=cycleState;$('cycle-state').dataset.kind=data.evaluation?.status==='synthetic-monitoring-pass'?'complete':'review';
    $('published').textContent=Number.isFinite(time)?formatTime(time):'Not reported';
    if(Number.isFinite(time))$('published').dateTime=new Date(time).toISOString();else $('published').removeAttribute('datetime');
    $('age').textContent=ageLabel(time);
    const runURL=safeProjectURL(data.run?.url);$('run-link').href=runURL||WORKFLOW_URL;$('run-link').textContent=runURL?`Run #${text(String(data.run.id),30)}${count(data.run.attempt)?` · attempt ${data.run.attempt}`:''}`:'Open workflow';
    $('run-result').textContent=`Pipeline: ${title(data.run?.pipelineResult||'not reported')}`;
    const started=Date.parse(data.run?.startedAt||'');$('run-started').textContent=Number.isFinite(started)?`Started ${formatTime(started)}`:'';
    if(Number.isFinite(started))$('run-started').dateTime=new Date(started).toISOString();else $('run-started').removeAttribute('datetime');
    const source=/^[a-f0-9]{40}$/.test(data.sourceRevision||'')?data.sourceRevision:null;
    $('source-link').textContent=source?`Source ${source}`:'Source not reported';$('source-link').setAttribute('aria-disabled',source?'false':'true');
    if(source){$('source-link').href=`https://github.com/musabtheone11/roof-measure/commit/${source}`;$('source-link').target='_blank';$('source-link').rel='noopener noreferrer';}else $('source-link').removeAttribute('href');
    const artifactURL=safeProjectURL(data.reportArtifact?.url),available=data.reportArtifact?.available===true&&artifactURL;
    $('evidence-link').textContent=available?'Open report and evidence artifacts':'Evidence not published';$('evidence-link').setAttribute('aria-disabled',available?'false':'true');
    if(available){$('evidence-link').href=artifactURL;$('evidence-link').target='_blank';$('evidence-link').rel='noopener noreferrer';}else $('evidence-link').removeAttribute('href');
    const evaluation=data.evaluation||{};
    $('evaluation').textContent=count(evaluation.attempted)!==null?`${evaluation.diagnosticPasses===null||count(evaluation.diagnosticPasses)===null?'?':evaluation.diagnosticPasses}/${evaluation.attempted} numerical checks passed · ${count(evaluation.generatedCustomerPDFs)===null?'?':evaluation.generatedCustomerPDFs} reports`:'Evaluation counts not reported';
    if(evaluation.evidenceMode==='retained-baseline')$('evaluation').textContent=`Retained baseline: ${count(evaluation.diagnosticPasses)??'?'} / ${count(evaluation.attempted)??'?'} numerical checks passed · ${count(evaluation.retainedCustomerPDFs)??'?'} retained reports · 0 newly generated reports`;
    $('scope').textContent=`${text(data.scope,500)||'Generated synthetic monitoring only; no field accuracy certification or production code promotion.'} This page reads status only and does not start agents.`;
    const legacy=data.models.length>0&&data.models.some(row=>!row.team||!row.task||!row.reviewerModel);
    $('legacy').hidden=!legacy;$('legacy').textContent='This record omits some team, task or reviewer details. Missing metadata is identified below; models absent from this record are not counted.';
    const selected=$('team').value,teams=[...new Set(modelRows().map(row=>row.team))].sort();
    $('team').replaceChildren(new Option('All teams',''),...teams.map(team=>new Option(team,team)));$('team').value=teams.includes(selected)?selected:'';
    renderCards();
    if(!fresh)notice(`Status freshness needs review. ${ageLabel(time)}. Counts and “running” labels describe this older record, not current activity.`,'warning');
    else if(counts.blocked+counts.failed+counts.disabled===data.models.length&&data.models.length)notice(`No model is recorded as running. ${counts.blocked} blocked or deferred; ${counts.failed} execution failures; ${counts.disabled} disabled in this published cycle. Open the cards for the recorded reasons.`,'warning');
    else notice(`Showing the latest published cycle. ${counts.running} assignment${counts.running===1?' is':'s are'} recorded as running; completed results remain visible. This is a status snapshot.`);
  }
  function renderQualification(error=null) {
    $('qualification').hidden=false;
    $('qualification-content').hidden=!qualification;
    if(!qualification) {
      $('qualification-notice').textContent=error?.status===404?'No subscription run journal has been published. The full-roster journal is shown separately.':'Subscription run status could not be loaded. The full-roster journal is shown separately.';
      return;
    }
    const data=qualification,time=timestamp(data),summary=data.summary;
    $('qualification-profile').textContent=data.executionProfile==='allowance-roster'?'Subscription roster':'Targeted qualification';
    $('qualification-notice').textContent=error?'Could not refresh this scoped run. Its last loaded record remains below; full-roster assignments are unchanged.':'This scoped run is separate from the full-roster journal and does not replace its assignments.';
    if(summary.selectedCount===0)$('qualification-notice').textContent+=' No model results published. Inspect this run for its recorded pipeline outcome.';
    $('qualification-notice').dataset.kind=error||summary.selectedCount===0?'warning':'';
    if(!error&&Date.now()-time>STALE_MS)$('qualification-notice').textContent+=' This subscription record is older than 36 hours.';
    const runURL=safeProjectURL(data.run?.url);$('qualification-run').href=runURL||WORKFLOW_URL;$('qualification-run').textContent=`Run #${text(String(data.run?.id||'not reported'),30)} · attempt ${count(data.run?.attempt)??'?'} · pipeline ${title(data.run?.pipelineResult||'not reported')}`;
    $('qualification-time').textContent=formatTime(time);$('qualification-time').dateTime=new Date(time).toISOString();$('qualification-age').textContent=ageLabel(time);
    $('qualification-source').href=`https://github.com/musabtheone11/roof-measure/commit/${data.sourceRevision}`;$('qualification-source').textContent=`Source ${data.sourceRevision}`;
    $('qualification-counts').textContent=`Selected: ${summary.selectedCount} · Inference attempted: ${summary.attemptedCount} · Valid contributions: ${summary.validCount} · Reviews completed: ${summary.reviewedCount}`;
    $('qualification-scope').textContent=text(data.scope,600)||'Scoped subscription run; no full-roster coverage or roof-accuracy approval is implied.';
    $('qualification-models-heading').textContent=`Selected models (${data.models.length})`;
    $('qualification-models').replaceChildren(...data.models.map(row=>{
      const item=make('li');item.append(make('code','',text(row.model,200)),make('span','',`${isValid(row)?'Valid contribution':labels[row.status]||'Not reported'}${needsReview(row)?' · review needed':''} · review ${title(row.reviewStatus||'not reported')}`));
      if(row.code)item.append(make('span','secondary',`Recorded reason: ${text(row.code,100)}`));return item;
    }));
  }
  function renderWork(error=null) {
    $('productive-work').hidden=false;$('work-content').hidden=!work;
    if(!work) {$('work-notice').textContent=error?.status===404?'No productive engineering work journal has been published. The other journals remain separate.':'Productive work status could not be loaded. The other journals remain available.';return;}
    const data=work,time=timestamp(data),summary=data.summary;
    $('work-notice').textContent=error?'Could not refresh this work run. Its last loaded record remains below; roster and subscription records are unchanged.':'These are distinct engineering questions and their task records, separate from model qualification and the full-roster journal.';
    if(summary.workItems===0)$('work-notice').textContent+=' No productive work questions were recorded for this run.';
    else if(summary.dispatchedTasks===0)$('work-notice').textContent+=' Questions were recorded, but no model task was dispatched.';
    if(!error&&Date.now()-time>STALE_MS)$('work-notice').textContent+=' This work record is older than 36 hours.';
    $('work-notice').dataset.kind=error||summary.dispatchedTasks===0?'warning':'';
    $('work-run').href=safeProjectURL(data.run?.url)||WORKFLOW_URL;$('work-run').textContent=`Run #${text(String(data.run?.id||'not reported'),30)} · attempt ${count(data.run?.attempt)??'?'} · pipeline ${title(data.run?.pipelineResult||'not reported')}`;
    $('work-time').textContent=formatTime(time);$('work-time').dateTime=new Date(time).toISOString();$('work-age').textContent=ageLabel(time);
    $('work-source').href=`https://github.com/musabtheone11/roof-measure/commit/${data.sourceRevision}`;$('work-source').textContent=`Source ${data.sourceRevision}`;
    $('work-counts').replaceChildren(...[['workItems','Distinct work questions'],['uniqueModels','Unique models used'],['dispatchedTasks','Tasks dispatched'],['validatedTasks','Validated task outputs'],['independentlyReviewed','Independently reviewed'],['completedFixes','Completed fixes']].map(([key,label])=>{
      const cell=make('div');cell.dataset.metric=key;cell.append(make('dt','',label),make('dd','',String(summary[key])));return cell;
    }));
    $('work-task-counts').textContent=`Author tasks: ${summary.authorTasks} · Review tasks: ${summary.reviewTasks} · Awaiting independent review: ${summary.awaitingIndependentReview} · Failed tasks: ${summary.failed}`;
    $('work-scope').textContent=text(data.scope,600)||'Scoped engineering work; accepted proposals are subject to independent verification and implementation before release.';
    const artifact=safeProjectURL(data.reportArtifact?.url),available=data.reportArtifact?.available===true&&artifact;
    $('work-evidence').textContent=available?'Open work and review evidence artifacts':'Work evidence not published';$('work-evidence').setAttribute('aria-disabled',available?'false':'true');
    if(available){$('work-evidence').href=artifact;$('work-evidence').target='_blank';$('work-evidence').rel='noopener noreferrer';}else $('work-evidence').removeAttribute('href');
    $('work-models-heading').textContent=`Model task counts (${data.models.length} unique models)`;
    $('work-models').replaceChildren(...data.models.map(row=>{const item=make('li');item.append(make('code','',text(row.model,200)),make('span','',`${row.taskCount} recorded tasks · ${row.validatedTaskCount} validated outputs`));return item;}));
  }
  function schedule() {
    clearTimeout(timer);if(document.visibilityState!=='visible')return;
    timer=setTimeout(refresh,Math.max(0,POLL_MS-(Date.now()-lastAttempt)));
  }
  async function refresh() {
    if(inFlight)return;
    if(document.visibilityState!=='visible'){schedule();return;}
    inFlight=true;lastAttempt=Date.now();$('refresh').disabled=true;$('refresh').textContent='Refreshing…';
    async function read(url,validate) {
      const response=await fetch(url,{cache:'no-store',credentials:'omit',referrerPolicy:'no-referrer',redirect:'error',signal:AbortSignal.timeout(15_000)});
      if(!response.ok){const error=new Error(`HTTP ${response.status}`);error.status=response.status;throw error;}
      const body=await response.text();if(body.length>262144)throw new Error('Status exceeds its size limit');return validate(JSON.parse(body));
    }
    try {
      await Promise.allSettled([
        read(STATUS_URL,checkedStatus).then(data=>{snapshot=data;renderSnapshot();}).catch(error=>{
          if(snapshot)renderSnapshot();else {$('agents').setAttribute('aria-busy','false');$('empty').hidden=false;$('empty-title').textContent='Agent status is unavailable';$('empty-detail').textContent='Refresh to try again, or open the cloud workflow to inspect its latest run.';}
          notice(`Could not refresh public status${/^HTTP \d{3}$/.test(error.message)?` (${error.message})`:''}. ${snapshot?'The last successfully loaded record remains below; current activity is unverified.':'No model activity has been loaded. Open the cloud workflow or try Refresh status.'}`,'error');
        }),
        read(QUALIFICATION_URL,checkedQualification).then(data=>{qualification=data;renderQualification();}).catch(renderQualification),
        read(WORK_URL,checkedWork).then(data=>{work=data;renderWork();}).catch(renderWork)
      ]);
    }finally {inFlight=false;$('refresh').disabled=false;$('refresh').textContent='Refresh status';schedule();}
  }
  $('refresh').addEventListener('click',refresh);$('filters').addEventListener('submit',event=>event.preventDefault());
  for(const id of ['search','team','status'])$(id).addEventListener(id==='search'?'input':'change',renderCards);
  document.addEventListener('visibilitychange',schedule);
  refresh();
})();
