import test from 'node:test'; import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const C = createRequire(import.meta.url)('../../../cashpath.js');
const t = { sloped: 2367.6, twoStory: 0, predominant: 6, byType: { eave: { true: 200.42 }, hip: { true: 99 }, ridge: { true: 28.08 }, rake: { true: 59.416 }, valley: { true: 0 } } };

test('handoff uses the builder\'s own field names and measurement rows', () => {
  const h = C.buildCashHandoff(t, { address: '14245 DRAKES POINT DR, FL 32224', jobName: 'Pall' }, new Date(2026, 10, 22));
  assert.equal(h.squareFootage, '2368'); assert.equal(h.stories, '1'); assert.equal(h.roofPitch, 'medium');
  assert.equal(h.propertyAddress, '14245 DRAKES POINT DR, FL 32224'); assert.equal(h.customerName, 'Pall'); assert.equal(h.estimateDate, '2026-11-22');
  assert.deepEqual(h.measurements, [
    { section: 'Main Roof Area', length: 0, width: 0, area: 2368 },
    { section: 'Eaves', length: 200.42, width: 0, area: 0 }, { section: 'Hips', length: 99, width: 0, area: 0 },
    { section: 'Ridges', length: 28.08, width: 0, area: 0 }, { section: 'Rakes', length: 59.42, width: 0, area: 0 }]);
});
test('pitch and stories mapping', () => {
  const p = (pred, two = 0) => C.buildCashHandoff({ ...t, predominant: pred, twoStory: two }, {}, new Date());
  assert.equal(p(3).roofPitch, 'low'); assert.equal(p(4).roofPitch, 'low'); assert.equal(p(5).roofPitch, 'medium'); assert.equal(p(8).roofPitch, 'medium'); assert.equal(p(9).roofPitch, 'steep');
  assert.equal(p(6, 1300).stories, '2'); assert.equal(p(6, 400).stories, '1');
});
test('valleys are added only when the roof has them; blank name is left out', () => {
  const h = C.buildCashHandoff({ ...t, byType: { ...t.byType, valley: { true: 31.5 } } }, { address: 'X' }, new Date());
  assert.deepEqual(h.measurements.at(-1), { section: 'Valleys', length: 31.5, width: 0, area: 0 });
  assert.ok(!('customerName' in h));
});
