# Lead workflow, Stage 1

Builds the property list for the Leads tab: every single-family parcel in the target ZIPs, its roof permits, roof-age band, owner and (when you supply contact files) phone.

## Run

Needs Node 18 or newer. No install step.

```
copy tools\leads\leads.config.example.json tools\leads\leads.config.json
node tools/leads/stage1.mjs --config tools/leads/leads.config.json --zips 32068 --sample 50
```

Options:

- `--zips 32068,32073`: only these ZIPs (default: the config's list)
- `--sample 50`: the first 50 parcels per ZIP by parcel id (repeatable)
- `--inventory-only`: count parcels only, no permit lookups (used for projections)
- `--refresh-clay`: download the Clay County roofing permits again
- `--out leads-data`: output folder

Stopping and rerunning is safe: finished parcels are skipped and failed ones retried.

## Output (leads-data/)

- `stage1.csv`: one row per home in an age band or Needs review, in the CRM column order, plus `lat, lng, ring_json, evidence` for the Leads tab. Load it in the app's Leads tab for Stage 2.
- `coverage.json`: per ZIP, the parcels inventoried, unresolved (no street address or shape), duplicates, screened, each band, Needs review, recent roofs screened out, errors, permit coverage and review reasons.
- `<zip>/parcels.json`, `<zip>/results.jsonl`: checkpoints.

## Phones

Phones come only from the contact files listed under `contacts` in the config (CRM or lead-provider CSV exports). Map your file's column names in `columns`. A phone is filled on a parcel id match, or on an address match where the last name equals the owner of record's, and only when that gives exactly one valid number. Opt-outs set `outreach_status` to `do_not_contact`.

## Sources and coverage

| Area | Permits from | Online history |
|---|---|---|
| City of Jacksonville | published copy in `permits/` plus the live JAXEPICS check for banded homes | 1984 on |
| Clay County | EnerGov (all roofing permits, downloaded once) | January 2023 on |
| St. Johns County | WATS permit search by address, reroof permits (use code 435) | about 1970 on |
| Green Cove Springs, Orange Park, Penney Farms, St. Augustine, St. Augustine Beach, beach cities | none (own permit offices) | none |

## Review reasons

- `possibly_original`: no completed full replacement on file and records reach back to the year built (or don't), so only the build year is known.
- `newer_permit_unverified`: a roof permit was issued after the last completed replacement but isn't finaled.
- `no_permit_coverage`: the home is in a city with its own permit office.
- `permit_lookup_error`: the permit lookup failed; rerun to retry.
- `no_year_built`: no permit and no build year.
