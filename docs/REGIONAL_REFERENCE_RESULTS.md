# Regional reference comparison — final frozen static engine

These are **conditional differences from printed report quantities**, not verified
accuracy passes. Exact roof configuration, source dates, scope and georeferenced
reference outlines have not all been independently reconciled. There are **zero
strictly verified scope/date comparisons and zero accuracy passes** in this run.
The holdout area median and several line categories worsened; these results do
not support a claim of perfect or generally order-ready automatic measurements.

## Coverage and freezing

Company-authorized reference discovery produced 39 candidate properties: 34 in the
six requested areas and five outside them. The 34 regional inputs cover Jacksonville
(21), Middleburg (5), Orange Park (5), Fleming Island (1), St. Johns (1), and
St. Augustine (1), using postal/community locations. The Jacksonville count includes
one postal-Jacksonville property that Google's locality calls Nocatee; Fleming
Island's Google locality is Orange Park. These community classifications do not
establish that Google selected the correct roof.

The metadata identified 22 independent roof-report candidates in the region and
12 adjuster-scope candidates. Repair/removal/material quantities were not silently
substituted for whole-roof net measurements. Reference transcriptions retain
source pages, units, rounding and unknown fields privately.

All 39 original/final pairs were attempted and their outputs or failures frozen.
For the 37 cases other than the named regressions, this preceded opening the
corresponding reference. The same downloaded Solar inputs
and settings were used for both engines. Nearby addresses within 700 m were kept
in the same connected group. An 11-property regional holdout was fixed from
geocodes before regional measurements or reference quantities were inspected.
The remaining regional inputs are 22 development cases and one named regression;
a second named regression is outside the region. The two named references were
opened after their legitimate earlier freeze, before the final narrow diagonal
guard was applied. Their earlier predictions remain locked and their final reruns
are explicitly nonblind regressions, never part of the holdout.

Frozen split SHA-256:
`bf2881c001c96a66a8f394ca37ef046019d4c17be8ae0fc361559277c143ae63`

The original engine is commit `40d0af2`. Final source hashes are:

| File | SHA-256 |
|---|---|
| autotrace.js | `aa68c71d79657df90376e0acfb9ebb91490cc4267ef29406dad035b35fdc311b` |
| autotrace2.js | `5deb5dff839ad26acf11745ef29f80d9a56569aefb59db3598ba27ea62a17762` |
| obstruction.js | `78a36a9a79aa4e798707870a1ab1e3cbe22d7c53807269c7be17f0acd079b9ea` |
| roofmodel.js | `b577e565ed6559d26e663044b8dfa16ba8cf195fb8ffdf7522ab8369448d1674` |
| bench/appcore.mjs | `890437ec92485fe2c2dacc4ad2f3b82169e0ac5f8f3f3179b08357c10f4fbb28` |

This is the headless automatic tracing pipeline with actual Google inputs, not 39
browser/PDF acceptance runs. The final app's additional source-box selection guard
was evaluated separately against the frozen inputs; one conflicted with the pin
and is excluded from numerical comparisons. Raw predictions remain unchanged.

## Failures and eligibility

There were 31 HIGH and seven MEDIUM source datasets; one input failed. Both engines
produced models for 36 of 39 candidates and 31 of 34 regional candidates. The
original had one input failure and one trace failure. The final had the same input
failure and two trace failures. Failures are missing outputs, not successful freezes
or zero-area measurements. The additional final refusal is not counted as an
accuracy pass.

Two reference files had known address-identity conflicts and one source selection
was rejected by the final app's guard. These are excluded from the quantity
comparison. After those exclusions, there are 20 eligible conditional regional
reference candidates, of which 17 have paired area outputs. The other regional
candidates remain unqualified or lack a comparable frozen output.

## Net sloped area: same paired cases

Percentage differences use the independently printed net area as denominator.
All comparisons retain printed precision and use unrounded engine totals.
Missing outputs are counted separately, never filled with zero.

| Conditional cohort | Paired cases | Original median absolute difference | Final median absolute difference | Original mean absolute difference | Final mean absolute difference |
|---|---:|---:|---:|---:|---:|
| Regional | 17 | 3.57% | 3.37% | 5.93% | 4.45% |
| Regional holdout | 8 | 3.15% | **3.81%** | 5.85% | 5.28% |
| Regional development | 8 | 4.55% | 3.53% | 5.17% | 3.87% |

Among the 20 eligible regional reference candidates, area output was missing for
two original runs and three final runs. Among nine eligible holdout reference
candidates, original area output was missing for zero and final output for one.
The other two holdout cases lack a qualified independent whole-roof reference.

## Pitch, facets and line schedules

These category comparisons are also conditional on exact structure and compatible
provider definitions. A category absent from a run is missing, not verified zero.
Zero-valued printed references are excluded from percentage denominators; absolute
unit differences remain available privately. Different row counts are disclosed.

| Quantity | Paired numeric cases | Original median absolute percentage difference | Final median absolute percentage difference |
|---|---:|---:|---:|
| Facet count | 17 | 18.18% | **22.22%** |
| Eave | 17 | 12.90% | 11.13% |
| Rake | 14 | 27.79% | 15.28% |
| Hip | 13 | 15.07% | 12.50% |
| Ridge | 17 | 19.44% | 16.74% |
| Valley | 16 | 14.16% | **17.38%** |
| Wall flashing | 7 | 59.85% | **60.68%** |
| Step flashing | 16 | 60.76% | 57.04% |
| Transition | 5 | 55.79% | **128.17%** |

Predominant-pitch mean absolute difference was 0.059 units of rise/12 for both
engines on 17 paired cases. Parapet and unspecified categories had no paired
numeric outputs; they are not reported as passes. Independent outline alignment
was not completed, so equal total area cannot establish a correct outline.
Regional false-COMPLETE exports were not browser-tested and are not assigned an
invented zero failure rate. These automatic jobs still require evidence review.

## Reproduction and privacy

Downloaded source rasters, property addresses, references, source aerials,
predictions, schedules, per-case hashes, extraction timestamps and detailed scores
remain under ignored `bench/private/discovered-refs/` and `bench/private/cache/`.
The main private manifests are `runs/regional-split.json`, `runs/freeze-index.json`,
`runs/automatic-freeze-aggregate.json`, `runs/selection-qualification.json`, and
`runs/conditional-scores-private.json`. Per-case source aerials were rendered from
the frozen RGB arrays without modifying the predictions.

No property image, address, independent reference or property benchmark artifact
was sent to APInex or committed. APInex reviewed sanitized concepts and synthetic
fixtures. A separate APInex-assisted property engine was not run or scored.
