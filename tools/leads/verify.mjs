#!/usr/bin/env node
// Hand-check helper for the pilot: for sample rows of a Stage 1 CSV, re-read the owner from the county property appraiser
// and the roof permits from the permit office by a second, independent query, and compare with the row.
// Usage: node tools/leads/verify.mjs --csv leads-data/stage1.csv [--n 5] [--band any|15+|...]
import fs from 'node:fs'; import path from 'node:path'; import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import * as coj from './lib/permits/coj.mjs';
const L = createRequire(import.meta.url)('../../leadscore.js');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const same = (a, b) => L.normAddr(a) === L.normAddr(b);

// Duval Property Appraiser record (owner, site address, mailing address)
export function parsePao(html) {
  const s = Object.fromEntries([...html.matchAll(/<span id="([^"]+)"[^>]*>([^<]{1,160})<\/span>/g)].map((m) => [m[1], m[2].replace(/&amp;/g, '&').trim()]));
  const own = 'ctl00_cphBody_repeaterOwnerInformation_ctl00_';
  return { owner: s[own + 'lblOwnerName'] || '', site: s.ctl00_cphBody_lblPrimarySiteAddressLine1 || '',
    mailing: [s[own + 'lblMailingAddressLine1'], s[own + 'lblMailingAddressLine2'], s[own + 'lblMailingAddressLine3']].filter(Boolean).join(', ') };
}
async function duvalOwner(row) {
  const re = String(row.parcel_id).replace(/\D/g, '');
  const html = await (await fetch('https://paopropertysearch.coj.net/Basic/Detail.aspx?RE=' + re, { headers: { 'User-Agent': UA } })).text();
  return { ...parsePao(html), source: 'https://paopropertysearch.coj.net/Basic/Detail.aspx?RE=' + re };
}

async function checkRow(row) {
  const out = { parcel_id: row.parcel_id, address: row.property_address, band: row.age_band, owner_check: 'not checked', permit_check: 'not checked' };
  if (row.jurisdiction === 'City of Jacksonville' || /R$/.test(row.parcel_id)) {
    try {
      const p = await duvalOwner(row);
      out.owner_check = p.owner === row.owner_of_record ? 'match' : `differs: appraiser "${p.owner}" vs list "${row.owner_of_record}"`;
      out.site_check = same(p.site, row.property_address) ? 'match' : `differs: appraiser "${p.site}"`;
      out.owner_source = p.source;
    } catch (e) { out.owner_check = 'error: ' + e.message; }
    try {
      const live = await coj.lookup(row, { live: true });   // live city search by parcel, independent of the published copy
      const c = L.classify({ permits: live.permits, yearBuilt: +row.year_built || null, coverage: 'full_history', coverageFrom: 1985 }, { minYears: 8, now: new Date() });
      out.permit_check = c.permit_number === (row.permit_number || null) && c.age_band === row.age_band ? 'match' : `differs: live says ${c.age_band} ${c.permit_number || ''}`;
    } catch (e) { out.permit_check = 'error: ' + e.message; }
  }
  return out;
}

async function main() {
  const a = process.argv.slice(2); const get = (k, d) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : d; };
  const rows = L.parseCSV(fs.readFileSync(get('--csv', 'leads-data/stage1.csv'), 'utf8'));
  const band = get('--band', 'any'); const n = +get('--n', '5');
  const pick = rows.filter((r) => band === 'any' || r.age_band === band).slice(0, n);
  for (const r of pick) { console.log(JSON.stringify(await checkRow(r))); await sleep(400); }
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) main().catch((e) => { console.error(e); process.exit(1); });
