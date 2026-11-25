// Real-house benchmark: old engine vs new engine vs same-property reference reports.
//   Key=<google key> node compare.mjs [--only <slug>] [--limit n]
// Reads   bench/private/truth/<slug>.json   (numbers extracted from measurement reports and adjuster estimates; private)
// Writes  bench/private/results/<slug>.json + <slug>.dump.json (for sketches), compare.json, compare.md   (all private)
//         bench/REAL_RESULTS.md              (aggregate only: no addresses, no customer data)
// The reference numbers are NEVER given to the engine: each roof is traced from Google data alone, then scored.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fetchProperty, runApp, ROOT, BENCH } from './appcore.mjs';
const RM = createRequire(import.meta.url)('../roofmodel.js');
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const OLD = path.join(BENCH, 'engines', '2026-11-23'), TRUTH = path.join(BENCH, 'private', 'truth'), OUT = path.join(BENCH, 'private', 'results');
fs.mkdirSync(OUT, { recursive: true });
const TYPES = ['eave', 'rake', 'ridge', 'hip', 'valley', 'step', 'wall', 'transition'];
const pitchFactor = (p) => Math.sqrt(144 + p * p) / 12, hipFactor = (p) => Math.sqrt(1 + p * p / 288);
const SLOPE = { eave: 'flat', valley: 'hip', hip: 'hip', ridge: 'flat', rake: 'rake', wall: 'flat', step: 'rake', transition: 'flat' };

// "old app" numbers: Google spherical geometry (R = 6378137), rounded pitch, generic rake / hip factors from the adjoining facet
function measureOld(facets, edges) {
  const lat0 = facets.length ? facets[0].path[0].lat : 0; const R = 6378137 * Math.PI / 180, kx = R * Math.cos(lat0 * Math.PI / 180), ky = R;
  const xy = (v) => [(v.lng - facets[0].path[0].lng) * kx, (v.lat - lat0) * ky];
  const F = facets.map((f) => { const r = f.path.map(xy); return { r, pitch: f.pitch, plan: Math.abs(RM.ringArea(r)) * RM.SQFT }; });
  let sloped = 0, plan = 0; const pitchAreas = {};
  for (const f of F) { const a = f.plan * pitchFactor(f.pitch); sloped += a; plan += f.plan; pitchAreas[f.pitch] = (pitchAreas[f.pitch] || 0) + a; }
  const byType = {}; for (const t of TYPES) byType[t] = 0;
  for (const e of edges) { const r = e.path.map(xy); let L = 0; for (let i = 1; i < r.length; i++) L += Math.hypot(r[i][0] - r[i - 1][0], r[i][1] - r[i - 1][1]);
    const mid = [(r[0][0] + r[1][0]) / 2, (r[0][1] + r[1][1]) / 2]; let best = null, bd = 0.6;
    for (const f of F) for (let i = 0; i < f.r.length; i++) { const d = RM.pointSeg(mid, f.r[i], f.r[(i + 1) % f.r.length]); if (d < bd) { bd = d; best = f.pitch; } }
    const p = best ?? 6, s = SLOPE[e.type] || 'flat'; byType[e.type] = (byType[e.type] || 0) + L * RM.FT * (s === 'flat' ? 1 : s === 'rake' ? pitchFactor(p) : hipFactor(p)); }
  return finish({ sloped, plan, pitchAreas, byType, facets: F.length });
}
// "new app" numbers: roofmodel.js (ellipsoidal scale, fitted slope per facet, plane slope factor per line)
function measureNew(facets, edges) {
  let sloped = 0, plan = 0; const pitchAreas = {}; const st = { measured: 0, inferred: 0, unresolved: 0 };
  for (const f of facets) { const m = RM.facetMeasure(f); sloped += m.sloped; plan += m.plan; pitchAreas[f.pitch] = (pitchAreas[f.pitch] || 0) + m.sloped; const s = RM.statusOf(f); if (s !== 'measured' && f.inferredSqft > 0 && f.inferredSqft < m.sloped) { st[s] += f.inferredSqft; st.measured += m.sloped - f.inferredSqft; } else st[s] += m.sloped; }
  const byType = {}; for (const t of TYPES) byType[t] = 0;
  for (const e of edges) { const m = RM.lineMeasure({ type: e.type, path: e.path, factor: e.factor, autoType: e.type }, null, 6); byType[e.type] = (byType[e.type] || 0) + m.trueFt; }
  return finish({ sloped, plan, pitchAreas, byType, facets: facets.length, status: st, unresolvedLines: edges.filter((e) => e.status === 'unresolved').length, inferredLines: edges.filter((e) => e.status === 'inferred').length });
}
function finish(m) { let pred = null, pa = -1; for (const [p, a] of Object.entries(m.pitchAreas)) if (a > pa) { pa = a; pred = +p; } m.predominant = pred; return m; }
const scoped = (run, mainOnly) => ({ facets: run.facets.filter((f) => !mainOnly || f.struct === 1), edges: run.edges.filter((e) => !mainOnly || e.struct === 1) });

