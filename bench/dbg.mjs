// node dbg.mjs seed [engineDir] > out.json   (GT + engine geometry for plotting)
import { summarizeGT, render, rng, randomHouse } from './synth.mjs';
import { loadEngine, trace } from './engine.mjs';
import { summarizeEngine } from './score.mjs';
const seed = +process.argv[2]; const dir = process.argv[3];
const r = rng(seed * 7919 + 13); const wings = randomHouse(r); const gt = summarizeGT(wings); const sc = render(wings, r);
const ctx = dir ? loadEngine(['autotrace.js', 'autotrace2.js'].map((f) => dir + '/' + f)) : loadEngine();
const res = trace(ctx, sc); const en = summarizeEngine(res);
const dsm = []; for (let y = 0; y < sc.h; y += 2) { const row = []; for (let x = 0; x < sc.w; x += 2) row.push(+sc.dsm[y * sc.w + x].toFixed(2)); dsm.push(row); }
console.log(JSON.stringify({ seed, meta: sc.meta, ext: [sc.E0, sc.E0 + sc.w * sc.px, sc.N0 - sc.h * sc.px, sc.N0], dsm,
  gt: { facets: gt.facets.map((f) => ({ poly: f.poly[0], pitch: +(f.slope * 12).toFixed(1) })), edges: gt.edges.map((e) => ({ type: e.type, p0: e.p0, p1: e.p1 })), byType: gt.byType, sloped: gt.sloped },
  en: { facets: res.facets.map((f) => ({ poly: f.poly, pitch: f.pitch })), edges: res.edges.map((e) => ({ type: e.type, line: e.line })), byType: en.byType, sloped: en.sloped } }));
