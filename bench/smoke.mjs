// node smoke.mjs  -> exits 1 if a plain roof does not trace exactly (facet count, every line within 3% / 3 ft, area within 1.5%)
import { summarizeGT, render, rng } from './synth.mjs';
import { loadEngine, trace } from './engine.mjs';
import { summarizeEngine, TYPES } from './score.mjs';
const W = (o) => ({ cx: 0, cy: 0, th: 0.3, L: 20, W: 10, kind: 'hip', s: 0.5, sEnd: 0.5, eaveZ: 3, ...o });
const c = Math.cos(0.3), s = Math.sin(0.3);
const cases = {
  hip: [W()], gable: [W({ kind: 'gable' })], 'hip 12/12': [W({ s: 1, sEnd: 1 })],
  'L hip': [W(), W({ cx: 7 * c - 7 * s, cy: 7 * s + 7 * c, th: 0.3 + Math.PI / 2, L: 10, W: 8 })],
};
const ctx = loadEngine(); let fail = 0;
for (const [k, wings] of Object.entries(cases)) for (const seed of [5, 6, 7]) {
  const gt = summarizeGT(wings); const en = summarizeEngine(trace(ctx, render(wings, rng(seed), { clutter: false, trees: 0, noise: 0.02, blur: 1, hard: false })));
  const bad = [];
  if (en.facetCount !== gt.facetCount) bad.push(`facets ${en.facetCount}/${gt.facetCount}`);
  if (Math.abs(en.sloped - gt.sloped) / gt.sloped > 0.015) bad.push(`area ${en.sloped.toFixed(0)}/${gt.sloped.toFixed(0)}`);
  for (const t of TYPES) { const g = gt.byType[t] || 0, e = en.byType[t] || 0; if (Math.abs(e - g) > Math.max(3, 0.03 * g)) bad.push(`${t} ${e.toFixed(0)}/${g.toFixed(0)}`); }
  console.log((bad.length ? 'FAIL ' : 'ok   ') + k.padEnd(10) + ' seed ' + seed + ' ' + bad.join(', ')); if (bad.length) fail++;
}
process.exit(fail ? 1 : 0);
