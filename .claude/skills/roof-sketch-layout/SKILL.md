---
name: roof-sketch-layout
description: Lay out and verify roof sketches, scaled roof plans and their keyed schedules (axonometric, plan, dimensions, key tags, hatching, detail sheets) so they print legibly at 100% and every number on the drawing is traceable and exact. Use when drawing or reviewing a roof measurement report sheet, a takeoff diagram or a plan with keyed edges, and whenever a sketch "looks off", labels overlap, the scale is doubtful, a dimension does not match the schedule, or part of the roof is hidden, estimated or unsupported.
---

# Roof sketch layout

A roof drawing is a measurement document first and a picture second. Every rule below protects one of two
things: the reader must be able to read it at print size, and nothing on it may claim more than was measured.

## 1. What "accurate" means on the sheet

- **One geometry, many views.** The plan, the axonometric, the dimensions and the schedules are generated from
  the same facet and line records. Never re-draw a roof from a different source for a different sheet.
- **Plan lengths are horizontal; line lengths are true.** A dimension line on the plan shows the horizontal
  (plan) length. Rakes, hips and valleys in the schedule show their true sloped length (plan length x the slope
  factor of the fitted plane, or of the adjoining pitch when no plane was fitted). Say which, on the sheet.
- **Area = plan area x slope factor**, per facet, summed unrounded. Round only when printing a value.
- **Status drives the line style**, never taste: measured = solid; evidence-backed continuation (inferred) =
  dashed and lighter; unresolved line = coarse stipple; hidden / review zone = 45-degree hatch, in no total;
  a cut against an omitted plane in the sketch = dashed edge with a hatched strip.
- **Unsupported stays blank.** A pitch, length or area that was not measured prints as an empty cell, never as 0,
  never as a plausible number. Zero is printed only for a verified absence (a hip roof has 0 ft of valley).
- **Estimates are labelled.** An estimated length carries "est."; an estimated area is reported beside the
  confirmed area with its range, never folded into a single total without saying so.
- **Synthetic models are labelled illustrative** on the drawing itself (caption, status pill and note), and a
  job with no imagery date says so instead of inventing one.
- **Never trace a canopy as roof.** Roof under trees is a review zone until an image without the canopy, a
  second dataset or a site measurement supports it.

## 2. Scale and framing

- Choose the **largest architectural scale that fits** the drawing window with a small padding: 1/4", 3/16",
  1/8", 1" = 10', 3/32", 1" = 12', 1/16", 1" = 20', 1" = 24', 1" = 30', 1/32", 1" = 40', 1" = 50', 1/64" ...
  Never a free ratio. State the scale in words next to the drawing.
- **Rotate to the roof's long axis** only when it saves at least 14% of the drawing's bounding box, and never
  for a sketch reproduced from a source document unless the job says so. When rotated, say by how many degrees
  and keep the north arrow at true north.
- Draw a **two-segment scale bar** (filled, open) with 0 / step / 2 x step ft labels, and print its paper length
  ("bar = 0.63 in at 100%"): that is how a reader checks the print scale with a ruler.
- The window must hold the whole roof, every review zone and every obstruction line. Clip only on detail sheets.
- **Size the plan window from the content below it.** Measure the schedules, notes and evidence paragraphs first
  (in their fonts) and give the drawing what is left: shrink when the content needs the room, keep the compact
  height when the schedule continues on another sheet anyway, grow only when a taller window buys a larger scale.
  Reserve about 26 pt outside the outline for dimension lines when that does not cost a scale step.

## 3. Labels: order and placement

Place in this order, each pass avoiding what is already on the page:
1. **Facet IDs** (solid tags) at the polygon's label point (centroid if inside, else the widest interior span).
2. **Review-zone tags** inside their hatch; if the label point is taken, slide along a grid of interior points.
3. **Dimension lines** (they have one correct place; keys can move, dimensions cannot).
4. **Key tags**, longest line first: on the line, then shifted along it, then beside it at 9, 15, 21, 27, 33 pt
   with a leader (detail sheets may go to 51 pt). A tag is placed only where it fits the window and hits nothing.
- **Key style**: letters per repeated equal edge (E1, H1, R1 ...) when a simple roof yields at most 12 grouped
  rows; two-digit numbers per line otherwise; the document's own references (D1, D2 ...) for a job imported from
  a source sketch.
- **Dry run first.** Place everything on a throwaway page; if more than about a third of the keys would collide,
  draw the overview plan with facet IDs and dimensions only and move every key to detail sheets.
