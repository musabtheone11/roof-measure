# Lead Workflow (Lead mode) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Stage 1 Node script that inventories and classifies every single-family parcel in the target ZIPs by roof age, and a Stage 2 Leads tab in the app that verifies the building match and writes CRM-ready CSVs with on-demand roof report links.

**Architecture:** Stage 1 (`tools/leads/`) runs in Node 18+ with no dependencies, pulling public parcel and permit data with JSON-lines checkpoints. One logic file, `leadscore.js`, works as a browser global and as a Node module, so both stages share the classification and evidence encoding. Stage 2 is a classic script, `leads.js`, plus `leadopen.js` (opens `?lead=` links). Both reuse the existing globals: `setLocation`, `runSolar`, `autoTraceRoof`, `permit`, report builders.

**Tech Stack:** Node 26 (`node:test`, global `fetch`), vanilla browser JS, IndexedDB, Google Solar API (browser only, existing key in `localStorage['rm.key']`).

**Spec:** `docs/superpowers/specs/2026-11-20-lead-workflow-design.md`

## Global Constraints

- No Google API key in any file the script writes, any CSV, or any link. The key stays in `localStorage['rm.key']` only.
- No Solar API response values saved anywhere. Only `report_status`, `imagery_date` and the match coordinates are kept.
- Existing Residential and Commercial workflows behave exactly as before when there is no `?lead=` parameter and the Leads tab isn't used.
- Age bands: `15+` (age ≥ 15), `10-15` (10 ≤ age < 15), `<min>-10` (min ≤ age < 10, `band_min_years` default 8, allowed 7 or 8), `needs_review`. A home with a completed full replacement and age < min is `screened_out_recent`, which goes in no CSV.
- The year built alone never puts a home in an age band. That case is `needs_review` with `age_basis = year_built` and `review_reason = possibly_original`.
- Phone filled only for `match_confidence` of `exact_parcel` or `address_name` with exactly one distinct number. `outreach_status` is copied from the source, or `do_not_contact` when an opt-out is found, and is never invented.
- CSV: UTF-8, header row, ISO dates `YYYY-MM-DD`, RFC 4180 quoting. Column order is exactly:
  `age_band, property_address, zip, parcel_id, owner_of_record, mailing_address, phone, phone_source, match_confidence, outreach_status, roof_report_link, report_status, estimated_roof_age, age_basis, latest_permit_issue_date, latest_completed_replacement_date, permit_number, permit_status, permit_source, permit_coverage, review_reason, year_built, jurisdiction, imagery_date, notes`
- Target ZIPs: Duval (CO_NO 26) 32211, 32224, 32225, 32246, 32277. Clay (CO_NO 20) 32003, 32043, 32065, 32068, 32073. St. Johns (CO_NO 65) 32080, 32081, 32092, 32259.
- Parcel layer: `https://services9.arcgis.com/Gh9awoU677aKree0/arcgis/rest/services/Florida_Statewide_Cadastral/FeatureServer/0/query`, `where=CO_NO=<n> AND PHY_ZIPCD=<zip>`, filter `DOR_UC === '001'` client-side (`DOR_UC` in the where clause fails), page size 2000, `outSR=4326`. Count queries time out, so don't use them.
- Polite rate limits on public servers: at most 2 concurrent requests per host, plus a 300 ms delay per St. Johns WATS request.

## Review Focus

1. A parcel with a blank or "0" `PHY_ADDR1` (no street address) is counted as `unresolved` in coverage and never crashes the run. Test in Task 2.
2. Owner names or addresses containing commas, quotes or line breaks round-trip through the CSV writer (Node) and the CSV parser (browser) unchanged. Test in Task 1.
3. Permit dates arrive as `MM/DD/YYYY`, ISO with time, or ISO date. All normalize to `YYYY-MM-DD`, and an unparseable date becomes `null`, not "Invalid Date". Test in Task 1.
4. A network error or HTTP 429/5xx on one parcel marks that parcel `error`, and a restart retries it. A crash mid-write never leaves a half line that breaks the next load. Test in Task 5.
5. Solar returns 403 or 429 (bad key or quota): the Leads batch pauses with a message instead of marking every remaining row `api_error`. Test in Task 7.

