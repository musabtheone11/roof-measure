// Headless address-to-PDF run through the real UI (same buttons a person clicks).
//   Key=<google key> node tools/dev/run-app.mjs --address "123 Main St, City, ST" --out .devcache/runs/name [--root <app dir>] [--port 8090] [--alt] [--estimate [--xm "deck=membrane,lossType="] [--est-name estimate]]
//   Key=<google key> node tools/dev/run-app.mjs --job <saved job .json> --out .devcache/runs/name      (a saved / exported job, loaded the way Import JSON loads it)
//   --offline --job <illustrative.json>: test-only shape adapter; no Maps, imagery or API validation
//   --strict fails the run on a layout self-check finding (acceptance runs); without it the finding is a WARN line (benchmark runs)
//   --alt also runs the reviewer's second look (3D views, dated imagery, configuration check, carry) and writes report-alt.pdf
// Every run exercises the report flow a person uses: Preview report, Print report, Download report. The three must carry
// the same PDF bytes (sha256); the run fails otherwise and report-check.json records the hashes and sheet count.
// Writes: map-clean.png, map-overlay.png, roof.json (Export JSON content), totals.json, report.pdf, report-check.json, console.log
// The API key is read from the environment (Key or GOOGLE_MAPS_KEY) and is never written to disk.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { start } from './serve.mjs';

