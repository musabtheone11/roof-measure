#!/usr/bin/env node
// Projected Google API usage and cost for the lead workflow, from Stage 1 coverage counts.
// Stage 2 (Leads tab) makes one Solar Building Insights call per age-band home.
// Each opened report link makes one Building Insights call and one Data Layers call (auto-trace), plus a Static Maps image.
// Usage: node tools/leads/project.mjs --coverage leads-data/coverage.json --rates leads-data/rates.json [--open-share 0.25] [--config tools/leads/leads.config.json]
import fs from 'node:fs'; import path from 'node:path'; import { pathToFileURL } from 'node:url';

// Google Maps Platform pay-as-you-go list prices (developers.google.com/maps/billing-and-pricing/pricing, read 2026-11-20): free monthly cap, then first tier per 1,000
export const PRICES = { bi: { free: 10000, per1000: 10 }, dl: { free: 1000, per1000: 75 }, static: { free: 10000, per1000: 2 } };
export const tierCost = (n, p) => Math.max(0, n - p.free) / 1000 * p.per1000;

// coverage: {zip: {county, single_family_addresses, ...}}; rates: {county: share of screened homes that land in an age band}
export function project(coverage, { rates, prices = PRICES, openShare = 0.25 }) {
  const zips = {}; const total = { single_family: 0, est_band_rows: 0 };
  for (const [zip, c] of Object.entries(coverage)) {
    const rate = rates[c.county] ?? rates[String(c.county)] ?? 0;
    const est = Math.round((c.single_family_addresses || 0) * rate);
    zips[zip] = { county: c.county, single_family: c.single_family_addresses || 0, band_rate: +rate.toFixed(3), est_band_rows: est };
    total.single_family += zips[zip].single_family; total.est_band_rows += est;
  }
  total.stage2_building_insights_calls = total.est_band_rows;
  total.upper_bound_calls = total.single_family;
  total.report_opens = Math.round(total.est_band_rows * openShare);
  const biStage2 = tierCost(total.stage2_building_insights_calls, prices.bi);
  const opensCost = tierCost(total.report_opens, prices.dl) + (tierCost(total.stage2_building_insights_calls + total.report_opens, prices.bi) - biStage2);
  const cost = { stage2: +biStage2.toFixed(2), opens: +opensCost.toFixed(2), upper_bound_stage2: +tierCost(total.upper_bound_calls, prices.bi).toFixed(2),
    every_link_opened: +(tierCost(total.est_band_rows, prices.dl) + tierCost(total.est_band_rows * 2, prices.bi) - biStage2).toFixed(2) };
  return { zips, total, cost, assumptions: { openShare, prices } };
}

function main() {
  const a = process.argv.slice(2); const get = (k, d) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : d; };
  const coverage = JSON.parse(fs.readFileSync(get('--coverage', 'leads-data/coverage.json'), 'utf8'));
  const rates = JSON.parse(fs.readFileSync(get('--rates', 'leads-data/rates.json'), 'utf8'));
  const p = project(coverage, { rates, openShare: +get('--open-share', '0.25') });
  console.log(JSON.stringify(p, null, 2));
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) main();
