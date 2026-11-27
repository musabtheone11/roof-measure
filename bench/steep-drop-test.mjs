// Steep drop-offs are not roof planes (constructed region map; no property data).
// On a supplied property the blurred drop from a small entry roof to the porch fitted two small regions at about 22/12
// (some 60 degrees). Each kept the other as "a roof plane at that pitch", so both survived the band absorption and the
// sketch drew a zig-zag of short rake, step and wall lines around them. Regions steeper than AT2.bandSteep are walls or
// drop-offs and do not vouch for each other; a small real plane blurred to 13-17/12 beside another still keeps its pitch.
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const ctx = vm.createContext({ console, Math }); vm.runInContext(fs.readFileSync(new URL('../autotrace2.js', import.meta.url), 'utf8'), ctx);
const absorbBands = vm.runInContext('absorbBands', ctx);
const px = 0.1, w = 120, h = 80, plane = (p12, dir = 0) => ({ a: p12 / 12 * Math.cos(dir), b: p12 / 12 * Math.sin(dir), c: 0 });
// region 0: a 12 m x 8 m main plane; regions 1 and 2: two ~4.8 m2 regions side by side, surrounded by roof (as on the
// reproduction property, so the outline rule for steep strips does not apply and only the pitch-vouching rule decides)
function scene(p12a, p12b) {
  const label = new Int32Array(w * h).fill(-1), dsm = new Float32Array(w * h).fill(3);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) label[y * w + x] = 0;
  for (let y = 50; y < 72; y++) for (let x = 40; x < 84; x++) label[y * w + x] = x < 62 ? 1 : 2;   // two ~4.8 m2 regions inside the roof
  const regions = [{ plane: plane(7) }, { plane: plane(p12a, -Math.PI / 2) }, { plane: plane(p12b, Math.PI) }];
  const lp = { Ecol: Array.from({ length: w }, (_, x) => x * px), Nrow: Array.from({ length: h }, (_, y) => -y * px) };
  return { label, dsm, regions, lp };
}
const run = (p12a, p12b) => { const s = scene(p12a, p12b); const r = absorbBands(s.dsm, s.label, s.regions, w, h, s.lp, { pxM2: px * px }); return new Set(r.label.filter((l) => l >= 0)); };
const steep = run(22.7, 21.8);
assert.ok(!steep.has(1) && !steep.has(2), 'two side-by-side 22/12 drop-off regions are absorbed (were kept vouching for each other)');
const blurred = run(15.3, 16.8);
assert.ok(blurred.has(1) && blurred.has(2), 'two small real planes blurred to 15-17/12 keep each other');
console.log('steep drop-offs: 22/12 pair absorbed, 15-17/12 pair kept');
