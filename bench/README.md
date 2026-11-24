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
