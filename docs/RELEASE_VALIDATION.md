# Roof Measure release decision

**Supervised preview only.** This revision can produce a source-linked review report, preserve corrections and withhold unsupported quantities. Automatic building selection and takeoff have insufficient independent field evidence for a commercial accuracy promise.

## Scope, defects and disposition

| Task | Disposition | Evidence or next action |
|---|---|---|
| Handoff and Git history | Verified | All 3,988 manifest entries matched their SHA-256. Draft PR 8 was at `4806a12`. Its head now includes the changes from `main` at `e094a5d`, including fitted-plane checks and conditional elevations. The PR keeps the handoff's plan-first sheets, schedules and evidence rules where the two layouts conflicted. |
| Golden Pond displacement | Original incident open | Reproduced stale address selection and an explicit pin outside its mask accepting another building on controlled inputs. The integrated app rejects both. To measure the reported property's error, obtain its original pinned/saved job, registered source raster, screenshot and independently identified footprint. |
| Editing and registration | Passed on tested inputs | Source selection survives delayed lookups and raster requests. Detached structures require review. Browser pointer and label checks cover a letterboxed canvas at DPR 2. The seeded geometry and editor suite covers 10,000 cases. [Fixture ranges and reproduction](REGISTRATION_AND_EDITOR_VALIDATION.md) |
| Job identity and recovery | Passed on one instance | A new upload clears the previous property's audit. SQLite commits admission and ownership before dispatch. The browser can recover a matching raster after refresh. A server interruption never silently bills a replacement request. User exports retain revisions for use beyond the 15-minute receipt window. |
| Source report and client downloads | Passed on tested clients | Desktop Chrome and Edge downloaded the PDF and ZIP. The ZIP's CRC, source fingerprint and revision were checked independently. Manual trace, pitch evidence, undo/redo, edit invalidation and reopen produced 200.00 ft² projected, 216.67 ft² sloped and a 20.00 ft edge on the analytic example. [Rendered evidence and commands](RUNTIME_VALIDATION.md) |
| Plan-first map reports | Passed on three synthetic jobs | Preview, Print and Download produced identical bytes per job. The simple, mixed-pitch and tree-obstructed reports reconciled 31/31, 44/44 and 43/43 independent checks. The offline map adapter cannot validate a live property geocode. |
| Specialist execution | Free evaluation completed | 22 role assignments, 19 controlled image probes and 22 forced inert tool calls passed their frozen checks. Each of 63 responses included a matching model ID, request ID and explicit zero debit. The 22 paid IDs had no project-wide spending ceiling. Nine advertised IDs were absent from authenticated discovery. [Assignments, access and limits](evaluation/specialist-matrix.md) |
| Live upload to report | Passed locally with measurement abstention | Two free models made six calls with 7,220 prompt and 6,395 completion tokens. All six reported zero debit. One outline needed a schema repair. The uncalibrated, topologically inconsistent result remained review-required through a real three-page PDF download. [Offline audit](evaluation/live-review.json) |
| External Node preview | Blocked | Vercel project discovery returned HTTP 403 for the configured team. GitHub's verified production deployment was the static Pages site at `e094a5d`. Grant access to an existing Node-capable preview with HTTPS, secrets and a private volume, then validate its revision and upload workflow. [Deployment and rollback](PRIVATE_PREVIEW_DEPLOYMENT.md) |
| Field accuracy and commercial release | Blocked | Obtain independent, dated source and per-edge measurements for the intended structure. Freeze a new field holdout and agree tolerances before scoring. The two newly available numbered reports are app-generated comparisons based on 2016 and 2023 imagery. Neither adds an independent field reference. |

## Paired reconstruction benchmarks

The handoff engine and the integrated engine used the same generator, fitter settings, scoring rules and inputs. Absolute error is the difference from the analytic sloped area divided by that area's magnitude. P95 uses linear interpolation. All 240 seeds per revision remain accounted for. The existing generator eligibility rules excluded 92 degenerate scenes per revision. No engine error occurred on the 148 eligible scenes.

