// node confusion.mjs N [engineDir]  -> feet of each GT line type traced as each engine type (geometric matching)
import { summarizeGT, render, rng, randomHouse, FT } from './synth.mjs';
import { loadEngine, trace } from './engine.mjs';
const N = +process.argv[2] || 300, dir = process.argv[3], trees = process.argv[4] !== 'notrees';
const ctx = dir ? loadEngine(['autotrace.js', 'autotrace2.js'].map((f) => dir + '/' + f)) : loadEngine();
const M = {}; const add = (g, e, v) => { M[g] = M[g] || {}; M[g][e] = (M[g][e] || 0) + v; };
const segDist = (p, a, b) => { const d = [b[0] - a[0], b[1] - a[1]]; const L2 = d[0] ** 2 + d[1] ** 2 || 1e-12; let t = ((p[0] - a[0]) * d[0] + (p[1] - a[1]) * d[1]) / L2; t = Math.max(0, Math.min(1, t)); return Math.hypot(p[0] - a[0] - t * d[0], p[1] - a[1] - t * d[1]); };
let n = 0;
for (let seed = 1; n < N; seed++) {
  const r = rng(seed * 7919 + 13); const wings = randomHouse(r); let gt; try { gt = summarizeGT(wings); } catch { continue; }
  if (gt.minFacet < 0.6 || gt.sloped < 600) continue;
  const sc = render(wings, r, trees ? {} : { trees: 0 }); let res; try { res = trace(ctx, sc); } catch { continue; } n++;
  const G = gt.edges.map((e) => ({ ...e, d: [(e.p1[0] - e.p0[0]), (e.p1[1] - e.p0[1])] }));
  const E = []; for (const e of res.edges) for (let i = 1; i < e.line.length; i++) E.push({ type: e.type, a: e.line[i - 1], b: e.line[i] });
  const match = (p, dir, list, ga, gb, want) => { let best = null, bd = 0.7, same = null, sd = 0.7; for (const s of list) { const a = ga(s), b = gb(s); const d = [b[0] - a[0], b[1] - a[1]]; const L = Math.hypot(...d) || 1e-9; if (Math.abs(d[0] * dir[1] - d[1] * dir[0]) / L > 0.35) continue; const dd = segDist(p, a, b); if (dd < bd) { bd = dd; best = s; } if (s.type === want && dd < sd) { sd = dd; same = s; } } return same || best; };
  // GT -> engine (recall view): sample along GT edges
  for (const g of G) { const L = Math.hypot(...g.d); if (L < 1e-3) continue; const u = [g.d[0] / L, g.d[1] / L]; const k = Math.max(1, Math.round(L / 0.25)); const f = g.len / g.plan * FT;
    for (let i = 0; i < k; i++) { const p = [g.p0[0] + g.d[0] * (i + 0.5) / k, g.p0[1] + g.d[1] * (i + 0.5) / k]; const m = match(p, u, E, (s) => s.a, (s) => s.b, g.type); add(g.type, m ? m.type : 'MISSED', L / k * f); } }
  // engine -> GT (phantoms)
  for (const s of E) { const d = [s.b[0] - s.a[0], s.b[1] - s.a[1]]; const L = Math.hypot(...d); if (L < 1e-3) continue; const u = [d[0] / L, d[1] / L]; const k = Math.max(1, Math.round(L / 0.25));
    for (let i = 0; i < k; i++) { const p = [s.a[0] + d[0] * (i + 0.5) / k, s.a[1] + d[1] * (i + 0.5) / k]; const m = match(p, u, G, (g) => g.p0, (g) => g.p1, s.type); if (!m) add('PHANTOM', s.type, L / k * FT); } }
}
const cols = ['eave', 'rake', 'ridge', 'hip', 'valley', 'step', 'wall', 'transition', 'unspecified', 'MISSED'];
console.log('GT\\EN'.padEnd(11) + cols.map((c) => c.slice(0, 6).padStart(8)).join('') + '   correct%');
for (const g of [...cols.slice(0, 8), 'PHANTOM']) { const row = M[g] || {}; const tot = Object.values(row).reduce((a, b) => a + b, 0); console.log(g.padEnd(11) + cols.map((c) => String(Math.round(row[c] || 0)).padStart(8)).join('') + (g !== 'PHANTOM' && tot ? ((row[g] || 0) / tot * 100).toFixed(1).padStart(9) : '')); }
