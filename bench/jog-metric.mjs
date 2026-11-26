// Uneven-edge metric on synthetic houses (known geometry): spurious short pieces and bends on roof outline lines.
//   node bench/jog-metric.mjs [--n 120] [--engine dir]
// For each house: engine perimeter lines (eave / rake) shorter than 3 ft, perimeter direction changes < 25 deg that make a
// visible jog (step), and the same counts for the true roof (wings that meet create real jogs). Prints per-house rows on
// demand and totals. Deterministic; no property data.
import { summarizeGT, render, rng, randomHouse } from './synth.mjs';
import { loadEngine, trace } from './engine.mjs';
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const n = +arg('n', 120), eng = arg('engine', null);
const ctx = eng ? loadEngine(['autotrace.js', 'autotrace2.js', 'obstruction.js'].map((f) => eng + '/' + f)) : loadEngine();
const FT = 3.28084, len = (L) => { let d = 0; for (let i = 1; i < L.length; i++) d += Math.hypot(L[i][0] - L[i - 1][0], L[i][1] - L[i - 1][1]); return d; };
// bends inside one line: max distance of an interior vertex from the line's chord (a straight run has 0)
const bend = (L) => { const a = L[0], b = L[L.length - 1], dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1; let m = 0; for (const p of L.slice(1, -1)) m = Math.max(m, Math.abs((p[0] - a[0]) * dy - (p[1] - a[1]) * dx) / l); return m; };
let tot = { houses: 0, enShort: 0, gtShort: 0, enOutline: 0, gtOutline: 0, bent: 0, enShortFt: 0 }; const rows = [];
for (let seed = 1; seed <= n; seed++) {
  const r = rng(seed * 7919 + 13); const wings = randomHouse(r); let gt; try { gt = summarizeGT(wings); } catch { continue; }
  if (gt.minFacet < 0.6 || gt.sloped < 600) continue; const sc = render(wings, r); let res; try { res = trace(ctx, sc); } catch { continue; }
  const per = (t) => t === 'eave' || t === 'rake';
  const en = res.edges.filter((e) => per(e.type)); const gl = (gt.edges || gt.lines || []).filter((e) => per(e.type));
  const enShort = en.filter((e) => len(e.line) * FT < 3), gtShort = gl.filter((e) => e.plan * FT < 3);
  const bent = en.filter((e) => e.line.length > 2 && bend(e.line) > 0.15).length;
  tot.houses++; tot.enShort += enShort.length; tot.gtShort += gtShort.length; tot.enOutline += en.length; tot.gtOutline += gl.length; tot.bent += bent; tot.enShortFt += enShort.reduce((a, e) => a + len(e.line) * FT, 0);
  rows.push({ seed, enOutline: en.length, gtOutline: gl.length, enShort: enShort.length, gtShort: gtShort.length, bent });
}
if (process.argv.includes('--rows')) for (const r of rows) console.log(JSON.stringify(r));
console.log(JSON.stringify(tot));
