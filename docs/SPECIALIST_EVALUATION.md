# Reproducing the API NEX engineering sweep

The engineering sweep runs on the server operator's machine. It uses a separate job directory and fixed synthetic inputs. Production roof analysis continues to use the model selection in `server/agents.mjs`. The current matrix and individual responses are in [the capability matrix](evaluation/specialist-matrix.md) and [the sanitized execution ledger](evaluation/specialist-evidence.json).

## Inputs and validation

`tools/dev/specialist_cases.py` pairs the 53 requested endpoints with distinct engineering assignments. The runner reads the provider's authenticated roster every time. Newly listed IDs need a retrievable model-specific datasheet and known prices before dispatch. The catalog join uses exact IDs. The source references, input digest, case ID, assigned model, response digest, reported request/model ID, status, latency, usage and local validation are recorded for each task when available. The common oracle and role-specific answer stay out of the prompt. An author and a challenger receive separate HTTP requests with independent message histories. Each accepted proposal still needs an engineering reproduction or independent measurement before adoption.

The synthetic image is the existing development fixture `tools/dev/fixtures/runtime-vision/simple-gable.png`. The vision probe checks the location of a smaller detached rectangle. JSON object mode is validated locally. A separate forced function-call probe inspects the returned name and arguments. No returned tool call is executed. The typed Decisions request is used only for listed IDs with a defined role and known response contract. One successful synthetic case establishes a narrow capability observation. It leaves repeatability, difficult-roof performance and commercial measurement accuracy open.

## Commands

Use Python 3.11+ from the checkout root with `APINEX_API_KEY` already supplied securely. The default root is `https://api.apinex.bond/v1`. An explicitly set `APINEX_BASE_URL` is retained. Use the endpoint associated with the credential. The runner refuses HTTP, credentials in URLs and redirects.

```sh
python tools/dev/test_specialist_sweep.py
python tools/dev/specialist_sweep.py plan .devcache/engineering-sweep
python tools/dev/specialist_sweep.py free .devcache/engineering-sweep
python tools/dev/specialist_sweep.py free .devcache/engineering-sweep --all-probes
python tools/dev/specialist_sweep.py paid .devcache/engineering-sweep --usd "$AUTHORIZED_TOTAL_USD"
python tools/dev/specialist_report.py .devcache/engineering-sweep docs/evaluation
```

The first free pass schedules one role task per listed zero-dollar ID plus two probes on Qwen. The broader option exercises each positively advertised capability on eligible IDs with a successful assignment HTTP response. A JSON schema failure on that assignment remains visible. Paid dispatch requires an explicit total ceiling. The run directory pins that ceiling, source revision, and fixture bank. The operator must retain it on restart. A fresh directory starts a new evaluation and can incur a second charge.

An OS file lock serializes workers sharing the directory. Before each POST, the runner persists the task ID, request digest, limits and a reservation. Ctrl+C stops the sweep. A started request with an ambiguous outcome retains its reservation and cannot replay in this job. A second invocation completes previously undispatched tasks. One attempt is made per task. A 429 stops the sweep and records the earliest resume time using Retry-After. Authentication failure stops all dispatch, and a paid 402 stops paid dispatch. The job uses one outstanding request and the smaller reported account RPM. The per-request timeout is 45 seconds and the default dispatch window is 20 minutes. Coordinate independent jobs that share the account.

The reusable runner also pins a lifetime dispatch count, applies a one-hour cumulative dispatch-time allowance across resumptions, and rejects duplicate JSON keys. The initial study retained sanitized parsed proposals and response-body hashes. Historic responses cannot be re-parsed for duplicate keys from a hash alone.

The original wall-clock timer recorded one 1,310.005-second interval on the free Sonnet assignment. A host interruption occurred during that part of the run. The source of the time difference cannot be isolated. The matrix retains the outlier, which is unsuitable for a provider-latency claim. The runner now uses a monotonic elapsed timer and a whole-request deadline in addition to socket timeouts. On ambiguous transport failure it persists unknown billing and stops further dispatch in that invocation.

Paid reservations use the full published context window at the higher current input/output rate plus the configured output allowance. The ledger releases a paid reservation only against a reported debit. Model output can contain hidden reasoning tokens. Some observed responses exceeded the requested output size in their reported completion token count. Bounded response bytes and schema checks independently constrain the application result. The explicit USD cap and the provider's current balance are independent checks. Unknown billing remains unknown.

Free requests require a free-prefixed ID and zero input/output rates. Subscription state comes from `GET /subscription`. New runs check the remaining weighted allowance against the full context plus requested output, multiplied by the model weight. Observed total token counts permit an estimate of free units used. The provider enforces the actual account allowance. Account balances, account identifiers and raw provider error messages stay outside published reports.

## Catalog and budget evidence

On the initial read the public models HTML said 53, the machine-readable reference heading said 46, and both the public JSON and this account's authenticated response returned 44 exact IDs. The authenticated balance response reported 30 RPM while the roster header reported 60. The existing subscription was permitted with a finite remaining allowance. There was an active wallet reservation. Public page counts, a positive spendable balance, and roster membership each supply different evidence. Subscription-only entries that respond successfully are recorded per ID. [Catalog](https://apinex.bond/models) · [Machine-readable reference](https://apinex.bond/llms-full.txt) · [Live JSON](https://apinex.bond/api/public/models) · [Balance and subscription](https://apinex.bond/developers/balance)

One role task for each of the initial 22 listed paid models has a conservative sum of full reservations of $6.065296. The illustrative charge at 8,000 input and 900 output tokens per task is $0.053389. Adding each advertised vision and tool capability for those IDs takes the aggregate full-reservation sum to $17.896290 and the illustrative charge to $0.156452. Sequential requests can release a reservation after a known debit. The actual charge depends on the response, and every dispatch must fit within the same authorized ceiling. Stored catalog snapshots identify the rates used in this estimate. [Billing](https://apinex.bond/developers/models/billing) · [Typed Decisions](https://apinex.bond/developers/models/decisions)

The handoff's earlier API trials are separate historical observations. Their tasks, failures, and costs remain in [API verification](API_VERIFICATION.md) and [the prior specialist review](APINEX_REVIEW.md).

## Independently checked proposals

- `free/gemini-4-hydrogen` proposed a wrong-building test where a garage appears in the mask while the intended roof is missing. Running `node --test --test-name-pattern "provider centre" bench/target-intent-test.mjs` confirmed that the target-selection entry point rejects the synthetic substitute building.
- `free/gpt-6-luna` flagged a partial subtotal being printed as a whole-roof result. `free/glm-5.3-flashx` proposed rejection of asserted physical area on an uncalibrated input. Running `node bench/ai-report-test.mjs` checked withholding and reconciliation on independent report fixtures.
- `free/minimax-m3.1-flash` proposed holding an interrupted dispatch until its provider outcome is known. The offline sweep regression injects a timeout after recording dispatch, reopens the persisted job, and verifies a single provider call and unknown billing.

These tests exercise specific code paths. Other proposals in the ledger are candidates for review. None of the role or capability results changes who may approve a customer measurement.
