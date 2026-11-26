# Enhancement supervision — 2026-11-25

The initial audit used `595bdb0`; fixes progressed through `bd4556f`, `7cbd3d0`
and `b37ae00`, followed by the parent-frozen source/semantic corrections reviewed
below. This is an implementation audit, not a promise of unattended monitoring.

**Current status:** all identified correctness findings below passed their stated
independent checks. The parent is repeating the complete current suite before
commit. Private cloud/container functionality is demonstrated; public hosting is
blocked by the Vercel team-access grant. Roof accuracy remains unvalidated.

## Ownership and task ledger

| Canonical agent | Owned work | Acceptance / remaining work |
|---|---|---|
| `/root/runtime_ui` | `ai-trace.js`, `ai-trace.css`, image/PDF/cancellation/source/boundary browser tests | Manual recovery, source identity, semantic review, cancellation, compact history and import tests pass. |
| `/root/runtime_geometry` | `server/geometry.mjs`, geometry/manual-pen tests; coordinated `app.js` pen handlers | Bounds, topology, path lengths, projection, pen and unresolved/diagnostic guards pass. |
| `/root/runtime_orchestrator` | `server/agents.mjs`, contracts, provider HTTP fixtures | Independent input, bounded repair, budgets, usage, response limits and target-selection gate pass. |
| `/root/artifacts` | `ai-report.js`, report contract and real-PDF tests | Current snapshots, withheld quantities, evidence notes, vector visibility and layout checks pass. |
| `/root/engine_diagnosis` | Docker/private-preview modules, deployment tests/configuration/evidence | Protected container and live/replay functional checks pass; public deployment still needs its access grant. |
| `/root/supervisor` | This ledger; independent reproduction and acceptance | Challenges owners' changes without editing their modules; preserves unresolved accuracy/deployment limits. |

`/root` owns HTTP/main integration, script/module includes, dependencies, CI,
branch/PR delivery and final cross-module checks. A completed agent turn does not
mean later queued findings have been fixed; acceptance follows actual reruns.

## Findings and independent acceptance

| ID | Reproduced defect | Accepted correction and evidence |
|---|---|---|
| S-01 | Four delayed-body POSTs from one owner all received 202, bypassing admission limits. | Atomic admission after body reading, bounded uploads, one owner/two global jobs. The original race now returns `[202,429,429,429]`; cross-owner and post-read capacity tests pass. |
| S-02 | An out-of-image eave returned 30.48 m. Partial overlapping/retraced lines also double-counted. | Image/roof bounds, concave segment containment, shared/exterior boundary support, unique IDs and positive-length duplicate guards pass; invalid physical quantities are null. Valid paths retain their full bent length. |
| S-03 | Explicit zero/small budgets silently became larger defaults. HTTP clamping could also create conflicting aliases. | Missing values alone default. Invalid raw limits reject; zero/insufficient caps make no chat call. Valid aliases normalize before clamping. HTTP/provider fixture checks pass. |
| S-04 | New AI results inherited old correction logs; full raw model snapshots made ordinary editing exceed the reopen bound. | Separate prior-review history, lean editable models and changed-shape/metadata deltas. The independent 100-facet/100-edit case preserves 500 KB of distinct legacy raw evidence in a 980,519-byte export and reopens with complete history. |
| S-05 | Perspective findings were lost during recalculation or Retry. A fresh legacy import could also lose a warning stored only in earlier review history. | Source-bound restrictions persist through false later responses, edits, target/rotation changes, import/undo and identical-image reload. Actual `quality.issues` arrays and historical evidence are parsed. Matching-source warnings persist, explicitly different hashes stay separate, and unbound legacy warnings remain unresolved. Independent fresh-context checks pass. |
| S-06 | Cancelling before the 202 response could lose the server job ID. A later held-DELETE case restarted Analyze after the user saw Cancelled. | Owner-scoped request IDs, pre-admission cancellation records, recovery, single-flight cancellation and user-intent epochs. The supervisor's original delayed 200/503 challenge now starts no second POST and retains the failed nonce for retry. |
| S-07 | Rejected creation requests remained “creating”; stale IDs could have recovered different input. | Terminal failures record failed status; identical retries recover the same job and changed bodies return 409. Abrupt uploads release capacity. 5,000 cancellation records hit the cap; simulated 15-minute expiry reclaims it. These checks make zero provider calls. |
| S-08 | Unresolved facets were relabelled inferred; unresolved/unspecified/obstruction lines could supply physical quantities. | Statuses are preserved, physical values withheld, pixel diagnostics retained and supported per-facet values kept. Required-note boundary confirmation is separate from pitch/classification edits and invalidates after coordinate edits. Source perspective remains binding. |
| S-09 | PDF drawing erased internal edges, distorted thumbnails and duplicated an outdated geographic conversion. | Facet fills precede edge strokes; outline is stroke-only; previews retain aspect. The source-image PDF independently reconciles calibration quantities and explicitly withholds unsupported geographic values. Forged/stale/status-inconsistent values reject. Actual browser/vector/layout tests pass. |
| S-10 | A missing AI outline could not be repaired. Target selection during an active trace consumed the click as another old vertex. | Explicit human outline tracing, removal/undo and mode switching pass. New source, PDF page, rotation and applied target changes clear draft/undo/committed geometry; direct Undo cannot resurrect the previous roof. |
| S-11 | A secret-backed runtime lacked a protected deployable preview path. | Pinned non-root Docker service and authenticated loopback-runtime gateway pass local checks. Non-loopback startup requires an origin; trusted forwarded HTTPS is explicit. Public access remains blocked, not accepted as deployed. |