---

### Task 1: Shared lead logic (`leadscore.js`)

**Files:**
- Create: `leadscore.js` (repo root, UMD-style: `module.exports` in Node, `window.LeadsCore` in browser)
- Test: `tools/leads/test/leadscore.test.mjs`

**Interfaces:**
- Produces:
  - `isoDate(s: string|null) -> string|null`
  - `normAddr(s: string) -> string` (upper case, punctuation removed, suffixes standardized: `DRIVE→DR, STREET→ST, ROAD→RD, AVENUE→AVE, COURT→CT, CIRCLE→CIR, LANE→LN, BOULEVARD→BLVD, PLACE→PL, TERRACE→TER, TRAIL→TRL, PARKWAY→PKWY, WAY→WAY`, single spaces)
  - `permitScope(p: {type, work, structure, use, number}) -> 'full'|'partial'|'excluded'|'unknown'`
  - `summarizePermits(permits: Permit[]) -> {latestIssued: Permit|null, latestCompleted: Permit|null, newerUnverified: boolean}`
  - `classify(input: {permits, yearBuilt, coverageFrom: number|null, coverage: 'full_history'|'since_2023'|'none'|'error'}, cfg: {minYears: 7|8, now: Date}) -> {age_band, estimated_roof_age, age_basis, review_reason, latest_permit_issue_date, latest_completed_replacement_date, permit_number, permit_status}`
  - `encodeEvidence(ev: object) -> string` (base64url of JSON) and `decodeEvidence(s) -> object|null`
  - `toCSV(rows: object[], columns: string[]) -> string` and `parseCSV(text: string) -> object[]`
  - `COLUMNS: string[]` (the exact column order from Global Constraints)
  - `Permit` shape: `{number, type, work, structure, use, status, issued, finaled, link, source}`

- [ ] **Step 1: Write the failing tests**

