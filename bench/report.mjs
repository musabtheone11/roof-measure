// node report.mjs results/a.jsonl [results/b.jsonl]  -> accuracy table (and A/B delta)
import fs from 'node:fs';
import { TYPES } from './score.mjs';

export function load(f) { return fs.readFileSync(f, 'utf8').trim().split('\n').map((l) => JSON.parse(l)); }
const med = (a) => { const s = a.slice().sort((p, q) => p - q); return s.length ? s[Math.floor(s.length / 2)] : NaN; };
const mean = (a) => a.reduce((s, v) => s + v, 0) / (a.length || 1);

export function stats(rows) {
  const ok = rows.filter((r) => !r.skipped && !r.error);
  const s = { n: ok.length, errors: rows.filter((r) => r.error).length };
  s.areaMAPE = mean(ok.map((r) => Math.abs(r.areaErrPct)));
  s.areaWithin3 = ok.filter((r) => Math.abs(r.areaErrPct) <= 3).length / ok.length * 100;
  s.facetExact = ok.filter((r) => r.facetsEN === r.facetsGT).length / ok.length * 100;
  s.facetRatio = mean(ok.map((r) => r.facetsEN / r.facetsGT));
  s.predPitchOK = ok.filter((r) => Math.round(r.predGT) === r.predEN).length / ok.length * 100;
  s.pitchMatch = mean(ok.map((r) => r.pitchMatchPct));
  // per line type: portfolio total ratio and per-house absolute error (ft) where it matters
  s.types = {};
  for (const t of TYPES) {
    const g = ok.reduce((a, r) => a + r['gt_' + t], 0), e = ok.reduce((a, r) => a + r['en_' + t], 0);
    const ae = ok.map((r) => Math.abs(r['en_' + t] - r['gt_' + t]));
    const rel = ok.filter((r) => r['gt_' + t] > 10).map((r) => Math.abs(r['en_' + t] - r['gt_' + t]) / r['gt_' + t] * 100);
    s.types[t] = { gt: g, en: e, ratio: g ? e / g : null, meanAbsFt: mean(ae), medRelPct: rel.length ? med(rel) : null, within10: rel.length ? rel.filter((v) => v <= 10).length / rel.length * 100 : null };
  }
  // ridge+hip combined (what ridge cap is ordered from)
  const rh = ok.filter((r) => r.gt_ridge + r.gt_hip > 10).map((r) => Math.abs(r.en_ridge + r.en_hip - r.gt_ridge - r.gt_hip) / (r.gt_ridge + r.gt_hip) * 100);
  s.ridgeHipMedRel = med(rh); s.ridgeHipWithin10 = rh.filter((v) => v <= 10).length / rh.length * 100;
  const dr = ok.map((r) => Math.abs(r.en_eave + r.en_rake - r.gt_eave - r.gt_rake) / (r.gt_eave + r.gt_rake) * 100);
  s.dripMedRel = med(dr); s.dripWithin10 = dr.filter((v) => v <= 10).length / dr.length * 100;
  // composite: share of houses where area within 3%, eave/rake/ridge+hip/valley each within 10% (or 5 ft)
  const good = (r, ks) => { const g = ks.reduce((a, k) => a + r['gt_' + k], 0), e = ks.reduce((a, k) => a + r['en_' + k], 0); return Math.abs(e - g) <= Math.max(5, 0.1 * g); };
  s.reportGrade = ok.filter((r) => Math.abs(r.areaErrPct) <= 3 && good(r, ['eave']) && good(r, ['rake']) && good(r, ['ridge', 'hip']) && good(r, ['valley']) && good(r, ['step', 'wall'])).length / ok.length * 100;
  s.msMean = mean(ok.map((r) => r.ms));
  return s;
}

export function print(s, label = '') {
  const f = (v, d = 1) => (v == null || Number.isNaN(v) ? '-' : v.toFixed(d));
  console.log(`\n== ${label}  houses=${s.n} errors=${s.errors}  ${f(s.msMean, 0)} ms/house`);
  console.log(`area MAPE ${f(s.areaMAPE, 2)}%  within3% ${f(s.areaWithin3)}%  | facets exact ${f(s.facetExact)}% ratio ${f(s.facetRatio, 2)} | predominant pitch ok ${f(s.predPitchOK)}%  pitch-area match ${f(s.pitchMatch)}%`);
  console.log(`ridge+hip median err ${f(s.ridgeHipMedRel)}% within10 ${f(s.ridgeHipWithin10)}% | drip(eave+rake) median ${f(s.dripMedRel)}% within10 ${f(s.dripWithin10)}% | REPORT-GRADE houses ${f(s.reportGrade)}%`);
  console.log('type         GT ft     EN ft   ratio  meanAbsFt  medRel%  within10%');
  for (const [t, v] of Object.entries(s.types)) console.log(`${t.padEnd(12)}${f(v.gt, 0).padStart(8)}${f(v.en, 0).padStart(10)}${f(v.ratio, 2).padStart(8)}${f(v.meanAbsFt).padStart(11)}${f(v.medRelPct).padStart(9)}${f(v.within10).padStart(11)}`);
}

if (process.argv[1].endsWith('report.mjs')) for (const f of process.argv.slice(2)) print(stats(load(f)), f);
