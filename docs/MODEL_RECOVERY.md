# Recovering useful subscription work

The public snapshot from run `46105854684` used source `2176b631`. Its 51 rows
contained seven complete assignments, eleven other validated contributions
requiring review, 27 blocked rows and six failures. Thus seven lifecycle
completions did not mean only seven models had produced valid contributions.

The later three-model trial `46155095664` returned one valid Qwen proposal and
two timeouts, with no additional dollar spend recorded. That scoped experiment
was retained separately and did not replace the full-catalog snapshot.

## Confirmed failures and recovery candidates

- Twenty subscription rows were blocked by earlier timeout/billing circuit
  records in the older snapshot. Fresh, distinct evaluations can use verified
  allowance while every old request and conservative hold remains preserved.
- Non-streamed calls were capped at 45 seconds. Exact model datasheets and
  official APINEX streaming guides document SSE; the new adapter verifies
  identity, complete text, terminal finish reason and completion marker, with
  bounded byte counts and absolute deadlines. A single JSON response to a stream
  request is handled without resubmitting the POST.
- Several responses exhausted output limits before their JSON was complete.
  Subscription roles now have an 8,000-token request budget and 120-second
  deadline. This is a qualification candidate, not a claim that every provider
  honors its limits. Incomplete output still fails validation.
- The original free Drex HTTP 400 has no retained error body, so its cause is
  unknown. Its exact datasheet documents minimal plain chat, not the structured
  role envelope or paid Decisions API. One separately versioned candidate uses
  only documented request fields and validates an original literal routing label.
  Its atomic dispatch marker prevents another exception after timeout or invalid
  output. Authentication, entitlement, identity and new-protocol errors remain
  blocked; the original error and hold are never erased.

## Status and evaluation

The dashboard separates validated contributions, review needs, execution
failures and blocked work. All cards identify the dated full snapshot. New
subscription results use `latest-qualification.json` with exact source/run
provenance and selection counts; they do not imply refreshed paid/image evidence.
The public journals omit account balances, quota snapshots, prompts and keys.

The broad subscription evaluation uses actual generated report observations,
independent analytic diagnostics and exact metric grounding. Each contribution
still requires a different qualified reviewer. Neither model agreement nor a
format-valid proposal establishes field measurement accuracy or release approval.

The allowance budget remains independent of the unchanged $20 rolling-week
wallet cap. All outstanding allowance holds reduce provider availability. The
500-million-unit workflow and one-billion-unit day/week limits permit a broad
bounded wave; idle model calls, paid substitutions and automatic purchases are
not part of this recovery.

## Hosted recovery result — 2026-11-28

[Run 46159095870](https://github.com/musabtheone11/roof-measure/actions/runs/46159095870)
checked source `ef1155c4d750eecef4777b5b63038e82ab602b14`:
23 selected subscription IDs, 23 attempted, 20 validated primary contributions,
19 completed independent reviews. The three failures remain explicit:

- `free/drex-v2.0`: HTTP 400 specifically directs this ID to `/v1/decisions`,
  contradicting its plain-chat datasheet. The one-shot chat protocol is not
  qualified and must not be replayed. A separately bound typed-decision route
  would require a new capability test; no engineering/review credit follows.
- `free/gemini-4-hydrogen`: terminal `length` after 8,000 completion tokens;
  visible JSON is incomplete despite a complete SSE transport.
- `free/hy4-flash`: finished JSON placed long draft instructions into the
  bounded `reportArtifact` reference field. The strict report contract rejected it.

There were 26 new inference dispatches including closing reviews, zero additional
wallet dollars recorded, and 149,166,080 additional conservative allowance units
held. These holds are not a claim of consumed units. Every prior 85 dollar-ledger
row and 31 allowance-ledger row remained byte-for-byte unchanged. No old unknown
request was refunded, replayed or relabeled successful.

The earlier full snapshot's 18 validated model IDs and this wave's 20 IDs have
no overlap: 38 unique models have contributed across those separately dated runs.
This historical union is not a simultaneous service-health or field-accuracy claim.

Productive follow-up work is described in [CLOUD_CASE_WORK.md](CLOUD_CASE_WORK.md).

The reporting prompt now explicitly requires an existing supplied artifact
reference (at most 200 characters) or null, keeps draft wording in summary and
findings, and forbids inventing UI control names. This clarifies the observed
HY4 failure without weakening validation. It is not a successful HY4 recovery
claim; a later distinct qualification must demonstrate compliance.

## Targeted route and output recovery

The manual `allowance-recovery` operation selects exactly free Drex, Gemini
Hydrogen and HY4 Flash. It uses one existing development counterexample, preserves
the catalog's operations/verification/reporting roles, and defers primary peer
review so a compact capability test is not expanded by an earlier answer.
Closing reviews remain independent and bounded. Limits are six calls, fifteen
minutes, zero wallet reservation, and the same restored global allowance ledger.

The free Drex Decisions candidate requires a content-addressed proof derived from
the actual failed, dispatched HTTP 400 task directing that exact ID to
`/v1/decisions`. Its new typed protocol has one atomic migration probe; old chat
circuits and holds remain. Authentication, entitlement, identity or new-protocol
failures cannot use that exception. A completed host-grounded typed routing
response is a routing contribution, never engineering JSON, a peer review or
release approval. Timeout, cancellation or failed fencing cannot qualify it.

The targeted results use `latest-recovery.json`, separate from the 23-model
qualification, full-roster and productive-work journals. The exact run/source
and original artifacts are required before any candidate can be described as
recovered. This protocol description alone does not claim successful recovery.
