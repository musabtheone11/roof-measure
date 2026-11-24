# Real-house benchmark: Roof Measure vs same-property reference reports

Run 2026-11-24 with `node compare.mjs && node report_real.mjs`. 23 properties traced (1 could not be traced). Property-level tables, addresses and sketches are private (`bench/private/`, git-ignored).

- **Reference**: third-party roof measurement reports (Roofr, GAF QuickMeasure, EagleView) and, where the insurance estimate covers the whole roof, the adjuster's roof sketch totals.
- **Old app** = engine as deployed 2026-11-23 with its measurement math; **new app** = this branch.
- Each roof is traced from Google Solar data only. Reference numbers are never given to the engine.
- Tolerances: area 3%; lengths the larger of 5 ft or 10%; facet count the larger of 1 or 15%; pitch 0.5/12. Missing reference values are not scored and never count as a pass.
- **New app** numbers are the first trace alone (confirmed + estimated area; hidden zones are in no total). The reviewer's second look with another dated dataset is not used here.
- The hidden-zone update (obstruction boundaries, hidden zones, evidence rules) was developed on the synthetic bench and on one tree-covered property that is in this set, so that property is not an independent test of it; the other 22 are.
- A row whose reference is 0 ft has no percentage error; the percentage medians are over rows with a non-zero reference, so a line type the app draws where the reference has none (a false positive) does not show there. Read those types in feet in the private table.
- No engine parameter was fitted to these reference numbers, with one disclosed exception: whether to use each facet's fitted slope or its rounded pitch for area was decided after comparing both on these 23 houses (5.7% against 6.3% median area error at that time), so the area line is not an out-of-sample result. The engine was developed on the synthetic bench and one sample property; after the first run on this set, four fixes were made (canopy ring fill, canopy-limited edges marked unresolved, double-traced lines removed, a cache key), prompted by the synthetic tree roofs, the sample property and one clear roof in this set. The "validation half" below is a fixed split by a hash of the address, shown so future tuning can be checked against a half that was not used for it.

## All properties (23)

| Metric | Houses with a reference | Median abs. error, old | Median abs. error, new | Within tolerance, old | Within tolerance, new | Median signed error, new |
|---|---|---|---|---|---|---|
| Net sloped roof area | 23 | 6.9% | 6.0% | 5 of 23 | 7 of 23 | 2.0% |
| Facet count | 23 | 3.0 facets | 2.0 facets | 7 of 23 | 8 of 23 | -14.3% |
| Predominant pitch | 23 | 0.0 x/12 | 0.0 x/12 | 17 of 23 | 18 of 23 | 0.0% |
| Eave length | 23 | 28.8% | 24.8% | 5 of 23 | 4 of 23 | -22.9% |
| Rake length | 23 | 46.4% | 36.4% | 1 of 23 | 4 of 23 | 29.5% |
| Ridge length | 23 | 18.2% | 19.4% | 7 of 23 | 8 of 23 | -19.1% |
| Hip length | 20 | 6.2% | 5.3% | 9 of 20 | 11 of 20 | -5.6% |
| Valley length | 22 | 16.1% | 19.1% | 8 of 22 | 5 of 22 | -13.6% |
| Step length | 23 | 46.4% | 21.0% | 6 of 23 | 8 of 23 | -15.9% |
| Wall length | 23 | 59.9% | 89.4% | 8 of 23 | 6 of 23 | -53.9% |
| Transition length | 20 | 17.1% | 17.3% | 7 of 20 | 7 of 20 | -0.1% |
| Ridge + hip (cap) | 20 | 11.6% | 15.8% | 9 of 20 | 9 of 20 | -11.3% |
| Eave + rake (drip edge) | 23 | 8.2% | 9.0% | 13 of 23 | 13 of 23 | -8.3% |
| Roof surface area (adjuster) | 13 | 16.9% | 5.6% | 3 of 13 | 3 of 13 | -1.1% |
| Ridge length (adjuster) | 13 | 23.7% | 23.3% | 2 of 13 | 2 of 13 | -22.8% |
| Hip length (adjuster) | 12 | 9.2% | 9.3% | 6 of 12 | 6 of 12 | -6.3% |
| Perimeter (eave + rake) (adjuster) | 13 | 12.9% | 12.4% | 5 of 13 | 6 of 13 | -6.4% |

## Clear roofs (11)

