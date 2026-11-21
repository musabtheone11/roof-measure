import test from 'node:test'; import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fetchZipParcels, toParcelRow, dedupe, ZIP_COUNTY } from '../lib/parcels.mjs';
const page = JSON.parse(fs.readFileSync(new URL('./fixtures/parcels_page.json', import.meta.url)));
const feat = (o = {}, ring) => ({ attributes: { PARCEL_ID: 'P1', DOR_UC: '001', PHY_ADDR1: '10 Oak Drive', PHY_CITY: 'MIDDLEBURG', PHY_ZIPCD: 32068, OWN_NAME: 'DOE JOHN',
  OWN_ADDR1: '123 MAIN ST', OWN_ADDR2: 'APT 2', OWN_CITY: 'JACKSONVILLE', OWN_STATE: 'FL', OWN_ZIPCD: 32210, ACT_YR_BLT: 1995, NO_BULDNG: 1, ...o },
  geometry: { rings: [ring || [[-81.9, 30.1], [-81.8999, 30.1], [-81.8999, 30.1001], [-81.9, 30.1001], [-81.9, 30.1]]] } });

test('ZIP_COUNTY maps all 14 target ZIPs', () => {
  assert.equal(Object.keys(ZIP_COUNTY).length, 14);
  assert.equal(ZIP_COUNTY['32068'], 20); assert.equal(ZIP_COUNTY['32224'], 26); assert.equal(ZIP_COUNTY['32259'], 65);
});
test('blank situs address is unresolved', () => {
  const r = toParcelRow(page.features[3], '32068');
  assert.equal(r.unresolved, true); assert.equal(r.reason, 'no_situs_address'); assert.ok(r.parcel_id);
  assert.equal(toParcelRow(feat({ PHY_ADDR1: '0' }), '32068').reason, 'no_situs_address');
});
test('mailing address joins non-blank parts', () => {
  const r = toParcelRow(feat(), '32068');
  assert.equal(r.mailing_address, '123 MAIN ST, APT 2, JACKSONVILLE, FL 32210');
  assert.equal(toParcelRow(feat({ OWN_ADDR2: '' }), '32068').mailing_address, '123 MAIN ST, JACKSONVILLE, FL 32210');
  assert.equal(r.owner_of_record, 'DOE JOHN'); assert.equal(r.year_built, 1995); assert.equal(r.property_address, '10 OAK DR'); assert.equal(r.zip, '32068');
});
test('ring simplified to <= 40 points, 6 decimals, centroid inside', () => {
  const big = Array.from({ length: 200 }, (_, i) => [-81.9 + 0.0001 * Math.cos(i / 31.83) + 1e-9, 30.1 + 0.0001 * Math.sin(i / 31.83)]);
  const r = toParcelRow(feat({}, big), '32068');
  assert.ok(r.ring.length <= 40 && r.ring.length >= 4);
  for (const [x, y] of r.ring) { assert.equal(x, +x.toFixed(6)); assert.equal(y, +y.toFixed(6)); }
  assert.ok(Math.abs(r.centroid.lat - 30.1) < 0.0001 && Math.abs(r.centroid.lng + 81.9) < 0.0001);
});
test('dedupe by parcel id and by normalized address', () => {
  const a = toParcelRow(feat(), '32068');
  const b = toParcelRow(feat(), '32068');
  const c = toParcelRow(feat({ PARCEL_ID: 'P2', PHY_ADDR1: '10 OAK DR.' }), '32068');
  const d = toParcelRow(feat({ PARCEL_ID: 'P3', PHY_ADDR1: '12 OAK DR' }), '32068');
  const out = dedupe([a, b, c, d]);
  assert.equal(out.duplicates, 2); assert.deepEqual(out.rows.map((r) => r.parcel_id), ['P1', 'P3']);
});
test('fetchZipParcels pages and keeps single family only', async () => {
  const offsets = [];
  const fetchFn = async (url) => {
    const u = new URL(url); offsets.push(u.searchParams.get('resultOffset'));
    assert.equal(u.searchParams.get('where'), 'CO_NO=20 AND PHY_ZIPCD=32068');
    const first = u.searchParams.get('resultOffset') === '0';
    return { ok: true, json: async () => ({ features: first ? page.features : [feat({ PARCEL_ID: 'X9' })], exceededTransferLimit: first }) };
  };
  const f = await fetchZipParcels('32068', 20, { fetchFn });
  assert.deepEqual(offsets, ['0', '1000']);
  assert.ok(f.every((x) => x.attributes.DOR_UC === '001'));
  assert.equal(f.length, 4);   // 3 single family in the fixture page + 1 on page 2
});
test('fetchZipParcels retries a page that times out', async () => {
  let n = 0;
  const fetchFn = async () => { n++; if (n === 1) return { ok: false, status: 504 }; return { ok: true, json: async () => ({ features: page.features, exceededTransferLimit: false }) }; };
  const f = await fetchZipParcels('32068', 20, { fetchFn, retryMs: 0 });
  assert.equal(n, 2); assert.equal(f.length, 3);
});
