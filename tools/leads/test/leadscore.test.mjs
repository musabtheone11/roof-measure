import test from 'node:test'; import assert from 'node:assert/strict';
import { createRequire } from 'node:module'; const L = createRequire(import.meta.url)('../../../leadscore.js');
const now = new Date('2026-11-20T12:00:00');
const P = (o) => ({ number: 'R-1', type: 'Roofing Permit', work: 'Re-roof', structure: '', use: 'R', status: 'Finalized', issued: null, finaled: null, link: '', source: 'COJ', ...o });
const base = { yearBuilt: 1990, coverage: 'full_history', coverageFrom: 1985 };

test('isoDate normalizes formats', () => {
  assert.equal(L.isoDate('07/04/2009'), '2009-07-04');
  assert.equal(L.isoDate('2009-07-04T00:00:00'), '2009-07-04');
  assert.equal(L.isoDate('2009-07-04'), '2009-07-04');
  assert.equal(L.isoDate('garbage'), null);
  assert.equal(L.isoDate(null), null);
});
test('normAddr standardizes suffixes and punctuation', () => {
  assert.equal(L.normAddr('3916 Darlene Road.'), '3916 DARLENE RD');
  assert.equal(L.normAddr('12  Oak   Court, #4'), '12 OAK CT 4');
});
test('permitScope', () => {
  assert.equal(L.permitScope(P({ work: 'Re-roof' })), 'full');
  assert.equal(L.permitScope(P({ work: 'Roof Repair' })), 'partial');
  assert.equal(L.permitScope(P({ work: 'Re-roof', structure: 'Detached Garage' })), 'excluded');
  assert.equal(L.permitScope(P({ work: 'Shed reroof' })), 'excluded');
  assert.equal(L.permitScope(P({ type: 'Roofing Permit', work: '' })), 'unknown');
  assert.equal(L.permitScope(P({ type: 'Roofing Permit', work: '', source: 'COJ_INDEX', issued: '1999-01-01' })), 'full');
  assert.equal(L.permitScope(P({ type: 'Roofing Permit', work: '', source: 'COJ_INDEX', issued: '2010-01-01' })), 'unknown');
});
test('15+ from completed full replacement', () => {
  const r = L.classify({ ...base, permits: [P({ issued: '2009-03-01', finaled: '2009-04-01' })] }, { minYears: 8, now });
  assert.equal(r.age_band, '15+'); assert.equal(r.age_basis, 'completed_permit'); assert.equal(r.estimated_roof_age, 17);
  assert.equal(r.latest_completed_replacement_date, '2009-04-01');
  assert.equal(r.permit_number, 'R-1'); assert.equal(r.permit_status, 'Finalized');
});
test('band edges', () => {
  const at = (d) => L.classify({ ...base, permits: [P({ issued: d, finaled: d })] }, { minYears: 8, now }).age_band;
  assert.equal(at('2011-11-20'), '15+'); assert.equal(at('2011-11-21'), '10-15');
  assert.equal(at('2016-11-20'), '10-15'); assert.equal(at('2018-11-20'), '8-10'); assert.equal(at('2018-11-21'), 'screened_out_recent');
});
test('min 7 config', () => {
  const r = L.classify({ ...base, permits: [P({ issued: '2019-06-01', finaled: '2019-06-01' })] }, { minYears: 7, now });
  assert.equal(r.age_band, '7-10');
});
test('year built only -> needs_review possibly_original', () => {
  const r = L.classify({ ...base, permits: [], yearBuilt: 1998 }, { minYears: 8, now });
  assert.equal(r.age_band, 'needs_review'); assert.equal(r.age_basis, 'year_built'); assert.equal(r.review_reason, 'possibly_original');
});
test('coverage shorter than house -> needs_review', () => {
  const r = L.classify({ permits: [], yearBuilt: 2001, coverage: 'since_2023', coverageFrom: 2023 }, { minYears: 8, now });
  assert.equal(r.age_band, 'needs_review'); assert.equal(r.review_reason, 'possibly_original');
});
test('no coverage -> needs_review no_permit_coverage', () => {
  const r = L.classify({ permits: [], yearBuilt: 2001, coverage: 'none', coverageFrom: null }, { minYears: 8, now });
  assert.equal(r.age_band, 'needs_review'); assert.equal(r.review_reason, 'no_permit_coverage');
});
test('newer issued permit without completion -> needs_review', () => {
  const r = L.classify({ ...base, permits: [P({ number: 'A', issued: '2008-01-01', finaled: '2008-02-01' }), P({ number: 'B', issued: '2025-05-01', status: 'Active' })] }, { minYears: 8, now });
  assert.equal(r.age_band, 'needs_review'); assert.equal(r.review_reason, 'newer_permit_unverified');
  assert.equal(r.latest_permit_issue_date, '2025-05-01'); assert.equal(r.latest_completed_replacement_date, '2008-02-01');
});
test('partial and excluded permits ignored for age', () => {
  const r = L.classify({ ...base, permits: [P({ issued: '2009-03-01', finaled: '2009-04-01' }), P({ work: 'Roof Repair', issued: '2024-01-01', finaled: '2024-01-05' })] }, { minYears: 8, now });
  assert.equal(r.age_band, '15+');
});
test('void permits ignored', () => {
  const r = L.classify({ ...base, permits: [P({ issued: '2009-03-01', finaled: '2009-04-01' }), P({ issued: '2025-01-01', status: 'Void' })] }, { minYears: 8, now });
  assert.equal(r.age_band, '15+');
});
test('lookup error -> needs_review', () => {
  assert.equal(L.classify({ permits: [], yearBuilt: 1990, coverage: 'error', coverageFrom: null }, { minYears: 8, now }).review_reason, 'permit_lookup_error');
});
test('evidence round trip', () => {
  const ev = { b: 'completed_permit', n: 'R-09-1', i: '2009-03-01', c: '2009-04-01', cov: 'full_history', src: 'https://x/y?a=1&b=2', o: 'Café' };
  assert.deepEqual(L.decodeEvidence(L.encodeEvidence(ev)), ev); assert.equal(L.decodeEvidence('%%%'), null);
  assert.match(L.encodeEvidence(ev), /^[A-Za-z0-9_-]+$/);
});
test('CSV round trip with commas, quotes, newlines', () => {
  const rows = [{ a: 'SMITH, JOHN "JR"', b: 'line1\nline2', c: '' }, { a: 'x', b: 'y', c: 'z' }];
  assert.deepEqual(L.parseCSV(L.toCSV(rows, ['a', 'b', 'c'])), rows);
});
test('COLUMNS order', () => { assert.equal(L.COLUMNS[0], 'age_band'); assert.equal(L.COLUMNS.length, 25); assert.equal(L.COLUMNS[10], 'roof_report_link'); });
