// Regional benchmark scorer: accuracy AND coverage, per property and per roof type / obstruction level.
//   node bench/regional/score.mjs --label <run label> [--compare <baseline label>]
// Reads   bench/private/regional/manifest.json, conditions.json, review-<label>.json (visual review, optional),
//         bench/private/truth/<slug>.json (same-property references), .devcache/regional/<label>/<slug>/ (run outputs)
// Writes  bench/private/regional/score-<label>.json + .md  (PRIVATE: property level)
//         bench/regional/RESULTS-<label>.md                 (aggregate only, properties as R01.. ids: safe to commit)
// Rules: no approved tolerances exist, so differences are shown and nothing is called a pass. A value the reference does
// not print is "not scored" (never zero, never a pass). A value the run did not produce is "missing" and counted.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url)), REPO = path.resolve(HERE, '..', '..'), PRIV = path.join(REPO, 'bench', 'private');
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const label = arg('label'); const RUN = path.join(REPO, '.devcache', 'regional', label);
const M = JSON.parse(fs.readFileSync(path.join(PRIV, 'regional', 'manifest.json'), 'utf8'));
const COND = fs.existsSync(path.join(PRIV, 'regional', 'conditions.json')) ? JSON.parse(fs.readFileSync(path.join(PRIV, 'regional', 'conditions.json'), 'utf8')) : {};
const revF = path.join(PRIV, 'regional', `review-${label}.json`); const REV = fs.existsSync(revF) ? JSON.parse(fs.readFileSync(revF, 'utf8')) : {};
const TYPES = ['eave', 'rake', 'ridge', 'hip', 'valley', 'step', 'wall', 'transition'];
const CONFUSE = [['eave', 'rake'], ['ridge', 'hip'], ['hip', 'valley'], ['step', 'wall'], ['ridge', 'transition'], ['eave', 'transition']];
const v = (x) => (x && x.value != null && isFinite(x.value) ? +x.value : null);
const rd = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (_) { return null; } };