Additional checked corrections:

- Provider responses are bounded to 2 MiB; within-limit original text is exact.
  Oversized text retains at most 250,000 characters plus truncation/length metadata.
- One fresh same-model schema repair keeps the source/contract unchanged and does
  not reveal the first outline to the independent verifier. Budget, cancellation,
  permanent HTTP failures and invalid second responses are tested without paid AI.
- Failed/oversized/timed-out requests retain conservative reservations and report
  unknown billing rather than free usage. The UI separates known subtotal from
  unknown requests and published-rate estimates from reported debit.
- Geographic frames are centered, finite, bounded to 2 km and checked for polar/
  scale distortion. A Florida case agrees with independent WGS84 ECEF distances;
  unsupported frames withhold quantities. This is numerical validation, not field
  accuracy.
- Malformed request URLs return 400; shutting down the runtime aborts remaining
  work and clears maps. Source/PDF decoding failures cannot submit the old image.
- Local PDF parsing disables evaluation/XFA/system-font fallback, bounds file,
  page and render sizes, and requires separate consent for the selected page image.
- The unsupported generic few-percent accuracy claim was removed from the legacy
  footer. Product copy must not contradict the current benchmark evidence.

## Functional evidence and its limits

The supervisor independently ran the server/provider/report contracts and all six
browser test types: image review, cancellation, local PDF import, actual report
output, source restrictions and boundary confirmation. The parent repeats the
complete current source suite before committing; no paid CI credential is needed.

Useful reproduction commands (Node 24; browser dependencies as in CI):

```sh
node --test server/*.test.mjs
node bench/runtime-agents-test.mjs
node bench/ai-report-test.mjs
node tools/dev/ai-ui-test.mjs
node tools/dev/ai-cancel-ui-test.mjs
node tools/dev/pdf-ui-test.mjs
node tools/dev/ai-report-test.mjs
node tools/dev/ai-source-restrictions-test.mjs
node tools/dev/ai-boundary-review-test.mjs
```

Browser fixtures start fresh keyless deterministic backends. Those fixtures do
not establish paid-model accuracy. The test-only managed-proxy TLS exception does
not alter production TLS verification.

The actual live synthetic Docker job completed five schema-valid roles in 34.591
seconds with $0.007834 provider-reported debit. Its outline had no selected target,
and adjudication wrongly assumed an implicit boundary from facets. The geometry
gate overruled that opinion and withheld physical quantities. Five valid role
contracts therefore did not mean five correct geometric decisions. The later
one-call target-selection gate avoids proceeding without an identified target.

A zero-inference replay repaired that saved result through the human canvas flow.
UI and actual PDF agreed on **960.00 ft² projected** and **1,073.31 ft² sloped**.
Authenticated two-page PDF import also passed with all CDNs blocked, correct page
fingerprints and consent/calibration resets, and no browser errors. Separate
missing-outline recovery calculated 2,000 ft² from an analytic user-traced fixture.
These are functional checks using synthetic references, not field validation.

## Deployment and accuracy remain separate

The parent opened and marked the working private shared-cloud browser for review.
Its `http://127.0.0.1:3000` address is internal to that environment, **not a public
preview URL**. The prepared private container and passing local workflow do not
mean Vercel release occurred. The connector requires its specific team-access
authorization; see [private-preview deployment](PRIVATE_PREVIEW_DEPLOYMENT.md).
The production GitHub Pages deployment remains unchanged.

Preserve these limits in every handoff:

- The 3,000-case deterministic study has mixed results, including worse holdout
  area error and fewer combined threshold passes than baseline. Five final
  spatial cases remain unresolved; missing results never count as passes.
- Regional printed-report comparisons are conditional. Strict source/scope/date
  verification remains **zero**, not 30 validated properties.
- Synthetic paid/free vision trials do not demonstrate a universally reliable
  model or independent roof accuracy. Model agreement is not measurement evidence.
- The source-image workspace remains review-only, with no fabricated geographic
  north, true sloped line lengths or purchasing certification.
- Private customer references/images were not submitted in these provider trials.
  Further work must use reproduced defects or newly authorized verified evidence,
  rather than repeat paid calls until a favorable response appears.
