// Real-roof check: node real.mjs --key GOOGLE_KEY --truth truth/<file>.json [--lat --lng]   (address in the truth file is geocoded)
// Downloads Google Solar mask + 10 cm DSM, traces with the current engine and the original one, scores both against the
// GAF/EagleView truth numbers. Each address costs about 10 cents of Google API usage.
import fs from 'node:fs';
import { fromArrayBuffer } from 'geotiff';
import { loadEngine } from './engine.mjs';
import { summarizeEngine, TYPES } from './score.mjs';
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const key = arg('key', process.env.GOOGLE_MAPS_KEY); const truth = JSON.parse(fs.readFileSync(arg('truth'), 'utf8'));
const get = async (u) => { const r = await fetch(u); if (!r.ok) throw new Error(r.status + ' ' + (await r.text()).slice(0, 300)); return r; };
let lat = +arg('lat', NaN), lng = +arg('lng', NaN);
if (!(lat && lng)) { const g = await (await get(`https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(truth.address)}&key=${key}`)).json(); ({ lat, lng } = g.results[0].geometry.location); }
const bi = await (await get(`https://solar.googleapis.com/v1/buildingInsights:findClosest?location.latitude=${lat}&location.longitude=${lng}&requiredQuality=LOW&key=${key}`)).json();
const bb = bi.boundingBox, kx = 111320 * Math.cos(bi.center.latitude * Math.PI / 180), ky = 110540;
const radius = Math.min(100, Math.max(15, Math.ceil(Math.hypot((bb.ne.longitude - bb.sw.longitude) * kx, (bb.ne.latitude - bb.sw.latitude) * ky) / 2 + 12)));
const dl = await (await get(`https://solar.googleapis.com/v1/dataLayers:get?location.latitude=${bi.center.latitude}&location.longitude=${bi.center.longitude}&radiusMeters=${radius}&view=IMAGERY_LAYERS&requiredQuality=LOW&pixelSizeMeters=0.1&key=${key}`)).json();
const tif = async (u) => { const t = await fromArrayBuffer(await (await get(u + '&key=' + key)).arrayBuffer()); const im = await t.getImage(); return { data: (await im.readRasters())[0], w: im.getWidth(), h: im.getHeight(), o: im.getOrigin(), r: im.getResolution() }; };
const [M, D] = await Promise.all([tif(dl.maskUrl), tif(dl.dsmUrl)]);
fs.mkdirSync('real-cache', { recursive: true });
const { w, h } = D; const px = Math.abs(D.r[0]);
const mask = new Uint8Array(w * h); for (let i = 0; i < w * h; i++) mask[i] = M.data[i] > 0 ? 1 : 0;
const dsm = Float32Array.from(D.data);
// UTM metres: E grows with x, N shrinks with y; keep the building component nearest the raster centre
const scene = { w, h, px, dsm, mask, E0: 0, N0: 0 };
function run(files) {
  const ctx = loadEngine(files);
  const geo = { ref: { lat: 0, lng: 0, kx: 1, ky: 1 }, E: (x) => x * px, N: (y) => -y * px, X: (E) => E / px, Y: (N) => -N / px, pxM2: px * px };
  const comps = ctx.allComponents(mask, w, h); const cx = w / 2, cy = h / 2;
  const comp = comps.filter((c) => c.n * px * px > 40).sort((a, b) => Math.hypot(a.cx - cx, a.cy - cy) - Math.hypot(b.cx - cx, b.cy - cy))[0];
  const res = ctx.traceBuildingV2(bi, { data: dsm, w, h }, mask, { ...comp, member: new Uint8Array(comp.member) }, geo, {});
  res.facets = res.facets.map((f) => ({ ...f, poly: f.path.map((p) => [p.lng, p.lat]) })); res.edges = res.edges.map((e) => ({ ...e, line: e.path.map((p) => [p.lng, p.lat]) }));
  return { res, sum: summarizeEngine(res) };
}
const now = run(undefined), orig = run(['bench/engines/base/autotrace.js', 'bench/engines/base/autotrace2.js']);
const t = truth.ft; const row = (lab, g, a, b) => console.log(lab.padEnd(12), String(Math.round(g)).padStart(7), String(Math.round(a)).padStart(9), String(Math.round(b)).padStart(9), ((b - g) / (g || 1) * 100).toFixed(0).padStart(6) + '%');
console.log(truth.address, ' imagery', dl.imageryDate, ' quality', dl.imageryQuality, ' noise est', '\n' + 'item'.padEnd(12), '  truth', ' original', '   fixed', '  err');
row('area sqft', truth.areaSqft, orig.sum.sloped, now.sum.sloped); row('facets', truth.facets, orig.sum.facetCount, now.sum.facetCount);
for (const k of TYPES) if (t[k] || orig.sum.byType[k] > 1 || now.sum.byType[k] > 1) row(k, t[k] || 0, orig.sum.byType[k], now.sum.byType[k]);
console.log('pitches original', JSON.stringify(Object.fromEntries(Object.entries(orig.sum.pitchAreas).map(([p, a]) => [p, Math.round(a)]))));
console.log('pitches fixed   ', JSON.stringify(Object.fromEntries(Object.entries(now.sum.pitchAreas).map(([p, a]) => [p, Math.round(a)]))));
fs.writeFileSync(`real-cache/${truth.address.replace(/\W+/g, '_')}.json`, JSON.stringify({ truth, now: now.sum, orig: orig.sum }));
