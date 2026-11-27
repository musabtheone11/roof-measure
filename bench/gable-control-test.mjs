// Arithmetic control (examples/gable-control.json, illustrative): a symmetric gable, 20 ft eave to eave by 30 ft, level
// 30 ft ridge, two 6:12 planes, no cut-outs. Expected by hand: projected 600 ft2; sloped 600 x sqrt(1.25) = 670.82 ft2;
// ridge 30 ft counted once (shared edge, not per plane); rakes 4 x 10 x sqrt(1.25) = 44.72 ft; eaves 60 ft. Catches
// projected-vs-sloped mix-ups, unit conversion errors and shared-edge double counting.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const RM = createRequire(import.meta.url)('../roofmodel.js');
const job = JSON.parse(fs.readFileSync(new URL('../examples/gable-control.json', import.meta.url), 'utf8'));
const near = (a, b, tol, what) => assert.ok(Math.abs(a - b) <= tol, `${what}: ${a} vs ${b}`);
let plan = 0, sloped = 0; for (const f of job.facets) { const m = RM.facetMeasure(f); plan += m.plan; sloped += m.sloped; }
near(plan, 600, 0.01, 'projected area'); near(sloped, 600 * Math.sqrt(1.25), 0.01, 'sloped area');
const len = { eave: 0, rake: 0, ridge: 0 }; for (const e of job.edges) { const m = RM.lineMeasure(e, 6, null); len[e.type] += m.trueFt; }
near(len.ridge, 30, 0.01, 'ridge (shared edge counted once)'); near(len.eave, 60, 0.01, 'eaves'); near(len.rake, 40 * Math.sqrt(1.25), 0.01, 'rakes (true length)');
console.log(`gable control: ${plan.toFixed(2)} ft2 projected, ${sloped.toFixed(2)} ft2 sloped, ridge ${len.ridge.toFixed(2)} ft, rakes ${len.rake.toFixed(2)} ft, eaves ${len.eave.toFixed(2)} ft`);
