// Three versions on the same properties: node bench/regional/compare-versions.mjs --labels orig-dev,new-dev,apinex-dev --names "A original,B improved,C improved + APInex" --out bench/regional/COMPARE-dev.md
// Reads the private score files (bench/private/regional/score-<label>.json) and writes an aggregate-only table: per version
// the number of properties, report status mix, false COMPLETE exports, area / pitch / facet medians and edge footage
// missing / extra over the scored line types, by roof type and by obstruction level. Properties are compared only where
// every version has a scored value, so the medians are over the same cases.
// False COMPLETE: a report exported as COMPLETE whose scored net area is more than 10 % from the reference, or whose
// missing edge footage exceeds a quarter of the reference footage of the scored line types.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const labels = arg('labels', 'orig-dev,new-dev').split(','), names = arg('names', labels.join(',')).split(','), out = arg('out', null);
const S = labels.map((l) => JSON.parse(fs.readFileSync(path.join(REPO, 'bench', 'private', 'regional', `score-${l}.json`), 'utf8')));
const byId = S.map((rows) => Object.fromEntries(rows.map((r) => [r.id, r])));
const ids = Object.keys(byId[0]).filter((id) => byId.every((m) => m[id]));
const auto = (r) => (r.versions || {}).automatic || null;
const areaPct = (r) => { const A = auto(r); if (!A) return null; const c = (A.compare || []).find((x) => (x.metric === 'Net sloped area' || x.metric === 'Net sloped area (adjuster)') && x.state === 'scored'); return c ? c.pct : null; };
const metricDiff = (r, m) => { const A = auto(r); if (!A) return null; const c = (A.compare || []).find((x) => x.metric === m && x.state === 'scored'); return c ? c.diff : null; };
const edges = (r) => { const A = auto(r); const e = A && A.edges || {}; return { missing: Object.values(e).reduce((s, x) => s + x.missingFt, 0), extra: Object.values(e).reduce((s, x) => s + x.extraFt, 0), ref: Object.values(e).reduce((s, x) => s + x.ref, 0), n: Object.keys(e).length }; };
const status = (r) => { const A = auto(r); return A ? A.status : 'failed'; };
const falseComplete = (r) => { if (status(r) !== 'complete') return false; const p = areaPct(r), e = edges(r); return (p != null && Math.abs(p) > 10) || (e.ref > 0 && e.missing > 0.25 * e.ref); };
const med = (a) => { const q = a.filter((x) => x != null && isFinite(x)).sort((p, r) => p - r); return q.length ? (q.length % 2 ? q[q.length >> 1] : (q[q.length / 2 - 1] + q[q.length / 2]) / 2) : null; };
const f1 = (x) => (x == null ? '-' : x.toFixed(1)), f0 = (x) => (x == null ? '-' : Math.round(x).toLocaleString('en-US'));
function table(groupKey) {
  const groups = groupKey ? [...new Set(ids.map((id) => byId[0][id][groupKey] || 'untagged'))] : ['all properties'];
  const L = [`| ${groupKey === 'roofType' ? 'Roof type' : groupKey === 'obstruction' ? 'Obstruction' : 'Set'} | Version | Properties | Complete / review required / failed | False COMPLETE | Area: median abs. diff % (n, same cases) | Area: median signed % | Pitch: median abs. diff | Facets: median run - ref | Edge ft missing / extra (scored types) | Values missing from run |`, '|' + '---|'.repeat(11)];
  for (const g of groups) {
    const gid = ids.filter((id) => !groupKey || (byId[0][id][groupKey] || 'untagged') === g);
    const scoredAll = gid.filter((id) => byId.every((m) => areaPct(m[id]) != null));   // same cases for every version
    labels.forEach((l, v) => {
      const R = gid.map((id) => byId[v][id]); const st = (s) => R.filter((r) => status(r) === s).length; const pct = (n) => (R.length ? Math.round(100 * n / R.length) + '%' : '-');
      const ar = scoredAll.map((id) => areaPct(byId[v][id])); const E = R.map(edges);
      const missingVals = R.reduce((s, r) => s + ((auto(r) || {}).compare || []).filter((x) => x.state.startsWith('MISSING')).length, 0);
      L.push(`| ${g} | ${names[v]} | ${R.length} | ${pct(st('complete'))} / ${pct(st('review-required'))} / ${pct(st('failed'))} | ${R.filter(falseComplete).length} | ${f1(med(ar.map(Math.abs)))} (${ar.length}) | ${ar.length ? (med(ar) > 0 ? '+' : '') + f1(med(ar)) : '-'} | ${f1(med(R.map((r) => { const d = metricDiff(r, 'Predominant pitch'); return d == null ? null : Math.abs(d); })))} | ${f1(med(R.map((r) => metricDiff(r, 'Facets'))))} | ${f0(E.reduce((s, e) => s + e.missing, 0))} / ${f0(E.reduce((s, e) => s + e.extra, 0))} | ${missingVals} |`);
    });
  }
  return L.join('\n');
}
const head = `# Three versions on the same properties (${ids.length} in every version)\n\nVersions: ${labels.map((l, i) => `${names[i]} = run \`${l}\``).join('; ')}.\n` +
  'No approved tolerances exist: differences are shown, nothing is called a pass. "Same cases" medians use only properties scored in every version. ' +
  'False COMPLETE = a report exported as COMPLETE whose net area is more than 10 % from the reference or whose missing edge footage exceeds a quarter of the reference footage of the scored line types. Aggregates only; property tables stay private.\n';
const md = `${head}\n## All properties\n\n${table(null)}\n\n## By roof type\n\n${table('roofType')}\n\n## By obstruction level\n\n${table('obstruction')}\n`;
if (out) { fs.writeFileSync(path.resolve(REPO, out), md); console.log('->', out); }
console.log(md);
