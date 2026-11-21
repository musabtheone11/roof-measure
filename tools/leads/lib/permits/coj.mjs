// City of Jacksonville: the repo's published copy of every roofing permit (permits/), plus the live JAXEPICS search by parcel.
import fs from 'node:fs';
import { createRequire } from 'node:module';
const { isoDate } = createRequire(import.meta.url)('../../../../leadscore.js');
const DIR = new URL('../../../../permits/', import.meta.url);
const SITE = 'https://jaxepics.coj.net';
const API = 'https://jaxepicsapi.coj.net/api/AdvancedSearches/';
let meta = null; const buckets = {}; let columns = null;

export const reOf = (parcelId) => { const d = String(parcelId).replace(/\D/g, ''); return d.length === 10 ? d.slice(0, 6) + ' ' + d.slice(6) : null; };
export function indexMeta() { if (!meta) meta = JSON.parse(fs.readFileSync(new URL('meta.json', DIR), 'utf8')); return meta; }

function fromIndex(re10) {
  const m = indexMeta(); const b = re10.slice(0, 3);
  if (!(b in buckets)) { try { buckets[b] = JSON.parse(fs.readFileSync(new URL(`roof_${b}.json`, DIR), 'utf8')); } catch (_) { buckets[b] = {}; } }
  return (buckets[b][re10] || []).map((x) => ({ number: x[0], type: 'Roofing Permit', work: x[4] || '', structure: '', use: x[7] || '', status: m.statuses[x[2]] || '',
    issued: x[1] || null, finaled: x[3] || null, link: x[9] ? `${SITE}/Permit/View/${x[9]}` : '', source: 'COJ_INDEX' }));
}
async function live(re, fetchFn) {
  if (!columns) { const r = await fetchFn(API + 'GetColumns/82'); if (!r.ok) throw new Error('JAXEPICS HTTP ' + r.status); columns = Object.fromEntries((await r.json()).map((c) => [c.ColumnId, c])); }
  const obj = { SearchString: re };
  const filter = { SavedSearchFilterId: 0, SavedSearchId: 0, ColumnId: 28, Column: columns[28], OperatorId: 1, Order: -1, Obj: obj, groupedSectionControls: {}, Completed: true,
    EvalValueString: JSON.stringify(obj), IsActive: true, SavedSearch: null, DisplayInWidget: true, PinnedInWidget: false, Sort: 0 };
  const body = { SavedSearchColumns: [1, 2, 3, 4, 5, 6, 7, 8, 16, 18, 19, 20, 25, 28].map((id) => ({ ColumnId: id })), SavedSearchFilters: [filter], UserSavedSearches: [], UserSavedSearchWidgets: [], TableId: 82 };
  const r = await fetchFn(`${API}Advanced?page=1&pageSize=500&filter=&sortActive=DateIssued&sortDirection=desc&forSpreadSheet=false`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error('JAXEPICS HTTP ' + r.status);
  const j = await r.json();
  return (j.values || []).filter((v) => v.FullPermitNumber && /roof/i.test(v.PermitTypeDescription || '')).map((v) => ({
    number: v.FullPermitNumber, type: v.PermitTypeDescription || '', work: [v.WorkTypeDescription, v.WorkSubTypeDescription].filter(Boolean).join(' - '),
    structure: v.StructureTypeDescription || '', use: '', status: v.StatusDescription || '', issued: isoDate(v.DateIssued), finaled: isoDate(v.DateFinal),
    link: v.FullPermitNumber_Click ? `${SITE}/${v.FullPermitNumber_Click}` : '', source: 'COJ_LIVE' }));
}
// live: also ask the city's system (catches permits issued after the published copy). Live failure keeps the copy and adds a note.
export async function lookup(row, { live: useLive = true, fetchFn = fetch } = {}) {
  const re = reOf(row.parcel_id); if (!re) throw new Error('no Duval RE number in parcel id ' + row.parcel_id);
  const permits = fromIndex(re.replace(' ', '')); const notes = [];
  if (useLive) {
    try { const have = new Map(permits.map((p, i) => [p.number, i])); for (const p of await live(re, fetchFn)) { if (have.has(p.number)) permits[have.get(p.number)] = p; else permits.push(p); } }
    catch (e) { notes.push('live_city_check_failed'); }
  }
  return { permits, notes, source_link: `${SITE}/Search/SearchResults?SearchTerm=${encodeURIComponent(re)}`, through: indexMeta().through };
}
