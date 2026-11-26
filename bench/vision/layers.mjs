// Local-only views of a cached property's Google Solar layers for the Claude Code (local) reviewers: the RGB aerial, a
// hillshade of the height model and the building mask, each as PNG with a generic frame.json for bench/vision/crops.py.
//   node bench/vision/layers.mjs --slug <slug> --out <dir>
// These images are Google Maps Platform content: they are never sent to an external model.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { fetchProperty } from '../appcore.mjs';
const HERE = path.dirname(fileURLToPath(import.meta.url)), REPO = path.resolve(HERE, '..', '..');
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const slug = arg('slug'), out = arg('out'); if (!slug || !out) { console.error('--slug and --out required'); process.exit(2); }
const M = JSON.parse(fs.readFileSync(path.join(REPO, 'bench', 'private', 'regional', 'manifest.json'), 'utf8'));
const p = M.properties.find((q) => q.slug === slug) || (arg('address') ? { address: arg('address') } : null); if (!p) { console.error('unknown slug (pass --address for a property outside the benchmark)'); process.exit(1); }
const prop = await fetchProperty(p.address, { slug });
fs.mkdirSync(out, { recursive: true });

// minimal PNG writer (RGB, 8 bit)
function png(w, h, rgb) {
  const crc = (buf) => { let c = ~0; for (const b of buf) { c ^= b; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); } return (~c) >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const raw = Buffer.alloc((w * 3 + 1) * h); for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; rgb.copy(raw, y * (w * 3 + 1) + 1, y * w * 3, (y + 1) * w * 3); }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const frameOf = (T) => { const o = T.toLL(0, 0), x1 = T.toLL(1, 0), y1 = T.toLL(0, 1); return { w: T.w, h: T.h, lng0: o.lng, dLngDx: x1.lng - o.lng, lat0: o.lat, dLatDy: y1.lat - o.lat }; };
// RGB aerial
if (prop.rgbT && prop.rgbT.bands) {
  const T = prop.rgbT, buf = Buffer.alloc(T.w * T.h * 3); for (let i = 0; i < T.w * T.h; i++) { buf[i * 3] = T.bands[0][i]; buf[i * 3 + 1] = T.bands[1][i]; buf[i * 3 + 2] = T.bands[2][i]; }
  fs.writeFileSync(path.join(out, 'rgb.png'), png(T.w, T.h, buf)); fs.writeFileSync(path.join(out, 'rgb.json'), JSON.stringify(frameOf(T), null, 1));
}
// hillshade of the DSM (sun from the north-west, 45 degrees up) with the mask boundary drawn in red
{
  const T = prop.dsmT, mk = prop.maskT, w = T.w, h = T.h, d = T.data, buf = Buffer.alloc(w * h * 3); const px = 0.1;
  // light from the north-west: the aspect formula below uses the mathematical convention, so the azimuth is (360 - 315 + 90) degrees
  const az = (360 - 315 + 90) * Math.PI / 180, alt = 45 * Math.PI / 180;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x; const xl = Math.max(0, x - 1), xr = Math.min(w - 1, x + 1), yu = Math.max(0, y - 1), yd = Math.min(h - 1, y + 1);
    const dzdx = (d[y * w + xr] - d[y * w + xl]) / (2 * px), dzdy = (d[yd * w + x] - d[yu * w + x]) / (2 * px);
    const slope = Math.atan(Math.hypot(dzdx, dzdy)), aspect = Math.atan2(dzdy, -dzdx);
    let s = Math.sin(alt) * Math.cos(slope) + Math.cos(alt) * Math.sin(slope) * Math.cos(az - aspect); s = Math.max(0, Math.min(1, s));
    let v = Math.round(40 + 215 * s); buf[i * 3] = v; buf[i * 3 + 1] = v; buf[i * 3 + 2] = v;
    if (mk && mk.w === w && mk.h === h && mk.data[i]) { const edge = !mk.data[y * w + xl] || !mk.data[y * w + xr] || !mk.data[yu * w + x] || !mk.data[yd * w + x]; if (edge) { buf[i * 3] = 255; buf[i * 3 + 1] = 40; buf[i * 3 + 2] = 40; } }
  }
  fs.writeFileSync(path.join(out, 'hillshade.png'), png(w, h, buf)); fs.writeFileSync(path.join(out, 'hillshade.json'), JSON.stringify(frameOf(T), null, 1));
}
console.log(`layers -> ${out}: rgb.png ${prop.rgbT ? prop.rgbT.w + 'x' + prop.rgbT.h : '(none)'}, hillshade.png ${prop.dsmT.w}x${prop.dsmT.h} (local use only)`);
