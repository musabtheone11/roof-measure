// Focused PDF geometry regression: a bent path cannot be labelled by its endpoint chord.
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const RM = createRequire(import.meta.url)('../roofmodel.js');
const source = fs.readFileSync(new URL('../roofpdf.js', import.meta.url), 'utf8');
const fn = source.slice(source.indexOf('function rpStraightRun('), source.indexOf('function rpDrawDims('));
const ctx = vm.createContext({ RM }); vm.runInContext(fn, ctx);
assert.equal(ctx.rpStraightRun([[0, 0], [10, 0], [20, 0]]), true);
assert.equal(ctx.rpStraightRun([[0, 0], [10, 8], [20, 0]]), false);
assert.equal(ctx.rpStraightRun([[0, 0], [20, 0], [10, 0]]), false);
assert.match(source, /rpStraightRun\(L.xy\) &&/);
assert.match(source, /rpSheetPlanFirst\(doc, M, hero, n, total, ctx\)/);
assert.match(source, /rpView\(M, box, \{ rotDeg: 0, padFt: 4 \}\)/);
console.log('ok PDF plan first, north up, straight-run dimensions only');

vm.runInContext(source.slice(source.indexOf('function rpDetailReserve('), source.indexOf('function rpSheetDetail(')), ctx);
const reserved = ctx.rpDetailReserve({k: 3.6}, {y: 145,h: 540})[0];
assert.ok(reserved.x0 <= 94 && reserved.x1 >= 96 && reserved.y0 <= 642 && reserved.y1 >= 652);
assert.match(source, /wrap: true/);
