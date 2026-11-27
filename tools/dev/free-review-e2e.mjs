// Opt-in live trial for ONE checked-in synthetic image. Keep the shipped role defaults separate.
import assert from 'node:assert/strict';
import { randomBytes, createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { startPrivatePreview } from '../../server/preview.mjs';
import { startRuntime } from '../../server/http.mjs';
import { runRoofAgents } from '../../server/agents.mjs';
import { analyzeRoofModel, compareProposals } from '../../server/geometry.mjs';
import { canonicalResult } from '../../server/main.mjs';

assert(process.env.ROOF_LIVE_FREE_E2E === '1' && process.env.APINEX_API_KEY,
  'Explicitly enable the single live trial and configure the server-side credential.');
const output = resolve('.devcache/live-review');
await mkdir(output,{recursive:true});
const fixture = new URL('./fixtures/runtime-vision/simple-gable.png',import.meta.url);
const bytes = await readFile(fixture);
const model = 'free/qwen-3.8-max', independent = 'free/gpt-6-luna';
const models = {quality:model,outline:model,structure:model,independent,adjudication:model};
const pricing = Object.fromEntries([model,independent].map(id=>[id,{
  inputPerMillion:0,outputPerMillion:0,contextTokens:1048576,source:'https://apinex.bond/api/public/models'
}]));
let dispatches=0, observed;
const controller=new AbortController();
const username='review-evaluation',password=randomBytes(32).toString('hex');
const gateway=await startPrivatePreview({port:0,username,password,createRuntime:opts=>startRuntime({
  ...opts, modelConfig:{models,pricing,limits:{maxRequests:8,maxTokens:6000000,maxCostUsd:0,maxUsd:0}},
  measure:x=>analyzeRoofModel(x.model,x.imageMetadata,{revision:x.revision}),
  runAgents:async (input,settings)=>{
    assert.equal(++dispatches,1,'Only one live upload per evaluation');
    const result=await runRoofAgents({...input,models,budget:{maxRequests:8,maxTokens:6000000,maxUsd:0,maxOutputTokens:2400}},
      {...settings,signal:AbortSignal.any([settings.signal,controller.signal]),compareTraces:compareProposals,pricing,concurrency:1,retries:0});
    observed={ledger:result.ledger,failures:result.failures,roles:Object.entries(result.originalOutputHistory).flatMap(([role,records])=>
      records.map(({requestedModel,returnedModel,requestId,usage,validation})=>({role,requestedModel,returnedModel,requestId,usage,valid:validation?.valid}))),
      comparison:result.comparison?.iou,sourceHash:createHash('sha256').update(bytes).digest('hex')};
    await writeFile(resolve(output,'trial.json'),JSON.stringify(observed,null,2));
    return canonicalResult(result,input);
  }
})});
let browser;
try {
  const base='http://127.0.0.1:'+gateway.address().port;
  assert.equal((await fetch(base+'/api/ai/config')).status,401);
  browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH});
  const page=await browser.newPage({httpCredentials:{username,password},acceptDownloads:true,viewport:{width:1400,height:960}});
  await page.route(/^https?:/,route=>new URL(route.request().url()).origin===base?route.continue():route.abort());
  await page.goto(base);
  await page.click('#panelAITrace > summary');
  await page.click('#btnOpenAITrace');
  await page.setInputFiles('#aiFile',{name:'simple-gable.png',mimeType:'image/png',buffer:bytes});
  await page.waitForFunction(()=>rmAIReview.snapshot().sourceReady);
  await page.fill('#aiSource','Analytic synthetic gable, no field reference');
  await page.fill('#aiDate','2026-11-25');
  await page.selectOption('#aiView','orthographic');
  await page.click('#aiPickTarget');
  const canvas=page.locator('#aiCanvas');
  const rect=await canvas.boundingBox();
  const {width,height}=await page.evaluate(()=>rmAIReview.snapshot().metadata);
  await canvas.click({position:{x:rect.width*300/width,y:rect.height*200/height}});
  await page.check('#aiConsent');
  await page.click('#aiRun');
  await page.waitForFunction(()=>rmAIReview.snapshot().model && !document.querySelector('#aiPDF').disabled,null,{timeout:360000});
  for (const [button,name] of [['#aiExport','review.json'],['#aiPDF','review.pdf']]) {
    const wait=page.waitForEvent('download');
    await page.click(button);
    await (await wait).saveAs(resolve(output,name));
  }
  const pdf=await readFile(resolve(output,'review.pdf'));
  assert.equal(pdf.subarray(0,5).toString(),'%PDF-');
  const saved=JSON.parse(await readFile(resolve(output,'review.json'),'utf8'));
  assert.equal(saved.measurementStatus,'current');
  assert.equal(saved.measurementSnapshot.revision,saved.revision);
  assert.equal(saved.latestResult.measurements.projectedAreaM2,null,'No physical scale was supplied');
  assert(observed.ledger.requests>0 && observed.ledger.requests<=8);
  assert.equal(observed.ledger.billedUsd,0);
  Object.assign(observed,{browser:browser.version(),pdfBytes:pdf.length,downloaded:true,
    projectedAreaM2:saved.latestResult.measurements.projectedAreaM2,revision:saved.revision,source:'synthetic-development',mode:'local authenticated evaluation'});
  await writeFile(resolve(output,'trial.json'),JSON.stringify(observed,null,2));
  console.log(JSON.stringify({requests:observed.ledger.requests,reportedUsd:observed.ledger.billedUsd,unknownBilling:observed.ledger.unknownBillingRequests,pdfBytes:pdf.length}));
} finally {
  controller.abort();
  await browser?.close();
  await new Promise(done=>gateway.close(done));
}
