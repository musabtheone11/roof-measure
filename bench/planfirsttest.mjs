// Plan-first sheet geometry (synthetic): the plan is north up at an exact architectural scale, rotated labels are tested
// for overlap as rotated boxes (not axis-aligned boxes), and a bent line is labelled with its true path length on its
// longest straight piece, never with its endpoint chord.
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const RM = createRequire(import.meta.url)('../roofmodel.js');
const source = fs.readFileSync(new URL('../roofpdf.js', import.meta.url), 'utf8');
const slice = (a, b) => source.slice(source.indexOf(a), source.indexOf(b, source.indexOf(a)));
const ctx = vm.createContext({ RM });
vm.runInContext(slice('const RP_SCALES', '// does rotating the plan'), ctx);
vm.runInContext(slice('const rpInside', 'function rpLabelPoint'), ctx);
vm.runInContext(slice('const rpQuadHit', '// draws the plan in view V'), ctx);
const G = (name) => vm.runInContext(name, ctx);   // top-level const bindings are not context properties

// 1. scale: 1 ft on paper is exactly 72 / perIn points; north up (y grows to the north = up the page)
const M = { facets: [{ xy: [[0, 0], [60, 0], [60, 30], [0, 30]] }], lines: [], obLines: [], zones: [] };
const V = vm.runInContext('rpView', ctx)(M, { x: 40, y: 140, w: 532, h: 560 }, { padFt: 4 });
const a = V.P([0, 0]), b = V.P([60, 0]), n = V.P([0, 30]);
assert.ok(Math.abs((b[0] - a[0]) - 60 * 72 / V.perIn) < 1e-9, 'horizontal feet map at exactly the printed scale');
assert.ok(n[1] < a[1] && Math.abs(n[0] - a[0]) < 1e-9, 'north is up the page');
assert.ok(vm.runInContext('RP_SCALES', ctx).some((sc) => Math.abs(sc.perIn - V.perIn) < 1e-9 && sc.label === V.label), 'a listed architectural or engineering scale, printed as labelled');

// 2. rotated label boxes: two 45-degree labels whose axis-aligned boxes overlap but whose rotated boxes do not
const u = [Math.SQRT1_2, Math.SQRT1_2];
const A = G('rpQuad')([0, 0], u, 20, 3), B = G('rpQuad')([8, -8], u, 20, 3);
assert.equal(G('rpQuadHit')(A, B), false, 'parallel rotated labels side by side do not collide');
assert.equal(G('rpQuadHit')(A, G('rpQuad')([2, 2], u, 20, 3)), true, 'stacked rotated labels collide');
assert.equal(G('rpSegHit')([[-30, 0], [30, 0]], A), true, 'a drawn line through a label is detected');
assert.equal(G('rpSegHit')([[-30, 40], [30, 40]], A), false, 'a line clear of a label is not');

// 3. a bent line is labelled on its longest straight piece with its true path length (source rule)
assert.match(source, /longest straight piece of each line carries "KEY {2}length"/);
assert.match(source, /for \(let i = 1; i < L\.xy\.length; i\+\+\) \{ const d = Math\.hypot/);
assert.match(source, /L\.m\.trueFt/);
assert.ok(!/chord/i.test(slice('function rpPlanDraw', '// ----')), 'no endpoint-chord labels');
console.log('ok plan-first: exact scale, north up, rotated label overlap, bent lines labelled by true length');
