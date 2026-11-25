# Roof report information coverage

The report keeps Diversity Contracting's own sketch, grayscale drafting, plan-first
page order, typography and keyed schedules. This comparison concerns information
categories only. It does not reproduce another company's report graphics, branding,
sample property, customer contacts or layout.

Reference inspected on 2026-11-25: the official [Roofr measurements page](https://roofr.com/measurements)
and its linked [public sample report](https://cdn.prod.website-files.com/6493173e3cea69ef8852e657/6493173e3cea69ef8852ea1f_Roofr%20Report%20-%20Sample%20Report.pdf).
The public sample has seven pages: cover, diagram, lengths, areas, pitch/direction,
all-structures summary and material estimates. The reference PDF is retained only
as a local inspection source and is excluded from the delivery archive and source
commit. No private report or sample image was submitted to external models.

| Information category in the public sample | Diversity Contracting implementation | Evidence/limitations |
|---|---|---|
| Property, preparer/brand, area, facet count and predominant pitch | Own compact header and takeoff; facet count in measurement summary | No reference sample address or contacts are copied. |
| Roof diagram | Largest page-1 element: north-up vector plan, stable facet/edge keys, north arrow and scale bar | Remains our sketch and layout. Missing boundaries remain gaps. |
| Dimensions keyed to the drawing | Feet/inches dimensions and edge schedule with counts, each length and total | Bent paths are not dimensioned by their straight chord. Incomplete structures have no overall dimensions. |
| Eaves, valleys, hips, ridges, rakes | Named linear totals and keyed edge schedule | Supported and inferred totals are distinguished; unresolved lengths are blank. |
| Wall flashing, step flashing, transitions, parapets and unspecified lines | Included in full linear measurement summary and edge schedule | A canopy boundary is a separate non-roof obstruction, not an unspecified roof edge. |
| Combined hips + ridges; eaves + rakes | Explicit combined totals in all-structures summary | Derived from unrounded supported measurements, not independently measured again. |
| Total sloped, pitched and flat roof areas | Measurement summary with supported/inferred scope | Gross unresolved model geometry is never presented as measured net scope. |
| Two-story and two-layer areas | Dedicated summary fields using the app's facet flags | Requires actual source/field evidence; geometry alone cannot establish roofing layers. |
| Predominant pitch and its area; unknown pitch area | Explicit summary categories | Unsupported pitch is blank on the affected facet; unknown area is identified separately. |
| Individual facet areas | Facet schedule keyed to the existing plan | Unknown area is blank; inferred area is marked `est.`. Cut-outs are omitted from net area. |
| Individual facet pitch and direction | Pitch and direction in keyed facet schedules | Direction uses supported azimuth/plane data; unknown direction stays blank. It is not guessed from a decorative 3D camera. |
| Area and squares by pitch | Pitch distribution table in measurement summary | Shares the current canonical model revision and supported-scope rules. |
| Waste scenarios including selected/recommended rate | Separate waste allowance scenario table | Explicit estimates, separate from net measurements. Incomplete scopes withhold order-ready scenarios. |
| Shingle, starter, ice/water, underlayment and capping material bases | Separate material estimate with the app's product catalog and coverage assumptions | Estimates are not roof measurements; product coverage, laps and local installation requirements need verification. |
| Product units and multiple waste columns | Product estimate uses bundles/rolls/sheets and multiple waste rates | Current local catalog is used; no claim of current supplier availability, price or certification. |
| Other material quantities, including valley sheets and drip edge | Separate 8-foot valley-sheet and 10-foot drip-edge estimates | Nominal lengths are explicit; laps, cuts and installation conditions need review. |
| Rounding notes and excluded facets | Notes distinguish display rounding, exact totals and cut-outs | Totals derive from unrounded values. Display rounding and material purchase rounding are separate. |

Our report additionally records measured/inferred/unresolved evidence, applicable
dates, source/basis, affected IDs and revision validity. A plausible area with the
wrong outline fails the evidence gate. Preview, print, download and direct PDF
generation share validation. Review-required reports retain supported subtotals and
withhold unsupported/purchasing quantities.

The comparison establishes information coverage, not a claim that our automatic
measurements equal Roofr's accuracy or that the sample is ground truth for any of
our test roofs. The public sample's numerical property values were not used as
benchmark targets. Independent real-property measurement coverage remains limited
as described in [PLAN_FIRST_VALIDATION.md](PLAN_FIRST_VALIDATION.md).

Intentional differences: unknown-pitch area is shown as projected horizontal area
rather than inventing a sloped measurement; an incomplete report keeps waste and
material order figures blank. The material catalog and selected waste scenarios
remain our own implementation. Exact supplier products, sample percentages and
rounding conventions are not copied as purported measurement evidence. Material
purchase rounding alone tolerates 0.0001 source ft or ft² to avoid artificial extra
units from geodetic conversion noise; unrounded net measurements are preserved.
