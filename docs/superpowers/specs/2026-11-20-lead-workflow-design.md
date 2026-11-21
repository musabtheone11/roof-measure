# Lead workflow (Lead mode) — design

Date: 2026-11-20. Repo: musabtheone11/roof-measure (GitHub version, commit 0876665).

## Intent

Diversity Roofing wants a prospect list of single-family homes whose roofs are old enough to need replacing, across 14 ZIP codes in Duval, Clay and St. Johns counties. Each prospect row carries the owner, mailing address, phone (if a legitimate match exists), documented roof-age evidence and a link to a roof report. This workflow prepares lists and reports only. Outreach is a separate, later step.

## Goals

- Inventory every single-family parcel in the target ZIPs from official parcel data, not just lead-provider lists.
- Date each roof from permit records, recording the evidence, and never treat a missing permit as proof of an original roof.
- Sort homes into four groups with no overlap: 15+ years, 10 to <15, 8 (configurable down to 7) to <10, and Needs review.
- Give every row in the three age groups a roof report link and a report status, even rows without a phone number.
- Produce CRM-ready CSVs, restartable batch processing, and a pilot in ZIP 32068 with coverage gaps and projected API usage before the full run.

## Non-goals

- Sending any outreach, or scoring or ranking leads beyond the age bands.
- Changing the existing single-address measuring, report or commercial workflows.
- Buying data or signing up for contact-data services. Phone matching only uses sources the user supplies.

## Anti-goals (a failure even if it works)

- A row labelled "15+ years" when the only evidence is the year built.
- A phone number attached from a weak or ambiguous match.
- A report link that opens a different building than the listed address.
- Storing or exporting Google Solar data in ways the Maps Platform terms don't allow.
- A Google API key in any CSV, link or file the script writes.

## Constraints

