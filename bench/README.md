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
Key=... node ../tools/dev/run-app.mjs --address "..." --out ../.devcache/runs/name   # the real UI, address to PDF
```
