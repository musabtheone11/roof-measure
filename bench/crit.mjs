import { load } from './report.mjs';
for (const f of process.argv.slice(2)) {
  const ok = load(f).filter((r) => !r.skipped && !r.error);
  const good = (r, ks) => { const g = ks.reduce((a, k) => a + r['gt_' + k], 0), e = ks.reduce((a, k) => a + r['en_' + k], 0); return Math.abs(e - g) <= Math.max(5, 0.1 * g); };
  const C = { area: (r) => Math.abs(r.areaErrPct) <= 3, eave: (r) => good(r, ['eave']), rake: (r) => good(r, ['rake']), ridgehip: (r) => good(r, ['ridge', 'hip']), valley: (r) => good(r, ['valley']), stepwall: (r) => good(r, ['step', 'wall']), notrans: (r) => r.en_transition - r.gt_transition <= 5 };
  const pct = (fn, rows) => (rows.filter(fn).length / rows.length * 100).toFixed(1);
  for (const [lab, rows] of [['all', ok], ['easy', ok.filter((r) => !r.meta.hard)], ['hard', ok.filter((r) => r.meta.hard)], ['notree-easy', ok.filter((r) => !r.meta.hard && !r.meta.clutter.some((c) => c.startsWith('tree')))]])
    console.log(f.padEnd(22), lab.padEnd(12), rows.length, Object.entries(C).map(([k, fn]) => k + ' ' + pct(fn, rows)).join(' | '), '| ALL', pct((r) => Object.values(C).slice(0, 6).every((fn) => fn(r)), rows));
}
