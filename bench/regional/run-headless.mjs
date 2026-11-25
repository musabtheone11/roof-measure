// Original-pipeline run of a regional set without the browser: the engine in --engine (e.g. bench/engines/base, the
// engine before this work) traces each cached property, and the current measurement model turns its facets and lines
// into totals.json in the shape the scorer reads. No export gate existed in that pipeline, so every report counts as
// COMPLETE: the scorer's "false COMPLETE" column shows what that cost.
//   node bench/regional/run-headless.mjs --engine bench/engines/base --label orig-dev --set dev|blind|all [--only slug,slug]
// Reads bench/private/regional/manifest.json and bench/private/cache/<slug>/ (downloads only when a property is not cached).
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { fetchProperty, runApp } from '../appcore.mjs';
const HERE = path.dirname(fileURLToPath(import.meta.url)), REPO = path.resolve(HERE, '..', '..');
const RM = createRequire(import.meta.url)(path.join(REPO, 'roofmodel.js'));
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const label = arg('label'), engine = path.resolve(arg('engine', path.join(REPO, 'bench', 'engines', 'base'))), set = arg('set', 'dev'), only = arg('only', null);
if (!label) { console.error('--label required'); process.exit(2); }
const M = JSON.parse(fs.readFileSync(path.join(REPO, 'bench', 'private', 'regional', 'manifest.json'), 'utf8'));
let props = M.properties.filter((p) => set === 'all' || p.group === set || (set === 'dev' && p.group === 'regression'));
if (only) { const s = new Set(only.split(',')); props = M.properties.filter((p) => s.has(p.slug)); }
const OUT = path.join(REPO, '.devcache', 'regional', label); fs.mkdirSync(OUT, { recursive: true });
const version = { label, commit: null, dirty: null, appHash: 'engine:' + path.relative(REPO, engine), root: path.relative(REPO, engine), alt: false, headless: true, gate: false, startedAt: new Date().toISOString() };
fs.writeFileSync(path.join(OUT, 'version.json'), JSON.stringify(version, null, 1));
console.log(`headless run ${label}: ${props.length} properties, engine ${version.root} (no export gate: every report COMPLETE)`);
const centroid = (path_) => ({ lat: path_.reduce((s, p) => s + p.lat, 0) / path_.length, lng: path_.reduce((s, p) => s + p.lng, 0) / path_.length });
const results = [];
for (const p of props) {
  const dir = path.join(OUT, p.slug); fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
  const t0 = Date.now(); let rec;
  try {
    const prop = await fetchProperty(p.address, { slug: p.slug });
    const r = await runApp(prop, engine, { quiet: true });
    const facets = r.facets.map((f, i) => { const m = RM.facetMeasure({ path: f.path, pitch: f.pitch, slope: f.slope }); return { name: f.name || 'F' + (i + 1), pitch: f.pitch, plan: m.plan, sloped: m.sloped, excluded: !!f.excluded, structure: f.struct || 1, status: 'measured', basis: m.basis, slope12: m.slope12, path: f.path }; });
    const edges = r.edges.map((e) => {
      // the adjoining facet's pitch sets the slope factor (the app does the same): nearest facet centroid of the same structure
      const c = centroid(e.path); let best = null, bd = Infinity;
      for (const f of facets) { if (f.excluded || f.structure !== (e.struct || 1)) continue; const fc = centroid(f.path); const d = Math.hypot(fc.lat - c.lat, fc.lng - c.lng); if (d < bd) { bd = d; best = f; } }
      const m = RM.lineMeasure({ type: e.type, path: e.path, pitch: e.pitch == null ? null : e.pitch, factor: e.factor }, best ? best.pitch : null, 6);
      return { type: e.type, planFt: m.planFt, trueFt: m.trueFt, factor: m.factor, pitch: m.pitch, structure: e.struct || 1, status: 'measured', path: e.path };
    });
    const live = facets.filter((f) => !f.excluded); const sloped = live.reduce((s, f) => s + f.sloped, 0) - facets.filter((f) => f.excluded).reduce((s, f) => s + f.sloped, 0);
    const groups = {}; for (const f of live) groups[f.pitch] = (groups[f.pitch] || 0) + f.sloped; const predominant = Object.keys(groups).length ? +Object.keys(groups).sort((a, b) => groups[b] - groups[a])[0] : null;
    const byType = {}; for (const e of edges) byType[e.type] = (byType[e.type] || 0) + e.trueFt;
    const structures = [...new Set(facets.map((f) => f.structure))].map((id) => ({ id, sloped: live.filter((f) => f.structure === id).reduce((s, f) => s + f.sloped, 0) }));
    const totals = { slopedSqft: sloped, planSqft: live.reduce((s, f) => s + f.plan, 0), facetCount: live.length, predominant, pitchGroups: groups, byType, structures, status: 'COMPLETE', statusReasons: [],
      facets: facets.map(({ path: _p, ...f }) => f), edges: edges.map(({ path: _p, ...e }) => e), audit: { reportStatus: { status: 'COMPLETE', reasons: [] }, note: 'original pipeline: no export gate, no evidence or status tracking; measured with the current roofmodel.js from the engine geometry' } };
    fs.writeFileSync(path.join(dir, 'totals.json'), JSON.stringify(totals, null, 1));
    fs.writeFileSync(path.join(dir, 'roof.json'), JSON.stringify({ app: 'roof-measure', headless: true, engine: version.root, facets: facets.map((f) => ({ name: f.name, pitch: f.pitch, path: f.path, status: 'measured', structure: f.structure, excluded: f.excluded })), edges: edges.map((e) => ({ type: e.type, path: e.path, structure: e.structure })) }, null, 1));
    rec = { slug: p.slug, exit: 0, seconds: Math.round((Date.now() - t0) / 1000), failedSteps: [], version };
    console.log(`ok   ${p.slug} (${rec.seconds}s): ${live.length} facets, ${Math.round(sloped)} sq ft, ${edges.length} lines`);
  } catch (e) {
    rec = { slug: p.slug, exit: 1, seconds: Math.round((Date.now() - t0) / 1000), failedSteps: ['auto-trace: ' + String(e.message || e).slice(0, 160)], version };
    fs.writeFileSync(path.join(dir, 'run.log'), 'FAIL auto-trace: ' + String(e.stack || e)); console.log(`FAIL ${p.slug}: ${String(e.message || e).slice(0, 120)}`);
  }
  fs.writeFileSync(path.join(dir, 'version.json'), JSON.stringify(rec, null, 1));   // the scorer reads the run record per property
  results.push(rec);
}
fs.writeFileSync(path.join(OUT, 'generated.json'), JSON.stringify({ version, finishedAt: new Date().toISOString(), runs: results }, null, 1));
console.log(`done: ${results.filter((r) => r.exit === 0).length}/${results.length} traced -> ${path.relative(REPO, OUT)}`);
