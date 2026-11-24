# Real-house benchmark: Roof Measure vs same-property reference reports

Run 2026-11-24 with `node compare.mjs && node report_real.mjs`. 23 properties traced (1 could not be traced). Property-level tables, addresses and sketches are private (`bench/private/`, git-ignored).

- **Reference**: third-party roof measurement reports (Roofr, GAF QuickMeasure, EagleView) and, where the insurance estimate covers the whole roof, the adjuster's roof sketch totals.
- **Old app** = engine as deployed 2026-11-23 with its measurement math; **new app** = this branch.
- Each roof is traced from Google Solar data only. Reference numbers are never given to the engine.
- Tolerances: area 3%; lengths the larger of 5 ft or 10%; facet count the larger of 1 or 15%; pitch 0.5/12. Missing reference values are not scored and never count as a pass.
- No engine parameter was fitted to these reference numbers. The engine was developed on the synthetic bench and one sample property; after the first run on this set, four fixes were made (canopy ring fill, canopy-limited edges marked unresolved, double-traced lines removed, a cache key), prompted by the synthetic tree roofs, the sample property and one clear roof in this set. The "validation half" below is a fixed split by a hash of the address, shown so future tuning can be checked against a half that was not used for it.

## All properties (23)

| Metric | Houses with a reference | Median abs. error, old | Median abs. error, new | Within tolerance, old | Within tolerance, new | Median signed error, new |
|---|---|---|---|---|---|---|
| Net sloped roof area | 23 | 6.9% | 5.7% | 5 of 23 | 7 of 23 | 2.0% |
| Facet count | 23 | 3.0 facets | 3.0 facets | 7 of 23 | 7 of 23 | -14.3% |
| Predominant pitch | 23 | 0.0 x/12 | 0.0 x/12 | 17 of 23 | 18 of 23 | 0.0% |
| Eave length | 23 | 28.8% | 24.5% | 5 of 23 | 5 of 23 | -19.1% |
| Rake length | 23 | 46.4% | 62.6% | 1 of 23 | 2 of 23 | 62.6% |
| Ridge length | 23 | 18.2% | 20.3% | 7 of 23 | 7 of 23 | -19.1% |
| Hip length | 20 | 6.2% | 8.6% | 9 of 20 | 9 of 20 | -7.7% |
| Valley length | 22 | 16.1% | 19.5% | 8 of 22 | 9 of 22 | -8.5% |
| Step length | 23 | 46.4% | 44.1% | 6 of 23 | 8 of 23 | -14.9% |
| Wall length | 23 | 59.9% | 81.0% | 8 of 23 | 6 of 23 | -54.7% |
| Transition length | 20 | 17.1% | 12.5% | 7 of 20 | 9 of 20 | 12.5% |
| Ridge + hip (cap) | 20 | 11.6% | 13.7% | 9 of 20 | 8 of 20 | -8.5% |
| Eave + rake (drip edge) | 23 | 8.2% | 11.0% | 13 of 23 | 11 of 23 | -7.4% |
| Roof surface area (adjuster) | 13 | 16.9% | 12.9% | 3 of 13 | 4 of 13 | -0.9% |
| Ridge length (adjuster) | 13 | 23.7% | 24.5% | 2 of 13 | 2 of 13 | -24.1% |
| Hip length (adjuster) | 12 | 9.2% | 12.6% | 6 of 12 | 5 of 12 | -8.1% |
| Perimeter (eave + rake) (adjuster) | 13 | 12.9% | 12.1% | 5 of 13 | 4 of 13 | -8.0% |

## Clear roofs (9)

