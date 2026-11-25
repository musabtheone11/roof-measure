// node reconciletest.mjs -> exits 1 if the independent PDF reconciliation stops catching inconsistent or stale reports.
// Uses the text of the illustrative example's report (fixtures-data/residential-report.txt, extracted with pdftotext -layout)
// and the example job, so it runs without a browser or an API key. The model numbers come from roofmodel.js, not from the
// PDF generator.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { parseReportText, modelFromRun, reconcile } from '../tools/dev/pdf-reconcile.mjs';
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
process.exit(fail ? 1 : 0);
