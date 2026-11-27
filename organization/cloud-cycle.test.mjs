import test from 'node:test';import assert from 'node:assert/strict';import{mkdtempSync,rmSync,writeFileSync,readFileSync}from'node:fs';import{tmpdir}from'node:os';import{join}from'node:path';
import{runCloudCycle,monitoringDecision}from'./cloud-cycle.mjs';import{renderCustomerPDF}from'./customer-report.mjs';
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
test('permanentproviderfault opens persisted circuit instead of spending on every newseed',async t=>{
 const opts=setup(t);let calls=0;const requestRole=async()=>{calls++;throw Object.assign(new Error('HTTP403'),{code:'UPSTREAM_HTTP',status:403});};
 await runCloudCycle({...opts,casesRunner,apiKey:'test',paidAllowed:true,requestRole});assert.equal(calls,1);
 await runCloudCycle({...opts,seed:124,casesRunner,apiKey:'test',paidAllowed:true,requestRole});assert.equal(calls,1);
});