function engineNumbers(tot, mainOnly) {
  if (!tot) return null;
  const F = tot.facets.filter((f) => !f.excluded && (!mainOnly || (f.structure || 1) === 1)), E = tot.edges.filter((e) => !mainOnly || (e.structure || 1) === 1);
  const by = {}; for (const t of TYPES) by[t] = 0; for (const e of E) if (by[e.type] != null) by[e.type] += e.trueFt;
  const pa = {}; for (const f of F) pa[f.pitch] = (pa[f.pitch] || 0) + f.sloped; const pred = Object.keys(pa).sort((a, b) => pa[b] - pa[a])[0];
  return { sloped: F.reduce((s, f) => s + f.sloped, 0), facets: F.length, predominant: pred != null ? +pred : null, byType: by, statusArea: F.reduce((o, f) => { o[f.status || 'measured'] = (o[f.status || 'measured'] || 0) + f.sloped; return o; }, {}) };
}
// the report's status as a reader sees it: did the app ask for review before export, or state the roof is not fully measured?
function reportStatus(dir, tot, runRec, isAlt) {
  // the automatic report fails only on the steps up to its PDF; a failure in the reviewer's second look fails the reviewed output only
  const core = (runRec && runRec.failedSteps || []).filter((f) => /^(load app|address|get roof data|auto-trace|download PDF report\.pdf)/.test(f));
  const altFail = (runRec && runRec.failedSteps || []).filter((f) => !core.includes(f));
  const want = isAlt ? 'report-alt.pdf' : 'report.pdf';
  if (!runRec || core.length || !fs.existsSync(path.join(dir, want)) || (isAlt && altFail.length && !fs.existsSync(path.join(dir, 'totals-alt.json')))) return { status: 'failed', why: runRec ? [...core, ...(isAlt ? altFail : [])].join('; ') || 'no ' + want : 'not run' };
  const log = fs.existsSync(path.join(dir, 'run.log')) ? fs.readFileSync(path.join(dir, 'run.log'), 'utf8') : '';
  const a0 = tot && tot.audit; if (a0 && a0.reportStatus) return { status: a0.reportStatus.status === 'COMPLETE' ? 'complete' : 'review-required', why: a0.reportStatus.reasons.map((q) => q.text).join('; '), stated: true };
  const gate = /export gate asked: (.*)/.exec(log); const a = tot && tot.audit; const reasons = [];
  if (gate) reasons.push('export gate: ' + gate[1].slice(0, 160));
  if (a) { if ((a.hiddenZones || []).length) reasons.push(a.hiddenZones.length + ' hidden zone(s)'); if (a.inferredSloped > 0.5) reasons.push(Math.round(a.inferredSloped) + ' sq ft estimated'); if ((a.unresolved || []).length) reasons.push(a.unresolved.length + ' unresolved item(s)'); if ((a.verify || []).length) reasons.push(a.verify.length + ' marked for verification'); if ((a.issues || []).length) reasons.push(a.issues.length + ' geometry issue(s)'); }
  return { status: reasons.length ? 'review-required' : 'complete', why: reasons.join('; ') };
}
const rows = [];
for (const p of M.properties) {
  const dir = path.join(RUN, p.slug); if (!fs.existsSync(dir)) continue; /* not part of this run (e.g. blind properties in a development run) */ const runRec = rd(path.join(dir, 'version.json')); const T = rd(path.join(PRIV, 'truth', p.slug + '.json'));
  const out = { slug: p.slug, id: p.id, group: p.group, town: p.town, roofType: p.roofType, obstruction: p.obstruction, features: p.features || [], conditions: COND[p.slug] || null, reference: 'none', run: null, versions: {} };
  for (const v2 of ['', '-alt']) {
    const tot = rd(path.join(dir, `totals${v2}.json`)); if (!tot && v2) continue;
    const st = reportStatus(dir, tot, runRec, !!v2); if (v2 && st.status !== 'failed') { /* reviewed output: same rules */ }
    const mr = T && T.measurementReport, ad = T && T.adjusterReport;
    const refStructs = mr && Array.isArray(mr.structures) ? mr.structures.length : 0; const mainOnly = !(refStructs > 1);
    const E = engineNumbers(tot, mainOnly), Eall = engineNumbers(tot, false);
    const cmp = []; const add = (metric, unit, ref, src, val) => { const has = ref != null; const scored = has && val != null; cmp.push({ metric, unit, ref, src, val, diff: scored ? val - ref : null, pct: scored && ref ? (val - ref) / ref * 100 : null, state: !has ? 'not printed by reference (not scored)' : val == null ? 'MISSING from run (counted)' : 'scored' }); };
    if (mr) {
      const lab = mr.vendor || 'measurement report';
      add('Net sloped area', 'sq ft', v(mr.areaSqft), lab, E ? E.sloped : null); add('Facets', 'count', v(mr.facets), lab, E ? E.facets : null); add('Predominant pitch', 'x/12', v(mr.predominantPitch), lab, E ? E.predominant : null);
      for (const t of TYPES) add(t, 'ft', mr.ft ? v(mr.ft[t]) : null, lab, E ? E.byType[t] : null);
    }
    if (ad && ad.roofSketch && ad.scope === 'whole-roof') { const sk = ad.roofSketch; add('Net sloped area (adjuster)', 'sq ft', v(sk.surfaceAreaSf), 'adjuster sketch', Eall ? Eall.sloped : null); add('ridge (adjuster)', 'ft', v(sk.ridgeLf), 'adjuster sketch', Eall ? Eall.byType.ridge : null); add('hip (adjuster)', 'ft', v(sk.hipLf), 'adjuster sketch', Eall ? Eall.byType.hip : null); add('valley (adjuster)', 'ft', v(sk.valleyLf), 'adjuster sketch', Eall ? Eall.byType.valley : null); add('eave + rake (adjuster)', 'ft', v(sk.perimeterLf), 'adjuster sketch', Eall ? Eall.byType.eave + Eall.byType.rake : null); }
    // missing / extra by line type (only where the reference prints the type); possible misclassification between confusable types
    const edges = {}; if (mr && mr.ft && E) for (const t of TYPES) { const r = v(mr.ft[t]); if (r == null) continue; edges[t] = { ref: r, run: E.byType[t], missingFt: Math.max(0, r - E.byType[t]), extraFt: Math.max(0, E.byType[t] - r) }; }
    const swap = []; for (const [a, b] of CONFUSE) if (edges[a] && edges[b]) { const m1 = Math.min(edges[a].extraFt, edges[b].missingFt), m2 = Math.min(edges[b].extraFt, edges[a].missingFt); if (m1 > 5) swap.push(`${a}->${b} up to ${Math.round(m1)} ft`); if (m2 > 5) swap.push(`${b}->${a} up to ${Math.round(m2)} ft`); }
    const unspec = mr && mr.ft ? v(mr.ft.unspecified) : null;
    // discrepancy between the two references (investigate, do not average)
    let disc = null; if (mr && ad && ad.roofSketch && ad.scope === 'whole-roof' && v(mr.areaSqft) && v(ad.roofSketch.surfaceAreaSf)) { const d = (v(ad.roofSketch.surfaceAreaSf) - v(mr.areaSqft)) / v(mr.areaSqft) * 100; if (Math.abs(d) > 5) disc = `adjuster sketch ${d > 0 ? '+' : ''}${d.toFixed(1)}% vs ${mr.vendor || 'measurement report'}`; }
    out.reference = mr ? (mr.vendor || 'measurement report') + (ad && ad.roofSketch ? ' + adjuster sketch' + (ad.scope !== 'whole-roof' ? ' (partial scope, not scored)' : '') : '') : (ad && ad.roofSketch ? 'adjuster sketch' : 'none: numerical accuracy unverified');
    out.versions[v2 ? 'reviewed' : 'automatic'] = { status: st.status, statusWhy: st.why, scope: mainOnly ? 'main structure' : 'all structures', run: E, allStructures: Eall ? { sloped: Eall.sloped, structures: tot.structures.length } : null, compare: cmp, edges, possibleSwaps: swap, refUnspecifiedFt: unspec, referenceDiscrepancy: disc };
  }
  out.run = runRec ? { exit: runRec.exit, seconds: runRec.seconds, failedSteps: runRec.failedSteps, code: runRec.version } : null;
  out.review = REV[p.slug] || null;
  // release blockers: an unsupported value shown as measured, or an incomplete report exported as complete (from the visual review)
  out.blockers = []; const A = out.versions.automatic;
  if (out.review && A) {
    const r = out.review;
    if (A.status === 'complete' && (r.missingRoof || []).some((m) => (m.approxSqft || 0) >= 50)) out.blockers.push('incomplete report exported as complete: ' + r.missingRoof.map((m) => m.what).join('; '));
    if (r.wrongBuilding && A.status !== 'failed') out.blockers.push('wrong building measured and reported');
    if ((r.extraRoof || []).some((m) => (m.approxSqft || 0) >= 50 && m.reportedAsMeasured)) out.blockers.push('non-roof area reported as measured roof: ' + r.extraRoof.filter((m) => m.reportedAsMeasured).map((m) => m.what).join('; '));
  }
  rows.push(out);
}
fs.writeFileSync(path.join(PRIV, 'regional', `score-${label}.json`), JSON.stringify(rows, null, 1));