| Metric | Houses with a reference | Median abs. error, old | Median abs. error, new | Within tolerance, old | Within tolerance, new | Median signed error, new |
|---|---|---|---|---|---|---|
| Net sloped roof area | 11 | 7.4% | 8.0% | 2 of 11 | 3 of 11 | 1.4% |
| Facet count | 11 | 3.0 facets | 3.0 facets | 2 of 11 | 1 of 11 | -38.1% |
| Predominant pitch | 11 | 0.0 x/12 | 0.0 x/12 | 8 of 11 | 8 of 11 | 0.0% |
| Eave length | 11 | 28.8% | 24.8% | 2 of 11 | 2 of 11 | -20.1% |
| Rake length | 11 | 40.1% | 33.6% | 0 of 11 | 3 of 11 | 3.6% |
| Ridge length | 11 | 28.8% | 28.2% | 3 of 11 | 3 of 11 | -19.1% |
| Hip length | 9 | 3.1% | 3.2% | 5 of 9 | 6 of 9 | -5.5% |
| Valley length | 10 | 17.0% | 19.6% | 3 of 10 | 1 of 10 | -19.1% |
| Step length | 11 | 44.9% | 19.4% | 4 of 11 | 4 of 11 | -17.5% |
| Wall length | 11 | 59.9% | 89.4% | 3 of 11 | 2 of 11 | -59.9% |
| Transition length | 10 | 0.0% | 0.1% | 3 of 10 | 4 of 10 | 57.1% |
| Ridge + hip (cap) | 9 | 10.5% | 14.9% | 4 of 9 | 4 of 9 | -7.7% |
| Eave + rake (drip edge) | 11 | 7.6% | 9.2% | 8 of 11 | 6 of 11 | -6.6% |
| Roof surface area (adjuster) | 9 | 16.9% | 16.1% | 1 of 9 | 1 of 9 | -5.6% |
| Ridge length (adjuster) | 9 | 25.2% | 24.5% | 2 of 9 | 2 of 9 | -22.8% |
| Hip length (adjuster) | 9 | 6.9% | 4.3% | 5 of 9 | 5 of 9 | 1.7% |
| Perimeter (eave + rake) (adjuster) | 9 | 12.9% | 13.9% | 3 of 9 | 3 of 9 | -8.7% |

## Tree-obstructed roofs (12)

| Metric | Houses with a reference | Median abs. error, old | Median abs. error, new | Within tolerance, old | Within tolerance, new | Median signed error, new |
|---|---|---|---|---|---|---|
| Net sloped roof area | 12 | 5.3% | 5.5% | 3 of 12 | 4 of 12 | 2.1% |
| Facet count | 12 | 2.0 facets | 1.0 facets | 5 of 12 | 7 of 12 | -4.5% |
| Predominant pitch | 12 | 0.0 x/12 | 0.0 x/12 | 9 of 12 | 10 of 12 | 0.0% |
| Eave length | 12 | 28.9% | 24.4% | 3 of 12 | 2 of 12 | -24.4% |
| Rake length | 12 | 58.9% | 38.7% | 1 of 12 | 1 of 12 | 38.7% |
| Ridge length | 12 | 15.4% | 17.4% | 4 of 12 | 5 of 12 | -17.4% |
| Hip length | 11 | 18.3% | 16.2% | 4 of 11 | 5 of 11 | -18.0% |
| Valley length | 12 | 13.3% | 17.3% | 5 of 12 | 4 of 12 | -8.5% |
| Step length | 12 | 49.4% | 28.5% | 2 of 12 | 4 of 12 | -15.3% |
| Wall length | 12 | 73.9% | 73.2% | 5 of 12 | 4 of 12 | -32.0% |
| Transition length | 10 | 21.9% | 26.2% | 4 of 10 | 3 of 10 | -41.2% |
| Ridge + hip (cap) | 11 | 15.7% | 18.4% | 5 of 11 | 5 of 11 | -18.4% |
| Eave + rake (drip edge) | 12 | 13.2% | 8.6% | 5 of 12 | 7 of 12 | -8.6% |
| Roof surface area (adjuster) | 4 | 10.1% | 2.5% | 2 of 4 | 2 of 4 | 0.7% |
| Ridge length (adjuster) | 4 | 18.3% | 17.7% | 0 of 4 | 0 of 4 | -17.7% |
| Hip length (adjuster) | 3 | 16.2% | 18.5% | 1 of 3 | 1 of 3 | -18.5% |
| Perimeter (eave + rake) (adjuster) | 4 | 11.9% | 5.3% | 2 of 4 | 3 of 4 | -2.7% |

## Validation half by address hash (13)

