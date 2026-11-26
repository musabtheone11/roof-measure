// Real uploads, calibration, revision edits and downloads. No inference or map service.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { chromium } from 'playwright';
import { testServer } from './ui-test-server.mjs';

const runtime = await testServer();
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const output = path.resolve(import.meta.dirname, '../../.devcache/source-review-delivery');
await fs.mkdir(output, { recursive: true });
const page = await browser.newPage({ acceptDownloads: true, viewport: { width: 1440, height: 900 } });
page.setDefaultTimeout(10000);
const inference = [];
page.on('request', request => {
  if (new URL(request.url()).pathname === '/api/ai/trace') inference.push(request.url());
});

async function upload(color, name) {
  const data = await page.evaluate(color => {
    const canvas = document.createElement('canvas');
    canvas.width = 320; canvas.height = 240;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = 'white'; ctx.fillRect(0, 0, 320, 240);
    ctx.fillStyle = color; ctx.fillRect(40, 40, 200, 100);
    return canvas.toDataURL().split(',')[1];
  }, color);
  await page.setInputFiles('#aiFile', { name, mimeType: 'image/png', buffer: Buffer.from(data, 'base64') });
  await page.waitForFunction(name => rmAIReview.snapshot().metadata.fileName === name && rmAIReview.snapshot().sourceReady, name);
}

async function current() {
  await page.waitForFunction(() => {
    const s = rmAIReview.snapshot();
    return s.model && s.revision === s.measurementRevision;
  });
}

async function download(selector, filename) {
  const pending = page.waitForEvent('download');
  await page.click(selector);
  const event = await pending;
  assert.equal(await event.failure(), null);
  const file = path.join(output, filename);
  await event.saveAs(file);
  return file;
}

async function traceShape(selector = '#aiTraceOutline', points = [[40,40], [240,40], [240,140], [40,140]]) {
  await page.click(selector);
  const box = await page.locator('#aiCanvas').boundingBox();
  assert.equal(await page.locator('#aiTraceDone').isEnabled(),true,await page.locator('#aiMessage').textContent());
  for (const [x, y] of points)
    await page.locator('#aiCanvas').click({position:{x:x*box.width/320,y:y*box.height/240}});
  await page.click('#aiTraceDone');
  await current();
}

