// node report_real.mjs  -> private/results/compare.md (full, private) and REAL_RESULTS.md (aggregate, no addresses)
import fs from 'node:fs';
import path from 'node:path';
import { BENCH } from './appcore.mjs';
const OUT = path.join(BENCH, 'private', 'results');
const recs = fs.readdirSync(OUT).filter((f) => f.endsWith('.json') && !f.endsWith('.dump.json') && f !== 'compare.json').map((f) => JSON.parse(fs.readFileSync(path.join(OUT, f), 'utf8'))).sort((a, b) => a.slug.localeCompare(b.slug));
const ok = recs.filter((r) => !r.error);
const med = (a) => { const s = a.filter((v) => v != null && isFinite(v)).sort((p, q) => p - q); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : null; };
const f1 = (v, d = 1) => (v == null || !isFinite(v) ? '-' : v.toFixed(d));
const hash = (s) => { let h = 2166136261; for (const c of s) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };
// fixed split by a hash of the address slug, so later tuning can be done on one half and checked on the other
for (const r of recs) r.split = hash(r.slug) % 2 ? 'validation' : 'development';
const TOL = { 'sq ft': [0, 3], facets: [1, 15], 'x/12': [0.5, 0], ft: [5, 10] };
const within = (ref, v, unit) => { const [a, p] = TOL[unit] || [5, 10]; return Math.abs(v - ref) <= Math.max(a, p / 100 * Math.abs(ref)); };
function agg(set, metric) {
  const rows = set.flatMap((r) => r.rows.filter((x) => x.metric === metric && x.ref != null).map((x) => ({ ...x, slug: r.slug })));
  if (!rows.length) return null; const pe = (v, ref) => (ref !== 0 ? Math.abs(v - ref) / Math.abs(ref) * 100 : (v === 0 ? 0 : null));
  return { metric, unit: rows[0].unit, n: rows.length, medOld: med(rows.map((x) => pe(x.old, x.ref))), medNew: med(rows.map((x) => pe(x.new, x.ref))), medAbsOld: med(rows.map((x) => Math.abs(x.old - x.ref))), medAbsNew: med(rows.map((x) => Math.abs(x.new - x.ref))),
    inOld: rows.filter((x) => within(x.ref, x.old, x.unit)).length, inNew: rows.filter((x) => within(x.ref, x.new, x.unit)).length, biasNew: med(rows.map((x) => (x.ref !== 0 ? (x.new - x.ref) / x.ref * 100 : null))),
    worst: rows.slice().sort((a, b) => (pe(b.new, b.ref) || 0) - (pe(a.new, a.ref) || 0)).slice(0, 3).map((x) => ({ slug: x.slug, ref: x.ref, new: x.new, old: x.old, pct: pe(x.new, x.ref) })) };
}
const METRICS = [...new Set(ok.flatMap((r) => r.rows.map((x) => x.metric)))];
const table = (set, withWorst, idOf) => { let s = '| Metric | Houses with a reference | Median abs. error, old | Median abs. error, new | Within tolerance, old | Within tolerance, new | Median signed error, new |\n|---|---|---|---|---|---|---|\n';
  for (const m of METRICS) { const a = agg(set, m); if (!a) continue; const u = a.unit === 'ft' || a.unit === 'sq ft' ? '%' : ''; const show = (pct, abs) => (a.unit === 'x/12' || a.unit === 'facets' ? `${f1(abs)} ${a.unit}` : `${f1(pct)}%`);
    s += `| ${m} | ${a.n} | ${show(a.medOld, a.medAbsOld)} | ${show(a.medNew, a.medAbsNew)} | ${a.inOld} of ${a.n} | ${a.inNew} of ${a.n} | ${f1(a.biasNew)}${u || '%'} |\n`; }
  return s; };
