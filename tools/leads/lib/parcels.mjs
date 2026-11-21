// Parcel inventory from the Florida statewide cadastral layer (Department of Revenue 2026 roll).
import { createRequire } from 'node:module';
const { normAddr } = createRequire(import.meta.url)('../../../leadscore.js');

export const PARCEL_URL = 'https://services9.arcgis.com/Gh9awoU677aKree0/arcgis/rest/services/Florida_Statewide_Cadastral/FeatureServer/0/query';
export const ZIP_COUNTY = {
  32211: 26, 32224: 26, 32225: 26, 32246: 26, 32277: 26,          // Duval
  32003: 20, 32043: 20, 32065: 20, 32068: 20, 32073: 20,          // Clay
  32080: 65, 32081: 65, 32092: 65, 32259: 65,                     // St. Johns
};
const FIELDS = 'PARCEL_ID,DOR_UC,PHY_ADDR1,PHY_CITY,PHY_ZIPCD,OWN_NAME,OWN_ADDR1,OWN_ADDR2,OWN_CITY,OWN_STATE,OWN_ZIPCD,ACT_YR_BLT,EFF_YR_BLT,NO_BULDNG,TAX_AUTH_C';
const PAGE = 2000;

// every feature in the ZIP, single family (DOR use code 001) only; DOR_UC cannot go in the where clause (the layer rejects it)
export async function fetchZipParcels(zip, coNo, { fetchFn = fetch, onPage } = {}) {
  const out = [];
  for (let offset = 0; ; offset += PAGE) {
    const q = new URLSearchParams({ where: `CO_NO=${coNo} AND PHY_ZIPCD=${zip}`, outFields: FIELDS, returnGeometry: 'true', outSR: '4326',
      resultRecordCount: String(PAGE), resultOffset: String(offset), orderByFields: 'OBJECTID', f: 'json' });
    const r = await fetchFn(PARCEL_URL + '?' + q);
    if (!r.ok) throw new Error(`parcel layer HTTP ${r.status}`);
    const j = await r.json(); if (j.error) throw new Error('parcel layer: ' + (j.error.message || 'query failed'));
    const feats = j.features || [];
    out.push(...feats.filter((f) => f.attributes && f.attributes.DOR_UC === '001'));
    if (onPage) onPage({ offset, count: feats.length });
    if (!j.exceededTransferLimit || !feats.length) break;
  }
  return out;
}

const clean = (s) => String(s == null ? '' : s).trim();
function simplify(ring, max = 40) {
  let pts = ring.slice(0, -1).length >= 3 ? ring.slice(0, -1) : ring.slice();
  if (pts.length > max - 1) { const k = Math.ceil(pts.length / (max - 1)); pts = pts.filter((_, i) => i % k === 0); }
  pts = pts.map(([x, y]) => [+x.toFixed(6), +y.toFixed(6)]);
  return [...pts, pts[0]];
}
export function toParcelRow(f, zip) {
  const a = f.attributes || {}; const parcel_id = clean(a.PARCEL_ID);
  const addr = clean(a.PHY_ADDR1);
  if (!addr || addr === '0' || !/\d/.test(addr)) return { unresolved: true, parcel_id, reason: 'no_situs_address' };
  const ring0 = f.geometry && f.geometry.rings && f.geometry.rings[0];
  if (!ring0 || ring0.length < 3) return { unresolved: true, parcel_id, reason: 'no_parcel_shape' };
  const ring = simplify(ring0);
  const pts = ring.slice(0, -1);
  const centroid = { lng: +(pts.reduce((s, p) => s + p[0], 0) / pts.length).toFixed(6), lat: +(pts.reduce((s, p) => s + p[1], 0) / pts.length).toFixed(6) };
  const stateZip = [clean(a.OWN_STATE), a.OWN_ZIPCD ? String(Math.round(a.OWN_ZIPCD)).padStart(5, '0') : ''].filter(Boolean).join(' ');
  const mailing_address = [clean(a.OWN_ADDR1), clean(a.OWN_ADDR2), clean(a.OWN_CITY), stateZip].filter(Boolean).join(', ');
  return { parcel_id, property_address: normAddr(addr), city: clean(a.PHY_CITY).toUpperCase(), zip: String(zip), owner_of_record: clean(a.OWN_NAME), mailing_address,
    year_built: a.ACT_YR_BLT > 1800 ? a.ACT_YR_BLT : null, buildings: a.NO_BULDNG || null, tax_auth: clean(a.TAX_AUTH_C), centroid, ring };
}
export function dedupe(rows) {
  const ids = new Set(), addrs = new Set(); const out = []; let duplicates = 0;
  for (const r of rows) {
    const ak = normAddr(r.property_address) + '|' + r.zip;
    if (ids.has(r.parcel_id) || addrs.has(ak)) { duplicates++; continue; }
    ids.add(r.parcel_id); addrs.add(ak); out.push(r);
  }
  return { rows: out, duplicates };
}
