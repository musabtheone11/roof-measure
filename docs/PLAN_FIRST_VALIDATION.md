# Plan-first report validation — 2026-11-25

This session started from clean `main` at `40d0af2` on feature branch
`codex/evidence-plan-first`. Commit `50d0dc3`, branch `codex/plan-first-roof-reports`
and `Roof_Measure_Plan_First.patch` were absent from the available checkout and
supplied files. The changes adapt the existing measurement/report code.

## Evidence available and coverage limits

- Initial environment inspection found neither named API variable. Credentials became
  available later in the session: `APINEX_API_KEY` and a runtime-only alias from
  `GOOGLE` to `GOOGLE_MAPS_KEY`. Local probes then verified authenticated APInex
  `/v1/models`, Google Geocoding and Google Solar buildingInsights with HTTP 200.
  The alias and key values were not committed or printed. APInex model trials and
  the public-building trace are documented in the session artifacts below.
- `/workspace` contained no saved jobs or independent reference reports for Nahane
  Way, Sandlake, Woodhaven or Mayflower. The supplied attachment was the task brief.
  A connected Google Drive search for Nahane failed because the connector requires
  a non-empty `link_id` that was not available. No customer file was sent externally.
- Historical repository regional benchmark documents describe 45 properties and a
  frozen 15-property blind set. Their private inputs and references were absent.
  Those historical aggregates were not regenerated or reclassified as new evidence.
- New real-property coverage is **0 of 30 requested** across all six towns. There is
  no new independently verified numerical property result and no Nahane first-page
  comparison. Real imagery registration, building choice, roof-date matching and
  orbit behavior against imagery remain unverified in this environment.

## Synthetic engine comparison

The existing unchanged seed generator and scoring rules were run on seeds 1–120
for each engine. All three produced the same 71 eligible geometries; 49 degenerate
or ground-truth clipping cases were excluded, with no engine errors. This is a
synthetic regression sample, not 71 Florida properties or an independent holdout.
No new one-third property holdout could be frozen without the property inputs.

| Engine | Area mean absolute percentage error | Area within 3% | Existing composite report-grade metric |
|---|---:|---:|---:|
| Repository original `bench/engines/base` | 20.63% | 60.6% | 12.7% |
| Repository snapshot `bench/engines/2026-11-23` | 2.46% | 80.3% | 19.7% |
| Current local engine after targeted geometry edits | 1.27% | 88.7% | 21.1% |
| APInex-assisted engine | No scored engine run | Not scored | Not scored |

A pre-edit local snapshot scored 1.24% area error and 87.3% within 3%; the final
local rerun scored 1.27% and 88.7%, respectively. Changes in one aggregate do not
establish property accuracy. The low composite rates and persistent
linear errors prevent claiming order-ready automatic accuracy. Unknown quantities
do not count as accuracy passes. The benchmark's composite metric is independent
of the app's evidence-based COMPLETE gate.

Reproduction from repository root (install `bench` dependencies first):

```sh
mkdir -p .devcache/delivery
node bench/run.mjs --n 120 --out .devcache/delivery/original.jsonl --engine bench/engines/base
node bench/run.mjs --n 120 --out .devcache/delivery/pre-change.jsonl --engine bench/engines/2026-11-23
node bench/run.mjs --n 120 --out .devcache/delivery/final-local.jsonl
node bench/report.mjs .devcache/delivery/original.jsonl .devcache/delivery/pre-change.jsonl .devcache/delivery/final-local.jsonl
```

Raw results, hashes and full per-line-type statistics are in
`/workspace/roof-delivery/{original,pre-change,final-local}.jsonl`,
`benchmark-manifest.json` and `synthetic-results.txt`. Generated artifacts remain
outside tracked source. Timing reflects concurrent workers and is not a speed claim.

## PDF examples and reproduction

All three examples are invented geometry. Their nominal coordinates are not a
customer property. The simple example is a two-plane 4/12 gable. The multi-building
example has a 6/12 hip main roof and detached 4/12 gable. The tree-obstructed example
marks F1 unresolved, F2 inferred and replaces a canopy-limited eave with a non-roof
obstruction boundary. It demonstrates review behavior; it is not a measured tree.

```sh
node tools/dev/delivery-examples.mjs
node tools/dev/run-app.mjs --offline --job .devcache/delivery/jobs/simple-gable.json --out .devcache/delivery/simple --port 8193
node tools/dev/run-app.mjs --offline --job .devcache/delivery/jobs/complex-mixed-pitch.json --out .devcache/delivery/complex --port 8194
node tools/dev/run-app.mjs --offline --job .devcache/delivery/jobs/tree-obstructed-review.json --out .devcache/delivery/tree-obstructed --port 8195
```

`--offline` is restricted to explicitly illustrative saved jobs. The test-only
geometry adapter replaces the map display and shape containers. The app's actual
restore, totals, review gate, PDF renderer and Preview/Print/Download buttons still
run. No API access, real aerial overlay, geocoding or imagery scale calibration is
tested. Address-driven runs still require an API key. The adapter's gray geometry
screenshots are labelled as illustrations and must not be described as aerials.

