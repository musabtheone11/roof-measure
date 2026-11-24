// Local dev server (any OS): node tools/dev/serve.mjs [port]
// Serves the app at http://localhost:8080/ and implements the two endpoints the app uses on localhost:
//   GET  /reports/<name>      cached height-model rasters and saved reports
//   POST /save?name=<file>    write the request body into the reports folder
// The reports folder (.devcache/reports) is git-ignored: it holds downloaded rasters and customer PDFs.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.mjs': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.pdf': 'application/pdf', '.tif': 'image/tiff', '.csv': 'text/csv' };
const safeName = (n) => path.basename(String(n || '')).replace(/[^\w.\- ()]+/g, '_');

export function start(port = 8080, opt = {}) {
  const ROOT = path.resolve(opt.root || process.env.RM_ROOT || HERE);
  const REPORTS = path.resolve(opt.reports || process.env.RM_REPORTS || path.join(HERE, '.devcache', 'reports'));
  fs.mkdirSync(REPORTS, { recursive: true });
  const srv = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://localhost');
    const send = (code, body, type = 'text/plain') => { res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' }); res.end(body); };
    try {
      if (req.method === 'POST' && u.pathname === '/save') {
        const name = safeName(u.searchParams.get('name')); if (!name) return send(400, 'name required');
        const chunks = []; req.on('data', (c) => chunks.push(c));
        req.on('end', () => { fs.writeFileSync(path.join(REPORTS, name), Buffer.concat(chunks)); send(200, JSON.stringify({ saved: true, name }), 'application/json'); });
        return;
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') return send(405, 'method not allowed');
      let file;
      if (u.pathname.startsWith('/reports/')) file = path.join(REPORTS, safeName(decodeURIComponent(u.pathname.slice(9))));
      else {
        const rel = decodeURIComponent(u.pathname === '/' ? '/index.html' : u.pathname);
        file = path.join(ROOT, rel);
        if (!file.startsWith(ROOT + path.sep) || /(^|\/)\.(git|devcache)(\/|$)/.test(rel) || rel.includes('/private/')) return send(403, 'forbidden');
      }
      if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return send(404, 'not found');
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      if (req.method === 'HEAD') return res.end();
      fs.createReadStream(file).pipe(res);
    } catch (e) { send(500, String(e)); }
  });
  return new Promise((resolve) => srv.listen(port, 'localhost', () => resolve(srv)));
}
if (process.argv[1] === fileURLToPath(import.meta.url)) { const port = +process.argv[2] || 8080; await start(port); console.log(`Roof Measure at http://localhost:${port}/`); }