```js
// tools/leads/test/leadscore.test.mjs
import test from 'node:test'; import assert from 'node:assert/strict';
import { createRequire } from 'node:module'; const L = createRequire(import.meta.url)('../../../leadscore.js');
const now = new Date('2026-11-20T12:00:00');
const P = (o) => ({ number: 'R-1', type: 'Roofing Permit', work: 'Re-roof', structure: '', use: 'R', status: 'Finalized', issued: null, finaled: null, link: '', source: 'COJ', ...o });

test('isoDate normalizes formats', () => {
  assert.equal(L.isoDate('07/04/2009'), '2009-07-04');
  assert.equal(L.isoDate('2009-07-04T00:00:00'), '2009-07-04');
  assert.equal(L.isoDate('2009-07-04'), '2009-07-04');
  assert.equal(L.isoDate('garbage'), null);
});
test('permitScope', () => {
  assert.equal(L.permitScope(P({ work: 'Re-roof' })), 'full');
  assert.equal(L.permitScope(P({ work: 'Roof Repair' })), 'partial');
  assert.equal(L.permitScope(P({ work: 'Re-roof', structure: 'Detached Garage' })), 'excluded');
  assert.equal(L.permitScope(P({ work: 'Shed reroof' })), 'excluded');
  assert.equal(L.permitScope(P({ type: 'Roofing Permit', work: '' })), 'unknown');
});
test('15+ from completed full replacement', () => {
  const r = L.classify({ permits: [P({ issued: '2009-03-01', finaled: '2009-04-01' })], yearBuilt: 1990, coverage: 'full_history', coverageFrom: 1985 }, { minYears: 8, now });
  assert.equal(r.age_band, '15+'); assert.equal(r.age_basis, 'completed_permit'); assert.equal(r.estimated_roof_age, 17);
  assert.equal(r.latest_completed_replacement_date, '2009-04-01');
});
test('band edges', () => {
  const at = (d) => L.classify({ permits: [P({ issued: d, finaled: d })], yearBuilt: 1990, coverage: 'full_history', coverageFrom: 1985 }, { minYears: 8, now }).age_band;
  assert.equal(at('2011-11-20'), '15+'); assert.equal(at('2011-11-21'), '10-15');
  assert.equal(at('2016-11-20'), '10-15'); assert.equal(at('2018-11-20'), '8-10'); assert.equal(at('2018-11-21'), 'screened_out_recent');
});
test('min 7 config', () => {
  const r = L.classify({ permits: [P({ issued: '2019-06-01', finaled: '2019-06-01' })], yearBuilt: 1990, coverage: 'full_history', coverageFrom: 1985 }, { minYears: 7, now });
  assert.equal(r.age_band, '7-10');
});
test('year built only -> needs_review possibly_original', () => {
  const r = L.classify({ permits: [], yearBuilt: 1998, coverage: 'full_history', coverageFrom: 1985 }, { minYears: 8, now });
  assert.equal(r.age_band, 'needs_review'); assert.equal(r.age_basis, 'year_built'); assert.equal(r.review_reason, 'possibly_original');
});
test('coverage shorter than house -> needs_review', () => {
  const r = L.classify({ permits: [], yearBuilt: 2001, coverage: 'since_2023', coverageFrom: 2023 }, { minYears: 8, now });
  assert.equal(r.age_band, 'needs_review'); assert.equal(r.review_reason, 'possibly_original');
});
test('newer issued permit without completion -> needs_review', () => {
  const r = L.classify({ permits: [P({ number: 'A', issued: '2008-01-01', finaled: '2008-02-01' }), P({ number: 'B', issued: '2025-05-01', status: 'Active' })], yearBuilt: 1990, coverage: 'full_history', coverageFrom: 1985 }, { minYears: 8, now });
  assert.equal(r.age_band, 'needs_review'); assert.equal(r.review_reason, 'newer_permit_unverified');
  assert.equal(r.latest_permit_issue_date, '2025-05-01'); assert.equal(r.latest_completed_replacement_date, '2008-02-01');
});
test('partial and excluded permits ignored for age', () => {
  const r = L.classify({ permits: [P({ issued: '2009-03-01', finaled: '2009-04-01' }), P({ work: 'Roof Repair', issued: '2024-01-01', finaled: '2024-01-05' })], yearBuilt: 1990, coverage: 'full_history', coverageFrom: 1985 }, { minYears: 8, now });
  assert.equal(r.age_band, '15+');
});
test('void permits ignored', () => {
  const r = L.classify({ permits: [P({ issued: '2009-03-01', finaled: '2009-04-01' }), P({ issued: '2025-01-01', status: 'Void' })], yearBuilt: 1990, coverage: 'full_history', coverageFrom: 1985 }, { minYears: 8, now });
  assert.equal(r.age_band, '15+');
});
test('lookup error -> needs_review', () => {
  assert.equal(L.classify({ permits: [], yearBuilt: 1990, coverage: 'error', coverageFrom: null }, { minYears: 8, now }).review_reason, 'permit_lookup_error');
});
test('evidence round trip', () => {
  const ev = { b: 'completed_permit', n: 'R-09-1', i: '2009-03-01', c: '2009-04-01', cov: 'full_history', src: 'https://x/y?a=1&b=2' };
  assert.deepEqual(L.decodeEvidence(L.encodeEvidence(ev)), ev); assert.equal(L.decodeEvidence('%%%'), null);
});
test('CSV round trip with commas, quotes, newlines', () => {
  const rows = [{ a: 'SMITH, JOHN "JR"', b: 'line1\nline2', c: '' }];
  assert.deepEqual(L.parseCSV(L.toCSV(rows, ['a', 'b', 'c'])), rows);
});
test('COLUMNS order', () => { assert.equal(L.COLUMNS[0], 'age_band'); assert.equal(L.COLUMNS.length, 25); });
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `node --test tools/leads/test/`
Expected: FAIL with "Cannot find module '../../../leadscore.js'"

- [ ] **Step 3: Implement `leadscore.js`**

Rules the tests don't fully fix:
- `permitScope` checks, in this order:
  - `excluded`: `/shed|detached|garage|carport|pool|screen|enclosure|accessory|barn|gazebo|pergola/i` in `structure` or `work`.
  - `partial`: `/repair|patch|partial|leak|replace (\d+ )?sq|section|soffit|fascia|gutter|skylight/i`.
  - `full`: `/re-?roof|reroof|roof over existing|tear ?off|replace(ment)?|new roof|recover/i` in `work` or `type`.
  - `full` also when `type` matches `/roof/i` and `work` is blank, *only* if `source === 'COJ_INDEX'` and the permit was issued before 2007. Those city records have no work type, and roofing permits back then were for replacements. Anything else is `unknown`.
- Void: `/void|withdr|cancel|denied|reject/i` on `status`, which is ignored entirely.
- Completed: scope `full` and (`finaled` set, or `status` matches `/final|complete|closed/i` with `issued` set). The completion date is `finaled`, or `issued` when `finaled` is missing but the status is final. In that case add the note `completion_date_from_issue`.
- `newerUnverified`: any non-void permit with roof scope `full` or `unknown` that was issued after the latest completed date and isn't itself completed.
- Age in whole years: `floor((now - date) / 365.2425 days)`, so `2011-11-20` gives 15 when now is `2026-11-20`.
- `review_reason` values: `possibly_original`, `newer_permit_unverified`, `permit_lookup_error`, `no_permit_coverage`, `no_year_built`.
- base64url via `btoa`/`atob` with UTF-8 handling, in both Node 18+ and the browser.

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `node --test tools/leads/test/`
Expected: all tests pass

- [ ] **Step 5: Commit**

```bash
git add leadscore.js tools/leads/test/leadscore.test.mjs
git commit -m "Add shared lead classification logic"
```

---

### Task 2: Parcel inventory

**Files:**
- Create: `tools/leads/lib/parcels.mjs`, `tools/leads/test/fixtures/parcels_page.json` (3 to 5 real features captured once from the live layer, owner fields replaced with fake names)
- Test: `tools/leads/test/parcels.test.mjs`

**Interfaces:**
- Consumes: `normAddr` (Task 1)
- Produces:
  - `fetchZipParcels(zip: string, coNo: number, {fetchFn = fetch, onPage}) -> Promise<RawFeature[]>` (pages with `resultOffset` until `exceededTransferLimit` is false)
  - `toParcelRow(f: RawFeature, zip) -> {parcel_id, property_address, city, zip, owner_of_record, mailing_address, year_built, buildings, centroid: {lat, lng}, ring: [[lng, lat], ...]} | {unresolved: true, parcel_id, reason}`
  - `dedupe(rows) -> {rows, duplicates: number}`
  - `ZIP_COUNTY: {[zip]: coNo}`

- [ ] **Step 1: Write the failing tests**
  - `toParcelRow` on a fixture with `PHY_ADDR1: ''` returns `{unresolved: true, reason: 'no_situs_address'}`.
  - `toParcelRow` joins `OWN_ADDR1, OWN_ADDR2, OWN_CITY, OWN_STATE, OWN_ZIPCD` into `mailing_address` as `"123 MAIN ST, APT 2, JACKSONVILLE, FL 32210"`, skipping blanks.
  - `ring` is simplified to at most 40 points and rounded to 6 decimals.
  - `dedupe` drops a second row with the same `parcel_id`, and a row with a different `parcel_id` but the same `normAddr(property_address) + zip`, giving `duplicates === 2`.
  - `fetchZipParcels` with a fake `fetchFn` returning 2 pages (`exceededTransferLimit: true` then `false`) returns all features and requests `resultOffset=0` then `2000`.
  - Non-`001` features are filtered out.

- [ ] **Step 2: Run and confirm they fail** with `node --test tools/leads/test/parcels.test.mjs`

- [ ] **Step 3: Implement.** Query params: `where=CO_NO=<n> AND PHY_ZIPCD=<zip>`, `outFields=PARCEL_ID,DOR_UC,PHY_ADDR1,PHY_CITY,PHY_ZIPCD,OWN_NAME,OWN_ADDR1,OWN_ADDR2,OWN_CITY,OWN_STATE,OWN_ZIPCD,ACT_YR_BLT,EFF_YR_BLT,NO_BULDNG,TAX_AUTH_C`, `returnGeometry=true`, `outSR=4326`, `resultRecordCount=2000`, `orderByFields=OBJECTID`, `f=json`. Centroid = mean of ring vertices; simplify by taking every k-th vertex.

- [ ] **Step 4: Run and confirm they pass**

- [ ] **Step 5: Commit** `git commit -m "Add parcel inventory for lead workflow"`

---

### Task 3: Permit adapters and jurisdiction

**Files:**
- Create: `tools/leads/lib/jurisdiction.mjs`, `tools/leads/lib/permits/coj.mjs`, `tools/leads/lib/permits/clay.mjs`, `tools/leads/lib/permits/stjohns.mjs`
- Create: `tools/leads/test/fixtures/clay_search.json`, `tools/leads/test/fixtures/wats_result.html` (captured once from the live sites for one known parcel)
- Test: `tools/leads/test/permits.test.mjs`

**Interfaces:**
- Consumes: `Permit` shape and `isoDate` (Task 1), parcel row (Task 2)
- Produces:
  - `jurisdictionOf(row, coNo) -> {name, adapter: 'coj'|'clay'|'stjohns'|null, coverage: 'full_history'|'since_2023'|'none', coverageFrom: number|null, portal: string}`
  - Each adapter: `lookup(row, {fetchFn}) -> Promise<{permits: Permit[], source_link: string}>`, throwing on network or HTTP errors.

- [ ] **Step 1: Write the failing tests**
  - `jurisdictionOf`:
    - Duval with `PHY_CITY` `JACKSONVILLE` → `coj`, `full_history`, 1985.
    - Clay unincorporated → `clay`, `since_2023`, 2023.
    - Clay with `PHY_CITY` `GREEN COVE SPRINGS` or `ORANGE PARK` → adapter `null`, coverage `none`.
    - St. Johns → `stjohns`, `full_history` with `coverageFrom` taken from the WATS check in Step 3.
    - St. Johns with `PHY_CITY` `ST AUGUSTINE BEACH` or `SAINT AUGUSTINE BEACH` → `none`.
    - Duval beach cities → `none`.
    - Where the city name is unreliable (FDOR `PHY_CITY` is a mailing city), confirm with `TAX_AUTH_C`, using the codes found against the live data in Step 3.
  - `coj.lookup` reads `permits/roof_<first 3 digits of RE>.json` from disk for a known fixture RE and maps the rows to `Permit` with `source: 'COJ_INDEX'` and `link = https://jaxepics.coj.net/Permit/View/<viewId>`.
  - `clay.lookup` maps `clay_search.json` → permits where `CaseNumber` starts with `ROOF` or `CaseType` matches `/roof/i`, with dates through `isoDate`.
  - `stjohns.lookup` parses `wats_result.html` into at least one `Permit` with number, issue date and status.

