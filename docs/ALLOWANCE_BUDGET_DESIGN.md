# Subscription allowance and wallet budgets

Design reviewed on 2026-11-28. The operator authorized use of the existing APINEX
subscription allowance. Live account reads confirmed eligibility; account totals,
identifiers and credentials remain outside Git and public status.

APINEX wallet credits and weighted subscription allowance are separate currencies.
The existing $20 rolling-week wallet cap remains. Free-prefixed models require
verified zero-dollar pricing and current subscription eligibility; paid fallback,
automatic purchases and renewals are not part of this change.

## Admission and persistence

1. Read the fixed authenticated subscription endpoint without redirects. Validate
   allowed access, required subscription mode, finite remaining units or explicit
   unlimited eligibility, expiry and reset metadata. A cached observation lasts
   at most 60 seconds; model-provided context cannot supply it.
2. Reserve a full published input window plus a full output window, multiplied
   by the verified weight. Historical provider usage exceeded requested output
   limits, so the requested token count cannot serve as a billing bound. Free
   Nano reserves its published five million units.
3. Atomically associate the allowance reservation with the existing fenced attempt
   and USD reservation. Enforce 100 million units per workflow, 250 million per
   rolling day and one billion per rolling week, plus the live provider allowance.
4. Exact reported allowance debit may settle the reservation. A calculated usage
   estimate is recorded separately and does not release an unknown hold. Unknown
   dispatched usage survives restart and provider reset; undispatched work releases
   its reservation on cancellation or recovery. Breaches stop further admission.
5. Preserve all historic USD rows. Backfill prior free dispatches with conservative
   weighted holds using exact model/event/catalog evidence before admitting new
   free work. Permanent errors and paid ambiguity retain their existing circuits.
   A fresh free evaluation may proceed after this reconciliation; an old dispatched
   task is never replayed or relabeled successful.

## Review and verification

The store owner implements atomic accounting and recovery; the allowance adapter
owner implements endpoint validation and image integration; the supervisor owns
text/fleet integration. An independent reviewer checks their combined work.

Tests must cover currency separation, subscription expiry and stale observations,
weighted admission, concurrent reservations, estimate versus reported debit,
restart/cancellation/reset behavior, legacy backfill and immutable prior USD rows.
The first live qualification is bounded and useful, with durable dispatch evidence;
it must not spend tokens merely to increase a usage counter. Model proposals remain
subject to independent numerical, report and release checks.

The manual `allowance-qualification` operation selects exact free routes for Luna,
Qwen and MiniMax, with at most six requests, zero wallet-dollar reservation and no
image generation. It runs the actual synthetic-report evaluation and independent
specialist handoffs. Its scoped artifact does not replace the public journal's
full-roster status. Scheduled full-roster cycles keep their existing mode.

Deployment uses the existing reviewed runtime source pin and shared checkpoint.
Rollback preserves both ledgers and pauses new allowance-funded dispatch until a
compatible accounting implementation is active.
