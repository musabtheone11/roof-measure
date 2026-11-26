import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { analyzeRoofModel } from '../server/geometry.mjs';
const { prepareAIReviewReport } = createRequire(import.meta.url)('../ai-report.js');

export function fixture(overrides = {}) {
  const pitch = { rise: 6, run: 12, source: 'Analytic synthetic pitch', uncertainty: .1, status: 'user-provided' };
  const model = { outline: [[100, 120], [500, 120], [500, 360], [100, 360]], facets: [
    { id: 'P1', polygon: [[100, 120], [500, 120], [500, 240], [100, 240]], status: 'inferred', pitch },
    { id: 'P2', polygon: [[100, 240], [500, 240], [500, 360], [100, 360]], status: 'inferred', pitch }],
  edges: [{ id: 'top', type: 'eave', points: [[100, 120], [500, 120]], status: 'inferred' }, { id: 'ridge', type: 'ridge', points: [[100, 240], [500, 240]], status: 'inferred' },
    { id: 'internal', type: 'unspecified', points: [[200, 180], [400, 180]], status: 'unresolved' }],
  annotations: [{ id: 'printed', kind: 'dimension', text: '40 ft printed on source; not independently verified', status: 'measured',
    region: [[120, 90], [186, 90], [186, 108], [120, 108]] }] };
  const metadata = { width: 640, height: 480, source: 'Synthetic report fixture', date: '2026-11-25', view: 'orthographic', purpose: 'roof-sketch', sourcePage: 1, rotation: 0,
    calibration: { start: [100, 120], end: [500, 120], lengthFt: 40, source: 'Independent analytic calibration', date: '2026-11-25', verified: true } };
  Object.assign(metadata, overrides.metadata || {});
  if (overrides.perspective) model.measurementRestrictions = { perspective: true, reasons: ['Synthetic perspective finding'] };
  if (overrides.boundaryReview) { model.facets[0].status = 'user-provided'; model.facets[0].geometryReview = { status: 'user-provided', source: 'Local visual review', date: '2026-11-25', note: 'Confirmed visible synthetic upper boundary; no independent certification.' }; model.edges[0].geometryReview = { status: 'invalidated', source: 'Previous local review', date: '2026-11-25', note: 'Prior edge confirmation invalidated after edit.' }; }
  if (overrides.obstruction) { model.edges[2].type = 'obstruction'; model.edges[2].status = 'user-provided'; }
  if (overrides.unresolvedFacet) model.facets[0].status = 'unresolved';
  if (overrides.legacyStatus) model.facets[0].status = 'measured';
  if (overrides.missingOutline) model.outline = [];
  if (overrides.unknownPitch) delete model.facets[0].pitch;
  const revision = 7, latestResult = analyzeRoofModel(model, metadata, { revision });
  return { app: 'roof-measure-ai-review', version: 2, revision, status: 'REVIEW REQUIRED', imageMetadata: metadata, model,
    measurementSnapshot: { revision, model: structuredClone(model), imageMetadata: structuredClone(metadata) }, latestResult, measurementStatus: 'current', corrections: [], previousReviews: [] };
}

