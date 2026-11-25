# Independent vision review of difficult roofs

Several models read each roof independently; their observations are candidates that local geometry code checks against
measurable data before anything in the roof model changes. Nothing private leaves the machine: external models get
public-domain USDA (NAIP) aerials and synthetic scenes, cropped to the building, with no address, coordinates, customer
report or Google imagery in the request. Google Solar layers (aerial, height model, mask) and 3D tiles are Google Maps
Platform content and are reviewed locally only (Claude Code subagents through the same bundles and the same answer format).

## Workflow (repeatable, one property)

```
node bench/vision/naip.mjs --slug <slug> --out .devcache/vision/<slug>             # newest NAIP photo, exactly georeferenced (datum shift recorded)
python3 -I bench/vision/crops.py --image .../naip.png --frame .../naip.json --out .../crops --sketch <run>/roof.json
python3 -I bench/vision/review.py --crops .../crops --out .../review --roles outline,obstruction,challenge   # external models
node bench/vision/layers.mjs --slug <slug> --out .../layers                          # local only: aerial + height-model hillshade
python3 -I bench/vision/crops.py --image .../layers/hillshade.png --frame .../layers/hillshade.json --out .../crops-local-shade --sketch <run>/roof.json
python3 -I bench/vision/review.py --crops .../crops-local-shade --out .../review-local-shade --roles outline,planes,challenge --local   # bundles for a subagent
node bench/vision/fuse.mjs --slug <slug> --run <run> --obs .../review/observations.json --out .../fuse --apply   # proposals, job-c.json, marks
python3 -I bench/vision/marks.py --crops .../crops --fuse .../fuse --out .../fuse/marks.png
python3 -I bench/vision/rereview.py --crops .../crops --fuse .../fuse --out .../rereview           # disputed edges back to the challenge models
node bench/vision/run-c.mjs --from new-dev --label apinex-dev                                        # version C through the real app
```

Views: a whole view, a building window and four overlapping detail tiles (25 % overlap), each with a lettered/numbered
grid, a scale bar and, for the challenge role, the candidate sketch drawn in the app's line colours. `manifest.json`
maps any view pixel back to the parent image and to lat/lng, so an observation given in the pixels of a tile lands on the
ground exactly. The 3D orbit views saved by the benchmark's second look (`alt-3d-*.png`) are added to the local bundles
of a roof whose plan views leave a corner or level break open.

Roles (one request each, several models per role, `prompts.py`): outline reviewer (supported perimeter runs, corners,
offsets, gaps), roof-plane reviewer (ridges, hips, valleys, transitions, level breaks), obstruction reviewer (canopy,
shadows, neighbours, vehicles, pool cages, missing evidence), challenge reviewer (each sketch element: unsupported,
displaced, missing, misclassified, follows canopy or shadow), measurement reviewer (text only: sanitized coordinate
fixtures, expected lengths, factors and areas, returned as test cases). Every answer is JSON in image coordinates with the
view id, endpoints, proposed type, the evidence and a confidence; "unresolved" is always allowed; no feet, pitch or area
may be read off a picture.

## Fusion rules (`fuse.mjs`, tested by `bench/visiontest.mjs` in CI)

- An observation is a candidate. The height model and the building mask (read locally) are the measurable source; a
  photo is one source however many models agree on it.
- Runs are slid up to 1.2 m sideways to where the height step / mask boundary (outline types) or the surface crease
  (interior types) is strongest, because image coordinates carry about a metre of noise; then they are matched to the
  nearest sketch line (same line within 0.6 m and 10 degrees = confirmation).
- A corner moves only when the wall lines re-fitted through the new corner follow the height step / mask boundary better
  than the old ones (support at least 0.6, and 0.1 better) and the roof surface runs on to the new corner (no tree crown,
  no ground in between). Shared corners move together; every line end at that corner moves with it.
- A line is renamed only when the height model supports the new name (an outer edge steps down to the ground; an
  interior line only bends) and not the old one.
