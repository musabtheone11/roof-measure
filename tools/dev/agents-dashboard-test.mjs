import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {chromium} from 'playwright';
import {testServer} from './ui-test-server.mjs';

const STATUS_URL='https://raw.githubusercontent.com/musabtheone11/roof-measure/roof-cloud-status/latest-status.json';
const QUALIFICATION_URL='https://raw.githubusercontent.com/musabtheone11/roof-measure/roof-cloud-status/latest-qualification.json';
const WORK_URL='https://raw.githubusercontent.com/musabtheone11/roof-measure/roof-cloud-status/latest-work.json';
const artifacts=path.resolve('.devcache/agents-dashboard');
await fs.mkdir(artifacts,{recursive:true});
const now=Date.now(),teams=['Roof measurement engineering','Sketch and document interpretation','Independent verification','Reports and visual layout','Reference data','Real-case testing','Operations'];
const statuses=['complete','running','blocked','disabled','needs-human','queued'];
const unavailableModels=['claude-fable-5.1','free/jev-1.13','gemini-3.1-pro','gpt-5.6-terra','gpt-6-astra','gpt-6-luna-decisions','gpt-6.1-sol','kimi-k3','subq-snap-preview'];
const fixture={schemaVersion:1,repository:'musabtheone11/roof-measure',generatedAt:new Date(now).toISOString(),sourceRevision:'a'.repeat(40),
  run:{id:'12345',attempt:2,url:'https://github.com/musabtheone11/roof-measure/actions/runs/12345',pipelineResult:'success',startedAt:new Date(now-60_000).toISOString()},
  reportArtifact:{available:true,url:'https://github.com/musabtheone11/roof-measure/actions/runs/12345#artifacts'},
  evaluation:{status:'review-required',attempted:12,diagnosticPasses:9,generatedCustomerPDFs:12,fieldAccuracyValidated:false},
  fleet:{mode:'all-models',catalogCheckedAt:new Date(now-3600_000).toISOString(),catalogHash:'b'.repeat(64),rosterCount:45,assignedCount:45,attemptedCount:30,validCount:15,blockedCount:8,reviewedCount:12,unavailableModels},
  scope:'SYNTHETIC DASHBOARD TEST FIXTURE — these are illustrative statuses, not live agent activity or field accuracy evidence.',
  models:Array.from({length:45},(_,index)=>({model:`fixture/model-${String(index+1).padStart(2,'0')}${index===44?'-with-a-long-explicit-model-identifier-for-responsive-layout':''}`,team:teams[index%teams.length],role:index%teams.length===0?'geometry-engineer':'evidence-reviewer',
    task:index%teams.length===0?'Confirm shared edges, closed facet polygons and independently calculated plan and sloped areas.':'Cross-check the recorded evidence, identify missing information and produce a traceable review for the next team.',
    reviewerModel:`fixture/model-${String((index+1)%45+1).padStart(2,'0')}`,status:statuses[index%statuses.length],contributionValidated:[0,4].includes(index%statuses.length),reviewStatus:index%3===0?'complete':'pending',
    ...(index%statuses.length===2||index%statuses.length===3?{code:'CLOUD_SECRET_NOT_CONFIGURED'}:{}),decision:index%statuses.length===0?'revise':null,reportedUsd:index%statuses.length===0?.0007:null}))};
