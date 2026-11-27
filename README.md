# Roof Measure

The current supervised preview, known accuracy regressions and outstanding release gates are documented in the [release validation report](docs/RELEASE_VALIDATION.md).

A self-contained roof measurement and takeoff tool, like Roofr Measurements or EagleView, that runs in your browser from satellite imagery. No install needed.

## What it does

1. **Auto measure (Google Solar API).** Type an address and click *Get roof data*. Google's 3D roof model returns total roof area, footprint, and every roof plane with its pitch in degrees and x/12. Covers most US residential buildings.
2. **Trace the roof** on high-zoom Google satellite imagery:
   - **Facets** (roof planes): click the corners, double-click to finish. Each facet gets its own pitch. Area = plan area x pitch factor.
   - **Lines**: ridge, hip, valley, eave, rake, step flashing, headwall. Hips, valleys and rakes are converted from plan length to actual length using the pitch.
   - Corner snapping, live length readout while drawing, drag-to-edit corners, right-click a corner to delete it.
3. **Totals**: roof square feet, squares, squares with waste, linear footage per line type.
4. **Customer measurement report** with the grayscale Diversity Contracting design, measurement tables and review notes; no roof segmentation imagery. Private internal review retains the plan-first geometry.
5. **Save / export**: save roofs in the browser, export CSV or JSON, import JSON.

## The report

**Preview report**, **Print report** and **Download report** (panel 6) all use one generated PDF: the preview shows it inside the app, Print sends that same file to the print dialog, Download saves it. US Letter, grayscale, vector (selectable text), with the Diversity Contracting logo. The sheets are built from the selected job's own address, geometry and quantities:

1. **Customer measurement summary**: logo, property/date/status, supported area and length quantities, pitch information and review notes. No roof segmentation diagrams, source imagery or overlays appear in the default customer PDF.
2. **Measurement schedules**: building subtotals, area/pitch and edge schedules, with continuation pages when needed. Unknown values remain blank. Order quantities remain withheld for incomplete scope.
3. **Private internal review**: the original plan-first vector sheets remain available through explicit `internalReview: true`; they are not the default customer preview/export.

The durable local organization is documented in [workflow design](docs/APINEX_ORGANIZATION_DESIGN.md), [operations](docs/APINEX_ORGANIZATION_OPERATIONS.md) and [current validation](docs/APINEX_ORGANIZATION_VALIDATION.md). Its missing real-case/deployment adapters and local host access remain explicit blockers; it is not yet a verified always-on organization.

Preview, Print and Download use the same signature-cached PDF. A model edit during generation rejects the result; saved preview actions and delayed downloads also check the signature. Direct vector PDF generation checks the model revision across asynchronous image loading.

Jobs now save as version 4 with persistent `modelId` values and optional per-quantity `measurementEvidence`. `RM.auditEvidence` requires dated source, basis, measured status and an `RM.evidenceRevision(item, quantity)` binding for facet geometry/pitch/area and edge geometry/type/length. The review panel records each quantity separately and captures dated structure/scale confirmation in `trace.scopeEvidence`, bound to the current scope geometry. Changing that scope invalidates the confirmation. Missing/stale evidence triggers REVIEW REQUIRED; unsupported real-job quantities print blank. Legacy job flags alone do not establish provenance. Illustrative fixtures remain explicitly illustrative. See [validation and coverage](docs/PLAN_FIRST_VALIDATION.md).

Incomplete measurements are explicit: measured edges solid, evidence-backed continuations dashed, unresolved lines stippled, hidden or unresolved zones hatched. Unsupported dimensions, pitches and areas stay blank (never zero). A REVIEW REQUIRED report says what has been checked, how it was checked, and what still needs field review; a partial sketch is drawn when elevations are missing; every synthetic model is labelled illustrative.

