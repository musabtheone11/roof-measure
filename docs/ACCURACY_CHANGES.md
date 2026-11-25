# Accuracy changes and their evidence

## Pin and job identity

A locally reproduced regression (R-PIN-01) showed that changing the pin retained
the previous roof's geometry and Solar result. The baseline browser retained six
facets and sixteen lines after moving a synthetic job to a new location. The
corrected browser clears both, preserves the original job for recovery, and
requires roof data for the new selection. Late geocoding, Solar, scan and trace
results cannot replace a newer selection. There are 2,000 deterministic
out-of-order pin/API lifecycle cases plus focused async trace regressions.

The user's private imagery and address remain in ignored local regression files.
A clean run reproduced the reported baseline facet/line counts and aligned with
its own dated source. The large screenshot displacement was consistent with a
moved pin showing the old job. This does not establish numerical roof accuracy.

## Raster registration and structure selection

Coordinate-reference metadata now takes precedence over coordinate magnitude.
Signed row direction, full affine cross terms, pixel-is-point tiepoints and
nonzero model tiepoints are retained. Equal array dimensions no longer establish
registration: mask, DSM and RGB must share their georeferenced grid. Registered
rotated/sheared layers are resampled once into the solver's east/north grid, with
original transform and residual recorded. Axis-aligned arrays pass unchanged.
Unmatched grids and transformations outside the supported residual are refused.

The seeded registration stress suite covers 4,000 transforms, 285,517 interior
plane samples, 200 unchanged identity arrays and 4,000 deliberately shifted layer
pairs. Maximum sampled height error was 4.67e-7 metres against an independent
plane oracle. This is an analytic transform test, not field-measurement accuracy.
A further 1,000 selection cases reject larger neighbors and missing targets;
100 valid zero-pixel anchors are retained. Source quality and registration
uncertainty are separate from these numerical interpolation errors.

Selection uses the selected pin, Solar building centre and roof-segment witnesses
rather than allowing a larger nearby mask to win an area score. Ambiguous or
unsupported selection stops tracing. The detached-building fixture now carries a
realistic main-building box; its formerly ambiguous combined-box input is also
retained as an explicit refusal test.

## Rendering and evidence

Shape additions and imports batch the final UI recomputation. Reference Solar
plane labels hide after tracing and remain available through their existing
toggle. These are display/latency changes; they do not move saved vertices or
prove accuracy. Missing provenance notes are grouped into complete stable-ID
ranges with plan-key lookups instead of repeating thousands of paragraphs.
Unsupported missing edge categories stay blank, including in the new measurement
summary. Cutouts use one shared host/level/structure-aware net-area calculation;
unmatched cuts remain review findings. Cutouts require quantity evidence and
invalidate dependent host net-area evidence when edited.

## Model contributions and benchmark scope

APInex reviewed sanitized synthetic cases and public code. Independently verified
findings were adopted; inaccurate answers and rate-limited responses were not
counted as passes. Details are in [APInex review](APINEX_REVIEW.md).

The large frozen paired roof benchmark exercises the direct trace solver, with
outline overlap, missing/extra area, pitch and edge-type quantities. It does not
exercise geocoding, browser rendering, raster decoding or actual PDF export
status. Focused tests cover those separate paths. See
[validation and coverage](PLAN_FIRST_VALIDATION.md) for completed aggregate
results and the unavailable real-property references. No synthetic test count is
represented as a count of independently measured properties or proof of perfection.
