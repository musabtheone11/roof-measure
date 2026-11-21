import test from 'node:test'; import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { jurisdictionOf, CITY_GEOIDS } from '../lib/jurisdiction.mjs';
import * as coj from '../lib/permits/coj.mjs';
import * as clay from '../lib/permits/clay.mjs';
import * as stjohns from '../lib/permits/stjohns.mjs';
const L = createRequire(import.meta.url)('../../../leadscore.js');
const fx = (n) => fs.readFileSync(new URL('./fixtures/' + n, import.meta.url), 'utf8');
const sq = (x, y, d = 0.01) => [[x, y], [x + d, y], [x + d, y + d], [x, y + d], [x, y]];
const cities = [{ name: 'Orange Park town', geoid: '1252125', rings: [sq(-81.72, 30.15)] }, { name: 'St. Augustine Beach city', geoid: '1262525', rings: [sq(-81.30, 29.84)] }];
const row = (o) => ({ parcel_id: 'X', property_address: '1 MAIN ST', city: 'JACKSONVILLE', zip: '32224', centroid: { lat: 30.3, lng: -81.5 }, year_built: 1990, ...o });

test('CITY_GEOIDS lists the municipal permit offices', () => {
  for (const g of ['1227400', '1252125', '1255875', '1262500', '1262525', '1235050', '1202400', '1248100', '1203250']) assert.ok(CITY_GEOIDS[g], g);
});
test('jurisdictionOf by county and city limits', () => {
  let j = jurisdictionOf(row(), 26, cities); assert.equal(j.adapter, 'coj'); assert.equal(j.coverage, 'full_history'); assert.equal(j.coverageFrom, 1985);
  j = jurisdictionOf(row({ zip: '32068', centroid: { lat: 30.07, lng: -81.88 } }), 20, cities); assert.equal(j.adapter, 'clay'); assert.equal(j.coverage, 'since_2023'); assert.equal(j.coverageFrom, 2023);
  j = jurisdictionOf(row({ zip: '32073', centroid: { lat: 30.155, lng: -81.715 } }), 20, cities); assert.equal(j.adapter, null); assert.equal(j.coverage, 'none'); assert.match(j.name, /Orange Park/);
  j = jurisdictionOf(row({ zip: '32259', centroid: { lat: 30.05, lng: -81.55 } }), 65, cities); assert.equal(j.adapter, 'stjohns'); assert.equal(j.coverage, 'full_history');
  j = jurisdictionOf(row({ zip: '32080', centroid: { lat: 29.845, lng: -81.295 } }), 65, cities); assert.equal(j.coverage, 'none');
});
test('coj index lookup maps rows with links', async () => {
  const r = await coj.lookup(row({ parcel_id: '1652794575R' }), { live: false });
  assert.ok(r.permits.length >= 2);
  const p = r.permits.find((x) => x.number === 'R-09-303080.000');
  assert.equal(p.issued, '2009-01-30'); assert.equal(p.finaled, '2009-02-17'); assert.equal(p.status, 'Finalized'); assert.equal(p.source, 'COJ_INDEX');
  assert.equal(p.link, 'https://jaxepics.coj.net/Permit/View/25008F');
  assert.equal(L.permitScope(p), 'full');
  assert.equal(coj.reOf('1652794575R'), '165279 4575');
});
test('coj live results merge over the index by permit number', async () => {
  const fetchFn = async (url) => ({ ok: true, json: async () => (/GetColumns/.test(url) ? [{ ColumnId: 28 }]
    : { values: [{ FullPermitNumber: 'R-26-1.000', PermitTypeDescription: 'Roofing Permit', WorkTypeDescription: 'Existing Building', WorkSubTypeDescription: 'Re-roof', StatusDescription: 'Issued', DateIssued: '10/20/2026 9:00:00 AM', DateFinal: '', StructureTypeDescription: 'Single Family', FullPermitNumber_Click: 'Permit/View/ABC' },
      { FullPermitNumber: 'M-24-1.000', PermitTypeDescription: 'Mechanical Permit', StatusDescription: 'Finalized', DateIssued: '7/3/2024' }] }) });
  const r = await coj.lookup(row({ parcel_id: '1652794575R' }), { live: true, fetchFn });
  const p = r.permits.find((x) => x.number === 'R-26-1.000');
  assert.equal(p.issued, '2026-10-20'); assert.equal(p.work, 'Existing Building - Re-roof'); assert.equal(p.structure, 'Single Family');
  assert.ok(!r.permits.some((x) => x.number === 'M-24-1.000'));
});
test('clay harvest indexes roofing permits by short parcel number', async () => {
  const page = JSON.parse(fx('clay_search.json'));
  const fetchFn = async () => ({ ok: true, json: async () => ({ ...page, Result: { ...page.Result, TotalPages: 1 } }) });
  const idx = await clay.harvest({ fetchFn });
  assert.equal(clay.shortParcel('30-05-25-010702-000-00'), '010702-000-00');
  const r = clay.lookup(row({ parcel_id: '17-04-26-022387-000-00' }), idx);
  assert.equal(r.permits.length, 1);
  const p = r.permits[0]; assert.equal(p.number, 'ROOF0425-01053'); assert.equal(p.issued, '2025-04-25'); assert.equal(p.finaled, '2025-05-07'); assert.equal(p.status, 'Complete');
  assert.equal(L.permitScope(p), 'full');
  assert.equal(clay.lookup(row({ parcel_id: '17-04-26-999999-000-00' }), idx).permits.length, 0);
});
test('clay harvest keeps the first page count when a later page reports none, and retries empty pages', async () => {
  const page = JSON.parse(fx('clay_search.json'));
  const one = (i) => ({ ...page.Result.EntityResults[2], CaseNumber: 'ROOF-' + i, MainParcel: 'MP-' + i });
  let calls = 0;
  const fetchFn = async (url, opt) => { calls++;
    const p = JSON.parse(opt.body).PageNumber;
    if (p === 2 && calls === 2) return { ok: true, json: async () => ({ Result: { EntityResults: [], TotalPages: 0 } }) };   // flaky empty page
    return { ok: true, json: async () => ({ Result: { EntityResults: [one(p)], TotalPages: p === 1 ? 3 : 0 } }) }; };
  const h = await clay.harvest({ fetchFn, retryMs: 0 });
  assert.equal(h.pages, 3); assert.equal(h.count, 3); assert.ok(h.index['MP-3']);
});
test('clay harvest throws if a page stays empty', async () => {
  const fetchFn = async (url, opt) => ({ ok: true, json: async () => ({ Result: { EntityResults: JSON.parse(opt.body).PageNumber === 1 ? [{ CaseNumber: 'ROOF-1', MainParcel: 'A', CaseType: 'Roof' }] : [], TotalPages: 2 } }) });
  await assert.rejects(clay.harvest({ fetchFn, retryMs: 0 }), /page 2/);
});
test('st johns parses the results list and reroof detail', async () => {
  const list = stjohns.parseResults(fx('wats_result.html'));
  assert.equal(list.length, 6);
  assert.deepEqual(list.find((x) => x.number === '11103295'), { number: '11103295', address: '1128 LINWOOD LOOP', code: '435', issued: '2011-07-07' });
  const d = stjohns.parseDetail(fx('wats_detail.html'));
  assert.equal(d.work, 'REROOF OF EXISTING STRUCTURE'); assert.equal(d.finaled, '2011-07-14'); assert.equal(d.status, 'Completed');
});
test('st johns lookup keeps exact address matches and fetches detail only for reroof codes', async () => {
  const calls = [];
  const fetchFn = async (url, opt) => { calls.push(String(url));
    if (/SearchPermit\.aspx$/.test(url) && !(opt && opt.method)) return { ok: true, headers: { getSetCookie: () => [] }, text: async () => '<input type="hidden" name="__VIEWSTATE" value="x">' };
    if (/SearchPermit\.aspx$/.test(url)) return { ok: true, status: 302, headers: { get: () => '/WATSWebX/Permit/SearchResults.aspx?Addr=1128', getSetCookie: () => [] }, text: async () => '' };
    if (/SearchResults/.test(url)) return { ok: true, headers: { getSetCookie: () => [] }, text: async () => fx('wats_result.html') };
    if (/BLPermit/.test(url)) return { ok: true, text: async () => fx('wats_detail.html') };
    throw new Error('unexpected ' + url); };
  const r = await stjohns.lookup(row({ property_address: '1128 LINWOOD LOOP', zip: '32259' }), { fetchFn, delayMs: 0 });
  assert.equal(calls.filter((u) => /BLPermit/.test(u)).length, 1);
  const p = r.permits.find((x) => x.number === '11103295');
  assert.equal(p.work, 'REROOF OF EXISTING STRUCTURE'); assert.equal(L.permitScope(p), 'full');
  assert.equal(r.permits.length, 1);   // non-roof permits at the address are not returned
  assert.equal(r.earliestYear, 1970);
});
test('permitScope handles real description spellings', () => {
  const P = (work) => ({ type: 'Roofing Permit', work, status: 'Complete', source: 'CLAY' });
  assert.equal(L.permitScope(P('Re roof')), 'full');
  assert.equal(L.permitScope(P(' Re Roof')), 'full');
  assert.equal(L.permitScope(P('new roof')), 'full');
  assert.equal(L.permitScope(P('roof over 13sq metal roof')), 'partial');
  assert.equal(L.permitScope(P('Residential Roof Repair/Replacement')), 'unknown');
});
