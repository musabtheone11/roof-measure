// node run.mjs --n 2000 --seed 1 --out results/base.jsonl [--engine ../]   (parallel over CPU cores)
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import os from 'node:os';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { summarizeGT, render, rng, randomHouse } from './synth.mjs';
import { loadEngine, trace } from './engine.mjs';
import { summarizeEngine, compare } from './score.mjs';
import { spatialScore } from './spatial.mjs';

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const EXACT = isMainThread ? process.argv.includes('--exact') : !!(workerData && workerData.exact);

export function runOne(ctx, seed) {
  const r = rng(seed * 7919 + 13);
  const wings = randomHouse(r);
  let gt; try { gt = summarizeGT(wings); } catch (e) { return { seed, skipped: 'gt-clip' }; }
  if (gt.minFacet < 0.6 || gt.sloped < 600) return { seed, skipped: 'degenerate' };
  const sc = render(wings, r);
  const t0 = Date.now();
  let res;
  try { res = trace(ctx, sc); } catch (e) { return { seed, error: String(e && e.message || e) }; }
  const en = summarizeEngine(res, 6, EXACT);
  const tagged = { inferred: res.facets.filter((f) => f.status === 'inferred').length, unresolved: res.facets.filter((f) => f.status === 'unresolved').length, repaired: (res.repairs || []).length, obscPct: res.obstruction ? res.obstruction.footprintObscuredPct : null,
    zones: res.obstruction && res.obstruction.hiddenZones ? res.obstruction.hiddenZones.length : 0, hiddenUpperSqft: res.obstruction && res.obstruction.hiddenZones ? res.obstruction.hiddenZones.reduce((a, z) => a + z.upperSqft, 0) : 0, gtSloped: gt.sloped, enSloped: en.sloped,
    obstFt: res.edges.filter((e) => e.type === 'obstruction').reduce((a, e) => { const L = e.line; let d = 0; for (let i = 1; i < L.length; i++) d += Math.hypot(L[i][0] - L[i - 1][0], L[i][1] - L[i - 1][1]); return a + d * 3.28084; }, 0) };
  // paired: the same trace scored with exact math (fitted slope, plane slope factors) -> x_ fields
  const ex = compare(gt, summarizeEngine(res, 6, true)); const x = { x_areaErrPct: ex.areaErrPct }; for (const t of ['rake', 'hip', 'valley', 'step', 'eave', 'ridge']) x['x_en_' + t] = ex['en_' + t];
  let spatial; try { spatial = spatialScore(gt.facets, res.facets); } catch { spatial = { spatialNotScored: true }; }
  return { ...spatial, seed, wings: wings.length, levels: new Set(wings.map((w) => w.eaveZ)).size, meta: sc.meta, ms: Date.now() - t0, ...tagged, ...x, ...compare(gt, en) };
}

if (isMainThread && process.argv[1] === fileURLToPath(import.meta.url)) {
  const n = +arg('n', 200), seed0 = +arg('seed', 1), out = arg('out', 'results/run.jsonl');
  fs.mkdirSync('results', { recursive: true });
  const nw = Math.max(1, Math.min(8, Math.floor(+arg('workers', Math.min(4, os.availableParallelism?.() || os.cpus().length))) || 1));
  const fh = fs.openSync(out, 'w'); let done = 0; const t0 = Date.now();
  await Promise.all(Array.from({ length: nw }, (_, k) => new Promise((resolve, reject) => {
    // --list file.json: run exactly these seeds (e.g. only the tree-covered houses of an earlier run)
    const listed = arg('list', null) ? JSON.parse(fs.readFileSync(arg('list'), 'utf8')) : null;
    const seeds = []; if (listed) { for (let i = k; i < listed.length; i += nw) seeds.push(listed[i]); } else for (let s = seed0 + k; s < seed0 + n; s += nw) seeds.push(s);
    const wk = new Worker(fileURLToPath(import.meta.url), { workerData: { seeds, engine: arg('engine', null), exact: process.argv.includes('--exact') } });
    wk.on('message', (row) => { fs.writeSync(fh, JSON.stringify(row) + '\n'); if (++done % 100 === 0) process.stderr.write(`${done}/${n} ${((Date.now() - t0) / 1000).toFixed(0)}s\n`); });
    wk.on('exit', (code) => code === 0 ? resolve() : reject(new Error('Benchmark worker exited ' + code))); wk.on('error', reject);
  })));
  fs.closeSync(fh);
  console.error('done', done, ((Date.now() - t0) / 1000).toFixed(0) + 's');
} else if (!isMainThread) {
  const files = workerData.engine ? ['autotrace.js', 'autotrace2.js', 'obstruction.js'].map((f) => workerData.engine + '/' + f) : undefined;
  const ctx = files ? loadEngine(files) : loadEngine();
  for (const s of workerData.seeds) parentPort.postMessage(runOne(ctx, s));
}