- **Google key:** it lives only in each user's browser localStorage (`rm.key`), entered in the app. The script never needs it. Stage 2 runs in the app.
- **Storage:** on-demand report links (user's decision). No Solar results are saved to disk or to the CSVs apart from the pass/fail status and building-match checks.
- **Browser cross-site blocks:** JAXEPICS, Clay EnerGov and St. Johns WATS block cross-site browser calls. The Stage 1 script runs in Node, where those blocks don't apply.
- **Permit coverage (verified 2026-11-20):**
  - City of Jacksonville (32211, 32224, 32225, 32246, 32277): `permits/` index of 371,567 roofing permits from 1984 through 2026-10-02, plus the live JAXEPICS by-parcel lookup for newer permits.
  - Clay County (32003, 32043, 32065, 32068, 32073): EnerGov holds online records only from January 2023. Older permits need a records request.
  - St. Johns County (32080, 32081, 32092, 32259): WATSWebX permit search by parcel number (an ASP.NET form, scraped one parcel at a time with polite rate limiting).
  - Municipal permit offices (Green Cove Springs, Orange Park, St. Augustine Beach, City of St. Augustine): no feed. Those homes go to Needs review with the portal link and `permit_coverage = none`.
- **Parcel source:** Florida Statewide Cadastral (FDOR 2026 roll) ArcGIS layer, already used by `permits.js`. Query by `CO_NO` + `PHY_ZIPCD`; `DOR_UC = '001'` is single family. It provides PARCEL_ID, PHY_ADDR1/CITY/ZIP, OWN_NAME, OWN_ADDR1/2/CITY/STATE/ZIPCD, ACT_YR_BLT, EFF_YR_BLT, NO_BULDNG and the parcel polygon. Count queries time out, so the script pages through records (max 2,000 per page).

## Approaches considered

- **A. Node script for Stage 1, an in-app Lead mode for Stage 2 (chosen).** Stage 1 needs no Google key and avoids the browser's cross-site blocks. Stage 2 reuses the app's Solar, auto-trace and report code with the key already saved in the browser. Trade-off: two pieces to run.
- **B. Everything in the app.** The most code reuse, but a browser tab would have to run for days, and it needs extra relays in `serve.ps1`. Rejected.
- **C. Everything in Node.** It would need the Google key outside the browser, against the existing key setup, and would duplicate the report code. Rejected.

## Design

### Stage 1 — `tools/leads/stage1.mjs` (Node 18+, no dependencies)

Input: `leads.config.json` (ZIP list, `band_min_years` default 8 and allowed 7, batch size, rate limits, optional phone source files).
Working state: one JSON-lines checkpoint per ZIP (`leads-data/<zip>/parcels.jsonl`, `permits.jsonl`) plus `progress.json`. A restart skips parcels already finished and retries errored ones.

1. **Inventory.** Page the parcel layer for each ZIP and county (`CO_NO` 26 Duval / 20 Clay / 65 St. Johns, as in `PERMIT_COUNTY`; Clay = 20 confirmed live with 104,912 parcels). Keep `DOR_UC = '001'`. Deduplicate on PARCEL_ID, then on normalized address (house number, street, suffix, unit). Record per ZIP: inventoried, single family, duplicates removed.
2. **Jurisdiction.** Duval: the COJ parcel layer gives RE and city; the beach cities aren't in these ZIPs, but the check stays. Clay and St. Johns: municipal limits from the city name and FDOR `TAX_AUTH_C`, so city-permitted homes go to coverage `none`.
3. **Permits.** Per jurisdiction adapter returning a common shape `{number, type, work, status, issued, finaled, link, scope}`:
   - COJ: `permits/` index by RE, then the live JAXEPICS by-parcel lookup for permits after 2026-10-02.
   - Clay: EnerGov search by address, the same request `clayPermits()` sends, called directly.
   - St. Johns: WATS search by parcel number.
   `scope` is `full`, `partial` or `excluded`. Excluded covers repairs, patches, partial or "over existing" work flagged as partial, and detached structures (shed, garage, pool or screen enclosure, accessory). The classification rules live in one table so they can be reviewed; anything unrecognised goes to `unknown`, which counts as not full.
4. **Age and band.**
   - `latest_permit_issued` = the newest roofing permit with an issue date, any scope apart from void or cancelled.
   - `latest_completed_replacement` = the newest `full`-scope permit with a final or completion date and a finalized status.
   - Age = years from `latest_completed_replacement` to the run date.
   - Needs review when:
     - no completed full replacement and only the year built: `age_basis = year_built`, label "possibly original"
     - a permit was issued after the latest completed replacement with no verified completion: `review_reason = newer_permit_unverified`
     - permit coverage for that jurisdiction doesn't reach the year built (for example, Clay homes built before 2023 with no permit)
     - lookup errors.
   - Homes under the band minimum with a completed replacement are excluded from all four groups and counted as `screened_out_recent`.
   - Recorded per row: `age_basis` (completed_permit / year_built / none), `permit_coverage` (full_history / since_2023 / none / error), `permit_source` link and `review_reason`.
5. **Owner and contact.** Owner of record and mailing address come from the parcel row. Phones come only from files the user supplies (CRM or lead-provider CSV), matched on parcel ID first, then on normalized address plus owner last name. Each match records `phone_source`, `match_confidence` (exact_parcel / address_name / address_only) and any `consent` or `opt_out` columns found in the source. `address_only` and multiple conflicting numbers leave the phone blank. The `outreach_status` column is copied from the source (`do_not_contact` if opted out). It is blank otherwise and never invented.

Output: `leads-data/stage1.csv` (all groups) plus `coverage.json` with per-ZIP counts: inventoried, single family, screened, in each band, needs review, unresolved, and errors.

### Stage 2 — Lead mode in the app

- A new **Leads** tab beside Commercial: load `stage1.csv`, start, pause or resume, and see progress.
- Batches of N rows (default 25). After each row, its status goes to IndexedDB, keyed by parcel ID. On reload or restart it skips `ok` rows and retries `failed` and `pending` rows. Links are deterministic, so a rerun never creates duplicates.
- Per row:
  1. Solar `buildingInsights:findClosest` at the parcel centroid. Check the returned building's centre is inside the parcel polygon, which Stage 1 saves as a simplified ring in the CSV row or a side file. Also check the building is within 30 m of the centroid.
  2. Record `report_status` = `ok` / `no_imagery` (404) / `wrong_building` / `api_error: <message>` / `low_quality`, and the imagery date. Solar values are not saved.
- `roof_report_link` = `https://musabtheone11.github.io/roof-measure/?lead=<parcel_id>&lat=<lat>&lng=<lng>&addr=<address>&ev=<evidence>`. `ev` is a short encoded string of Stage 1's permit evidence: age basis, latest permit number and issue date, latest completed date, coverage, and source link. It has no owner or phone. The app has no URL handling today, so **new code** reads these parameters and then reuses the existing steps: lock the pin, Get roof data, Auto-trace, build the report. The report's permit page shows the Stage 1 evidence from `ev` as the permit history (the GitHub page has no relays for Clay or St. Johns, so it doesn't look those up live). The cover adds the parcel ID, measurement date (the day it's opened) and imagery date.
- **Who can open links (my call):** links are internal to Diversity staff. They only work in a browser where the Google key is saved in the app. Without a key, the app shows the existing "paste your API key" prompt. Every open makes new Solar calls (about $0.10 with Auto-trace), so the cost estimate counts opened reports, not rows. Rows that fail the building match get no link.
- **Building match (my call):** the Solar building's centre must be inside the parcel polygon and within 30 m of the parcel centroid. When `NO_BULDNG > 1`, the row also gets the note `multi_building`, and the link points at the largest building inside the parcel (the house, not a garage). The pin coordinates in the link are the matched building's centre, not the parcel centroid.
- Export from the tab: `leads_all.csv` (with `age_band`), `leads_15plus.csv`, `leads_10to15.csv`, `leads_8to10.csv` (renamed to `leads_7to10.csv` if the minimum is set to 7) and `leads_needs_review.csv`. Columns in this order:
  `age_band, property_address, zip, parcel_id, owner_of_record, mailing_address, phone, phone_source, match_confidence, outreach_status, roof_report_link, report_status, estimated_roof_age, age_basis, latest_permit_issue_date, latest_completed_replacement_date, permit_number, permit_status, permit_source, permit_coverage, review_reason, year_built, jurisdiction, imagery_date, notes`.
  Plain UTF-8 CSV with a header row and ISO dates (YYYY-MM-DD), so any CRM can import it. Mapping to a specific CRM's import format comes later.

### Expected effect of coverage gaps

- **Clay ZIPs, the pilot included:** these will put few homes in the age bands. A home built before 2023 with no online permit goes to Needs review as "possibly original", following the brief's rule. A home with a 2023+ permit is under 8 years and gets screened out. The pilot will mostly test the Needs review path and report how many homes a pre-2023 records request would unlock.
- **St. Augustine Beach and City of St. Augustine (32080, part of 32081):** the pilot can't measure their share, because it only covers 32068. Stage 1 reports the count per ZIP on the first St. Johns run, and those homes stay in Needs review with the city portal link.

### Pilot (ZIP 32068)

Stage 1 on a sample of about 50 parcels, then Stage 2 on the rows that qualify. Hand-check 5 rows each for address-to-permit (against the portal), address-to-owner (against the Clay Property Appraiser) and address-to-report (open the link). Report counts, coverage gaps and projected API calls and cost for all 14 ZIPs before running them.

## Left to the builder

- Exact FDOR `CO_NO` values and municipal detection rules, checked against the live data.
- The WATS form fields, and whether WATS records show final dates.
- Permit scope keyword table, which goes to the user for review after the pilot.
- UI details of the Leads tab, which follow the Commercial tab's style.

## Needs from the user (not blocking the pilot)

- CRM or lead-provider export with phones and any consent or opt-out fields.
- Decision on a Clay County records request for permits before 2023.
