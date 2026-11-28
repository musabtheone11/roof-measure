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
