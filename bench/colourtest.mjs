// node colourtest.mjs  -> exits 1 if the roof's colour changes what is traced.
// The canopy test uses colour. A tan, olive or weathered-wood roof must trace like a grey one: same facets, same area, no
// "tree over the roof" flags on a roof with no trees; and a tree over a warm roof must be handled as well as over a grey one.
import { summarizeGT, render, rng, randomHouse } from './synth.mjs';
import { loadEngine, trace } from './engine.mjs';
import { summarizeEngine } from './score.mjs';
const COLOURS = { grey: [118, 116, 124], tan: [181, 166, 137], 'warm grey': [140, 130, 115], olive: [128, 124, 108], 'red-brown': [130, 84, 70], charcoal: [58, 58, 62] };
const ctx = loadEngine(); let fail = 0;
const houses = (seeds) => seeds.map((seed) => { const r = rng(seed * 7919 + 13); const wings = randomHouse(r); let gt = null; try { gt = summarizeGT(wings); } catch (_) { /* skip */ } return { seed, wings, gt }; }).filter((q) => q.gt && q.gt.minFacet >= 0.6 && q.gt.sloped >= 600);
const run = (set, opt) => { const out = {}; for (const [name, rc] of Object.entries(COLOURS)) { let facets = 0, err = 0, flagged = 0, trees = 0, n = 0;
    for (const q of set) { const res = trace(ctx, render(q.wings, rng(q.seed * 7919 + 14), { ...opt, roofColor: rc })); const en = summarizeEngine(res, 6, true); n++; facets += en.facetCount; err += Math.abs(en.sloped - q.gt.sloped) / q.gt.sloped * 100;
      if (res.facets.some((f) => f.status !== 'measured') || (res.obstruction && res.obstruction.hiddenZones && res.obstruction.hiddenZones.length)) flagged++; trees += res.obstruction ? res.obstruction.trees.filter((t) => t.kind === 'overlap').length : 0; }
    out[name] = { n, facets, err: err / n, flagged, trees }; } return out; };
const clear = run(houses(Array.from({ length: 22 }, (_, i) => i + 1)).slice(0, 14), { trees: 0 });
console.log('No trees (roof clutter on): facets, mean abs area error, houses flagged, trees reported over the roof');
for (const [k, v] of Object.entries(clear)) { const bad = v.facets < clear.grey.facets * 0.97 || v.err > clear.grey.err + 0.6 || v.flagged > clear.grey.flagged || v.trees > clear.grey.trees; if (bad) fail++; console.log((bad ? 'FAIL ' : 'ok   ') + k.padEnd(10), String(v.facets).padStart(4), v.err.toFixed(2).padStart(6) + '%', String(v.flagged).padStart(3), String(v.trees).padStart(3)); }
const tree = run(houses(Array.from({ length: 30 }, (_, i) => i + 40)).slice(0, 14), { trees: 2 });
console.log('Two trees: facets, mean abs area error, houses flagged, trees reported over the roof');
for (const [k, v] of Object.entries(tree)) { const bad = v.err > tree.grey.err + 1.5; if (bad) fail++; console.log((bad ? 'FAIL ' : 'ok   ') + k.padEnd(10), String(v.facets).padStart(4), v.err.toFixed(2).padStart(6) + '%', String(v.flagged).padStart(3), String(v.trees).padStart(3)); }
process.exit(fail ? 1 : 0);
