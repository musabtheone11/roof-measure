// node bench/wobble-run.mjs [--n 120] [--engine dir] | --job roof.json : outline wobble count (engine vs truth / one job)
import fs from 'node:fs';
import { wobble } from './wobble.mjs';
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const per = (t) => t === 'eave' || t === 'rake';
if (arg('job')) {
  const R = JSON.parse(fs.readFileSync(arg('job'), 'utf8')); const o = R.facets[0].path[0]; const kx = 111320 * Math.cos(o.lat * Math.PI / 180), ky = 110540;
  const lines = R.edges.filter((e) => per(e.type)).map((e) => e.path.map((p) => [(p.lng - o.lng) * kx, (p.lat - o.lat) * ky]));
  const w = wobble(lines); console.log(JSON.stringify({ outlineLines: lines.length, wobbles: w.length, turns: w.map((x) => +x.turn.toFixed(1)) }));
} else {
  const { summarizeGT, render, rng, randomHouse } = await import('./synth.mjs'); const { loadEngine, trace } = await import('./engine.mjs');
  const eng = arg('engine', null); const ctx = eng ? loadEngine(['autotrace.js', 'autotrace2.js', 'obstruction.js'].map((f) => eng + '/' + f)) : loadEngine();
  const t = { houses: 0, en: 0, gt: 0, housesWithWobble: 0 };
  for (let seed = 1; seed <= +arg('n', 120); seed++) {
    const r = rng(seed * 7919 + 13); const wings = randomHouse(r); let gt; try { gt = summarizeGT(wings); } catch { continue; }
    if (gt.minFacet < 0.6 || gt.sloped < 600) continue; const sc = render(wings, r); let res; try { res = trace(ctx, sc); } catch { continue; }
    const en = wobble(res.edges.filter((e) => per(e.type)).map((e) => e.line)), g = wobble(gt.edges.filter((e) => per(e.type)).map((e) => [e.p0, e.p1]));
    t.houses++; t.en += en.length; t.gt += g.length; if (en.length > g.length) t.housesWithWobble++;
  }
  console.log(JSON.stringify(t));
}