- [ ] **Step 2: Run and confirm they fail**

- [ ] **Step 3: Implement**
  - **COJ:** RE comes from `PARCEL_ID` with spaces removed. Check it against the bucket format in `permits/roof_*.json` (keys are 10-digit RE). Then call the live `jaxByRE` (port from `permits.js:71-86`, same request body) for permits issued after `permits/meta.json.through`, and merge by permit number. Live failure leaves the index result plus the note `live_city_check_failed`.
  - **Clay:** port `clayPermits` (`permits.js:103-115`), POST straight to `https://claycountyfl-energovpub.tylerhost.net/apps/selfservice/api/energov/search/search` with the tenant headers from `serve.ps1`. Retry with the street suffix dropped when there are no results.
  - **St. Johns:** load `https://webapp.sjcfl.us/WATSWebX/Permit/SearchPermit.aspx`. Read `__VIEWSTATE`, `__EVENTVALIDATION` and the parcel field name from the form, post the parcel number and parse the results table. Record the earliest permit year seen across the pilot in `coverageFrom`. Wait 300 ms between requests. If the form needs a CAPTCHA or login, stop. Don't work around it: mark the adapter unavailable (coverage `none`) and report it.
  - `source_link`: the portal's permit page, or the search page with the parcel number.

- [ ] **Step 4: Run and confirm they pass**

