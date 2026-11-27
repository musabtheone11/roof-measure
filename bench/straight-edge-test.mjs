// Uneven roof edges (synthetic houses with known straight eaves and rakes; no property data).
// The tracer fits each outline piece to its own pixels, so a straight eave split at a hip foot, a T junction with a
// height break or a blur-rounded corner came out bent by 3-25 degrees at each joint ("uneven edges" in the sketch and
// the PDF). These houses have perfectly straight outline runs; before the fix they showed 2, 2, 7 and 3 shallow kinks.
// The intentional-irregularity controls are fixtures D13 (a real 0.6 m eave offset survives) and D15 (real corner cuts
// stay diagonal) in fixtures.mjs.
import assert from 'node:assert/strict';
import { summarizeGT, render, rng, randomHouse } from './synth.mjs';
import { loadEngine, trace } from './engine.mjs';
import { wobble } from './wobble.mjs';
const ctx = loadEngine(); const per = (e) => e.type === 'eave' || e.type === 'rake';
for (const seed of [12, 13, 47, 58]) {
  const r = rng(seed * 7919 + 13); const wings = randomHouse(r); const gt = summarizeGT(wings); const res = trace(ctx, render(wings, r));
  const truth = wobble(gt.edges.filter(per).map((e) => [e.p0, e.p1])).length, got = wobble(res.edges.filter(per).map((e) => e.line));
  assert.equal(truth, 0, 'fixture house ' + seed + ' has straight outline runs');
  assert.equal(got.length, 0, `house ${seed}: ${got.length} shallow kinks in straight outline runs (${got.map((k) => k.turn.toFixed(1) + ' deg').join(', ')})`);
  console.log(`ok house ${seed}: straight outline runs traced straight`);
}
console.log('straight eaves and rakes stay straight');
