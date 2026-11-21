#!/usr/bin/env node
// Stage 1 of the lead workflow: inventory single-family parcels per ZIP, look up roof permits, classify roof age, match phones.
// Restartable: every parcel result is appended to leads-data/<zip>/results.jsonl; a rerun skips finished parcels and retries errors.
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { fetchZipParcels, toParcelRow, dedupe, ZIP_COUNTY } from './lib/parcels.mjs';
import { jurisdictionOf, loadCityLimits } from './lib/jurisdiction.mjs';
import { loadContactSources, matchPhone } from './lib/contacts.mjs';
import * as coj from './lib/permits/coj.mjs'; import * as clay from './lib/permits/clay.mjs'; import * as stjohns from './lib/permits/stjohns.mjs';
const L = createRequire(import.meta.url)('../../leadscore.js');
const BANDS = (min) => ['15+', '10-15', `${min}-10`];
const EXTRA = ['lat', 'lng', 'ring_json', 'evidence'];

// ------------------------------------------------------------ checkpoint files
export function loadResults(file) {
  const m = new Map(); if (!fs.existsSync(file)) return m;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) { if (!line.trim()) continue; try { const r = JSON.parse(line); if (r && r.parcel_id) m.set(r.parcel_id, r); } catch (_) { /* partial line from a crash */ } }
  return m;
}
function appendLine(file, obj) {
  // start on a fresh line if a crash left a partial one
  let prefix = '';
  if (fs.existsSync(file)) { const st = fs.statSync(file); if (st.size) { const fd = fs.openSync(file, 'r'); const b = Buffer.alloc(1); fs.readSync(fd, b, 0, 1, st.size - 1); fs.closeSync(fd); if (b[0] !== 10) prefix = '\n'; } }
  fs.appendFileSync(file, prefix + JSON.stringify(obj) + '\n');
}

async function inventory(zip, coNo, deps, zdir) {
  const pf = path.join(zdir, 'parcels.json');
  if (fs.existsSync(pf)) return JSON.parse(fs.readFileSync(pf, 'utf8'));
  const feats = await deps.fetchParcels(zip, coNo);
  const conv = feats.map((f) => toParcelRow(f, zip));
  const unresolved = conv.filter((r) => r.unresolved);
  const { rows, duplicates } = dedupe(conv.filter((r) => !r.unresolved));
  const inv = { zip, inventoried: feats.length, unresolved: unresolved.length, unresolved_ids: unresolved.map((r) => `${r.parcel_id}:${r.reason}`), duplicates, rows };
  fs.writeFileSync(pf, JSON.stringify(inv));
  return inv;
}

async function processRow(row, coNo, cfg, deps) {
  const min = cfg.band_min_years === 7 ? 7 : 8;
  const j = jurisdictionOf(row, coNo, deps.cities || []);
  const base = { parcel_id: row.parcel_id, property_address: row.property_address, zip: row.zip, owner_of_record: row.owner_of_record, mailing_address: row.mailing_address,
    year_built: row.year_built, jurisdiction: j.name, permit_coverage: j.coverage, permit_source: j.portal, lat: row.centroid.lat, lng: row.centroid.lng, ring: row.ring,
    buildings: row.buildings, checked_at: (deps.now || new Date()).toISOString().slice(0, 10) };
  let res = { permits: [], notes: [] }, status = 'ok', error = null, coverage = j.coverage;
  if (j.adapter) {
    const fn = deps.adapters[j.adapter];
    try {
      if (!fn) throw new Error(`no ${j.adapter} adapter`);
      res = await fn(row, { live: false });
      let c = L.classify({ permits: res.permits, yearBuilt: row.year_built, coverage, coverageFrom: j.coverageFrom }, { minYears: min, now: deps.now });
      // Duval: confirm banded homes against the live city system (permits issued after the published copy)
      if (j.adapter === 'coj' && BANDS(min).includes(c.age_band)) res = await fn(row, { live: true });
    } catch (e) { status = 'error'; error = String(e.message || e); coverage = 'error'; base.permit_coverage = 'error'; }
  }
  const c = L.classify({ permits: res.permits, yearBuilt: row.year_built, coverage, coverageFrom: j.coverageFrom }, { minYears: min, now: deps.now });
  const notes = [...(res.notes || []), ...(c.notes || [])];
  if (row.buildings > 1) notes.push('multi_building');
  const src = (res.permits.find((p) => p.number === c.permit_number) || {}).link || res.source_link || j.portal;
  const out = { ...base, ...c, status, error, permit_source: src, notes };
  if (BANDS(min).includes(c.age_band) || c.age_band === 'needs_review') {
    const m = matchPhone(row, deps.contacts);
    Object.assign(out, { phone: m.phone, phone_source: m.phone_source, match_confidence: m.match_confidence, outreach_status: m.outreach_status }); out.notes.push(...m.notes);
  }
  out.evidence = L.encodeEvidence({ b: c.age_basis, n: c.permit_number, s: c.permit_status, i: c.latest_permit_issue_date, c: c.latest_completed_replacement_date,
    cov: out.permit_coverage, src, yb: row.year_built, j: j.name, r: c.review_reason, on: out.checked_at });
  return out;
}