- [ ] **Step 5: Commit** `git commit -m "Add permit adapters for Jacksonville, Clay and St. Johns"`

---

### Task 4: Contact matching

**Files:**
- Create: `tools/leads/lib/contacts.mjs`
- Test: `tools/leads/test/contacts.test.mjs`

**Interfaces:**
- Consumes: `parseCSV`, `normAddr` (Task 1)
- Produces:
  - `loadContactSources(cfg.contacts: [{file, name, columns: {parcel_id?, address?, zip?, last_name?, phone, consent?, opt_out?, outreach_status?}}]) -> ContactIndex`
  - `matchPhone(row, index) -> {phone, phone_source, match_confidence, outreach_status, notes}`

- [ ] **Step 1: Write the failing tests**
  - A parcel ID match → `exact_parcel`.
  - Address plus owner last name → `address_name`, with the last name taken from `OWN_NAME`, whose first token is the last name in FDOR format.
  - Address only → phone `''`, `match_confidence` `address_only`.
  - Two different numbers at `exact_parcel` → phone `''`, note `ambiguous_phone`.
  - `opt_out` truthy (`Y`, `yes`, `true`, `1`) → `outreach_status` `do_not_contact`, with the phone still filled.
  - Phones normalized to `(904) 555-0123`. Non-10-digit numbers are dropped.
  - No sources → all blank.

