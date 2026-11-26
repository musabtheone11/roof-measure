import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { testServer } from './ui-test-server.mjs';
import { startRuntime } from '../../server/http.mjs';
import { analyzeRoofModel } from '../../server/geometry.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';

// The network adapter simulates one admitted provider request. The server's
// restart/ownership tests separately exercise the real database implementation.
const runtime = await testServer();
const browser = await chromium.launch({executablePath:process.env.CHROMIUM_PATH || undefined});
const page = await browser.newPage();
page.setDefaultTimeout(10000);
const key = 'roof-measure.pending-analysis.v1';
let pending, posts = 0, gets = 0, deletes = 0, done = false, badBinding = false, releaseLookup;
const rectangle = [[1,1],[21,1],[21,11],[1,11]];
const job = 'a0a0a0a0-0000-4000-8000-111111111111';
try {
  await page.route('**/*', route => new URL(route.request().url()).origin === new URL(runtime.baseURL).origin
    ? route.continue() : route.abort());
  await page.route('**/api/ai/trace', route => {
    const m = route.request().postDataJSON().imageMetadata;
    pending = {nonce:route.request().headers()['x-roof-request-id'], hash:m.imageFingerprint.sha256,
      settings:{targetPixel:m.targetPixel || null, sourcePage:m.sourcePage,rotation:m.rotation,purpose:m.purpose,view:m.view}};
    posts++;
    return route.fulfill({status:202,json:{jobId:job}});
  });
  await page.route('**/api/ai/requests/*', async route => {
    assert(route.request().url().endsWith(pending.nonce));
    if (route.request().method() === 'DELETE') {
      deletes++;
      return route.fulfill({json:{status:'cancelled'}});
    }
    gets++;
    if (releaseLookup) await releaseLookup.promise;
    return route.fulfill({json:{status:'running',jobId:job,sourceHash:badBinding?'0'.repeat(64):pending.hash,sourceSettings:pending.settings}});
  });
  await page.route('**/api/ai/jobs/*', route => route.fulfill({json:done
    ? {status:'completed',result:{model:{outline:rectangle,facets:[],edges:[]}}}
    : {status:'running',progress:['Synthetic request remains active']}}));

  async function open() {
    await page.click('#panelAITrace > summary');
    await page.click('#btnOpenAITrace');
  }
  async function source(name, color) {
    const png = await page.evaluate(color => {
      const canvas = document.createElement('canvas');
      canvas.width = 32; canvas.height = 32;
      const ctx = canvas.getContext('2d');ctx.fillStyle=color;ctx.fillRect(0,0,32,32);
      return canvas.toDataURL().split(',')[1];
    },color);
    await page.setInputFiles('#aiFile',{name,mimeType:'image/png',buffer:Buffer.from(png,'base64')});
    await page.waitForFunction(name => rmAIReview.snapshot().metadata.fileName === name && rmAIReview.snapshot().sourceReady,name);
  }
  async function dispatch() {
    await page.check('#aiConsent');
    await page.click('#aiRun');
    await page.waitForFunction(() => document.querySelector('#aiProgress').textContent.includes('remains active'));
  }
  await page.goto(runtime.baseURL); await open();
  await source('first-private-name.png','#aaa');
  await page.selectOption('#aiView','orthographic');
  await dispatch();
  const receipt = await page.evaluate(key=>sessionStorage.getItem(key),key);
  assert(receipt.includes(pending.nonce));
  assert(!/data:image|first-private-name|calibration|model|apiKey/i.test(receipt));
  await page.reload(); await open();
  await source('second.png','#bbb');
  await page.click('#aiResume');
  assert.match(await page.locator('#aiMessage').textContent(),/same image/);
  await page.check('#aiConsent'); await page.click('#aiRun');
  assert.equal(posts,1); assert.equal(gets,0);
  await source('first-again.png','#aaa');
  badBinding=true; await page.click('#aiResume');
  await page.waitForFunction(() => document.querySelector('#aiMessage').textContent.includes('binding'));
  assert.equal((await page.evaluate(()=>rmAIReview.snapshot())).model,null);
  badBinding=false;
  let release;
  releaseLookup = {promise:new Promise(resolve=>{release=resolve;})};
  const lookup = page.waitForRequest('**/api/ai/requests/*'); await page.click('#aiResume'); await lookup;
  await source('second-again.png','#bbb'); release(); releaseLookup=null;
  await source('first-final.png','#aaa');
  assert.equal((await page.evaluate(()=>rmAIReview.snapshot())).model,null);
  done=true;
  await page.click('#aiResume');
  await page.waitForFunction(() => {const s=rmAIReview.snapshot();return s.model && s.measurementRevision===s.revision;});
  assert.deepEqual((await page.evaluate(()=>rmAIReview.snapshot())).model.outline,rectangle);
  assert.equal(await page.inputValue('#aiView'),'unknown');
  assert.equal(await page.evaluate(key=>sessionStorage.getItem(key),key),null);
  assert.equal(posts,1);
  done=false; await dispatch(); await page.reload(); await open();
  await page.click('#aiStopSaved');
  await page.waitForFunction(key=>!sessionStorage.getItem(key),key);
  assert.equal(deletes,1); assert.equal(posts,2);
  console.log('Refresh recovery passed: matching owner receipt and source, wrong-source rejection, stale lookup ignored, explicit cancellation and zero redispatch.');

  // Full owner-cookie + SQLite + browser recovery across a real service restart.
  // Only the specialist call is replaced by a deterministic, held local function.
  await page.unrouteAll({behavior:'wait'});
  const directory = path.resolve(import.meta.dirname, '../../.devcache/recovery-tests');
  await fs.mkdir(directory,{recursive:true});
  const stateFile = path.join(await fs.mkdtemp(path.join(directory,'run-')),'jobs.sqlite');
  let finish, calls = 0;
  const gate = new Promise(resolve=>{finish=resolve;});
  const options = {stateFile, apiKey:'synthetic-test-only',
    runAgents:async (input, callbacks) => {
      calls++;
      callbacks.onProgress({message:'Synthetic request remains active'});
      await gate;
      return {status:'REVIEW REQUIRED',model:{outline:rectangle,facets:[],edges:[]}};
    },
    measure:input=>analyzeRoofModel(input.model,input.imageMetadata,{revision:input.revision})
  };
  let service = await startRuntime({...options,port:0});
  const port = service.address().port, origin = 'http://127.0.0.1:'+port;
  try {
    await page.route('**/*', r=>new URL(r.request().url()).origin === origin ? r.continue() : r.abort());
    await page.goto(origin); await open(); await source('journal-source.png','#555');
    await dispatch();
    const ticket = await page.evaluate(key=>JSON.parse(sessionStorage.getItem(key)),key);
    await page.reload(); finish();
    await page.waitForFunction(async nonce=>{
      const data = await (await fetch('/api/ai/requests/'+nonce)).json();
      return data.status==='completed';
    },ticket.nonce);
    await new Promise(resolve=>service.close(resolve));
    service = await startRuntime({...options,port});
    await open(); await source('journal-reopened.png','#555'); await page.click('#aiResume');
    await page.waitForFunction(()=>{const s=rmAIReview.snapshot();return s.model && s.measurementRevision===s.revision;});
    assert.deepEqual((await page.evaluate(()=>rmAIReview.snapshot())).model.outline,rectangle);
    assert.equal(calls,1);
    assert.equal(await page.evaluate(key=>sessionStorage.getItem(key),key),null);
    console.log('One admitted synthetic job reopened through the real owner session and SQLite journal after process recreation, with one specialist invocation.');
  } finally {
    finish();
    if (service.listening) await new Promise(resolve=>service.close(resolve));
  }
} finally {
  await browser.close();
  await runtime.close();
}
