# Runtime integration validation

The new source-image editor is inside the existing application. It is a separate
review workspace: it does not silently place unlocated uploaded pixels on the
Google map or replace the saved job/PDF. Its export is revision-bound review JSON,
including original provider output, source metadata, user corrections and current
deterministic measurements. A geographic import requires verified georeferencing.

## Implemented roles

The runtime verifies the authenticated APINEX roster before processing. Opus 5.5
handles quality, exterior outline and adjudication; Astra 6.2 handles roof
structure and an independent outline that never sees the first trace. These are
provisional choices from limited synthetic trials, not proven universally best
models. A deterministic worker checks topology and computes quantities. The
independent outlines trigger review; their agreement cannot certify accuracy.

Every polygon is schema-validated. Exact single JSON code fences can be unwrapped
as compatible formatting, with the original response retained and normalization
recorded. Prose, multiple blocks and malformed content are rejected. Historical
candidate results in API_VERIFICATION.md used the earlier strict format parser;
this compatibility change does not retroactively turn those trials into passes.

The runtime has request/token/dollar ceilings, bounded concurrency and retries,
timeouts, cancellation, owner-bound jobs, stale-revision rejection and same-origin
CSRF checks. Because image token accounting is unpublished, a call reserves the
whole published model context at its verified price. This is intentionally more
conservative than typical actual usage; it is not a cost prediction.

## Checks and their limits

- Server tests exercise geometry, units, pitch, calibration, projection, topology,
  crop transforms, HTTP ownership, cancellation, CSRF and private-file denial.
- `bench/runtime-agents-test.mjs` sends actual HTTP requests to a local provider
  fixture. It checks contracts, independent input isolation, concurrency, retry,
  budget exhaustion, malformed outputs and stale/cancelled work. It makes no
  claim about paid-model accuracy.
- `tools/dev/ai-ui-test.mjs` drives Chromium against the actual application and
  deterministic measurement endpoint with a synthetic agent-response fixture.
  It verifies consent, 960 ft² calibrated horizontal area, sourced 6/12 pitch
  recalculation to 1,073.31 ft², vertex/edge correction, immutable original output,
  revision-current exports and clearing calibration when changing source images.
- Live APINEX requests were also exercised through the application. An initial
  five-call UI run returned useful outline/structure proposals and disagreements,
  with invalid quality/adjudication responses recorded. Later quality-gated runs
  stopped on invalid regions or a schematic-source refusal, withheld physical
  quantities and retained the reported cost. These are successful failure-path
  checks, not successful roof-accuracy checks. A later hardened run returned four
  schema-valid quality/outline/independent/structure outputs in 23.922 seconds
  ($0.002357 provider-reported debit). It identified a 1,326-pixel plane-coverage
  gap and withheld physical quantities. This is synthetic workflow verification,
  not field accuracy.

The browser regression uses a test-only managed-proxy TLS exception. Production
TLS verification is unchanged. No private customer imagery or reference reports
were sent to the provider in these runtime trials.

## Hosting

The repository's production deployment is legacy GitHub Pages from main/root.
It cannot run the secret-backed Node API. The feature branch leaves that deployment
unchanged. The Node preview is running on the managed environment's HTTP port
3000, but the environment status has not supplied a hosted preview URL. Therefore
an externally deployed-flow smoke test is not claimed. The shared-key service
must use an authenticated preview gateway; do not publish it as an unauthenticated
public API. Runtime jobs are transient and should be saved using the review export.

Uploads are normalized into a same-size PNG from the browser-decoded image, so
calibration and provider coordinates use the same orientation. Original file
metadata is preserved. PNG workflow tests pass; a dedicated JPEG EXIF-orientation
fixture has not been exercised. Rapid file-selection tests verify that the latest
selected image wins and cannot inherit the previous image calibration.

The final live integration run completed all five schema-valid APINEX roles,
including adjudication of the detected plane gap, in 30.375 seconds. Reported
debit was $0.004387. The unresolved gap and unknown pitch still withheld physical
quantities; adjudication did not promote its opinion into measurement evidence.

## Supervised continuation

The continuation adds local PDF.js 6.5.438 page rendering, hash-bound JSON reopen,
actual quarter-turn pixel transforms, literal sketch annotations, and revision-bound
source-image review PDFs. Both PDF.js and the existing jsPDF 2.5.1 are bundled
locally with licenses; model inference still requires explicit selected-image consent.
The original geographic report layout remains separate and unchanged.

Independent supervision reproduced and verified fixes for concurrent admission,
invalid/off-roof edges, enlarged explicit budgets, stale correction histories,
perspective gating, pending-source races, and short pen segments. A model response
may receive one bounded same-model schema repair; original attempts and their costs
remain visible. Unknown billing is never counted as a free failed request.

An authenticated, hardened Docker run completed one real synthetic APINEX job:
five schema-valid roles, 14,992 input and 2,273 output tokens, $0.007834 reported
debit. The first report attempt failed because the CDN library was unavailable
and the model lacked a selected exterior outline. These were real failures.
After local-library and honest missing-outline review fixes, a separate replay of
that saved output produced an 83,673-byte, three-page Letter PDF with CDN scripts
blocked and no browser errors. It displayed the missing outline and withheld
physical quantities. The replay made no API calls; it is not a second inference
trial or validated roof accuracy.

The final tested image hash was
`sha256:2103f61a3b2f8f59ebb9f9c38af6a01a43ee19315147320cb62d1c2e7c026da6`.
Synthetic proof is retained locally under `.devcache/deployment/`. An externally
reachable preview is still blocked by Vercel team authorization and remote secret
configuration. No public URL or production release is claimed.

Remaining supervised work includes cancellation before the creation response and
manual recovery of missing AI outlines; see the live supervision ledger.
