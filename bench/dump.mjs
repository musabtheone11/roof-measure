// node dump.mjs "<address>" [engineDir] > out.json   -> rasters (downsampled) + engine geometry in local metres, for plotting
import fs from 'node:fs';
import { fetchProperty, runApp, ROOT } from './appcore.mjs';
const address = process.argv[2], dir = process.argv[3] || ROOT, out = process.argv[4];
const prop = await fetchProperty(address);
const run = await runApp(prop, dir, { quiet: true, plot: true });
const c = prop.main.center, kx = 111320 * Math.cos(c.latitude * Math.PI / 180), ky = 110540;
const xy = (p) => [+((p.lng - c.longitude) * kx).toFixed(3), +((p.lat - c.latitude) * ky).toFixed(3)];
const { w, h } = prop.dsmT; const tl = xy(prop.maskT.toLL(0, 0)), br = xy(prop.maskT.toLL(w, h));
const grid = (a, f = (v) => v) => { const o = []; for (let y = 0; y < h; y++) { const r = []; for (let x = 0; x < w; x++) r.push(f(a[y * w + x])); o.push(r); } return o; };
const J = { address, ext: [tl[0], br[0], br[1], tl[1]], w, h, imageryDate: prop.layers.imageryDate, quality: prop.layers.imageryQuality,
  dsm: grid(prop.dsmT.data, (v) => +v.toFixed(2)), mask: grid(prop.maskT.data, (v) => (v > 0 ? 1 : 0)),
  rgb: prop.rgbT ? [0, 1, 2].map((b) => grid(prop.rgbT.bands[b])) : null,
  bbox: [xy({ lat: prop.main.boundingBox.sw.latitude, lng: prop.main.boundingBox.sw.longitude }), xy({ lat: prop.main.boundingBox.ne.latitude, lng: prop.main.boundingBox.ne.longitude })],
  facets: run.facets.map((f) => ({ name: f.name, pitch: f.pitch, status: f.status || null, poly: f.path.map(xy) })), edges: run.edges.map((e) => ({ type: e.type, status: e.status || null, line: e.path.map(xy) })), info: run.info, extra: run.info && run.info.plot ? run.info.plot : null, obstruction: run.info && run.info.obstruction, zonesM: run.info && run.info.obstruction && run.info.obstruction.hiddenZones ? run.info.obstruction.hiddenZones.map((z) => z.path.map(xy)) : [], repairs: run.info && run.info.repairs }; if (J.info) delete J.info.plot;
fs.writeFileSync(out || 'private/dump.json', JSON.stringify(J)); console.log(run.info, run.facets.length, 'facets', run.ms, 'ms');