| Metric | Houses with a reference | Median abs. error, old | Median abs. error, new | Within tolerance, old | Within tolerance, new | Median signed error, new |
|---|---|---|---|---|---|---|
| Net sloped roof area | 9 | 6.9% | 6.2% | 2 of 9 | 2 of 9 | 2.2% |
| Facet count | 9 | 8.0 facets | 8.0 facets | 1 of 9 | 1 of 9 | -40.0% |
| Predominant pitch | 9 | 0.0 x/12 | 0.0 x/12 | 7 of 9 | 7 of 9 | 0.0% |
| Eave length | 9 | 28.8% | 28.6% | 1 of 9 | 1 of 9 | -20.2% |
| Rake length | 9 | 52.8% | 53.8% | 0 of 9 | 0 of 9 | 25.1% |
| Ridge length | 9 | 28.8% | 28.4% | 3 of 9 | 3 of 9 | -28.4% |
| Hip length | 8 | 5.2% | 5.5% | 5 of 8 | 5 of 8 | -4.7% |
| Valley length | 9 | 17.0% | 19.5% | 3 of 9 | 3 of 9 | -13.0% |
| Step length | 9 | 31.9% | 24.9% | 3 of 9 | 4 of 9 | -24.9% |
| Wall length | 9 | 59.9% | 87.8% | 3 of 9 | 2 of 9 | -61.4% |
| Transition length | 8 | 0.0% | 0.1% | 4 of 8 | 6 of 8 | 19.1% |
| Ridge + hip (cap) | 8 | 9.4% | 12.1% | 4 of 8 | 3 of 8 | -6.8% |
| Eave + rake (drip edge) | 9 | 6.6% | 8.6% | 7 of 9 | 6 of 9 | -7.4% |
| Roof surface area (adjuster) | 7 | 16.9% | 16.5% | 0 of 7 | 1 of 7 | -16.5% |
| Ridge length (adjuster) | 7 | 25.2% | 25.0% | 2 of 7 | 2 of 7 | -25.0% |
| Hip length (adjuster) | 7 | 6.9% | 8.4% | 5 of 7 | 4 of 7 | 3.0% |
| Perimeter (eave + rake) (adjuster) | 7 | 12.9% | 12.1% | 3 of 7 | 3 of 7 | -8.6% |

## Tree-obstructed roofs (14)

| Metric | Houses with a reference | Median abs. error, old | Median abs. error, new | Within tolerance, old | Within tolerance, new | Median signed error, new |
|---|---|---|---|---|---|---|
| Net sloped roof area | 14 | 7.8% | 5.3% | 3 of 14 | 5 of 14 | 1.8% |
| Facet count | 14 | 2.0 facets | 2.0 facets | 6 of 14 | 6 of 14 | 0.0% |
| Predominant pitch | 14 | 0.0 x/12 | 0.0 x/12 | 10 of 14 | 11 of 14 | 0.0% |
| Eave length | 14 | 28.9% | 18.7% | 4 of 14 | 4 of 14 | -17.7% |
| Rake length | 14 | 38.6% | 66.0% | 1 of 14 | 2 of 14 | 66.0% |
| Ridge length | 14 | 15.9% | 18.5% | 4 of 14 | 4 of 14 | -16.0% |
| Hip length | 12 | 15.7% | 17.0% | 4 of 12 | 4 of 12 | -18.5% |
| Valley length | 13 | 13.3% | 18.4% | 5 of 13 | 6 of 13 | -7.5% |
| Step length | 14 | 51.6% | 50.6% | 3 of 14 | 4 of 14 | -14.9% |
| Wall length | 14 | 73.9% | 67.8% | 5 of 14 | 4 of 14 | -35.8% |
| Transition length | 12 | 26.6% | 16.5% | 3 of 12 | 3 of 12 | 12.5% |
| Ridge + hip (cap) | 12 | 15.8% | 18.5% | 5 of 12 | 5 of 12 | -12.0% |
| Eave + rake (drip edge) | 14 | 12.5% | 12.3% | 6 of 14 | 5 of 14 | -3.7% |
| Roof surface area (adjuster) | 6 | 10.4% | 7.0% | 3 of 6 | 3 of 6 | 0.7% |
| Ridge length (adjuster) | 6 | 18.3% | 20.6% | 0 of 6 | 0 of 6 | -14.6% |
| Hip length (adjuster) | 5 | 16.2% | 17.5% | 1 of 5 | 1 of 5 | -17.5% |
| Perimeter (eave + rake) (adjuster) | 6 | 11.9% | 15.3% | 2 of 6 | 1 of 6 | 7.8% |

## Validation half by address hash (13)

| Metric | Houses with a reference | Median abs. error, old | Median abs. error, new | Within tolerance, old | Within tolerance, new | Median signed error, new |
|---|---|---|---|---|---|---|
| Net sloped roof area | 13 | 7.4% | 6.2% | 3 of 13 | 4 of 13 | -2.0% |
| Facet count | 13 | 3.0 facets | 3.0 facets | 3 of 13 | 4 of 13 | -30.0% |
| Predominant pitch | 13 | 0.0 x/12 | 0.0 x/12 | 10 of 13 | 10 of 13 | 0.0% |
| Eave length | 13 | 29.8% | 28.6% | 1 of 13 | 1 of 13 | -19.1% |
| Rake length | 13 | 40.1% | 53.8% | 0 of 13 | 2 of 13 | 25.1% |
| Ridge length | 13 | 15.5% | 16.6% | 5 of 13 | 5 of 13 | -13.9% |
| Hip length | 12 | 15.7% | 17.0% | 4 of 12 | 4 of 12 | -19.9% |
| Valley length | 13 | 16.6% | 19.8% | 4 of 13 | 4 of 13 | -18.2% |
| Step length | 13 | 57.1% | 28.9% | 4 of 13 | 5 of 13 | -42.9% |
| Wall length | 13 | 53.9% | 54.7% | 3 of 13 | 3 of 13 | -57.3% |
| Transition length | 10 | 0.0% | 6.3% | 4 of 10 | 5 of 10 | -0.2% |
| Ridge + hip (cap) | 12 | 15.8% | 18.5% | 4 of 12 | 3 of 12 | -14.4% |
| Eave + rake (drip edge) | 13 | 8.5% | 8.7% | 7 of 13 | 7 of 13 | -7.4% |
| Roof surface area (adjuster) | 10 | 19.2% | 14.7% | 2 of 10 | 2 of 10 | -8.9% |
| Ridge length (adjuster) | 10 | 22.4% | 24.6% | 2 of 10 | 2 of 10 | -20.6% |
| Hip length (adjuster) | 10 | 16.2% | 17.5% | 4 of 10 | 3 of 10 | -15.1% |
| Perimeter (eave + rake) (adjuster) | 10 | 12.9% | 15.4% | 3 of 10 | 2 of 10 | -9.4% |