- [ ] **Step 2: Run and confirm they fail**
- [ ] **Step 3: Implement**
- [ ] **Step 4: Run and confirm they pass**
- [ ] **Step 5: Commit** `git commit -m "Add phone matching from supplied contact files"`

---

### Task 5: Stage 1 runner with checkpoints

**Files:**
- Create: `tools/leads/stage1.mjs`, `tools/leads/leads.config.example.json`, `tools/leads/README.md`
- Modify: `.gitignore` (add `leads-data/` and `tools/leads/leads.config.json`)
- Test: `tools/leads/test/stage1.test.mjs`

**Interfaces:**
- Consumes: Tasks 1 to 4
- Produces:
  - CLI: `node tools/leads/stage1.mjs --config tools/leads/leads.config.json [--zips 32068] [--sample 50] [--inventory-only] [--out leads-data]`. `--inventory-only` fetches and dedupes parcels and writes the coverage counts, with no permit or contact lookups.
  - `leads-data/<zip>/parcels.jsonl`: one line per parcel row from Task 2.
  - `leads-data/<zip>/results.jsonl`: one line per parcel, `{parcel_id, status: 'ok'|'error', error?, ...classify fields, permit_source, permit_coverage, jurisdiction, phone fields, evidence, lat, lng, ring}`.
  - `leads-data/stage1.csv`: columns `COLUMNS` plus trailing `lat, lng, ring_json, evidence`. Rows are the three bands and `needs_review`. `roof_report_link` and `report_status` are blank, `report_status = pending`.
  - `leads-data/coverage.json`: `{[zip]: {inventoried, single_family, duplicates, unresolved, screened, screened_out_recent, band_15plus, band_10_15, band_min_10, needs_review, errors, permit_coverage: {...counts}}}`
  - Export: `runZip(zip, cfg, deps) -> Promise<ZipStats>`, so tests can inject fake fetch and adapters.
- Config example keys: `zips`, `band_min_years: 8`, `sample: null`, `concurrency: 2`, `contacts: []`.

- [ ] **Step 1: Write the failing tests** (fake adapters, temp directory)
  - A run over 4 fake parcels writes `results.jsonl` with 4 lines and coverage counts that add up: `inventoried = single_family + non_sfr`, `screened = band counts + needs_review + screened_out_recent`, `unresolved` counted separately.
  - An adapter throwing for parcel 2 gives `status: 'error'`, and the row lands in `needs_review` with `permit_lookup_error`.
  - A second run with the adapter fixed re-queries only parcel 2. A call counter proves the others are skipped. Afterwards `results.jsonl` has one current record per parcel, with the last line per `parcel_id` winning on load.
  - A truncated last line in `results.jsonl` (simulated crash) is ignored on load and that parcel is retried.
  - `--sample 3` takes the first 3 parcels after sorting by `parcel_id`, so it repeats from run to run.