const clear = ok.filter((r) => !r.obstructed), obst = ok.filter((r) => r.obstructed);
const yearsOld = (r) => (r.imageryDate && r.refImageryDate ? (new Date(r.refImageryDate) - new Date(r.imageryDate)) / 3.15576e10 : null);
// ---- private, full detail
let md = `# Roof Measure vs reference reports - property detail (PRIVATE: customer addresses)\n\nGenerated ${new Date().toISOString().slice(0, 10)}. Old app = engine as deployed 2026-11-23; new app = this branch. Each roof was traced from Google Solar data only; reference numbers were not given to the engine.\nTolerance used for "within tolerance": area 3%, lengths the larger of 5 ft or 10%, facet count the larger of 1 or 15%, pitch 0.5/12.\n\n`;
md += `## Summary (${ok.length} properties traced, ${recs.length - ok.length} failed)\n\n### All properties\n\n${table(ok)}\n### Clear roofs (${clear.length})\n\n${table(clear)}\n### Tree-obstructed roofs (${obst.length}: canopy hides 2% or more of the footprint, or an unresolved facet)\n\n${obst.length ? table(obst) : '_none_\n'}\n### Validation half by address hash (${ok.filter((r) => r.split === 'validation').length})\n\n${table(ok.filter((r) => r.split === 'validation'))}\n`;
md += `## Worst cases, net sloped area (new app)\n\n`; { const a = agg(ok, 'Net sloped roof area'); if (a) for (const w of a.worst) { const r = ok.find((x) => x.slug === w.slug); md += `- **${r.address}**: reference ${w.ref}, old ${f1(w.old, 0)}, new ${f1(w.new, 0)} (${f1(w.pct)}% off). Google imagery ${r.imageryDate} (${r.imageryQuality}); reference imagery ${r.refImageryDate || 'not printed'}; scope ${r.scope}; structures traced ${r.structures.new}; canopy over roof ${f1(r.obstruction ? r.obstruction.footprintObscuredPct : 0)}%.\n`; } }
md += `\n## Exclusions and failures\n\n`; for (const r of recs.filter((x) => x.error)) md += `- ${r.address}: not traced (${r.error})\n`; for (const r of ok) { if (r.adjusterScope && r.adjusterScope !== 'whole-roof') md += `- ${r.address}: adjuster estimate is "${r.adjusterScope}" - its quantities are shown but not scored\n`; if (!r.adjusterScope) md += `- ${r.address}: no adjuster estimate found\n`; }
for (const r of recs) {
  md += `\n---\n\n## ${r.address}\n\n`;
  if (r.error) { md += `Not traced: ${r.error}\n`; continue; }
  md += `Reference: ${r.vendor || 'none'}${r.refImageryDate ? ', imagery ' + r.refImageryDate : ''}. Google imagery ${r.imageryDate} (${r.imageryQuality}). Scope compared: ${r.scope}. Split: ${r.split}. Canopy over roof: ${f1(r.obstruction ? r.obstruction.footprintObscuredPct : 0)}% of footprint${r.obstructed ? ' (**obstructed**)' : ''}. New-app geometry checks: ${r.audit.errors} errors, ${r.audit.warnings} warnings, ${r.repairs} automatic repairs. Area status (new): measured ${f1(r.new.status.measured, 0)}, inferred ${f1(r.new.status.inferred, 0)}, unresolved ${f1(r.new.status.unresolved, 0)} sq ft.\n\n`;
  md += `![old vs new](${r.slug}.png)\n\nReference sketch: the report PDFs could be read as text only in this session, so the reference sketch is not registered against the trace (pending: export the report page as an image to compare footprints).\n\n`;
  md += `| Metric | Unit | Reference | Source | Old app | New app | New - ref | Abs. diff | % error | Status / note |\n|---|---|---|---|---|---|---|---|---|---|\n`;
  for (const x of r.rows) md += `| ${x.metric} | ${x.unit} | ${x.ref == null ? 'not documented' : x.ref} | ${x.source} | ${f1(x.old)} | ${f1(x.new)} | ${f1(x.signed)} | ${f1(x.abs)} | ${x.pct == null ? '-' : f1(x.pct) + '%'} | ${x.status}${x.note ? '; ' + x.note : ''} |\n`;
  if (r.notes) md += `\nReference notes: ${r.notes}\n`;
}
fs.writeFileSync(path.join(OUT, 'compare.md'), md);
// ---- public aggregate (no addresses)
const ids = new Map(ok.slice().sort((a, b) => hash(a.slug) - hash(b.slug)).map((r, i) => [r.slug, 'P' + String(i + 1).padStart(2, '0')]));
let pub = `# Real-house benchmark: Roof Measure vs same-property reference reports\n\nRun ${new Date().toISOString().slice(0, 10)} with \`node compare.mjs && node report_real.mjs\`. ${ok.length} properties traced (${recs.length - ok.length} could not be traced). Property-level tables, addresses and sketches are private (\`bench/private/\`, git-ignored).\n\n`;
pub += `- **Reference**: third-party roof measurement reports (Roofr, GAF QuickMeasure, EagleView) and, where the insurance estimate covers the whole roof, the adjuster's roof sketch totals.\n- **Old app** = engine as deployed 2026-11-23 with its measurement math; **new app** = this branch.\n- Each roof is traced from Google Solar data only. Reference numbers are never given to the engine.\n- Tolerances: area 3%; lengths the larger of 5 ft or 10%; facet count the larger of 1 or 15%; pitch 0.5/12. Missing reference values are not scored and never count as a pass.\n- **New app** numbers are the first trace alone (confirmed + estimated area; hidden zones are in no total). The reviewer's second look with another dated dataset is not used here.\n- The hidden-zone update (obstruction boundaries, hidden zones, evidence rules) was developed on the synthetic bench and on one tree-covered property that is in this set, so that property is not an independent test of it; the other 22 are.\n- No engine parameter was fitted to these reference numbers. The engine was developed on the synthetic bench and one sample property; after the first run on this set, four fixes were made (canopy ring fill, canopy-limited edges marked unresolved, double-traced lines removed, a cache key), prompted by the synthetic tree roofs, the sample property and one clear roof in this set. The \"validation half\" below is a fixed split by a hash of the address, shown so future tuning can be checked against a half that was not used for it.\n\n`;
pub += `## All properties (${ok.length})\n\n${table(ok)}\n## Clear roofs (${clear.length})\n\n${table(clear)}\n## Tree-obstructed roofs (${obst.length})\n\n${obst.length ? table(obst) : '_none in this set_\n'}\n## Validation half by address hash (${ok.filter((r) => r.split === 'validation').length})\n\n${table(ok.filter((r) => r.split === 'validation'))}\n`;
pub += `## Per property (anonymised)\n\n| ID | Complexity | Reference | Google imagery | Reference imagery | Canopy over roof | Facets ref / old / new | Area error old | Area error new | Split |\n|---|---|---|---|---|---|---|---|---|---|\n`;
for (const r of ok.slice().sort((a, b) => ids.get(a.slug).localeCompare(ids.get(b.slug)))) { const a = r.rows.find((x) => x.metric === 'Net sloped roof area'), fc = r.rows.find((x) => x.metric === 'Facet count');
  pub += `| ${ids.get(r.slug)} | ${r.complexity || '-'} | ${r.vendor || '-'} | ${r.imageryDate ? r.imageryDate.slice(0, 4) : '-'} ${String(r.imageryQuality || '').toLowerCase()} | ${r.refImageryDate ? r.refImageryDate.slice(0, 4) : 'not printed'} | ${f1(r.obstruction ? r.obstruction.footprintObscuredPct : 0)}% | ${fc && fc.ref != null ? fc.ref : '-'} / ${r.old.facets} / ${r.new.facets} | ${a && a.ref ? f1(a.pctOld) + '%' : '-'} | ${a && a.ref ? f1(a.pct) + '%' : '-'} | ${r.split} |\n`; }
fs.writeFileSync(path.join(BENCH, 'REAL_RESULTS.md'), pub);
console.log(table(ok)); console.log('clear', clear.length, 'obstructed', obst.length, 'failed', recs.length - ok.length);
