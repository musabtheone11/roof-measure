# APINEX API verification and runtime model evaluation

Checked November 25, 2026. These are observed capabilities and published claims,
not claims of validated aerial-roof measurement accuracy.

## Official sources

The user provided [Models & pricing](https://apinex.bond/models). The linked
machine-readable sources were fetched directly:

- [Claude Opus 5.5 datasheet](https://apinex.bond/models/claude-opus-5-5/llms.txt)
- [GPT 6.2 Astra datasheet](https://apinex.bond/models/gpt-6-2-astra/llms.txt)
- [Chat Completions reference](https://apinex.bond/developers/models/chat.md)
- [Token billing](https://apinex.bond/developers/models/billing.md)
- [Errors and rate limits](https://apinex.bond/developers/errors.md)
- [Pricing table](https://apinex.bond/pricing.md)

Both selected datasheets publish vision support, a 1M-token context and $0.50 per
million input tokens and $0.50 per million output tokens. The authenticated
`GET https://api.apinex.bond/v1/models` returned the exact IDs
`claude-opus-5.5` and `gpt-6.2-astra`; only returned IDs were used. The website's
headline model count differs from the authenticated roster, so it is not used as
an availability guarantee.

Real requests used `POST https://api.apinex.bond/v1/chat/completions`, Bearer
authentication, `model`, `messages`, content-part image data URLs and bounded
`max_tokens`. Keys came only from the process environment. No customer imagery,
address, report, or benchmark reference was submitted to this evaluation.

The documentation says extra OpenAI fields are generally forwarded and may be
ignored. It does not guarantee JSON-schema enforcement. A live known-answer
trial with `response_format: {type: "json_object"}` returned HTTP 200 and the
requested exact JSON object from both models. This establishes compatibility
for that request only; the application still parses and validates every output
against its own strict role contract. Plain JSON instructions alone failed with
Opus markdown fences in the initial vision trials; those responses were rejected,
not silently repaired or counted as passes.

The benchmark defaults to at most eight paid calls and a $0.25 observed-cost
stop, with no retries. `RUNTIME_VISION_MAX_REQUESTS` (1–20) and
`RUNTIME_VISION_BUDGET_USD` (up to $1) explicitly configure those limits.
The dollar stop uses reported usage after a response and is not a provider-side
hard spending cap; unknown billing cannot establish a dollar guarantee.

RPM is account-wide in a fixed 60-second window. The published page contains
unresolved placeholders for plan-specific values; no specific account RPM is
claimed. Runtime code must honor observed 429/Retry-After behavior and bounded
retries rather than assuming a paid tier. Response `usage.cost_tokens` is the
provider's reported debit in millionths of a dollar for paid models. Costs derived
from published rates are estimates when that field is absent. Unreported costs
are unknown, not free. No balance or payment operation was performed.

## Synthetic candidate vision benchmark

Reproduction (Node 24 behind a managed HTTP proxy):

```sh
node --use-env-proxy tools/dev/runtime-vision-benchmark.mjs .devcache/runtime-vision
RUNTIME_JSON_MODE=1 node --use-env-proxy tools/dev/runtime-vision-benchmark.mjs .devcache/runtime-vision-json-mode
```

The committed manifest fixes four analytic synthetic images: a simple roof with
shadow, attached complex wings, a tree-obstructed low-resolution roof, and an
oblique quadrilateral. The latter two were preassigned to evaluation; they are
not human-reviewed real roofs. Geometry was generated from known pixel polygons.
No physical scale or pitch is assigned to these images. Outline IoU and symmetric
sampled boundary distances are pixel diagnostics; physical area/length accuracy,
roof-plane topology and edge classification are not evaluated by this outline
trial. Missing measurements do not count as passes.

The diagnostic thresholds (IoU >= 0.95 and mean boundary distance <= 3 pixels) were
written in the fixture manifest before the calls. They are useful synthetic
checks, not customer-approved field tolerances or a basis for COMPLETE status.

Initial plain-JSON prompt results:

| Case | Opus 5.5 | Astra 6.2 IoU | Astra mean / max boundary pixels |
|---|---|---:|---:|
| Simple roof + shadow | Schema failure (fenced JSON) | 0.63123 | 30.726 / 118.951 |
| Attached wings | Schema failure (fenced JSON) | 0.993324 | 0.500 / 1.414 |
| Tree + low resolution | Schema failure (fenced JSON) | 0.901563 | 8.464 / 97.059 |
| Oblique | Schema failure (fenced JSON) | 0.994032 | 0.443 / 1.000 |

All eight returned HTTP responses, with individual latency 3.653–10.738 seconds.
Provider-reported paid debit summed to $0.011094, including invalid-schema outputs.
Two separate tiny JSON-mode known-answer trials reported another $0.001568.
These values are observed for this run, not price or latency guarantees. The
simple shadow failure is substantive: Astra treated the shadowed region as a
separate/unknown boundary. Its unresolved status is retained. High oblique pixel
IoU does not permit physical measurement from perspective imagery.

A subsequent paired run uses the observed JSON-object option with unchanged
images and prompts. Initial failures remain preserved as the protocol baseline.
Because evaluation images had already been inspected before this protocol change,
repeat results are not an untouched blind holdout. Final JSON-mode outcomes are
recorded in the delivery artifact alongside all original responses and usage.

JSON-object repeat results (same fixtures, not a new blind sample):

| Case | Opus IoU; mean / max boundary px | Astra IoU; mean / max boundary px |
|---|---|---|
| Simple roof + shadow | Schema failure (still fenced JSON) | 0.632820; 30.567 / 118.808 |
| Attached wings | 0.995763; 0.317 / 5.000 | 0.993324; 0.500 / 1.414 |
| Tree + low resolution | 0.951127; 4.008 / 10.198 | 0.841654; 12.631 / 124.615 |
| Oblique | 0.956341; 3.312 / 8.243 | 0.994032; 0.443 / 1.000 |

The repeat returned eight HTTP 200 responses, seven schema-valid proposals, and
one strict rejection. Latencies were 4.647–10.918 seconds; reported debit was
$0.011812. Across both fixture runs and two tiny format trials, 18 paid requests
reported $0.024474 total. An observed rate-limit response header was 30 with
remaining counts changing across calls; this is an observation, not a guaranteed
account-wide entitlement. There were no observed HTTP 429 responses.

Only the attached-wings case met both diagnostic thresholds for either model in
the repeat. Obstructed and oblique cases are scored descriptively and excluded
from threshold eligibility. Opus format coverage improved from 0/4 to 3/4 with
JSON mode, demonstrating why accepting that field cannot replace validation.
Astra also changed its visible-area interpretation under tree obstruction;
these limited examples support mandatory review, not automatic completion.

These results do not demonstrate a universally reliable default vision model.
The runtime uses role-specific strict validation and independent proposals, keeps
inferred/unresolved status, and requests human correction for disagreements.
Model agreement on one image is not independent measurement evidence.

Raw artifacts remain outside Git at `roof-delivery/runtime-vision/` and
`roof-delivery/runtime-vision-json-mode/`. The much larger existing deterministic
trace and real-property reference comparisons are separate studies documented
in `PLAN_FIRST_VALIDATION.md`; their scores cannot be attributed to this new
vision-only outline trial.

## Free model verification after supplied catalog screenshots

All fifteen IDs shown in the supplied free/subscription screenshots appeared in
this key's authenticated model roster. Listing is not proof of subscription
entitlement. No subscription, balance, or account configuration was changed.
The official [pricing table](https://apinex.bond/pricing.md) says free models
consume a separate weighted daily allowance and never touch the wallet.
Exact free datasheets are linked from the catalog with a `free-` prefix; their
claims apply to the exact IDs rather than similarly named paid models.

| Exact model | Official free datasheet | Vision claim | Allowance weight |
|---|---|---|---|
| `free/gemini-4-hydrogen` | [source](https://apinex.bond/models/free-gemini-4-hydrogen/llms.txt) | Yes | 5x |
| `free/gpt-6-luna` | [source](https://apinex.bond/models/free-gpt-6-luna/llms.txt) | Yes | 3x |
| `free/deepseek-v4.1-flash` | [source](https://apinex.bond/models/free-deepseek-v4-1-flash/llms.txt) | Yes | 3x |
| `free/glm-5.3-flash` | [source](https://apinex.bond/models/free-glm-5-3-flash/llms.txt) | Yes | 3x |
| `free/glm-5.3-flashx` | [source](https://apinex.bond/models/free-glm-5-3-flashx/llms.txt) | Yes | 3x |
| `free/qwen-3.8-max` | [source](https://apinex.bond/models/free-qwen-3-8-max/llms.txt) | Yes | 3x |
| `free/minimax-m3.1-flash` | [source](https://apinex.bond/models/free-minimax-m3-1-flash/llms.txt) | Yes | 3x |
| `free/deepseek-v4-pro-0813` | [source](https://apinex.bond/models/free-deepseek-v4-pro-0813/llms.txt) | No | 3x |
| `free/deepseek-v4-flash-0731` | [source](https://apinex.bond/models/free-deepseek-v4-flash-0731/llms.txt) | No | 3x |

All these free datasheets publish $0.00/1M tokens. That does not imply unlimited
requests or eliminate allowance exhaustion. Paid-model sale screenshots are
separate from free-tier routing; the earlier published paid rates and actual
`cost_tokens` observations remain preserved. No new paid calls were needed to
assume or verify a discount.

A bounded sequential compatibility screen sends only the same synthetic attached
wings PNG, with the unchanged outline prompt and JSON-object option. This is one
known example, not a holdout accuracy benchmark or validation of a runtime role.
The paid baseline remains intact. Results and original responses are stored at
`roof-delivery/runtime-free-vision/results.json`; roster and extracted official
free datasheet claims are stored alongside it. Calls stop on HTTP 429 without
retrying; Retry-After headers are retained for diagnosis.
