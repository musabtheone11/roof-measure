// Loads the browser engine (autotrace.js + autotrace2.js) into a Node vm context, unchanged, and runs traceBuildingV2.
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function loadEngine(files = ['autotrace.js', 'autotrace2.js', 'obstruction.js']) {
  const ctx = { console, Math, Float64Array, Float32Array, Int32Array, Int16Array, Uint8Array, Map, Set, Array, Number, Object, JSON, Infinity, NaN, state: {}, window: {}, location: { hostname: 'bench' }, toast() {}, degToPitch: (d) => 12 * Math.tan(d * Math.PI / 180) };
  vm.createContext(ctx);
  for (const f of files) { const fp = path.join(ROOT, f); if (fs.existsSync(fp)) vm.runInContext(fs.readFileSync(fp, 'utf8'), ctx, { filename: f }); }
  return ctx;
}

// scene: { w, h, px, dsm: Float32Array, mask: Uint8Array }  (x east, y south, origin top-left at E0,N0)
export function trace(ctx, scene) {
  const { w, h, px, dsm, mask, E0, N0 } = scene;
  const geo = {
    ref: { lat: 0, lng: 0, kx: 1, ky: 1 },     // toLL(p) = {lat: N, lng: E} -> stays in metres
    E: (x) => E0 + x * px, N: (y) => N0 - y * px,
    X: (E) => (E - E0) / px, Y: (N) => (N0 - N) / px,
    pxM2: px * px,
  };
  // main component = largest mask component (same as the app's choice for a single house)
  const comps = ctx.allComponents(mask, w, h).sort((a, b) => b.n - a.n);
  const comp = comps[0];
  const tif = { data: dsm, w, h };
  const res = ctx.traceBuildingV2(null, tif, mask, comp, geo, { rgb: scene.rgb || null });
  // back to metre coordinates [E, N]
  res.facets = res.facets.map((f) => ({ ...f, poly: f.path.map((p) => [p.lng, p.lat]) }));
  res.edges = res.edges.map((e) => ({ ...e, line: e.path.map((p) => [p.lng, p.lat]) }));
  return res;
}
