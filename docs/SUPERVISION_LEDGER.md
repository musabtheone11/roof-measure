# Supervision ledger: handoff integration (2026-11-26)

Scope: integrate the `codex/evidence-plan-first` handoff ([PR #8](https://github.com/musabtheone11/roof-measure/pull/8), commit `4806a12`) with `main` (`e094a5d`, plan-first report), reproduce the reported overlay failure, investigate the benchmark regressions, and run bounded API NEX specialist reviews. Model output is a proposal: every finding below was checked against the code or a test before acting.

## Handoff and baseline

| Item | Result |
|---|---|
| Handoff package | Read from the user's shared Drive copy (the cloud session cannot reach the local Downloads folder). `START-HERE.md` names commit `4806a12`; the packaged `code/` matches GitHub byte-for-byte on the sampled files. There is no `AGENTS.md`. |
| Delivery evidence | Synthetic example PDFs, benchmark JSONL, API trial results, private-container proofs. START-HERE: "Public deployment was blocked by Vercel team authorization. Production was not released." |
| Baseline (Node 24.22.3) | All 26 handoff bench suites, `node --test server/*.test.mjs`, runtime-agents and ai-report pass. The six browser tests pass with the preinstalled Chromium. |

## Findings and outcomes

| ID | Finding (reproduced) | Outcome |
|---|---|---|
| F-1 | Merging the handoff as-is blanks every quantity on a Google Solar report: auto-trace attached no `measurementEvidence`, so the evidence audit withheld all of them (reproduction address: hundreds of `quantity-evidence` reasons, blank areas and lengths). | Auto-trace now records dated provenance per quantity it measured, bound by `RM.evidenceRevision`. Inferred items stay estimates; unresolved items and undated imagery get none. Saved jobs are backfilled on load only for unedited engine output. Test: `bench/trace-evidence-test.mjs`. |
| F-2 | `absorbBumps` (added in PR #9, live on `main`) also absorbed real small facets. Synthetic ridge+hip within 10%: `main` 57.7% vs 69.0% for the handoff engine. | The object rule now also requires the region to follow its host plane (≤30°) or be low (<0.8 m), and to be non-flat inside (median residual ≥0.075 m). Result: 67.6%. the earlier odd-plane property's object is still absorbed (12 facets), but its median residual of 0.082 m sits close to the threshold. Test: `bench/bump-regression-test.mjs` (fails on the old rule). |
| F-3 | Reported "displaced overlay" (reproduction address): not reproduced on current code. The trace lies within 0.13–0.52 m of the house on the Solar aerial and on basemap zooms 19, 20 and 21 (image correlation). The likely earlier cause is the stale-pin trace race fixed in the handoff (`trace-race-test`). | Covered by the merged handoff fix. The original failing state could not be recreated, so this is not claimed as fixed by observation. |
| F-4 | Reproduction-address map labels heavily overlapped on `main`. | Fixed by the handoff's map label placement (`map-label-test`); confirmed on the merged run. |
| F-5 | Summary sheet: pitch distribution grouped by raw fitted slope (duplicate rows; wrong predominant pitch); flat area printed as 0 in incomplete scope. | Grouped by nominal pitch; no unverified zero. |
| F-6 | Order quantities printed on sheet 2 while the summary sheet withheld waste. | Both withhold while review is required or part of the roof is unseen. |
| F-7 | Static hosting (GitHub Pages): the AI panel showed a raw JSON parse error. | Clear "not available on this site" message. Test: `tools/dev/static-ai-test.mjs` (fails without the fix). |
| F-8 | A provider timeout was never retried. | One retry within the bounded budget; cancellation is never retried; timed-out calls keep unknown billing. Contract test in `bench/runtime-agents-test.mjs` (fails without the fix). |
| F-9 | Building selection: the handoff blanks every quantity until a person confirms it. | It is now a report-level review item: status REVIEW REQUIRED and order quantities withheld, but measured values stay visible for the check. One review-panel confirmation returns COMPLETE (verified on a saved job). The georeferenced scale is recorded from the raster registration check. |

## API NEX assignments

Requests were made through the session's authenticated egress proxy; the credential never entered code, logs or prompts. Inputs were source code excerpts and synthetic fixtures only: no addresses, customer documents or Google imagery. Both assigned models were verified on the authenticated roster before use.

| Task | Model (assigned = returned) | Source | Response ID | Tokens in/out | Provider cost | Validation |
|---|---|---|---|---|---|---|
| A3 vision probe | claude-opus-5.5 | 6254cf3 | msg_01KsvJEfvPbCp3mWSr25qdN5 | 1,200 / 71 | $0.000636 | Read both synthetic labels exactly: vision confirmed. |
| A2 document intake | claude-opus-5.5 | 4806a12 | msg_01WCRLsb94xa7qp3WKLowRiV | 80,326 / 15,074 | $0.0477 | Rotation and stale-export claims rejected (geometry is withheld on rotate; matrices verified; an edit clears the measurement at `ai-trace.js:71`). EXIF and low-resolution notes not adopted. |
| A1 geometry | gpt-6.2-astra | 4806a12 | chatcmpl-wPiF3nrObmk36FH3dv2FJibM | 10,097 / 6,758 | $0.004214 | Independently proposed the F-1 design (attach after the complete model; no provenance for unresolved items). Implemented and tested. |
| A5 reliability | gpt-6.2-astra | 4806a12 | chatcmpl-CGZKfxRPbHVMvxTjOVBU4YAx | 8,541 / 3,864 | $0.003102 | Timeout retry confirmed and fixed (F-8). Stale-revision claim rejected (the browser owns the roof and discards stale results, `ai-trace.js:88`). Unknown billing is already shown as "at least $…". Persisting jobs across restarts remains open. |
| A6 deployment | gpt-6.2-astra | 4806a12 | chatcmpl-l5RtUIMsrNKL2OtXgL0atxjg | 5,060 / 5,480 | $0.002635 | Static-hosting fallback reproduced and fixed (F-7). Gateway Origin check, runtime-aware health check and revision endpoint remain open (the private container is not deployed). |
| A3 report layout | claude-opus-5.5 | 7d7f3c9 | msg_01dWxUYw5z8XANx3mqQ8dFNu | 48,203 / 8,354 | $0.028279 | Page-spill and azimuth-basis findings adopted (summary now one sheet). Its "page 2 totals disagree" claim was a misread: page 2 prints Hip 84.00 / Ridge 36.00, matching pages 1 and 3. |
| A4 independent expectations | gpt-6.2-astra | (fixture text only) | streamed | not reported | $0.000809 (balance delta) | Derived values match the app on every area, length and facet. |
| A0 availability probe | gpt-6.2-astra | none | streamed | not reported | $0.000514 (balance delta) | Small requests succeed. The first three long non-streamed astra calls returned HTTP 502 at about 75 s (twice each, one retry); the balance was returned, so they appear unbilled (exact billing unknown). Streaming fixed it. |

Total spent on this assignment: about $0.0884 by provider-reported cost plus balance deltas. Account balance after: $2.455 (from $2.542).

## Synthetic benchmark (bench/run.mjs, seeds 1–120, 71 scored houses; generated roofs, not property accuracy)

| Engine | Area MAPE | Facets exact | Ridge+hip within 10% | Valley ratio | Report-grade houses |
|---|---|---|---|---|---|
| pre-change (2026-11-23) | 2.46% | 40.8% | 76.1% | 1.06 | 19.7% |
| handoff `4806a12` | 1.28% | 39.4% | 69.0% | 0.95 | 21.1% |
| `main` `e094a5d` (production) | 1.28% | 35.2% | 57.7% | 0.77 | 21.1% |
| this branch | 1.29% | 40.8% | 67.6% | 0.94 | 22.5% |

The remaining ridge+hip gap to pre-change (76.1%) comes from the handoff's tracer changes, which traded it for the area gain. Unresolved.

## Open items

- The 76.1% → 69.0% ridge+hip trade-off in the handoff tracer; step-flashing over-estimation (ratio 1.9).
- The odd-plane property's object-rule margin is thin (0.082 m against a 0.075 m threshold).
- Runtime: persisting jobs across restarts, a gateway Origin check, a runtime-aware health check, and a revision endpoint for deployment proof.
- Deployment: the private container and any Vercel preview are not deployed (team authorization). GitHub Pages serves `main`.
- No field-verified reference measurements were used. Nothing here establishes physical measurement accuracy.
