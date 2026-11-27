# Output inventory (Milestone B, step 1)

Every customer-facing function or output, where it appears today, and the check that proves it works.
Verified 2026-11-27 on main `53b6816` with a real traced job (36 facets), driven through the interface by `tools/dev/output-inventory.mjs` plus direct checks.

| Output | Where | Result | Check / evidence |
|---|---|---|---|
| Measurements CSV | Panel 6, Export CSV | Works | 245 lines with header (inventory runner) |
| Roof JSON | Panel 6, Export JSON | Works | app `roof-measure`, version 4; facets 36/36, lines 177/177 |
| Import JSON | Panel 6, Import JSON | Works | Round trip: 36 facets, 5,483.29 ft², identical |
| Roof report PDF | Panel 6, Download report | Works | 10 sheets: plan, takeoff and summary present. Every printed value reconciles (`run-app` 319/319) |
| Report preview / print | Panel 6 | Works | Same bytes as the download (`run-app` report-check, SHA-256) |
| Report: material order sheet option | Panel 6, options | Withheld by design | Not printed while the report is REVIEW REQUIRED |
| Report: 3D illustration option | Panel 6, options | Works | Toggles; drawn only when elevations validate |
| Estimate PDF | Panel 7 | Works | 8 pages in about 22 s (direct check; the runner's 300 s wait missed it, a runner issue) |
| Estimate HTML / Print | Panel 7 | Works | 67 kB, table and prices present; print requested |
| Report + estimate PDF | Panels 6 and 7 | Works, two findings | 18 pages (report plus estimate). **Estimate pages are images: not searchable or copyable. Estimate header says "DIVERSITY ROOFING"; the report says "Diversity Contracting"** |
| Drone flight plan | Panel 8, Plan flight | Works | Plan built; exports enabled |
| Generic KMZ / Litchi CSV | Panel 8 | Works | Both download |
| DJI Fly KMZ | Panel 8 | Needs user input | Asks the user to pick their DJI Fly placeholder route (.kmz) first, by design |
| Send to DJI Fly | Panel 8 | Manual | Needs a phone on USB and a local install; hidden on the hosted site |
| Save this roof / reopen | Panel 6 | Works | Saved in browser storage |
| AI image review | Panel 5 | Covered | Static-hosting message: `static-ai-test`; server workflow: `ai-*-test` |
| Review from other angles | Panel 5 | Covered | `run-app --alt` |
| Commercial report | Commercial mode | Not yet run | Needs a commercial address run (`--commercial`) |
| Leads CSVs | Leads mode | Not yet run | Needs an external public-record lead search |
| Permits lookup | Panel 2 | Not yet run | External county sources |

No page errors occurred during the run.

## Findings to fix in Milestone B
1. Estimate pages in the PDF are raster images: the recipient can't search or copy line items.
2. Brand name mismatch between the estimate ("DIVERSITY ROOFING") and the report ("Diversity Contracting").
3. Commercial, leads and permits outputs still need a verification run.
