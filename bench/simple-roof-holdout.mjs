// Additional locked scope. Run once per candidate using the baseline fixture generator.
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { loadEngine } from './engine.mjs';
import { evaluate, summary } from './edge-validation.mjs';
import { rng } from './synth.mjs';

const output = process.argv[2];
if (!output) throw new Error('Supply a JSON output path.');
const engineDirectory = process.argv[3];
const context = engineDirectory
  ? loadEngine(['autotrace.js', 'autotrace2.js', 'obstruction.js'].map(name => engineDirectory + '/' + name))
  : loadEngine();
const fixtures = [];
for (let offset = 0; offset < 240; offset++) {
  const seed = 26110501 + offset;
  const random = rng(seed * 7919 + 13);
  const widthM = random.range(7, 14);
  fixtures.push({
    id: String(seed), seed, kind: offset % 2 ? 'hip' : 'gable', widthM,
    lengthM: widthM + random.range(4, 14), rotationDeg: random.range(0, 180),
    riseIn12: random.pick([4, 6, 8, 10, 12]),
    options: { trees: 0, clutter: false, hard: offset % 4 >= 2,
      noise: random.range(0.015, 0.06), blur: random.range(0.6, 3.0) },
  });
}
const cases = fixtures.map(f => evaluate(f, context, f.options));
function metrics(rows) {
  const exact = s => !s.error && !s.missedEdges.length && !s.extraEdges.length && !s.missedFacets.length
    && !s.extraFacets.length && s.edgeMatches.every(e => e.expectedType === e.predictedType);
  const within = s => Number.isFinite(s.absoluteAreaErrorPct) && s.absoluteAreaErrorPct <= 5;
  const edgeWithin = e => e.absoluteErrorFt !== null && e.absoluteErrorFt <= 0.05*e.expectedFt;
  return { ...summary(rows), areaWithin5: rows.filter(within).length, exactInventory: rows.filter(exact).length,
    allQuantitiesWithin5: rows.filter(s => within(s) && exact(s) && s.edgeMatches.every(edgeWithin)).length };
}
const report = {
  scope: '240 unobstructed rectangular single-wing roofs, balanced gable/hip, 10 cm DSM. Zero exclusions.',
  fixtureHash: createHash('sha256').update(JSON.stringify(fixtures)).digest('hex'),
  oracle: 'Closed-form 3D vertices and areas. A complete pass requires area and every individual matched edge length within 5%, correct edge types, and no missed or extra edges or facets. The frozen correspondence tolerances are 0.40 m for edge endpoints and IoU > 0.50 for facets.',
  all: metrics(cases), gable: metrics(cases.filter((_, i) => i % 2 === 0)), hip: metrics(cases.filter((_, i) => i % 2 === 1)),
  cases: cases.map(s => ({ id: s.id, inputHash: s.rasterSha256, error: s.error,
    areaErrorPct: s.absoluteAreaErrorPct, missedEdges: s.missedEdges, extraEdges: s.extraEdges.length,
    missedFacets: s.missedFacets, extraFacets: s.extraFacets.length,
    wrongType: s.edgeMatches.filter(e => e.expectedType !== e.predictedType).map(e => e.truthId),
    edgesOutside5: s.edgeMatches.filter(e => e.absoluteErrorFt === null || e.absoluteErrorFt > 0.05*e.expectedFt).map(e => e.truthId) })),
};
writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report.all, null, 2));