const p = fixture(), report = prepareAIReviewReport(p);
assert(Math.abs(report.projected * 10.763910416709722 - 960) < 1e-8);
assert(Math.abs(report.sloped * 10.763910416709722 - 960 * Math.sqrt(1.25)) < 1e-8);
assert(Math.abs(report.edges[0].horizontal / .3048 - 40) < 1e-8);
assert.equal(report.edges[0].sloped, null);
assert.equal(report.status, 'SOURCE IMAGE REVIEW');
assert.equal(report.annotations[0].status, 'SOURCE-REPORTED / UNVERIFIED');
assert.equal(report.annotations[0].text, p.model.annotations[0].text);
assert.deepEqual(report.annotations[0].bounds, [120, 90, 186, 108]);
assert.equal(prepareAIReviewReport(fixture({ unknownPitch: true })).sloped, null);
for (const data of [fixture({ perspective: true }), fixture({ metadata: { sourceRestrictions: {perspective:true,reasons:['Prior source warning']} } }), fixture({ metadata: { view: 'oblique' } }), fixture({ metadata: { calibration: null } })]) {
  const r = prepareAIReviewReport(data); assert.equal(r.projected, null); assert.equal(r.sloped, null); assert(r.edges.every(e => e.horizontal === null));
}
const geographic = fixture({ metadata: { calibration: null, georef: { verified: true, source: 'Synthetic local georeference', date: '2026-11-25', crs: 'LOCAL_EN_METERS', affine: [.03, 0, 0, 0, .03, 0] } } });
assert(geographic.latestResult.measurements.projectedAreaM2 > 0);
assert.equal(prepareAIReviewReport(geographic).projected, null, 'This source-image PDF does not duplicate the geographic projection/report path.');
for (const mutate of [x => x.revision++, x => x.measurementStatus = 'stale / withheld', x => x.imageMetadata.calibration.lengthFt++, x => x.model.outline[0][0]++, x => x.latestResult.model.originalProposal.outline[0][0]++]) {
  const stale = structuredClone(p); mutate(stale); assert.throws(() => prepareAIReviewReport(stale), /stale|different|differs|Recalculate/);
}
const wrongArea = structuredClone(p); wrongArea.latestResult.measurements.facets[0].projectedAreaM2 += 1;
assert.throws(() => prepareAIReviewReport(wrongArea), /Inconsistent projected facet area/);
const wrongTotal = structuredClone(p); wrongTotal.latestResult.measurements.projectedAreaM2 += 1;
assert.throws(() => prepareAIReviewReport(wrongTotal), /Inconsistent roof total/);
const bent = fixture(); bent.model.edges[0].points.push([500, 360]); bent.measurementSnapshot.model = structuredClone(bent.model); bent.latestResult = analyzeRoofModel(bent.model, bent.imageMetadata, { revision: bent.revision });
assert(Math.abs(prepareAIReviewReport(bent).edges[0].pixels - 640) < 1e-9, 'A bent path is measured along both segments.');
console.log('AI review report: current snapshot, independent calibrated quantities, unknown/perspective withholding, annotations and stale/altered values pass.');

const missingOutline = prepareAIReviewReport(fixture({ missingOutline: true }));
assert.equal(missingOutline.geometryOK, false); assert.equal(missingOutline.projected, null); assert.equal(missingOutline.sloped, null); assert(missingOutline.edges.every(e => e.horizontal === null));

for (const flags of [{ unresolvedFacet: true }, { legacyStatus: true }]) { const r = prepareAIReviewReport(fixture(flags)); assert.equal(r.facets[0].status, 'unresolved'); assert.equal(r.facets[0].projected, null); assert(r.facets[0].pixels2 > 0); assert(r.facets[1].projected > 0); assert.equal(r.projected, null); assert.equal(r.edges[2].horizontal, null); assert(r.edges[2].pixels > 0); }
const sourceRestricted = prepareAIReviewReport(fixture({ metadata: { sourceRestrictions: { perspective: true } } }));
assert.equal(sourceRestricted.restricted, true); assert.equal(sourceRestricted.projected, null);
const promoted = fixture({ unresolvedFacet: true }); promoted.latestResult.measurements.facets[0].status = 'inferred';
assert.throws(() => prepareAIReviewReport(promoted), /geometry status differs/);
const unsupportedArea = fixture({ unresolvedFacet: true }); unsupportedArea.latestResult.measurements.facets[0].projectedAreaM2 = 44;
assert.throws(() => prepareAIReviewReport(unsupportedArea), /unresolved facet has a physical quantity/);
const unsupportedEdge = fixture(); unsupportedEdge.latestResult.measurements.edges[2].horizontalLengthM = 6.096;
assert.throws(() => prepareAIReviewReport(unsupportedEdge), /unresolved, unspecified or obstruction edge has a physical quantity/);

const obstruction = fixture({ obstruction: true }); assert.equal(prepareAIReviewReport(obstruction).edges[2].horizontal, null); obstruction.latestResult.measurements.edges[2].horizontalLengthM = 6.096; assert.throws(() => prepareAIReviewReport(obstruction), /obstruction edge has a physical quantity/);
const reviews = prepareAIReviewReport(fixture({ boundaryReview: true })).reviewRecords; assert.equal(reviews.length, 2); assert.match(reviews[0].note, /Confirmed visible/); assert.match(reviews[0].status, /NOT INDEPENDENTLY VERIFIED/); assert.match(reviews[1].status, /INVALIDATED/);
