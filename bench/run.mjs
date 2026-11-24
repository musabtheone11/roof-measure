// node run.mjs --n 2000 --seed 1 --out results/base.jsonl [--engine ../]   (parallel over CPU cores)
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import os from 'node:os';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { summarizeGT, render, rng, randomHouse } from './synth.mjs';
import { loadEngine, trace } from './engine.mjs';
import { summarizeEngine, compare } from './score.mjs';

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };

export function runOne(ctx, seed) {
  const r = rng(seed * 7919 + 13);
  const wings = randomHouse(r);
  let gt; try { gt = summarizeGT(wings); } catch (e) { return { seed, skipped: 'gt-clip' }; }
  if (gt.minFacet < 0.6 || gt.sloped < 600) return { seed, skipped: 'degenerate' };
  const sc = render(wings, r);
  const t0 = Date.now();
  let res;
  try { res = trace(ctx, sc); } catch (e) { return { seed, error: String(e && e.message || e) }; }
  const en = summarizeEngine(res);
  return { seed, wings: wings.length, levels: new Set(wings.map((w) => w.eaveZ)).size, meta: sc.meta, ms: Date.now() - t0, ...compare(gt, en) };
}

if (isMainThread && process.argv[1] === fileURLToPath(import.meta.url)) {
  const n = +arg('n', 200), seed0 = +arg('seed', 1), out = arg('out', 'results/run.jsonl');
  fs.mkdirSync('results', { recursive: true });
  const nw = Math.max(1, os.cpus().length);
  const fh = fs.openSync(out, 'w'); let done = 0; const t0 = Date.now();
  await Promise.all(Array.from({ length: nw }, (_, k) => new Promise((resolve) => {
    const seeds = []; for (let s = seed0 + k; s < seed0 + n; s += nw) seeds.push(s);
    const wk = new Worker(fileURLToPath(import.meta.url), { workerData: { seeds, engine: arg('engine', null) } });
    wk.on('message', (row) => { fs.writeSync(fh, JSON.stringify(row) + '\n'); if (++done % 100 === 0) process.stderr.write(`${done}/${n} ${((Date.now() - t0) / 1000).toFixed(0)}s\n`); });
    wk.on('exit', resolve); wk.on('error', (e) => { console.error(e); resolve(); });
  })));
  fs.closeSync(fh);
  console.error('done', done, ((Date.now() - t0) / 1000).toFixed(0) + 's');
} else if (!isMainThread) {
  const files = workerData.engine ? ['autotrace.js', 'autotrace2.js'].map((f) => workerData.engine + '/' + f) : undefined;
  const ctx = files ? loadEngine(files) : loadEngine();
  for (const s of workerData.seeds) parentPort.postMessage(runOne(ctx, s));
}
