# Roof Measure

A self-contained roof measurement and takeoff tool, like Roofr Measurements or EagleView, that runs in your browser from satellite imagery. No install needed.

## What it does

1. **Auto measure (Google Solar API).** Type an address and click *Get roof data*. Google's 3D roof model returns total roof area, footprint, and every roof plane with its pitch in degrees and x/12. Covers most US residential buildings.
2. **Trace the roof** on high-zoom Google satellite imagery:
   - **Facets** (roof planes): click the corners, double-click to finish. Each facet gets its own pitch. Area = plan area x pitch factor.
   - **Lines**: ridge, hip, valley, eave, rake, step flashing, headwall. Hips, valleys and rakes are converted from plan length to actual length using the pitch.
   - Corner snapping, live length readout while drawing, drag-to-edit corners, right-click a corner to delete it.
3. **Totals**: roof square feet, squares, squares with waste, linear footage per line type.
4. **Report in Roofr's format** (same pages, tables, wording and brand bundle counts), without a logo.
5. **Save / export**: save roofs in the browser, export CSV or JSON, import JSON.

## The report

*Print / PDF report* opens the print dialog (choose "Save as PDF"). *Download report* saves a self-contained HTML file with its own Print button (on the local server it saves straight into the `reports` folder). The pages follow Roofr's roof report exactly:

1. Cover: "Roof Report", prepared by, total sqft, facet count, predominant pitch, address, satellite photo and imagery date.
2. Diagram: all structures at one scale, facets shaded by pitch; excluded facets (skylights, chimneys) drawn dashed.
3. Length measurement report: Eaves, Valleys, Hips, Ridges, Rakes, Wall flashing, Step flashing, Transitions, Parapet wall, Unspecified, plus the diagram with every edge length.
4. Area measurement report: total, pitched, flat, two story, two layer, predominant pitch and its area, unspecified pitch area, plus facet areas on the diagram.
5. Pitch & direction measurement report: pitch per facet with down-slope arrows.
6. Structure #1, #2... summary: one page per detached structure (house, shed, detached garage) with Measurements, Pitch and Waste tables. Only printed when there is more than one structure.
7. Report summary: the same tables for everything combined.
8. Material calculations: Shingle, Starter, Ice and Water, Synthetic, Capping by brand (IKO, CertainTeed, GAF, Owens Corning, Atlas) in bundles or rolls at 0%, your chosen waste, 10% and 15%, plus valley metal and drip edge sheets.

The "Recommended" waste column is computed the way Roofr does it, from the cut edges on the roof: hips + valleys + rakes + step flashing in linear feet per square of roof area, roughly 1% plus 1.18% per foot-per-square, rounded. This reproduces every recommendation in your Roofr reports (6%, 7%, 11%, 12%, 33% and 10% for flat roofs). Each structure gets its own recommendation. The waste selector in the app only drives the quick materials list in the sidebar.

## Auto-trace (no hand tracing)

**Auto-trace roof** (panel 2, after *Get roof data*) builds the whole measurement automatically. It downloads Google's building mask and roof height model for the house (10 cm per pixel), assigns every roof pixel to one of Google's roof planes, turns the planes into facets with straight edges snapped to the building's axis and 45-degree diagonals, and classifies every edge as eave, rake, ridge, hip, valley, step flashing, wall flashing or transition from the plane geometry. Outbuildings inside the frame (sheds, detached garages) are traced as separate structures. One auto-trace costs about 10 cents of Google API usage. You can still adjust any facet or line afterwards with the normal tools.

Tested on 50 random Jacksonville houses; see `reports/_batch_results.json` for the numbers.

## Review, tree obstructions and the PDF report

**5. Review before export** (new panel). After a trace the panel shows what the totals are based on and lets you correct them on the photo:

