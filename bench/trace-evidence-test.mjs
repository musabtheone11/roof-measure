// Auto-traced quantities carry their own provenance (synthetic geometry only).
// A Solar trace fits planes to a dated, georeferenced height model. Each facet geometry / pitch / area and each line
// geometry / type / length it measured must pass the evidence audit; an inferred continuation stays an estimate; an
// unresolved item and undated imagery get no provenance; a later edit makes the record stale; the building selection
// is never self-certified (only the georeferenced scale is).
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const RM = createRequire(import.meta.url)('../roofmodel.js');
const src = fs.readFileSync(new URL('../autotrace.js', import.meta.url), 'utf8');
const ll = (x, y) => ({ lat: 30 + y / 110540, lng: -81 + x / 96000 });
const sq = (x0, y0, x1, y1) => [ll(x0, y0), ll(x1, y0), ll(x1, y1), ll(x0, y1)];
function fresh(date) {
  const state = {
    facets: [
      { modelId: 'F1', name: 'F1', auto: true, status: 'measured', pitch: 6, slope: 0.5, rms: 0.031, plane: [0, 0.5, 3], azimuth: 180, path: sq(0, 0, 10, 6) },
      { modelId: 'F2', name: 'F2', auto: true, status: 'inferred', pitch: 6, slope: 0.5, rms: 0.05, plane: [0, -0.5, 6], azimuth: 0, path: sq(0, 6, 10, 12), inferredSqft: 40 },
      { modelId: 'F3', name: 'F3', auto: true, status: 'unresolved', pitch: 6, slope: null, path: sq(10, 0, 14, 12) },
    ],
    edges: [
      { modelId: 'E1', type: 'ridge', autoType: 'ridge', status: 'measured', factor: 1, path: [ll(0, 6), ll(10, 6)] },
      { modelId: 'E2', type: 'eave', autoType: 'eave', status: 'inferred', factor: 1, path: [ll(0, 12), ll(10, 12)] },
      { modelId: 'E3', type: 'valley', autoType: 'valley', status: 'unresolved', factor: 1.2, path: [ll(10, 0), ll(10, 12)] },
    ],
    trace: { imageryDate: date, registration: { residualM: 0.012, toleranceM: 0.05 } },
  };
  const strip = (x) => { const { measurementEvidence, ...rest } = x; return { ...rest, measurementEvidence: measurementEvidence || null }; };
  const ctx = { RM, state, location: { hostname: 'synthetic.invalid' }, fetch: async () => ({ ok: false }),
    serialize: () => ({ address: 'synthetic', defaultPitch: 6, facets: state.facets.map(strip), edges: state.edges.map(strip), trace: state.trace }),
    reviewScopeRevision: (job) => RM.modelRevision({ facets: job.facets.map((f) => f.path), edges: job.edges.map((e) => e.path) }) };
  vm.createContext(ctx); vm.runInContext(src, ctx); return ctx;
}
const issues = (ctx, id, q) => RM.auditEvidence(ctx.serialize(), { selectionVerified: true, scaleVerified: true }).issues.filter((i) => i.id === id && (!q || i.quantity === q));

// 1. dated imagery: measured quantities pass, inferred ones are estimates, unresolved ones stay missing
let ctx = fresh({ year: 2016, month: 2, day: 11 });
assert.ok(ctx.rmAttachTraceEvidence() > 0);
for (const q of ['geometry', 'pitch', 'area']) assert.deepEqual(issues(ctx, 'F1', q), [], 'measured facet ' + q + ' passes the audit');
for (const q of ['geometry', 'type', 'length']) assert.deepEqual(issues(ctx, 'E1', q), [], 'measured line ' + q + ' passes the audit');
assert.ok(issues(ctx, 'F2').every((i) => i.code === 'inferred-quantity') && issues(ctx, 'F2').length === 3, 'inferred facet is an estimate, not a measurement');
assert.ok(issues(ctx, 'E2').every((i) => i.code === 'inferred-quantity'), 'inferred line is an estimate');
assert.equal(ctx.state.facets[2].measurementEvidence, undefined, 'no provenance invented for an unresolved facet');
assert.equal(ctx.state.edges[2].measurementEvidence, undefined, 'no provenance invented for an unresolved line');
assert.ok(issues(ctx, 'F3').some((i) => i.code === 'quantity-evidence'), 'unresolved facet stays missing evidence');
const ev = ctx.state.facets[0].measurementEvidence.pitch;
assert.equal(ev.date, '2016-02-11'); assert.match(ev.basis, /rms 0\.031 m/); assert.match(ev.source, /Solar/);

// 2. a later edit of the geometry makes the record stale, never silently valid
ctx.state.facets[0].path = sq(0, 0, 11, 6);
assert.ok(issues(ctx, 'F1', 'geometry').some((i) => i.code === 'stale-evidence'), 'edited outline -> stale geometry evidence');
assert.ok(issues(ctx, 'F1', 'area').some((i) => i.code === 'stale-evidence'), 'edited outline -> stale area evidence');

// 3. undated imagery gives no provenance at all
ctx = fresh(null); assert.equal(ctx.rmAttachTraceEvidence(), 0);
assert.ok(issues(ctx, 'F1').some((i) => i.code === 'quantity-evidence'), 'undated imagery: the measured facet is withheld');

// 4. scope: the georeferenced scale is recorded, the building selection is left to a person
ctx = fresh('2016-02-11'); ctx.rmAttachTraceEvidence();
const se = ctx.state.trace.scopeEvidence; assert.equal(se.scaleVerified, true); assert.equal(se.selectionVerified, false);
ctx = fresh('2016-02-11'); ctx.state.trace.registration.residualM = 0.2; ctx.rmAttachTraceEvidence();
assert.equal(ctx.state.trace.scopeEvidence, undefined, 'a registration residual over tolerance does not verify the scale');

// 5. backfill of a job saved before provenance existed: only output still exactly as the engine produced it
ctx = fresh('2016-02-11'); const S = ctx.state;
S.trace.raw = [{ structure: 1, facets: S.facets.map((f) => ({ pitch: f.pitch, status: f.status, path: f.path })), edges: S.edges.map((e) => ({ type: e.type, status: e.status, path: e.path })) }];
S.facets[1].path = sq(0, 6, 10, 13);                  // moved by hand after the trace (not flagged): must not inherit engine provenance
S.edges[0].type = 'hip';                              // reclassified by hand
ctx.rmAttachTraceEvidence({ backfill: true });
assert.ok(S.facets[0].measurementEvidence && S.facets[0].measurementEvidence.area, 'unedited engine facet gets its provenance back');
assert.equal(S.facets[1].measurementEvidence, undefined, 'a facet moved after the trace gets no engine provenance');
assert.equal(S.edges[0].measurementEvidence, undefined, 'a reclassified line gets no engine provenance');
assert.ok(S.edges[1].measurementEvidence, 'unedited engine line gets its provenance back');
ctx = fresh('2016-02-11'); assert.equal(ctx.rmAttachTraceEvidence({ backfill: true }), 0, 'no stored engine output: nothing is backfilled');
console.log('trace evidence: measured quantities carry dated provenance, estimates stay estimates, unresolved and undated stay withheld, edits go stale, selection left to a person; backfill only for unedited engine output');