// ---------------------------------------------------------------- tables
const f0 = (x) => (x == null ? '-' : Math.round(x).toLocaleString('en-US')), f1 = (x) => (x == null ? '-' : (x > 0 ? '+' : '') + x.toFixed(1));
const med = (a) => { const q = a.filter((x) => x != null && isFinite(x)).sort((p, q2) => p - q2); return q.length ? (q.length % 2 ? q[q.length >> 1] : (q[q.length / 2 - 1] + q[q.length / 2]) / 2) : null; };
function propTable(priv) {
  const L = ['| ' + (priv ? 'Property | Town' : 'ID | Town') + ' | Group | Roof type | Obstruction | Reference | Auto status | Area run / ref (diff %) | Pitch run / ref | Facets run / ref | Missing / extra ft (by type) | Reviewed | Blockers |', '|' + '---|'.repeat(13)];
  for (const r of rows) {
    const A = r.versions.automatic || {}; const c = (m) => (A.compare || []).find((x) => x.metric === m);
    const area = c('Net sloped area') || c('Net sloped area (adjuster)'); const pit = c('Predominant pitch'), fac = c('Facets');
    const me = A.edges ? Object.entries(A.edges).filter(([, e]) => e.missingFt > 5 || e.extraFt > 5).map(([t, e]) => `${t} ${e.missingFt > 5 ? '-' + Math.round(e.missingFt) : ''}${e.extraFt > 5 ? '+' + Math.round(e.extraFt) : ''}`).join(', ') : '';
    const R = r.versions.reviewed; const ra = R ? ((R.compare || []).find((x) => x.metric === 'Net sloped area') || {}) : null;
    L.push(`| ${priv ? r.slug : r.id} | ${r.town || ''} | ${r.group} | ${r.roofType || ''} | ${r.obstruction || ''} | ${r.reference} | ${A.status || 'failed'} | ${area ? `${f0(area.val)} / ${f0(area.ref)} (${f1(area.pct)})` : A.run ? f0(A.run.sloped) + ' / unverified' : '-'} | ${pit ? `${pit.val ?? '-'} / ${pit.ref}` : '-'} | ${fac ? `${fac.val ?? '-'} / ${fac.ref}` : '-'} | ${me || (A.edges && Object.keys(A.edges).length ? 'within 5 ft each' : '-')} | ${R ? R.status + (ra && ra.pct != null ? ' (' + f1(ra.pct) + '%)' : '') : '-'} | ${r.blockers.length ? r.blockers.length + ': ' + (priv ? r.blockers.join(' / ') : 'see private log') : 'none'} |`);
  }
  return L.join('\n');
}
function groupTable(key) {
  const keys = [...new Set(rows.map((r) => r[key] || 'untagged'))];
  const L = [`| ${key === 'roofType' ? 'Roof type' : 'Obstruction'} | Properties | Complete / review required / failed | Area: median abs. diff % (n scored) | Area: median signed % | Pitch: median abs. diff (n) | Facets: median run - ref (n) | Edge ft missing / extra (sum over scored types) | Values missing from runs | Release blockers |`, '|' + '---|'.repeat(10)];
  for (const k of keys) {
    const G = rows.filter((r) => (r[key] || 'untagged') === k); const A = G.map((r) => r.versions.automatic).filter(Boolean);
    const st = (s) => G.filter((r) => (r.versions.automatic ? r.versions.automatic.status : 'failed') === s).length;
    const pick = (m) => A.map((a) => (a.compare || []).find((x) => x.metric === m)).filter((x) => x && x.state === 'scored');
    const ar = pick('Net sloped area'), pt = pick('Predominant pitch'), fc = pick('Facets');
    const miss = A.reduce((s, a) => s + Object.values(a.edges || {}).reduce((q, e) => q + e.missingFt, 0), 0), extra = A.reduce((s, a) => s + Object.values(a.edges || {}).reduce((q, e) => q + e.extraFt, 0), 0);
    const missingVals = A.reduce((s, a) => s + (a.compare || []).filter((x) => x.state.startsWith('MISSING')).length, 0);
    const pct = (n) => (G.length ? Math.round(100 * n / G.length) + '%' : '-');
    L.push(`| ${k} | ${G.length} | ${pct(st('complete'))} / ${pct(st('review-required'))} / ${pct(st('failed'))} | ${ar.length ? med(ar.map((x) => Math.abs(x.pct))).toFixed(1) : '-'} (${ar.length}) | ${ar.length ? f1(med(ar.map((x) => x.pct))) : '-'} | ${pt.length ? med(pt.map((x) => Math.abs(x.diff))).toFixed(1) : '-'} (${pt.length}) | ${fc.length ? f1(med(fc.map((x) => x.diff))) : '-'} (${fc.length}) | ${f0(miss)} / ${f0(extra)} | ${missingVals} | ${G.reduce((s, r) => s + r.blockers.length, 0)} |`);
  }
  return L.join('\n');
}
const head = `Run \`${label}\`, code ${(rows.find((r) => r.run) || {}).run ? JSON.stringify((rows.find((r) => r.run)).run.code && { commit: rows.find((r) => r.run).run.code.commit, appHash: rows.find((r) => r.run).run.code.appHash, dirty: rows.find((r) => r.run).run.code.dirty }) : '?'}. ${rows.length} properties.\nNo approved tolerances exist: differences are shown, nothing is called a pass. "Not scored" = the reference does not print the value. Values the run did not produce are counted as missing, never as zero.\n`;
fs.writeFileSync(path.join(PRIV, 'regional', `score-${label}.md`), `# Regional benchmark (PRIVATE: addresses)\n\n${head}\n## By roof type\n\n${groupTable('roofType')}\n\n## By obstruction level\n\n${groupTable('obstruction')}\n\n## Property by property\n\n${propTable(true)}\n`);
fs.writeFileSync(path.join(REPO, 'bench', 'regional', `RESULTS-${label}.md`), `# Regional benchmark: aggregate results\n\n${head}\nAggregates only: the property-by-property table, addresses and reference documents stay in the private folder (bench/private/regional/score-<label>.md).\n\n## By roof type\n\n${groupTable('roofType')}\n\n## By obstruction level\n\n${groupTable('obstruction')}\n`);
console.log(groupTable('roofType')); console.log(); console.log(groupTable('obstruction'));
