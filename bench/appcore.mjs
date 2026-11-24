// Headless "app core": runs the app's own autoTraceRoof() (autotrace.js + autotrace2.js [+ extra engine files]) in a Node vm
// against real Google Solar data, with the browser pieces (map shapes, fetch, DOM) replaced by small stubs.
// Rasters and API responses are cached under bench/private/cache (git-ignored: customer addresses).
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fromArrayBuffer } from 'geotiff';
import proj4 from 'proj4';

export const BENCH = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(BENCH, '..');
export const CACHE = path.join(BENCH, 'private', 'cache');
const KEY = () => { const k = process.env.Key || process.env.GOOGLE_MAPS_KEY; if (!k) throw new Error('Set Key or GOOGLE_MAPS_KEY'); return k; };
export const slugOf = (s) => String(s).toLowerCase().replace(/,.*$/, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

async function getJSON(url, cacheFile) {
  if (cacheFile && fs.existsSync(cacheFile)) return JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
  const r = await fetch(url + (url.includes('?') ? '&' : '?') + 'key=' + KEY());
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error((j.error && j.error.message) || 'HTTP ' + r.status); e.status = r.status; throw e; }
  if (cacheFile) { fs.mkdirSync(path.dirname(cacheFile), { recursive: true }); fs.writeFileSync(cacheFile, JSON.stringify(j)); }
  return j;
}
async function getBin(url, cacheFile) {
  if (fs.existsSync(cacheFile)) return fs.readFileSync(cacheFile);
  const r = await fetch(url + '&key=' + KEY()); if (!r.ok) throw new Error('GeoTIFF download failed (' + r.status + ')');
  const b = Buffer.from(await r.arrayBuffer()); fs.mkdirSync(path.dirname(cacheFile), { recursive: true }); fs.writeFileSync(cacheFile, b); return b;
}
// same contract as loadTiff() in autotrace.js
async function readTiff(buf, bands = 1) {
  const tiff = await fromArrayBuffer(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  const img = await tiff.getImage(); const ras = await img.readRasters();
  const w = img.getWidth(), h = img.getHeight(); const [ox, oy] = img.getOrigin(); const [rx, ry] = img.getResolution();
  const keys = img.getGeoKeys() || {}; const epsg = keys.ProjectedCSTypeGeoKey || keys.GeographicTypeGeoKey || 4326; const sy = ry > 0 ? -ry : ry;
  let toLL;
  if (epsg === 4326 || Math.abs(ox) <= 360) toLL = (x, y) => ({ lng: ox + x * rx, lat: oy + y * sy });
  else {
    let def = null;
    if (epsg >= 32601 && epsg <= 32660) def = `+proj=utm +zone=${epsg - 32600} +datum=WGS84 +units=m +no_defs`;
    else if (epsg >= 32701 && epsg <= 32760) def = `+proj=utm +zone=${epsg - 32700} +south +datum=WGS84 +units=m +no_defs`;
    else if (epsg === 3857) def = 'EPSG:3857';
    if (!def) throw new Error('Unsupported GeoTIFF projection EPSG:' + epsg);
    toLL = (x, y) => { const p = proj4(def, 'EPSG:4326', [ox + x * rx, oy + y * sy]); return { lng: p[0], lat: p[1] }; };
  }
  return { data: ras[0], bands: bands > 1 ? [ras[0], ras[1], ras[2]] : null, w, h, toLL, rx, ry, epsg };
}

// address -> {lat,lng,formatted}; "lat,lng" strings pass straight through
export async function geocode(address, dir) {
  const m = String(address).match(/^\s*(-?\d+(\.\d+)?)\s*,\s*(-?\d+(\.\d+)?)\s*$/); if (m) return { lat: +m[1], lng: +m[3], formatted: address };
  const j = await getJSON('https://maps.googleapis.com/maps/api/geocode/json?address=' + encodeURIComponent(address), path.join(dir, 'geocode.json'));
  const r = j.results && j.results[0]; if (!r) throw new Error('Address not found: ' + (j.status || ''));
  return { lat: r.geometry.location.lat, lng: r.geometry.location.lng, formatted: r.formatted_address, locationType: r.geometry.location_type };
}

// Everything the app downloads for one property (cached): building insights, mask, DSM, and the RGB aerial layer.
export async function fetchProperty(address, opt = {}) {
  const slug = opt.slug || slugOf(address); const dir = path.join(CACHE, slug);
  const loc = opt.lat ? { lat: +opt.lat, lng: +opt.lng, formatted: address } : await geocode(address, dir);
  const solar = (lat, lng, tag) => getJSON(`https://solar.googleapis.com/v1/buildingInsights:findClosest?location.latitude=${lat}&location.longitude=${lng}&requiredQuality=LOW`, path.join(dir, tag + '.json'));
  const main = await solar(loc.lat, loc.lng, 'building');
  const bb = main.boundingBox, cLat = main.center.latitude, cLng = main.center.longitude;
  const kx = 111320 * Math.cos(cLat * Math.PI / 180), ky = 110540;
  const radius = Math.min(100, Math.max(15, Math.ceil(Math.hypot((bb.ne.longitude - bb.sw.longitude) * kx, (bb.ne.latitude - bb.sw.latitude) * ky) / 2 + 12)));
  const layers = await getJSON(`https://solar.googleapis.com/v1/dataLayers:get?location.latitude=${cLat}&location.longitude=${cLng}&radiusMeters=${radius}&view=IMAGERY_LAYERS&requiredQuality=LOW&pixelSizeMeters=0.1`, path.join(dir, `layers_${radius}.json`));
  const [mB, dB, rB] = await Promise.all([getBin(layers.maskUrl, path.join(dir, 'mask.tif')), getBin(layers.dsmUrl, path.join(dir, 'dsm.tif')), layers.rgbUrl ? getBin(layers.rgbUrl, path.join(dir, 'rgb.tif')).catch(() => null) : null]);
  const maskT = await readTiff(mB), dsmT = await readTiff(dB), rgbT = rB ? await readTiff(rB, 3) : null;
  return { slug, dir, address, loc, main, radius, layers, maskT, dsmT, rgbT, solarNear: (lat, lng) => solar(lat, lng, `near_${lat.toFixed(5)}_${lng.toFixed(5)}`) };
}

// Run the app's autoTraceRoof() from `engineDir` (default: repo root) on a fetched property. Returns facets/edges in lat/lng plus
// whatever extra fields the engine attaches (status, factor, obstruction...).
export async function runApp(prop, engineDir = ROOT, opt = {}) {
  const files = ['roofmodel.js', 'autotrace.js', 'autotrace2.js', 'obstruction.js'].filter((f) => fs.existsSync(path.join(engineDir, f)));
  const facets = [], edges = []; let curStruct = 1, lastWasEdge = false;
  const pitchFactor = (p) => Math.sqrt(144 + p * p) / 12;
  const ringM2 = (path) => { const o = path[0]; const kx = 111320 * Math.cos(o.lat * Math.PI / 180), ky = 110540; let s = 0; for (let i = 0; i < path.length; i++) { const a = path[i], b = path[(i + 1) % path.length]; s += (a.lng - o.lng) * kx * (b.lat - o.lat) * ky - (b.lng - o.lng) * kx * (a.lat - o.lat) * ky; } return Math.abs(s / 2); };
  const ctx = {
    console: opt.quiet ? { log() {}, warn() {}, error() {} } : console, Math, Float64Array, Float32Array, Int32Array, Int16Array, Uint8Array, Uint16Array, Map, Set, Array, Number, Object, JSON, Infinity, NaN, Promise, Date, String, Boolean, Error, isFinite, isNaN, parseFloat, parseInt,
    state: { solar: prop.main, facets: [], edges: [], key: '', otherSolar: [], selected: null, location: prop.loc, address: prop.address }, window: {}, location: { hostname: 'bench' },
    toast() {}, recompute() {}, drawSolar() {}, $: () => ({}), degToPitch: (d) => 12 * Math.tan(d * Math.PI / 180),
    fetchSolar: (lat, lng) => prop.solarNear(lat, lng),
    // the app adds each structure's facets, then its lines: a facet after a line starts the next structure
    addFacet: (path, pitch, name, flags = {}) => { if (lastWasEdge) { curStruct++; lastWasEdge = false; } const f = { ...flags, name, pitch, path, struct: curStruct, shape: { setMap() {} } }; facets.push(f); ctx.state.facets.push(f); return f; },
    addEdge: (type, path, pitch, name, flags = {}) => { lastWasEdge = true; const e = { ...flags, type, path, pitch: pitch == null ? null : pitch, struct: curStruct, shape: { setMap() {} } }; edges.push(e); ctx.state.edges.push(e); return e; },
    facetMetrics: (f) => { const plan = ringM2(f.path) * 10.7639104; return { path: f.path, plan, sloped: plan * (f.slope != null ? Math.sqrt(1 + f.slope * f.slope) : pitchFactor(f.pitch)) }; },
  };
  ctx.window = ctx; ctx.globalThis = ctx;
  vm.createContext(ctx);
  for (const f of files) vm.runInContext(fs.readFileSync(path.join(engineDir, f), 'utf8'), ctx, { filename: path.join(engineDir, f) });
  // the app keys its raster cache by building + radius; engines differ by a metre in how they round the radius
  const entry = { layers: prop.layers, maskT: prop.maskT, dsmT: prop.dsmT, rgbT: prop.rgbT }; ctx.__layerCache = {}; for (let d = -2; d <= 2; d++) ctx.__layerCache[prop.main.name + '|' + (prop.radius + d)] = entry;
  if (opt.hook) opt.hook(ctx);          // debugging: wrap engine globals before the trace runs
  const t0 = Date.now();
  const info = await vm.runInContext('autoTraceRoof({ quiet: true' + (opt.plot ? ', plot: true' : '') + ' })', ctx);
  return { info, facets, edges, ms: Date.now() - t0, extra: ctx.state.traceExtra || ctx.__traceExtra || null, ctx };
}