- [ ] **Step 2: Run and confirm they fail**
- [ ] **Step 3: Implement.** Append lines with `fs.appendFileSync` (one `write` per line). Load by splitting on `\n`, skipping lines that fail `JSON.parse`. The README covers setup, config, commands, output files and what each `review_reason` means.
- [ ] **Step 4: Run and confirm they pass**
- [ ] **Step 5: Commit** `git commit -m "Add Stage 1 lead runner with checkpoints and coverage counts"`

---

### Task 6: Opening `?lead=` links in the app

**Files:**
- Create: `leadopen.js`
- Modify: `index.html` (add `<script src="leadscore.js"></script>` before `app.js`, `<script src="leadopen.js"></script>` after `drone.js`), `permits.js` (`permitLookup` short circuit), `report.js` (cover lines)

**Interfaces:**
- Consumes: `LeadsCore.decodeEvidence` (Task 1), globals `setLocation(loc, label)` (`app.js:300`), `runSolar()` (`app.js:324`), `autoTraceRoof()` (`autotrace.js:394`), `permit` and `permitEnsure()` (`permits.js:215`), `setMode('res')` (`commercial.js:637`)
- Produces:
  - `window.leadContext: {parcel, addr, lat, lng, evidence} | null`, set when the URL has `?lead=`
  - Report cover shows `Parcel <id>` and `Measured <today>`, plus `Imagery <date>` from `state.solar.imageryDate`, when `leadContext` is set.

- [ ] **Step 1: Implement `leadopen.js`.** On `initMap` complete, poll for `window.map` up to 15 s. If `URLSearchParams` has `lead`:
  1. `setMode('res')`, then `setLocation({lat, lng}, addr)`.
  2. Await `runSolar()`, then `autoTraceRoof()`.
  3. Show a banner "Lead report for <addr>, parcel <id>. Press Download PDF for the report."
  4. Without a saved key, show the existing key prompt and stop.

  In `permits.js` `permitLookup`: when `window.leadContext && leadContext.evidence`, return a data object built from the evidence: `{searched: true, permits: [one Permit from evidence], source: 'Lead list (Stage 1, checked <date>)', yearBuilt, jurisdiction, recordsFrom, notes: [coverage note]}`. `roofAgeInfo` and `permitReportPage` then render it unchanged.
- [ ] **Step 2: Manual check in the browser pane** via the `roof-measure` launch config:
  - `http://localhost:8080/?lead=TEST&lat=30.0905&lng=-81.8840&addr=3916%20DARLENE%20RD%2C%20MIDDLEBURG%20FL%2032068&ev=<encodeEvidence sample>`
  - Expected: the map centres on the house, roof data and auto-trace run, and the report's cover shows the parcel ID, measured date and imagery date. The permit page shows the evidence permit.
  - Then open `http://localhost:8080/` with no parameters and confirm it behaves as before, with no banner and normal permit lookup.
- [ ] **Step 3: Commit** `git commit -m "Open lead report links with Stage 1 permit evidence"`

---

### Task 7: Leads tab (Stage 2 batch, checkpoints, CSV export)

**Files:**
- Create: `leads.js`
- Modify: `index.html`:
  - a third mode button `<button id="modeLead" class="mode">Leads</button>` in `.modebar`
  - a panel `<details class="panel lead-only" id="panelLeads" open>` with: file input `#leadFile`, batch size `#leadBatch` (default 25), `#leadMin` (7 or 8, default 8), buttons `#leadStart`, `#leadPause`, `#leadExport`, progress `#leadProgress`, and a table `#leadTable` of the first 50 rows
- Modify: `commercial.js` `setMode` to handle `'lead'` (toggle body class `mode-lead`, hide `res-only` and `com-only`), `styles.css` (`.lead-only` visibility like `.com-only`)

