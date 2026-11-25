// node takeofftest.mjs -> exits 1 if the measurement model's takeoff of a mixed-pitch, multi-level fixture drifts.
// Fixture M1 (synthetic): main hip roof 48 x 30 ft at 6/12 (ridge parallel to the 48 ft side); a lower gable wing 16 ft
// wide x 20 ft deep at 4/12 attached to the middle of one long eave (its planes die into the main wall: a height break);
// a flat 10 x 10 ft porch roof at a corner of the other long side. Expected values are derived by hand from the rules:
// sloped area = plan x sqrt(1 + s^2); true length = plan x factor (1 level, rafter factor for rakes, hip factor for hips).
import { createRequire } from 'node:module';
const RM = createRequire(import.meta.url)('../roofmodel.js');
let fail = 0; const ok = (name, cond, got) => { console.log((cond ? 'ok   ' : 'FAIL ') + name + (cond ? '' : '  got ' + JSON.stringify(got))); if (!cond) fail++; };
const lat0 = 30.2, lng0 = -81.6, k = RM.scale(lat0); const P = (x, y) => ({ lat: lat0 + y / RM.FT / k.ky, lng: lng0 + x / RM.FT / k.kx });
const poly = (pts) => pts.map(([x, y]) => P(x, y));
// main hip roof: eave rectangle x 0..48, y 0..30; ridge y = 15 from x = 15 to x = 33
const facets = [
  { name: 'F1', pitch: 6, structure: 1, path: poly([[0, 0], [48, 0], [33, 15], [15, 15]]) }, { name: 'F2', pitch: 6, structure: 1, path: poly([[48, 0], [48, 30], [33, 15]]) },
  { name: 'F3', pitch: 6, structure: 1, path: poly([[48, 30], [0, 30], [15, 15], [33, 15]]) }, { name: 'F4', pitch: 6, structure: 1, path: poly([[0, 30], [0, 0], [15, 15]]) },
  // wing on the y = 0 eave, x 16..32, projecting to y = -20; ridge at x = 24
  { name: 'F5', pitch: 4, structure: 1, path: poly([[16, 0], [16, -20], [24, -20], [24, 0]]) }, { name: 'F6', pitch: 4, structure: 1, path: poly([[24, 0], [24, -20], [32, -20], [32, 0]]) },
  // flat porch at the corner x 38..48, y 30..40
  { name: 'F7', pitch: 0, structure: 1, path: poly([[38, 30], [48, 30], [48, 40], [38, 40]]) }];
const edges = [
  ['eave', [0, 0], [48, 0]], ['eave', [48, 30], [0, 30]], ['eave', [48, 0], [48, 30]], ['eave', [0, 30], [0, 0]], ['ridge', [15, 15], [33, 15]],
  ['hip', [0, 0], [15, 15]], ['hip', [48, 0], [33, 15]], ['hip', [48, 30], [33, 15]], ['hip', [0, 30], [15, 15]],
  ['eave', [16, 0], [16, -20]], ['eave', [32, 0], [32, -20]], ['rake', [16, -20], [24, -20]], ['rake', [24, -20], [32, -20]], ['ridge', [24, 0], [24, -20]], ['step', [16, 0], [32, 0]],
  ['eave', [38, 40], [48, 40]], ['eave', [38, 30], [38, 40]], ['eave', [48, 30], [48, 40]], ['wall', [38, 30], [48, 30]]].map(([type, a, b]) => ({ type, path: [P(...a), P(...b)] }));
const pitchFor = (e) => (e.type === 'rake' || e.type === 'step' ? 4 : 6);   // rakes and the step flashing belong to the wing (4/12); hips to the main roof
const F = facets.map((f) => ({ f, m: RM.facetMeasure(f) })); const E = edges.map((e) => ({ e, m: RM.lineMeasure(e, pitchFor(e), 6) }));
const sloped = F.reduce((a, x) => a + x.m.sloped, 0); const byType = {}; for (const x of E) byType[x.e.type] = (byType[x.e.type] || 0) + x.m.trueFt;
const near = (a, b, t = 0.01) => Math.abs(a - b) <= t;
ok('main hip planes 495 + 225 + 495 + 225 ft2 plan', near(F[0].m.plan, 495) && near(F[1].m.plan, 225) && near(F[2].m.plan, 495) && near(F[3].m.plan, 225), F.slice(0, 4).map((x) => x.m.plan));
ok('main roof sloped 1,609.97 ft2 (1,440 x 1.118034)', near(F.slice(0, 4).reduce((a, x) => a + x.m.sloped, 0), 1609.97), F.slice(0, 4).reduce((a, x) => a + x.m.sloped, 0));
ok('wing sloped 337.31 ft2 (320 x 1.054093)', near(F[4].m.sloped + F[5].m.sloped, 337.31), F[4].m.sloped + F[5].m.sloped);
ok('flat porch 100.00 ft2 (factor 1)', near(F[6].m.sloped, 100), F[6].m.sloped);
ok('net sloped area 2,047.28 ft2', near(sloped, 2047.28), sloped);
ok('eave 226.00 ft (156 main + 40 wing + 30 porch)', near(byType.eave, 226), byType.eave);
ok('ridge 38.00 ft (18 main + 20 wing)', near(byType.ridge, 38), byType.ridge);
ok('hips 90.00 ft (4 x 21.213 plan x 1.06066)', near(byType.hip, 90), byType.hip);
ok('rakes 16.87 ft (2 x 8 plan x 1.054093)', near(byType.rake, 16.87), byType.rake);
ok('height breaks: step flashing 16.87 ft (16 plan x 1.054093, it follows the wing slope) and level wall flashing 10.00 ft, each counted once', near(byType.step, 16.87) && near(byType.wall, 10), [byType.step, byType.wall]);
ok('a hip is not a rake: hip factor 1.06066, rafter factor 1.11803 at 6/12', near(RM.hipFactor(6), 1.06066, 1e-5) && near(RM.pitchFactor(6), 1.11803, 1e-5), [RM.hipFactor(6), RM.pitchFactor(6)]);
process.exit(fail ? 1 : 0);
