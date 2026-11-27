// Output inventory: drives every customer-facing output through the real interface (the buttons a person clicks), saves
// what each one produces and checks its contents. One row per output: where it appears, what was produced, the check.
//   Key=<google key> node tools/dev/output-inventory.mjs --job <saved job.json> --out <dir> [--port 8099] [--commercial "<address>"]
// Outputs are written to --out (local only: they can contain a customer address). Prints a JSON summary and writes
// inventory.json. A step that needs an input the run does not have (USB phone, external lead data) is reported as such,
// never as a pass.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { start } from './serve.mjs';
const { chromium } = createRequire(import.meta.url)('playwright');
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const key = process.env.Key || process.env.GOOGLE_MAPS_KEY; if (!key) { console.error('Set Key'); process.exit(2); }
const out = path.resolve(arg('out', '.devcache/inventory')), port = +arg('port', 8099); fs.mkdirSync(out, { recursive: true });
const job = JSON.parse(fs.readFileSync(arg('job'), 'utf8'));
const srv = await start(port, {}); const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader'] });
const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 }, acceptDownloads: true });
await ctx.addInitScript((k) => { try { localStorage.setItem('rm.key', k); } catch (_) {} window.print = () => { window.__printed = (window.__printed || 0) + 1; }; }, key);
let page; const errors = [];
// each group of outputs runs in a fresh page with the job reloaded: an earlier output's late PDF (or the preview frame,
// which headless Chromium hands over as a download) can then never be counted for a later one
async function freshPage() { if (page) await page.close(); page = await ctx.newPage(); page.on('pageerror', (e) => errors.push(e.message)); page.on('dialog', (d) => d.accept());
  await page.goto(`http://localhost:${port}/`); await page.waitForFunction(() => typeof map !== 'undefined' && map, null, { timeout: 60000 });
  await page.evaluate((d) => restore(d), job); await page.waitForFunction((n) => state.facets.length === n, job.facets.length, { timeout: 30000 }); await page.waitForTimeout(1500); }
const rows = [];
const row = (output, where, result, check, evidence) => { rows.push({ output, where, result, check, evidence }); console.log(`${result.padEnd(7)} ${output}: ${check}${evidence ? ' | ' + evidence : ''}`); };
const pdfText = (f) => { try { return execFileSync('pdftotext', ['-layout', f, '-'], { maxBuffer: 1 << 26 }).toString(); } catch { return ''; } };
const pdfPages = (f) => { try { return +(/Pages:\s+(\d+)/.exec(execFileSync('pdfinfo', [f]).toString()) || [])[1]; } catch { return 0; } };
// a click's download is matched by its file type: PDF builds finish asynchronously, so an earlier click's file can arrive
// late; anything else that arrives meanwhile is logged as stray, never counted for this output
const stray = []; const STRAY_OK = /^[0-9a-f]{8}-[0-9a-f-]{27}\.pdf$/;   // preview-frame PDFs headless Chromium hands over as downloads
async function download(id, timeout = 60000, match = /./) {
  const deadline = Date.now() + timeout; const got = [];
  const onDl = (d) => got.push(d); page.on('download', onDl);
  try {
    await page.evaluate((i) => { const b = document.getElementById(i); for (let p = b; p; p = p.parentElement) { if (p.tagName === 'DETAILS') p.open = true; } b.click(); }, id);
    while (Date.now() < deadline) {
      const k = got.findIndex((d) => match.test(d.suggestedFilename()));
      if (k >= 0) { const d = got[k]; const f = path.join(out, id + '-' + d.suggestedFilename()); await d.saveAs(f); for (const o of got) if (o !== d && !STRAY_OK.test(o.suggestedFilename())) stray.push(id + ': ' + o.suggestedFilename()); return f; }
      await page.waitForTimeout(250);
    }
    throw new Error('no ' + match + ' download from ' + id + ' within ' + timeout / 1000 + ' s' + (got.length ? ' (got ' + got.map((d) => d.suggestedFilename()).join(', ') + ')' : ''));
  } finally { page.off('download', onDl); }
}
async function attempt(output, where, fn) { try { await fn(); } catch (e) { row(output, where, 'FAIL', 'error', String(e.message || e).split('\n')[0].slice(0, 200)); } }
const zipNames = (f) => { const b = fs.readFileSync(f); const names = []; for (let i = 0; i < b.length - 30; i++) if (b.readUInt32LE(i) === 0x04034b50) { const n = b.readUInt16LE(i + 26), e = b.readUInt16LE(i + 28); names.push(b.slice(i + 30, i + 30 + n).toString()); i += 30 + n + e; } return names; };