- **Status of every facet and line**: *Measured* (confirmed: seen on georeferenced imagery), *Inferred* (hidden, placed from stated evidence, with a range; drawn dashed) or *Unresolved* (hidden, no evidence). Unresolved items are never reported as zero: they are listed, the totals are flagged, and every export (PDF, print, HTML, CSV, estimate) asks you to confirm.
- **Tree canopy layer**: canopy is found from the height model plus the aerial colour layer (tall, rough, greener than this roof's own colour) and is never traced as the roof edge.
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
  - *Google Solar datasets*: Google keeps one per quality tier, often flown years apart. A second dataset has its own height model. **Check roof configuration** compares it with the roof the trace image sees clearly (heights after removing the offset and tilt between the two models, outline, roof height above the ground). Only if that passes, and you tick that it is the same roof, **Carry edges into the sketch** re-traces using the second dataset for the canopy-covered part. Facets and lines taken from it are tagged with the source and date; the PDF lists them by line type and prints the check.
  - *USDA NAIP aerial photos* (public domain, every 2 to 3 years, 30 to 100 cm per pixel): enough to see whether a tree is gone and what the roof looks like, too coarse to place an edge, so they are comparison-only. A nudge control lines the photo up with the trace image.
  - Click a line to *Confirm on this image* (only on a height-model dataset or an image of 20 cm per pixel or finer) or *Mark for verification*; click a hatched zone to carry it in as an estimate when the other image shows the same roof there.
- **Import imagery**: your own authorised imagery. A georeferenced GeoTIFF (drone orthomosaic, licensed export; WGS84, UTM or Web Mercator) is compared like dated imagery. A plain JPG / PNG (oblique or drone photo) is a viewing aid: what it shows can be marked for verification, not measured.

Lengths and areas only ever come from georeferenced overhead imagery or a height model. The PDF's *Other views & evidence* page lists the views checked, what each one resolved, what is still open, and the reviewer log.

Licence notes for the owner: Google's terms restrict tracing from its map imagery and limit Solar API use to certain purposes; Esri's dated imagery (Wayback) needs an ArcGIS subscription and was left out for that reason. Check that the company's Google agreement covers roof measurement before relying on this commercially.

**Measurement rules** (one module, `roofmodel.js`, used by the screen, the PDF and the benchmark):

- Plan (projected) area and sloped area are separate. Sloped = plan x sqrt(1 + slope^2), using the plane fitted to the height model for auto-traced facets and the assigned pitch for hand-drawn or hand-corrected ones.
- True line length = plan length x slope factor: from the fitted roof plane for auto-traced lines, from the adjoining pitch for hand-drawn ones. The line schedule says which.
- Each line is counted once in one category. A height break is two physical lines on one plan line (the upper roof's eave or rake, and the flashing on the lower roof): both are counted, each in its own category.
- Totals are sums of unrounded values; waste and order quantities are shown separately from the net area; the report prints its own reconciliation checks.
- Distances use the WGS84 ellipsoid at the roof's latitude (the old spherical formula read north-south distances 0.4% long).

**Download PDF report** now draws the report directly as vectors with selectable text. The summary states the **confirmed sloped area first**, then any supported estimate for hidden roof with its evidence and range, and says the full roof area is unresolved when hidden zones remain. The aerial overlay and every plan use the same geometry and facet IDs (obstruction boundaries appear as gaps, hidden zones as hatching). Pages: summary, aerial with roofline, to-scale roof plan (north arrow, scale bar), length / area / pitch diagrams with the same facet IDs, enlarged length-diagram windows for busy roofs, facet schedule, line schedule (every line keyed to the diagram), trees and obstructions, other views and evidence, totals with subtotals by structure, counting rules and reconciliation, optional 3D view and material quantities. *Print* and *Download report* (HTML) keep the earlier layout.

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
6. Set the waste factor, type the customer name, and click **Print / PDF report** or **Download report**.

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
- `report.js` - Roofr-format HTML report, company details, brand material catalog
- `roofpdf.js` - the vector PDF report (Diversity Contracting header, schedules, diagrams)
- `review.js` - "Review before export" panel, status and obstruction overlays, export gate
- `altview.js` - "Review roof from other angles": 3D views, dated imagery (Google Solar tiers, USDA NAIP), imported imagery, second-dataset check
- `autotrace.js`, `autotrace2.js` - automatic roof tracing from Google's roof height model
- `obstruction.js` - tree canopy / nearby structure layer and inference of roof hidden under canopy
- `bench/` - synthetic and real-house accuracy benchmarks (see `bench/README.md`, `bench/REAL_RESULTS.md`)
- `tools/dev/` - cross-platform local server and a headless address-to-PDF runner
- `commercial.js` - commercial (flat roof) measuring, materials and wind zones
- `commercial_report.js` - the commercial roof report
- `permits.js` - permit history and roof age (city / county permit records, year built)
- `pin.js` - lock in a house from the map (double-click, pick mode, arrow keys, draggable pin)
- `autocomplete.js` - address suggestions while typing (Google Places, with Esri as a fallback)
- `styles.css` - screen and print styles
- `serve.ps1` / `Start Roof Measure (local server).bat` - optional local server
