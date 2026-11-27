import {open, lstat, readdir, realpath} from 'node:fs/promises';
import {resolve, relative, isAbsolute, extname} from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';

const EXTENSIONS = new Set(['.pdf', '.txt', '.json']);
export class DownloadsDiscovery {
  constructor(root, {stableMs = 2000, maxBytes = 16 * 1024 * 1024, now = Date.now,
    roofOnlyFolder = false, maxDepth = 8, maxFiles = 10000} = {}) {
    if (!isAbsolute(root)) throw new Error('Downloads root must be an explicit absolute local path');
    this.root = resolve(root); this.stableMs = stableMs; this.maxBytes = maxBytes; this.now = now;
    this.seen = new Map();
    this.roofOnlyFolder = roofOnlyFolder; this.maxDepth = maxDepth; this.maxFiles = maxFiles;
  }
  async scan(store) {
    const rootStat = await lstat(this.root);
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new Error('Downloads root must be a real directory');
    const canonical = await realpath(this.root), results = [];
    this.inventory = {visited: 0, relevant: 0, uncertain: 0, unsupported: 0, inaccessible: 0,
      oversized: 0, unstable: 0, duplicates: 0, imported: 0, uniqueProperties: null, formats: {}, truncated: false};
    const entries = [], stack = [{path: this.root, depth: 0}];
    while (stack.length) {
      const dir = stack.pop();
      let children;
      try {
        const st = await lstat(dir.path), real = await realpath(dir.path), rel = relative(canonical, real);
        if (st.isSymbolicLink() || rel.startsWith('..') || isAbsolute(rel)) { this.inventory.unsupported++; continue; }
        children = await readdir(dir.path, {withFileTypes: true});
      } catch { this.inventory.inaccessible++; continue; }
      for (const child of children) {
        if (++this.inventory.visited > this.maxFiles) { this.inventory.truncated = true; stack.length = 0; break; }
        if (child.isSymbolicLink()) { this.inventory.unsupported++; continue; }
        const path = resolve(dir.path, child.name);
        if (child.isDirectory()) {
          if (dir.depth < this.maxDepth && !child.name.startsWith('.')) stack.push({path, depth: dir.depth + 1});
          else this.inventory.unsupported++;
        } else if (child.isFile()) entries.push({path, name: relative(this.root, path)});
      }
    }
    const present = new Set();
    const hashes = new Set();
    for (const entry of entries) {
      if (!EXTENSIONS.has(extname(entry.name).toLowerCase()) || entry.name.startsWith('.')) { this.inventory.unsupported++; continue; }
      // Unknown filenames require local operator classification; never sweep unrelated personal PDFs into inference.
      if (!this.roofOnlyFolder && !/roof|eagleview|hover|roofr|measurement|takeoff/i.test(entry.name)) { this.inventory.uncertain++; continue; }
      this.inventory.relevant++;
      const path = entry.path, rel = relative(canonical, path);
      if (rel.startsWith('..') || isAbsolute(rel)) continue;
      present.add(path);
      let stat;
      try { stat = await lstat(path); } catch { this.inventory.inaccessible++; continue; }
      if (!stat.isFile() || stat.isSymbolicLink()) continue;
      if (stat.size > this.maxBytes || stat.size === 0) { this.inventory.oversized++; continue; }
      const signature = `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`;
      const old = this.seen.get(path);
      if (!old || old.signature !== signature) { this.seen.set(path, {signature, since: this.now()}); this.inventory.unstable++; continue; }
      if (this.now() - old.since < this.stableMs) { this.inventory.unstable++; continue; }
      // Recheck identity after opening, then read only a bounded descriptor.
      let file;
      try { file = await open(path, 'r'); } catch { this.inventory.inaccessible++; continue; }
      try {
        const relReal = relative(canonical, await realpath(path));
        if (relReal.startsWith('..') || isAbsolute(relReal)) continue;
        const before = await file.stat();
        if (before.dev !== stat.dev || before.ino !== stat.ino || before.size !== stat.size || before.mtimeMs !== stat.mtimeMs) continue;
        const bytes = Buffer.alloc(before.size);
        let offset = 0;
        while (offset < bytes.length) {
          const part = await file.read(bytes, offset, bytes.length - offset, offset);
          if (!part.bytesRead) break;
          offset += part.bytesRead;
        }
        const after = await file.stat();
        const current = await lstat(path);
        if (offset !== bytes.length || current.isSymbolicLink() || current.ino !== before.ino || current.dev !== before.dev ||
            after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs) continue;
        const artifact = store.putArtifact(bytes);
        const hash = createHash('sha256').update(bytes).digest('hex');
        this.inventory.formats[extname(entry.name).toLowerCase()] = (this.inventory.formats[extname(entry.name).toLowerCase()] || 0) + 1;
        if (hashes.has(hash)) { this.inventory.duplicates++; continue; }
        hashes.add(hash); this.inventory.imported++;
        results.push({hash, artifact, extension: extname(entry.name).toLowerCase(), filename: entry.name, size: bytes.length});
      } catch { this.inventory.inaccessible++; } finally { await file.close(); }
    }
    for (const path of this.seen.keys()) if (!present.has(path)) this.seen.delete(path);
    return results;
  }
}

export async function extractDocument(bytes, extension) {
  if (!Buffer.isBuffer(bytes) || bytes.length > 16 * 1024 * 1024) throw new Error('Document size limit');
  if (extension === '.pdf') {
    const {getDocument} = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const loading = getDocument({data: new Uint8Array(bytes), isEvalSupported: false, enableXfa: false,
      standardFontDataUrl: fileURLToPath(new URL('../node_modules/pdfjs-dist/standard_fonts/', import.meta.url)),
      useSystemFonts: false, disableFontFace: true, stopAtErrors: true});
    const document = await loading.promise;
    try {
      if (document.numPages > 50) throw new Error('PDF exceeds 50-page limit');
      const pages = []; let chars = 0;
      for (let page = 1; page <= document.numPages; page++) {
        const p = await document.getPage(page), content = await p.getTextContent();
        const observations = content.items.filter(x => typeof x.str === 'string').map(x => ({literal: x.str, transform: x.transform}));
        chars += observations.reduce((n, x) => n + x.literal.length, 0);
        if (chars > 250000) throw new Error('Extracted text exceeds limit');
        pages.push({page, rotation: p.rotate, observations}); p.cleanup();
      }
      return {schemaVersion: 1, kind: 'source-claims', pages, externallyAuthorized: false, verifiedReference: false};
    } finally { await loading.destroy(); }
  }
  if (!['.txt', '.json'].includes(extension)) throw new Error('Unsupported document extension');
  const text = bytes.toString('utf8');
  if (text.length > 250000) throw new Error('Extracted text exceeds limit');
  return {schemaVersion: 1, kind: 'source-claims', pages: [{page: 1, observations: [{literal: text}]}],
    externallyAuthorized: false, verifiedReference: false};
}
