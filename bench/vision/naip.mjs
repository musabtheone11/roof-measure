// Fetch the newest USDA NAIP aerial photo (public domain) of a building as an exactly georeferenced PNG, for the vision review.
//   node bench/vision/naip.mjs --slug <slug> --out <dir> [--half 32] [--px 1024] [--date YYYY-MM-DD]
//   node bench/vision/naip.mjs --lat .. --lng .. --out <dir>
// Reads the building centre from bench/private/cache/<slug>/building.json (never printed). Writes naip.png + naip.json:
// {date, gsd, bbox{w,s,e,n}, px, mPerPx, shift{lng,lat}} so that pixel (x, y) -> lng = w + (e-w) x/px + shift.lng,
// lat = n - (n-s) y/px + shift.lat. The Planetary Computer catalogue serves NAD83 coordinates as WGS84; the shift (about
// 0.5 m here) puts the photo back where it belongs, the same way altview.js does in the app.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import proj4 from 'proj4';
const HERE = path.dirname(fileURLToPath(import.meta.url)), REPO = path.resolve(HERE, '..', '..');
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const out = arg('out'); if (!out) { console.error('--out required'); process.exit(2); }
let lat = +arg('lat', NaN), lng = +arg('lng', NaN);
if (!isFinite(lat)) { const b = JSON.parse(fs.readFileSync(path.join(REPO, 'bench', 'private', 'cache', arg('slug'), 'building.json'), 'utf8')); lat = b.center.latitude; lng = b.center.longitude; }
const half = +arg('half', 32), px = +arg('px', 1024), wantDate = arg('date', null);
const kx = 111320 * Math.cos(lat * Math.PI / 180), ky = 110540;
export async function naipList(lat, lng) {
  const r = await fetch('https://planetarycomputer.microsoft.com/api/stac/v1/search', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ collections: ['naip'], intersects: { type: 'Point', coordinates: [lng, lat] }, limit: 100 }) });
  if (!r.ok) throw new Error('NAIP catalogue ' + r.status);
  const by = new Map();
  for (const f of ((await r.json()).features || [])) { const date = String(f.properties.datetime || '').slice(0, 10); if (!/^\d{4}-\d\d-\d\d$/.test(date)) continue; const b = f.bbox || [];
    const edge = b.length === 4 ? Math.min(lng - b[0], b[2] - lng, lat - b[1], b[3] - lat) : 0; const cur = by.get(date);
    if (!cur || edge > cur.edge) by.set(date, { item: String(f.id), date, gsd: +f.properties.gsd || 1, edge }); }
  return [...by.values()].sort((a, b) => b.date.localeCompare(a.date));
}
export function datumShift(lat, lng) {
  // NAD83 (as served) -> WGS84: the catalogue labels NAD83 coordinates as WGS84; shift computed the way the app does it
  const zone = Math.floor((lng + 180) / 6) + 1;
  const nul = `+proj=utm +zone=${zone} +datum=NAD83 +units=m +no_defs`, hel = `+proj=utm +zone=${zone} +ellps=GRS80 +towgs84=-0.991,1.9072,0.5129,0.025789908,0.0096501,0.0116599,0 +units=m +no_defs`;
  const q = proj4(hel, 'EPSG:4326', proj4('EPSG:4326', nul, [lng, lat])); const s = { lng: q[0] - lng, lat: q[1] - lat };
  return Math.abs(s.lng) < 1e-4 && Math.abs(s.lat) < 1e-4 ? s : { lng: 0, lat: 0 };
}
const list = await naipList(lat, lng); if (!list.length) { console.error('no NAIP photo covers this spot'); process.exit(1); }
const n = wantDate ? list.find((q) => q.date === wantDate) : list[0]; if (!n) { console.error('no NAIP photo on ' + wantDate + '; have ' + list.map((q) => q.date).join(' ')); process.exit(1); }
const dLat = half / ky, dLng = half / kx; const b = { s: lat - dLat, n: lat + dLat, w: lng - dLng, e: lng + dLng };
const url = 'https://planetarycomputer.microsoft.com/api/data/v1/item/bbox/' + [b.w, b.s, b.e, b.n].map((v) => v.toFixed(7)).join(',') + '/' + px + 'x' + px + '.png?collection=naip&item=' + encodeURIComponent(n.item) + '&assets=image&asset_bidx=' + encodeURIComponent('image|1,2,3') + '&dst_crs=' + encodeURIComponent('epsg:3857') + '&reproject=bilinear';
const r = await fetch(url); if (!r.ok) { console.error('NAIP image ' + r.status); process.exit(1); }
fs.mkdirSync(out, { recursive: true }); fs.writeFileSync(path.join(out, 'naip.png'), Buffer.from(await r.arrayBuffer()));
const shift = datumShift(lat, lng);
const meta = { source: 'USDA NAIP aerial photo (public domain) via Planetary Computer', date: n.date, gsd: n.gsd, item: n.item, bbox: b, px, mPerPx: 2 * half / px, shift, dates: list.map((q) => q.date + ' (' + q.gsd + ' m)'), note: 'pixel (x,y) -> lng = bbox.w + (bbox.e - bbox.w) * x / px + shift.lng ; lat = bbox.n - (bbox.n - bbox.s) * y / px + shift.lat' };
fs.writeFileSync(path.join(out, 'naip.json'), JSON.stringify(meta, null, 1));
console.log(`NAIP ${n.date} (${n.gsd} m/px) -> ${out}/naip.png ${px}x${px}, ${(2 * half / px).toFixed(3)} m/px, datum shift ${(shift.lng * kx).toFixed(2)} m E ${(shift.lat * ky).toFixed(2)} m N; flights: ${list.map((q) => q.date).join(' ')}`);
