# Regional benchmark: aggregate results

Run `orig-blind`, code {"commit":null,"appHash":"engine:bench/engines/base","dirty":null}. 15 properties.
No approved tolerances exist: differences are shown, nothing is called a pass. "Not scored" = the reference does not print the value. Values the run did not produce are counted as missing, never as zero.

Aggregates only: the property-by-property table, addresses and reference documents stay in the private folder (bench/private/regional/score-<label>.md).

## By roof type

| Roof type | Properties | Complete / review required / failed | Area: median abs. diff % (n scored) | Area: median signed % | Pitch: median abs. diff (n) | Facets: median run - ref (n) | Edge ft missing / extra (sum over scored types) | Values missing from runs | Release blockers |
|---|---|---|---|---|---|---|---|---|---|
| cross-gable / multi-hip | 6 | 83% / 0% / 17% | 6.9 (5) | -6.9 | 0.0 (5) | 0.0 (5) | 469 / 322 | 10 | 0 |
| simple gable/hip | 3 | 100% / 0% / 0% | 11.3 (3) | -11.3 | 0.0 (3) | -1.0 (3) | 628 / 107 | 0 | 0 |
| complex | 6 | 100% / 0% / 0% | 4.4 (6) | +1.2 | 0.0 (6) | -4.5 (6) | 1,406 / 522 | 0 | 0 |

## By obstruction level

| Obstruction | Properties | Complete / review required / failed | Area: median abs. diff % (n scored) | Area: median signed % | Pitch: median abs. diff (n) | Facets: median run - ref (n) | Edge ft missing / extra (sum over scored types) | Values missing from runs | Release blockers |
|---|---|---|---|---|---|---|---|---|---|
| heavy canopy | 5 | 100% / 0% / 0% | 13.7 (5) | -13.7 | 0.0 (5) | 0.0 (5) | 1,017 / 367 | 0 | 0 |
| clear | 4 | 100% / 0% / 0% | 5.9 (4) | +5.9 | 0.0 (4) | -3.5 (4) | 396 / 245 | 0 | 0 |
| unknown | 1 | 0% / 0% / 100% | - (0) | - | - (0) | - (0) | 0 / 0 | 10 | 0 |
| partial tree cover | 5 | 100% / 0% / 0% | 2.7 (5) | -1.9 | 0.0 (5) | +1.0 (5) | 1,089 / 339 | 0 | 0 |

## By town

| Town | Properties | Complete / review required / failed | Area: median abs. diff % (n scored) | Area: median signed % | Pitch: median abs. diff (n) | Facets: median run - ref (n) | Edge ft missing / extra (sum over scored types) | Values missing from runs | Release blockers |
|---|---|---|---|---|---|---|---|---|---|
| other towns (one property each) | 4 | 100% / 0% / 0% | 12.9 (4) | -12.9 | 0.0 (4) | -1.0 (4) | 855 / 288 | 0 | 0 |
| Jacksonville | 5 | 100% / 0% / 0% | 3.2 (5) | -0.2 | 0.0 (5) | 0.0 (5) | 503 / 306 | 0 | 0 |
| Fleming Island / Orange Park | 2 | 100% / 0% / 0% | 6.8 (2) | +6.8 | 0.0 (2) | -8.0 (2) | 284 / 245 | 0 | 0 |
| St. Augustine | 2 | 50% / 0% / 50% | 1.9 (1) | -1.9 | 0.0 (1) | -3.0 (1) | 297 / 49 | 10 | 0 |
| Middleburg | 2 | 100% / 0% / 0% | 25.7 (2) | -25.7 | 0.5 (2) | -3.5 (2) | 563 / 62 | 0 | 0 |