const server=await testServer(process.argv[2]);
let browser;
try {
  browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||chromium.executablePath()});
  const context=await browser.newContext({viewport:{width:1440,height:1000},deviceScaleFactor:1});
  const errors=[],unexpected=[],requests=[],qualificationRequests=[],workRequests=[];
  let response={status:200,body:fixture},qualificationResponse={status:404,body:{error:'No synthetic subscription journal'}},workResponse={status:404,body:{error:'No synthetic work journal'}};
  await context.route('**/*',async route=>{
    const url=route.request().url();
    if(url===STATUS_URL) {
      requests.push({url,method:route.request().method(),headers:route.request().headers()});
      await route.fulfill({status:response.status,contentType:'application/json',body:JSON.stringify(response.body)});
    } else if(url===QUALIFICATION_URL) {
      qualificationRequests.push({url,method:route.request().method(),headers:route.request().headers()});
      const next=typeof qualificationResponse==='function'?await qualificationResponse():qualificationResponse;
      await route.fulfill({status:next.status,contentType:'application/json',body:JSON.stringify(next.body)});
    } else if(url===WORK_URL) {
      workRequests.push({url,method:route.request().method(),headers:route.request().headers()});
      await route.fulfill({status:workResponse.status,contentType:'application/json',body:JSON.stringify(workResponse.body)});
    } else if(new URL(url).origin===new URL(server.baseURL).origin)await route.continue();
    else {unexpected.push(url);await route.abort();}
  });
  async function open({clock=false}={}) {
    const page=await context.newPage();page.setDefaultTimeout(10_000);page.on('pageerror',error=>errors.push(error.message));
    if(clock) {
      await page.clock.install({time:new Date(now)});
      await page.addInitScript(()=>Object.defineProperty(document,'visibilityState',{configurable:true,get:()=>window.__fixtureVisibility||'visible'}));
    }
    const document=await page.goto(server.baseURL+'/agents.html');
    assert.equal(document.status(),200,'The actual app server must serve agents.html.');
    return page;
  }
  async function loaded(page,count=45) {await page.waitForFunction(expected=>document.querySelectorAll('.agent-card').length===expected,count);}
  async function refresh(page,next) {
    response=next;
    const network=page.waitForResponse(STATUS_URL);
    await page.click('#refresh');await network;
    await page.waitForFunction(()=>!document.querySelector('#refresh').disabled);
  }
  async function noClipping(page) {
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'Dashboard must not scroll horizontally.');
    const outside=await page.locator('.agent-card,.agent-card .badge').evaluateAll(elements=>elements.filter(element=>{
      const box=element.getBoundingClientRect();return box.left<0||box.right>innerWidth;
    }).length);
    assert.equal(outside,0,'Cards and status labels must fit the viewport.');
  }

  const page=await open();await loaded(page);
  assert.equal(await page.locator('h1').innerText(),'Roof agent activity');
  assert.match(await page.locator('#scope').innerText(),/SYNTHETIC DASHBOARD TEST FIXTURE/);
  assert.equal(await page.locator('.coverage-item').first().locator('strong').innerText(),'45');
  assert.equal(await page.locator('.coverage-item[data-kind="running"] strong').innerText(),'8');
  assert.equal(await page.locator('.coverage-item[data-kind="valid"] strong').innerText(),'15');
  assert.equal(await page.locator('.coverage-item[data-kind="failed"] strong').innerText(),'0');
  assert.match(await page.locator('#fleet-coverage').innerText(),/Assigned: 45 · Inference attempted: 30/);
  assert.match(await page.locator('#fleet-coverage').innerText(),/do not establish roofing accuracy/);
  assert.match(await page.locator('#qualification-notice').innerText(),/No subscription run journal has been published/);
  assert.match(await page.locator('#work-notice').innerText(),/No productive engineering work journal has been published/);
  assert.equal(await page.locator('#work-content').isVisible(),false,'Missing work records must not invent task or fix counts.');
  assert.equal(await page.locator('#unavailable-count').innerText(),'(9)');
  await page.click('#unavailable-models > summary');
  assert.deepEqual(await page.locator('#unavailable-list li').allTextContents(),unavailableModels);
  assert.match(await page.locator('#unavailable-models').innerText(),/They were not attempted; no substitute model was used/);
  assert.equal(await page.locator('.agent-card').count(),45,'Documented unavailable IDs must remain separate from assigned models.');
  assert.equal(await page.locator('.coverage-item').first().locator('strong').innerText(),'45');
  assert.match(await page.locator('#fleet-coverage').innerText(),/Assigned: 45 · Inference attempted: 30/);
  await page.locator('#unavailable-models').evaluate(element=>element.scrollIntoView({block:'start'}));
  await page.screenshot({path:path.join(artifacts,'unavailable-catalog-models.png')});
  await page.setViewportSize({width:390,height:844});await noClipping(page);
  await page.setViewportSize({width:1440,height:1000});
  await page.click('#unavailable-models > summary');await page.evaluate(()=>scrollTo(0,0));
  assert.equal(await page.locator('#run-link').getAttribute('href'),fixture.run.url);
  assert.equal(await page.locator('#evidence-link').getAttribute('href'),fixture.reportArtifact.url);
  assert.match(await page.locator('.agent-card').first().innerText(),/Independent reviewer\nfixture\/model-02/);
  assert.match(await page.locator('.agent-card').first().innerText(),/Recorded review status: Complete/);
  await noClipping(page);
  await page.screenshot({path:path.join(artifacts,'desktop-overview.png')});
  await page.locator('#team-heading').evaluate(element=>element.scrollIntoView({block:'start'}));
  await page.screenshot({path:path.join(artifacts,'desktop-teams.png')});
  await page.setViewportSize({width:390,height:844});await noClipping(page);
  await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:path.join(artifacts,'mobile-overview.png')});
  await page.locator('.agent-card').first().scrollIntoViewIfNeeded();await page.screenshot({path:path.join(artifacts,'mobile-agent.png')});
  await page.setViewportSize({width:1440,height:1000});

  await page.fill('#search','fixture/model-14');await loaded(page,2);
  // Search includes the reviewer assignment, so both author14 and author13 match.
  assert.match(await page.locator('#shown').innerText(),/Showing 2 of 45/);
  await page.fill('#search','');await page.selectOption('#team',teams[0]);await loaded(page,fixture.models.filter(model=>model.team===teams[0]).length);
  await page.selectOption('#team','');await page.selectOption('#status','blocked');await loaded(page,8);
  assert.equal(await page.locator('.agent-card:not([data-status="blocked"])').count(),0);
  await page.selectOption('#status','');await loaded(page);

  const retained={...fixture,evaluation:{...fixture.evaluation,evidenceMode:'retained-baseline',generatedCustomerPDFs:0,retainedCustomerPDFs:12}};
  await refresh(page,{status:200,body:retained});await loaded(page,45);
  assert.match(await page.locator('#evaluation').innerText(),/Retained baseline.*12 retained reports.*0 newly generated reports/);
  const legacy={...fixture,models:[{model:'gpt-6.2-astra',role:'critique',status:'complete',decision:'revise'},{model:'claude-opus-5.5',role:'ceo',status:'disabled'}]};delete legacy.fleet;
  await refresh(page,{status:200,body:legacy});await loaded(page,2);
  assert(await page.locator('#legacy').isVisible());
  assert.match(await page.locator('#legacy').innerText(),/models absent from this record are not counted/);
  assert.equal(await page.locator('.coverage-item').first().locator('strong').innerText(),'2');
  assert.equal(await page.locator('#fleet-coverage').isVisible(),false);
  assert.equal(await page.locator('#unavailable-models').isVisible(),false);
  assert.equal(await page.locator('#unavailable-list li').count(),0);
  assert.match(await page.locator('.agent-card').first().innerText(),/Independent reviewer\nNot recorded/);
  assert.equal(await page.locator('.agent-card').first().getAttribute('data-status'),'complete');

  const blocked={...fixture,fleet:{...fixture.fleet,attemptedCount:0,validCount:0,blockedCount:45,reviewedCount:0},models:fixture.models.map(model=>({...model,status:'blocked',contributionValidated:false,code:'CLOUD_SECRET_NOT_CONFIGURED',decision:null,reportedUsd:null}))};
  await refresh(page,{status:200,body:blocked});await loaded(page);
  assert.match(await page.locator('#connection').innerText(),/No model is recorded as running\. 45 blocked/);
  assert.equal(await page.locator('.coverage-item[data-kind="running"] strong').innerText(),'0');
  assert.match(await page.locator('#fleet-coverage').innerText(),/Inference attempted: 0/);
  assert.equal(await page.locator('.blocker code').count(),45);
  await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:path.join(artifacts,'all-blocked.png')});
  const deferred={...blocked,models:blocked.models.map((model,index)=>({...model,status:'deferred',code:index%2?'BUDGET_LIMIT':'CYCLE_REQUEST_LIMIT'}))};
  await refresh(page,{status:200,body:deferred});await loaded(page);
  assert.equal(await page.locator('.badge[data-state="deferred"]').count(),45);
  assert.equal(await page.locator('.coverage-item[data-kind="running"] strong').innerText(),'0');
  assert.match(await page.locator('#coverage-note').innerText(),/45 deferred \(not running\)/);
  assert.match(await page.locator('.blocker').first().innerText(),/bounded request limit/);
  await refresh(page,{status:503,body:{error:'Synthetic test outage'}});
  assert.equal(await page.locator('#agents .agent-card').count(),45,'A refresh failure must retain and identify the last known record.');
  assert.match(await page.locator('#connection').innerText(),/last successfully loaded record remains/);
  assert.equal(await page.locator('#connection').getAttribute('data-kind'),'error');

  const unavailable=await open();
  await unavailable.waitForFunction(()=>document.querySelector('#connection').dataset.kind==='error');
  assert.equal(await unavailable.locator('.agent-card').count(),0);
  assert.equal(await unavailable.locator('.coverage-item').count(),0,'Unknown activity must not be represented by fabricated zeros.');
  assert.match(await unavailable.locator('#empty').innerText(),/Agent status is unavailable/);
  await unavailable.screenshot({path:path.join(artifacts,'unavailable.png')});await unavailable.close();

  const stale={...fixture,generatedAt:new Date(now-4*24*3600_000).toISOString(),models:fixture.models.map(model=>({...model,status:'running'}))};
  await refresh(page,{status:200,body:stale});
  assert.match(await page.locator('#connection').innerText(),/Status freshness needs review/);
  assert.match(await page.locator('#connection').innerText(),/not current activity/);
  const unsafe={...fixture,run:{...fixture.run,url:'javascript:alert(1)'},reportArtifact:{available:true,url:'https://example.invalid/evidence'},models:[{...fixture.models[0],model:'fixture/<img src=x onerror="alert(1)">',team:'<script>not executable</script>',task:'<img src=x onerror="alert(1)">',reviewerModel:'fixture/<img src=x onerror="alert(1)">'}]};
  await refresh(page,{status:200,body:unsafe});await loaded(page,1);
  assert.equal(await page.locator('img,script:not([src="agents.js"])').count(),0,'Public strings must remain inert text.');
  assert.match(await page.locator('.reviewer-note').innerText(),/independence is not established/);
  assert.match(await page.locator('#run-link').getAttribute('href'),/actions\/workflows\/roof-cloud.yml$/);
  assert.equal(await page.locator('#evidence-link').getAttribute('href'),null);
  await noClipping(page);

  // Reproduce the misleading seven-complete/eighteen-valid snapshot. Accepted
  // proposals that still need review must never appear as execution failures.
  const fullRoster={...fixture,generatedAt:new Date(now-2*3600_000).toISOString(),sourceRevision:'b'.repeat(40),
    run:{...fixture.run,id:'77777',url:'https://github.com/musabtheone11/roof-measure/actions/runs/77777',startedAt:new Date(now-2*3600_000-60_000).toISOString()},
    fleet:{...fixture.fleet,rosterCount:51,assignedCount:51,attemptedCount:24,validCount:18,blockedCount:27,reviewedCount:13},
    models:Array.from({length:51},(_,index)=>({...fixture.models[index%45],model:`fixture/full-roster-${String(index+1).padStart(2,'0')}`,
      status:index<7?'complete':index<18?'needs-human':index<24?'failed':'blocked',contributionValidated:index<18,
      reviewStatus:index<13?'complete':'pending',decision:index<7?'pass':index<18?'needs-human':null,
      code:index<18?null:index<24?'INVALID_AGENT_OUTPUT':'MODEL_RECONCILIATION_REQUIRED'}))};
  const pilot={schemaVersion:1,repository:'musabtheone11/roof-measure',executionProfile:'allowance-qualification',generatedAt:new Date(now).toISOString(),sourceRevision:'c'.repeat(40),
    run:{id:'88888',attempt:1,url:'https://github.com/musabtheone11/roof-measure/actions/runs/88888',pipelineResult:'success'},
    summary:{selectedCount:3,attemptedCount:3,validCount:3,reviewedCount:2},scope:'SYNTHETIC SUBSCRIPTION TEST FIXTURE — three selected models; no full-roster or field-accuracy claim.',
    models:['free/gpt-6-luna','free/qwen-3.8-max','free/minimax-m3.1-flash'].map((model,index)=>({model,status:index===2?'needs-human':'complete',attempted:true,contributionValidated:true,reviewStatus:index===2?'pending':'complete'}))};
  let releaseQualification;
  qualificationResponse=()=>new Promise(resolve=>{releaseQualification=()=>resolve({status:200,body:pilot});});
  response={status:200,body:fullRoster};await page.click('#refresh');await loaded(page,51);
  assert(await page.locator('#refresh').isDisabled(),'The full roster must render even while its optional journal is still loading.');
  releaseQualification();await page.waitForFunction(()=>!document.querySelector('#refresh').disabled);
  assert.equal(await page.locator('.coverage-item[data-kind="valid"] strong').innerText(),'18');
  assert.equal(await page.locator('.coverage-item[data-kind="review"] strong').innerText(),'11');
  assert.equal(await page.locator('.coverage-item[data-kind="failed"] strong').innerText(),'6');
  assert.equal(await page.locator('.coverage-item[data-kind="blocked"] strong').innerText(),'27');
  assert.match(await page.locator('#coverage-note').innerText(),/7 with lifecycle “complete”/);
  assert.equal(await page.locator('.agent-card[data-valid="true"]').count(),18);
  const needsHuman=page.locator('.agent-card[data-status="review"]');
  assert.equal(await needsHuman.count(),11);
  assert.equal(await needsHuman.locator('.badge[data-kind="valid"]').count(),11);
  assert.equal(await needsHuman.locator('.badge[data-kind="failed"]').count(),0);
  assert.equal(await page.locator('#source-link').innerText(),'Source '+'b'.repeat(40));
  assert.equal(await page.locator('#source-link').getAttribute('href'),'https://github.com/musabtheone11/roof-measure/commit/'+'b'.repeat(40));
  assert.match(await page.locator('#run-link').innerText(),/Run #77777/);
  assert.match(await page.locator('#age').innerText(),/2 hours/);
  assert.match(await page.locator('#qualification-counts').innerText(),/Selected: 3 · Inference attempted: 3 · Valid contributions: 3 · Reviews completed: 2/);
  assert.equal(await page.locator('#qualification-models li').count(),3);
  assert.equal(await page.locator('.agent-card').count(),51,'The scoped subscription pilot must not replace the full roster.');
  await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:path.join(artifacts,'contribution-clarity-desktop.png')});
  await page.setViewportSize({width:390,height:844});await noClipping(page);
  await page.locator('#coverage').evaluate(element=>element.scrollIntoView({block:'start'}));await page.screenshot({path:path.join(artifacts,'contribution-clarity-mobile.png')});
  await page.setViewportSize({width:1440,height:1000});
  await page.locator('.agent-card[data-status="review"]').first().evaluate(element=>element.scrollIntoView({block:'start'}));
  await page.screenshot({path:path.join(artifacts,'valid-contribution-review-needed.png')});
  await page.selectOption('#status','valid');await loaded(page,18);
  await page.selectOption('#status','review');await loaded(page,11);
  await page.selectOption('#status','failed');await loaded(page,6);
  await page.selectOption('#status','blocked');await loaded(page,27);
  await page.selectOption('#status','');await loaded(page,51);
  const broad={...pilot,executionProfile:'allowance-roster',summary:{selectedCount:23,attemptedCount:23,validCount:20,reviewedCount:18},
    scope:'SYNTHETIC SUBSCRIPTION ROSTER TEST FIXTURE — twenty-three selected subscription models only.',
    models:Array.from({length:23},(_,index)=>({model:`fixture/free-model-${index+1}`,status:index<20?'needs-human':'failed',attempted:true,contributionValidated:index<20,reviewStatus:index<18?'complete':'pending'}))};
  qualificationResponse={status:200,body:broad};await refresh(page,{status:200,body:fullRoster});
  assert.match(await page.locator('#qualification-profile').innerText(),/Subscription roster/);
  assert.match(await page.locator('#qualification-counts').innerText(),/Selected: 23.*Valid contributions: 20/);
  assert.equal(await page.locator('#qualification-models li').count(),23);
  assert.equal(await page.locator('.agent-card').count(),51);
  qualificationResponse={status:503,body:{error:'Synthetic subscription outage'}};await refresh(page,{status:200,body:fullRoster});
  assert.match(await page.locator('#qualification-notice').innerText(),/last loaded record remains/);
  assert.match(await page.locator('#qualification-counts').innerText(),/Selected: 23/);
  assert.equal(await page.locator('.agent-card').count(),51);
  assert.notEqual(await page.locator('#connection').getAttribute('data-kind'),'error','An optional journal failure must not fail the full-roster journal.');
  const noResults={...broad,run:{...broad.run,pipelineResult:'failure'},summary:{selectedCount:0,attemptedCount:0,validCount:0,reviewedCount:0},models:[]};
  qualificationResponse={status:200,body:noResults};await refresh(page,{status:200,body:fullRoster});
  assert.match(await page.locator('#qualification-notice').innerText(),/No model results published/);
  assert.match(await page.locator('#qualification-counts').innerText(),/Selected: 0/);
  assert.equal(await page.locator('.agent-card').count(),51);
  qualificationResponse={status:200,body:{...noResults,run:{...noResults.run,pipelineResult:'success'}}};await refresh(page,{status:200,body:fullRoster});
  assert.match(await page.locator('#qualification-notice').innerText(),/Could not refresh this scoped run/);
  assert.match(await page.locator('#qualification-run').innerText(),/pipeline Failure/,'An invalid empty-success record must not replace the last honest failure.');

  // Productive work is a third journal: questions, models and task outputs are
  // separate counts, and none of those imply implemented or released fixes.
  const work={schemaVersion:1,repository:'musabtheone11/roof-measure',executionProfile:'allowance-work',generatedAt:new Date(now).toISOString(),sourceRevision:'d'.repeat(40),
    run:{id:'99999',attempt:1,url:'https://github.com/musabtheone11/roof-measure/actions/runs/99999',pipelineResult:'success'},
    reportArtifact:{available:true,url:'https://github.com/musabtheone11/roof-measure/actions/runs/99999#artifacts'},
    summary:{uniqueModels:3,workItems:4,authorTasks:4,reviewTasks:4,dispatchedTasks:7,validatedTasks:6,independentlyReviewed:2,awaitingIndependentReview:2,failed:1,completedFixes:0},
    models:[{model:'free/gpt-6-luna',taskCount:3,validatedTaskCount:3},{model:'free/qwen-3.8-max',taskCount:2,validatedTaskCount:2},{model:'free/minimax-m3.1-flash',taskCount:2,validatedTaskCount:1}],
    scope:'SYNTHETIC PRODUCTIVE WORK FIXTURE — accepted proposals and review outputs; zero implemented or released fixes.',
    caseWork:{workItems:[{prompt:'SYNTHETIC_PRIVATE_PACKET_SENTINEL'}]},allowance:{remainingUnits:987654321},budget:{walletBalance:'SYNTHETIC_PRIVATE_BALANCE'}};
  qualificationResponse={status:200,body:broad};workResponse={status:200,body:work};await refresh(page,{status:200,body:fullRoster});
  assert.equal(await page.locator('#work-counts [data-metric="workItems"] dd').innerText(),'4');
  assert.equal(await page.locator('#work-counts [data-metric="uniqueModels"] dd').innerText(),'3');
  assert.equal(await page.locator('#work-counts [data-metric="validatedTasks"] dd').innerText(),'6');
  assert.equal(await page.locator('#work-counts [data-metric="completedFixes"] dd').innerText(),'0');
  assert.match(await page.locator('#work-task-counts').innerText(),/Author tasks: 4 · Review tasks: 4 · Awaiting independent review: 2 · Failed tasks: 1/);
  assert.equal(await page.locator('#work-models li').count(),3);
  assert.match(await page.locator('#work-source').innerText(),new RegExp('d'.repeat(40)));
  assert.match(await page.locator('#work-run').innerText(),/Run #99999/);
  assert.equal(await page.locator('#work-evidence').getAttribute('href'),work.reportArtifact.url);
  assert.equal(await page.locator('.agent-card').count(),51);
  assert.equal(await page.locator('#qualification-models li').count(),23);
  assert.doesNotMatch(await page.locator('body').innerText(),/SYNTHETIC_PRIVATE_PACKET_SENTINEL|987654321|SYNTHETIC_PRIVATE_BALANCE/);
  await page.locator('#productive-work').evaluate(element=>element.scrollIntoView({block:'start'}));await page.screenshot({path:path.join(artifacts,'productive-work-desktop.png')});
  await page.setViewportSize({width:390,height:844});await noClipping(page);await page.locator('#productive-work').evaluate(element=>element.scrollIntoView({block:'start'}));await page.screenshot({path:path.join(artifacts,'productive-work-mobile.png')});
  await page.setViewportSize({width:1440,height:1000});
  workResponse={status:503,body:{error:'Synthetic work outage'}};await refresh(page,{status:200,body:fullRoster});
  assert.match(await page.locator('#work-notice').innerText(),/last loaded record remains/);
  assert.equal(await page.locator('#work-counts [data-metric="workItems"] dd').innerText(),'4');
  assert.equal(await page.locator('.agent-card').count(),51);assert.equal(await page.locator('#qualification-models li').count(),23);
  workResponse={status:200,body:{...work,summary:{...work.summary,completedFixes:6}}};await refresh(page,{status:200,body:fullRoster});
  assert.match(await page.locator('#work-notice').innerText(),/Could not refresh/);
  assert.equal(await page.locator('#work-counts [data-metric="completedFixes"] dd').innerText(),'0','Validated outputs must not turn into fictitious completed fixes.');
  const failedWork={...work,run:{...work.run,pipelineResult:'failure'},models:[],summary:Object.fromEntries(Object.keys(work.summary).map(key=>[key,0]))};
  workResponse={status:200,body:failedWork};await refresh(page,{status:200,body:fullRoster});
  assert.match(await page.locator('#work-notice').innerText(),/No productive work questions were recorded/);
  assert.equal(await page.locator('#work-models li').count(),0);assert.equal(await page.locator('.agent-card').count(),51);assert.equal(await page.locator('#qualification-models li').count(),23);
  workResponse={status:200,body:{...failedWork,run:{...failedWork.run,pipelineResult:'success'}}};await refresh(page,{status:200,body:fullRoster});
  assert.match(await page.locator('#work-notice').innerText(),/No productive work questions were recorded/);assert.match(await page.locator('#work-run').innerText(),/pipeline Success/);
  workResponse={status:200,body:{...failedWork,run:{...failedWork.run,pipelineResult:'success'},summary:{...failedWork.summary,workItems:4}}};await refresh(page,{status:200,body:fullRoster});
  assert.match(await page.locator('#work-notice').innerText(),/Questions were recorded, but no model task was dispatched/);
  assert.equal(await page.locator('#work-counts [data-metric="workItems"] dd').innerText(),'4');assert.equal(await page.locator('#work-counts [data-metric="uniqueModels"] dd').innerText(),'0');
  assert.equal(await page.locator('.agent-card').count(),51);assert.equal(await page.locator('#qualification-models li').count(),23);
  await page.close();

  // Run the real browser timer under a virtual clock. Hidden tabs must not poll;
  // visible polling is bounded to one request a minute, with manual refresh allowed.
  response={status:200,body:fixture};qualificationResponse={status:404,body:{error:'No synthetic subscription journal'}};workResponse={status:404,body:{error:'No synthetic work journal'}};
  const polling=await open({clock:true});await loaded(polling);
  let before=requests.length,beforeQualification=qualificationRequests.length,beforeWork=workRequests.length;
  await polling.clock.runFor(59_000);assert.equal(requests.length,before);assert.equal(qualificationRequests.length,beforeQualification);assert.equal(workRequests.length,beforeWork);
  const automatic=polling.waitForResponse(STATUS_URL);await polling.clock.runFor(1000);await automatic;
  await polling.waitForFunction(()=>!document.querySelector('#refresh').disabled);
  assert.equal(requests.length,before+1);
  assert.equal(qualificationRequests.length,beforeQualification+1);
  assert.equal(workRequests.length,beforeWork+1);
  await refresh(polling,response);before=requests.length;beforeQualification=qualificationRequests.length;beforeWork=workRequests.length;
  await polling.evaluate(()=>{window.__fixtureVisibility='hidden';document.dispatchEvent(new Event('visibilitychange'));});
  await polling.clock.runFor(180_000);assert.equal(requests.length,before,'Hidden pages must not poll.');assert.equal(qualificationRequests.length,beforeQualification);assert.equal(workRequests.length,beforeWork);
  const resumed=polling.waitForResponse(STATUS_URL);
  await polling.evaluate(()=>{window.__fixtureVisibility='visible';document.dispatchEvent(new Event('visibilitychange'));});
  await polling.clock.runFor(1);await resumed;
  await polling.waitForFunction(()=>!document.querySelector('#refresh').disabled);
  assert.equal(requests.length,before+1);
  assert.equal(qualificationRequests.length,beforeQualification+1);
  assert.equal(workRequests.length,beforeWork+1);
  await polling.clock.runFor(59_000);assert.equal(requests.length,before+1,'Visibility changes must not create duplicate polling loops.');
  await polling.close();

  assert.deepEqual(errors,[]);assert.deepEqual(unexpected,[]);
  assert([...requests,...qualificationRequests,...workRequests].every(request=>request.method==='GET'&&!request.headers.authorization),'Dashboard must only read public status without credentials.');
  await fs.writeFile(path.join(artifacts,'dashboard-check.json'),JSON.stringify({fixture:'Synthetic offline dashboard responses; not live model activity',models:45,fullRosterClarity:{models:51,validContributions:18,recordedComplete:7,needsReview:11,executionFailed:6,blocked:27},subscriptionJournalIndependent:true,subscriptionScopeSizes:[3,23],documentedUnavailableModels:9,unavailableNotCountedAsAssignedOrAttempted:true,legacyTwoModelRecord:true,blockedAndDisabledExplicit:true,inferenceVersusAssignmentCounts:true,fetchFailurePreservesPriorRecord:true,initialFailureDoesNotInventCounts:true,staleSnapshotWarning:true,inertPublicStringsAndProjectOnlyLinks:true,desktopAndMobileInspected:true,visibleOnlyMinutePolling:true,modelInferenceCalls:0,browserErrors:errors},null,2));
  console.log('Chromium:51model contribution clarity, independent3/23model subscription and productive question/task journals, zero completed-fix claims, privacy, failed-empty scopes, refresh isolation, responsive layout and visible-only60s polling passed.');
  console.log('Synthetic dashboard screenshots: '+artifacts);
} finally {await browser?.close();await server.close();}
