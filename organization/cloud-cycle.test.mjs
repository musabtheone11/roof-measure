import test from 'node:test';import assert from 'node:assert/strict';import{mkdtempSync,rmSync,writeFileSync,readFileSync}from'node:fs';import{tmpdir}from'node:os';import{join}from'node:path';
import{runCloudCycle,monitoringDecision,cloudModelProfile,ALLOWANCE_QUALIFICATION_MODELS,ALLOWANCE_ROSTER_MODELS}from'./cloud-cycle.mjs';import{renderCustomerPDF}from'./customer-report.mjs';
import{MODEL_CATALOG}from'./model-catalog.mjs';
function setup(t){const dir=mkdtempSync(join(tmpdir(),'roof-cloud-cycle-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));return{stateDir:join(dir,'state'),outputDir:join(dir,'output'),seed:123,count:3,sourceRevision:'fixture-source',browserStatus:'passed'};}
async function casesRunner({outputDir}){const cases=[];for(const [i,split]of['development','validation','holdout'].entries()){
 const report={schemaVersion:1,jobId:'Synthetic'+i,revision:'v1',date:'2026',buildingScope:'Synthetic',status:'REVIEW REQUIRED',quantities:[{name:'Sloped area',value:100,unit:'ft²',status:'inferred',source:'Actual test-output fixture'}],notes:['Not field validation.']};
 writeFileSync(join(outputDir,`case${i}.pdf`),renderCustomerPDF(report));writeFileSync(join(outputDir,`case${i}.json`),JSON.stringify(report));
 cases.push({id:'case'+i,split,propertyGroup:'group'+i,actual:{slopedAreaSqFt:100},verification:{diagnosticPass:true},artifacts:{customerPDF:{path:`case${i}.pdf`},customerData:{path:`case${i}.json`}}});}
 return{scope:'Unit fixture, not actual tracer',fixtureHash:'a'.repeat(64),generatorSourceSha256:'b'.repeat(64),cases,metrics:{attempted:3,traceFailures:0,diagnosticPasses:3,generatedCustomerPDFs:3,splits:{holdout:{cases:1},validation:{cases:1}}}};}
test('cloudcycle works withoutWindows and blocks paid inference unless explicit eligibility',async t=>{
 const opts=setup(t);let calls=0;const r=await runCloudCycle({...opts,casesRunner,apiKey:'configured-but-disabled',requestRole:async()=>{calls++;}});
 assert.equal(calls,0);assert.equal(r.windowsDownloadsRequired,false);assert.equal(r.pdfReview.failed,0);assert.equal(r.pdfReview.checked,3);
 assert.equal(r.decision.productionReleaseApproved,false);assert.equal(r.reviews[0].code,'CHECKPOINT_LINEAGE_BLOCKED');assert.ok(readFileSync(join(opts.outputDir,'roof-reports.zip')).length>100);
});
test('two qualified roles use budgets, receive isolated detail and reruns reuse persisted results',async t=>{
 const opts=setup(t);let calls=0;const contexts=[];
 async function requestRole(task,options){calls++;contexts.push({role:task.role,context:options.context});const id=await options.reserve({usd:.524288});await options.onDispatch(id);await options.onUsage(id,{reportedUsd:.0001});return{result:{role:task.role,decision:'pass',summary:'Test proposal only',payload:task.role==='critique'?{counterexamples:['test'],recommendation:'Verify'}:{priority:1,requestedDecision:'approve'}},execution:{reportedUsd:.0001}};}
 const first=await runCloudCycle({...opts,casesRunner,apiKey:'test',paidAllowed:true,requestRole});assert.equal(calls,2);assert.equal(first.decision.status,'synthetic-monitoring-pass');
 assert.deepEqual(contexts[0].context.developmentCases.map(c=>c.id),['case0']);assert.equal(contexts[0].context.metrics.attempted,1);assert.equal(contexts[0].context.metrics.splits,undefined);assert.equal(contexts[1].context.developmentCases,undefined);assert.equal(contexts[1].context.critique.payload.recommendation,'Verify');
 const next=await runCloudCycle({...opts,casesRunner,apiKey:'test',paidAllowed:true,requestRole});assert.equal(calls,2);assert.ok(next.reviews.every(r=>r.reused));assert.equal(next.budget.totalRequests,2);
});
test('CEO pass cannot override numerical/PDF/split failures',()=>{
 const reviews=[{status:'complete',decision:'pass'},{status:'complete',decision:'pass'}];
 const r=monitoringDecision({attempted:3,diagnosticPasses:2,traceFailures:0,generatedCustomerPDFs:3,splits:{}},reviews,{checked:3,failed:1});assert.equal(r.status,'review-required');
 assert.ok(r.reasons.includes('NUMERICAL_OR_TOPOLOGY_FAILURES'));assert.ok(r.reasons.includes('PDF_READBACK_FAILED_OR_MISSING'));assert.ok(r.reasons.includes('EVALUATION_SPLIT_COVERAGE_MISSING'));
});
test('fleet mode hands off only development rows and keeps trusted release gates',async t=>{
 const opts=setup(t);let received;
 const r=await runCloudCycle({...opts,casesRunner,apiKey:'test',paidAllowed:true,fleetMode:true,catalogAuditor:async()=>({status:'verified',hash:'c'.repeat(64),issuesByModel:{}}),fleetRunner:async input=>{
   received=input;
   return {catalog:{checkedAt:'2026-11-27T00:00:00Z'},coverage:{rosterCount:3},budget:{requestLimit:64,maxUsd:2},agents:[
     {model:'fixture/one',role:'engineering',status:'complete',attempted:true,reviewStatus:'complete',decision:'revise'},
     {model:'fixture/two',role:'critique',status:'failed',attempted:true,reviewStatus:'unavailable'},
     {model:'fixture/three',role:'ceo',status:'blocked',attempted:false,reviewStatus:'pending'}]};
 }});
 assert.deepEqual(received.developmentContext.developmentCases.map(c=>c.id),['case0']);
 assert.equal(received.developmentContext.metrics.attempted,1);assert.equal(received.developmentContext.metrics.splits,undefined);
 assert.equal(received.developmentContext.developmentCases[0].reportObservation.quantities[0].value,100);
 assert.equal(received.aggregateContext.developmentCases,undefined);
 assert.equal(received.aggregateContext.metrics.splits.validation.diagnosticPasses,1);
 assert.equal(received.aggregateContext.metrics.splits.holdout.reviewRequired,0);
 assert.equal(r.reviews.length,3);assert.equal(r.budget.requestLimit,64);assert.equal(r.budget.maxUsd,2);
 assert.equal(r.decision.productionReleaseApproved,false);assert.ok(r.decision.reasons.includes('FLEET_COVERAGE_INCOMPLETE'));
 assert.ok(r.decision.reasons.includes('INDEPENDENT_FLEET_REVIEW_INCOMPLETE'));
});
test('permanentproviderfault opens persisted circuit instead of spending on every newseed',async t=>{
 const opts=setup(t);let calls=0;const requestRole=async()=>{calls++;throw Object.assign(new Error('HTTP403'),{code:'UPSTREAM_HTTP',status:403});};
 await runCloudCycle({...opts,casesRunner,apiKey:'test',paidAllowed:true,requestRole});assert.equal(calls,1);
 await runCloudCycle({...opts,seed:124,casesRunner,apiKey:'test',paidAllowed:true,requestRole});assert.equal(calls,1);
});
test('image studio and visual critique share the text workflow and produce51 unique model rows',async t=>{
 const opts=setup(t);let textLimits,sharedId;
 const images=['free/nano-banana-2','nano-banana-2','gpt-image-2.6-flare','gpt-image-2.6-sunburst','seedream-5','grok-imagine-2'];
 const r=await runCloudCycle({...opts,casesRunner,apiKey:'test',paidAllowed:true,fleetMode:true,designMode:true,
   catalogAuditor:async()=>({status:'verified',hash:'c'.repeat(64),issuesByModel:{}}),
   fleetRunner:async input=>{assert.equal(input.allowanceReserveUnits,5000000);textLimits=input.limits;return{planHash:'d'.repeat(64),catalog:{rosterCount:45},coverage:{},budget:{maxUsd:2},agents:Array.from({length:45},(_,i)=>({model:i===0?'gpt-6.1-terra':'fixture/'+i,role:'engineering',attempted:true,primaryValidated:true,status:'complete',reviewStatus:'complete',decision:'revise'}))};},
   designRunner:async input=>{sharedId=input.workflowId;return{workflowId:sharedId,agents:images.map(model=>({model,team:'design studio',task:'Create a raster design concept.',status:'complete',attempted:true,artifact:{sha256:'e'.repeat(64)}})),artifacts:[],coverage:{assigned:6,attempted:6,generated:6}};},
   designReviewer:async input=>{assert.equal(input.workflowId,sharedId);assert.equal(input.designFleet.agents.length,6);return{reviewerModel:'gpt-6.1-terra',attempted:true,reviewCompleted:true,status:'complete',decision:'revise'};}});
 assert.equal(textLimits.requestLimit,57);assert.equal(sharedId,'fleet-'+'d'.repeat(32));
 assert.equal(r.reviews.length,51);assert.equal(new Set(r.reviews.map(row=>row.model)).size,51);
 assert.equal(r.fleet.catalog.textRosterCount,45);assert.equal(r.fleet.catalog.designModelCount,6);assert.equal(r.fleet.catalog.rosterCount,51);
 assert.equal(r.fleet.designReview.reviewCompleted,true);assert.equal(r.budget.requestLimit,64);
 assert.equal(r.fleet.coverage.assigned,51);assert.equal(r.fleet.coverage.independentlyReviewed,51);
 assert.equal(r.fleet.coverage.notAttempted,0);assert.equal(r.fleet.coverage.failed,0);assert.equal(r.fleet.coverage.complete,true);
 assert.equal(r.fleet.budget.totalRequests,r.budget.totalRequests);assert.equal(r.fleet.budget.reportedUsd,r.budget.reportedUsd);
 assert.ok(r.reviews.filter(row=>row.contributionKind==='design-concept').every(row=>row.reviewerModel==='gpt-6.1-terra'&&row.reviewStatus==='complete'));
 assert.equal(r.decision.productionReleaseApproved,false);
});
test('allowance qualification forces the selected three-model zero-USD fleet and omits images and paid-role paths',async t=>{
 const opts=setup(t);let received,designCalls=0,roleCalls=0;
 const r=await runCloudCycle({...opts,casesRunner,apiKey:'test',paidAllowed:true,allowanceQualification:true,fleetMode:false,designMode:true,
   requestRole:async()=>{roleCalls++;throw new Error('Paid role path must remain disabled');},
   designRunner:async()=>{designCalls++;throw new Error('Image generation must remain disabled');},
   designReviewer:async()=>{designCalls++;throw new Error('Image review must remain disabled');},
   catalogAuditor:async()=>({status:'verified',hash:'c'.repeat(64),issuesByModel:{}}),
   fleetRunner:async input=>{
     received=input;const leaseTask={id:'qualification-fixture',workflowId:'qualification-fixture'};input.store.enqueue(leaseTask);const lease=input.store.claim('qualification-worker');
     const stamp=Date.now(),attempt=input.store.reserve(lease.id,'qualification-worker',lease.fence,{usd:0,requestLimit:6,maxUsd:0,hourUsd:3,dayUsd:3,weekUsd:20,monthUsd:80,
       allowance:{reservedUnits:100,remainingUnits:123456789,observedAt:stamp,expiresAt:stamp+60000,periodKey:'private-test-period',unlimited:false}});
     input.store.dispatch(attempt,'qualification-worker',lease.fence);input.store.settle(attempt,'qualification-worker',lease.fence,{reportedUsd:0,reportedAllowanceUnits:null,estimatedAllowanceUnits:3});
     input.store.finish(lease.id,'qualification-worker',lease.fence,{status:'complete'});
     return{planHash:'d'.repeat(64),catalog:{rosterCount:45},coverage:{selectedCount:3},budget:{requestLimit:6,maxUsd:0},agents:input.selectedModelIds.map(model=>({model,role:'critique',status:'complete',primaryValidated:true,attempted:true,reviewStatus:'complete',decision:'revise'}))};
   }});
 assert.deepEqual(received.selectedModelIds,[...ALLOWANCE_QUALIFICATION_MODELS]);assert.deepEqual(received.limits,{requestLimit:6,maxUsd:0});
 assert.equal(designCalls,0);assert.equal(roleCalls,0);assert.equal(r.executionProfile,'allowance-qualification');assert.equal(r.fleet.agents.length,3);assert.equal(r.fleet.design,undefined);
 assert.equal(r.budget.maxUsd,0);assert.equal(r.budget.requestLimit,6);assert.equal(r.budget.reportedUsd,0);assert.equal(r.budget.committedUsd,0);assert.equal(r.budget.weekUsd,20);
 assert.equal(r.allowance.reservedUnits,100);assert.equal(r.allowance.estimatedUnits,3);assert.equal(r.allowance.unknownAllowanceRequests,1);assert.equal(r.allowance.attempts,undefined);
 assert.doesNotMatch(JSON.stringify(r.allowance),/remaining|observed|expires|period/i);assert.equal(JSON.parse(readFileSync(join(opts.outputDir,'cycle.json'))).executionProfile,'allowance-qualification');
 assert.equal(r.decision.productionReleaseApproved,false);assert.match(r.scope,/Three selected free models only/);
});
test('CLI model-mode mapping isolates allowance qualification without changing the all-model profile',()=>{
 assert.deepEqual(cloudModelProfile('allowance-qualification'),{allowanceQualification:true,allowanceRoster:false,allowanceWork:false,fleetMode:true,designMode:false});
 assert.deepEqual(cloudModelProfile('all-models'),{allowanceQualification:false,allowanceRoster:false,allowanceWork:false,fleetMode:true,designMode:true});
 assert.deepEqual(cloudModelProfile(undefined),{allowanceQualification:false,allowanceRoster:false,allowanceWork:false,fleetMode:false,designMode:false});
 assert.deepEqual(cloudModelProfile('allowance-roster'),{allowanceQualification:false,allowanceRoster:true,allowanceWork:false,fleetMode:true,designMode:false});
});
test('allowance roster selects every verified free model within zero USD,48requests and60minutes without image calls',async t=>{
 const opts=setup(t);let received,images=0;
 const r=await runCloudCycle({...opts,casesRunner,apiKey:'test',paidAllowed:true,allowanceRoster:true,designMode:true,
   catalogAuditor:async()=>({status:'verified',hash:'c'.repeat(64),issuesByModel:{}}),
   requestRole:async()=>{throw new Error('Paid fallback must remain disabled');},
   designRunner:async()=>{images++;throw new Error('Image generation disabled');},
   designReviewer:async()=>{images++;throw new Error('Image review disabled');},
   fleetRunner:async input=>{received=input;return{catalog:{rosterCount:MODEL_CATALOG.length},coverage:{selectedCount:input.selectedModelIds.length},budget:{requestLimit:48,maxUsd:0},
     agents:input.selectedModelIds.map(model=>({model,role:'critique',status:'blocked',attempted:false,primaryValidated:false,reviewStatus:'pending'}))};}});
 assert.equal(ALLOWANCE_ROSTER_MODELS.length,23);assert.deepEqual([...ALLOWANCE_ROSTER_MODELS],MODEL_CATALOG.filter(m=>m.billingTier==='free-allowance').map(m=>m.id));
 assert.deepEqual(received.selectedModelIds,[...ALLOWANCE_ROSTER_MODELS]);assert.ok(received.selectedModelIds.every(id=>{const m=MODEL_CATALOG.find(row=>row.id===id);return m.billingTier==='free-allowance'&&m.inputPerMillion===0&&m.outputPerMillion===0;}));
 assert.deepEqual(received.limits,{requestLimit:48,maxUsd:0});assert.equal(received.runtimeMs,60*60000);assert.equal(received.allowanceReserveUnits,0);
 assert.equal(images,0);assert.equal(r.executionProfile,'allowance-roster');assert.equal(r.budget.maxUsd,0);assert.equal(r.budget.requestLimit,48);assert.equal(r.budget.weekUsd,20);
 assert.equal(r.fleet.agents.length,23);assert.equal(r.fleet.design,undefined);assert.match(r.scope,/All 23 verified free-allowance text models selected/);
 assert.equal(r.allowance.attempts,undefined);assert.doesNotMatch(JSON.stringify(r.allowance),/remaining|observed|expires|period/i);
 assert.equal(r.decision.productionReleaseApproved,false);assert.equal(r.decision.fieldAccuracyValidated,false);
});

test('productive case mode uses restored store, dev packets, zeroUSD and no qualification or paid fallback',async t=>{
 const opts=setup(t);let received;
 const r=await runCloudCycle({...opts,casesRunner,apiKey:'test',paidAllowed:true,allowanceWork:true,designMode:true,
   casePacketBuilder:({generated,pdfResults})=>{assert.equal(pdfResults.length,3);return generated.cases.filter(c=>c.split==='development');},
   casePlanBuilder:({store,measurementIdentity,casePackets,maxItems})=>{assert.ok(store);assert.equal(casePackets.length,1);assert.equal(maxItems,8);assert.equal(measurementIdentity.generatorSourceSha256,'b'.repeat(64));return{planHash:'e'.repeat(64)};},
   caseWorkRunner:async input=>{received=input;return{planHash:input.plan.planHash,workItems:[],models:[],counts:{uniqueModels:0,workItems:0},productionReleaseApproved:false};},
   fleetRunner:async()=>{throw new Error('No fleet rerun');},requestRole:async()=>{throw new Error('No paid fallback');},designRunner:async()=>{throw new Error('No designs');}});
 assert.equal(r.executionProfile,'allowance-work');assert.equal(r.fleet,null);assert.deepEqual(received.limits,{requestLimit:48,maxUsd:0});assert.equal(received.runtimeMs,3600000);
 assert.equal(r.budget.maxUsd,0);assert.equal(r.budget.requestLimit,48);assert.equal(r.caseWork.planHash,'e'.repeat(64));assert.ok(r.decision.reasons.includes('CASE_WORK_IS_ADVISORY_NO_IMPLEMENTED_FIX'));assert.equal(r.decision.productionReleaseApproved,false);
 assert.deepEqual(cloudModelProfile('allowance-work'),{allowanceQualification:false,allowanceRoster:false,allowanceWork:true,fleetMode:false,designMode:false});
});