- **Detail sheets**: halves (or quadrants above about 110 lines) with 7% overlap, at the larger scale that fits.
  A key counts as unplaced only when no window had room for it; name those once, on the last detail sheet,
  with "lengths are in the schedule". Nothing may vanish silently.

## 4. Dimensions

- Dimension the **outline runs of 10 ft or more** (eaves and rakes that are measured and not a height break),
  once per structure for equal lengths and directions, outside the roof on the side away from the facet.
- Give **each building an overall width and depth** when its outline is axis-aligned in the view and every
  facet was measured. Skip overall dimensions on sketches from a source document (their D-references are the
  dimensions) and on structures with inferred or unresolved facets.
- The label runs along the dimension line, in a white box, as feet and inches. Keep the strip between the roof
  edge and the dimension line clear of tags.

## 5. The sheet budget

- Fixed blocks first (header, hero, band, table), then the flexible ones. Measure wrapped text in the font it
  is drawn with before placing it; never assume one line.
- When a sheet is crowded, compress in stages (a one-line waste block, then the shorter footnote wording)
  before holding back a review item; a held-back item is counted on the sheet ("+ 2 more review items").
- Schedules that outgrow a sheet continue on the next; count continuation sheets by drawing them on a
  throwaway page so "n of N" is right on every footer.

## 6. The axonometric

- Projection: rotate -24 degrees, elevation 32 degrees; depth sort faces back to front; shade by the plane
  normal (0.62 to 0.95 gray); walls to the ground only when heights are absolute (fitted planes).
- Heights, in order of trust: fitted planes from the height model; else pitch-derived relative heights
  (caption "illustrative"); else a built-in illustrative model (caption and note say so). Facets without a
  supported height are left out and the cut is hatched; the caption says "Partial".
- Label a face only where the label sits inside it and clear of other labels. Fewer labels beat a cloud.

## 7. Verification, every time

1. Export through the product's real actions (preview, print, download), not a side channel, and confirm the
   three carry identical bytes.
2. Let the build check text over text itself: log every text box (page, string, bounds) while drawing and
   report any two that overlap; the runner fails on one. Then render every page at 100 dpi and read it anyway,
   for what boxes cannot see: tags on dimension lines, a legend or footnote running into a table, labels outside
   the window, a title colliding with a right-aligned note, a north arrow or scale bar dropped onto a dimension.
3. **Callouts match the schedule**: every key on the plan or a detail sheet has exactly one schedule row,
   and every row's key is placed somewhere or named as unplaced.
4. **Scale is exact**: a known plan length L ft must draw at L x 72 / (feet per inch) points; the scale bar
   must measure 2 x step x k points. Check it numerically, not by eye.
5. Grayscale only, US Letter 612 x 792 pt, margins respected, footer with "sheet n of N".
6. Re-run the acceptance fixtures and their expected numbers after any layout change.
7. Write down what was not verified (for example, a print dialog in a headless browser).

## 8. In the Roof Measure app (this repository)

- `roofpdf.js`: `rpView` (scale and rotation), `rpDrawPlan` (facets, zones, lines, dims, keys; returns
  missed / outside / placedKeys), `rpDrawDims`, `rpKeys` / `rpSchedules`, `rpSheetPlan` (three layouts: simple,
  busy, refs), `rpDetailWindows` / `rpSheetDetail`, `rpSheetSchedules`, `rpAxonModel` / `rpDrawAxon`,
  `rpSheetOverview` (budgeted lower half), `rpBuild` (probe pass, exact sheet count, layout self-check).
- `report.js`: one `buildReportPDF()` for Preview, Print and Download (signature cache, fixed creation date).
- The layout self-check returned by `rpBuild` carries `scaleCheck`, `keys` (overview / detail / unplaced /
  unaccounted) and `textOverlaps`; `tools/dev/run-app.mjs` prints and asserts all three.
- Check a job: `Key=... node tools/dev/run-app.mjs --job <file> --out .devcache/runs/x --port 81xx`, then
  `pdftoppm -png -r 100 report.pdf pg/p` and read the pages. The run fails if the three deliveries differ or the
  layout self-check (scale, key reconciliation) fails; `report-check.json` keeps the numbers.
- Fixtures: `node bench/reporttest.mjs` (illustrative example 1,714.73 sq ft; status rules; grayscale; blanks).
- Acceptance jobs: `examples/residential-study.json` in the repo; customer examples stay in `bench/private/`.
