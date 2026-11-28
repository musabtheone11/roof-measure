# Prospective documented allowance calculations

## Evidence and problem

The verified 23-model recovery and case-work runs retain 438,623,872 conservative
weighted units. Many completed responses contain complete token telemetry, but
an undocumented direct allowance-debit field is absent. Treating every such
response as wholly unknown eventually prevents useful work despite funded quota.
These reservations are not measured consumption.

APINEX's official billing reference publishes
`allowance_tokens = ceil((input_tokens + output_tokens) * weight)` and maps the
standard chat `prompt_tokens` and `completion_tokens` to those quantities. The
reference also says usage can be absent. Sources:

- https://apinex.bond/developers/models/billing.md — SHA256
  `dc475aa8b904365aaf50afb7c812d8e7fc64740f31871f135de04b9097295dc9`.
- https://apinex.bond/developers/models/chat.md — SHA256
  `ec134da258a96e74616024329587bc0af42310035e36b75c6265ac4fd9ed42c7`.

No per-request allowance ledger API or documented bonus-versus-subscription
allocation order was found. The screenshot's 493.40M bonus is not added to the
subscription admission snapshot or assumed usable on every model.

## Reviewed prospective policy

1. Apply only to NEW, explicitly opted-in RESERVATIONS. Stamp eligibility atomically when the new attempt is reserved; every existing 75-row allowance record is permanently ineligible for this policy. Do not backfill, refund or alter any existing
   task, dollar row, allowance row, circuit, event or ambiguous request.
2. Continue reserving the complete conservative weighted window before dispatch.
   The existing workflow/day/week ceilings and $20 rolling-week wallet cap remain.
3. Opt in for free text chat calls only. Obtain a fresh, fixed-endpoint public
   catalog quote identifying the exact free model, zero dollar price, context
   bound and current positive integer weight no greater than our published bound.
   Bind its raw artifact hash, model and verified weight at reservation. Require that same weight and a quote age of at most 60 seconds at durable dispatch, not a cheaper quote first observed after response. Missing or invalid quotes merely
   preserve the full hold; they never invent a zero charge or authorize a paid route. Affirmative parsed evidence of a dollar charge, increased weight beyond our bound or enlarged context blocks dispatch.
4. Require complete HTTP/stream transport, exact requested/returned identity,
   nonnegative safe integer prompt AND completion counts and a consistent total.
   Reject conflicting input/output aliases or impossible nested token detail.
   Do not add nested reasoning/cache counts a second time. Missing, partial,
   contradictory or unsupported telemetry retains the original full hold.
5. Calculate integer units from documented standard chat counts and verified
   quote weight. Label them **documented-calculated allowance units**, distinct
   from a directly reported allowance debit. Retain original raw usage, response
   identity, quote/hash, formula version/document hash and calculation proof.
   Never use undocumented usage.allowance_tokens as authoritative evidence.
6. Preserve raw response/usage evidence before releasing any reservation. Model
   prose validity is separate from billing: a fully received length-limited
   response can have known usage, while timeout/partial/mismatched transport cannot.
7. Add append-only authorization and calculation tables/artifacts; the store independently reads their durable raw response and quote artifacts, binds attempt/task/model/protocol and recomputes integer units rather than trusting a caller-supplied charge. No authorization can be retroactively created for an existing attempt. keep existing attempt-row shape.
   Under the existing fenced settlement transaction, NEW allowance rows can move
   to settled with charged_units equal to the validated calculation, while
   reported_units remains null. Original reserved_units never changes. A charge
   above its reservation raises an allowance incident and stops new admissions.
8. Existing snapshot freshness/concurrency checks must still count settlements
   newer than a reused provider snapshot. Neither calculated usage nor a zero
   wallet fee permits replaying an ambiguous request.
9. Private aggregates distinguish calculated totals and unknown holds. Public
   journals continue to omit quota, account, quote and balance details.

## Acceptance and rollout

Independent design review precedes code. Implement calculation/quote validation,
provider evidence ordering, store atomicity and private aggregate handoff. Test
missing/contradictory telemetry, stale quotes, forged proof, overflow, zero counts,
reservation breach, cancellation, cross-connection admission and original-row
preservation. Keep other transports and image/typed protocols unchanged.

Deploy a reviewed immutable runtime through the existing workflow. Restore the
latest completed checkpoint, run a bounded real case batch (manual work_items=2 for this verification; scheduled default stays8) and independently
verify at least one documented calculation against original token telemetry,
quote and formula. Compare all preexisting rows unchanged, retain unknown holds,
verify no dollar increase, inspect the public dashboard and preserve every other scoped
journal and retain the earlier run artifacts. Roll back the source pin on failure; never reset the shared ledger.

## Reviewed interface and ownership

Independent review approved the policy with the reservation cutover, durable raw
proof, exact pre-dispatch quote and affirmative-pricing-change guards above.
Implementation agents remain distinct from APINEX runtime workers.

- Provider/calculation owner: new `allowance-calculation.mjs` and tests, provider,
  allowance helpers and provider tests. Quote artifact:
  `{schemaVersion:1,policy,sourceUrl,observedAt,body,bodySha256}` containing the
  original bounded public catalog JSON text, with no account authorization data.
- Store owner: store and tests. Reserve adds optional
  `allowanceCalculationReservation:{policy,model,weight,quoteArtifactHash}`.
  It creates a new authorization row atomically with the NEW attempt only.
- Settlement adds optional
  `allowanceCalculation:{policy,quoteArtifactHash,responseArtifactHash}`;
  no caller-provided calculated charge is accepted. Shared validators load and
  validate the quote and response objects, then the store computes charge units.
- Opt-in raw response artifact includes host
  `attemptBinding:{attemptId,taskId,model,protocol:'chat/completions'}`,
  original usage/content/execution and exact identity/complete-transport evidence.
  The host callback returns the durable artifact hash before settlement.
- Root owns fleet/case-work/controller wiring, private aggregates and deployment.
  The public quote verifier is optional calculation preflight; malformed or
  unavailable quotes preserve old accounting, while affirmative pricing changes
  stop the request. Other callers keep their existing default until opted in.

No implementation may begin before the design review; that review is now complete.
