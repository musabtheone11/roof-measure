# Lead workflow pilot, ZIP 32068 (Nov 20–21, 2026)

## What ran

- **Stage 1, ZIP 32068:** the first 50 single-family parcels by parcel ID, as a repeatable sample.
- **Stage 1 rate samples:** 25 homes in 32224 (Duval) and 25 in 32259 (St. Johns). 32068 had no age-band homes to test Stage 2 and the cost estimate with, so these were added.
- **Home count, all 14 ZIPs:** the inventory only, with no permit lookups.
- **Stage 2 (Google building check and report links), Nov 22:** ran in the Leads tab on all 22 age-band homes from the samples (32068 had none), with the key you saved.

## Results

| ZIP | Sampled | 15+ | 10–15 | 8–10 | Needs review | Recent roof (left out) |
|---|---|---|---|---|---|---|
| 32068 (Clay) | 50 | 0 | 0 | 0 | 44 (all "possibly original") | 6 (roofs from 2023 on) |
| 32224 (Duval) | 25 | 10 | 3 | 0 | 7 (6 possibly original, 1 newer permit of unclear scope) | 5 |
| 32259 (St. Johns) | 25 | 0 | 4 | 5 | 9 (6 possibly original, 2 unclear scope, 1 newer permit not finished) | 7 |

Pilot CSVs in the final column order are in `leads-data/pilot/`: `leads_all.csv` (82 rows), `leads_15plus.csv` (10), `leads_10to15.csv` (7), `leads_8to10.csv` (5) and `leads_needs_review.csv` (60).