The generated runs retain `roof.json`, `totals.json`, `report.pdf`,
`report-check.json`, `reconcile.json`, screenshots and console logs. Independent
`pdftotext` reconciliation checks printed schedules against the app's saved model.
The gross model area includes unresolved geometry; verified subtotals exclude it.
The reconciliation distinguishes these quantities instead of treating unresolved
area as a measured net total. Preview, Print and Download are compared by SHA-256.

Final artifacts are `/workspace/roof-delivery/simple/report.pdf` (2 pages),
`/workspace/roof-delivery/complex/report.pdf` (2 pages), and
`/workspace/roof-delivery/tree-obstructed/report.pdf` (3 pages). All are US Letter.
Preview/Print/Download parity, scale, key placement and the strict layout checks pass.
Independent numeric reconciliation passes for each report. MuPDF render inspection
confirms legible dimensions and tables, no clipping, correct status, F1 pitch/area
blank and F2 marked `est.` in the tree example. Supported roof lines are solid;
inference is dashed; incomplete structures receive no overall dimensions. The
review example withholds purchasing quantities. Full page counts, hashes, checks
and visual notes are in `/workspace/roof-delivery/inspection.json` alongside the
three PDF directories.
These three PDFs contain no actual property aerial. Any separate public-building
trace artifacts are described below.

## API and external-worker verification

Authenticated APInex model discovery returned 44 exact model IDs. Bounded batches
of four gave each ID a distinct known-answer math fixture: 28 responses, 20 oracle
passes, eight inaccurate answers and 16 HTTP 429 responses. Two models independently
passed a synthetic full-image/overlapping-crop corner trial within 2.83 pixels.
Follow-up geometry, evidence and design reviews had mixed results; incorrect claims
were rejected. The absent-edge-pitch evidence dependency was independently
reproduced locally before being fixed. The full roster, accepted/rejected findings,
vision compatibility limits and request failures are recorded in
[APINEX_REVIEW.md](APINEX_REVIEW.md). Only invented geometry and sanitized renders
were submitted. There is no APInex-assisted property accuracy result.

The live Google check at Jacksonville City Hall returned HTTP 200 for Geocoding,
Solar buildingInsights and Solar dataLayers, with HIGH-quality imagery dated
2023-11-19. This checks access and source availability, not numerical accuracy or
measurement of any named customer roof. The baseline/current public-building trace
has no independent measurement reference and must not be counted as a numerical pass.

The public-building comparison used the same frozen 10 cm Solar rasters. Baseline
`40d0af2` produced 56 facets and 954 edges; current produced 56 facets and 935 edges.
The main building was selected, but the large flat roof's internal lines remain
noisy. This case requires review; the smaller edge count establishes no accuracy
improvement. The geometry/model overlay and both automatic models are retained
locally in `bench/private/public-check/` as `baseline-current-overlay.png`,
`baseline-model.json`, `current-model.json`, `baseline-job.json`, `current-job.json`,
`aerial.json` and `api-status.json`. They are excluded from GitHub. This was a
headless engine comparison on frozen real inputs, not a normal UI address-to-PDF
acceptance run. A separate frozen-model PDF harness, if generated, likewise must
not be described as that normal UI workflow. This adds one visual/source-access
case and **zero independently scored property measurements**.

## Focused verification

The independent PDF parser's eight regression scenarios pass, including corrupted
area, stale model inputs, dropped model edge, the new building subtotal format and
the distinction between supported and inferred quantities. Syntax checks pass for
the example generator, offline adapter and UI runner. All three final UI runs use
`--strict`: 15/15, 24/24 and 23/23 reconciliation checks respectively, identical
Preview/Print/Download hashes, exact drawing scale, no unaccounted keys, no text
overlaps and no browser page errors. Repository-wide test details are recorded in
the main delivery; these focused results do not replace real-source measurement
validation.

## Requirements to resolve remaining measurements

For each affected facet or edge, provide a dated georeferenced source of the same
roof configuration or a calibrated field/drone measurement, the measurement basis,
the selected structure and verified scale, and independent evidence for geometry,
pitch, classification and length as applicable. Record evidence against the current
quantity inputs. An edit invalidates those records until checked again. A canopy
or shadow boundary alone cannot establish an eave, rake or flashing line. Supported
subtotals may be printed while unknown quantities remain blank and purchasing
quantities are withheld.

## Checks completed in this session

Existing measurement, smoke, color/canopy, regression fixture, report acceptance,
PDF reconciliation, mixed-pitch takeoff, roof-summary and vision-fusion suites
passed. New geometry, plan-dimension, per-quantity provenance, scope-evidence and
asynchronous stale-export regressions passed; the evidence gate contains 20
focused checks. App JavaScript syntax, Python tool compilation and diff whitespace
checks passed. A headless browser additionally saved an individual default-unresolved
quantity through the actual collapsed evidence form and verified its revision binding.

The inherited sloped-edge length regression binds adjoining facet/default pitch
inputs; a valid inferred evidence record remains an estimate rather than being
silently treated as a measured quantity or erased. The scope form records structure
and calibration checks against the current address, selection and geometry. The
headless tests did not verify a physical printer or paper ruler measurement.

Public-building PDF generation was attempted with a private test harness but stopped
when saved-job restoration stalled. No real address-to-report browser validation or
real-property PDF is claimed. The three delivered PDFs remain explicitly illustrative.
