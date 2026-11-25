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
- Initial workspace inspection found no named customer references. Later authenticated
  Gmail/Drive searches resolved account IDs and found regional reports, including
  the two named regression references. The initial connector lookup issue was
  resolved; it was not a permission denial. Nahane/Sandlake and an independent
  report for R-PIN-01 were not found. No customer file was sent to APINEX.
- Historical repository regional benchmark documents describe 45 properties and a
  frozen 15-property blind set. Their private inputs and references were absent.
  Those historical aggregates were not regenerated or reclassified as new evidence.
- Strictly source/scope/date-verified numerical property coverage remains **0 of 30
  requested**. A later frozen 39-candidate study includes 34 regional properties,
  22 regional independent-report candidates and 17 paired conditional area
  comparisons. These are differences from printed reports, not validated accuracy
  passes. The holdout median worsened. See [regional results](REGIONAL_REFERENCE_RESULTS.md)
  for complete coverage, exclusions and failures. There is no Nahane first-page
  comparison. Current field-condition agreement remains unverified.

## Synthetic engine comparison

The existing unchanged seed generator and scoring rules were run on seeds 1–120
for each engine. All three produced the same 71 eligible geometries; 49 degenerate
or ground-truth clipping cases were excluded, with no engine errors. This is a
synthetic regression sample, not 71 Florida properties or an independent holdout.
At this initial stage the property inputs were unavailable; the later regional
holdout and its limitations are documented separately above.

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

## Frozen 3,000-attempt paired reconstruction benchmark

This larger run has mixed results and **does not establish an overall accuracy
improvement**. Baseline is repository `main` at `40d0af2`; current is the frozen
geometry snapshot, not the later working-tree registration, pin-lifecycle or PDF
changes. Both run the same `traceBuildingV2` caller, analytic synthetic source frame,
default pitch 6, and exact fitted-slope/plane-factor measurement settings.

Seeds 20001–23000 were frozen before result inspection. Structurally similar wing,
roof-kind, orientation and level templates stay in one split. Development has
1,867 attempts and holdout 1,133 (37.8%). Previously observed seeds 1–120 are excluded.
The manifest SHA-256 is
`afc624beac418b7dbc4d4ede8120ddc85ef4b6cbdb5f74dfb7b11d24f8aed6de`.
There was no holdout-driven engine tuning.

Of 3,000 attempts per version, 1,765 qualify: 1,223 generator-degenerate cases and
12 ground-truth clipping failures are excluded; there are zero trace-engine errors.
The holdout has 676 paired eligible cases and 457 exclusions. Exclusions and
unscored quantities never count as passes.

| Numerical comparison | Baseline | Frozen current |
|---|---:|---:|
| All eligible: median absolute area error | 0.9561% | 0.9543% |
| All eligible: area within 3% | 1,609 / 1,765 | 1,611 / 1,765 |
| Holdout: median absolute area error | 0.9908% | 1.0247% |
| Holdout: area within 3% | 611 / 676 | 614 / 676 |
| All eligible: every edge type within tolerance | 295 / 1,765 | 280 / 1,765 |
| Holdout: every edge type within tolerance | 111 / 676 | 105 / 676 |

Line tolerances were predefined as the larger of 5 ft or 10%, including separate
counts of spurious edge types where the reference is zero. Numerical comparisons
include automatic inferred estimates; they are not measurement acceptance or
COMPLETE-export decisions. The holdout median area error and linear agreement
regress, despite small improvements in other aggregates.

The original spatial scorer encountered polygon-library failures. Original output
files and hashes were preserved. Only previously unscored version/case pairs were
repeated with the same frozen engines. An exact union-area identity recovered 68
baseline and 49 current spatial values. A subsequent numerical-stability recovery
used a fixed **one-micrometre grid for scoring source and engine coordinates only**;
it did not mutate source traces, align outlines or tune the reconstruction engine.
Twenty failed cases were checked at 0.1, 1 and 10 micrometres before recovery; the
maximum observed IoU spread was 0.000000789. Raw polygon inputs, original outputs,
all retry outputs and the precision rationale are retained. Every non-spatial
measurement was required to reproduce exactly, and frozen engine hashes were
checked again at completion. This scoring repair occurred after the original run
and is disclosed rather than portrayed as a pre-frozen measurement pipeline.

