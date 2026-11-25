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
// A perfectly straight tree boundary supplies no roof-edge evidence.
const w = 100, h = 60, labels = new Int32Array(w * h).fill(-1);
for (let y = 10; y < 50; y++) for (let x = 10; x < 90; x++) labels[y*w+x] = 0;
const geo = { E: x => x/10, N: y => y/10 };
const reconstructed = c.reconstruct(labels, [{plane:{a:0.5,b:0,c:3}}], w, h, geo, 0, () => true);
assert.ok(reconstructed.chains.every(ch => ch.segFlag?.every(f => f === 2)), 'straight aligned canopy boundaries remain unresolved');
console.log('ok subpixel kink, supported diagonal, and straight canopy boundary');
