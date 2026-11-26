import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const RM = createRequire(import.meta.url)('../roofmodel.js');
const src = fs.readFileSync(new URL('../roofpdf.js', import.meta.url), 'utf8');
const context = vm.createContext({});
vm.runInContext(src.slice(src.indexOf('function rpAreaParts('), src.indexOf('function rpSheetInformation(')), context);
const job = JSON.parse(fs.readFileSync(new URL('../examples/residential-study.json', import.meta.url)));
const facets = job.facets.map((f) => ({ id: f.name, f, m: RM.facetMeasure(f), status: f.status || 'measured' }));
const groups = {}; for (const F of facets) groups[F.f.pitch] = (groups[F.f.pitch] || 0) + F.m.sloped;
const net = facets.reduce((n, F) => n + F.m.sloped, 0);
const M = { facets, lines: [], zones: [], kind: 'illustrative', review: false, selectedWaste: 12, area: { confirmed: net, estimate: 0 }, t: { sloped: net, plan: facets.reduce((n, F) => n + F.m.plan, 0), pitchGroups: groups, twoStory: 0, twoLayer: 0, recWaste: 14 } };
let I = context.rpInformation(M);
assert.ok(Math.abs(I.net - 1714.73) < 0.006);
assert.equal(I.pitches.length, 2);
assert.equal(I.facetCount, 6);
assert.equal(I.predominant, 6);
assert.ok(I.waste.some((W) => W.percent === 14 && W.recommended));
assert.ok(I.waste.some((W) => W.percent === 12 && W.selected));
assert.ok(Math.abs(I.waste.find((W) => W.percent === 10).area - net * 1.1) < 1e-9);
assert.equal(Object.keys(I.lines).length, 10);
const garage = facets.filter((F) => F.f.structure === 2);
const garageNet = garage.reduce((sum, F) => sum + F.m.sloped, 0);
const simple = { ...M, facets: garage, area: { confirmed: garageNet, estimate: 0 }, t: { ...M.t, sloped: garageNet, plan: garage.reduce((sum, F) => sum + F.m.plan, 0), pitchGroups: { 4: garageNet } } };
assert.ok(Math.abs(context.rpInformation(simple).net - 337.31) < 0.006);
M.review = true; facets[0].status = 'unresolved'; facets[1].status = 'inferred';
assert.equal(context.rpInformation(M).lines.valley.value, null, 'absent category in incomplete scope is unknown, never verified zero');
I = context.rpInformation(M);
assert.ok(I.net < net);
assert.equal(I.estimated, true);
assert.equal(I.inferred, facets[1].m.sloped);
assert.ok(I.waste.every((W) => W.area === null && W.squares === null));
assert.equal(I.twoStory, null);
facets[2].f.azimuth = 90;
assert.equal(context.rpInformation(M).directions[2].facing, 'E');
facets[2].f.pitchUnknown = true; facets[2].status = 'unresolved';
assert.equal(context.rpInformation(M).directions[2].azimuth, null);
assert.equal(context.rpInformation(M).directions[2].facing, '');
facets[1].f.inferredSqft = 100;
I = context.rpInformation(M);
assert.equal(I.inferred, 100, 'Incomplete summary counts only the estimated portion of a partly inferred facet.');
vm.runInContext(src.slice(src.indexOf('function rpPurchaseUnits('), src.indexOf('function rpSheetMaterials(')), context);
assert.equal(context.rpPurchaseUnits(120.000011135), 120);
assert.equal(context.rpPurchaseUnits(120.001), 121);
assert.equal(context.rpPurchaseUnits(184.000021916), 184);
assert.equal(context.rpPurchaseUnits(100.00001, 10), 10);
assert.equal(context.rpPurchaseUnits(100.001, 10), 11);
// Exercise the material-sheet entry point for the same takeoff under both report kinds.
const captions = [];
Object.assign(context, {
  MATERIAL_CATALOG: [], RP: {L: 32}, GR: n => n,
  rpHeader: (_doc, _model, _section, title) => captions.push(title),
  rpTableD: () => 300, rpText: (_doc, text) => captions.push(text)
});
vm.runInContext(src.slice(src.indexOf('function rpSheetMaterials('), src.indexOf('// Plan-first report:', src.indexOf('function rpSheetMaterials('))), context);
const byType = Object.fromEntries(['eave','rake','valley','wall','step','hip','ridge'].map(type => [type, {true:0}]));
for (const kind of ['illustrative','measured']) {
  captions.length = 0;
  context.rpSheetMaterials({}, {kind, line1:'Study', t:{pitched:100, byType, recWaste:10}}, 2, 2);
  assert.equal(captions[0], kind === 'illustrative' ? 'Illustrative material scenarios' : 'Material order quantities');
  if (kind === 'illustrative') assert.match(captions[1], /modeled roof/);
}
console.log('ok information categories, net area, waste isolation, incomplete scope and orientation');
