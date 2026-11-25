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
    const send = (code, body, type = 'text/plain') => { res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(body); };
    try {
      // only this machine's own pages may talk to the server: no DNS-rebinding hosts, no cross-site form posts
      const hosts = new Set([`localhost:${port}`, `127.0.0.1:${port}`]); if (!hosts.has(String(req.headers.host || '').toLowerCase())) return send(403, 'forbidden');
      if (req.method === 'POST' && u.pathname === '/save') {
        const origin = req.headers.origin; if (origin && origin !== `http://localhost:${port}` && origin !== `http://127.0.0.1:${port}`) return send(403, 'forbidden');
        const name = safeName(u.searchParams.get('name')); if (!name || name === '.' || name === '..' || name.length > 200) return send(400, 'bad name');
        const chunks = []; let size = 0, over = false;
        req.on('data', (c) => { size += c.length; if (size > 200 * 1024 * 1024) { over = true; req.destroy(); } else chunks.push(c); });
        req.on('end', () => { if (over) return; try { fs.writeFileSync(path.join(REPORTS, name), Buffer.concat(chunks)); send(200, JSON.stringify({ saved: true, name }), 'application/json'); } catch (e) { send(500, 'could not save'); } });
        return;
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') return send(405, 'method not allowed');
      let file, saved = false;
      if (u.pathname.startsWith('/reports/')) { file = path.join(REPORTS, safeName(decodeURIComponent(u.pathname.slice(9)))); saved = true; }
      else {
        const rel = decodeURIComponent(u.pathname === '/' ? '/index.html' : u.pathname);
        file = path.resolve(ROOT, '.' + path.sep + rel);
        // judged on the resolved path, segment by segment and case-insensitively (back-slashes and .GIT on Windows included)
        const segs = path.relative(ROOT, file).split(/[\\/]+/).map((q) => q.toLowerCase());
        if (!file.startsWith(ROOT + path.sep) || segs.some((q) => q === '..' || q === '.git' || q === '.devcache' || q === 'private' || q.startsWith('.env'))) return send(403, 'forbidden');
      }
      if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return send(404, 'not found');
      const ext = path.extname(file).toLowerCase(); const head = { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
      // saved files are data, never pages: anything that could run as a page is sent as a download
      if (saved && !['.tif', '.tiff', '.json', '.pdf', '.png', '.jpg', '.jpeg', '.csv'].includes(ext)) { head['Content-Type'] = 'application/octet-stream'; head['Content-Disposition'] = 'attachment'; }
      res.writeHead(200, head);
      if (req.method === 'HEAD') return res.end();
      fs.createReadStream(file).pipe(res);
    } catch (e) { send(500, 'server error'); }
  });
  return new Promise((resolve) => srv.listen(port, 'localhost', () => resolve(srv)));
}
if (process.argv[1] === fileURLToPath(import.meta.url)) { const port = +process.argv[2] || 8080; await start(port); console.log(`Roof Measure at http://localhost:${port}/`); }
