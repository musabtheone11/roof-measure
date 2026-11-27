import {mkdirSync,writeFileSync,readFileSync,readdirSync} from 'node:fs';
import {resolve,join,relative} from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {zipSync} from '../vendor/fflate/browser.mjs';
import {OrgStore} from './store.mjs';
import {digest} from './workflow.mjs';
import {AUTHORIZED_BUDGET} from './config.mjs';
import {requestOrganizationRole} from './provider.mjs';
import {runCloudCases} from './cloud-cases.mjs';
import {verifyCloudPDF} from './cloud-pdf.mjs';

export const CLOUD_PROTOCOL='cloud-evaluation-v1';
export function monitoringDecision(metrics,reviews,pdfReview,browserStatus='not-run') {
  const reasons=[];
  if(!metrics || !Number.isInteger(metrics.attempted) || metrics.attempted<1)reasons.push('NO_CASES');
  if(metrics?.traceFailures)reasons.push('TRACE_FAILURES');
  if(metrics?.diagnosticPasses!==metrics?.attempted)reasons.push('NUMERICAL_OR_TOPOLOGY_FAILURES');
  if(metrics?.generatedCustomerPDFs!==metrics?.attempted)reasons.push('REPORTS_MISSING');
  if(!pdfReview||pdfReview.checked!==metrics?.attempted||pdfReview.failed!==0)reasons.push('PDF_READBACK_FAILED_OR_MISSING');
  if(!metrics?.splits?.holdout?.cases||!metrics?.splits?.validation?.cases)reasons.push('EVALUATION_SPLIT_COVERAGE_MISSING');
  if(browserStatus!=='passed')reasons.push('APP_BROWSER_CHECK_FAILED_OR_MISSING');
  if(reviews.some(r=>r.status!=='complete'))reasons.push('MODEL_REVIEW_INCOMPLETE');
  if(reviews.some(r=>r.decision!=='pass'))reasons.push('MODEL_REVIEW_NOT_PASS');
  if(reviews.length!==2)reasons.push('TWO_INDEPENDENT_ROLES_REQUIRED');
  return {status:reasons.length?'review-required':'synthetic-monitoring-pass',reasons,
    productionReleaseApproved:false,fieldAccuracyValidated:false,
    meaning:'Monitoring of generated cases only; no application code is promoted by this decision'};
}
function directoryZip(directory) {
  const files={};let total=0;
  function visit(dir) { for(const entry of readdirSync(dir,{withFileTypes:true})) {
    const p=join(dir,entry.name);if(entry.isSymbolicLink())throw new Error('Artifact symlinks are forbidden');
    if(entry.isDirectory())visit(p);else if(entry.isFile()) {
      const name=relative(directory,p).replaceAll('\\','/');
      if(name.endsWith('.zip'))continue;
      const bytes=readFileSync(p);total+=bytes.length;if(total>32*1024*1024)throw new Error('Cloud report archive exceeds32MiB limit');files[name]=new Uint8Array(bytes);
    }
  }}
  visit(directory);return Buffer.from(zipSync(files,{level:6}));
}
export async function runCloudCycle({stateDir,outputDir,seed,count=12,sourceRevision,apiKey=process.env.APINEX_API_KEY,paidAllowed=false,browserStatus='not-run',
  casesRunner=runCloudCases,requestRole=requestOrganizationRole,checkpoint=async()=>{},now=Date.now}={}) {
  if(!stateDir||!outputDir||!sourceRevision||!Number.isSafeInteger(seed))throw new Error('Explicit cloud state/output/seed/revision required');
  outputDir=resolve(outputDir);stateDir=resolve(stateDir);mkdirSync(outputDir,{recursive:true,mode:0o700});
  const generated=await casesRunner({outputDir,seed,count,sourceRevision});
  const pdfResults=[];
  for(const item of generated.cases||[]) {
    try {
      const review=await verifyCloudPDF({pdfPath:join(outputDir,item.artifacts.customerPDF.path),dataPath:join(outputDir,item.artifacts.customerData.path)});
      pdfResults.push({id:item.id,...review});
    }catch(error){pdfResults.push({id:item.id,ok:false,issues:[{code:'PDF_REVIEW_FAILED',message:error.message.slice(0,300)}]});}
  }
  const pdfReview={checked:pdfResults.length,failed:pdfResults.filter(x=>!x.ok).length,results:pdfResults};
  writeFileSync(join(outputDir,'pdf-verification.json'),JSON.stringify(pdfReview,null,2));
  const identity={protocol:CLOUD_PROTOCOL,sourceRevision,seed,count,fixtureHash:generated.fixtureHash,
    generatorSourceSha256:generated.generatorSourceSha256,engineSourceHashes:generated.engineSourceHashes,
    metricsHash:digest(generated.metrics),verificationPolicyHash:digest(generated.policy||{})};
  const evaluationHash=digest(identity),workflowId=`cloud-${evaluationHash.slice(0,32)}`;
  let store;const reviews=[];let stateWarning=null;
  try {store=new OrgStore(stateDir,{now});}catch(error){if(paidAllowed&&apiKey)throw error;stateWarning='Prior state is unreadable; deterministic reports continue without resetting paid history';}
  try {
    store?.recover();store?.setControl('running');
    // Development detail only. CEO sees aggregate evaluation and critique, never held-out oracle rows.
    const allDevelopment=(generated.cases||[]).filter(c=>c.split==='development');
    const development=allDevelopment.slice(0,6).map(c=>({id:c.id,verification:c.verification,actual:c.actual,propertyGroup:c.propertyGroup}));
    const developmentIds=new Set(allDevelopment.map(c=>c.id)),developmentPDFs=pdfResults.filter(r=>developmentIds.has(r.id));
    const developmentMetrics={scope:'development-only',attempted:allDevelopment.length,
      diagnosticPasses:allDevelopment.filter(c=>c.verification?.diagnosticPass).length,traceFailures:allDevelopment.filter(c=>c.error).length};
    const contextBase={protocol:CLOUD_PROTOCOL,sourceRevision,seed,metrics:generated.metrics,policy:generated.policy,
      oracleMethod:generated.oracle,execution:generated.execution,fixtureHash:generated.fixtureHash,engineSourceHashes:generated.engineSourceHashes,
      pdfReview:{checked:pdfReview.checked,failed:pdfReview.failed,method:'Independent PDF.js readback: quantity rows, metadata, Letter, text bounds/contrast, no images or vector paths'},scope:generated.scope,
      warning:'Generated synthetic roofs, not field accuracy. These PDFs are outputs, not reference truth. No code was changed.'};
    const inputBytes=Buffer.from(JSON.stringify({identity,metrics:generated.metrics}));
    const inputArtifact=store?store.putArtifact(inputBytes):{hash:digest(inputBytes)};
    for(const [role,model,actorId] of [['critique','gpt-6.2-astra','cloud-independent-critic'],['ceo','claude-opus-5.5','cloud-ceo']]) {
      const id=`${workflowId}-${role}`;
      const task={schemaVersion:1,id,workflowId,maxAttempts:1,role,actorId,sourceRevision,datasetRevision:CLOUD_PROTOCOL,
        candidateHash:evaluationHash,policyVersion:CLOUD_PROTOCOL,inputHashes:[inputArtifact.hash],stage:role,
        constraints:{maxRuntimeMs:45000,maxOutputTokens:2000,sourceHashes:[inputArtifact.hash]}};
      if(!paidAllowed||!apiKey) {reviews.push({taskId:id,role,model,status:'disabled',code:!paidAllowed?'CHECKPOINT_LINEAGE_BLOCKED':'CLOUD_SECRET_NOT_CONFIGURED'});continue;}
      const circuit=store.events().find(e=>e.kind==='cloud-provider-circuit-open');
      if(circuit) {reviews.push({taskId:id,role,model,status:'blocked',code:'PERMANENT_PROVIDER_FAILURE_REQUIRES_RECONCILIATION'});continue;}
      const existing=store.getTask(id);
      if(existing) {
        if(existing.result?.resultHash)writeFileSync(join(outputDir,`${role}-review.json`),store.readArtifact(existing.result.resultHash));
        if(existing.result?.rawResponseHash)writeFileSync(join(outputDir,`${role}-original-response.json`),store.readArtifact(existing.result.rawResponseHash));
        reviews.push({taskId:id,role,model,status:existing.status,decision:existing.result?.decision||null,resultHash:existing.result?.resultHash||null,reused:true});continue;
      }
      store.enqueue(task);const lease=store.claim(`cloud-${role}`,{leaseMs:120000});
      if(!lease||lease.id!==id)throw new Error('Cloud queue contains unresolved earlier work; paid dispatch blocked');
      let artifact=null,settled=false;
      const critiqueHash=reviews[0]?.resultHash;
      const critique=critiqueHash?JSON.parse(store.readArtifact(critiqueHash)).result:reviews[0]||null;
      const context=role==='critique'?{...contextBase,metrics:developmentMetrics,
        pdfReview:{checked:developmentPDFs.length,failed:developmentPDFs.filter(p=>!p.ok).length},developmentCases:development,
        task:'Challenge failures and unsupported assumptions. Propose focused regression hypotheses. Do not approve based on model agreement.'}
        :{...contextBase,critique,task:'Review recorded evidence and prioritize next improvements. Reject this synthetic monitoring candidate when recorded numerical or topology checks fail. Request human input only for genuinely missing evidence or authority, not simply because a known test failed. No field claim is being requested. Your recommendation cannot override numerical failures or release code.'};
      try {
        const response=await requestRole(task,{apiKey,model,context,
          reserve:async({usd})=>{const a=store.reserve(id,`cloud-${role}`,lease.fence,{usd,...AUTHORIZED_BUDGET,requestLimit:2});await checkpoint({phase:'reserved',taskId:id});return a;},
          onDispatch:async a=>{store.dispatch(a,`cloud-${role}`,lease.fence);await checkpoint({phase:'dispatched',taskId:id});},
          onUsage:async(a,usage)=>{store.settle(a,`cloud-${role}`,lease.fence,usage);await checkpoint({phase:'settled',taskId:id});},
          onResponse:record=>{artifact=store.putArtifact(Buffer.from(JSON.stringify(record)));}});
        const result=store.putArtifact(Buffer.from(JSON.stringify(response)));
        const data={decision:response.result.decision,resultHash:result.hash,execution:response.execution};
        store.finish(id,`cloud-${role}`,lease.fence,{status:response.result.decision==='reject'?'rejected':'complete',result:data});settled=true;
        writeFileSync(join(outputDir,`${role}-review.json`),JSON.stringify(response,null,2));
        reviews.push({taskId:id,role,model,status:response.result.decision==='reject'?'rejected':'complete',...data});
      }catch(error) {
        const code=error.code||'REVIEW_FAILED';const result={rawResponseHash:artifact?.hash||null};
        store.finish(id,`cloud-${role}`,lease.fence,{status:'failed',result,error:code});settled=true;
        if([400,401,403].includes(error.status)||['MODEL_UNAVAILABLE','PRICING_UNKNOWN'].includes(code))store.event(null,'cloud-provider-circuit-open',{code,status:error.status||null});
        reviews.push({taskId:id,role,model,status:'failed',code,httpStatus:error.status||null,...result});
      }finally {if(!settled)store.recover();}
    }
    const ledger=store?store.ledger():{requests:null,reportedUsd:null,reservedUsd:null,unknownBillingRequests:null};
    const report={schemaVersion:1,protocol:CLOUD_PROTOCOL,sourceRevision,seed,count,evaluationHash,
      generatedAt:new Date(now()).toISOString(),metrics:generated.metrics,reviews,stateWarning,
      browserStatus,pdfReview:{checked:pdfReview.checked,failed:pdfReview.failed},decision:monitoringDecision(generated.metrics,reviews,pdfReview,browserStatus),
      budget:{requestLimit:2,maxUsd:AUTHORIZED_BUDGET.maxUsd,dayUsd:AUTHORIZED_BUDGET.dayUsd,weekUsd:20,monthUsd:80,
        totalRequests:ledger.requests,reportedUsd:ledger.reportedUsd,committedUsd:ledger.reservedUsd,unknownBillingRequests:ledger.unknownBillingRequests},
      windowsDownloadsRequired:false,scope:'Cloud-generated monitoring; synthetic cases are not real-property accuracy evidence'};
    writeFileSync(join(outputDir,'cycle.json'),JSON.stringify(report,null,2));
    const escaped=x=>String(x).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
    const pdfs=(generated.cases||[]).map(c=>c.artifacts?.customerPDF?.path).filter(Boolean);
    writeFileSync(join(outputDir,'index.html'),`<!doctype html><meta charset="utf-8"><title>Roof Measure cloud evaluation</title><h1>Cloud roof evaluation</h1><p>${escaped(report.decision.status)} — generated cases only; review required.</p><p>No Windows files needed. No production release or field accuracy certification.</p><p><a href="roof-reports.zip">Download reports and evidence ZIP</a></p><pre>${escaped(JSON.stringify({revision:sourceRevision,metrics:report.metrics,reviews:report.reviews,budget:report.budget},null,2))}</pre><ul>${pdfs.map(p=>`<li><a href="${escaped(p)}">Customer report PDF</a></li>`).join('')}</ul>`);
    writeFileSync(join(outputDir,'roof-reports.zip'),directoryZip(outputDir));
    await checkpoint({phase:'complete',evaluationHash});
    return report;
  }finally {store?.setControl('paused');store?.close();}
}
if(process.argv[1]===fileURLToPath(import.meta.url)) {
  const args=process.argv.slice(2),arg=(key,fallback)=>{const i=args.indexOf(key);return i<0?fallback:args[i+1];};
  const sourceRevision=execFileSync('git',['rev-parse','HEAD'],{cwd:fileURLToPath(new URL('..',import.meta.url)),encoding:'utf8'}).trim();
  const seed=Number(arg('--seed',new Date().toISOString().slice(0,10).replaceAll('-','')));
  runCloudCycle({stateDir:arg('--state','.devcache/cloud-state'),outputDir:arg('--output','.devcache/cloud-output'),
    count:Number(arg('--count','12')),seed,sourceRevision,browserStatus:process.env.ROOF_CLOUD_BROWSER_STATUS==='success'?'passed':'not-run',paidAllowed:process.env.ROOF_CLOUD_PAID_ALLOWED==='true',apiKey:process.env.ROOF_CLOUD_PAID_ALLOWED==='true'?process.env.APINEX_API_KEY:null}).then(r=>{
      console.log(JSON.stringify({status:r.decision.status,metrics:r.metrics,reviews:r.reviews.map(x=>({role:x.role,status:x.status})),budget:r.budget}));
      if(process.env.GITHUB_STEP_SUMMARY)writeFileSync(process.env.GITHUB_STEP_SUMMARY,
        `# Roof cloud evaluation\n\nDecision: **${r.decision.status}**\n\nGenerated reports: ${r.metrics.generatedCustomerPDFs}; numerical diagnostic passes: ${r.metrics.diagnosticPasses}/${r.metrics.attempted}; PDF failures: ${r.pdfReview.failed}.\n\nModel review: ${r.reviews.map(x=>x.role+'='+x.status).join(', ')}.\n\nReported cumulative debit: ${r.budget.reportedUsd==null?'unknown':'$'+r.budget.reportedUsd}; unknown billing requests: ${r.budget.unknownBillingRequests}.\n\nDownload the report artifact attached to this run, extract it and open index.html or the individual PDFs.\n\nSynthetic monitoring only. No field accuracy certification or code promotion. Windows Downloads are not required.\n`,{flag:'a'});
    })
    .catch(error=>{console.error(error.message);process.exitCode=1;});
}