| Metric | Houses with a reference | Median abs. error, old | Median abs. error, new | Within tolerance, old | Within tolerance, new | Median signed error, new |
|---|---|---|---|---|---|---|
| Net sloped roof area | 13 | 7.4% | 6.4% | 3 of 13 | 4 of 13 | 1.4% |
| Facet count | 13 | 3.0 facets | 3.0 facets | 3 of 13 | 4 of 13 | -30.0% |
| Predominant pitch | 13 | 0.0 x/12 | 0.0 x/12 | 10 of 13 | 10 of 13 | 0.0% |
| Eave length | 13 | 29.8% | 24.8% | 1 of 13 | 3 of 13 | -20.1% |
| Rake length | 13 | 40.1% | 50.6% | 0 of 13 | 3 of 13 | 21.2% |
| Ridge length | 13 | 15.5% | 16.6% | 5 of 13 | 6 of 13 | -13.5% |
| Hip length | 12 | 15.7% | 11.9% | 4 of 12 | 5 of 12 | -25.3% |
| Valley length | 13 | 16.6% | 26.2% | 4 of 13 | 1 of 13 | -19.4% |
| Step length | 13 | 57.1% | 21.0% | 4 of 13 | 5 of 13 | -19.1% |
| Wall length | 13 | 53.9% | 59.9% | 3 of 13 | 3 of 13 | -56.9% |
| Transition length | 10 | 0.0% | 0.1% | 4 of 10 | 3 of 10 | -0.1% |
| Ridge + hip (cap) | 12 | 15.8% | 19.0% | 4 of 12 | 3 of 12 | -17.5% |
| Eave + rake (drip edge) | 13 | 8.5% | 6.6% | 7 of 13 | 7 of 13 | -5.6% |
| Roof surface area (adjuster) | 10 | 19.2% | 16.4% | 2 of 10 | 1 of 10 | -10.8% |
| Ridge length (adjuster) | 10 | 22.4% | 23.0% | 2 of 10 | 2 of 10 | -17.5% |
| Hip length (adjuster) | 10 | 16.2% | 16.4% | 4 of 10 | 4 of 10 | -16.4% |
| Perimeter (eave + rake) (adjuster) | 10 | 12.9% | 14.5% | 3 of 10 | 3 of 10 | -8.9% |

## Per property (anonymised)

| ID | Complexity | Reference | Google imagery | Reference imagery | Canopy over roof | Facets ref / old / new | Area error old | Area error new | Split |
|---|---|---|---|---|---|---|---|---|---|
| P01 | moderate | Roofr | 2023 high | not printed | 3.0% | 9 / 11 / 10 | -18.5% | -15.6% | development |
| P02 | moderate | Roofr | 2021 medium | 2023 | 1.1% | 18 / 9 / 7 | 6.4% | 2.0% | development |
| P03 | complex | Roofr | 2015 high | not printed | 0.2% | 19 / 10 / 10 | -30.6% | -31.7% | validation |
| P04 | moderate | Roofr | 2022 high | 2025 | 1.9% | 9 / 12 / 12 | 62.2% | 63.2% | validation |
| P05 | simple | GAF | 2019 medium | 2025 | 0.8% | 5 / 6 / 7 | -36.2% | -36.0% | development |
| P06 | moderate | Roofr | 2016 high | not printed | 0.2% | 18 / 9 / 10 | 5.2% | 5.1% | development |
| P07 | simple | Roofr | 2016 high | not printed | 2.3% | 7 / 7 / 7 | -1.3% | 2.1% | development |
| P08 | complex | Roofr | 2016 high | 2025 | 0.0% | 25 / 15 / 15 | 7.4% | 6.4% | validation |
| P09 | simple | Roofr | 2016 high | not printed | 0.0% | 5 / 3 / 3 | -28.6% | -28.0% | validation |
| P10 | moderate | Roofr | 2023 high | not printed | 0.1% | 8 / 11 / 10 | 6.9% | 8.0% | validation |
| P11 | complex | Roofr | 2015 high | not printed | 10.2% | 30 / 12 / 11 | -6.1% | 5.0% | development |
| P12 | moderate | Roofr | 2019 high | not printed | 1.1% | 10 / 7 / 7 | -0.5% | 1.4% | validation |
| P13 | moderate | EagleView | 2015 high | not printed | 9.9% | 11 / 9 / 10 | -9.5% | 0.4% | validation |
| P14 | simple | GAF | 2015 high | 2025 | 0.2% | 7 / 6 / 6 | -1.9% | -2.7% | validation |
| P15 | complex | Roofr | 2015 high | not printed | 2.3% | 48 / 16 / 13 | 3.9% | 6.0% | validation |
| P16 | moderate | Roofr | 2016 high | not printed | 3.5% | 9 / 9 / 9 | -4.5% | 0.7% | development |
| P17 | complex | GAF | 2021 medium | 2025 | 0.0% | 21 / 13 / 13 | -25.9% | -26.5% | validation |
| P18 | moderate | GAF | 2019 high | 2026 | 6.5% | 9 / 9 / 8 | -14.2% | -9.0% | validation |
| P19 | simple | Roofr | 2019 medium | 2025 | 5.6% | 4 / 4 / 4 | -3.5% | 2.1% | validation |
| P20 | moderate | Roofr | 2019 medium | 2019 | 3.5% | 9 / 13 / 11 | 9.9% | 12.3% | development |
| P21 | complex | GAF | 2016 high | 2025 | 5.0% | 25 / 17 / 17 | 1.3% | 5.7% | validation |
| P22 | moderate | Roofr | 2016 high | 2024 | 3.1% | 19 / 14 / 11 | 2.5% | 5.2% | development |
| P23 | simple | GAF | 2016 high | 2025 | 32.0% | 7 / 7 / 7 | -28.7% | -12.9% | development |
