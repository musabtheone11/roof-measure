// Synthetic pixel-space regressions. No imagery or customer data.
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const c = vm.createContext({ console });
vm.runInContext(fs.readFileSync(new URL('../autotrace2.js', import.meta.url), 'utf8'), c);
const run = (raw) => c.splitRuns([raw[0], raw.at(-1)], raw, { a: 0, b: 0 }, 0)[0];
const crooked = Array.from({ length: 101 }, (_, i) => [i / 10, i === 50 ? 0.09 : 0]);
assert.ok(Math.abs(run(crooked).line.d[1]) < 1e-8, 'subpixel kink is straightened');
const diagonal = Array.from({ length: 101 }, (_, i) => [i / 10, i / 10 * Math.tan(10 * Math.PI / 180)]);
assert.ok(Math.abs(run(diagonal).line.d[1] - Math.sin(10 * Math.PI / 180)) < 1e-5, 'supported 10 degree diagonal is preserved instead of snapped to building axis');
// Even a one-metre diagonal can fit inside the old absolute 20 cm bound.
const shortDiagonal = Array.from({ length: 101 }, (_, i) => [i / 100, i / 100 * Math.tan(10 * Math.PI / 180)]);
assert.ok(Math.abs(run(shortDiagonal).line.d[1] - Math.sin(10 * Math.PI / 180)) < 1e-5, 'one-metre supported diagonal is not rotated to an axis');
const rasterDiagonal = Array.from({ length: 11 }, (_, i) => [i / 10, Math.round(i / 10 * Math.tan(10 * Math.PI / 180) * 10) / 10]);
assert.ok(run(rasterDiagonal).line.d[1] > 0.1, 'short diagonal remains visible with 10 cm source quantization');
const chamfer = Array.from({ length: 101 }, (_, i) => [1.7 * Math.SQRT1_2 * i / 100, 1.7 * Math.SQRT1_2 * i / 100]);
assert.ok(Math.abs(run(chamfer).line.d[1] - Math.SQRT1_2) < 1e-5, 'real 1.7 metre chamfer is preserved');
const asymmetricJoin = Array.from({ length: 101 }, (_, i) => [i / 100, 0.3 * i / 100]);
assert.ok(Math.abs(run(asymmetricJoin).line.d[1] - 0.3 / Math.sqrt(1.09)) < 1e-5, 'supported asymmetric join remains diagonal');
const axisLine = { n: [0, 1], c: 0 };
assert.equal(c.runSupported([], axisLine), false, 'empty support cannot establish a run');
assert.equal(c.runSupported([[0, 0]], axisLine), false, 'one point cannot establish a run');
assert.equal(c.runSupported([[NaN, 0], [1, 0]], axisLine), false, 'nonfinite support is rejected');
assert.equal(c.runSupported([[0, 0], [1, 0]], { n: [NaN, 0], c: 0 }), false, 'nonfinite constraints are rejected');
// A perfectly straight tree boundary supplies no roof-edge evidence.
const w = 100, h = 60, labels = new Int32Array(w * h).fill(-1);
for (let y = 10; y < 50; y++) for (let x = 10; x < 90; x++) labels[y*w+x] = 0;
const geo = { E: x => x/10, N: y => y/10 };
const reconstructed = c.reconstruct(labels, [{plane:{a:0.5,b:0,c:3}}], w, h, geo, 0, () => true);
assert.ok(reconstructed.chains.every(ch => ch.segFlag?.every(f => f === 2)), 'straight aligned canopy boundaries remain unresolved');
console.log('ok supported kink, short/long/raster diagonals, chamfer, asymmetry, invalid support and canopy boundary');