async function pool(items, n, fn) { let i = 0; await Promise.all(Array.from({ length: Math.max(1, n) }, async () => { while (i < items.length) { const k = i++; await fn(items[k], k); } })); }

export async function runZip(zip, cfg, deps) {
  const coNo = ZIP_COUNTY[zip]; if (!coNo) throw new Error('ZIP not in the target list: ' + zip);
  const zdir = path.join(deps.outDir, String(zip)); fs.mkdirSync(zdir, { recursive: true });
  const inv = await inventory(zip, coNo, deps, zdir);
  let rows = inv.rows.slice().sort((a, b) => (a.parcel_id < b.parcel_id ? -1 : 1));
  if (cfg.sample) rows = rows.slice(0, cfg.sample);
  const rf = path.join(zdir, 'results.jsonl'); const done = loadResults(rf);
  const todo = cfg.inventoryOnly ? [] : rows.filter((r) => !done.has(r.parcel_id) || done.get(r.parcel_id).status !== 'ok');
  let n = 0;
  await pool(todo, cfg.concurrency || 2, async (row) => {
    const out = await processRow(row, coNo, cfg, deps); appendLine(rf, out); done.set(row.parcel_id, out);
    if (deps.log && ++n % 25 === 0) deps.log(`${zip}: ${n}/${todo.length}`);
  });
  const min = cfg.band_min_years === 7 ? 7 : 8; const ids = new Set(rows.map((r) => r.parcel_id));
  const res = [...done.values()].filter((r) => ids.has(r.parcel_id));
  const cnt = (f) => res.filter(f).length;
  const stats = { zip, county: coNo, inventoried: inv.inventoried, unresolved: inv.unresolved, duplicates: inv.duplicates, single_family_addresses: inv.rows.length,
    sample: cfg.sample || null, screened: res.length, band_15plus: cnt((r) => r.age_band === '15+'), band_10_15: cnt((r) => r.age_band === '10-15'),
    band_min_10: cnt((r) => r.age_band === `${min}-10`), needs_review: cnt((r) => r.age_band === 'needs_review'), screened_out_recent: cnt((r) => r.age_band === 'screened_out_recent'),
    errors: cnt((r) => r.status === 'error'), permit_coverage: {}, review_reasons: {}, with_phone: cnt((r) => r.phone) };
  for (const r of res) { stats.permit_coverage[r.permit_coverage] = (stats.permit_coverage[r.permit_coverage] || 0) + 1; if (r.review_reason) stats.review_reasons[r.review_reason] = (stats.review_reasons[r.review_reason] || 0) + 1; }
  fs.writeFileSync(path.join(zdir, 'stats.json'), JSON.stringify(stats, null, 2));
  return stats;
}

