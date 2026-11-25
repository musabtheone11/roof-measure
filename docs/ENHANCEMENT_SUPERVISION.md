# Enhancement supervision

Reviewed on 2026-11-25 against commit `595bdb0`. This file records an active
implementation review; it does not promise unattended monitoring after agents stop.
The supervisor owns this record and reviews fixes independently of their authors.

## Acceptance rules

A change is accepted only after a meaningful regression test reproduces the
original defect and passes with the fix. Model agreement, a successful HTTP status,
and a frozen output are not roof-accuracy evidence. Customer imagery and reports
remain private; paid provider trials use only explicitly authorized inputs and
bounded limits. Production stays unchanged until its deployment controls are met.

A deployable preview must have an actual reachable URL, authentication protecting
the shared provider credential, no secret in browser assets, and a completed flow
smoke test. A process listening on port 3000 is not proof of external deployment.

## Findings requiring fixes

| ID | Finding and reproduced consequence | Required acceptance |
|---|---|---|
| S-01 | HTTP job-limit checks precede asynchronous body reading. Four delayed-body POSTs from one owner were all accepted with HTTP 202, violating one running job per owner and two globally. | A same-owner four-request race admits exactly one job; competing owners never exceed two. Admission must be atomic after validation and before starting provider work. Cancellation and failures release capacity correctly. |
| S-02 | Edge geometry is not validated with the roof. A valid 100 × 100 pixel roof and 10 ft / 100 px calibration accepted an eave from [1000,1000] to [2000,1000] and returned 30.48 m. | Out-of-image, off-roof, concave exterior crossings, duplicate IDs and unsupported edge classifications cannot produce physical line quantities. Valid exterior edges and supported shared interior edges retain correct dimensions. |
| S-03 | Explicit small/zero budgets silently become larger defaults: maxUsd 0 becomes 1.6, maxTokens 500 becomes 3.2 million and maxRequests 0 becomes 8. | Explicit caps are never enlarged. Reject malformed values or preserve a no-call budget. Test that zero/insufficient caps issue no chat request and that integer/request and finite dollar/token limits are checked. Missing settings alone may use documented defaults. |
| S-04 | Accepting a replacement AI result archives the previous corrections but leaves the old correction array active. Exports can attach prior-model corrections to the new original output. | Retrying after an edited plan archives that plan and its corrections; the new result starts a distinct empty correction log. Export retains both histories without assigning old edits to the new model. |
| S-05 | A runtime quality finding of perspective distortion does not reach the measurement gate. A valid polygon with an explicit oblique-perspective finding still returned 9.290304 m² when the UI declared orthographic and supplied one horizontal calibration. | Bind perspective restrictions to the canonical model and preserve them through edit/reopen. Initial and recalculated physical quantities remain withheld until independently supported rectification/resolution. |

The first two defects were independently reproduced by the supervisor without a
paid API call. S-05 was also reproduced without a provider call. S-03 and S-04 were identified directly in their control paths;
regression tests must demonstrate their externally observable behavior.

## Evidence and scope limits

- The completed 3,000-case deterministic study has 1,765 eligible cases and zero
  engine crashes, but worse holdout area error and fewer combined threshold passes
  than baseline. Five final spatial cases remain unresolved. Repeating tests does
  not turn those failures into passes.
- The regional study froze 39 candidates, including 34 regional inputs. Its 17
  paired regional area differences are conditional on printed reports. Exact
  source/scope/date verification remains zero; the holdout median worsened.
- Runtime vision tests are analytic synthetic examples. Free Qwen, GLM Flash and
  Luna are candidates after a single passing outline case, not proven defaults.
- The uploaded-image workspace exports review JSON. It does not yet integrate
  verified image georeferencing into the map job and existing PDF workflow.
- Dedicated JPEG EXIF-orientation tests and real externally hosted-flow validation
  remain unverified. Browser PNG normalization alone is not that test.
- Geographic conversion uses a local linear metric frame after CRS conversion.
  Its acceptable image extent/distortion should be stated and tested before
  treating unusually large or polar georeferenced images as measurable roofs.

## Next review sequence

1. Independently verify S-01 through S-05 fixes and their regression coverage.
2. Rerun relevant runtime/server/browser checks, then inspect exports for current
   revision, correct model identity and retained original outputs.
3. Check the exact protected deployment URL and complete its real flow when a
   hosting route is available; do not expose the shared key through static Pages.
4. Address field-reference alignment and the strongest classification failures
   before claiming numerical roof accuracy. Keep development and evaluation
   examples separate and disclose every missing output.

The parent coordinates implementation owners and hosting. This supervisor will
update findings as fixes arrive rather than silently marking them resolved.

## Independent fix review

- **S-01 accepted in the current worktree:** the same delayed-body reproducer now
  returns `[202, 429, 429, 429]`. The added server suite also checks admission
  across distinct owners. This verifies request admission, not API accuracy.
- **S-02 accepted in the current worktree:** independent challenges for the
  original out-of-image edge, partially overlapping same-category lines and a
  self-retracing bent path now return invalid geometry and null physical lengths.
  The initially incomplete duplicate guard was caught and strengthened before
  acceptance. Endpoint-only joins and valid shared boundaries remain covered.
- **S-03 accepted in the current worktree:** provider-fixture tests confirm zero
  and insufficient limits make no chat call. HTTP tests reject null, strings,
  fractional request counts and conflicting aliases before any provider job.
- **S-04 accepted in the current worktree:** the independent browser regression
  verifies replacement archives old corrections, starts a new correction log,
  preserves imported source/date metadata and clears saved calibration. A
  mismatched image fingerprint rejects the import without replacing the review.
- **S-05 accepted in the current worktree:** the initial canonical response,
  cloned/edited deterministic model, and browser edit/export flow retain the
  perspective restriction and withhold physical quantities. Reopening does not
  turn calibration into rectification.

The supervisor independently reran `node --test server/*.test.mjs` (six tests)
and `node bench/runtime-agents-test.mjs`; both completed successfully. This check
covers runtime guards, including manual pen handler tests added by its owner.
It does not replace the separate UI, real provider or deployment checks.

The supervisor independently ran the latest `tools/dev/ai-ui-test.mjs` against an
isolated current-module server with a fixture-only credential. It passed its
consent, calibrated/pitch calculation, correction/history, hash-bound reopen,
source provenance, perspective persistence, stale export and image-load checks.
No paid provider call was made by these independent checks.

All five initial supervision findings are now accepted for the current worktree.
Acceptance does not establish field accuracy, external deployment, or completion
of the newly added PDF/sketch workflow. Those have separate pending checks.