function rowsFor(T, old, neu) {
  const mr = T.measurementReport, ad = T.adjusterReport; const rows = [];
  const add = (metric, unit, ref, src, o, n, tolAbs, tolPct, note) => {
    const has = ref != null && isFinite(ref); const sd = has ? n - ref : null, ad2 = has ? Math.abs(sd) : null, pe = has && ref !== 0 ? sd / ref * 100 : null, peOld = has && ref !== 0 ? (o - ref) / ref * 100 : null;
    let status = 'no reference value (not scored)'; if (has) status = ad2 <= Math.max(tolAbs, tolPct / 100 * Math.abs(ref)) ? 'within tolerance' : 'differs';
    rows.push({ metric, unit, ref: has ? ref : null, source: src, old: o, new: n, signed: sd, abs: ad2, pct: pe, pctOld: peOld, status, note: note || '' });
  };
  const v = (x) => (x && x.value != null ? x.value : null), pg = (x, lab) => (x && x.page != null ? `${lab} p.${x.page}` : lab);
  if (mr) {
    const lab = mr.vendor || 'measurement report'; const unspec = v(mr.ft && mr.ft.unspecified) || 0; const inc = unspec > 10 ? `reference left ${Math.round(unspec)} ft "unspecified": its category totals are lower bounds` : '';
    add('Net sloped roof area', 'sq ft', v(mr.areaSqft), pg(mr.areaSqft, lab), old.sloped, neu.sloped, 0, 3);
    add('Facet count', 'facets', v(mr.facets), pg(mr.facets, lab), old.facets, neu.facets, 1, 15);
    add('Predominant pitch', 'x/12', v(mr.predominantPitch), pg(mr.predominantPitch, lab), old.predominant, neu.predominant, 0.5, 0);
    for (const t of TYPES) add(t[0].toUpperCase() + t.slice(1) + ' length', 'ft', mr.ft ? v(mr.ft[t]) : null, mr.ft ? pg(mr.ft[t], lab) : lab, old.byType[t], neu.byType[t], 5, 10, inc);
    const sum = (a, b) => (mr.ft && v(mr.ft[a]) != null && v(mr.ft[b]) != null ? v(mr.ft[a]) + v(mr.ft[b]) : null);
    add('Ridge + hip (cap)', 'ft', sum('ridge', 'hip'), lab, old.byType.ridge + old.byType.hip, neu.byType.ridge + neu.byType.hip, 5, 10, inc);
    add('Eave + rake (drip edge)', 'ft', sum('eave', 'rake'), lab, old.byType.eave + old.byType.rake, neu.byType.eave + neu.byType.rake, 5, 10, inc);
  }
  if (ad && ad.roofSketch) {
    const sk = ad.roofSketch, whole = ad.scope === 'whole-roof'; const note = whole ? '' : `adjuster scope is "${ad.scope}": shown for information, not scored`;
    const A = (metric, unit, x, o, n, ta, tp) => { add(metric + ' (adjuster)', unit, whole ? v(x) : null, pg(x, 'Adjuster estimate'), o, n, ta, tp, note + (!whole && v(x) != null ? ` (adjuster value ${v(x)})` : '')); };
    A('Roof surface area', 'sq ft', sk.surfaceAreaSf, old.sloped, neu.sloped, 0, 3);
    A('Ridge length', 'ft', sk.ridgeLf, old.byType.ridge, neu.byType.ridge, 5, 10); A('Hip length', 'ft', sk.hipLf, old.byType.hip, neu.byType.hip, 5, 10);
    A('Valley length', 'ft', sk.valleyLf, old.byType.valley, neu.byType.valley, 5, 10);
    A('Perimeter (eave + rake)', 'ft', sk.perimeterLf, old.byType.eave + old.byType.rake, neu.byType.eave + neu.byType.rake, 5, 10);
  }
  return rows;
}