- Observations are grouped only when they lie on one line (same direction, within 0.8 m perpendicular, overlapping along
  it); a run is matched to a sketch line by its perpendicular offset and overlap, so a run that overshoots a corner is
  still the same line and a shed's eave in line with the house's is not.
- A roof edge two models saw where the sketch has nothing, with a height step under it (3 m or longer), the building mask
  on its higher side (the Solar data call it building, so the trace dropped it) and a smooth surface beside it (not a tree
  crown), opens the nearest facet for review with the evidence. Outside the mask or on a lumpy surface it is noted as a
  possible neighbouring structure or canopy. It is never drawn as measured roof: that needs the trace, not a photo.
- A challenge reviewer's verdict that a sketch line is unsupported or follows a tree crown or shadow is checked the same
  way: the line's step / mask (or crease) support and the lumpiness of the surface on its roof side (mean absolute second
  difference 0.8 m beside the run; roof planes about 0.03 m, crowns well above 0.15 m). Lumpy or unsupported lines open
  their facet; lines the height model shows are kept and the verdict is rejected.
- A line a reviewer drew where the height model shows nothing is rejected. A corner seen in a photo but under canopy in
  the height model is never moved on the photo alone; the matter stays open.
- Canopy, shadow or neighbour regions over a sketch line are flags for the reviewer, not corrections.
- Accepted edits and open items go into `job-c.json` in the app's own job format with a note per edit; the report, the
  sketch and the totals are then produced by the app from that revision and reconciled like any export.

## Model roster for images (probe of 25 Nov 2026: one synthetic image, "what shapes are here")

34 of 41 chat models read the image: claude-fable-5.2, claude-opus-5.5, claude-sonnet-5.5, deepseek-v4.1-flash,
free/claude-opus-4.6, free/claude-sonnet-4.6, free/deepseek-v4.1-flash, free/gemini-3.1-pro, free/gemini-3.8-flash,
free/gemini-4-hydrogen, free/glm-5.3-flash, free/glm-5.3-flashx, free/gpt-6-luna, free/hy4-flash, free/hy4, free/kimi-k2.8,
free/kimi-k3, free/mimo-v2.6-flash, free/mimo-v2.6-pro, free/minimax-m3.1-flash, free/minimax-m3, free/muse-spark-1.3,
free/qwen-3.8-max, gemini-3.8-flash, gemini-4-argon, gemini-4-carbon, gemini-4-hydrogen, glm-5.3-flash, gpt-6-luna,
gpt-6.1-terra, gpt-6.2-astra, gpt-6.2-sol, hy4-preview, muse-spark-1.3; kimi-k3.1-pro read it but ran out of tokens
reasoning. No image input: deepseek-v4-flash, deepseek-v4-pro, free/deepseek-v4-flash-0731, free/deepseek-v4-pro-0813,
free/glm-5.3, glm-5.3 ("Vision is disabled"). grok-4.7 never answered (502). jev-1.13 and drex-v2.0 are decision models
(`/v1/decisions`), used for triage of findings, not for images.

Assignments for the broad pass (free models; three per role, two for obstruction): outline free/gemini-3.1-pro,
free/qwen-3.8-max, free/kimi-k3; roof planes free/gemini-4-hydrogen, free/mimo-v2.6-pro, free/hy4 (local height-model
views); obstruction free/gemini-3.8-flash, free/minimax-m3; challenge free/claude-opus-4.6, free/claude-sonnet-4.6,
free/mimo-v2.6-flash. Disputed edges go back to gemini-4-carbon and gpt-6.2-astra (paid; the two that read a printed
report page correctly in the earlier audit) and free/claude-opus-4.6. Measurement reviewer: gemini-4-argon (matched the
program on every value of the coordinate fixture and returned seven test cases); gpt-6.1-terra (upstream 502 twice on
this task); free/deepseek-v4.1-flash and free/glm-5.3 (both slipped the metres-per-degree arithmetic by a factor of a
thousand: rejected).

Rate and failures: the plan allows 30 requests a minute; twelve parallel image requests made the free models return 502,
three in flight started 4 s apart work. Every request is logged beside its answer (`.devcache/vision/<slug>/review/`).
