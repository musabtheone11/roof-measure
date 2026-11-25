# Regional benchmark: aggregate results

Run `orig-dev`, code {"commit":null,"appHash":"engine:bench/engines/base","dirty":null}. 28 properties.
No approved tolerances exist: differences are shown, nothing is called a pass. "Not scored" = the reference does not print the value. Values the run did not produce are counted as missing, never as zero.

Aggregates only: the property-by-property table, addresses and reference documents stay in the private folder (bench/private/regional/score-<label>.md).

## By roof type

| Roof type | Properties | Complete / review required / failed | Area: median abs. diff % (n scored) | Area: median signed % | Pitch: median abs. diff (n) | Facets: median run - ref (n) | Edge ft missing / extra (sum over scored types) | Values missing from runs | Release blockers |
|---|---|---|---|---|---|---|---|---|---|
| simple gable/hip | 4 | 75% / 0% / 25% | 23.4 (3) | -23.4 | 0.0 (3) | -1.0 (3) | 334 / 246 | 11 | 0 |
| unknown (no reference) | 2 | 100% / 0% / 0% | - (0) | - | - (0) | - (0) | 0 / 0 | 0 | 0 |
| cross-gable / multi-hip | 10 | 90% / 0% / 10% | 6.9 (9) | -1.7 | 0.0 (9) | 0.0 (9) | 915 / 698 | 11 | 0 |
| complex | 12 | 100% / 0% / 0% | 5.5 (12) | +3.1 | 0.0 (12) | -8.5 (12) | 2,716 / 981 | 0 | 1 |

## By obstruction level

| Obstruction | Properties | Complete / review required / failed | Area: median abs. diff % (n scored) | Area: median signed % | Pitch: median abs. diff (n) | Facets: median run - ref (n) | Edge ft missing / extra (sum over scored types) | Values missing from runs | Release blockers |
|---|---|---|---|---|---|---|---|---|---|
| heavy canopy | 8 | 100% / 0% / 0% | 14.2 (7) | -5.4 | 0.0 (7) | 0.0 (7) | 1,064 / 656 | 0 | 0 |
| clear | 9 | 100% / 0% / 0% | 7.1 (8) | +4.4 | 0.0 (8) | -6.5 (8) | 1,531 / 742 | 0 | 0 |
| partial tree cover | 9 | 100% / 0% / 0% | 4.9 (9) | -2.2 | 0.0 (9) | -3.0 (9) | 1,370 / 526 | 0 | 1 |
| unknown | 2 | 0% / 0% / 100% | - (0) | - | - (0) | - (0) | 0 / 0 | 22 | 0 |

## By town

| Town | Properties | Complete / review required / failed | Area: median abs. diff % (n scored) | Area: median signed % | Pitch: median abs. diff (n) | Facets: median run - ref (n) | Edge ft missing / extra (sum over scored types) | Values missing from runs | Release blockers |
|---|---|---|---|---|---|---|---|---|---|
| Middleburg | 2 | 100% / 0% / 0% | 27.4 (2) | -27.4 | 0.5 (2) | -0.5 (2) | 245 / 197 | 0 | 0 |
| Jacksonville | 19 | 95% / 0% / 5% | 7.0 (16) | -1.4 | 0.0 (16) | -6.5 (16) | 3,115 / 1,303 | 11 | 1 |
| other towns (one property each) | 3 | 100% / 0% / 0% | 1.7 (3) | -1.6 | 0.0 (3) | -2.0 (3) | 231 / 116 | 0 | 0 |
| St. Johns | 4 | 75% / 0% / 25% | 4.9 (3) | +3.4 | 0.0 (3) | -3.0 (3) | 374 / 309 | 11 | 0 |
