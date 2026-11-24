// Headless address-to-PDF run through the real UI (same buttons a person clicks).
//   Key=<google key> node tools/dev/run-app.mjs --address "123 Main St, City, ST" --out .devcache/runs/name [--root <app dir>] [--port 8090]
// Writes: map-clean.png, map-overlay.png, roof.json (Export JSON content), totals.json, report.pdf, console.log
// The API key is read from the environment (Key or GOOGLE_MAPS_KEY) and is never written to disk.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { start } from './serve.mjs';

const { chromium } = createRequire(import.meta.url)('playwright');   // the globally installed Playwright (matches the installed browser)
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const key = process.env.Key || process.env.GOOGLE_MAPS_KEY; if (!key) { console.error('Set Key or GOOGLE_MAPS_KEY'); process.exit(2); }
const address = arg('address'), out = path.resolve(arg('out', '.devcache/runs/run')), port = +arg('port', 8090), root = arg('root', null);
const pdfWhat = arg('pdf', 'btnReportPDF');
fs.mkdirSync(out, { recursive: true });
const srv = await start(port, root ? { root } : {});
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 }, acceptDownloads: true });
await ctx.addInitScript((k) => { try { localStorage.setItem('rm.key', k); } catch (_) { /* ignore */ } }, key);
const page = await ctx.newPage();
const log = []; const scrub = (s) => String(s).split(key).join('<key>');
const dialogs = []; page.on('dialog', async (d) => { dialogs.push(d.message()); log.push('[dialog] ' + d.message().replace(/\n/g, ' / ')); await d.accept(); });
page.on('console', (m) => log.push(`[${m.type()}] ${scrub(m.text())}`)); page.on('pageerror', (e) => log.push('[pageerror] ' + scrub(e.stack || e.message)));
const step = async (name, fn) => { const t = Date.now(); try { const r = await fn(); console.log(`ok   ${name} (${((Date.now() - t) / 1000).toFixed(1)}s)`); return r; } catch (e) { console.log(`FAIL ${name}: ${scrub(e.message).split('\n')[0]}`); throw e; } };
let code = 0;
try {
  await step('load app + map', async () => { await page.goto(`http://localhost:${port}/`); await page.waitForFunction(() => typeof map !== 'undefined' && map && typeof geocoder !== 'undefined' && geocoder, null, { timeout: 60000 }); });
  await step('address', async () => { await page.fill('#address', address); await page.click('#btnGo'); await page.waitForFunction(() => state.location, null, { timeout: 30000 }); });
  await page.waitForTimeout(6000);
  await page.locator('#map').screenshot({ path: path.join(out, 'map-clean.png') });
  await step('get roof data', async () => { await page.click('#btnSolar'); await page.waitForFunction(() => state.solar || /class="err"/.test(document.querySelector('#solarOut').innerHTML), null, { timeout: 30000 }); });
  await step('auto-trace', async () => { await page.click('#btnAuto'); await page.waitForFunction(() => state.facets.length > 0 && !document.querySelector('#btnAuto').disabled, null, { timeout: 180000 }); });
  await page.evaluate(() => { const b = new google.maps.LatLngBounds(); state.facets.forEach((f) => f.shape.getPath().forEach((p) => b.extend(p))); map.fitBounds(b, 60); });
  await page.waitForTimeout(5000);
  await page.locator('#map').screenshot({ path: path.join(out, 'map-overlay.png') });
  const data = await page.evaluate(() => {
    const t = computeTotals(); const s = solarSummary();
    const byType = {}; for (const k of Object.keys(t.byType)) byType[k] = { planFt: t.byType[k].plan, trueFt: t.byType[k].true, count: t.byType[k].count };
    const audit = typeof window.rmAudit === 'function' ? window.rmAudit() : null;
    return { roof: serialize(), totals: { slopedSqft: t.sloped, planSqft: t.plan, facetCount: t.facetCount, predominant: t.predominant, pitchGroups: t.pitchGroups, byType, structures: t.structures.map((g) => ({ index: g.index, sloped: g.sloped, facets: g.facetCount, predominant: g.predominant })), recWaste: t.recWaste,
      facets: t.facetsAll.map((x) => ({ name: x.f.name, pitch: x.f.pitch, plan: x.m.plan, sloped: x.m.sloped, excluded: x.f.excluded })), edges: t.edges.map((x) => ({ type: x.e.type, planFt: x.m.planFt, trueFt: x.m.trueFt, factor: x.m.factor, pitch: x.m.pitch })) },
      solar: s ? { total: s.total, ground: s.ground, segs: s.segs.length, predominant: s.predominant, imageryDate: s.imageryDate, quality: s.quality } : null, audit };
  });
  fs.writeFileSync(path.join(out, 'roof.json'), JSON.stringify(data.roof));
  fs.writeFileSync(path.join(out, 'totals.json'), JSON.stringify({ address, ...data.totals, solar: data.solar, audit: data.audit }, null, 1));
  await step('download PDF', async () => {
    const dl = page.waitForEvent('download', { timeout: 240000 }); dl.catch(() => {});
    await page.evaluate((id) => { const b = document.getElementById(id); for (let p = b; p; p = p.parentElement) { if (p.tagName === 'DETAILS') p.open = true; if (p.hidden) p.hidden = false; } b.scrollIntoView({ block: 'center' }); }, pdfWhat);
    if (process.argv.includes('--3d')) await page.evaluate(() => { const c = document.getElementById('chkPdf3d'); if (c) c.checked = true; });
    await page.click('#' + pdfWhat, { timeout: 15000 });
    const save = page.locator('#dlReadySave'); save.waitFor({ timeout: 240000 }).then(() => save.click()).catch(() => {});
    const d = await dl; await d.saveAs(path.join(out, 'report.pdf'));
  });
  const t = data.totals; console.log(`${address}: ${Math.round(t.slopedSqft)} sqft, ${t.facetCount} facets, predominant ${t.predominant}/12, ${t.structures.length} structure(s)`);
} catch (e) { code = 1; try { await page.screenshot({ path: path.join(out, 'failure.png') }); } catch (_) { /* ignore */ } }
fs.writeFileSync(path.join(out, 'console.log'), log.join('\n'));
if (dialogs.length) console.log('export gate asked: ' + dialogs.join(' | ').replace(/\n+/g, ' '));
await browser.close(); srv.close(); process.exit(code);
