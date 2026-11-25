// Builds the illustrative design example as a Roof Measure job (the app's Export JSON format), so it can be loaded with
// Import JSON (or `run-app.mjs --job`) and exported through the normal report flow.
//   node tools/dev/handoff-examples.mjs [--out examples]
// Residential study: an illustrative 3D model (main house 44 x 28 ft hip at 6/12, detached garage 20 x 16 ft gable at
// 4/12) placed at a nominal location (0, 0). Its net sloped area measures 1,714.73 sq ft in the app's own engine
// (bench/reporttest.mjs checks that). The two customer acceptance examples (a source takeoff and an adjuster-sketch
// review) carry customer addresses and are built by a private copy of this script that stays out of the repository.
import fs from 'node:fs';
import path from 'node:path';

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const OUT = arg('out', 'examples'); fs.mkdirSync(OUT, { recursive: true });
const FT = 3.28084; const scale = (lat) => { const r = lat * Math.PI / 180; return { kx: 111412.84 * Math.cos(r) - 93.5 * Math.cos(3 * r) + 0.118 * Math.cos(5 * r), ky: 111132.954 - 559.822 * Math.cos(2 * r) + 1.175 * Math.cos(4 * r) }; };
// feet (x east, y north) around an origin -> lat/lng; the frame doubles as the plane reference (metres)
const framer = (lat0, lng0, rotDeg = 0) => { const k = scale(lat0); const a = rotDeg * Math.PI / 180, ca = Math.cos(a), sa = Math.sin(a); const toEN = ([x, y]) => [x * ca + y * sa, -x * sa + y * ca]; const ll = (p) => { const [E, N] = toEN(p); return { lat: lat0 + N / FT / k.ky, lng: lng0 + E / FT / k.kx }; }; return { ll, toEN, ref: { lat: lat0, lng: lng0, kx: k.kx, ky: k.ky } }; };
// plane z = a E + b N + c (metres) through 3D vertices given in feet (x east, y north, z up) of the frame
function planeOf(pts3, fr) { const P = pts3.map((p) => { const [E, N] = fr.toEN([p[0], p[1]]); return [E / FT, N / FT, p[2] / FT]; }); const [A, B, C] = [P[0], P[1], P[P.length - 1]]; const u = [B[0] - A[0], B[1] - A[1], B[2] - A[2]], v = [C[0] - A[0], C[1] - A[1], C[2] - A[2]]; let n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]; if (Math.abs(n[2]) < 1e-9) return null; if (n[2] < 0) n = n.map((q) => -q); const a = -n[0] / n[2], b = -n[1] / n[2]; return [a, b, A[2] - a * A[0] - b * A[1]]; }
const job = (o) => ({ app: 'roof-measure', version: 3, savedAt: new Date().toISOString(), jobName: o.jobName, address: o.address, location: o.location, defaultPitch: o.defaultPitch || 6, waste: o.waste == null ? 10 : o.waste, facets: o.facets, edges: o.edges, trace: null, acceptedHidden: [], evidence: [], altFusion: null, altViews: [], solar: null, otherSolar: [], source: o.source });

// ---------------------------------------------------------------- 01 residential study (illustrative model)
function residential() {
  const fr = framer(0, 0); const F = (pts3, pitch, extra = {}) => ({ name: '', pitch, path: pts3.map((p) => fr.ll([p[0], p[1]])), status: 'measured', plane: planeOf(pts3, fr), ...extra });
  const house = [[[0, 0, 9], [44, 0, 9], [30, 14, 16], [14, 14, 16]], [[44, 0, 9], [44, 28, 9], [30, 14, 16]], [[44, 28, 9], [0, 28, 9], [14, 14, 16], [30, 14, 16]], [[0, 28, 9], [0, 0, 9], [14, 14, 16]]];
  const garage = [[[42, 39, 7], [62, 39, 7], [62, 47, 7 + 8 / 3], [42, 47, 7 + 8 / 3]], [[42, 47, 7 + 8 / 3], [62, 47, 7 + 8 / 3], [62, 55, 7], [42, 55, 7]]];
  const facets = [...house.map((p) => F(p, 6, { structure: 1 })), ...garage.map((p) => F(p, 4, { structure: 2 }))].map((f, i) => ({ ...f, name: 'F' + (i + 1) }));
  const E = (type, a, b, structure) => ({ type, pitch: null, path: [fr.ll(a), fr.ll(b)], status: 'measured', structure });
  const edges = [E('eave', [0, 0], [44, 0], 1), E('eave', [44, 28], [0, 28], 1), E('eave', [44, 0], [44, 28], 1), E('eave', [0, 28], [0, 0], 1), E('hip', [0, 0], [14, 14], 1), E('hip', [44, 0], [30, 14], 1), E('hip', [44, 28], [30, 14], 1), E('hip', [0, 28], [14, 14], 1), E('ridge', [14, 14], [30, 14], 1),
    E('eave', [42, 39], [62, 39], 2), E('eave', [62, 55], [42, 55], 2), E('rake', [42, 39], [42, 47], 2), E('rake', [42, 47], [42, 55], 2), E('rake', [62, 39], [62, 47], 2), E('rake', [62, 47], [62, 55], 2), E('ridge', [42, 47], [62, 47], 2)];
  return job({ jobName: 'Residential study', address: 'Residential study, Main house and detached garage', location: { lat: 0, lng: 0 }, waste: 10, facets, edges,
    source: { kind: 'illustrative', title: 'Residential hip roof', shortName: 'Residential study', addressLine1: 'Residential study', addressLine2: 'Main house and detached garage', imageryLabel: 'Model only', ref: fr.ref,
      buildingNames: { 1: 'Main house', 2: 'Detached garage' }, notes: ['All coordinates, elevation profiles and quantities are illustrative. The order assumes three equal-coverage bundles per square and rounds up once across both buildings.'] } });
}
const r = residential(); const file = path.join(OUT, 'residential-study.json'); fs.writeFileSync(file, JSON.stringify(r, null, 1)); console.log('wrote ' + file);