The final spatial score covers **1,763 of 1,765 eligible cases in both versions**.
The same two cases remain unscored and never count as meeting spatial criteria.
Exact/shifted/equal-area-wrong-outline and polygon-hole/coincident fixtures check
the scorer separately. The common holdout has 675 spatially scored cases:

| Common spatial holdout (675 cases) | Baseline | Frozen current |
|---|---:|---:|
| Median outline IoU | 0.98823 | 0.98995 |
| IoU >= 0.9 and missing/extra footprint each <= 5% | 657 / 675 | 655 / 675 |
| Area, spatial and all linear tolerances together | 106 / 675 | 102 / 675 |

Across the complete eligible set, the numerical/spatial/linear composite count is
282 baseline and 269 current, with unscored cases never counted as meeting it.
Higher median IoU therefore does not justify claiming broader report accuracy.
This benchmark generates no PDFs and runs no actual evidence export gate:
**false COMPLETE exports were not evaluated**, rather than measured as zero.
It also does not test address selection, affine source decoding, new/background
imagery matching, camera/orbit behavior or real-property evidence.

Reproducible split files, four engine-source files per version, original/union/
precision JSONL outputs, hashes, both spatial-rescore audits, raw polygon inputs
and all three summaries are retained in `/workspace/roof-delivery/paired-3000/`.
The final artifact is `summary-precision.json`. The summary refuses incomplete,
duplicate or unpaired attempts. Reproduce summaries with
`node bench/paired-summary.mjs .devcache/paired-3000`, then `--rescored` or
`--precision` for the corresponding preserved retry outputs. Reconstruction uses
`bench/run.mjs --workers 2 --exact --list <split-seeds.json> --engine <frozen-engine-folder>`.
No private property input is in this synthetic dataset. Detailed per-line-type,
clear/obstructed and complexity strata remain in the JSON summaries.

## PDF examples and reproduction

The report retains our plan-first sketch/layout and adds measurement summary and
material-information coverage. [ROOFR_INFORMATION_COVERAGE.md](ROOFR_INFORMATION_COVERAGE.md)
maps the official public sample's information categories to our implementation and
documents intentional evidence and purchasing distinctions.

All three examples are invented geometry. Their nominal coordinates are not a
customer property. The simple example is a two-plane 4/12 gable. The multi-building
example has a 6/12 hip main roof and detached 4/12 gable. The tree-obstructed example
marks F1 unresolved, F2 inferred and replaces a canopy-limited eave with a non-roof
obstruction boundary. It demonstrates review behavior; it is not a measured tree.

