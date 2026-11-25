# Auto-trace accuracy bench

Runs the real browser engine (`autotrace.js` + `autotrace2.js`, loaded unchanged into a Node `vm`) on thousands of
synthetic roofs with exact ground truth, and on real addresses against GAF QuickMeasure numbers.

## Synthetic (free, no API key)

```
cd bench && npm install
node run.mjs --n 3000 --out results/now.jsonl                                  # current engine
node run.mjs --n 3000 --out results/base.jsonl --engine bench/engines/base     # original engine, same houses
node report.mjs results/base.jsonl results/now.jsonl                           # accuracy tables
node crit.mjs results/now.jsonl                                                # report-grade pass rate per criterion
node confusion.mjs 300 "" notrees                                              # GT line type -> engine line type (ft)
node dbg.mjs <seed> > d.json && python3 plot.py out.png d.json                 # one house: DSM, truth, engine
```

`synth.mjs` builds houses from 1-10 rectangular wings (hip / gable, 4-14/12, one or two eave levels, dormers),
computes exact facet polygons with polygon-clipping, classifies every edge from the exact planes and measures true 3D
lengths. It then renders a Google-Solar-style 10 cm DSM and mask: crease blur 0.6-3 px, white noise 1.5-7 cm,
low-frequency warp, ragged mask edge, chimneys, vents, and tree canopy over the roof (mask kept or cut). 40% of houses
use the "hard" profile (heavy blur and noise), which reproduces the failures seen on 4510 Kelliwood Manor Ln.

`score.mjs` turns engine output into report numbers exactly like `app.js` (`summarize` / `edgeMetrics`).

## Real roofs (about 10 cents per address)

Put the GAF report numbers in `truth/<address>.json` (see the Kelliwood file), then
`node real.mjs --key YOUR_GOOGLE_KEY --truth truth/4510-kelliwood-manor-ln.json`.
It prints truth vs original engine vs current engine for area, facets, every line type and the pitch mix.

## Real houses against same-property reference reports

`compare.mjs` runs the app's own `autoTraceRoof()` headless (`appcore.mjs`) for every reference file in
`bench/private/truth/` (numbers extracted from Roofr / GAF / EagleView reports and adjuster estimates, with source page,
unit and confidence), once with the previous engine (`engines/2026-11-23`) and once with the current one, and scores both
against the same reference. The reference numbers are never given to the engine.

```
cd bench && npm install
Key=YOUR_GOOGLE_KEY node compare.mjs          # downloads are cached under private/cache (about 10 cents per new address)
node report_real.mjs                          # private/results/compare.md (per property) + REAL_RESULTS.md (aggregate)
python3 sketches.py                           # private/results/<slug>.png: old vs new roofline over the aerial photo
```

Everything under `bench/private/` (customer addresses, report numbers, sketches) is git-ignored. Only the aggregate
`REAL_RESULTS.md` is committed.

## Other checks

```
node modeltest.mjs                            # measurement and audit rules in roofmodel.js
node run.mjs --n 1600 --out results/new.jsonl # synthetic houses now carry an aerial colour layer (trees are green)
node treecmp.mjs results/now.jsonl results/new.jsonl   # area accuracy on tree-covered synthetic roofs, paired seeds
node colourtest.mjs                           # tan, olive, red-brown and dark roofs must trace like a grey one, with and without trees
node fixtures.mjs                             # regression fixtures D1-D8 from the regional benchmark (CI)
node reporttest.mjs                           # report acceptance example (1,714.73 sq ft) and REVIEW REQUIRED rules (CI)
Key=... node ../tools/dev/run-app.mjs --address "..." --out ../.devcache/runs/name   # the real UI, address to PDF (Preview, Print and Download must agree)
Key=... node ../tools/dev/run-app.mjs --job ../examples/residential-study.json --out ../.devcache/runs/example   # a saved job through the same flow
Key=... node ../tools/dev/run-app.mjs --address "..." --out ../.devcache/runs/name --alt   # ... plus the reviewer's second look
python3 -I sectioncmp.py private/refs/<house>/sections.json "Before=a/roof.json" "After=b/roof.json" --out cmp.md --png cmp.png
```

