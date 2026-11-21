import test from 'node:test'; import assert from 'node:assert/strict';
import { project, tierCost } from '../project.mjs';

test('tierCost applies the free cap and first-tier price', () => {
  assert.equal(tierCost(5000, { free: 10000, per1000: 10 }), 0);
  assert.equal(tierCost(15000, { free: 10000, per1000: 10 }), 50);
});
test('project scales pilot band rates to each ZIP and prices Stage 2 and report opens', () => {
  const coverage = { 32068: { county: 20, single_family_addresses: 1000, screened: 50, band_15plus: 5, band_10_15: 3, band_min_10: 2, needs_review: 40, screened_out_recent: 0 },
    32224: { county: 26, single_family_addresses: 2000 } };
  const p = project(coverage, { rates: { 20: 10 / 50, 26: 0.5 }, prices: { bi: { free: 10000, per1000: 10 }, dl: { free: 1000, per1000: 75 } }, openShare: 0.25 });
  assert.equal(p.zips['32068'].est_band_rows, 200);
  assert.equal(p.zips['32224'].est_band_rows, 1000);
  assert.equal(p.total.est_band_rows, 1200);
  assert.equal(p.total.stage2_building_insights_calls, 1200);
  assert.equal(p.total.upper_bound_calls, 3000);
  assert.equal(p.total.report_opens, 300);
  assert.equal(p.cost.stage2, 0);                       // under the 10,000 free calls
  assert.equal(p.cost.opens, tierCost(300, { free: 1000, per1000: 75 }) + tierCost(1200 + 300, { free: 10000, per1000: 10 }) - tierCost(1200, { free: 10000, per1000: 10 }));
});
