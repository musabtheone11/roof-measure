# Release record (standing brief)

Read this first in every work cycle: resume at **Next unfinished check**.

## Active milestone: A. Uneven roof edges

**Last verified result (2026-11-27):**
- Shallow kinks in straight eave and rake runs are fixed in the tracer (PR #11, merged).
- The entry zig-zag is fixed. Two small blurred drop-off regions fitted at about 22/12 had been keeping each other as "roof planes at that pitch", so both survived as facets with a ring of short rake, step and wall lines. Regions steeper than 20/12 no longer vouch for each other (`autotrace2.js`, band absorption).
- Regression checks: `bench/straight-edge-test.mjs` and `bench/steep-drop-test.mjs`, both of which fail on the previous engine.

**Second real roof (2026-11-27):** the earlier odd-plane property, traced fresh through the app. Shallow kinks 9 (before #11) → 4. Sloped area 4,256.8 → 4,260.9 ft² (+0.1%), reconcile 122/122.
- The four remaining turns are not clean straight-eave cases. One is at a chimney on the north-west corner; three are where tree canopy covers the eave on the east and south-east. They stay unstraightened because the edge isn't visible there; snapping them would guess geometry.
- The real irregularities survive: the stepped south side around the entry walk and the south-east gable bump.
- The steep drop-off fix does not change this roof (no regions above 20/12).

**Milestone A status:** closing evidence is complete (failing case, regression checks, before/after including downloaded reports, root cause, measurement deltas, second roof). Waiting on owner approval to merge PR #12.

**Next unfinished check:** Milestone B step 1, the output inventory: every existing function and output, where it appears today, and the check proving it still works. Owner: integration lead.

Entry fix, reproduction property: facets 38 → 36, lines 185 → 174. Sloped area 5,588.90 → 5,483.29 ft² (−1.9%) because the steep pixels are no longer counted at 22/12. Plan area 4,720.3 → 4,722.4 ft². Rakes −50.3 ft, step flashing −28.6 ft, wall flashing −5.6 ft, hips −1.7 ft, valleys −2.9 ft. Synthetic benchmark: area MAPE 1.35% → 1.30%; ridge+hip within 10% unchanged at 66.2%; eave+rake within 10% 74.6% → 73.2% (one house).

### Evidence

| Item | Where | Result |
|---|---|---|
| Reproduction | Supplied reproduction property (address withheld from this public file), address flow through the app; page 1 at 110 dpi, US Letter | Straight eave runs bent 3–25° at junctions; 40 outline/step lines under 3 ft |
| Pipeline trace | engine raw output = stored roof = PDF input (38 facets, 185 lines in each) | The deviation starts in the tracer, not in storage, transforms or rendering |
| Root cause | `reconstruct()` fits every outline piece to its own pixels. At a hip foot, a T junction with a height break, or a blur-rounded corner, neighbouring pieces of one straight eave get slightly different lines, and the outline kinks where they meet | Confirmed by instrumentation on synthetic houses |
| Metric | `bench/wobble-run.mjs` (shallow 3–25° turns between outline pieces) | Synthetic (truth 0): 94 kinks / 41 houses → 33 / 26. Real property: 12 → 8 |
| Controls | Straight: houses 12, 13, 47, 58 (`straight-edge-test`). Intentional jog: D13, a 0.6 m eave offset, survives. Real diagonals: D15 corner cuts survive | Pass |
| Arithmetic | `examples/gable-control.json` through the app and `bench/gable-control-test.mjs` | 600.00 ft² projected, 670.82 ft² sloped, ridge 30.00 ft, reconcile 50/50 |
| Measurement delta (this is a geometry fix, not display-only) | Real property | Sloped 5,570.92 → 5,588.90 ft² (+0.32%). Eaves +5.7 ft, rakes −2.0 ft, steps +2.1 ft, valleys +0.9 ft, hips −0.5 ft; ridge and walls unchanged |
| Synthetic benchmark (120 seeds, 71 houses) | `bench/run.mjs` | Area MAPE 1.29% → 1.35%; ridge+hip within 10% 67.6% → 66.2%; eave+rake within 10% 73.2% → 74.6% |

Known and recorded: D15's short corner cut is traced at about 37° (true 45°); this predates the fix. The test now checks that it stays a diagonal and reports the angle. One synthetic house (56) went from 1 to 2 kinks.

## Backlog (not the active milestone)

- Milestone B: output inventory, report design department and competitor research, two report candidates, reader-task timing with real readers.
- Milestone C: fresh-user journey, scorecard, cost per report, disputed-measurement trace, sales sample, release verdict.
- Agent operations: catalogue all accessible models with a capability trial each, a durable queue with claim expiry and idempotent results, a 1,000-assignment simulation, and a persistent scheduler. The scheduler needs an authorized persistent host or CI schedule plus a spending authorization.
- Ridge/hip accuracy trade-off in the handoff tracer; step-flashing overestimate (ratio about 1.9).