`examples/residential-study.json` is an illustrative two-building model (main house 44 x 28 ft hip at 6/12, detached garage 20 x 16 ft gable at 4/12). Load it with *Import JSON*; it measures 1,714.73 ft² / 17.15 SQ and `bench/reporttest.mjs` checks that in CI. `node tools/dev/handoff-examples.mjs` rebuilds it. `node tools/dev/run-app.mjs --job <file>` (or `--address`) runs Preview, Print and Download through the real UI and fails if the three do not carry the same bytes or if the report's own layout check fails (exact scale: a known length draws at length × 72 / feet-per-inch points; every edge key on the plan, on a detail sheet, or named as unplaced). Each plan states its scale bar's paper length so the print scale can be checked with a ruler, and every fully measured building gets overall width and depth dimensions. The layout rules live in `.claude/skills/roof-sketch-layout/SKILL.md`.

Known limits: the PDF uses Helvetica (built into the PDF library) rather than the design's Segoe UI; keys that find no room even on the detail sheets are named there with their lengths in the schedule; the materials sheet is optional and shows order quantities, not measurements.

The "Recommended" waste in the materials list is computed the way Roofr does it, from the cut edges on the roof: hips + valleys + rakes + step flashing in linear feet per square of roof area, roughly 1% plus 1.18% per foot-per-square, rounded. Each structure gets its own recommendation. The waste selector in the app drives the quick materials list in the sidebar and the report's waste and order line.

## Auto-trace (no hand tracing)

**Auto-trace roof** (panel 2, after *Get roof data*) builds the whole measurement automatically. It downloads Google's building mask and roof height model for the house (10 cm per pixel), assigns every roof pixel to one of Google's roof planes, turns the planes into facets with straight edges snapped to the building's axis and 45-degree diagonals, and classifies every edge as eave, rake, ridge, hip, valley, step flashing, wall flashing or transition from the plane geometry. Outbuildings inside the frame (sheds, detached garages) are traced as separate structures. One auto-trace costs about 10 cents of Google API usage. You can still adjust any facet or line afterwards with the normal tools.

Tested on 50 random Jacksonville houses; see `reports/_batch_results.json` for the numbers.

## Review, tree obstructions and the PDF report

**5. Review before export** (new panel). After a trace the panel shows what the totals are based on and lets you correct them on the photo:

