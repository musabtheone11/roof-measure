// node reconciletest.mjs -> exits 1 if the independent PDF reconciliation stops catching inconsistent or stale reports.
// Uses the text of the illustrative example's report (fixtures-data/residential-report.txt, extracted with pdftotext -layout)
// and the example job, so it runs without a browser or an API key. The model numbers come from roofmodel.js, not from the
// PDF generator.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { parseReportText, modelFromRun, reconcile, evidenceContextFromJob } from '../tools/dev/pdf-reconcile.mjs';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RM = createRequire(import.meta.url)('../roofmodel.js');
let fail = 0; const ok = (name, cond, got) => { console.log((cond ? 'ok   ' : 'FAIL ') + name + (cond ? '' : '  got ' + JSON.stringify(got))); if (!cond) fail++; };

// the model the way computeTotals() builds it, from the saved job alone
function totalsOf(job) {
  const facets = job.facets.map((f) => { const m = RM.facetMeasure(f); return { name: f.name, pitch: f.pitch, plan: m.plan, sloped: m.sloped, excluded: !!f.excluded, structure: f.structure || 1, status: RM.statusOf(f), inferredSqft: f.inferredSqft || 0, edited: !!f.edited, basis: m.basis, slope12: m.slope12 }; });
  const pitchOf = (s) => (job.facets.find((f) => (f.structure || 1) === s) || {}).pitch;
  const edges = job.edges.map((e) => { const m = RM.lineMeasure(e, pitchOf(e.structure || 1), job.defaultPitch); return { type: e.type, planFt: m.planFt, trueFt: m.trueFt, factor: m.factor, pitch: m.pitch, structure: e.structure || 1, status: RM.statusOf(e) }; });
  const byType = {}; for (const e of edges) { byType[e.type] = byType[e.type] || { planFt: 0, trueFt: 0, count: 0 }; byType[e.type].planFt += e.planFt; byType[e.type].trueFt += e.trueFt; byType[e.type].count++; }
  for (const t of ['eave', 'rake', 'hip', 'ridge', 'valley', 'step', 'wall', 'transition', 'parapet']) byType[t] = byType[t] || { planFt: 0, trueFt: 0, count: 0 };
  const sl = facets.filter((f) => !f.excluded).reduce((a, f) => a + f.sloped, 0); const structures = [...new Set(facets.map((f) => f.structure))].map((i) => ({ index: i, sloped: facets.filter((f) => f.structure === i && !f.excluded).reduce((a, f) => a + f.sloped, 0) }));
  const ab = { measured: 0, inferred: 0, unresolved: 0 }; for (const f of facets) if (!f.excluded) ab[f.status] += f.sloped;
  return { slopedSqft: sl, facets, edges, byType, structures, areaByStatus: ab, status: 'COMPLETE' };
}
const job = JSON.parse(fs.readFileSync(path.join(ROOT, 'examples', 'residential-study.json'), 'utf8'));
const text = fs.readFileSync(path.join(ROOT, 'bench', 'fixtures-data', 'residential-report.txt'), 'utf8');
const P = parseReportText(text);
ok('parser reads the status pill, the band, the takeoff rows and both schedules', P.status === 'ILLUSTRATIVE' && P.band.net === 1714.73 && P.takeoff.length === 3 && P.facets.length === 6 && P.edges.length === 16, { status: P.status, band: P.band, rows: P.takeoff.length, facets: P.facets.length, edges: P.edges.length });
const good = reconcile(P, modelFromRun(totalsOf(job), job));
ok('the illustrative report reconciles with its model (' + good.checks.length + ' checks)', good.ok, good.checks.filter((c) => !c.ok));
// a PDF with inconsistent dimensions: one printed facet area altered
const bad1 = reconcile(parseReportText(text.replace('469.57', '496.57')), modelFromRun(totalsOf(job), job));
ok('an altered facet area is caught', !bad1.ok && bad1.checks.some((c) => !c.ok && /facet F1 area|facet areas sum/.test(c.name)), bad1.checks.filter((c) => !c.ok).map((c) => c.name));
// a printed total that no longer matches the schedule
const bad2 = reconcile(parseReportText(text.replace('1,714.73 ft²', '1,741.73 ft²')), modelFromRun(totalsOf(job), job));
ok('an altered net area is caught', !bad2.ok && bad2.checks.some((c) => !c.ok && c.name === 'net sloped area'), bad2.checks.filter((c) => !c.ok).map((c) => c.name));
// stale measurements after editing: the model changes (garage pitch 4/12 -> 7/12) but the PDF text is the old one
const edited = JSON.parse(JSON.stringify(job)); for (const f of edited.facets) if (f.structure === 2) f.pitch = 7;
const stale = reconcile(P, modelFromRun(totalsOf(edited), edited));
ok('a report printed before an edit no longer reconciles with the edited model', !stale.ok && stale.checks.some((c) => !c.ok && /net sloped area|facet F5 area|building 2/.test(c.name)), stale.checks.filter((c) => !c.ok).map((c) => c.name));
// an edge dropped from the model (double count the other way) is caught by the schedule multiset
const fewer = JSON.parse(JSON.stringify(job)); fewer.edges.pop();
const miss = reconcile(P, modelFromRun(totalsOf(fewer), fewer));
ok('a schedule line without a model line is caught', !miss.ok && miss.checks.some((c) => !c.ok && c.name === 'edge schedule matches the model lines'), miss.checks.filter((c) => !c.ok).map((c) => c.name));
const summaryBlock = `\fMeasurement summary
Net sloped area                 1,714.73
Measured/modelled subtotal      1,714.73       Inferred estimate area      0.00
Linear measurement totals
Eave       184' 0"       Valley         0' 0"
Hip         84' 0"       Ridge         36' 0"
Rake        33' 9"       Wall flashing  0' 0"
Step flashing  0' 0"     Transition     0' 0"
Parapet wall   0' 0"     Unspecified    0' 0"
Pitch distribution
`;
const summaryGood = reconcile(parseReportText(text + summaryBlock), modelFromRun(totalsOf(job), job));
ok('measurement summary independently reconciles area and all linear categories', summaryGood.ok, summaryGood.checks.filter(c => !c.ok));
const summaryBad = reconcile(parseReportText(text + summaryBlock.replace('1,714.73', '1,700.00')), modelFromRun(totalsOf(job), job));
ok('a corrupted summary total is caught even when page one and schedules match', summaryBad.checks.some(c => !c.ok && c.name === 'summary eligible sloped area'), summaryBad.checks.filter(c => !c.ok));
const reviewModel = { ...modelFromRun(totalsOf(job), job), status: 'REVIEW REQUIRED' };
const reviewText = text.replace('ILLUSTRATIVE', 'REVIEW REQUIRED');
const blankAbsent = summaryBlock.replace(/(Valley|Wall flashing|Step flashing|Transition|Parapet wall|Unspecified)(\s+)0' 0"/g, '$1$2');
const missingScope = reconcile(parseReportText(reviewText + blankAbsent), reviewModel);
ok('review summary leaves absent edge categories blank instead of asserting zero', missingScope.ok, missingScope.checks.filter(c => !c.ok));
const inventedZeros = reconcile(parseReportText(reviewText + summaryBlock), reviewModel);
ok('review summary rejects zeros for edge categories outside the measured scope', inventedZeros.checks.some(c => !c.ok && c.name === 'summary absent valley scope stays blank'), inventedZeros.checks.filter(c => !c.ok));
const measuredJob = structuredClone(job); measuredJob.source = null;
measuredJob.facets.forEach((f, i) => { f.modelId = 'F' + (i + 1); });
measuredJob.edges.forEach((e, i) => { e.modelId = 'E' + (i + 1); });
const unstamped = modelFromRun(totalsOf(measuredJob), measuredJob);
ok('legacy measured flags with no provenance produce unsupported expected quantities', unstamped.allUnsupported && unstamped.facets.every(f => f.unsupported) && unstamped.edges.every(e => e.status === 'unresolved'), { unsupported: unstamped.allUnsupported });
const legacyFigures = reconcile({ ...P, status: 'REVIEW REQUIRED' }, unstamped);
ok('legacy raw measured figures printed without provenance are rejected even with a review label', legacyFigures.checks.some(c => !c.ok && c.name === 'unsupported takeoff subtotal and squares stay blank'));
for (const item of [...measuredJob.facets, ...measuredJob.edges]) {
  const kinds = measuredJob.facets.includes(item) ? ['geometry', 'pitch', 'area'] : ['geometry', 'type', 'length'];
  item.measurementEvidence = Object.fromEntries(kinds.map(quantity => [quantity, { status: 'measured', source: 'Synthetic survey fixture', date: '2026-11-25', basis: 'Analytic polygon and assigned pitch', revision: RM.evidenceRevision(item, quantity, measuredJob) }]));
}
const scopePick = x => ({ modelId: x.modelId, path: x.path, structure: x.structure || 1, level: x.level || 1, omit: !!x.omit, excluded: !!x.excluded });
measuredJob.trace = { scopeEvidence: { source: 'Synthetic fixture', date: '2026-11-25', basis: 'Known coordinate frame and selected fixture structure', selectionVerified: true, scaleVerified: true,
  revision: RM.modelRevision({ address: measuredJob.address, location: measuredJob.location, facets: measuredJob.facets.map(scopePick), edges: measuredJob.edges.map(scopePick) }) } };
const stamped = modelFromRun(totalsOf(measuredJob), measuredJob);
ok('current source and scope revisions support quantities independently of the PDF', stamped.audit.ok && !stamped.allUnsupported && stamped.facets.every(f => f.status === 'measured'), stamped.audit.issues);
measuredJob.facets[0].measurementEvidence.area.status = 'inferred';
const estimateProof = modelFromRun(totalsOf(measuredJob), measuredJob);
ok('valid inferred provenance remains an estimate, not an unresolved blank', estimateProof.facets[0].status === 'inferred' && !estimateProof.facets[0].unsupported && estimateProof.estimated > 0, estimateProof.facets[0]);
const changedPitch = structuredClone(measuredJob); changedPitch.facets[0].pitch += 1;
const staleProof = modelFromRun(totalsOf(changedPitch), changedPitch);
ok('a changed quantity invalidates its old evidence while scope geometry can remain current', staleProof.facets[0].unsupported && staleProof.audit.issues.some(i => i.code === 'stale-evidence') && evidenceContextFromJob(changedPitch).selectionVerified, staleProof.audit.issues.map(i => i.code));
const changedScope = structuredClone(measuredJob); changedScope.location.lat += 0.001;
ok('moved property context invalidates the building-selection and scale stamps (report-level review), not per-quantity provenance', !evidenceContextFromJob(changedScope).selectionVerified && !modelFromRun(totalsOf(changedScope), changedScope).allUnsupported);
const invalidScope = structuredClone(measuredJob); invalidScope.trace.scopeEvidence.date = '2026-02-30';
ok('invalid scope dates cannot validate a saved provenance revision', !evidenceContextFromJob(invalidScope).scaleVerified);
const falseZero = reconcile({ ...P, status: 'REVIEW REQUIRED', band: { confirmed: 0, squares: 0 } }, unstamped);
ok('zero is rejected where no quantity has supporting provenance', falseZero.checks.some(c => !c.ok && c.name === 'unsupported takeoff subtotal and squares stay blank'));
const legacyReference = structuredClone(measuredJob);
delete legacyReference.edges[0].modelId;
legacyReference.edges[0].ref = 'D1'; legacyReference.edges[0].name = 'Decorative alias';
legacyReference.edges[0].measurementEvidence.geometry.status = 'unresolved';
legacyReference.trace.scopeEvidence.revision = RM.modelRevision({ address: legacyReference.address, location: legacyReference.location, facets: legacyReference.facets.map(scopePick), edges: legacyReference.edges.map(scopePick) });
const referenced = modelFromRun(totalsOf(legacyReference), legacyReference);
ok('legacy reference IDs retain their evidence failures despite decorative item names', referenced.edges[0].status === 'unresolved' && referenced.audit.issues.some(i => i.id === 'D1'), referenced.audit.issues.map(i => i.id));
const pitchOnly = parseReportText('REVIEW REQUIRED\n\fFacet areas & pitches\nF1   House       6 / 12\n');
const unknownArea = structuredClone(measuredJob); unknownArea.facets[0].measurementEvidence.area.status = 'unresolved';
const areaModel = modelFromRun(totalsOf(unknownArea), unknownArea);
const areaCheck = reconcile(pitchOnly, areaModel);
ok('a supported pitch remains verifiable when its facet area is unresolved', areaCheck.checks.some(c => c.ok && c.name === 'facet F1 unsupported -> blank') && areaCheck.checks.some(c => c.ok && c.name === 'facet F1 independently supported pitch'));
unknownArea.facets[0].measurementEvidence.pitch.status = 'unresolved';
const pitchCheck = reconcile(pitchOnly, modelFromRun(totalsOf(unknownArea), unknownArea));
ok('an unsupported pitch cannot be printed beside a correctly blank area', pitchCheck.checks.some(c => !c.ok && c.name === 'facet F1 unsupported pitch -> blank'));
// (page-format cases of the earlier handoff renderer are not used: the plan-first layout's own format is covered above and by run-app --strict)
process.exit(fail ? 1 : 0);
