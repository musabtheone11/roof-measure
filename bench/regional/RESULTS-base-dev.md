# Regional benchmark: aggregate results

Run `base-dev`, code {"commit":"0e363a22fc0a98c311ace4fd4e7be0e7e9416988","appHash":"42c82f154f3f340d","dirty":false}. 28 properties.
No approved tolerances exist: differences are shown, nothing is called a pass. "Not scored" = the reference does not print the value. Values the run did not produce are counted as missing, never as zero.

Aggregates only: the property-by-property table, addresses and reference documents stay in the private folder (bench/private/regional/score-<label>.md).

## By roof type

| Roof type | Properties | Complete / review required / failed | Area: median abs. diff % (n scored) | Area: median signed % | Pitch: median abs. diff (n) | Facets: median run - ref (n) | Edge ft missing / extra (sum over scored types) | Values missing from runs | Release blockers |
|---|---|---|---|---|---|---|---|---|---|
| simple gable/hip | 4 | 25% / 50% / 25% | 12.6 (3) | -12.6 | 0.0 (3) | -1.0 (3) | 227 / 125 | 11 | 2 |
| unknown (no reference) | 2 | 50% / 50% / 0% | - (0) | - | - (0) | - (0) | 0 / 0 | 0 | 0 |
| cross-gable / multi-hip | 10 | 20% / 70% / 10% | 2.6 (9) | +1.4 | 0.0 (9) | 0.0 (9) | 778 / 623 | 11 | 0 |
| complex | 12 | 50% / 50% / 0% | 5.2 (12) | +4.6 | 0.0 (12) | -8.5 (12) | 2,636 / 810 | 0 | 1 |

## By obstruction level

| Obstruction | Properties | Complete / review required / failed | Area: median abs. diff % (n scored) | Area: median signed % | Pitch: median abs. diff (n) | Facets: median run - ref (n) | Edge ft missing / extra (sum over scored types) | Values missing from runs | Release blockers |
|---|---|---|---|---|---|---|---|---|---|
| heavy canopy | 8 | 0% / 100% / 0% | 9.0 (7) | +2.6 | 0.0 (7) | -1.0 (7) | 970 / 585 | 0 | 0 |
| clear | 9 | 67% / 33% / 0% | 5.6 (8) | +3.7 | 0.0 (8) | -8.0 (8) | 1,466 / 589 | 0 | 2 |
| partial tree cover | 9 | 44% / 56% / 0% | 2.1 (9) | +0.7 | 0.0 (9) | -3.0 (9) | 1,204 / 384 | 0 | 1 |
| unknown | 2 | 0% / 0% / 100% | - (0) | - | - (0) | - (0) | 0 / 0 | 22 | 0 |

## By town

| Town | Properties | Complete / review required / failed | Area: median abs. diff % (n scored) | Area: median signed % | Pitch: median abs. diff (n) | Facets: median run - ref (n) | Edge ft missing / extra (sum over scored types) | Values missing from runs | Release blockers |
|---|---|---|---|---|---|---|---|---|---|
| Middleburg | 2 | 50% / 50% / 0% | 20.3 (2) | -20.3 | 0.5 (2) | -1.0 (2) | 180 / 125 | 0 | 2 |
| Jacksonville | 19 | 32% / 63% / 5% | 5.2 (16) | +1.6 | 0.0 (16) | -6.0 (16) | 2,952 / 1,150 | 11 | 1 |
| other towns (one property each) | 3 | 33% / 67% / 0% | 2.6 (3) | +2.6 | 0.0 (3) | -2.0 (3) | 137 / 112 | 0 | 0 |
| St. Johns | 4 | 50% / 25% / 25% | 5.1 (3) | +5.1 | 0.0 (3) | -7.0 (3) | 371 / 171 | 11 | 0 |
