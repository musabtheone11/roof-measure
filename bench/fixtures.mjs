// Regression fixtures for defects confirmed on the regional benchmark. Synthetic data only (no network, no addresses):
//   node bench/fixtures.mjs    -> exits 1 on any failure. Runs in CI.
// Each fixture names the defect it guards against. They run the app's own autoTraceRoof() through bench/appcore.mjs
// with synthetic Google-like layers, and the report status rules in roofmodel.js.
import { createRequire } from 'node:module';
import { render, rng } from './synth.mjs';
import { runApp, ROOT as ROOT0 } from './appcore.mjs';
const ROOT = process.env.ENGINE || ROOT0;   // ENGINE=<app dir> runs the fixtures against another version (e.g. the baseline, to see them fail)
const RM = createRequire(import.meta.url)('../roofmodel.js');

let fail = 0; const out = (ok, name, why = '') => { console.log((ok ? 'ok   ' : 'FAIL ') + name + (why ? ' - ' + why : '')); if (!ok) fail++; };
const LAT0 = 30.25, LNG0 = -81.6; const KY = 110540, KX = 111320 * Math.cos(LAT0 * Math.PI / 180);
const W = (o) => ({ cx: 0, cy: 0, th: 0.2, L: 18, W: 10, kind: 'hip', s: 0.5, sEnd: 0.5, eaveZ: 3, ...o });

// a property in the shape bench/appcore.mjs fetchProperty() returns, from a synthetic scene
function property(scene, o = {}) {
  const { w, h, px, E0, N0 } = scene;
  const toLL = (x, y) => ({ lat: LAT0 + (N0 - y * px) / KY, lng: LNG0 + (E0 + x * px) / KX });
  const tif = (data) => ({ data, w, h, toLL, rx: px, ry: -px, bands: null });
  let e0 = Infinity, e1 = -Infinity, n0 = Infinity, n1 = -Infinity;
  const src = o.boxFrom || scene.mask; for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (src[y * w + x]) { const E = E0 + x * px, N = N0 - y * px; e0 = Math.min(e0, E); e1 = Math.max(e1, E); n0 = Math.min(n0, N); n1 = Math.max(n1, N); }
  const dt = (s) => { const [Y, M, D] = s.split('-').map(Number); return { year: Y, month: M, day: D }; };
  const main = { name: 'buildings/fixture', center: { latitude: LAT0 + (n0 + n1) / 2 / KY, longitude: LNG0 + (e0 + e1) / 2 / KX }, boundingBox: { sw: { latitude: LAT0 + n0 / KY, longitude: LNG0 + e0 / KX }, ne: { latitude: LAT0 + n1 / KY, longitude: LNG0 + e1 / KX } },
    imageryDate: dt(o.recordDate || '2023-11-19'), imageryQuality: o.recordQuality || 'HIGH' };
  const radius = Math.min(100, Math.max(15, Math.ceil(Math.hypot(e1 - e0, n1 - n0) / 2 + 12)));
  return { slug: 'fixture', address: 'fixture', loc: { lat: main.center.latitude, lng: main.center.longitude }, main, radius,
    layers: { imageryDate: dt(o.layersDate || o.recordDate || '2023-11-19'), imageryQuality: o.layersQuality || 'HIGH' },
    maskT: tif(o.mask || scene.mask), dsmT: tif(scene.dsm), rgbT: null, solarNear: async () => { throw new Error('none'); }, _alt: o.alt ? { layers: { imageryDate: dt(o.alt.date), imageryQuality: o.alt.quality }, maskT: tif(o.alt.scene.mask), dsmT: tif(o.alt.scene.dsm), rgbT: null } : null };
}
const altHook = (P) => (ctx) => { ctx.altLoadLayers = async () => { if (!P._alt) throw new Error('no other dataset'); return P._alt; }; };
const statusOf = (ctx, tr) => RM.reportStatus({ failed: tr && tr.failed, facets: ctx.state.facets.length, imageryQuality: tr && tr.imageryQuality, layerChoice: tr && tr.layerChoice, reconcileOk: true });

const house = render([W()], rng(11), { clutter: false, trees: 0, noise: 0.02, blur: 1, hard: false });
const empty = new Uint8Array(house.mask.length);

