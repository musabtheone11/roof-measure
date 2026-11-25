# Regional benchmark: aggregate results

Run `blind-final`, code {"commit":"ebf658f1aa2de377422454b1969ec7b1b99f4773","appHash":"be176aaa13416bdc","dirty":false}. 15 properties.
No approved tolerances exist: differences are shown, nothing is called a pass. "Not scored" = the reference does not print the value. Values the run did not produce are counted as missing, never as zero.

Aggregates only: the property-by-property table, addresses and reference documents stay in the private folder (bench/private/regional/score-<label>.md).

## By roof type

| Roof type | Properties | Complete / review required / failed | Area: median abs. diff % (n scored) | Area: median signed % | Pitch: median abs. diff (n) | Facets: median run - ref (n) | Edge ft missing / extra (sum over scored types) | Values missing from runs | Release blockers |
|---|---|---|---|---|---|---|---|---|---|
| cross-gable / multi-hip | 6 | 17% / 83% / 0% | 3.1 (6) | +0.3 | 0.0 (6) | -1.5 (6) | 574 / 468 | 0 | 0 |
| simple gable/hip | 3 | 33% / 67% / 0% | 6.3 (3) | -3.6 | 0.0 (3) | -1.0 (3) | 594 / 76 | 0 | 0 |
| complex | 6 | 17% / 83% / 0% | 4.7 (6) | +2.4 | 0.0 (6) | -5.0 (6) | 1,191 / 445 | 0 | 0 |

## By obstruction level

| Obstruction | Properties | Complete / review required / failed | Area: median abs. diff % (n scored) | Area: median signed % | Pitch: median abs. diff (n) | Facets: median run - ref (n) | Edge ft missing / extra (sum over scored types) | Values missing from runs | Release blockers |
|---|---|---|---|---|---|---|---|---|---|
| heavy canopy | 5 | 0% / 100% / 0% | 3.0 (5) | -2.4 | 0.0 (5) | -2.0 (5) | 904 / 198 | 0 | 0 |
| clear | 4 | 75% / 25% / 0% | 6.2 (4) | +6.2 | 0.0 (4) | -3.5 (4) | 316 / 226 | 0 | 0 |
| unknown | 1 | 0% / 100% / 0% | 14.8 (1) | +14.8 | 1.0 (1) | -2.0 (1) | 163 / 237 | 0 | 0 |
| partial tree cover | 5 | 0% / 100% / 0% | 3.2 (5) | +0.2 | 0.0 (5) | 0.0 (5) | 976 / 328 | 0 | 0 |

## By town

| Town | Properties | Complete / review required / failed | Area: median abs. diff % (n scored) | Area: median signed % | Pitch: median abs. diff (n) | Facets: median run - ref (n) | Edge ft missing / extra (sum over scored types) | Values missing from runs | Release blockers |
|---|---|---|---|---|---|---|---|---|---|
| other towns (one property each) | 4 | 0% / 100% / 0% | 3.4 (4) | -3.0 | 0.0 (4) | -1.0 (4) | 767 / 251 | 0 | 0 |
| Jacksonville | 5 | 40% / 60% / 0% | 3.0 (5) | +3.0 | 0.0 (5) | -1.0 (5) | 386 / 148 | 0 | 0 |
| Fleming Island / Orange Park | 2 | 50% / 50% / 0% | 7.0 (2) | +7.0 | 0.0 (2) | -8.5 (2) | 213 / 224 | 0 | 0 |
| St. Augustine | 2 | 0% / 100% / 0% | 8.2 (2) | +8.2 | 0.5 (2) | -3.0 (2) | 416 / 258 | 0 | 0 |
| Middleburg | 2 | 0% / 100% / 0% | 24.9 (2) | -24.9 | 0.0 (2) | -4.0 (2) | 576 / 107 | 0 | 0 |
