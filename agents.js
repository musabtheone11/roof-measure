'use strict';
(() => {
  const STATUS_URL='https://raw.githubusercontent.com/musabtheone11/roof-measure/roof-cloud-status/latest-status.json';
  const WORKFLOW_URL='https://github.com/musabtheone11/roof-measure/actions/workflows/roof-cloud.yml';
  const POLL_MS=60_000, STALE_MS=36*60*60*1000;
  const $=id=>document.getElementById(id);
  let snapshot=null, inFlight=false, timer=null, lastAttempt=0;
  const text=(value,max=400)=>typeof value==='string'?value.slice(0,max):'';
  const count=value=>Number.isSafeInteger(value)&&value>=0?value:null;
  const usd=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0?value:null;
  const title=value=>text(value,100).replace(/[-_]+/g,' ').replace(/^\w/,letter=>letter.toUpperCase());
  const formatTime=value=>new Date(value).toLocaleString(undefined,{year:'numeric',month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short'});
  const categories={complete:'complete',completed:'complete',running:'running',in_progress:'running',blocked:'blocked',deferred:'blocked',failed:'blocked',disabled:'disabled',rejected:'review','needs-human':'review','review-required':'review',queued:'queued',pending:'queued',scheduled:'queued'};
  const labels={complete:'Completed',completed:'Completed',running:'Running in record',in_progress:'Running in record',blocked:'Blocked',deferred:'Deferred',failed:'Failed',disabled:'Disabled',rejected:'Rejected','needs-human':'Human review','review-required':'Review required',queued:'Queued',pending:'Pending',scheduled:'Scheduled'};
  const blockers={CLOUD_SECRET_NOT_CONFIGURED:'The cloud job has no configured APINEX credential.',CHECKPOINT_LINEAGE_BLOCKED:'Previous billing and workflow history could not be verified.',PERMANENT_PROVIDER_FAILURE_REQUIRES_RECONCILIATION:'A provider failure needs reconciliation before more requests.',MODEL_UNAVAILABLE:'The configured model is unavailable.',PRICING_UNKNOWN:'Model pricing has not been verified.',BUDGET_EXCEEDED:'The authorized spending limit was reached.',BUDGET_LIMIT:'This request could not fit within the authorized budget.',CYCLE_REQUEST_LIMIT:'This cycle reached its bounded request limit; the assignment was deferred.',MODEL_NOT_SCHEDULED:'This model was not scheduled in the recorded cycle.'};
  const legacyRoles={critique:{team:'Independent verification',task:'Challenge synthetic evaluation evidence and unsupported conclusions.'},ceo:{team:'Engineering supervision',task:'Review recorded evidence and prioritize proposed improvements.'}};
  const make=(tag,className,value)=>{const element=document.createElement(tag);if(className)element.className=className;if(value!==undefined)element.textContent=value;return element;};
  function checkedStatus(data) {
    if(!data||typeof data!=='object'||Array.isArray(data)||data.schemaVersion!==1||!Array.isArray(data.models)||data.models.length>256)throw new Error('Invalid public status format');
    if(data.repository&&data.repository!=='musabtheone11/roof-measure')throw new Error('Status belongs to another project');
    if(data.models.some(row=>!row||typeof row!=='object'||!text(row.model,180)))throw new Error('Invalid model assignment');
    return data;
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
    const counts={complete:0,running:0,blocked:0,disabled:0,review:0,queued:0,other:0};
    for(const row of data.models)counts[categories[row.status]||'other']++;
    const unique=new Set(data.models.map(row=>row.model)).size;
    $('coverage').replaceChildren(...[[unique,'Models listed',''],[counts.complete,'Completed assignments','complete'],[counts.running,'Running in record','running'],[counts.blocked,'Blocked, deferred or failed','blocked'],[counts.disabled,'Disabled assignments','disabled']].map(([value,label,kind])=>{
      const item=make('div','coverage-item');item.dataset.kind=kind;item.append(make('strong','',String(value)),make('span','',label));return item;
    }));
    const deferred=data.models.filter(row=>row.status==='deferred').length;
    const extra=[deferred?`${deferred} deferred (not running)`:null,counts.queued?`${counts.queued} queued or pending`:null,counts.review?`${counts.review} require review or were rejected`:null,counts.other?`${counts.other} with unreported status`:null].filter(Boolean);
    const costs=data.models.map(row=>usd(row.reportedUsd)).filter(value=>value!==null);
    $('coverage-note').textContent=`${data.models.length} recorded assignment${data.models.length===1?'':'s'} across ${unique} model${unique===1?'':'s'}. ${extra.length?extra.join('; ')+'. ':''}${costs.length?`Reported model cost: $${costs.reduce((sum,value)=>sum+value,0).toFixed(4)} (${costs.length}/${data.models.length} cost records).`:'Model costs are not reported in this record.'}`;
    const fleet=data.fleet;
    $('fleet-coverage').hidden=!fleet||fleet.mode!=='all-models';
    if(fleet?.mode==='all-models') {
      const amount=value=>count(value)===null?'Not reported':String(value);
      $('fleet-coverage').textContent=`Catalog models: ${amount(fleet.rosterCount)} · Assigned: ${amount(fleet.assignedCount)} · Inference attempted: ${amount(fleet.attemptedCount)} · Output format checks passed: ${amount(fleet.validCount)} · Recorded reviews: ${amount(fleet.reviewedCount)}. Assignments and valid output formats do not establish roofing accuracy.`;
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
    const rows=modelRows().filter(row=>(!team||row.team===team)&&(!status||row.category===status)&&(!search||[row.model,row.team,row.role,row.task,row.reviewerModel,row.code].join(' ').toLocaleLowerCase().includes(search)));
    $('shown').textContent=`Showing ${rows.length} of ${snapshot.models.length} assignments`;
    $('agents').replaceChildren(...rows.map((row,index)=>{
      const card=make('article','agent-card');card.dataset.model=row.model;card.dataset.status=row.category;card.setAttribute('aria-labelledby',`model-${index}`);
      const top=make('div','agent-card-top'),badge=make('span','badge',labels[row.status]||'Not reported');badge.dataset.kind=row.category;badge.dataset.state=text(row.status,30);
      top.append(make('span','team-name',row.team),badge);
      const heading=make('h3','',row.model);heading.id=`model-${index}`;
      const details=make('dl');
      function detail(label,value,className='') {details.append(make('dt','',label),make('dd',className,value));}
      detail('Role',title(row.role));detail('Assigned task',row.task,'task');detail('Independent reviewer',row.reviewerModel||'Not recorded');
      if(row.reviewerModel===row.model)details.lastElementChild.append(make('span','reviewer-note','Same model as author; independence is not established.'));
      if(row.reviewStatus)details.lastElementChild.append(make('span','secondary',`Recorded review status: ${title(typeof row.reviewStatus==='string'?row.reviewStatus:row.reviewStatus.status)||'Not reported'}`));
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
    $('run-result').textContent=`Pipeline: ${title(data.run?.pipelineResult||'not reported')}${data.sourceRevision?` · source ${text(data.sourceRevision,12)}`:''}`;
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
    else if(counts.blocked+counts.disabled===data.models.length&&data.models.length)notice(`No model is recorded as running. ${counts.blocked} blocked, deferred or failed; ${counts.disabled} disabled in this published cycle. Open the cards for the recorded reasons.`,'warning');
    else notice(`Showing the latest published cycle. ${counts.running} assignment${counts.running===1?' is':'s are'} recorded as running; completed results remain visible. This is a status snapshot.`);
  }
  function schedule() {
    clearTimeout(timer);if(document.visibilityState!=='visible')return;
    timer=setTimeout(refresh,Math.max(0,POLL_MS-(Date.now()-lastAttempt)));
  }
  async function refresh() {
    if(inFlight)return;
    if(document.visibilityState!=='visible'){schedule();return;}
    inFlight=true;lastAttempt=Date.now();$('refresh').disabled=true;$('refresh').textContent='Refreshing…';
    try {
      const response=await fetch(STATUS_URL,{cache:'no-store',credentials:'omit',referrerPolicy:'no-referrer',redirect:'error',signal:AbortSignal.timeout(15_000)});
      if(!response.ok)throw new Error(`HTTP ${response.status}`);
      const body=await response.text();if(body.length>262144)throw new Error('Status exceeds its size limit');
      snapshot=checkedStatus(JSON.parse(body));renderSnapshot();
    }catch(error) {
      if(snapshot)renderSnapshot();else {$('agents').setAttribute('aria-busy','false');$('empty').hidden=false;$('empty-title').textContent='Agent status is unavailable';$('empty-detail').textContent='Refresh to try again, or open the cloud workflow to inspect its latest run.';}
      notice(`Could not refresh public status${/^HTTP \d{3}$/.test(error.message)?` (${error.message})`:''}. ${snapshot?'The last successfully loaded record remains below; current activity is unverified.':'No model activity has been loaded. Open the cloud workflow or try Refresh status.'}`,'error');
    }finally {inFlight=false;$('refresh').disabled=false;$('refresh').textContent='Refresh status';schedule();}
  }
  $('refresh').addEventListener('click',refresh);$('filters').addEventListener('submit',event=>event.preventDefault());
  for(const id of ['search','team','status'])$(id).addEventListener(id==='search'?'input':'change',renderCards);
  document.addEventListener('visibilitychange',schedule);
  refresh();
})();