**Interfaces:**
- Consumes: `LeadsCore.parseCSV`, `toCSV`, `COLUMNS` (Task 1), `fetchSolar(lat, lng)` (`app.js:313`), the Stage 1 CSV format (Task 5)
- Produces:
  - IndexedDB database `rm-leads`, store `rows`, keyed by `parcel_id`: `{parcel_id, report_status, imagery_date, match_lat, match_lng, checked_at}`
  - `checkLeadRow(row) -> Promise<{report_status, imagery_date, match_lat, match_lng, notes}>` (exposed on `window` for testing)
  - `pointInRing([lng, lat], ring) -> boolean`
  - `leadLink(row, match) -> string`
  - Export downloads: `leads_all.csv`, `leads_15plus.csv`, `leads_10to15.csv`, `leads_<min>to10.csv`, `leads_needs_review.csv`. `roof_report_link` is filled only when `report_status === 'ok'`.

- [ ] **Step 1: Write failing in-browser checks** in `tools/leads/test/leads_browser.html` (opens via the local server and prints PASS/FAIL lines):
  - `pointInRing` is true for a square's centre and false outside it.
  - `checkLeadRow` with a stubbed `fetchSolar`:
    - building centre inside the ring and within 30 m → `ok`
    - outside the ring → `wrong_building`
    - throws with a 404 message → `no_imagery`
    - `imageryQuality: 'LOW'` → `ok` with note `low_quality_imagery`
    - throws a 403 → rejects with `err.fatal === true`
  - `leadLink` contains `lead=`, `lat=`, `lng=`, `addr=`, `ev=` and no `key`.
  - A batch run with a stubbed `checkLeadRow` that throws a fatal error on row 3 stops after row 3 with rows 4+ still `pending`. A rerun skips stored `ok` rows: the call count equals the number of non-ok rows.
  - Only rows with an age band (not `needs_review`) are checked. `needs_review` rows are exported with `report_status = not_eligible`.
- [ ] **Step 2: Open the page and confirm the checks FAIL** (functions undefined)
- [ ] **Step 3: Implement `leads.js`.** It runs rows one at a time with a 200 ms gap and writes each result to IndexedDB before the next request. Progress shows `done / total, ok, failed, pending`. `leadLink` base is `https://musabtheone11.github.io/roof-measure/`.
- [ ] **Step 4: Open the page and confirm the checks PASS**
- [ ] **Step 5: Manual regression:** Residential and Commercial tabs still measure and report one address as before.
- [ ] **Step 6: Commit** `git commit -m "Add Leads tab: building match checks, checkpoints and CSV export"`

---

### Task 8: Pilot in ZIP 32068, verification and projection

**Files:**
- Create: `tools/leads/pilot-report.md` (results), `tools/leads/project.mjs` (projection)

**Interfaces:**
- Consumes: everything above
- Produces: `node tools/leads/project.mjs --coverage leads-data/coverage.json` → per-ZIP projected rows and Solar calls, plus cost at `buildingInsights` ×1 per checked row (Stage 2) and ×(1 + dataLayers) per opened report. Rates are read from the config keys `price_building_insights` and `price_data_layers`, checked on the Google pricing page on the day of the pilot.

- [ ] **Step 1:** `node tools/leads/stage1.mjs --config tools/leads/leads.config.json --zips 32068 --sample 50`. Confirm `coverage.json` counts add up.
- [ ] **Step 2:** Load `leads-data/stage1.csv` in the Leads tab and run Stage 2 on the qualifying rows. Export the CSVs.
- [ ] **Step 3: Verify 5 rows each:**
  - address to permit: open `permit_source` and check the number, dates and status match
  - address to owner: check against the Clay County Property Appraiser record
  - address to report: open `roof_report_link` and confirm it's the same house as on the Property Appraiser map
  Record pass/fail per row in `pilot-report.md`.
- [ ] **Step 4:** Run `project.mjs` for all 14 ZIPs. The full parcel counts come from a Stage 1 inventory-only pass (`--inventory-only` flag: parcels only, no permit lookups).
- [ ] **Step 5:** Write `pilot-report.md` covering: counts per group, verification table, coverage gaps (Clay before 2023, municipal cities, St. Johns WATS status), projected API calls and cost, and the exact items needed from the user.
- [ ] **Step 6: Commit** `git commit -m "Pilot results for ZIP 32068"`. Stop and present the results to the user before running all 14 ZIPs.
