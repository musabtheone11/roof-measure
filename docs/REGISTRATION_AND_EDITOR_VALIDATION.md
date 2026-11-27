# Registration and editing evidence

## Supported preview behavior

Place the pin on a visible surface of the intended building in the dated source. The trace requires a matching mask at the selected location. A mask on a different structure cannot stand in for a missing roof, even if the returned Solar building centre falls on it. A disagreement between the selected component and another component supported by the Solar record requires review. Detached candidates are available separately in **Structures in this report**. A reviewer must positively include each candidate before it contributes quantities.

An accepted pin proves membership in a source mask. Parcel ownership, obstruction boundaries, a pool enclosure's construction, and agreement between different acquisition dates need independent review. Older saved reports retain their existing inclusions. Recheck structure scope when reopening them.

## Reproduction and disposition

| Reproduction | Observed at handoff revision `4806a12` | Candidate behavior |
| --- | --- | --- |
| Start a slow Places suggestion, lock a different house, then resolve the first suggestion. | The old selection changed the house back. | The late result and any fallback geocode are discarded. Direct geocoding, pin requests, autocomplete and restoring a job invalidate superseded selections. |
| Pin just outside a synthetic mask while the Solar centre and segment witness are inside it. | The provider-centred roof was selected. The existing D5 fixture also published geometry for a geocode 25 m from the roof. | The trace stops before publication. A pin on the supported roof still traces. |
| Trace a house and nearby smaller outbuilding in D10. | Both contributed by default. | Geometry remains available by structure. Candidate facets and edges start outside report scope. |
| Compare an imported rotated GeoTIFF at a chosen location. | The import and benchmark decoder used coordinate magnitude and unsigned north-up assumptions even though the main trace had a full affine transform. | The importer, trace and replay use the same forward/inverse conversion. Pixel-centre conventions, cross terms, reflection and independent x/y window resampling ratios are retained. Missing/unsupported frames fail. |
| Open the background image for a trace, or relocate before an alternate flight finishes loading. | The visual comparison looked up an obsolete cache key prefix. Another selection could receive the previous asynchronous result. | Only the corresponding recorded layer request can supply the background. Late alternate-image responses are discarded. Legacy traces without an identifiable original source require a fresh retrieval. |
| Drag the second of two nearby source-image vertices, with another finger touching during the move. | The first vertex within the tolerance won and drag events lacked pointer ownership. | The nearest handle within 12 CSS pixels wins. A drag remains bound to its pointer. Cancellation restores the original vertex. |
| Edit the current job while an automatic trace is waiting, or change the pin before the button's request fails. | Location changes had an engine guard, but same-location hand edits could be replaced and a stale button failure could annotate a new roof. | Compare the saved model revision before publishing, then update button and failure state only for the correct request and selection. |

The Golden Pond complaint cannot be scored at property level from this handoff. The private source imagery, exact selected point/job, original screenshot and an independent measurement reference are absent. The packaged history reports six old facets and sixteen lines after a synthetic pin move. The controlled failures above reproduce ways a different roof could be displayed. No geometric shift, label count or physical quantity has been inferred for the property. Obtain the authorized source and saved job with acquisition date, pin, raster registration and intended building boundary to replay and score it. Use the private evidence store.

## Frozen analytic validation manifest

`bench/roof-invariants.mjs` is the self-contained generator, case order and oracle manifest. Its SHA-256 with LF line endings is `5e33735fe8cbdfc17625d16cdb3b75507925860c44714ece5f2e27b34f09d92c`. Each row uses a separate seed. A fixture counts once regardless of its number of checks. These are synthetic engineering fixtures with no field references. None of the historical roof holdouts was used for these changes.

| Seed range (inclusive) | Fixtures | Oracle and supported transformations | Initial candidate run |
| --- | ---: | --- | ---: |
| 680001–682000 | 2,000 | Area of two rectangular facets, independently derived slope factors, one shared horizontal edge. Applies rigid planar translation, quarter-turn, reflection, reversed winding, positive unit scaling, unknown/flat/steep/mixed pitch. | 2,000 passed |
| 682001–684000 | 2,000 | Reject self-crossings and near-collinear triangles, detect positive-area overlap or disconnected outside facets and withhold aggregate physical area. | 2,000 passed |
| 684001–686000 | 2,000 | Subtract an opening from its unique matching host at the host pitch. A different structure's opening leaves an unresolved finding and the original host quantity. | 2,000 passed |
| 686001–688000 | 2,000 | Independently evaluate spherical Mercator equations for affine rotations, reflections, shears, translations and both pixel conventions. Test forward and inverse coordinates. Affine shear applies to the image grid, never as an area-preserving roof transform. | 2,000 passed |
| 688001–690000 | 2,000 | Map controlled client contacts through a contained image, offsets and positive display scaling at DPR 1, 1.5, 2 and 3. Move the nearest handle, ignore a second touch, preserve cancelled edits. | 2,000 passed |

The analytic checks use equality for release decisions and relative tolerance `1e-8 × max(1, |expected|)` for floating-point quantities. The Mercator forward comparison uses `1e-12` degrees. These tolerances control numerical comparison of exact constructions. No geographic field accuracy, field acceptance rate, or customer measurement tolerance follows from them.

## Reproduction commands

Use the pinned Node and npm dependencies described in the root README. Set `CHROMIUM_PATH` to the installed Chromium-family executable for the browser run.

```sh
node --test bench/target-intent-test.mjs
node bench/registrationtest.mjs
node bench/registration-stress.mjs
node bench/location-lifecycle-test.mjs
node bench/trace-race-test.mjs
node bench/fixtures.mjs
node bench/roof-invariants.mjs
node tools/dev/map-pointer-test.mjs
```

The local Chrome run used the real label renderer, DOM rectangles and editor pointer events at DPR 2. Of three labels at fixed synthetic anchors, the overlapping lower-priority label was hidden. Dragging the second of two nearby vertices on a letterboxed image changed that vertex and preserved the first. This test uses a synthetic map projection and sends no addresses to a map provider. It covers neither a live satellite basemap nor a physical mobile digitizer.