const files = fs.readdirSync(TRUTH).filter((f) => f.endsWith('.json')).filter((f) => !arg('only') || f.startsWith(arg('only'))).slice(0, +arg('limit', 999));
const all = [];
for (const file of files) {
  const slug = file.replace(/\.json$/, ''); const T = JSON.parse(fs.readFileSync(path.join(TRUTH, file), 'utf8'));
  const rec = { slug, address: T.address, complexity: T.complexity || null, vendor: T.measurementReport ? T.measurementReport.vendor : null, refImageryDate: T.measurementReport ? T.measurementReport.imageryDate : null, adjusterScope: T.adjusterReport ? T.adjusterReport.scope : null };
  try {
    const prop = await fetchProperty(T.address, { slug });
    const d = prop.layers.imageryDate; rec.imageryDate = d ? `${d.year}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}` : null; rec.imageryQuality = prop.layers.imageryQuality || null;
    const oldRun = await runApp(prop, OLD, { quiet: true }), newRun = await runApp(prop, ROOT, { quiet: true });
    // scope: references normally cover the main dwelling; use every traced structure only when the reference lists several
    const refStructs = (T.measurementReport && Array.isArray(T.measurementReport.structures) ? T.measurementReport.structures.length : 0) || (Array.isArray(T.structures) ? T.structures.length : 0);
    const mainOnly = !(refStructs > 1); rec.scope = mainOnly ? 'main structure only' : `all traced structures (reference lists ${refStructs})`;
    rec.structures = { old: Math.max(...oldRun.facets.map((f) => f.struct), 0), new: Math.max(...newRun.facets.map((f) => f.struct), 0) };
    const o = scoped(oldRun, mainOnly), n = scoped(newRun, mainOnly);
    rec.old = measureOld(o.facets, o.edges); rec.new = measureNew(n.facets, n.edges);
    // side information (not scored): the same new trace with rounded pitches, and the total over every traced structure
    rec.newRoundedSloped = measureNew(n.facets.map((f) => ({ ...f, slope: null })), n.edges).sloped;
    rec.allStructuresSloped = { old: measureOld(oldRun.facets, oldRun.edges).sloped, new: measureNew(newRun.facets, newRun.edges).sloped };
    const ob = newRun.info.obstruction; rec.obstruction = ob ? { footprintObscuredPct: ob.footprintObscuredPct, inferredPlanSqft: ob.inferredPlanSqft, treesOver: ob.trees.filter((t) => t.kind === 'overlap').length, treesNear: ob.trees.filter((t) => t.kind === 'near').length } : null;
    rec.obstructed = !!(ob && (ob.footprintObscuredPct >= 2 || rec.new.status.unresolved > 0));
    rec.repairs = (newRun.info.repairs || []).length; rec.audit = (() => { const a = RM.audit(n.facets.map((f) => ({ name: f.name, path: f.path, level: 1 })), n.edges.map((e) => ({ type: e.type, path: e.path }))); return { errors: a.issues.filter((i) => i.severity === 'error').length, warnings: a.issues.filter((i) => i.severity === 'warn').length, unclassifiedFt: a.unclassifiedFt }; })();
    rec.rows = rowsFor(T, rec.old, rec.new); rec.notes = [T.notes, T.adjusterReport && T.adjusterReport.notes].filter(Boolean).join(' | ').slice(0, 600);
    // geometry for the side-by-side sketch (local metres about the building centre, north up)
    const c = prop.main.center, k = RM.scale(c.latitude); const xy = (p) => [+((p.lng - c.longitude) * k.kx).toFixed(2), +((p.lat - c.latitude) * k.ky).toFixed(2)];
    const { w, h } = prop.dsmT; const tl = xy(prop.maskT.toLL(0, 0)), br = xy(prop.maskT.toLL(w, h)); const stp = 2;
    const rgb = prop.rgbT && prop.rgbT.w === w ? [0, 1, 2].map((b) => { const o2 = []; for (let y = 0; y < h; y += stp) { const r = []; for (let x = 0; x < w; x += stp) r.push(prop.rgbT.bands[b][y * w + x]); o2.push(r); } return o2; }) : null;
    const G = (run) => ({ facets: run.facets.map((f) => ({ name: f.name, pitch: f.pitch, status: f.status || 'measured', struct: f.struct, poly: f.path.map(xy) })), edges: run.edges.map((e) => ({ type: e.type, status: e.status || 'measured', line: e.path.map(xy) })) });
    fs.writeFileSync(path.join(OUT, slug + '.dump.json'), JSON.stringify({ slug, address: T.address, ext: [tl[0], br[0], br[1], tl[1]], rgb, old: G(oldRun), new: G(newRun), trees: ob ? ob.trees.map((t) => ({ kind: t.kind, poly: t.path.map(xy) })) : [], ref: { area: T.measurementReport && T.measurementReport.areaSqft ? T.measurementReport.areaSqft.value : null, facets: T.measurementReport && T.measurementReport.facets ? T.measurementReport.facets.value : null, vendor: rec.vendor }, oldArea: rec.old.sloped, newArea: rec.new.sloped }));
    console.log(`${slug.padEnd(34)} ref ${String(rec.rows[0] && rec.rows[0].ref).padStart(6)}  old ${rec.old.sloped.toFixed(0).padStart(6)} (${rec.old.facets}f)  new ${rec.new.sloped.toFixed(0).padStart(6)} (${rec.new.facets}f)  obsc ${ob ? ob.footprintObscuredPct.toFixed(1) : '-'}%`);
  } catch (e) { rec.error = String(e && e.message || e); console.log(`${slug.padEnd(34)} ERROR ${rec.error}`); }
  fs.writeFileSync(path.join(OUT, slug + '.json'), JSON.stringify(rec, null, 1)); all.push(rec);
}
if (!arg('only')) fs.writeFileSync(path.join(OUT, 'compare.json'), JSON.stringify(all));
