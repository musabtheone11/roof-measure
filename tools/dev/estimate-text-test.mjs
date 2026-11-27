// Estimate PDF: searchable text and the business name (illustrative gable job, offline map stub; no Maps or API calls).
// The estimate pages are drawn as page images. Without a text layer a recipient could not search, select or copy a
// line item, and a browser that had saved the old built-in business name printed "DIVERSITY ROOFING" while the roof
// report says Diversity Contracting. Checks: every page carries text; the header, estimator line and line items are
// findable; the saved old default is replaced; the page image itself is unchanged in size (one image per page).
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { start } from './serve.mjs';
import { installOfflineMap } from './offline-map.mjs';
const { chromium } = createRequire(import.meta.url)('playwright');
const out = path.resolve('.devcache/estimate-text-test'); fs.mkdirSync(out, { recursive: true });
const job = JSON.parse(fs.readFileSync(new URL('../../examples/gable-control.json', import.meta.url), 'utf8'));
const srv = await start(8198, {}); const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--no-sandbox'] });
let code = 0;
try {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
  // seed the old built-in name once, in the top page only (html2canvas clones the page into frames that also run init scripts)
  await ctx.addInitScript(() => { try { if (window.top === window && !sessionStorage.getItem('seeded')) { sessionStorage.setItem('seeded', '1'); localStorage.setItem('rm.company', JSON.stringify({ name: 'Diversity Roofing' })); } } catch (_) {} });
  await ctx.addInitScript(installOfflineMap);
  const p = await ctx.newPage(); const errors = []; p.on('pageerror', (e) => errors.push(e.message));
  await p.goto('http://localhost:8198/'); await p.evaluate(() => { initMap(); const n = document.getElementById('nokey'); if (n) n.hidden = true; });
  await p.evaluate((d) => restore(d), job); await p.waitForFunction((n) => state.facets.length === n, job.facets.length, { timeout: 30000 });
  const b64 = await p.evaluate(async () => { const { html } = xmBuildHTML(); const pdf = await htmlToPDF(html, 'Estimate'); const buf = pdf.output('arraybuffer'); let s = ''; const u = new Uint8Array(buf); for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]); return btoa(s); });
  const f = path.join(out, 'estimate.pdf'); fs.writeFileSync(f, Buffer.from(b64, 'base64'));
  const pages = +/Pages:\s+(\d+)/.exec(execFileSync('pdfinfo', [f]).toString())[1];
  const text = (pg) => execFileSync('pdftotext', ['-layout', '-f', String(pg), '-l', String(pg), f, '-']).toString();
  const all = execFileSync('pdftotext', ['-layout', f, '-']).toString();
  const fail = (m) => { throw new Error(m); };
  if (pages < 2) fail('estimate has ' + pages + ' page(s)');
  for (let pg = 1; pg <= pages; pg++) if (text(pg).trim().split(/\s+/).length < 5) fail('page ' + pg + ' has no searchable text');
  if (!/DIVERSITY CONTRACTING/.test(all)) fail('header business name missing');
  if (!/Estimator:\s+Diversity Contracting/.test(all)) fail('estimator line does not read Diversity Contracting');
  if (/Diversity Roofing/i.test(all)) fail('old business name still printed');
  if (!/Drip edge/i.test(all) || !/\d+\.\d{2}\s+(SQ|LF|SF)/.test(all)) fail('line items with quantities are not searchable');
  const imgs = execFileSync('pdfimages', ['-list', f]).toString().split('\n').slice(2).filter(Boolean).length;
  if (imgs < pages) fail(`expected the page images to stay (one per page); found ${imgs} images on ${pages} pages`);
  const stored = await p.evaluate(() => JSON.parse(localStorage.getItem('rm.company') || '{}').name);
  if (stored !== 'Diversity Contracting') fail('saved old default name was not replaced: ' + stored);
  if (errors.length) fail('page errors: ' + errors.join(' | '));
  console.log(`estimate text: ${pages} pages, every page searchable, header and estimator read Diversity Contracting, line items findable`);
} catch (e) { console.error('FAIL ' + e.message); code = 1; }
finally { await browser.close(); if (srv && srv.close) srv.close(); }
process.exit(code);
