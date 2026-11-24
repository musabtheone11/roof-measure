// node treecmp.mjs results/old.jsonl results/a.jsonl [results/b.jsonl]  -> area accuracy on tree-covered synthetic roofs (paired seeds)
import fs from 'node:fs';
const L = (f) => new Map(fs.readFileSync(f, 'utf8').trim().split('\n').map((l) => JSON.parse(l)).filter((r) => !r.skipped && !r.error).map((r) => [r.seed, r]));
const sets = process.argv.slice(2).map((f) => [f, L(f)]); const base = sets[sets.length - 1][1];
const seeds = [...base.keys()].filter((s) => sets.every(([, m]) => m.has(s)) && base.get(s).meta.clutter.some((c) => c.startsWith('tree')));
const mean = (a) => a.reduce((s, v) => s + v, 0) / (a.length || 1);
for (const [lab, fn] of [['all tree roofs', () => true], ['mask kept under tree', (r) => r.meta.clutter.includes('tree')], ['mask cut by tree', (r) => r.meta.clutter.includes('tree-cut')]]) {
  const S = seeds.filter((s) => fn(base.get(s)));
  for (const [f, m] of sets) { const v = S.map((s) => m.get(s).areaErrPct); console.log(lab.padEnd(22), f.padEnd(26), 'n', String(S.length).padStart(4), ' area MAPE', mean(v.map(Math.abs)).toFixed(2) + '%', ' within 3%', (v.filter((x) => Math.abs(x) <= 3).length / (v.length || 1) * 100).toFixed(1) + '%', ' bias', mean(v).toFixed(2) + '%', m.get(S[0]) && m.get(S[0]).inferred != null ? ' flagged ' + S.filter((s) => m.get(s).inferred + m.get(s).unresolved > 0).length : ''); }
}