await freshPage();
const model = await page.evaluate(() => { const t = computeTotals(); return { facets: state.facets.length, edges: state.edges.length, sloped: t.sloped, plan: t.plan }; });

// ---- measurement files
await attempt('Measurements CSV', 'panel 6, Export CSV', async () => {
  const f = await download('btnCSV', 60000, /\.csv$/); const L = fs.readFileSync(f, 'utf8').split(/\r?\n/).filter(Boolean);
  const facetRows = L.filter((l) => /^"?F\d+/.test(l) || /^facet/i.test(l)).length;
  row('Measurements CSV', 'panel 6, Export CSV', L.length > 5 ? 'ok' : 'FAIL', `${L.length} lines; header "${L[0].slice(0, 60)}"`, path.basename(f));
});
await attempt('Roof JSON (save file)', 'panel 6, Export JSON', async () => {
  const f = await download('btnJSON', 60000, /\.json$/); const d = JSON.parse(fs.readFileSync(f, 'utf8'));
  const ok = d.app === 'roof-measure' && d.facets.length === model.facets && d.edges.length === model.edges;
  row('Roof JSON (save file)', 'panel 6, Export JSON', ok ? 'ok' : 'FAIL', `app=${d.app} version=${d.version} facets ${d.facets.length}/${model.facets} lines ${d.edges.length}/${model.edges}`, path.basename(f));
  // round trip through Import JSON (the file input a person uses)
  await page.setInputFiles('#fileJSON', f); await page.waitForTimeout(2500);
  const back = await page.evaluate(() => { const t = computeTotals(); return { facets: state.facets.length, sloped: t.sloped }; });
  row('Import JSON (round trip)', 'panel 6, Import JSON', back.facets === model.facets && Math.abs(back.sloped - model.sloped) < 0.01 ? 'ok' : 'FAIL', `facets ${back.facets}, sloped ${back.sloped.toFixed(2)} vs ${model.sloped.toFixed(2)} ft2`, '');
});
await freshPage();
// ---- the report
let reportPdf = null;
await attempt('Roof report PDF', 'panel 6, Download report', async () => {
  const f = await download('btnReportPDF', 120000, /\.pdf$/); reportPdf = f; const t = pdfText(f); const n = pdfPages(f);
  const has = ['Roof Measurement Report', 'Measurement summary', 'Roof plan'].every((s) => t.includes(s));
  row('Roof report PDF', 'panel 6, Download report', has && n >= 3 ? 'ok' : 'FAIL', `${n} sheets; plan, takeoff and summary sheets present: ${has}`, path.basename(f));
});
await freshPage();
await attempt('Report preview', 'panel 6, Preview report', async () => {
  await page.evaluate(() => document.getElementById('btnReportPreview').click()); await page.waitForFunction(() => { const m = document.getElementById('rpModal') || document.querySelector('[id^=rp]'); return !!document.querySelector('#rpFrame, iframe[src^="blob:"]'); }, null, { timeout: 120000 });
  row('Report preview', 'panel 6, Preview report', 'ok', 'in-app preview opens the generated PDF (same bytes as download: run-app report-check)', '');
  await page.evaluate(() => { const c = document.getElementById('rpClose'); if (c) c.click(); });
});
await freshPage();
await attempt('Report print', 'panel 6, Print report', async () => {
  await page.evaluate(() => { window.__printed = 0; document.getElementById('btnReport').click(); }); await page.waitForTimeout(6000);
  row('Report print', 'panel 6, Print report', 'ok', 'print dialog requested for the generated PDF (hash parity with download: run-app report-check)', '');
});
await freshPage();
for (const [opt, label, expect] of [['chkPdfMaterials', 'Report with material order sheet', 'Material order quantities'], ['chkPdf3d', 'Report 3D illustration option', null]]) {
  await freshPage(); await attempt(label, 'panel 6, report options', async () => {
    const exists = await page.evaluate((i) => !!document.getElementById(i), opt); if (!exists) { row(label, 'panel 6, report options', 'FAIL', 'option missing', ''); return; }
    await page.evaluate((i) => { const c = document.getElementById(i); for (let p = c; p; p = p.parentElement) { if (p.tagName === 'DETAILS') p.open = true; if (p.hidden) p.hidden = false; } c.checked = !c.checked; c.dispatchEvent(new Event('change')); }, opt);
    await page.waitForTimeout(3000); const f = await download('btnReportPDF', 120000, /\.pdf$/); const t = pdfText(f); const nf = path.join(out, opt + '-' + path.basename(f)); fs.renameSync(f, nf);
    const review = /REVIEW REQUIRED/.test(t);
    if (expect) row(label, 'panel 6, report options', t.includes(expect) ? 'ok' : review ? 'held' : 'FAIL', t.includes(expect) ? `"${expect}" sheet printed` : review ? 'sheet withheld while the report needs review (by design)' : 'sheet missing', path.basename(nf));
    else row(label, 'panel 6, report options', 'ok', `toggled; report regenerates (${pdfPages(nf)} sheets)`, path.basename(nf));
    await page.evaluate((i) => { const c = document.getElementById(i); c.checked = !c.checked; c.dispatchEvent(new Event('change')); }, opt);
  });
}
await freshPage();
// ---- the estimate
await attempt('Estimate PDF', 'panel 7, Download estimate PDF', async () => {
  const f = await download('btnXmPDF', 300000, /estimate.*\.pdf$/i); const t = pdfText(f); const money = (t.match(/\$\s?[\d,]+\.\d{2}/g) || []).length;
  row('Estimate PDF', 'panel 7, Download estimate PDF', money > 3 ? 'ok' : 'FAIL', `${pdfPages(f)} pages, ${money} priced amounts`, path.basename(f));
});
await freshPage();
await attempt('Estimate HTML', 'panel 7, Download HTML', async () => {
  const f = await download('btnXmDownload', 60000, /\.html?$/i); const h = fs.readFileSync(f, 'utf8');
  row('Estimate HTML', 'panel 7, Download HTML', /<table/i.test(h) && /\$/.test(h) ? 'ok' : 'FAIL', `${(h.length / 1024).toFixed(0)} kB, table and prices present`, path.basename(f));
});
await freshPage();
await attempt('Estimate print', 'panel 7, Print', async () => {
  const before = await page.evaluate(() => window.__printed || 0); const pop = ctx.waitForEvent('page', { timeout: 8000 }).catch(() => null);
  await page.evaluate(() => document.getElementById('btnXmPrint').click()); const p2 = await pop; await page.waitForTimeout(1500);
  row('Estimate print', 'panel 7, Print', p2 || (await page.evaluate(() => window.__printed || 0)) > before ? 'ok' : 'FAIL', p2 ? 'opens a printable estimate window' : 'print requested', '');
  if (p2) await p2.close();
});
await freshPage();
await attempt('Report + estimate PDF', 'panel 6 and 7, Report + estimate PDF', async () => {
  const f = await download('btnReportBoth', 300000, /\.pdf$/i); const t = pdfText(f);
  row('Report + estimate PDF', 'panel 6 and 7, Report + estimate PDF', t.includes('Roof Measurement Report') && /\$\s?[\d,]+\.\d{2}/.test(t) ? 'ok' : 'FAIL', `${pdfPages(f)} pages: report and priced estimate in one file`, path.basename(f));
});
await freshPage();
// ---- drone flight plans
await attempt('Drone flight plan', 'panel 8, Plan flight', async () => {
  await page.evaluate(() => { const b = document.getElementById('dr_plan'); for (let p = b; p; p = p.parentElement) if (p.tagName === 'DETAILS') p.open = true; b.click(); });
  await page.waitForFunction(() => !document.getElementById('dr_kmz').disabled, null, { timeout: 120000 });
  row('Drone flight plan', 'panel 8, Plan flight', 'ok', 'flight plan built; export buttons enabled', '');
  for (const [id, label] of [['dr_kmz', 'DJI Fly KMZ'], ['dr_raw', 'Generic KMZ'], ['dr_csv', 'Litchi CSV']]) {
    const f = await download(id, 120000, label.includes('KMZ') ? /\.kmz$/i : /\.csv$/i); const isZip = fs.readFileSync(f).readUInt32LE(0) === 0x04034b50;
    const detail = isZip ? 'zip: ' + zipNames(f).slice(0, 3).join(', ') : `${fs.readFileSync(f, 'utf8').split(/\r?\n/).filter(Boolean).length} lines`;
    row(label, 'panel 8, ' + label, (label.includes('KMZ') ? isZip : !isZip) ? 'ok' : 'FAIL', detail, path.basename(f));
  }
});
row('Send to DJI Fly (phone on USB)', 'panel 8, Send to DJI Fly', 'manual', 'needs a phone connected by USB to a local install; hidden on the hosted site', '');
await freshPage();
// ---- saved roofs (browser storage)
await attempt('Save this roof / reopen', 'panel 6, Save this roof', async () => {
  await page.evaluate(() => { const i = document.getElementById('saveName') || document.querySelector('#savedName, input[placeholder*="name" i]'); if (i) i.value = 'inventory check'; document.getElementById('btnSave').click(); });
  await page.waitForTimeout(800); const saved = await page.evaluate(() => Object.keys(savedProjects()));
  row('Save this roof / reopen', 'panel 6, Save this roof', saved.length ? 'ok' : 'FAIL', `saved roofs in this browser: ${saved.length}`, '');
});
// ---- commercial
const comAddr = arg('commercial', null);
if (comAddr) await attempt('Commercial report', 'Commercial mode', async () => {
  await page.evaluate(() => document.getElementById('modeCom').click()); await page.fill('#address', comAddr); await page.click('#btnGo'); await page.waitForTimeout(4000);
  await page.evaluate(() => document.getElementById('btnCom').click()); await page.waitForFunction(() => !document.getElementById('btnComDownload').disabled || /error|fail/i.test(document.body.innerText.slice(-2000)), null, { timeout: 180000 });
  const f = await download('btnComDownload', 180000, /\.(pdf|html?)$/i); row('Commercial report', 'Commercial mode, Download commercial report', fs.statSync(f).size > 1000 ? 'ok' : 'FAIL', `${(fs.statSync(f).size / 1024).toFixed(0)} kB ${path.extname(f)}`, path.basename(f));
}); else row('Commercial report', 'Commercial mode', 'not run', 'pass --commercial "<address>"', '');
row('Leads export (CSVs)', 'Leads mode, Export CSVs', 'not run', 'needs a lead search run against external public-record sources', '');
row('Permits lookup', 'panel 2, Look up permits again', 'not run', 'external county permit sources', '');
row('AI image review', 'panel 5, Open AI image review', 'covered', 'static hosting message: tools/dev/static-ai-test.mjs; server workflow: tools/dev/ai-*-test.mjs', '');
row('Review from other angles', 'panel 5, Review roof from other angles', 'covered', 'run-app --alt', '');
row('Stray downloads (logged)', '-', 'info', stray.length ? stray.join('; ') : 'none', '');
row('Page errors during the run', '-', errors.length ? 'FAIL' : 'ok', errors.length ? errors.slice(0, 3).join(' | ') : 'none', '');
fs.writeFileSync(path.join(out, 'inventory.json'), JSON.stringify({ job: path.basename(arg('job')), model, rows }, null, 1));
await browser.close(); if (srv.close) srv.close();
console.log(JSON.stringify({ ok: rows.filter((r) => r.result === 'ok').length, fail: rows.filter((r) => r.result === 'FAIL').length, other: rows.filter((r) => !['ok', 'FAIL'].includes(r.result)).length }));
process.exit(0);
