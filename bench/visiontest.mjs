// node visiontest.mjs -> exits 1 if the vision-review fusion (bench/vision/fuse.mjs) accepts a correction without height-model
// evidence, rejects one that has it, or opens a review item without it. Synthetic scenes only; recorded observations stand
// in for the vision models (the same JSON they return), so this runs in CI with no network and no model.
import { render, rng } from './synth.mjs';
import { runApp, ROOT } from './appcore.mjs';
import { fuseModel } from './vision/fuse.mjs';
let fail = 0; const out = (ok, name, why = '') => { console.log((ok ? 'ok   ' : 'FAIL ') + name + (why ? ' - ' + why : '')); if (!ok) fail++; };
const LAT0 = 30.25, LNG0 = -81.6; const KY = 110540, KX = 111320 * Math.cos(LAT0 * Math.PI / 180);
const W = (o) => ({ cx: 0, cy: 0, th: 0.2, L: 18, W: 10, kind: 'hip', s: 0.5, sEnd: 0.5, eaveZ: 3, ...o });
const ll = (E, N) => [LAT0 + N / KY, LNG0 + E / KX];                       // scene metres -> [lat, lng]
const toM = (p) => [(p.lng - LNG0) * KX, (p.lat - LAT0) * KY];
const corner = (w, sx, sy) => { const c = Math.cos(w.th), s = Math.sin(w.th); const x = sx * w.L / 2, y = sy * w.W / 2; return [w.cx + x * c - y * s, w.cy + x * s + y * c]; };
function property(scene) {
  const { w, h, px, E0, N0 } = scene; const toLL = (x, y) => ({ lat: LAT0 + (N0 - y * px) / KY, lng: LNG0 + (E0 + x * px) / KX }); const tif = (data) => ({ data, w, h, toLL, rx: px, ry: -px, bands: null });
  let e0 = Infinity, e1 = -Infinity, n0 = Infinity, n1 = -Infinity; for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (scene.mask[y * w + x]) { const E = E0 + x * px, N = N0 - y * px; e0 = Math.min(e0, E); e1 = Math.max(e1, E); n0 = Math.min(n0, N); n1 = Math.max(n1, N); }
  const main = { name: 'buildings/fixture', center: { latitude: LAT0 + (n0 + n1) / 2 / KY, longitude: LNG0 + (e0 + e1) / 2 / KX }, boundingBox: { sw: { latitude: LAT0 + n0 / KY, longitude: LNG0 + e0 / KX }, ne: { latitude: LAT0 + n1 / KY, longitude: LNG0 + e1 / KX } }, imageryDate: { year: 2023, month: 11, day: 19 }, imageryQuality: 'HIGH' };
  return { slug: 'fixture', address: 'fixture', loc: { lat: main.center.latitude, lng: main.center.longitude }, main, radius: Math.min(100, Math.max(15, Math.ceil(Math.hypot(e1 - e0, n1 - n0) / 2 + 12))), layers: { imageryDate: { year: 2023, month: 11, day: 19 }, imageryQuality: 'HIGH' }, maskT: tif(scene.mask), dsmT: tif(scene.dsm), rgbT: null, solarNear: async () => { throw new Error('none'); } };
}
const jobOf = (r) => ({ facets: r.facets.map((f, i) => ({ name: 'F' + (i + 1), pitch: f.pitch, path: f.path.map((p) => ({ lat: p.lat, lng: p.lng })), status: 'measured', structure: f.struct || 1 })), edges: r.edges.map((e) => ({ type: e.type, path: e.path.map((p) => ({ lat: p.lat, lng: p.lng })), structure: e.struct || 1 })) });
const ringArea = (pts) => Math.abs(pts.reduce((s, p, i) => { const q = pts[(i + 1) % pts.length]; return s + p[0] * q[1] - q[0] * p[1]; }, 0)) / 2;
const areaOf = (job) => job.facets.reduce((s, f) => s + ringArea(f.path.map(toM)), 0);
const nearestVertex = (job, pt) => { let best = null; job.facets.forEach((f, fi) => f.path.forEach((p, k) => { const d = Math.hypot(...[toM(p)[0] - pt[0], toM(p)[1] - pt[1]]); if (!best || d < best.d) best = { d, fi, k }; })); return best; };
const obs = (o) => ({ source: 'test-image', role: 'outline', model: 'recorded', confidence: 0.9, ...o });

