# Organization implementation and validation — 2026-11-27

## Design and independent review

See [design](APINEX_ORGANIZATION_DESIGN.md) for both diagrams, role contracts,
team ownership, transitions, continuous operation and staged implementation.
An independent Codex reviewer required six revisions before implementation:
role/bundle schemas, trusted evidence issuance, holdout isolation, honest encryption
prerequisites, transaction/recovery protocol, and explicit capability disclosure.
All were incorporated. Later independent review reproduced and corrected task
integration, release binding, CEO decision consistency, concurrency, literal-unit
parsing and recommendation-history gaps. Codex implementers are not runtime agents.

## Implemented and checked

- SQLite WAL tasks/events, content-addressed private artifacts, atomic handoffs,
  fencing, durable reservations, unknown billing, cross-process concurrency=1.
- Eight strict role contracts and configurable bounded tasks; model/provider
  outputs cannot mint verification evidence, bypass gates or execute commands.
- Actual authenticated roster discovery and bounded API NEX text adapter.
- Recursive stable-file discovery with visible unsupported/uncertain/inaccessible
  counts; read-only source handling and hash/parser-version deduplication.
- Local cancellable PDF/text extraction and conservative source-claim normalization
  for area, length, pitch, date and provider. Unsupported numeric formats and OCR
  ambiguity remain review items, not silently corrected values.
- Property-group split helper, duplicate-group conflict rejection, and restricted
  artifact resolver. A verified separate OS holdout boundary is still required.
- Pause/resume/stop/cancel/retry/status/health controls; watch plus reconciliation;
  no model calls while idle; explicit Windows/logon and Linux/user-service templates.
- Customer application preview/export now omits segmentation/source imagery.
  Private internal geometry remains available. Strict standalone customer JSON/PDF
  projection also rejects imagery/geometry keys and preserves unknown quantities.

Latest combined Node tests: **70 passed**, including **50 organization tests**.
Organization coverage includes 10,000 deterministic property-identity normalization
checks, which are not 10,000 roof reports or field accuracy tests.
The actual CLI process test creates a report, observes extraction/reference handoff,
stops/restarts the process and confirms no duplicated extraction or inference.
It is not an OS boot/logon test and not an installed continuous service.

Existing app benchmark/contract scripts passed after reconciling remote `5c10081`,
including geometry, quantities, report, stale-export, registration and provider
contracts. Actual browser checks cover image review, cancellation, restrictions,
boundary review, local PDF import, real rendered PDF and PDF/ZIP downloads.
New remote review-recovery and source-delivery checks passed using system Chromium.
One initial browser invocation lacked the Playwright-downloaded executable; rerun
with `CHROMIUM_PATH=/usr/bin/chromium` passed. No TLS checks were disabled.

Example customer PDF: `.devcache/ai-report-tests/customer-no-segmentation.pdf`.
Two Letter pages; parent and report implementer visually inspected the first page.
Independent PDF checks verify values, no source-image/roof-vector output, and no
clipped text. Synthetic quantities 960.00 ft² projected and 1,073.31 ft² sloped are
functional examples, not actual property measurements or accuracy certification.

## Actual API NEX pilot, not simulated agents

Authenticated roster: 45 returned IDs, including selected Opus/Astra. Website
counts differ. The pilot sent only a synthetic engineering issue, no customer
files, addresses or imagery. It made exactly two paid chat requests:

| Assigned role/model | Observed result | Provider-reported debit |
|---|---|---:|
| Engineering / `gpt-6.2-astra` | Strict-valid needs-human; proposed explicit area semantics and tests, correctly did not claim implementation | $0.000381 |
| Critique / `claude-opus-5.5` | Strict-invalid output; failed queue, no promotion or repeated paid repair | $0.001572 |
| Total | Two requests, no accepted measurement improvement | $0.001953 |

Pilot state/artifacts remain private in `.devcache/organization-live-pilot` and
were paused afterwards. The original invalid second response was not retained by
that initial adapter version; it is not fabricated here. The adapter now checkpoints
bounded original response evidence before role validation, covered by regression.
These two requests do not qualify all eight roles or establish model superiority.
Runtime roles require further task-specific qualification before production use.

The owner's "$20 per week" is a hard rolling-seven-day organization ceiling.
Defaults: $1/workflow, $1/rolling hour, $3/rolling day, $20/rolling seven days and
$80/UTC calendar month. Lower/zero limits remain lower/zero. Durable unknown holds
never turn into free usage. Other application/API account usage is not aggregated
by this new organization DB; shared-gateway accounting remains a production gate.

## Exact blockers and unverified requirements

| Requirement | Actual state |
|---|---|
| User's Windows Downloads access | Desktop project listed, but this cloud thread has no local terminal or Windows filesystem mount; actual path not resolved locally |
| Thousands of relevant reports | Actual user's collection inventoried/processed/duplicated/failed counts unknown; cloud Downloads empty |
| Unique properties and real dataset splits | Unknown until identity/reference curation of accessible source collection |
| Representative extraction/OCR validation | Text/PDF analytic fixtures checked; scanned report OCR adapter and human source verification missing |
| Trusted baseline and real-case evaluation adapters | Not installed in organization workflow; existing app regression suites run separately |
| Isolated candidate application and verification | Adapter/isolation unavailable; no model patch auto-execution |
| Real-case accuracy gain | Not claimed; no new independently verified property ground truth |
| CEO-approved commercial release | None; gate tests passed, missing actual evidence blocks promotion |
| Installed worker and actual OS restart | Not installed/verified on user's Windows host; installer/runbook supplied |
| Cloud staging/production promotion | No new production URL or completed deployment claimed; requires actual hosting authorization/adapters |

The implemented foundation is usable for local inventory/extraction and control
tests, **not a completed continuously operating improvement organization**. Missing
stages enter needs-human instead of receiving fabricated passing results. No
source reports were moved/deleted and no customer collection was sent to API NEX.

## Build/deployment evidence

The initial Docker build failed with npm `SELF_SIGNED_CERT_IN_CHAIN` in this
managed proxy environment. Dockerfile now supports an optional BuildKit `build_ca`
secret for trusted build-time CA injection. No CA or credential is copied into the
image, and normal public-registry builds need no secret. The trusted-CA build
completed successfully; authenticated local container smoke results are recorded
in `.devcache/deployment/container-smoke.json`. Local container smoke is not a
production deployment or proof of a persistent Downloads worker.

See [operations](APINEX_ORGANIZATION_OPERATIONS.md) for exact local commands,
startup prerequisites, bounded costs, state recovery and unavailable rollback
adapter. Automatic production rollout remains blocked by the repository policy
and required human release/evidence gates.