`--alt` drives *Review roof from other angles* through the real controls: the five 3D views, the dated imagery list, the
roof configuration check, *Carry edges into the sketch*, the newest USDA photo, and a second PDF (`report-alt.pdf`).
`sectioncmp.py` compares several exports of one house by roof section and by line type against reference values kept in
a private `sections.json` (the sections are the facets of one named export; other exports are cut against those outlines).

## Results on 2026-11-24, hidden-zone engine (second update)

Synthetic, 598 paired houses (seeds 1-1000). The previous engine is scored with its rounded pitches, the two updates
with their fitted slopes (`results/now.jsonl`, `final.jsonl`, `v6.jsonl`):

| Set | Houses | Area within 3%, previous engine | first update | this update | Mean abs. area error, previous | first | this |
|---|---|---|---|---|---|---|---|
| Clear roofs | 398 | 92.5% | 92.5% | 93.0% | 1.01% | 1.26% | 1.15% |
| Tree-covered roofs | 200 | 44.5% | 52.0% | 77.5% | 4.91% | 4.33% | 2.09% |

- No clear roof is flagged. Of the 200 tree-covered roofs, 181 carry a flag (an estimated part, a hidden zone or an
  obstruction boundary). Of the 19 with no flag, 3 are more than 5% short of the true area (worst -10.5%): canopy the
  tracer did not recognise. Before the last two fixes (any tall object beside the roof is a candidate obstruction; eave
  height taken only from down-slope edges) it was 12 of 43.
- Roof colour: tan, warm grey, olive, red-brown and charcoal roofs trace exactly like the grey one in `colourtest.mjs`
  (before this update a tan or olive roof lost facets to the canopy test).
- Real houses (23, trace image only): median area error 5.5% (was 6.9% on the previous engine), eave length error 22%
  (was 29%), rake length error 35% (was 46%; 63% after the first update), step flashing 24% (was 46%). See `REAL_RESULTS.md`.
- Outline corners: a short slanted stretch (under 5 m) joining two parallel, offset wall lines is squared into a right-angle
  step through its middle (`fpSquareJog`). Real houses: area 6.0% -> 5.5%, eaves 24.8% -> 22.1%; synthetic houses unchanged.
- Tried and switched off: moving each outline wall to the half-way point of the height drop (`edgeHalfHeight`). Synthetic
  houses improved slightly (93.0% -> 93.7% within 3%) but real houses got worse (median area error 6.0% -> 8.4%).

## Results on 2026-11-24 (previous engine -> first update)

Synthetic, 954 paired houses (seeds 1-1600), area scored the way the app scores it:

| Set | Houses | Area within 3%, before | Area within 3%, after | Mean abs. area error, before | after | Flagged inferred / unresolved |
|---|---|---|---|---|---|---|
| Clear roofs | 629 | 93.5% | 93.0% | 0.95% | 1.20% | 0 |
| Tree-covered roofs | 325 | 43.1% | 52.6% | 5.16% | 4.25% | 227 |

- Clear roofs are slightly worse on the synthetic set because its houses are built at exact whole pitches, so rounding the
  fitted slope to a whole pitch is exact there; with rounded pitches the new engine scores 0.97%. On the 23 real houses the
  fitted slope was the better choice (median area error 5.7% against 6.3% with rounded pitches), so it is the default.
- Line lengths by type did not change materially (within the larger of 5 ft or 10%: eaves 77% -> 78%, rakes 45% -> 43%,
  ridge + hip 66% -> 66%, valleys 43% -> 47%, step + wall 35% -> 37%).
- Real houses: see `REAL_RESULTS.md`.