// ---- scene 1: a clear hip house. (a) a corner traced 1.2 m short is put back on the evidence; (b) a line in open ground is refused
{
  const house = W({}); const sc = render([house], rng(71), { clutter: false, trees: 0, noise: 0.02, blur: 1, hard: false });
  const P = property(sc); const r = await runApp(P, ROOT, { quiet: true }); const job = jobOf(r); const area0 = areaOf(job);
  const truth = corner(house, 1, 1); const nv = nearestVertex(job, truth);
  out(nv && nv.d < 0.5, 'fixture: the traced corner sits on the true corner', nv && nv.d.toFixed(2) + ' m');
  // damage: move that corner (every vertex and line end there) 1.2 m toward the house centre
  const bad = JSON.parse(JSON.stringify(job)); const v0 = toM(job.facets[nv.fi].path[nv.k]); const dir = [-v0[0] / Math.hypot(v0[0], v0[1]), -v0[1] / Math.hypot(v0[0], v0[1])]; const v1 = [v0[0] + dir[0] * 1.2, v0[1] + dir[1] * 1.2]; const [lat1, lng1] = ll(v1[0], v1[1]);
  for (const f of bad.facets) f.path.forEach((p, k) => { const q = toM(p); if (Math.hypot(q[0] - v0[0], q[1] - v0[1]) < 0.3) f.path[k] = { lat: lat1, lng: lng1 }; });
  for (const e of bad.edges) e.path.forEach((p, k) => { const q = toM(p); if (Math.hypot(q[0] - v0[0], q[1] - v0[1]) < 0.3) e.path[k] = { lat: lat1, lng: lng1 }; });
  const areaBad = areaOf(bad);
  const R = fuseModel({ job: bad, obs: [obs({ kind: 'corner', type: 'convex', ll: [ll(truth[0], truth[1])] })], dsm: P.dsmT, mask: P.maskT });
  const prop = R.proposals.find((p) => p.kind === 'corner-displaced');
  out(prop && prop.decision === 'accept' && R.summary.moved === 1, 'a corner traced 1.2 m short of the true corner is moved back (walls re-fitted through it follow the height step better)', prop ? prop.decision + ': ' + prop.why.slice(0, 120) : 'no proposal');
  const nv2 = nearestVertex(R.edited, truth); const areaC = areaOf(R.edited);
  out(nv2 && nv2.d < 0.3 && Math.abs(areaC - area0) < Math.abs(areaBad - area0) * 0.2, 'the edited model has the corner back within 0.3 m and the plan area back within the original', `corner ${nv2 && nv2.d.toFixed(2)} m; area traced ${area0.toFixed(1)}, damaged ${areaBad.toFixed(1)}, edited ${areaC.toFixed(1)} m2`);
  // decoy: two models draw an "eave" 4 m outside the house, parallel to the long wall, in open ground
  const a = corner(house, -1, -1), b = corner(house, 1, -1); const c = Math.cos(house.th), s = Math.sin(house.th); const off = [4 * s, -4 * c];
  const decoy = [obs({ kind: 'edge', type: 'eave', model: 'm1', ll: [ll(a[0] + off[0], a[1] + off[1]), ll(b[0] + off[0], b[1] + off[1])] }), obs({ kind: 'edge', type: 'eave', model: 'm2', ll: [ll(a[0] + off[0], a[1] + off[1]), ll(b[0] + off[0], b[1] + off[1])] })];
  const R2 = fuseModel({ job, obs: decoy, dsm: P.dsmT, mask: P.maskT }); const p2 = R2.proposals.find((p) => p.kind === 'missing' || p.kind === 'near' || p.kind === 'displaced');
  out(p2 && p2.decision === 'reject' && R2.summary.opened === 0 && R2.summary.moved === 0, 'a line two models drew in open ground (no height step, no mask edge) is rejected and opens nothing', p2 ? p2.kind + ':' + p2.decision + ' support ' + (p2.support || 0).toFixed(2) : 'no proposal');
  // the same corner observation on the correct trace changes nothing (agreement is not a correction)
  const R3 = fuseModel({ job, obs: [obs({ kind: 'corner', type: 'convex', ll: [ll(truth[0], truth[1])] })], dsm: P.dsmT, mask: P.maskT });
  out(R3.summary.moved === 0 && R3.proposals[0] && R3.proposals[0].kind === 'confirms', 'the true corner observed on a correct trace only confirms it', R3.proposals[0] && R3.proposals[0].kind);
}
// ---- scene 2: a corner under tree canopy (mask kept, height model shows the crown): the image may show the corner, the height
// model cannot confirm it, so the move is refused and the matter stays open
{
  const house = W({}); const sc = render([house], rng(72), { clutter: false, trees: 0, noise: 0.02, blur: 1, hard: false }); const { w, h, px } = sc;
  const cnr = corner(house, -1, -1);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const E = sc.E0 + (x + 0.5) * px, N = sc.N0 - (y + 0.5) * px; if (Math.hypot(E - cnr[0], N - cnr[1]) < 3.2) { const i = y * w + x; sc.dsm[i] = Math.max(sc.dsm[i], 7.5); sc.mask[i] = 1; } }
  const P = property(sc); const r = await runApp(P, ROOT, { quiet: true }); const job = jobOf(r);
  const nv = nearestVertex(job, cnr);
  const R = fuseModel({ job, obs: [obs({ kind: 'corner', type: 'convex', ll: [ll(cnr[0], cnr[1])] })], dsm: P.dsmT, mask: P.maskT });
  const p = R.proposals[0];
  out(p && p.decision !== 'accept' && R.summary.moved === 0, 'a corner seen in a photo but under canopy in the height model is never moved on the photo alone', p ? `${p.kind}:${p.decision} (traced vertex ${nv ? nv.d.toFixed(1) : '?'} m away) ${p.why.slice(0, 100)}` : 'no proposal');
}
// ---- scene 3: a roofed shed the trace missed; two models draw its eave and the height model shows the step: opened for review
{
  const house = W({}); const shed = W({ cx: 17, cy: 3, L: 6.5, W: 4.5, kind: 'gable', eaveZ: 2.6 });
  const sc = render([house, shed], rng(73), { clutter: false, trees: 0, noise: 0.02, blur: 1, hard: false });
  const P = property(sc); const r = await runApp(P, ROOT, { quiet: true }); const full = jobOf(r);
  const job = { facets: full.facets.filter((f) => Math.hypot(...[toM(f.path[0])[0], toM(f.path[0])[1]]) < 12), edges: full.edges.filter((e) => Math.hypot(...[toM(e.path[0])[0], toM(e.path[0])[1]]) < 12) };
  out(job.facets.length < full.facets.length, 'fixture: the shed is dropped from the trace to stand for a missed structure', `${full.facets.length} -> ${job.facets.length} facets`);
  const a = corner(shed, -1, -1), b = corner(shed, 1, -1);
  const O = [obs({ kind: 'edge', type: 'eave', model: 'm1', ll: [ll(a[0], a[1]), ll(b[0], b[1])] }), obs({ kind: 'edge', type: 'eave', model: 'm2', ll: [ll(a[0], a[1]), ll(b[0], b[1])] })];
  const R = fuseModel({ job, obs: O, dsm: P.dsmT, mask: P.maskT }); const p = R.proposals.find((q) => q.kind === 'missing');
  out(p && p.decision === 'accept-as-open' && R.summary.opened === 1 && R.edited.facets.some((f) => f.status === 'unresolved' && f.verify && /missing/.test(f.verify.note)), 'a roof edge two models saw where the trace has nothing, with the height step under it, opens the nearest facet for review (never added as measured roof)', p ? `${p.decision}, support ${p.support.toFixed(2)}, opened ${R.summary.opened}` : 'no missing proposal');
  out(R.summary.moved === 0 && R.summary.retyped === 0, 'nothing is drawn or measured from the photo alone', `${R.summary.moved} moved, ${R.summary.retyped} retyped`);
}
console.log(fail ? `${fail} FAILED` : 'all ok'); process.exit(fail ? 1 : 0);
