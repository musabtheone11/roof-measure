// Export-gate test through the real app (needs the Maps key and a browser): neither the UI buttons nor a direct call to the
// PDF builder may produce a COMPLETE report from incomplete data, and an edit after a build must change the next build.
//   Key=<google key> node tools/dev/gate-test.mjs --complete <job.json> --incomplete <job.json> [--port 8130]
// Writes nothing but console lines; exits 1 on any failed expectation. Private job files stay local.
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { start } from './serve.mjs';
const { chromium } = createRequire(import.meta.url)('playwright');
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const key = process.env.Key || process.env.GOOGLE_MAPS_KEY; if (!key) { console.error('Set Key'); process.exit(2); }
const port = +arg('port', 8130); const srv = await start(port, {});
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 }, acceptDownloads: true });
await ctx.addInitScript((k) => { try { localStorage.setItem('rm.key', k); } catch (_) { /* ignore */ } }, key);
const page = await ctx.newPage(); let fail = 0; const ok = (name, cond, got) => { console.log((cond ? 'ok   ' : 'FAIL ') + name + (cond ? '' : '  got ' + JSON.stringify(got))); if (!cond) fail++; };
await page.goto(`http://localhost:${port}/`); await page.waitForFunction(() => typeof map !== 'undefined' && map && typeof geocoder !== 'undefined' && geocoder, null, { timeout: 60000 });
const load = async (file) => { const job = JSON.parse(fs.readFileSync(file, 'utf8')); await page.evaluate((d) => { clearAll && clearAll(); restore(d); }, job); await page.waitForFunction((n) => state.facets.length === n, job.facets.length, { timeout: 30000 }); await page.waitForTimeout(1500); };
const clickBtn = async (id) => { await page.evaluate((id) => { const b = document.getElementById(id); for (let p = b; p; p = p.parentElement) { if (p.tagName === 'DETAILS') p.open = true; if (p.hidden) p.hidden = false; } b.scrollIntoView({ block: 'center' }); }, id); await page.click('#' + id, { timeout: 15000 }); };
const uiBuild = async () => { await page.evaluate(() => { window.__rmNoConfirm = true; window.__rmLastReport = null; }); await clickBtn('btnReportPreview'); await page.waitForFunction(() => window.__rmLastReport && window.__rmLastReport.previewed, null, { timeout: 240000 }); return page.evaluate(() => ({ hash: window.__rmLastReport.hash, pages: window.__rmLastReport.pages })); };
const direct = () => page.evaluate(async () => { const r = await rpBuild({}); return { status: r.M.statusLabel, pages: r.pages, net: r.M.t.sloped, confirmed: r.M.area.confirmed }; });
const status = () => page.evaluate(() => reviewReportStatus().status);
const pdfText = async () => { const buf = await page.evaluate(async () => { const b = await (await fetch(document.getElementById('reportFrame').src.split('#')[0])).arrayBuffer(); return Array.from(new Uint8Array(b)); }); fs.writeFileSync('/tmp/gate-report.pdf', Buffer.from(buf)); const { spawnSync } = await import('node:child_process'); return spawnSync('pdftotext', ['-layout', '/tmp/gate-report.pdf', '-'], { encoding: 'utf8' }).stdout; };
try {
  // 1. incomplete job: UI path and direct path both say REVIEW REQUIRED; the PDF text carries it; no COMPLETE anywhere
  await load(arg('incomplete')); const s1 = await status(); const d1 = await direct(); const u1 = await uiBuild(); const t1 = await pdfText();
  ok('incomplete job: app status is REVIEW REQUIRED', s1 === 'REVIEW REQUIRED', s1);
  ok('incomplete job: direct rpBuild() labels REVIEW REQUIRED', d1.status === 'REVIEW REQUIRED', d1);
  ok('incomplete job: the exported PDF says REVIEW REQUIRED and never COMPLETE', /REVIEW REQUIRED/.test(t1) && !/\bCOMPLETE\b/.test(t1), t1.slice(0, 200));
  ok('incomplete job: confirmed area is below the net area (estimate kept apart)', d1.confirmed < d1.net - 0.5, d1);
  // 2. complete job: COMPLETE on both paths and the same bytes from the UI as from a second UI build (cache is consistent)
  await load(arg('complete')); const s2 = await status(); const d2 = await direct(); const u2 = await uiBuild(); const u2b = await uiBuild();
  ok('complete job: app status is COMPLETE', s2 === 'COMPLETE', s2); ok('complete job: direct rpBuild() labels COMPLETE', d2.status === 'COMPLETE', d2); ok('complete job: repeated UI builds give the same bytes', u2.hash === u2b.hash, [u2.hash, u2b.hash]);
  // 3. stale measurements after editing: change a facet's pitch after the build; the next UI build must differ and print the new area
  const before = await page.evaluate(() => computeTotals().sloped);
  await page.evaluate(() => { const f = state.facets[0]; f.pitch = (f.pitch || 4) + 4; f.slope = null; f.edited = true; recompute(); });
  const after = await page.evaluate(() => computeTotals().sloped); const u3 = await uiBuild(); const t3 = await pdfText();
  const printed = (t3.match(/NET SLOPED AREA[\s\S]{0,300}?\n\s*([\d,]+\.\d{2}) ft²/) || [])[1];
  ok('edit changes the model total', Math.abs(after - before) > 1, { before, after });
  ok('edit after a build changes the next build (no stale cache)', u3.hash !== u2.hash, [u2.hash, u3.hash]);
  ok('the new PDF prints the edited total', printed != null && Math.abs(+printed.replace(/,/g, '') - after) < 0.006, { printed, after });
  // 4. an unresolved facet added by hand after the build turns the next export into REVIEW REQUIRED (no silent COMPLETE)
  await page.evaluate(() => { state.facets[0].status = 'unresolved'; state.facets[0].missing = 'test: plane marked unresolved'; recompute(); });
  const s4 = await status(); const d4 = await direct(); const u4 = await uiBuild(); const t4 = await pdfText();
  ok('unresolved plane: status flips to REVIEW REQUIRED on both paths and in the PDF', s4 === 'REVIEW REQUIRED' && d4.status === 'REVIEW REQUIRED' && /REVIEW REQUIRED/.test(t4) && u4.hash !== u3.hash, { s4, d4: d4.status });
} catch (e) { console.log('FAIL gate test crashed: ' + String(e.message).split(key).join('<key>').split('\n')[0]); fail++; }
await browser.close(); srv.close(); process.exit(fail ? 1 : 0);