| Cohort and revision | Scored / attempted | Median absolute area error | P95 | Worst | Exact facet count | All historical spatial, area and line criteria met |
|---|---:|---:|---:|---:|---:|---:|
| Development, handoff | 71 / 120 | 0.831% | 4.687% | 10.925% | 28 | 14 |
| Development, candidate | 71 / 120 | 0.848% | 4.655% | 7.149% | 25 | 13 |
| Fresh synthetic holdout, handoff | 77 / 120 | 1.065% | 4.411% | 7.922% | 32 | 14 |
| Fresh synthetic holdout, candidate | 77 / 120 | 0.841% | 4.245% | 7.816% | 24 | 14 |

On the fresh holdout, 15 roofs improved and 13 worsened on area. The candidate's median improved while exact facet counts fell from 32 to 24. On both cohorts combined the candidate median area error was 0.57% for 31 single-wing roofs, 0.80% for 59 two- or three-wing roofs and 1.36% for 58 roofs with four or more wings. The benchmark starts at a single rendered house and does not test property identity, operator corrections or client release status. Population wrong-building, abstention and correction rates remain unknown.

The individual-edge fixture uses endpoint correspondence to analytic eaves, rakes, ridges and hips on eight clean single-wing roofs. Each engine matched all 64 expected edges and all 24 facets. Each also produced three extra segments. Absolute matched-line length error was 0.049 ft median, 1.056 ft at P95 and 1.520 ft worst. Unmatched predictions stay in the results. Valley and flashing performance on complex buildings needs separate field evidence. [Individual edge correspondences](evaluation/edge-validation.json)

The historical 3,000-case study still shows worse synthetic holdout area median (0.9908% to 1.0366%) and fewer combined passes (282 to 272 overall). Its five unresolved spatial cases remain unresolved. The historical regional holdout median difference from printed reports rose from 3.15% to 3.81% on eight comparable roofs. There are zero strict, independently verified field matches. [Regional study](REGIONAL_REFERENCE_RESULTS.md)

## Independent check on the live model output

The 400 × 250 pixel analytic gable has a 100,000 px² outline. Against that outline, Qwen's mean boundary error was 3.45 px and GPT-6 Luna's was 2.90 px. Qwen exceeded the fixture's predeclared 3 px tolerance. Both passed its overlap threshold. Their mutual IoU was 0.983, despite 500 px² of proposed facets lying outside the accepted outline and five edge segments leaving it. The PDF withheld physical quantities. These results support retaining deterministic checks and human review. No model was promoted.

## Reproduction

Install root and benchmark lockfiles with Node 24. Use fresh checkouts of the baseline and integrated revisions in the frozen manifest. In each checkout run the following from `bench/`, setting the output paths to separate files for that revision:

```sh
node run.mjs --exact --workers 2 --seed 1 --n 120 --out development.jsonl
node run.mjs --exact --workers 2 --seed 1100001 --n 120 --out holdout.jsonl
```

Place the four files together as `baseline-development.jsonl`, `baseline-holdout.jsonl`, `current-development.jsonl` and `current-holdout.jsonl`. Copy `docs/evaluation/frozen-roofs.json` to `manifest.json` alongside them. Run `node bench/paired-summary.mjs <directory>` from the repository root. Execution order and timings vary across machines. Compare quantities and dispositions by seed. The saved summary includes the additional interpolated P95 and worst area errors. [Frozen manifest](evaluation/frozen-roofs.json) · [Paired results and strata](evaluation/paired-roofs.json)

Run `node bench/edge-validation.mjs` for per-edge correspondences. The release workflow also runs deterministic server, browser and image build tests without an API NEX key. The live sweep and synthetic model job require explicit separate invocation. [Model qualification and cost controls](SPECIALIST_EVALUATION.md) · [Release criteria and proposed owner policies](PREVIEW_ACCEPTANCE.md)