const { chromium } = createRequire(import.meta.url)('playwright');   // the globally installed Playwright (matches the installed browser)
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const offline = process.argv.includes('--offline');
if (offline && !arg('job', null)) throw new Error('--offline requires a saved illustrative --job');
const key = offline ? '' : process.env.Key || process.env.GOOGLE_MAPS_KEY || ''; if (!key && !offline) { console.error('Set Key or GOOGLE_MAPS_KEY'); process.exit(2); }
const address = arg('address', ''), out = path.resolve(arg('out', '.devcache/runs/run')), port = +arg('port', 8090), root = arg('root', null);
const pdfWhat = arg('pdf', 'btnReportPDF');
fs.mkdirSync(out, { recursive: true });
const srv = await start(port, root ? { root } : {});
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || (fs.existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined), args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ ignoreHTTPSErrors: offline, viewport: { width: 1500, height: 1000 }, acceptDownloads: true });
if (offline) { const { installOfflineMap } = await import('./offline-map.mjs'); await ctx.addInitScript(installOfflineMap); }
await ctx.addInitScript((k) => { try { localStorage.setItem('rm.key', k); } catch (_) { /* ignore */ } }, key);
const page = await ctx.newPage();
const log = []; const scrub = (s) => key ? String(s).split(key).join('<key>') : String(s);
const dialogs = []; page.on('dialog', async (d) => { dialogs.push(d.message()); log.push('[dialog] ' + d.message().replace(/\n/g, ' / ')); await d.accept(); });
page.on('console', (m) => log.push(`[${m.type()}] ${scrub(m.text())}`)); page.on('pageerror', (e) => log.push('[pageerror] ' + scrub(e.stack || e.message)));
const step = async (name, fn) => { const t = Date.now(); try { const r = await fn(); console.log(`ok   ${name} (${((Date.now() - t) / 1000).toFixed(1)}s)`); return r; } catch (e) { console.log(`FAIL ${name}: ${scrub(e.message).split('\n')[0]}`); throw e; } };
let code = 0;
try {
  await step('load app + map', async () => { await page.goto(`http://localhost:${port}/`); if (offline) await page.evaluate(() => { initMap(); document.getElementById('nokey').hidden = true; }); await page.waitForFunction(() => typeof map !== 'undefined' && map && typeof geocoder !== 'undefined' && geocoder, null, { timeout: 60000 }); });
  const jobFile = arg('job', null);
  if (jobFile) {
    // a saved job (Export JSON format) goes through the app's own restore(), the same path as "Import JSON"
    const job = JSON.parse(fs.readFileSync(jobFile, 'utf8'));
    if (offline && job.source?.kind !== 'illustrative') throw new Error('--offline accepts illustrative jobs only');
    await step('load saved job', async () => { await page.evaluate((d) => { restore(d); }, job); await page.waitForFunction((n) => state.facets.length === n, job.facets.length, { timeout: 30000 }); });
  } else
  await step('address', async () => { await page.fill('#address', address); await page.click('#btnGo'); await page.waitForFunction(() => state.location, null, { timeout: 30000 }); });
  await page.waitForTimeout(6000);
  await page.locator('#map').screenshot({ path: path.join(out, 'map-clean.png') });
  if (!jobFile) await step('get roof data', async () => { await page.click('#btnSolar'); await page.waitForFunction(() => state.solar || /class="err"/.test(document.querySelector('#solarOut').innerHTML), null, { timeout: 30000 }); });
  if (!jobFile) await step('auto-trace', async () => { await page.click('#btnAuto'); await page.waitForFunction(() => (state.facets.length > 0 || (state.trace && state.trace.failed)) && !document.querySelector('#btnAuto').disabled, null, { timeout: 180000 }); const why = await page.evaluate(() => state.facets.length ? null : state.trace.failed); if (why) console.log('     no roof traced: ' + why); });
  await page.evaluate(() => { const b = new google.maps.LatLngBounds(); state.facets.forEach((f) => f.shape.getPath().forEach((p) => b.extend(p))); ((state.trace && state.trace.hiddenZones) || []).forEach((z) => z.path.forEach((p) => b.extend(p))); map.fitBounds(b, 60); });
  await page.waitForTimeout(5000);
  await page.locator('#map').screenshot({ path: path.join(out, 'map-overlay.png') });
  const snapshot = async (sfx) => {
    const data = await page.evaluate(() => {
    const t = computeTotals(); const s = solarSummary();
    const byType = {}; for (const k of Object.keys(t.byType)) byType[k] = { planFt: t.byType[k].plan, trueFt: t.byType[k].true, count: t.byType[k].count };
    const audit = typeof window.rmAudit === 'function' ? window.rmAudit() : null;
    const st = typeof reviewReportStatus === 'function' ? reviewReportStatus() : null;
    return { roof: serialize(), totals: { slopedSqft: t.sloped, planSqft: t.plan, facetCount: t.facetCount, predominant: t.predominant, pitchGroups: t.pitchGroups, byType, structures: t.structures.map((g) => ({ index: g.index, sloped: g.sloped, facets: g.facetCount, predominant: g.predominant })), recWaste: t.recWaste,
      status: st ? st.status : null, statusReasons: st ? st.reasons.map((r) => r.code) : null, areaByStatus: t.areaByStatus || null,
      facets: t.facetsAll.map((x) => ({ name: x.f.name, pitch: x.f.pitch, plan: x.m.plan, sloped: x.m.sloped, excluded: x.f.excluded, structure: x.f.structure || 1, status: typeof RM !== 'undefined' && RM.statusOf ? RM.statusOf(x.f) : null, inferredSqft: x.f.inferredSqft || 0, edited: !!x.f.edited, basis: x.m.basis, slope12: x.m.slope12 })), edges: t.edges.map((x) => ({ type: x.e.type, planFt: x.m.planFt, trueFt: x.m.trueFt, factor: x.m.factor, pitch: x.m.pitch , structure: x.e.structure || 1, status: typeof RM !== 'undefined' && RM.statusOf ? RM.statusOf(x.e) : null})) },
      solar: s ? { total: s.total, ground: s.ground, segs: s.segs.length, predominant: s.predominant, imageryDate: s.imageryDate, quality: s.quality } : null, audit };
  });
    fs.writeFileSync(path.join(out, `roof${sfx}.json`), JSON.stringify(data.roof));
    fs.writeFileSync(path.join(out, `totals${sfx}.json`), JSON.stringify({ address, ...data.totals, solar: data.solar, audit: data.audit }, null, 1));
    return data;
  };
  const pdf = (name, id = pdfWhat) => step('download PDF ' + name, async () => {
    const dl = page.waitForEvent('download', { timeout: 240000 }); dl.catch(() => {});
    await page.evaluate((id) => { const b = document.getElementById(id); for (let p = b; p; p = p.parentElement) { if (p.tagName === 'DETAILS') p.open = true; if (p.hidden) p.hidden = false; } b.scrollIntoView({ block: 'center' }); }, id);
    if (process.argv.includes('--3d')) await page.evaluate(() => { const c = document.getElementById('chkPdf3d'); if (c) c.checked = true; });
    await page.click('#' + id, { timeout: 15000 });
    const save = page.locator('#dlReadySave'); save.waitFor({ timeout: 240000 }).then(() => save.click()).catch(() => {});
    const d = await dl; await d.saveAs(path.join(out, name));
  });
  const fit = async () => { await page.evaluate(() => { const b = new google.maps.LatLngBounds(); state.facets.forEach((f) => f.shape.getPath().forEach((p) => b.extend(p))); ((state.trace && state.trace.hiddenZones) || []).forEach((z) => z.path.forEach((p) => b.extend(p))); map.fitBounds(b, 60); }); await page.waitForTimeout(4000); };
  let data = await snapshot('');
  // the report flow a person uses: Preview, Print and Download must all carry the same bytes
  // buttons live inside collapsed panels: open the panels first (what a person does by hand)
  const clickBtn = async (id) => { await page.evaluate((id) => { const b = document.getElementById(id); for (let p = b; p; p = p.parentElement) { if (p.tagName === 'DETAILS') p.open = true; if (p.hidden) p.hidden = false; } b.scrollIntoView({ block: 'center' }); }, id); await page.click('#' + id, { timeout: 15000 }); };
  await step('report: preview', async () => { await page.evaluate(() => { window.__rmNoConfirm = true; }); await clickBtn('btnReportPreview'); await page.waitForFunction(() => window.__rmLastReport && window.__rmLastReport.previewed, null, { timeout: 240000 }); });
  const previewRec = await page.evaluate(() => ({ ...window.__rmLastReport }));
  await step('report: print', async () => { await clickBtn('btnReport'); await page.waitForFunction(() => window.__rmLastReport && window.__rmLastReport.printed, null, { timeout: 240000 }); });
  const printRec = await page.evaluate(() => ({ ...window.__rmLastReport }));
  await pdf('report.pdf');
  const dlRec = await page.evaluate(() => ({ ...window.__rmLastReport }));
  // independent reconciliation: the PDF's printed numbers read back and compared with the app's own model (needs pdftotext)
  try { const { reconcileRun } = await import('./pdf-reconcile.mjs'); const rc = reconcileRun(out); const bad = rc.checks.filter((c) => !c.ok);
    console.log(`     reconcile: ${rc.checks.length - bad.length} of ${rc.checks.length} printed values agree with the model` + (bad.length ? ' | ' + bad.map((c) => `${c.name}: printed ${JSON.stringify(c.printed)} vs ${JSON.stringify(c.expected)}`).join(' | ') : ''));
    fs.writeFileSync(path.join(out, 'reconcile.json'), JSON.stringify(rc, null, 1));
    if (bad.length) { if (process.argv.includes('--strict')) throw new Error('PDF does not reconcile with the model'); console.log('WARN report: reconciliation mismatch'); } }
  catch (e) { if (/pdftotext/.test(String(e.message))) console.log('     reconcile: skipped (' + e.message.split('\n')[0] + ')'); else throw e; }
  const same = previewRec.hash && previewRec.hash === printRec.hash && printRec.hash === dlRec.hash;
  console.log(`     report: ${dlRec.pages} sheets; preview / print / download ${same ? 'identical' : 'DIFFER'} (sha256 ${String(dlRec.hash).slice(0, 12)}); printed via ${printRec.printed}`);
  fs.writeFileSync(path.join(out, 'report-check.json'), JSON.stringify({ preview: previewRec, print: printRec, download: dlRec, identical: same }, null, 1));
  if (!same) throw new Error('preview, print and download do not agree');
  // the report's own layout check: exact scale, every key accounted for (plan, detail sheet or named as unplaced)
  const L = dlRec.layout; if (L && L.scaleCheck) {
    console.log(`     layout: ${L.scale} (${L.ptPerFt.toFixed(3)} pt/ft${L.rotationDeg ? ', turned ' + Math.round(Math.abs(L.rotationDeg)) + ' deg' : ''}); keys ${L.keys.total}: ${L.keys.overview} on the plan, ${L.keys.detail} on detail sheets, ${L.keys.unplaced.length} named unplaced; ${L.dims} dimension lines; scale bar ${L.bar.inches} in; scale check ${L.scaleCheck.ok ? 'exact' : 'FAILED'} (${L.scaleCheck.segmentFt.toFixed(2)} ft -> ${L.scaleCheck.segmentPt.toFixed(2)} pt, expected ${L.scaleCheck.expectedPt.toFixed(2)})`);
    const ov = L.textOverlaps || { count: 0, first: [] }; console.log(`     text overlaps: ${ov.count}` + (ov.count ? ' ' + JSON.stringify(ov.first) : ''));
    if (!L.scaleCheck.ok || L.keys.unaccounted.length || ov.count) { const why = JSON.stringify({ scale: L.scaleCheck.ok ? 'ok' : L.scaleCheck, unaccounted: L.keys.unaccounted, textOverlaps: ov.first }); if (process.argv.includes('--strict')) throw new Error('layout self-check failed: ' + why); console.log('WARN report: layout self-check: ' + why); }
  }
  // the report preview stays open after the download (as it does for a person); close it before the next panel is used
  await page.evaluate(() => { const c = document.getElementById('rpClose'); if (c) c.click(); const p = document.getElementById('reportPreview'); if (p) p.hidden = true; });
  // --alt: the reviewer's second look, through the same controls a person uses (Review roof from other angles)
  if (process.argv.includes('--alt')) {
    const panel = page.locator('#avPanel'); const busy = () => page.waitForFunction(() => !window.rmAltView.state.busy, null, { timeout: 240000 });
    await step('open "Review roof from other angles"', async () => { await page.evaluate(() => { const b = document.getElementById('btnAltView'); for (let p = b; p; p = p.parentElement) if (p.tagName === 'DETAILS') p.open = true; b.scrollIntoView({ block: 'center' }); }); await page.click('#btnAltView'); await panel.waitFor({ state: 'visible' }); });
    const cov = await step('3D view + coverage check', async () => { await page.waitForFunction(() => { const a = window.rmAltView.state; return a.cov && !a.busy; }, null, { timeout: 240000 }); return page.evaluate(() => { const a = window.rmAltView.state; return { ok: a.cov.ok, why: a.cov.why, zones: a.cov.zones || [], ready: a.ready3d }; }); });
    console.log('     3D: ' + JSON.stringify(cov));
    if (cov.ready && cov.ok !== false) for (const v of ['top', 'n', 'e', 's', 'w']) await step('3D view ' + v, async () => { await page.click(`#avSide [data-view="${v}"]`); await page.waitForTimeout(v === 'top' ? 9000 : 16000); await panel.screenshot({ path: path.join(out, `alt-3d-${v}.png`) }); });
    else await panel.screenshot({ path: path.join(out, 'alt-3d-unavailable.png') });
    const tiers = await step('dated imagery list', async () => { await page.click('#avPanel [data-av="dated"]'); await page.waitForFunction(() => { const a = window.rmAltView.state; return a.tiers && !a.busy && !a.listing && (a.sel || !a.tiers.some((t) => !t.current)); }, null, { timeout: 120000 }); await page.waitForTimeout(800); await busy(); return page.evaluate(() => window.rmAltView.state.tiers.map((t) => ({ quality: t.quality, date: t.date, current: t.current, same: t.same, roofSqft: t.roofSqft }))); });
    console.log('     tiers: ' + JSON.stringify(tiers)); fs.writeFileSync(path.join(out, 'alt-tiers.json'), JSON.stringify(tiers, null, 1));
    await page.waitForTimeout(1500); await panel.screenshot({ path: path.join(out, 'alt-dated-swipe.png') });
    if (await page.locator('#avProbe').count()) {
      const chk = await step('roof configuration check', async () => { await page.click('#avProbe'); await page.waitForFunction(() => window.rmAltView.state.probe && !window.rmAltView.state.busy, null, { timeout: 240000 }); return page.evaluate(() => window.rmAltView.state.probe.check); });
      console.log('     check: ' + JSON.stringify(chk)); fs.writeFileSync(path.join(out, 'alt-check.json'), JSON.stringify(chk, null, 1));
      await panel.screenshot({ path: path.join(out, 'alt-dated-check.png') });
      if (chk.ok) {
        await step('carry edges into the sketch', async () => { await page.check('#avCfg'); await page.fill('#avNoteTxt', arg('altnote', 'same roof in both images; tree removed in the newer one')); await page.locator('#avCarry').scrollIntoViewIfNeeded(); await page.locator('#avCarry').evaluate((b) => b.click()); await page.waitForTimeout(500);   /* a toast can sit over the button at the bottom of a long panel */ await page.waitForFunction(() => !window.rmAltView.state.busy, null, { timeout: 240000 }); const used = await page.evaluate(() => !!(state.trace && state.trace.alt && state.trace.alt.used)); console.log('     carried into the sketch: ' + (used ? 'yes' : 'no (' + (await page.evaluate(() => (state.trace && state.trace.alt && (state.trace.alt.reasons || []).join(' ')) || 'not used')) + ')')); });
        await page.waitForTimeout(1000); await panel.screenshot({ path: path.join(out, 'alt-dated-after.png') });
        await page.evaluate(() => { window.rmAltView.state.v.swipe = 0.04; }); await page.mouse.wheel(0, 0); await page.evaluate(() => avPaint()); await panel.screenshot({ path: path.join(out, 'alt-dated-after-newimage.png') });
      }
    }
    // a third dated source: the newest public-domain USDA NAIP photo, compared by swipe (too coarse to measure on)
    const naip = await page.evaluate(() => (window.rmAltView.state.naip || []).map((n) => ({ date: n.date, gsd: n.gsd })));
    console.log('     NAIP flights: ' + JSON.stringify(naip)); fs.writeFileSync(path.join(out, 'alt-naip.json'), JSON.stringify(naip, null, 1));
    if (naip.length) await step('compare newest USDA NAIP photo', async () => { await page.click('#avSide [data-src^="naip:"]'); await page.waitForFunction(() => { const a = window.rmAltView.state; return !a.busy && a.src[a.sel] && a.src[a.sel].naip; }, null, { timeout: 120000 }); await page.evaluate(() => { window.rmAltView.state.v.swipe = 0.5; avPaint(); }); await page.waitForTimeout(800); await panel.screenshot({ path: path.join(out, 'alt-dated-naip.png') }); });
    // a ground-rectified public-record orthophoto where one exists (Florida): comparison only
    const fdot = await page.evaluate(() => (window.rmAltView.state.fdot || []).map((n) => ({ year: n.year, from: n.from, to: n.to, gsd: n.gsd })));
    console.log('     county orthophotos: ' + JSON.stringify(fdot)); fs.writeFileSync(path.join(out, 'alt-county.json'), JSON.stringify(fdot, null, 1));
    if (fdot.length) await step('compare newest county orthophoto', async () => { await page.click('#avSide [data-src^="fdot:"]'); await page.waitForFunction(() => { const a = window.rmAltView.state; return !a.busy && a.src[a.sel] && a.src[a.sel].fdot; }, null, { timeout: 120000 }); await page.evaluate(() => { window.rmAltView.state.v.swipe = 0.5; avPaint(); }); await page.waitForTimeout(800); await panel.screenshot({ path: path.join(out, 'alt-dated-county.png') }); }).catch(() => {});
    // --verify-lowslope "<note>": the reviewer clicks the outline of a low-slope section taken from the second dataset and marks it for verification
    const vnote = arg('verify-lowslope', null);
    if (vnote && await page.locator('#avSide [data-src^="solar:"]').count()) {
      await step('mark low-slope outline for verification', async () => {
        const again = page.locator('#avSide [data-src^="solar:"]').first(); await again.click(); await busy(); await page.evaluate(() => { window.rmAltView.state.v.swipe = 0.04; avPaint(); });
        const targets = await page.evaluate(() => { const r = state.trace.ref, cv = document.getElementById('avCanvas'), b = cv.getBoundingClientRect(), V = window.rmAltView.state.v, W = cv.clientWidth, H = cv.clientHeight;
          const en = (q) => [(q.lng() - r.lng) * r.kx, (q.lat() - r.lat) * r.ky]; const ring = (sh) => { const o = []; sh.getPath().forEach((q) => o.push(en(q))); return o; };
          const low = state.facets.filter((f) => !f.omit && !f.excluded && (f.structure || 1) === 1 && f.pitch <= 2 && (f.altSqft || 0) > 20).map((f) => ring(f.shape)); const out = [];
          for (const e of state.edges) { if (e.omit || !['eave', 'rake'].includes(e.type) || e.verify) continue; const p = ring(e.shape); const mid = [(p[0][0] + p[1][0]) / 2, (p[0][1] + p[1][1]) / 2];
            if (low.some((fp) => fp.some((a, k) => RM.pointSeg(mid, a, fp[(k + 1) % fp.length]) < 0.4))) out.push({ id: e.id, x: b.left + W / 2 + (mid[0] - V.cx) * V.s, y: b.top + H / 2 - (mid[1] - V.cy) * V.s }); }
          return out; });
        let n = 0; for (const t of targets) { await page.mouse.click(t.x, t.y); await page.waitForTimeout(250); const ok = await page.evaluate((id) => { const p = window.rmAltView.state.pick; return !!(p && p.kind === 'edge' && p.id === id); }, t.id); if (!ok || !await page.locator('#avPkVerify').count()) continue; await page.fill('#avPkNote', vnote); await page.click('#avPkVerify'); n++; await page.waitForTimeout(150); }
        console.log(`     marked ${n} of ${targets.length} low-slope outline lines for verification`); await panel.screenshot({ path: path.join(out, 'alt-dated-verify.png') });
      });
    }
    await page.click('#avClose'); await fit();
    await page.locator('#map').screenshot({ path: path.join(out, 'map-overlay-alt.png') });
    data = await snapshot('-alt'); await pdf('report-alt.pdf');
  }
  // --estimate: the app's own priced estimate (panel 7, its saved price list and default scope), from the final sketch
  if (process.argv.includes('--estimate')) {
    // --xm "key=value,key=value": estimate settings a person would change in panel 7 (for example deck=membrane, pipeLead=2, lossType=)
    const xmSet = arg('xm', null);
    if (xmSet != null) await page.evaluate((kv) => { for (const part of kv.split(',')) { const i = part.indexOf('='); if (i < 1) continue; const k = part.slice(0, i).trim(), v = part.slice(i + 1).trim(); if (!(k in XM_DEFAULTS)) throw new Error('unknown estimate setting ' + k); const d = XM_DEFAULTS[k]; xm[k] = typeof d === 'boolean' ? v === 'true' : typeof d === 'number' ? +v : v; } if (typeof xmRender === 'function') xmRender(); }, xmSet);
    const est = await page.evaluate(() => { const E = xmPriced(); const s = {}; for (const k of ['shingle', 'waste', 'underlay', 'deck', 'drip', 'valley', 'iws', 'renail', 'sealant', 'starter', 'ridgeVent', 'mastic', 'steep', 'high', 'op', 'removal', 'pipeLead', 'pipe', 'exhaust4', 'exhaust8', 'turtle', 'offridge4', 'offridge6', 'rain', 'satellite', 'chimney', 'gutterLF', 'haul', 'dumpster', 'permit', 'permitAmt', 'priceList', 'lossType']) s[k] = xm[k];
      return { settings: s, taxRate: E.rate, items: E.items.map((i) => ({ n: i.n, desc: i.desc, unit: i.unit, qty: i.qty, price: i.price, ext: i.ext, tax: i.tax, rcv: i.rcv, cat: i.cat })), lineItemTotal: E.lit, tax: E.tax, overhead: E.overhead, profit: E.profit, rcv: E.rcv, deductible: E.deductible, net: E.net, meas: E.meas, county: typeof permit !== 'undefined' && permit.data ? permit.data.county : null, yearBuilt: typeof permit !== 'undefined' && permit.data ? permit.data.yearBuilt : null }; });
    const en = arg('est-name', 'estimate'); fs.writeFileSync(path.join(out, en + '.json'), JSON.stringify(est, null, 1));
    await pdf(en + '.pdf', 'btnXmPDF');
    console.log(`     estimate: ${est.items.length} lines, line items ${est.lineItemTotal.toFixed(2)}, tax ${est.tax.toFixed(2)}, total ${est.rcv.toFixed(2)}`);
  }
  const t = data.totals; console.log(`${address || path.basename(arg('job', ''))}: ${Math.round(t.slopedSqft)} sqft, ${t.facetCount} facets, predominant ${t.predominant}/12, ${t.structures.length} structure(s)`);
} catch (e) { code = 1; try { await page.screenshot({ path: path.join(out, 'failure.png') }); } catch (_) { /* ignore */ } }
fs.writeFileSync(path.join(out, 'console.log'), log.join('\n'));
if (dialogs.length) console.log('export gate asked: ' + dialogs.join(' | ').replace(/\n+/g, ' '));
await browser.close(); srv.close(); process.exit(code);
