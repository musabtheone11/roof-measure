// Real jsPDF/browser output with deterministic synthetic geometry; no AI/API calls.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { fixture } from '../../bench/ai-report-test.mjs';
import { analyzeRoofModel } from '../../server/geometry.mjs';
import { startRuntime } from '../../server/http.mjs';
const ROOT = path.resolve(import.meta.dirname, '../..'), out = path.join(ROOT, '.devcache/ai-report-tests');
fs.mkdirSync(out, { recursive: true });
const { chromium } = createRequire(import.meta.url)('playwright');
const server = await startRuntime({port:Number(process.env.AI_REPORT_TEST_PORT || 0),apiKey:''});
const port = server.address().port, browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox'] });
try {
  const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1200, height: 900 } });
  const page = await context.newPage(); let downloads = 0; const errors = [];
  page.on('download', () => downloads++); page.on('pageerror', e => errors.push(e.message));
  await page.route('**/api/ai/**', route => route.abort());
  await page.goto(`http://localhost:${port}/`);
  await page.waitForFunction(() => window.jspdf?.jsPDF);
  await page.addScriptTag({ path: path.join(ROOT, 'ai-report.js') });
  const source = await page.evaluate(async () => {
    const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 480;
    const g = canvas.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, 640, 480); g.fillStyle = '#eee'; g.fillRect(100, 120, 400, 240);
    g.strokeStyle = '#222'; g.lineWidth = 3; g.strokeRect(100, 120, 400, 240); g.beginPath(); g.moveTo(100, 240); g.lineTo(500, 240); g.stroke();
    const image = canvas.toDataURL('image/png'), bytes = Uint8Array.from(atob(image.split(',')[1]), c => c.charCodeAt(0));
    const sha256 = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(n => n.toString(16).padStart(2, '0')).join('');
    return { image, sha256 };
  });
  const layouts = {};
  for (const [name, flags] of [['calibrated', {}], ['unknown', { metadata: { calibration: null } }], ['perspective', { perspective: true }], ['missing-outline', { missingOutline: true }]]) {
    const p = fixture(flags); p.sourceImage = source.image; p.imageMetadata.imageFingerprint = { algorithm: 'SHA-256', sha256: source.sha256 };
    p.measurementSnapshot.imageMetadata = structuredClone(p.imageMetadata); p.latestResult = analyzeRoofModel(p.model, p.imageMetadata, { revision: p.revision });
    const result = await page.evaluate(async p => { const blob = await buildAIReviewPDF(p); return { bytes: Array.from(new Uint8Array(await blob.arrayBuffer())), layout: blob.reviewReport }; }, p);
    fs.writeFileSync(path.join(out, name + '.pdf'), Buffer.from(result.bytes)); layouts[name] = result.layout;
    const r = spawnSync('pdftotext', ['-layout', path.join(out, name + '.pdf'), '-'], { encoding: 'utf8' }); assert.equal(r.status, 0);
    fs.writeFileSync(path.join(out, name + '.txt'), r.stdout);
    assert.match(r.stdout, /SOURCE IMAGE REVIEW/); assert.match(r.stdout, /REVIEW REQUIRED/); assert.doesNotMatch(r.stdout, /\bCOMPLETE\b/);
    assert.match(r.stdout, /SOURCE-REPORTED \/ UNVERIFIED/); assert.match(r.stdout, /40 ft printed on source; not independently verified/);
    assert.match(r.stdout, /No geographic north or map scale is established/); assert.match(r.stdout, /No order quantities/);
    if (name === 'calibrated') {
      assert.match(r.stdout, /960\.00 ft²/); assert.match(r.stdout, /1,073\.31 ft²/); assert.match(r.stdout, /6\.0 \/ 12 ±0\.10/);
      assert.match(r.stdout, /E1 \/ top[\s\S]*?400\.00\s+40\.00/);
    } else {
      assert.doesNotMatch(r.stdout, /960\.00 ft²|1,073\.31 ft²/);
      if (name === 'missing-outline') assert.match(r.stdout, /Polygon requires at least three vertices/);
      else assert.match(r.stdout, name === 'unknown' ? /no usable verified image calibration/ : /perspective, oblique or uncalibrated/);
    }
    assert.equal(result.layout.clippedText, 0); assert.equal(result.layout.unplacedKeys.length, 0);
  }
  const stale = fixture(); stale.sourceImage = source.image; stale.imageMetadata.imageFingerprint = { algorithm: 'SHA-256', sha256: source.sha256 };
  stale.measurementSnapshot.imageMetadata = structuredClone(stale.imageMetadata); stale.latestResult = analyzeRoofModel(stale.model, stale.imageMetadata, { revision: stale.revision });
  const mutation = await page.evaluate(async input => { const build = buildAIReviewPDF(input); input.imageMetadata.source = 'Changed during generation'; try { await build; return 'accepted'; } catch (e) { return e.message; } }, stale);
  assert.match(mutation, /differs|changed/);
  const wrongImage = structuredClone(stale); wrongImage.imageMetadata.imageFingerprint.sha256 = '0'.repeat(64); wrongImage.measurementSnapshot.imageMetadata = structuredClone(wrongImage.imageMetadata);
  assert.match(await page.evaluate(async input => { try { await buildAIReviewPDF(input); return 'accepted'; } catch (e) { return e.message; } }, wrongImage), /preview differs/);
  assert.equal(downloads, 0, 'The builder has no automatic download side effects.');
  assert.deepEqual(errors, []);
  fs.writeFileSync(path.join(out, 'layout.json'), JSON.stringify(layouts, null, 2));
  const vectorCheck = spawnSync('python', ['-c', `import fitz,json
from pathlib import Path
root=Path(${JSON.stringify(out)}); d=fitz.open(root/'calibrated.pdf');p=d[0]
expected=((185,324.4),(427,324.4)); lines=[]
for i,draw in enumerate(p.get_drawings()):
 for item in draw['items']:
  if item[0]=='l' and abs(item[1].x-185)<.02 and abs(item[1].y-324.4)<.02 and abs(item[2].x-427)<.02 and abs(item[2].y-324.4)<.02: lines.append(i)
assert lines,'Internal unclassified edge must remain a visible vector stroke'
for draw in p.get_drawings()[lines[-1]+1:]:
 if draw['type'] in ('f','fs') and draw['rect'].width>400: raise AssertionError('A later facet fill hid the internal edge')
sources=[im for im in p.get_images() if im[2:4]==(640,480)]
assert len(sources)==1
r=p.get_image_rects(sources[0][0])[0];assert abs(r.width/r.height-640/480)<1e-5,'Source preview aspect must be preserved'
for file in root.glob('*.pdf'):
 pdf=fitz.open(file)
 for i,page in enumerate(pdf):
  assert tuple(page.rect)==(0,0,612,792)
  for block in page.get_text('dict')['blocks']:
   for line in block.get('lines',[]):
    for span in line.get('spans',[]):
     x0,y0,x1,y1=span['bbox'];assert x0>=0 and y0>=0 and x1<=612 and y1<=792,'Clipped text'
  page.get_pixmap(matrix=fitz.Matrix(1.4,1.4)).save(root/(file.stem+'-page-'+str(i+1)+'.png'))
print('AI review PDFs: Letter, source-preview aspect, visible internal vector edge and no clipped text pass.')
`], { encoding: 'utf8' });
  assert.equal(vectorCheck.status, 0, vectorCheck.stdout + vectorCheck.stderr); console.log(vectorCheck.stdout.trim());
  console.log('AI review PDF browser: calibrated/unknown values, source annotations, revision guards and no download side effects pass.');
} finally { await browser.close(); server.close(); }
