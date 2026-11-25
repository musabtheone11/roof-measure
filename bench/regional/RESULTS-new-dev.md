# Regional benchmark: aggregate results

Run `new-dev`, code {"commit":"ebf658f1aa2de377422454b1969ec7b1b99f4773","appHash":"be176aaa13416bdc","dirty":false}. 28 properties.
No approved tolerances exist: differences are shown, nothing is called a pass. "Not scored" = the reference does not print the value. Values the run did not produce are counted as missing, never as zero.

Aggregates only: the property-by-property table, addresses and reference documents stay in the private folder (bench/private/regional/score-<label>.md).

## By roof type

| Roof type | Properties | Complete / review required / failed | Area: median abs. diff % (n scored) | Area: median signed % | Pitch: median abs. diff (n) | Facets: median run - ref (n) | Edge ft missing / extra (sum over scored types) | Values missing from runs | Release blockers |
|---|---|---|---|---|---|---|---|---|---|
| simple gable/hip | 4 | 0% / 100% / 0% | 12.6 (3) | -12.6 | 0.0 (3) | -1.0 (3) | 223 / 121 | 11 | 0 |
| unknown (no reference) | 2 | 50% / 50% / 0% | - (0) | - | - (0) | - (0) | 0 / 0 | 0 | 0 |
| cross-gable / multi-hip | 10 | 0% / 100% / 0% | 2.6 (9) | +1.4 | 0.0 (9) | 0.0 (9) | 756 / 601 | 11 | 0 |
| complex | 12 | 8% / 92% / 0% | 5.2 (12) | +4.6 | 0.0 (12) | -8.5 (12) | 2,503 / 676 | 0 | 0 |

## By obstruction level

| Obstruction | Properties | Complete / review required / failed | Area: median abs. diff % (n scored) | Area: median signed % | Pitch: median abs. diff (n) | Facets: median run - ref (n) | Edge ft missing / extra (sum over scored types) | Values missing from runs | Release blockers |
|---|---|---|---|---|---|---|---|---|---|
| heavy canopy | 8 | 0% / 100% / 0% | 9.0 (7) | +2.6 | 0.0 (7) | -1.0 (7) | 941 / 555 | 0 | 0 |
| clear | 9 | 11% / 89% / 0% | 5.6 (8) | +3.7 | 0.0 (8) | -8.0 (8) | 1,413 / 536 | 0 | 0 |
| partial tree cover | 9 | 11% / 89% / 0% | 2.1 (9) | +0.7 | 0.0 (9) | -3.0 (9) | 1,128 / 306 | 0 | 0 |
| unknown | 2 | 0% / 100% / 0% | - (0) | - | - (0) | - (0) | 0 / 0 | 22 | 0 |

## By town

| Town | Properties | Complete / review required / failed | Area: median abs. diff % (n scored) | Area: median signed % | Pitch: median abs. diff (n) | Facets: median run - ref (n) | Edge ft missing / extra (sum over scored types) | Values missing from runs | Release blockers |
|---|---|---|---|---|---|---|---|---|---|
| Middleburg | 2 | 0% / 100% / 0% | 20.3 (2) | -20.3 | 0.5 (2) | -1.0 (2) | 176 / 121 | 0 | 0 |
| Jacksonville | 19 | 5% / 95% / 0% | 5.2 (16) | +1.6 | 0.0 (16) | -6.0 (16) | 2,830 / 1,027 | 11 | 0 |
| other towns (one property each) | 3 | 0% / 100% / 0% | 2.6 (3) | +2.6 | 0.0 (3) | -2.0 (3) | 115 / 89 | 0 | 0 |
| St. Johns | 4 | 25% / 75% / 0% | 5.1 (3) | +5.1 | 0.0 (3) | -7.0 (3) | 362 / 161 | 11 | 0 |