**Stage 2 result:** 21 of 22 `ok` with a report link; 1 `wrong_building` (111 Cypress Landing: Google's nearest building is the house at 110, 22 m away and outside the parcel, so no link). Needs review rows are `not_eligible`. Google's imagery for all 22 homes is from January 2016, so a roof replaced after that still looks like the old roof in the photo. The measurements are still right, because the roof's shape doesn't change.

## Match checks on sample rows

| Check | Rows | Result |
|---|---|---|
| Address to permit, Clay (county's own per-parcel search vs the list) | 8 | 8 match. The 4 recent roofs show the same permit; the 4 review rows have no roofing permit. |
| Address to permit, St. Johns (open the permit page in the row) | 5 | 5 match: permit number, work and completion date |
| Address to permit, Jacksonville (live city search vs the list) | 6 | 6 match |
| Address to owner, Clay (county parcel map: owner and mailing address) | 6 | 6 match |
| Address to owner, Duval (Property Appraiser record) | 6 | 4 match. 1 sold after the state's roll date (appraiser shows a new owner). 1 appraiser page came back blank. |
| Address to report: Google's matched building, reverse-geocoded, vs the listed address | 21 | 20 same address. 110 Cypress Landing comes back as "110 Popolee Exd": same number and inside the right parcel, likely Google's street naming; look before calling. |
| Report link opens and builds (14245 Drakes Point Dr) | 1 | Map pinned on the house, 5 roof planes auto-traced (1,689 sq ft, mostly 6/12), parcel number and measurement date on the cover, permit R-09-318879 as roof-age evidence |

Fixes made because of these checks:

- St. Johns "REROOF: REMOVE/REPLACE 64 SQUARES" was scored as a partial job and "METAL OVER SHINGLE" wasn't recognised. Both now count as full replacements.
- Clay's search silently stopped at 10,000 results. It now downloads month by month: 12,140 roofing permits.
- The parcel layer times out on sorted paging. Parcels are now fetched by ID list.

## All 14 ZIPs: home counts

| ZIP | County | Single-family addresses | Unresolved | Merged as duplicates |
|---|---|---|---|---|
| 32003 | Clay | 9,697 | 3 | 2 |
| 32043 | Clay | 12,895 | 12 | 0 |
| 32065 | Clay | 12,274 | 1 | 1 |
| 32068 | Clay | 17,770 | 6 | 1 |
| 32073 | Clay | 13,142 | 2 | 1 |
| 32080 | St. Johns | 8,657 | 0 | 3,101 |
| 32081 | St. Johns | 10,611 | 0 | 602 |
| 32092 | St. Johns | 22,207 | 0 | 804 |
| 32259 | St. Johns | 24,179 | 0 | 632 |
| 32211 | Duval | 9,944 | 1 | 6 |
| 32224 | Duval | 10,552 | 1 | 0 |
| 32225 | Duval | 17,798 | 0 | 0 |
| 32246 | Duval | 14,979 | 0 | 6 |
| 32277 | Duval | 7,934 | 0 | 0 |
| **Total** | | **192,639** | 26 | 5,156 |

## Gaps in source coverage

1. **Clay County permits before 2023 (5 ZIPs, 65,778 homes).** EnerGov holds roofing permits only from January 2023. Every Clay home without a recent permit goes to Needs review as "possibly original", so Clay will produce almost no age-band leads. Fix: a public-records request to Clay County Building for roofing permits from 2005 to 2022 (permit number, parcel, address, issue and final dates, description), as a spreadsheet. The script can take it as another permit source.
2. **Townhome rows sharing one street address (mostly St. Johns; up to 5,139 St. Johns parcels merged).** This count also includes the same parcel listed more than once, which is a correct merge; the inventory ran before the two were counted separately. The state roll lists many single-family parcels with the same street address and no unit number (for example, 19 parcels at 105 Arricola Ave, 32080). Following the brief's address dedupe, they become one row. Fix: unit numbers from the St. Johns Property Appraiser, or keep them separate by parcel. This needs your call, because they may share a roof with neighbours.
3. **City permit offices.** Green Cove Springs, Orange Park, Penney Farms, St. Augustine and St. Augustine Beach issue their own permits, with no online feed. Those homes go to Needs review with the office's link.
4. **Owner names come from the state's 2026 roll** (owners as of January 1). Homes sold since show the previous owner (1 of 6 Duval checks). Fix: re-read the owner from the county appraiser for rows in the age bands. That's possible for Duval and Clay, and I can add it.
5. **St. Johns history depth.** Only permits with use code 435 ("reroof of existing structure") are read. Roof work filed under another code would be missed.
6. **Phones:** none matched, because no contact file has been supplied (see below).
7. **Duval live check:** the published permit copy runs through Oct 2, 2026. Homes it puts in a band are rechecked live; homes it sends to review are not.

## Projected work and Google cost for all 14 ZIPs

Age-band share from the samples (small samples, so treat as rough): Duval 52%, St. Johns 36%, Clay about 0% (until older permits are added).

- About **55,500 age-band homes**: 31,800 Duval, 23,600 St. Johns, about 0 Clay.
- **Stage 2 building check:** one Solar Building Insights call per age-band home, about 55,500 calls. At Google's list price (first 10,000 a month free, then $10 per 1,000): **about $455**, or less if spread across months to reuse the monthly free allowance.
- **Opening report links:** each open makes one Building Insights call and one Data Layers call (auto-trace; first 1,000 a month free, then $75 per 1,000). If 25% of links are opened: **about $1,100**. If every link is opened: about $4,640.
- **Stage 1 time** (public data, no Google cost): Clay is instant from the permit download. Duval takes about 1–2 hours. St. Johns is the slow one: about 2 seconds per home on the county's search, about **38 hours for 65,654 homes**. It can be stopped and restarted.

Prices are from Google's pay-as-you-go page (read Nov 20, 2026); volume discounts above 100,000 calls aren't counted.

## Needed from you

1. **Report links point at the GitHub page.** They only work once this branch is merged and pushed (which updates the live site), and in a browser where the key is saved on that site.
2. **Phone sources.** A CSV export from the CRM or lead providers, with parcel ID or street address and ZIP, owner last name, phone, and any opt-out or consent columns.
3. **Clay County records request** for roofing permits before 2023, if you want Clay leads.
4. **Townhome rows:** keep one row per address (current) or one row per parcel.
5. **Go-ahead for the full run** (Stage 1 for all 14 ZIPs, then Stage 2).