## Per property (anonymised)

| ID | Complexity | Reference | Google imagery | Reference imagery | Canopy over roof | Facets ref / old / new | Area error old | Area error new | Split |
|---|---|---|---|---|---|---|---|---|---|
| P01 | moderate | Roofr | 2023 high | not printed | 4.1% | 9 / 11 / 11 | -18.5% | -14.6% | development |
| P02 | moderate | Roofr | 2021 medium | 2023 | 1.1% | 18 / 9 / 8 | 6.4% | 2.2% | development |
| P03 | complex | Roofr | 2015 high | not printed | 0.2% | 19 / 10 / 10 | -30.6% | -31.1% | validation |
| P04 | moderate | Roofr | 2022 high | 2025 | 2.5% | 9 / 12 / 11 | 62.2% | 65.5% | validation |
| P05 | simple | GAF | 2019 medium | 2025 | 2.2% | 5 / 6 / 7 | -36.2% | -34.6% | development |
| P06 | moderate | Roofr | 2016 high | not printed | 0.0% | 18 / 9 / 10 | 5.2% | 5.0% | development |
| P07 | simple | Roofr | 2016 high | not printed | 2.0% | 7 / 7 / 7 | -1.3% | 2.0% | development |
| P08 | complex | Roofr | 2016 high | 2025 | 0.0% | 25 / 15 / 15 | 7.4% | 6.2% | validation |
| P09 | simple | Roofr | 2016 high | not printed | 0.0% | 5 / 3 / 3 | -28.6% | -28.0% | validation |
| P10 | moderate | Roofr | 2023 high | not printed | 0.0% | 8 / 11 / 11 | 6.9% | 7.5% | validation |
| P11 | complex | Roofr | 2015 high | not printed | 6.5% | 30 / 12 / 12 | -6.1% | 3.2% | development |
| P12 | moderate | Roofr | 2019 high | not printed | 1.5% | 10 / 7 / 7 | -0.5% | 1.5% | validation |
| P13 | moderate | EagleView | 2015 high | not printed | 3.1% | 11 / 9 / 10 | -9.5% | -5.7% | validation |
| P14 | simple | GAF | 2015 high | 2025 | 0.4% | 7 / 6 / 6 | -1.9% | -2.0% | validation |
| P15 | complex | Roofr | 2015 high | not printed | 2.0% | 48 / 16 / 16 | 3.9% | 6.8% | validation |
| P16 | moderate | Roofr | 2016 high | not printed | 3.2% | 9 / 9 / 9 | -4.5% | -0.3% | development |
| P17 | complex | GAF | 2021 medium | 2025 | 0.0% | 21 / 13 / 13 | -25.9% | -26.5% | validation |
| P18 | moderate | GAF | 2019 high | 2026 | 10.1% | 9 / 9 / 9 | -14.2% | -4.9% | validation |
| P19 | simple | Roofr | 2019 medium | 2025 | 2.8% | 4 / 4 / 4 | -3.5% | -2.4% | validation |
| P20 | moderate | Roofr | 2019 medium | 2019 | 2.7% | 9 / 13 / 12 | 9.9% | 10.0% | development |
| P21 | complex | GAF | 2016 high | 2025 | 1.5% | 25 / 17 / 17 | 1.3% | 2.0% | validation |
| P22 | moderate | Roofr | 2016 high | 2024 | 0.9% | 19 / 14 / 14 | 2.5% | 3.5% | development |
| P23 | simple | GAF | 2016 high | 2025 | 31.1% | 7 / 7 / 8 | -28.7% | 7.5% | development |
