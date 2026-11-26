// Small-object absorption must not swallow real small facets (synthetic houses, no property data).
// absorbBumps() folds an object standing on a roof plane (a vent, an AC unit, debris, a DSM spike) into that plane. A
// blurred real hip-end, valley-side or dormer facet also fits its own plane poorly near its edges, but it is flat inside
// (small median residual) and turns away from the neighbour; the earlier rule absorbed such facets on these houses
// (house 13: 8 true facets traced as 7, ridge + hip 152 ft for 179 ft; house 43: 8 traced as 5).
import { loadEngine } from './engine.mjs';
import { runOne } from './run.mjs';
import assert from 'node:assert/strict';
const ctx = loadEngine();
for (const [seed, minFacets] of [[13, 8], [43, 7]]) {
  const r = runOne(ctx, seed);
  const gt = r.gt_ridge + r.gt_hip, en = r.en_ridge + r.en_hip;
  assert.ok(r.facetsEN >= minFacets, `house ${seed}: ${r.facetsEN} facets traced, at least ${minFacets} expected (${r.facetsGT} true)`);
  assert.ok(Math.abs(en - gt) / gt <= 0.1, `house ${seed}: ridge + hip ${en.toFixed(0)} ft vs ${gt.toFixed(0)} ft true`);
  console.log(`ok house ${seed}: ${r.facetsEN} of ${r.facetsGT} facets, ridge + hip ${en.toFixed(0)} / ${gt.toFixed(0)} ft`);
}
// the object rule itself: thresholds that keep a real facet out (documented in AT2)
const AT2 = ctx.AT2 || (ctx.__get && ctx.__get('AT2'));
if (AT2) { assert.ok(AT2.bumpObjectMed > 0 && AT2.bumpObjectAng > 0, 'object rule has its flatness and orientation tests'); }
console.log('bump absorption keeps blurred real facets');
