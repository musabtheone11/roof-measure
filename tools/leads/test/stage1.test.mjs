import test from 'node:test'; import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { createRequire } from 'node:module';
import { runZip, loadResults, writeOutputs } from '../stage1.mjs';
const L = createRequire(import.meta.url)('../../../leadscore.js');

const sq = (x, y, d = 0.0002) => [[x, y], [x + d, y], [x + d, y + d], [x, y + d], [x, y]];
const feat = (id, addr, yb) => ({ attributes: { PARCEL_ID: id, DOR_UC: '001', PHY_ADDR1: addr, PHY_CITY: 'MIDDLEBURG', OWN_NAME: 'DOE JOHN', OWN_ADDR1: '1 MAIL ST', OWN_CITY: 'MIDDLEBURG', OWN_STATE: 'FL', OWN_ZIPCD: 32068, ACT_YR_BLT: yb }, geometry: { rings: [sq(-81.9 + Number(id.slice(-1)) * 0.001, 30.07)] } });
const FEATS = [feat('A1', '1 OAK DR', 1990), feat('A2', '2 OAK DR', 1995), feat('A3', '3 OAK DR', 2001), feat('A4', '', 2000), feat('A5', '5 OAK DR', 1999)];
const permitsFor = { A1: [{ number: 'ROOF-1', type: 'Roofing Permit', work: 'Re roof', status: 'Complete', issued: '2023-02-01', finaled: '2023-02-10', source: 'CLAY' }] };
function deps(dir, { failOn = null } = {}) {
  const calls = [];
  return { calls, outDir: dir, now: new Date('2026-11-20T12:00:00'), cities: [], contacts: null,
    fetchParcels: async () => FEATS,
    adapters: { clay: async (row) => { calls.push(row.parcel_id); if (row.parcel_id === failOn) throw new Error('HTTP 503'); return { permits: permitsFor[row.parcel_id] || [], notes: [], source_link: 'https://clay/x' }; } } };
}
const cfg = { band_min_years: 8, zips: ['32068'] };

test('first run writes results and coverage counts that add up', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'leads-s1-'));
  const d = deps(dir); const s = await runZip('32068', cfg, d);
  const res = loadResults(path.join(dir, '32068', 'results.jsonl'));
  assert.equal(res.size, 4);
  assert.equal(s.inventoried, 5); assert.equal(s.unresolved, 1); assert.equal(s.duplicates, 0);
  assert.equal(s.screened, 4);
  assert.equal(s.screened, s.band_15plus + s.band_10_15 + s.band_min_10 + s.needs_review + s.screened_out_recent);
  assert.equal(s.screened_out_recent, 1);   // A1 replaced 2023
  assert.equal(s.needs_review, 3);          // Clay homes built before 2023 with no permit
  assert.equal(res.get('A2').review_reason, 'possibly_original');
  assert.equal(res.get('A2').permit_coverage, 'since_2023');
});
test('error rows are retried on the next run, finished rows are skipped', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'leads-s1-'));
  const d1 = deps(dir, { failOn: 'A2' }); const s1 = await runZip('32068', cfg, d1);
  assert.equal(s1.errors, 1);
  const r1 = loadResults(path.join(dir, '32068', 'results.jsonl'));
  assert.equal(r1.get('A2').status, 'error'); assert.equal(r1.get('A2').review_reason, 'permit_lookup_error'); assert.equal(r1.get('A2').age_band, 'needs_review');
  const d2 = deps(dir); await runZip('32068', cfg, d2);
  assert.deepEqual(d2.calls, ['A2']);
  const r2 = loadResults(path.join(dir, '32068', 'results.jsonl'));
  assert.equal(r2.get('A2').status, 'ok'); assert.equal(r2.size, 4);
});
test('a truncated last line is ignored and that parcel retried', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'leads-s1-'));
  await runZip('32068', cfg, deps(dir));
  const f = path.join(dir, '32068', 'results.jsonl');
  const lines = fs.readFileSync(f, 'utf8').trim().split('\n'); const lastId = JSON.parse(lines.at(-1)).parcel_id;
  fs.writeFileSync(f, lines.slice(0, -1).join('\n') + '\n' + lines.at(-1).slice(0, 25));
  const d = deps(dir); await runZip('32068', cfg, d);
  assert.deepEqual(d.calls, [lastId]);
  assert.equal(loadResults(f).size, 4);
});
test('sample takes the first N parcels by parcel id', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'leads-s1-'));
  const d = deps(dir); const s = await runZip('32068', { ...cfg, sample: 2 }, d);
  assert.deepEqual(d.calls.sort(), ['A1', 'A2']); assert.equal(s.screened, 2);
});
test('writeOutputs builds stage1.csv with the column order and evidence', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'leads-s1-'));
  await runZip('32068', cfg, deps(dir));
  writeOutputs(dir, ['32068']);
  const rows = L.parseCSV(fs.readFileSync(path.join(dir, 'stage1.csv'), 'utf8'));
  const head = fs.readFileSync(path.join(dir, 'stage1.csv'), 'utf8').split('\r\n')[0].split(',');
  assert.deepEqual(head.slice(0, 25), L.COLUMNS); assert.deepEqual(head.slice(25), ['lat', 'lng', 'ring_json', 'evidence']);
  assert.equal(rows.length, 3);   // screened_out_recent rows are left out
  const r = rows.find((x) => x.parcel_id === 'A2');
  assert.equal(r.report_status, 'not_eligible'); assert.equal(r.owner_of_record, 'DOE JOHN');
  assert.equal(L.decodeEvidence(r.evidence).b, 'year_built');
  assert.ok(JSON.parse(r.ring_json).length >= 4);
  assert.ok(fs.existsSync(path.join(dir, 'coverage.json')));
});
// final review fixes
import { writeJSONAtomic } from '../stage1.mjs';
test('writeJSONAtomic writes valid JSON and leaves no temp file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'leads-s1-'));
  const f = path.join(dir, 'x.json'); writeJSONAtomic(f, { a: 1 });
  assert.deepEqual(JSON.parse(fs.readFileSync(f, 'utf8')), { a: 1 });
  assert.deepEqual(fs.readdirSync(dir), ['x.json']);
});
