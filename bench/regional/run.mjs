// Regional benchmark runner: every property through the real UI, address -> imagery -> structure -> geometry -> PDF.
//   Key=<google key> node bench/regional/run.mjs --set dev|blind|all --label <run label> [--root <app dir>] [--alt] [--jobs 2] [--only slug,slug]
// Reads   bench/private/regional/manifest.json   (PRIVATE: addresses; never committed)
// Writes  .devcache/regional/<label>/<slug>/...   (PRIVATE: run-app.mjs outputs + version.json + pages/*.png)
// The same app code and the same settings are used for every property; nothing here is per address.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url)), REPO = path.resolve(HERE, '..', '..');
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const has = (k) => process.argv.includes('--' + k);
const label = arg('label'); if (!label) { console.error('--label required'); process.exit(2); }
const root = path.resolve(arg('root', REPO)), set = arg('set', 'dev'), jobs = +arg('jobs', 2), only = arg('only', null);
const M = JSON.parse(fs.readFileSync(path.join(REPO, 'bench', 'private', 'regional', 'manifest.json'), 'utf8'));
let props = M.properties.filter((p) => set === 'all' || p.group === set || (set === 'dev' && p.group === 'regression'));
if (only) { const s = new Set(only.split(',')); props = M.properties.filter((p) => s.has(p.slug)); }
const OUT = path.join(REPO, '.devcache', 'regional', label); fs.mkdirSync(OUT, { recursive: true });

// code version: commit of the app directory plus a hash of every app file actually served (catches uncommitted edits)
const appFiles = fs.readdirSync(root).filter((f) => /\.(js|html|css)$/.test(f)).sort();
const h = crypto.createHash('sha256'); for (const f of appFiles) h.update(f + '\0' + fs.readFileSync(path.join(root, f)));
let commit = null; try { commit = execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(); } catch (_) { /* not a checkout */ }
let dirty = null; try { dirty = execFileSync('git', ['-C', root, 'status', '--porcelain', '--', ...appFiles], { encoding: 'utf8' }).trim() !== ''; } catch (_) { /* ignore */ }
const version = { label, commit, dirty, appHash: h.digest('hex').slice(0, 16), root: path.relative(REPO, root) || '.', alt: has('alt'), startedAt: new Date().toISOString() };
fs.writeFileSync(path.join(OUT, 'version.json'), JSON.stringify(version, null, 1));
console.log(`run ${label}: ${props.length} properties, code ${commit ? commit.slice(0, 8) : '?'}${dirty ? '+edits' : ''} (${version.appHash})`);

const runOne = (p, port) => new Promise((resolve) => {
  const dir = path.join(OUT, p.slug); fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
  const a = [path.join(REPO, 'tools', 'dev', 'run-app.mjs'), '--address', p.address, '--out', dir, '--port', String(port), '--root', root, '--estimate'];
  if (has('alt')) a.push('--alt', '--altnote', 'reviewer second look (benchmark)');
  const t0 = Date.now(); const ch = spawn(process.execPath, a, { env: process.env }); let log = '';
  ch.stdout.on('data', (d) => { log += d; }); ch.stderr.on('data', (d) => { log += d; });
  const kill = setTimeout(() => ch.kill('SIGKILL'), 15 * 60 * 1000);
  ch.on('close', (code) => {
    clearTimeout(kill); fs.writeFileSync(path.join(dir, 'run.log'), log);
    const failed = log.split('\n').filter((l) => l.startsWith('FAIL')).map((l) => l.slice(5, 200));
    const rec = { slug: p.slug, exit: code, seconds: Math.round((Date.now() - t0) / 1000), failedSteps: failed, version };
    fs.writeFileSync(path.join(dir, 'version.json'), JSON.stringify(rec, null, 1));
    // pages for review: the whole report at reading resolution
    for (const f of ['report.pdf', 'report-alt.pdf']) if (fs.existsSync(path.join(dir, f))) {
      const pg = path.join(dir, 'pages', f.replace('.pdf', '')); fs.mkdirSync(pg, { recursive: true });
      try { execFileSync('pdftoppm', ['-r', '70', '-png', path.join(dir, f), path.join(pg, 'p')]); } catch (_) { /* reported by the scorer */ }
    }
    console.log(`${code === 0 && !failed.length ? 'ok  ' : 'FAIL'} ${p.slug} (${rec.seconds}s)${failed.length ? ' ' + failed.join(' | ') : ''}`);
    resolve(rec);
  });
});
const queue = props.slice(); const results = [];
await Promise.all(Array.from({ length: Math.max(1, jobs) }, (_, w) => (async () => { while (queue.length) { const p = queue.shift(); results.push(await runOne(p, 8300 + w)); } })()));
// a manifest of what was generated, with file hashes, written BEFORE anything is compared with a reference
const files = {}; for (const r of results) { const d = path.join(OUT, r.slug); for (const f of ['report.pdf', 'report-alt.pdf', 'roof.json', 'totals.json', 'roof-alt.json', 'totals-alt.json', 'estimate.pdf']) if (fs.existsSync(path.join(d, f))) files[r.slug + '/' + f] = crypto.createHash('sha256').update(fs.readFileSync(path.join(d, f))).digest('hex'); }
fs.writeFileSync(path.join(OUT, 'generated.json'), JSON.stringify({ version, finishedAt: new Date().toISOString(), runs: results.map((r) => ({ slug: r.slug, exit: r.exit, failedSteps: r.failedSteps, seconds: r.seconds })), files }, null, 1));
console.log(`done: ${results.filter((r) => r.exit === 0 && !r.failedSteps.length).length}/${results.length} ran cleanly -> ${path.relative(REPO, OUT)}`);
