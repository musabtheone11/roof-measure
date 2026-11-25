# Regional benchmark: aggregate results

Run `base-dev`, code {"commit":"0e363a22fc0a98c311ace4fd4e7be0e7e9416988","appHash":"42c82f154f3f340d","dirty":false}. 28 properties.
No approved tolerances exist: differences are shown, nothing is called a pass. "Not scored" = the reference does not print the value. Values the run did not produce are counted as missing, never as zero.

Aggregates only: the property-by-property table, addresses and reference documents stay in the private folder (bench/private/regional/score-<label>.md).

## By roof type

| Roof type | Properties | Complete / review required / failed | Area: median abs. diff % (n scored) | Area: median signed % | Pitch: median abs. diff (n) | Facets: median run - ref (n) | Edge ft missing / extra (sum over scored types) | Values missing from runs | Release blockers |
|---|---|---|---|---|---|---|---|---|---|
| simple gable/hip | 4 | 0% / 75% / 25% | 12.6 (3) | -12.6 | 0.0 (3) | -1.0 (3) | 227 / 125 | 11 | 0 |
| unknown (no reference) | 2 | 50% / 50% / 0% | - (0) | - | - (0) | - (0) | 0 / 0 | 0 | 1 |
| cross-gable / multi-hip | 10 | 0% / 90% / 10% | 2.6 (9) | +1.4 | 0.0 (9) | 0.0 (9) | 778 / 623 | 11 | 1 |
| complex | 12 | 17% / 83% / 0% | 5.2 (12) | +4.6 | 0.0 (12) | -8.5 (12) | 2,636 / 810 | 0 | 0 |

## By obstruction level

| Obstruction | Properties | Complete / review required / failed | Area: median abs. diff % (n scored) | Area: median signed % | Pitch: median abs. diff (n) | Facets: median run - ref (n) | Edge ft missing / extra (sum over scored types) | Values missing from runs | Release blockers |
|---|---|---|---|---|---|---|---|---|---|
| heavy canopy | 8 | 0% / 100% / 0% | 9.0 (7) | +2.6 | 0.0 (7) | -1.0 (7) | 970 / 585 | 0 | 2 |
| clear | 9 | 11% / 89% / 0% | 5.6 (8) | +3.7 | 0.0 (8) | -8.0 (8) | 1,466 / 589 | 0 | 0 |
| partial tree cover | 9 | 22% / 78% / 0% | 2.1 (9) | +0.7 | 0.0 (9) | -3.0 (9) | 1,204 / 384 | 0 | 0 |
| unknown | 2 | 0% / 0% / 100% | - (0) | - | - (0) | - (0) | 0 / 0 | 22 | 0 |