// D1 (regional benchmark): Google's building record exists but its image shows no building (house newer than the flight).
// Before: the trace failed with "Building mask is empty" and no report could be exported. Now: a clear reason, and no roof
// area is invented (no height-model guess, which traced tree tops where there was no house yet).
{
  const P = property(house, { mask: empty, boxFrom: house.mask });
  let msg = null, facets = -1; try { const r = await runApp(P, ROOT, { quiet: true, hook: altHook(P) }); facets = r.facets.length; } catch (e) { msg = e.message; }
  out(msg && /shows no building outline/.test(msg) && facets === -1, 'D1 empty building mask: no roof invented, reason given', msg || `traced ${facets} facets`);
  const st = RM.reportStatus({ failed: msg, facets: 0 });
  out(st.status === 'REVIEW REQUIRED' && st.reasons[0].code === 'no-roof' && /Imagery that shows the building/.test(st.reasons[0].needs), 'D1 no-roof report states REVIEW REQUIRED and the missing evidence');
}
// D2 (regional benchmark): the building record comes from a newer (medium quality) flight than the best layers, and the
// best layers show no building. Before: failed run. Now: traced from the record's own flight, REVIEW REQUIRED (quality + date).
{
  const P = property(house, { mask: empty, boxFrom: house.mask, recordDate: '2021-01-14', recordQuality: 'MEDIUM', layersDate: '2016-02-11', layersQuality: 'HIGH', alt: { date: '2021-01-14', quality: 'MEDIUM', scene: house } });
  let r = null, msg = null; try { r = await runApp(P, ROOT, { quiet: true, hook: altHook(P) }); } catch (e) { msg = e.message; }
  const tr = r && r.ctx.state.trace; const st = r ? statusOf(r.ctx, tr) : null;
  out(r && r.facets.length >= 3 && tr.layerChoice && tr.layerChoice.used === 'record', 'D2 no building in best layers: traced from the newer record flight', msg || (tr && JSON.stringify(tr.layerChoice)));
  out(st && st.status === 'REVIEW REQUIRED' && st.reasons.some((q) => q.code === 'imagery-change') && st.reasons.some((q) => q.code === 'imagery-quality'), 'D2 report says REVIEW REQUIRED: older best image, medium-quality trace', st && st.reasons.map((q) => q.code).join(','));
}
// D3: record newer than the layers but the building is in them: keep the sharper layers, but say the roof may have changed.
{
  const P = property(house, { recordDate: '2021-01-14', recordQuality: 'MEDIUM', layersDate: '2016-02-11', layersQuality: 'HIGH', alt: { date: '2021-01-14', quality: 'MEDIUM', scene: house } });
  const r = await runApp(P, ROOT, { quiet: true, hook: altHook(P) }); const tr = r.ctx.state.trace; const st = statusOf(r.ctx, tr);
  out(r.facets.length >= 3 && tr.layerChoice && tr.layerChoice.used === 'layers' && tr.layerChoice.buildingInLayers, 'D3 building in best layers: traced from them', JSON.stringify(tr.layerChoice));
  out(st.status === 'REVIEW REQUIRED' && st.reasons.some((q) => q.code === 'imagery-change'), 'D3 report says the roof may have changed since the traced image');
}
// D4: a plain roof on current high-quality imagery with nothing open is COMPLETE (no reason is invented either)
{
  const P = property(house); const r = await runApp(P, ROOT, { quiet: true, hook: altHook(P) }); const st = statusOf(r.ctx, r.ctx.state.trace);
  out(r.facets.length >= 3 && st.status === 'COMPLETE', 'D4 clear current roof: COMPLETE', st.reasons.map((q) => q.text).join(' | '));
}
// D5 (regional benchmark): the geocoded address point fell on an empty lot and Google picked the neighbouring house; the
// report said COMPLETE. Now the distance from the address point to the measured building is checked.
{
  const P = property(house); const far = { ...P.loc, lng: P.loc.lng + 25 / KX };
  const r = await runApp({ ...P, loc: far }, ROOT, { quiet: true, hook: altHook(P) }); const tr = r.ctx.state.trace;
  const st = RM.reportStatus({ facets: r.facets.length, reconcileOk: true, imageryQuality: 'HIGH', addressCheck: tr.addressCheck });
  out(tr.addressCheck && tr.addressCheck.distM > 15 && st.status === 'REVIEW REQUIRED' && st.reasons.some((q) => q.code === 'selection'), 'D5 address point 25 m from the measured building: REVIEW REQUIRED (building selection)', JSON.stringify(tr.addressCheck));
  const r2 = await runApp(P, ROOT, { quiet: true, hook: altHook(P) }); const ac = r2.ctx.state.trace.addressCheck;
  out(ac && ac.distM === 0 && !RM.reportStatus({ facets: 3, reconcileOk: true, addressCheck: ac }).reasons.length, 'D5 address point on the roof: no selection reason');
}
// D6 (regional benchmark): a screen enclosure / pergola (low slope, uneven surface in the height model) was reported as
// measured roof. Now such a section is marked for verification and the report asks for review.
{
  const c = Math.cos(0.2), s = Math.sin(0.2);
  const sc = render([W(), W({ cx: -9 * s, cy: 9 * c, L: 8, W: 6, kind: 'gable', s: 0.12, sEnd: 0.12, eaveZ: 2.6, th: 0.2 })], rng(12), { clutter: false, trees: 0, noise: 0.02, blur: 1, hard: false });
  const r0 = rng(99); const lowZ = 4.0; for (let i = 0; i < sc.dsm.length; i++) if (sc.mask[i] && sc.dsm[i] < lowZ) sc.dsm[i] += (r0() - 0.5) * 0.45;   // open lattice: deck seen through the cover
  const P = property(sc); const r = await runApp(P, ROOT, { quiet: true, hook: altHook(P) });
  const flagged = r.facets.filter((f) => f.verify); const plain = render([W()], rng(13), { clutter: false, trees: 0, noise: 0.02, blur: 1, hard: false }); const rp = await runApp(property(plain), ROOT, { quiet: true, hook: altHook(property(plain)) });
  out(flagged.length >= 1 && flagged.every((f) => f.slope <= 0.34), 'D6 uneven low-slope section marked for verification', `${flagged.length} of ${r.facets.length} facets flagged`);
  out(!rp.facets.some((f) => f.verify), 'D6 plain pitched roof: nothing marked');
}
// D7 (regional benchmark): hips stopping short of the outline corner left short sloped corner pieces counted as rakes (rakes
// over-counted on hip roofs). They are eave round the corner now.
{
  let bad = 0, tot = 0;
  for (const seed of [21, 22, 23, 24, 25, 26]) { const sc = render([W({ L: 16 + seed % 4, W: 9 + seed % 3 })], rng(seed), { clutter: false, trees: 0, hard: true }); const P = property(sc); const r = await runApp(P, ROOT, { quiet: true, hook: altHook(P) });
    const kxy = (v) => [(v.lng - LNG0) * KX, (v.lat - LAT0) * KY]; const lows = r.edges.filter((e) => e.type === 'hip').map((e) => e.path.map(kxy));
    for (const e of r.edges) { if (e.type !== 'rake' || e.paired) continue; tot++;   /* outline pieces only (paired = the upper edge of a height break) */ const g = e.path.map(kxy); const L = Math.hypot(g[1][0] - g[0][0], g[1][1] - g[0][1]); if (L < 2.5 && lows.some((h) => h.some((q) => g.some((p) => Math.hypot(p[0] - q[0], p[1] - q[1]) < 0.3)))) bad++; } }
  out(bad === 0, 'D7 pure hip roofs: no short outline rake at a hip end', `${bad} of ${tot} rakes`);
}
// status rules: every open item is a reason with the evidence it needs; zero only for a verified absence
{
  const st = RM.reportStatus({ facets: 4, hiddenZones: [{ id: 'H1' }], hiddenUpperSqft: 300, inferredSqft: 120, verify: [{ label: 'L3 rake' }], geometryErrors: 1, reconcileOk: false, imageryQuality: 'MEDIUM' });
  const codes = st.reasons.map((q) => q.code).join(',');
  out(codes === 'hidden,estimate,verify,geometry,reconcile,imagery-quality' && st.reasons.every((q) => q.needs && q.text), 'status rules list every open item with what is needed', codes);
}
process.exit(fail ? 1 : 0);