export function writeOutputs(outDir, zips) {
  const all = []; const coverage = {};
  for (const zip of zips) {
    const zdir = path.join(outDir, String(zip)); if (!fs.existsSync(path.join(zdir, 'stats.json'))) continue;
    coverage[zip] = JSON.parse(fs.readFileSync(path.join(zdir, 'stats.json'), 'utf8'));
    const ids = coverage[zip].sample ? new Set(JSON.parse(fs.readFileSync(path.join(zdir, 'parcels.json'), 'utf8')).rows.map((r) => r.parcel_id).sort().slice(0, coverage[zip].sample)) : null;
    for (const r of loadResults(path.join(zdir, 'results.jsonl')).values()) {
      if (ids && !ids.has(r.parcel_id)) continue;
      if (r.age_band === 'screened_out_recent') continue;
      all.push({ ...r, roof_report_link: '', report_status: r.age_band === 'needs_review' ? 'not_eligible' : 'pending', imagery_date: '',
        notes: [...new Set(r.notes || [])].join('; ') + (r.error ? (r.notes && r.notes.length ? '; ' : '') + 'error: ' + r.error : ''), ring_json: JSON.stringify(r.ring || []) });
    }
  }
  fs.writeFileSync(path.join(outDir, 'stage1.csv'), L.toCSV(all, [...L.COLUMNS, ...EXTRA]));
  fs.writeFileSync(path.join(outDir, 'coverage.json'), JSON.stringify(coverage, null, 2));
  return { rows: all.length, coverage };
}

// ------------------------------------------------------------ CLI
function args(argv) {
  const a = { config: null, zips: null, sample: null, out: 'leads-data', inventoryOnly: false, refreshClay: false };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--config') a.config = argv[++i]; else if (k === '--zips') a.zips = argv[++i].split(',').map((s) => s.trim());
    else if (k === '--sample') a.sample = +argv[++i]; else if (k === '--out') a.out = argv[++i];
    else if (k === '--inventory-only') a.inventoryOnly = true; else if (k === '--refresh-clay') a.refreshClay = true;
    else throw new Error('unknown option ' + k);
  }
  return a;
}
async function cached(file, refresh, make) { if (!refresh && fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8')); const v = await make(); fs.writeFileSync(file, JSON.stringify(v)); return v; }
async function retrying(fn, tries = 3) { for (let k = 1; ; k++) { try { return await fn(); } catch (e) { if (k >= tries) throw e; await new Promise((r) => setTimeout(r, 1500 * k)); } } }

async function main() {
  const a = args(process.argv.slice(2));
  const cfg = a.config ? JSON.parse(fs.readFileSync(a.config, 'utf8')) : {};
  const zips = a.zips || cfg.zips || Object.keys(ZIP_COUNTY);
  const runCfg = { ...cfg, sample: a.sample || cfg.sample || null, inventoryOnly: a.inventoryOnly };
  fs.mkdirSync(a.out, { recursive: true });
  const log = (m) => console.log(new Date().toISOString().slice(11, 19), m);
  const cities = await cached(path.join(a.out, 'cities.json'), false, () => retrying(() => loadCityLimits()));
  const needClay = !a.inventoryOnly && zips.some((z) => ZIP_COUNTY[z] === 20);
  const clayIdx = needClay ? await cached(path.join(a.out, 'clay_roof.json'), a.refreshClay, () => { log('Downloading Clay County roofing permits...'); return clay.harvest({ onPage: (p) => p.page % 20 === 0 && log(`Clay page ${p.page}/${p.pages}`) }); }) : null;
  if (clayIdx) log(`Clay roofing permits: ${clayIdx.count}`);
  const contacts = loadContactSources(cfg.contacts || []);
  const deps = { outDir: a.out, now: new Date(), cities, contacts, log,
    fetchParcels: (zip, coNo) => retrying(() => fetchZipParcels(zip, coNo, { onPage: (p) => log(`${zip}: parcel page at ${p.offset}`) })),
    adapters: { coj: (row, o) => retrying(() => coj.lookup(row, o)), clay: async (row) => clay.lookup(row, clayIdx), stjohns: (row) => retrying(() => stjohns.lookup(row)) } };
  for (const zip of zips) { log(`ZIP ${zip}...`); const s = await runZip(zip, runCfg, deps); log(`ZIP ${zip}: ${JSON.stringify(s)}`); }
  const o = writeOutputs(a.out, zips);
  log(`Wrote ${path.join(a.out, 'stage1.csv')} (${o.rows} rows) and coverage.json`);
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) main().catch((e) => { console.error(e.stack || e); process.exit(1); });