```sh
node tools/dev/delivery-examples.mjs
node tools/dev/run-app.mjs --offline --materials --job .devcache/delivery/jobs/simple-gable.json --out .devcache/delivery/simple --port 8193
node tools/dev/run-app.mjs --offline --materials --job .devcache/delivery/jobs/complex-mixed-pitch.json --out .devcache/delivery/complex --port 8194
node tools/dev/run-app.mjs --offline --materials --job .devcache/delivery/jobs/tree-obstructed-review.json --out .devcache/delivery/tree-obstructed --port 8195
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

Final artifacts are `/workspace/roof-delivery/simple/report.pdf` (5 pages),
`/workspace/roof-delivery/complex/report.pdf` (5 pages), and
`/workspace/roof-delivery/tree-obstructed/report.pdf` (5 pages). All are US Letter.
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

Private regression **R-PIN-01** also exercised the actual Google Maps/address-to-roof
UI workflow, with matching Preview/Print/Download bytes. The report remained REVIEW
REQUIRED, with unsupported quantities blank. The independent reconciler recomputed
quantities from the saved geometry and verified source/scope evidence revisions;
legacy `measured` flags did not authorize numbers. A subsequent direct PDF rebuild
from that same saved model checked the final layout corrections without another
API download. This supplements the normal UI run; it is not a new address-flow
run. Private inputs, imagery, address, model quantities and reports remain local
and are excluded from the repository and shared artifact archive. There is no
independent numerical reference for this case.

## Focused verification

The independent PDF parser's twenty-six regression scenarios pass, including corrupted
area, stale model inputs, dropped model edge, the new building subtotal format and
the distinction between supported and inferred quantities. Syntax checks pass for
the example generator, offline adapter and UI runner. All three final UI runs use
`--strict --materials`: 31/31, 44/44 and 43/43 reconciliation checks respectively, identical
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
when saved-job restoration stalled. That public-building attempt does not establish
address-to-report browser validation. The three delivered example PDFs remain
explicitly illustrative; the separate private property checks are described above.

## Final narrow-guard validation on the same 3,000 seeds

The final geometry guard preserves the existing 0.20 m support-distance limit.
For a low-noise freely fitted run (RMS at most 0.05 m), it rejects an axis constraint
whose RMS is more than 0.025 m worse. This protects a supported one-metre diagonal
without globally changing the roof fitting tolerances. Finite input and two-point
guards are covered by focused tests. This is a geometry safety correction, not a
claim that automatic roof measurements are ready for ordering.

After the prior aggregate results were known, the final engine was frozen and run
on all original seeds 20001–23000, using the same analytic sources, exact fitted
slopes and plane factors, and original family split. Consequently, this final
comparison **is not an untouched blind holdout**. The original baseline and prior
guard results remain unchanged. All versions have 3,000 attempts, 1,765 eligible
cases, 1,235 generator/reference exclusions and zero trace-engine errors.

| Comparison | Baseline `40d0af2` | Prior guard | Final narrow guard |
|---|---:|---:|---:|
| All eligible: median absolute area error | 0.9561% | 0.9543% | 0.9483% |
| Holdout group: median absolute area error | 0.9908% | 1.0247% | 1.0366% |
| All eligible: area within 3% | 1,609 / 1,765 | 1,611 / 1,765 | 1,610 / 1,765 |
| All eligible: every edge type within tolerance | 295 / 1,765 | 280 / 1,765 | 280 / 1,765 |
| Eligible cases meeting numerical, spatial and edge-type thresholds | 282 / 1,765 | 269 / 1,765 | 272 / 1,765 |
| Spatial scores available | 1,763 / 1,765 | 1,763 / 1,765 | 1,760 / 1,765 |
| Common holdout spatial subset: median IoU | 0.98823 | 0.98995 | 0.99007 |
| Common holdout spatial subset: spatial thresholds met | 656 / 674 | 654 / 674 | 657 / 674 |

The common spatial rows above use the same 674 cases in all three columns.
Unscored cases never count as meeting a threshold. The final variant leaves five
spatial comparisons unresolved, versus two in each earlier variant. Its median
outline agreement improves, while the holdout-group area error and edge-type
agreement remain worse than baseline. The combined threshold count remains below
baseline. **These mixed results do not establish an overall accuracy improvement.**
Numerical comparisons include inferred automatic estimates; they are not evidence
acceptance or COMPLETE-export decisions.

The final `autotrace2.js` source SHA-256 is
`5deb5dff839ad26acf11745ef29f80d9a56569aefb59db3598ba27ea62a17762`.
All frozen engine and caller hashes were verified again at completion. The tool
session was interrupted after 1,400 completed rows; only the 1,600 missing seeds
were resumed with identical frozen inputs and settings. Completed rows were
preserved, and the final collection contains exactly 3,000 unique seeds. The
interruption and checks are recorded in the local audit rather than hidden.

Final results, source hashes, original and resumed outputs, all three comparison
columns and 1,765 raw final scoring-polygon inputs are retained under
`/workspace/roof-delivery/paired-3000/`. Start with
`summary-three-variants.json`, `final-variant.json` and `final-run.json`.
Reproduce the shared aggregation with:

```sh
node bench/final-variant-summary.mjs .devcache/paired-3000
```

The benchmark still calls `traceBuildingV2` directly. It does not exercise address
selection, source registration, the browser, private reference reports or the
actual export gate. False COMPLETE exports therefore remain **not evaluated** by
this synthetic run. APInex-assisted property accuracy is not represented by these
three local geometry variants. Private inputs, caches and raw benchmark artifacts
remain outside tracked source.
