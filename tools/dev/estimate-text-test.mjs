// Estimate PDF: searchable text and the business name (illustrative gable job, offline map stub; no Maps or API calls).
// The estimate pages are drawn as page images. Without a text layer a recipient could not search, select or copy a
// line item, and a browser that had saved the old built-in business name printed "DIVERSITY ROOFING" while the roof
// report says Diversity Contracting.
// Checks, on the estimate-only PDF and on the Report + estimate PDF:
// - every page carries text; the header, estimator line, line items and an accented insured name are findable, and
//   the estimate name keeps the base letters of an accented name (Nguyễn Văn Đức -> DUC-NGUYEN, not C-NGUYN);
// - the layer changes nothing a reader sees: each page renders pixel for pixel the same as a build without the layer
//   (this catches layer text that prints, and layer settings that leak into the vector sketch labels drawn after it);
// - the layer sits on the printed words: the word boxes line up with the ink of the page image;
// - every page still has its page image;
// - the saved old default name is replaced, and a name the user typed is kept.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { start } from './serve.mjs';
import { installOfflineMap } from './offline-map.mjs';
const { chromium } = createRequire(import.meta.url)('playwright');
const out = path.resolve('.devcache/estimate-text-test'); fs.mkdirSync(out, { recursive: true });
const job = JSON.parse(fs.readFileSync(new URL('../../examples/gable-control.json', import.meta.url), 'utf8'));
const INSURED = 'Nguyễn Văn Đức', INSURED_TEXT = 'Nguyen Van Duc';
const srv = await start(8198, {}); const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--no-sandbox'] });
const fail = (m) => { throw new Error(m); };
const run = (cmd, args) => execFileSync(cmd, args, { maxBuffer: 64 << 20 });
const pageCount = (f) => +/Pages:\s+(\d+)/.exec(run('pdfinfo', [f]).toString())[1];
const pageText = (f, pg) => run('pdftotext', ['-layout', '-f', String(pg), '-l', String(pg), f, '-']).toString();
function render(f, pg, dpi) {   // grayscale raster of one page (binary PGM)
  const base = path.join(out, `r-${path.basename(f, '.pdf')}-${pg}-${dpi}`);
  run('pdftoppm', ['-gray', '-r', String(dpi), '-f', String(pg), '-l', String(pg), '-singlefile', f, base]);
  const b = fs.readFileSync(base + '.pgm'); let i = 0; const tok = () => { while (/\s/.test(String.fromCharCode(b[i]))) i++; let s = ''; while (!/\s/.test(String.fromCharCode(b[i]))) s += String.fromCharCode(b[i++]); return s; };
  if (tok() !== 'P5') fail('unexpected raster format'); const w = +tok(), h = +tok(); tok(); i++;
  return { w, h, px: b.subarray(i, i + w * h) };
}
const words = (f, pg) => [...run('pdftotext', ['-bbox', '-f', String(pg), '-l', String(pg), f, '-']).toString().matchAll(/<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([^<]*)<\/word>/g)].map((m) => ({ x0: +m[1], y0: +m[2], x1: +m[3], y1: +m[4], t: m[5] }));
// The layer has to sit on the printed words: shift every word box up and down and count the dark pixels under them.
// The count must peak with no shift, and nearly every word box must cover ink.
function registration(f, pg) {
  const dpi = 144, s = dpi / 72, img = render(f, pg, dpi), ws = words(f, pg).filter((w) => w.x1 - w.x0 > 1 && w.y1 - w.y0 > 1);
  const ink = (w, dy) => { let n = 0; const x0 = Math.max(0, Math.round(w.x0 * s)), x1 = Math.min(img.w, Math.round(w.x1 * s)), y0 = Math.max(0, Math.round(w.y0 * s) + dy), y1 = Math.min(img.h, Math.round(w.y1 * s) + dy); for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if (img.px[y * img.w + x] < 128) n++; return n; };
  let best = 0, bestN = -1; for (let dy = -24; dy <= 24; dy++) { const n = ws.reduce((a, w) => a + ink(w, dy), 0); if (n > bestN) { bestN = n; best = dy; } }
  const covered = ws.filter((w) => ink(w, 0) > 0).length;
  return { words: ws.length, shiftPt: best / s, covered: ws.length ? covered / ws.length : 0 };
}
async function pdfBytes(p, fn, arg) {
  const b64 = await p.evaluate(fn, arg);
  return Buffer.from(b64, 'base64');
}
const toB64 = `const u = new Uint8Array(buf); let s = ''; for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]); return btoa(s);`;
async function openJob(ctx) {
  const p = await ctx.newPage(); const errors = []; p.on('pageerror', (e) => errors.push(e.message)); p.on('crash', () => errors.push('the browser page crashed'));
  // one clock for every build: the estimate prints the time it was entered, and two builds a minute apart differ
  await p.clock.setFixedTime(new Date('2026-11-27T10:00:00'));
  await p.goto('http://localhost:8198/'); await p.evaluate(() => { initMap(); const n = document.getElementById('nokey'); if (n) n.hidden = true; });
  await p.evaluate((d) => restore(d), job); await p.waitForFunction((n) => state.facets.length === n, job.facets.length, { timeout: 30000 });
  return { p, errors };
}
let code = 0;
try {
  // 1. A browser that saved the old built-in name, an insured name with letters outside the PDF's built-in font
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
  // seed once, in the top page only (html2canvas clones the page into frames that also run init scripts)
  await ctx.addInitScript(() => { try { if (window.top === window && !sessionStorage.getItem('seeded')) { sessionStorage.setItem('seeded', '1'); localStorage.setItem('rm.company', JSON.stringify({ name: 'Diversity Roofing' })); } } catch (_) {} });
  await ctx.addInitScript(installOfflineMap);
  const { p, errors } = await openJob(ctx);
  await p.evaluate((n) => { xm.insured = n; }, INSURED);
  const estimate = new Function('layer', `return (async () => { const keep = window.pdfTextLayer; if (!layer) window.pdfTextLayer = () => {}; try { const { html } = xmBuildHTML(); const pdf = await htmlToPDF(html, 'Estimate'); const buf = pdf.output('arraybuffer'); ${toB64} } finally { window.pdfTextLayer = keep; } })();`);
  const f = path.join(out, 'estimate.pdf'), f0 = path.join(out, 'estimate-nolayer.pdf');
  fs.writeFileSync(f, await pdfBytes(p, estimate, true)); fs.writeFileSync(f0, await pdfBytes(p, estimate, false));
  const pages = pageCount(f), all = run('pdftotext', ['-layout', f, '-']).toString();
  if (pages < 2) fail('estimate has ' + pages + ' page(s)');
  if (pageCount(f0) !== pages) fail('the build without the layer has a different page count');
  for (let pg = 1; pg <= pages; pg++) if (pageText(f, pg).trim().split(/\s+/).length < 5) fail('page ' + pg + ' has no searchable text');
  if (!/DIVERSITY CONTRACTING/.test(all)) fail('header business name missing');
  if (!/Estimator:\s+Diversity Contracting/.test(all)) fail('estimator line does not read Diversity Contracting');
  if (/Diversity Roofing/i.test(all)) fail('old business name still printed');
  if (!/Drip edge/i.test(all) || !/\d+\.\d{2}\s+(SQ|LF|SF)/.test(all)) fail('line items with quantities are not searchable');
  if (!new RegExp('Insured:\\s+' + INSURED_TEXT).test(all)) fail(`accented insured name is not findable as "${INSURED_TEXT}" (garbled layer line?)`);
  if (!/DUC-NGUYEN/.test(all)) fail('estimate name does not read DUC-NGUYEN (accented letters dropped from the name?)');
  // every page keeps its page image (pdfimages also lists each image's transparency mask: count pages, not rows)
  const imgPages = new Set(run('pdfimages', ['-list', f]).toString().split('\n').slice(2).map((l) => l.trim().split(/\s+/)).filter((c) => c[2] === 'image').map((c) => +c[0]));
  for (let pg = 1; pg <= pages; pg++) if (!imgPages.has(pg)) fail('page ' + pg + ' has no page image');
  // the layer changes nothing a reader sees
  for (let pg = 1; pg <= pages; pg++) {
    const a = render(f, pg, 100), b = render(f0, pg, 100);
    let diff = 0; for (let i = 0; i < a.px.length; i++) if (Math.abs(a.px[i] - b.px[i]) > 8) diff++;
    if (a.w !== b.w || a.h !== b.h || diff) fail(`page ${pg} looks different with the text layer (${diff} pixels changed)`);
  }
  // the layer sits on the printed words
  for (let pg = 1; pg <= pages; pg++) {
    const r = registration(f, pg);
    if (Math.abs(r.shiftPt) > 1.5 || r.covered < 0.9) fail(`page ${pg} text layer is off the printed words (best shift ${r.shiftPt.toFixed(1)} pt, ${(r.covered * 100).toFixed(0)}% of ${r.words} words on ink)`);
  }
  const stored = await p.evaluate(() => JSON.parse(localStorage.getItem('rm.company') || '{}').name);
  if (stored !== 'Diversity Contracting') fail('saved old default name was not replaced: ' + stored);
  // 2. The Report + estimate PDF: the estimate pages are added to the roof report's points-based document
  const combined = new Function(`return (async () => { const rec = await buildReportPDF({ both: true }); if (!rec) throw new Error('no report'); const buf = await rec.blob.arrayBuffer(); ${toB64} })();`);
  const fc = path.join(out, 'report-and-estimate.pdf'); fs.writeFileSync(fc, await pdfBytes(p, combined));
  const cPages = pageCount(fc), first = cPages - pages + 1;
  if (first < 2) fail('the Report + estimate PDF has no estimate pages');
  const estText = run('pdftotext', ['-layout', '-f', String(first), '-l', String(cPages), fc, '-']).toString();
  if (!/Estimator:\s+Diversity Contracting/.test(estText) || !/Drip edge/i.test(estText)) fail('estimate pages of the Report + estimate PDF are not searchable');
  for (let pg = first; pg <= cPages; pg++) {
    const r = registration(fc, pg);
    if (Math.abs(r.shiftPt) > 1.5 || r.covered < 0.9) fail(`Report + estimate page ${pg}: text layer is off the printed words (best shift ${r.shiftPt.toFixed(1)} pt, ${(r.covered * 100).toFixed(0)}% of ${r.words} words on ink)`);
  }
  if (errors.length) fail('page errors: ' + errors.join(' | '));
  await ctx.close();
  // 3. A business name the user typed is kept
  const ctx2 = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
  await ctx2.addInitScript(() => { try { if (window.top === window && !sessionStorage.getItem('seeded')) { sessionStorage.setItem('seeded', '1'); localStorage.setItem('rm.company', JSON.stringify({ name: 'Diversity Roofing & Sons' })); } } catch (_) {} });
  await ctx2.addInitScript(installOfflineMap);
  const o2 = await openJob(ctx2);
  const kept = await o2.p.evaluate(() => ({ live: company.name, saved: JSON.parse(localStorage.getItem('rm.company') || '{}').name, html: xmBuildHTML().html }));
  if (kept.live !== 'Diversity Roofing & Sons' || kept.saved !== 'Diversity Roofing & Sons') fail(`a typed business name was replaced: ${kept.live} / ${kept.saved}`);
  if (!/Diversity Roofing &amp; Sons/i.test(kept.html)) fail('the estimate does not print the typed business name');
  if (o2.errors.length) fail('page errors: ' + o2.errors.join(' | '));
  console.log(`estimate text: ${pages} pages and ${cPages - first + 1} estimate pages in the Report + estimate PDF searchable and on the printed words; pages render identically with and without the layer; accented insured name findable; old default replaced, typed name kept`);
} catch (e) { console.error('FAIL ' + e.message.split('\n')[0]); code = 1; }
finally { await Promise.race([browser.close(), new Promise((r) => setTimeout(r, 15000))]); if (srv && srv.close) srv.close(); }   // a crashed browser can hang on close
process.exit(code);