try {
  await page.route('**/*', route => new URL(route.request().url()).origin === new URL(runtime.baseURL).origin
    ? route.continue() : route.abort());
  await page.goto(runtime.baseURL);
  await page.click('#panelAITrace > summary');
  await page.click('#btnOpenAITrace');
  await upload('#777', 'isolated-A.png');
  await page.fill('#aiSource', 'Synthetic previous job A');
  await page.locator('#aiSource').press('Tab');
  await traceShape();
  await upload('#888', 'isolated-B.png');
  await traceShape();
  await traceShape('#aiTraceFacet');
  await traceShape('#aiTraceEdge', [[40,40],[240,40]]);
  const initial = JSON.parse(await fs.readFile(await download('#aiExport', 'job-b.json'), 'utf8'));
  assert.equal(initial.previousReviews.length, 0, 'A new source job must exclude the previous job audit');
  assert.doesNotMatch(JSON.stringify(initial), /isolated-A|Synthetic previous job A/);
  assert.equal(initial.model.facets[0].status,'unresolved');
  assert.equal(initial.latestResult.measurements.projectedAreaM2,null);
  assert.equal(initial.model.edges[0].type,'unspecified');

  // Exercise legacy identifiers and a revision newer than this tab. All geometry came from the pen.
  initial.revision = 80;
  initial.model.facets[0].id = 'main:west';
  initial.model.edges[0].id = 'edge:one';
  initial.corrections.push({revision:80, action:'Synthetic legacy identifiers'});
  await page.setInputFiles('#aiImport', {name:'saved-B.json', mimeType:'application/json', buffer:Buffer.from(JSON.stringify(initial))});
  await page.waitForFunction(() => rmAIReview.snapshot().model?.facets[0]?.id === 'main:west');
  await current();
  assert((await page.evaluate(() => rmAIReview.snapshot().revision)) > 80, 'Reopen must advance past the saved revision');
  await page.selectOption('#aiPurpose', 'roof-sketch');
  await page.fill('#aiSource', 'Synthetic 20 by 10 ft plane');
  await page.selectOption('#aiView', 'orthographic');
  await page.fill('#aiDate', '2026-11-25');
  await page.locator('details').filter({has:page.locator('#aiX1')}).locator('summary').click();
  for (const [id,value] of Object.entries({aiX1:40,aiY1:40,aiX2:240,aiY2:40,aiLength:20}))
    await page.fill('#'+id,String(value));
  await page.fill('#aiCalibrationSource','Analytic synthetic reference segment');
  await page.check('#aiCalibrationVerified');
  await page.selectOption('#aiShape','facet:main:west');
  await page.fill('#aiBoundaryNote','Four visible corners of synthetic rectangle.');
  await page.click('#aiConfirmBoundary');
  await page.fill('#aiPitch','5'); await page.fill('#aiPitchSource','Synthetic 5/12 slope');
  await page.fill('#aiPitchUncertainty','0'); await page.click('#aiSavePitch');
  await page.selectOption('#aiShape','edge:edge:one');
  await page.selectOption('#aiEdgeType','eave');
  await page.fill('#aiBoundaryNote','Top exterior edge of synthetic rectangle.');
  await page.click('#aiConfirmBoundary'); await current();
  const job = JSON.parse(await fs.readFile(await download('#aiExport', 'review.json'), 'utf8'));
  const m = job.latestResult.measurements;
  assert(Math.abs(m.projectedAreaM2 / 0.09290304 - 200) < 1e-8);
  assert(Math.abs(m.slopedAreaM2 / 0.09290304 - 200 * 13 / 12) < 1e-8);
  assert(Math.abs(m.edges[0].horizontalLengthM / 0.3048 - 20) < 1e-8);
  const pdf = await download('#aiPDF','review.pdf');
  const extracted = spawnSync('pdftotext',['-enc','UTF-8','-layout',pdf,'-'],{encoding:'utf8'});
  assert.equal(extracted.status,0,extracted.stderr);
  for (const printed of ['REVIEW REQUIRED','200.00 ft²','216.67 ft²','main:west','edge:one'])
    assert(extracted.stdout.includes(printed), 'Missing PDF value '+printed);
  const zip = await download('#aiZIP','review.zip');
  const archive = spawnSync('python', ['-c', `
import hashlib, json, sys, zipfile
with zipfile.ZipFile(sys.argv[1]) as z:
    assert sorted(z.namelist()) == ['review.json','review.pdf','source.png']
    assert z.testzip() is None
    job = json.loads(z.read('review.json'))
    assert job['revision'] == int(sys.argv[2])
    assert hashlib.sha256(z.read('source.png')).hexdigest() == job['imageMetadata']['imageFingerprint']['sha256']
    assert z.read('review.pdf').startswith(b'%PDF-')
    assert abs(job['latestResult']['measurements']['projectedAreaM2'] / .09290304 - 200) < 1e-8
`, zip, String(job.revision)], {encoding:'utf8'});
  assert.equal(archive.status,0,archive.stderr);
  await page.selectOption('#aiShape','facet:main:west');
  await page.click('#aiRemoveShape'); await current();
  assert.equal((await page.evaluate(() => rmAIReview.snapshot())).model.facets.length,0);
  await page.click('#aiUndo'); await current();
  assert.equal((await page.evaluate(() => rmAIReview.snapshot())).model.facets.length,1);
  await page.click('#aiRedo'); await current();
  assert.equal((await page.evaluate(() => rmAIReview.snapshot())).model.facets.length,0);
  await page.click('#aiUndo'); await current();
  await page.selectOption('#aiShape','edge:edge:one');
  await page.selectOption('#aiEdgeType','rake'); await current();
  assert(await page.isDisabled('#aiRedo'));
  const edited = JSON.parse(await fs.readFile(await download('#aiExport','edited.json'),'utf8'));
  assert.equal(edited.model.edges[0].geometryReview.status,'invalidated');
  assert.equal(edited.latestResult.measurements.edges[0].horizontalLengthM,null);
  await page.click('#aiRotateRight');
  await page.waitForFunction(()=>document.querySelector('#aiStatus').textContent==='Image rotated');
  const archivedFile = await download('#aiExport','rotated-history.json');
  const archived = JSON.parse(await fs.readFile(archivedFile,'utf8'));
  assert.equal(archived.model,null);
  assert.equal(archived.latestResult,null);
  assert(archived.previousReviews.some(entry=>entry.model?.facets?.length));
  await page.setInputFiles('#aiImport',archivedFile);
  await page.waitForFunction(()=>document.querySelector('#aiStatus').textContent==='Review reopened');
  assert.equal((await page.evaluate(()=>rmAIReview.snapshot())).model,null);
  assert.deepEqual(inference,[]);
  console.log('Source review delivery passed in '+browser.version()+': separate jobs, hash-bound reopen, monotonic revision, user boundary reviews, 200.00/216.67 ft², PDF and ZIP downloads with independent archive validation.');
} finally {
  await browser.close();
  await runtime.close();
}
