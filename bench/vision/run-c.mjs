// Version C of the regional benchmark: the current engine's run (version B) with the accepted, evidence-checked edits of the
// independent vision review, taken through the real app (Import JSON -> report -> PDF) so the report, sketch and totals come
// from that exact model revision.
//   node bench/vision/run-c.mjs --from new-dev --label apinex-dev [--only slug,slug] [--port 8200] [--jobs 2]
// For each property of the source run: bench/vision/<slug>/fuse/job-c.json (from fuse.mjs --apply) is loaded with
// tools/dev/run-app.mjs --job; properties without a job-c.json (no observations) are copied from the source run unchanged,
// so the two versions cover the same properties. Writes version.json per property and generated.json like run.mjs.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url)), REPO = path.resolve(HERE, '..', '..');
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const from = arg('from', 'new-dev'), label = arg('label'), only = arg('only', null), port0 = +arg('port', 8200), jobs = +arg('jobs', 2);
if (!label) { console.error('--label required'); process.exit(2); }
const SRC = path.join(REPO, '.devcache', 'regional', from), OUT = path.join(REPO, '.devcache', 'regional', label); fs.mkdirSync(OUT, { recursive: true });
const srcVersion = JSON.parse(fs.readFileSync(path.join(SRC, 'version.json'), 'utf8'));
let slugs = fs.readdirSync(SRC).filter((s) => fs.existsSync(path.join(SRC, s, 'version.json')));
if (only) { const k = new Set(only.split(',')); slugs = slugs.filter((s) => k.has(s)); }
const version = { ...srcVersion, label, from, apinex: true, startedAt: new Date().toISOString() };
fs.writeFileSync(path.join(OUT, 'version.json'), JSON.stringify(version, null, 1));
console.log(`run ${label}: ${slugs.length} properties from ${from} (code ${srcVersion.commit ? srcVersion.commit.slice(0, 8) : '?'})`);
const results = [];
const runOne = (slug, port) => new Promise((resolve) => {
  const dir = path.join(OUT, slug), jobFile = path.join(REPO, '.devcache', 'vision', slug, 'fuse', 'job-c.json'), srcRec = JSON.parse(fs.readFileSync(path.join(SRC, slug, 'version.json'), 'utf8'));
  fs.rmSync(dir, { recursive: true, force: true });
  if (!fs.existsSync(jobFile)) {   // no review for this property: version C is version B here
    fs.cpSync(path.join(SRC, slug), dir, { recursive: true });
    const rec = { ...srcRec, version, unchanged: true, note: 'no vision review (no observations): copied from ' + from };
    fs.writeFileSync(path.join(dir, 'version.json'), JSON.stringify(rec, null, 1)); results.push(rec); console.log(`copy ${slug} (no review)`); return resolve();
  }
  fs.mkdirSync(dir, { recursive: true });
  for (const f of ['proposals.json', 'marks.json']) { const p = path.join(REPO, '.devcache', 'vision', slug, 'fuse', f); if (fs.existsSync(p)) fs.copyFileSync(p, path.join(dir, f)); }
  const a = [path.join(REPO, 'tools', 'dev', 'run-app.mjs'), '--job', jobFile, '--out', dir, '--port', String(port), '--root', path.join(REPO, srcVersion.root || '.')];
  const t0 = Date.now(); const ch = spawn(process.execPath, a, { env: process.env }); let log = '';
  ch.stdout.on('data', (d) => { log += d; }); ch.stderr.on('data', (d) => { log += d; });
  const kill = setTimeout(() => ch.kill('SIGKILL'), 10 * 60 * 1000);
  ch.on('close', (code) => {
    clearTimeout(kill); fs.writeFileSync(path.join(dir, 'run.log'), log);
    const failed = log.split('\n').filter((l) => l.startsWith('FAIL')).map((l) => l.slice(5, 200));
    const rec = { slug, exit: code, seconds: Math.round((Date.now() - t0) / 1000), failedSteps: failed, version, from: srcRec.version && srcRec.version.label, reviewed: true };
    fs.writeFileSync(path.join(dir, 'version.json'), JSON.stringify(rec, null, 1)); results.push(rec);
    console.log(`${code === 0 && !failed.length ? 'ok  ' : 'FAIL'} ${slug} (${rec.seconds}s)${failed.length ? ' ' + failed.join(' | ') : ''}`); resolve();
  });
});
let next = 0; const workers = []; for (let w = 0; w < jobs; w++) workers.push((async () => { while (next < slugs.length) { const i = next++; await runOne(slugs[i], port0 + i); } })());
await Promise.all(workers);
fs.writeFileSync(path.join(OUT, 'generated.json'), JSON.stringify({ version, finishedAt: new Date().toISOString(), runs: results }, null, 1));
console.log(`done: ${results.filter((r) => r.exit === 0 && !(r.failedSteps || []).length).length}/${results.length} -> ${path.relative(REPO, OUT)}`);