- **Status of every facet and line**: *Measured* (confirmed: seen on georeferenced imagery), *Inferred* (hidden, placed from stated evidence, with a range; drawn dashed) or *Unresolved* (hidden, no evidence). Unresolved items are never reported as zero: they are listed, the totals are flagged, and every export (PDF, print, HTML, CSV, estimate) asks you to confirm.
- **Tree canopy layer**: canopy is found from the height model plus the aerial colour layer (tall, rough, greener than this roof's own colour); anything else tall standing beside the roof is treated the same way. Where it is detected it is never traced as the roof edge. Detection is not perfect: on the synthetic benchmark 3 of 200 tree-covered roofs still came out more than 5% short with nothing flagged, so compare the roofline with the photo before export.
  - Where the visible roof stops at the canopy, the outline is left **open**: that stretch is an *obstruction boundary*, not an eave or rake, and is counted in no line total.
  - A roof plane is continued under the canopy only where something seen backs it: the same plane visible beyond the canopy, the opposite face of the same ridge, or Google's building outline, and only down to a measured eave height. That part is an *estimate* (Inferred) with a range.
  - Everything else under the canopy is a **hidden zone**: hatched on the map and in the PDF, reported as "0 to N sq ft", and left out of every total until another source resolves it.
  - Trees near the roof and other structures are listed separately, with heights above the ground beside the house. The house and each detached structure get their own subtotals.
- **Geometry checks**: self-intersections, overlaps on the same roof level, doubled corners, near-miss joins, duplicate lines, tracing artifacts and outline with no line type. "Fix what can be fixed safely" joins corners and removes duplicates; overlaps and artifacts are left for you to decide. The raw auto-trace is kept (tick *Show raw trace*) and is saved in the JSON export for audit.
- **Corrections**: click a facet or line to move corners, change type, pitch, roof level and status, or add a note. Untick a structure to leave it out. Every total recalculates.
- **Imagery age**: Google's height model can be years old; the panel and the report say so when it is over 3 years.

**Review roof from other angles** (button at the top of the review panel, and *Other angles* on the map toolbar). Opens a panel centred on the selected building with three tabs. Every source is shown with its name and date.

- **3D view**: Google's photorealistic 3D model where it exists: *Overhead*, *From north / east / south / west* and free orbit. Use the tilted views to look for hidden eaves, corners and roof levels; the traced roofline is drawn on the model. It is a viewing aid: the model is too coarse to measure on, Google publishes no capture date for it and does not allow tracing from it. An edge you can see there but cannot measure gets *Mark edge for verification* (click the edge), which flags it in the review panel and the PDF. Where there is no 3D model the panel says so.
- **Dated imagery**: lists every dated image of the building it can find and lets you swipe each against the image the trace was made from:
  - *Google Solar datasets*: Google keeps one per quality tier, often flown years apart. A second dataset has its own height model. **Check roof configuration** compares it with the roof the trace image sees clearly (heights after removing the offset and tilt between the two models, outline, roof height above the ground). Only if that passes, and you tick that it is the same roof, **Carry edges into the sketch** re-traces using the second dataset for the canopy-covered part. Facets and lines taken from it are tagged with the source and date; the PDF lists them by line type and prints the check. A second dataset below Google's HIGH quality is softer (edges good to about 1.3 ft, outline runs large), so what it supplies is an **estimate**: dashed lines, a range, never added to the confirmed area.
  - *USDA NAIP aerial photos* (public domain, every 2 to 3 years, 30 to 100 cm per pixel): enough to see whether a tree is gone and what the roof looks like, too coarse to place an edge. Comparison only.
  - *Florida county orthophotos* (FDOT / Dept. of Revenue flights, public record, served by Florida DEP; Florida addresses only): 15 cm per pixel, flown in winter with the leaves off, so a roof often shows through a bare tree. They are rectified to the ground, not the roof, so roof edges can sit a couple of feet off. Comparison only.
  - A nudge control lines a photo from another source up with the trace image.
  - Click a line to *Mark for verification*, or to *Confirm on this image* where the image can place an edge (a HIGH-quality height-model dataset, or an imported true orthomosaic of 20 cm per pixel or finer); click a hatched zone to carry it in as an estimate when the other image shows the same roof there.
- **Import imagery**: your own authorised imagery. A georeferenced GeoTIFF (drone orthomosaic, licensed export; WGS84, UTM or Web Mercator) is compared like dated imagery; tick *true orthomosaic* if roofs are rectified in it. A plain JPG / PNG (oblique or drone photo) is a viewing aid: what it shows can be marked for verification, not measured.

Lengths and areas only ever come from georeferenced overhead imagery or a height model. The PDF's *Other views & evidence* page lists the views checked, what each one resolved, what is still open, and the reviewer log.

Licence notes for the owner: Google's terms restrict tracing from its map imagery and limit Solar API use to certain purposes; check that the company's Google agreement covers roof measurement before relying on this commercially. Esri's dated imagery (Wayback) needs an ArcGIS subscription and was left out for that reason. The NAIP photos are public domain, but they are fetched through Microsoft's Planetary Computer, a preview service with no uptime commitment: treat that list as optional. The Florida orthophotos are public record; the state publishes no licence text and gives no warranty.

**Measurement rules** (one module, `roofmodel.js`, used by the screen, the PDF and the benchmark):

- Plan (projected) area and sloped area are separate. Sloped = plan x sqrt(1 + slope^2), using the plane fitted to the height model for auto-traced facets and the assigned pitch for hand-drawn or hand-corrected ones.
- True line length = plan length x slope factor: from the fitted roof plane for auto-traced lines, from the adjoining pitch for hand-drawn ones. The line schedule says which.
- Each line is counted once in one category. A height break is two physical lines on one plan line (the upper roof's eave or rake, and the flashing on the lower roof): both are counted, each in its own category.
- Totals are sums of unrounded values; waste and order quantities are shown separately from the net area; the report prints its own reconciliation checks.
- Distances use the WGS84 ellipsoid at the roof's latitude (the old spherical formula read north-south distances 0.4% long).

The report (see *The report* above) states the **confirmed sloped area first**, then any supported estimate for hidden roof with its evidence and range, and shows hidden zones as hatched review items that are in no total. The aerial overlay in the app and every sheet of the report use the same geometry and facet IDs (obstruction boundaries appear as gaps, hidden zones as hatching).

## Commercial tab (flat / low-slope roofs)

Click **Commercial** at the top of the left panel. Enter the address, then press **Measure commercial roof**. The tool downloads Google's roof mask and 3D surface model for the whole building (10 cm pixels up to about 650 ft across, 25 cm pixels for larger buildings) and measures:

- the roof outline squared to the building, with courtyards left open
- roof sections by elevation, with plan area, slope in inches per foot, height above ground and fall direction; steep sections are flagged and use sloped area
- every perimeter edge as a parapet wall (with its height), a high wall, or an open roof edge
- walls between roof levels with their height, and level joints
- rooftop units, exhaust fans, curbs, vents, duct runs and expansion joints, with sizes, heights and curb flashing length
- ASCE 7-22 roof wind zones 1', 1, 2 and 3 for the measured roof height
- a drain estimate and the overflow scuppers a parapet roof needs

**Commercial report** (Print / PDF or Download) has these pages:

1. Cover with key numbers and the aerial with the measured outline.
2. Roof plan.
3. Measurements and roof sections.
4. Perimeter, parapets and walls, with a parapet area table.
5. Rooftop equipment, penetrations and drainage.
6. Wind zones and Jacksonville code notes.
7. Material estimate for the chosen system.
8. Side-by-side comparison of TPO, PVC, EPDM, SBS modified bitumen and silicone coating.
9. Method and limits.

**Material estimates** cover:

- membrane rolls, perimeter half-sheets, fasteners and plates or bonding adhesive
- seam items, corners, pipe boots and pitch pans
- polyiso layers that reach the R-25 continuous insulation required for Jacksonville tear-offs, plus cover board and tapered insulation
- coping, edge metal, termination bar and counter-flashing
- drains, scuppers and walkway pads

Coverage rates come from Carlisle, GAF, Johns Manville and GacoFlex data sheets. Code notes cover the FBC 2023, the COJ wind-speed line (125 / 130 mph), FBC-Energy R-25ci, FBC-Plumbing 1108 overflow drainage and FBC-EB 706 reroof rules.

Enter site counts the surface model cannot see (drains, scuppers, skylights, hatches) in the panel to override the estimates.

## Permit history and roof age

When you enter an address, the Property panel looks up the permit history. Both reports then show the roof age on the cover and include a **Permit history & roof age** page. That page lists the last roof permit issued and the last one submitted, every roofing permit, other permits at the address, the year built and the roof cover type.

- **City of Jacksonville:** permits are matched by parcel number, so street-name spellings and directions don't matter. The desktop app reads the city's JAXEPICS system live and shows every permit at the parcel. The public web page reads a published copy of every city roofing permit in the `permits/` folder: 371,000 permits on 232,000 parcels, 1984 to today. That copy includes the permit number, issue and final dates, status, work type, contractor and cost.
- **Refreshing the copy:** run the harvest in the desktop app (`reports/_tools`), rebuild with `permitindex.js`, and upload the `permits/` folder. Permits issued after the copy date only show on the desktop app until then.
- **Test:** on 130 random Jacksonville single-family homes, the parcel match found the parcel for all 130 and a roofing permit for 99. The published copy agreed with the live city data on all 130. The older address search had missed 19 of them, all with a direction in the street name.
- **Duval County Property Appraiser:** the roof structure and roof cover come through the local server.
- **Clay County:** permits come from the county's EnerGov system through the local server. Its online records start in January 2023.
- **Jacksonville Beach, Atlantic Beach, Neptune Beach, St. Johns and Nassau:** these have no public permit feed. The panel links to their permit portal, and you can enter the last roof permit date by hand.
- **Year built, any Florida county:** comes from the Florida Department of Revenue parcel roll.

Roof age counts from the issue date of the newest roofing permit. If no roofing permit is on file, it counts from the year built.

## Structures, sheds and special cases

- **Detached structures.** Facets that touch each other form one structure. A shed or detached garage you trace separately becomes Structure #2 automatically, with its own summary page.
- **Finding them.** *Scan for other structures* (panel 2) probes 24 points around the pin with Google's Solar API and marks every other building it knows about with an orange box, its roof area and pitch. Trace each one with the Facet tool.
- **Skylights, chimneys, cutouts.** Draw them as a facet, select it and tick *Exclude*. Their area is subtracted and they print dashed, like Roofr's deleted facets.
- **Two story and two layer.** Tick the flags on a facet; the areas roll up into the area report and summaries.
- **Flat roofs.** Use pitch 0 (Flat). Flat area is reported separately and excluded from shingle quantities.
- **Line types** cover every Roofr category: eave, valley, hip, ridge, rake, wall flashing, step flashing, transition, parapet wall and unspecified. Hips, valleys and rakes take the pitch of the facet they run along; override per line if needed.

**Company details** (name, phone, email, website, license, office address) are under *6. Report, save & export > Company details*. They are saved in the browser. The *Prepared by (rep)* field prints on the cover.

A sample report is in `reports/Sample Roof Report.html`.

## Setup (one time, about 5 minutes)

You need one Google Maps Platform API key.

1. Go to https://console.cloud.google.com and create a project. Enable billing. Google gives a monthly free credit for Maps Platform that covers typical use.
2. **APIs & Services > Library**, enable:
   - Maps JavaScript API
   - Geocoding API
   - Solar API
   - Maps Static API (the satellite photo on the report cover)
   - Places API (New) (address suggestions; without it the suggestions come from Esri's free geocoder)
3. **APIs & Services > Credentials > Create credentials > API key.** Click the key, set *API restrictions* to the APIs above. Leave *Website restrictions* at "None" if you open the HTML file directly by double-clicking it (browsers send no referrer for local files).
4. Double-click `index.html`, paste the key into the *Google Maps API key* box, click **Save**.

The key is stored only in your browser's local storage. It is never written into downloaded reports.

## Daily use

1. Start typing the address. Suggestions appear under the box after the first few characters, nearest to the map area first. Pick one with the mouse or the arrow keys and Enter, or type the full address and press Go. The map jumps to the house at street-level zoom.
   - **No address?** Double-click the house on the map to lock it in. Or press **Pick on map** and click the house. You can also move the map with the arrow keys (Shift for small steps) until the red + sits on the roof, then press Enter or **Lock center**. Esc cancels.
   - The locked house gets a red pin. Drag the pin to move it. The address box fills in from Google's nearest street address. If there is none, it shows the coordinates.
2. Click **Get roof data**. Read off total area, squares, and main pitch. Click *Use X/12 as default pitch*. Uncheck *Show planes on map* to see the roof clearly.
3. Pick the **Facet** tool, click around each roof plane. Double-click, press Enter, or click the first corner to close. Points snap to existing corners so adjacent facets share edges.
4. Trace **Ridge / Hip / Valley / Eave / Rake** lines on top for linear footage. Those drive the starter, ice and water, cap, drip edge and valley quantities on the report.
5. Adjust pitch per facet in the Facets list if some planes differ.
6. Set the waste factor, type the customer name, and click **Preview report**, **Print report** or **Download report** (all three are the same PDF).

Keyboard: `S` select, `F` facet, `E` eave, `V` valley, `H` hip, `R` ridge, `K` rake, `W` wall flashing, `T` step flashing, `N` transition, `P` parapet, `U` unspecified, `Enter` finish, `Backspace` undo point, `Esc` cancel, `Delete` remove selected.

Check pitch with the **Street View** and **Google Earth 3D** links in the Property panel when the Solar API has no coverage.

## Optional: local server

`Start Roof Measure (local server).bat` runs the app at http://localhost:8080/ using `serve.ps1`. Use it if you restrict your API key by website (add `http://localhost:8080/*`). The server also accepts saved reports into the `reports` folder.

## Accuracy notes

- Google's satellite imagery is orthorectified; traced lengths are typically within a few percent of tape measurements. Trace along the visible eave line.
- Pitch cannot be measured from a straight-down photo. Use the Solar API pitch, Street View, or a field check.
- Hip and valley actual lengths assume equal pitch on both sides and a 90 degree corner. Use the per-line pitch override for odd cases.
- Material quantities are rules of thumb based on published coverage. Adjust the catalog or the assumptions under *Material coverage assumptions*.

## Files

- `index.html` - the app
- `app.js` - map, tracing, measurement engine
- `roofmodel.js` - coordinate math, measurement rules, geometry audit and reconciliation (shared by app, PDF and benchmark)
- `report.js` - report delivery (one generated PDF for preview, print and download), company details, brand material catalog, estimate PDF
- `roofpdf.js` - the US Letter report: roof overview & takeoff, scaled measurement plan, detail / schedule / evidence sheets
- `examples/residential-study.json` - illustrative two-building example job (1,714.73 ft²); `assets/logo-black.png` - the black-and-white logo used on the report
- `review.js` - "Review before export" panel, status and obstruction overlays, export gate
- `altview.js` - "Review roof from other angles": 3D views, dated imagery (Google Solar tiers, USDA NAIP), imported imagery, second-dataset check
- `autotrace.js`, `autotrace2.js` - automatic roof tracing from Google's roof height model
- `obstruction.js` - tree canopy / nearby structure layer and inference of roof hidden under canopy
- `bench/` - synthetic and real-house accuracy benchmarks (see `bench/README.md`, `bench/REAL_RESULTS.md`)
- `tools/dev/` - cross-platform local server, the headless address-to-PDF runner (`run-app.mjs`, also `--job` for a saved job; checks Preview, Print and Download agree) and the example-job builder (`handoff-examples.mjs`)
- `commercial.js` - commercial (flat roof) measuring, materials and wind zones
- `commercial_report.js` - the commercial roof report
- `permits.js` - permit history and roof age (city / county permit records, year built)
- `pin.js` - lock in a house from the map (double-click, pick mode, arrow keys, draggable pin)
- `autocomplete.js` - address suggestions while typing (Google Places, with Esri as a fallback)
- `styles.css` - screen and print styles
- `serve.ps1` / `Start Roof Measure (local server).bat` - optional local server

### Local API verification

`node tools/dev/check-apis.mjs` reads `GOOGLE_MAPS_KEY` and `APINEX_API_KEY` from the process environment. It checks Google Geocoding/Solar and makes the authenticated APInex `GET /v1/models` request. It prints statuses and discovered model IDs, never credentials. APINEX also powers the server-side image-review runtime described below; no secret is shipped in public JavaScript. A missing key is recorded as not run. Do not place credentials in tracked files.

For report UI checks without a key, `node tools/dev/run-app.mjs --offline --job <illustrative-job.json> --out <directory>` uses a test-only geometry adapter. This verifies PDF delivery/layout, not Google imagery, geocoding, orbit rendering or numerical accuracy on real properties.

On Node 24 behind an environment HTTP proxy, use `node --use-env-proxy tools/dev/check-apis.mjs`.

## Server-backed AI image review

The **AI roof tracing & image review** panel opens an editable source-image plan.
The Node runtime calls verified APINEX models for image quality, outline, structure,
blind independent tracing, and disputed-region adjudication. Geometry and measurements
are calculated locally on the server. Explicit image consent, verified overhead scale,
and supported pitch are required for their respective operations; AI results remain
REVIEW REQUIRED. Uploaded-image reviews export correction/provenance JSON and stay
separate from the existing map job and PDF until geographic placement is verified.

Run Node 24 with `APINEX_API_KEY` in the environment, `npm ci --prefix bench`,
and `npm start`. Open the server's port 3000 and the AI image review panel.
Static GitHub Pages cannot host this secret-backed API. See [runtime setup](server/README.md)
and [provider verification and measured limitations](docs/API_VERIFICATION.md).

`npm run test:runtime` and `node bench/runtime-agents-test.mjs` test deterministic
geometry and real local HTTP orchestration without paid requests.

The image-review workspace also opens local PDFs (selected page only), rotates pages,
reopens hash-matched review JSON, and exports a branded source-image review PDF.
Page/source changes clear calibration and consent. Printed dimensions remain
source-reported annotations until independently verified. Source review PDFs do
not invent geographic placement, north, or purchasing quantities.

The private single-process container preview is described in
[private preview deployment](docs/PRIVATE_PREVIEW_DEPLOYMENT.md). The ongoing
[supervision ledger](docs/ENHANCEMENT_SUPERVISION.md) distinguishes accepted fixes
from remaining defects and access blockers.
