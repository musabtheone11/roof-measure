# APInex review evidence — 2026-11-25

The local tooling made an authenticated `GET /v1/models` (HTTP 200), then used only returned exact IDs with `POST /v1/chat/completions`, Bearer authentication, and `model`/`messages` bodies. Credentials were read from the process environment and never written to results or prompts.

All inputs were synthetic numeric fixtures, public implementation concepts, or authorized synthetic report renders. No private property files, addresses, customer imagery, or benchmarks were submitted.

## Known-answer math trials

All 44 returned IDs received a distinct rectangular-roof fixture with an independently calculated oracle. 28 responded; 20 matched to 0.015 sq ft; the remaining responses were not adopted. Sixteen requests failed with HTTP 429. Every result is retained locally in `roof-delivery/api/trial-XX.json`. Concurrency was bounded at four; response budget 700 tokens; timeout 35 seconds.

| Exact model ID | Trial outcome |
|---|---|
| `claude-fable-5.2` | Math answer rejected |
| `claude-opus-5.5` | Known-answer pass |
| `claude-sonnet-5.5` | Math answer rejected |
| `deepseek-v4-flash` | Math answer rejected |
| `deepseek-v4-pro` | Math answer rejected |
| `deepseek-v4.1-flash` | Known-answer pass |
| `free/claude-opus-4.6` | Known-answer pass |
| `free/claude-sonnet-4.6` | Known-answer pass |
| `free/deepseek-v4-flash-0731` | Known-answer pass |
| `free/deepseek-v4-pro-0813` | Math answer rejected |
| `free/deepseek-v4.1-flash` | Known-answer pass |
| `free/glm-5.3` | Known-answer pass |
| `free/glm-5.3-flashx` | Known-answer pass |
| `free/glm-5.3-flash` | Known-answer pass |
| `free/gemini-3.1-pro` | Known-answer pass |
| `free/gemini-3.8-flash` | Known-answer pass |
| `free/gemini-4-hydrogen` | Known-answer pass |
| `free/gpt-6-luna` | Known-answer pass |
| `free/hy4` | Known-answer pass |
| `free/hy4-flash` | Known-answer pass |
| `free/kimi-k2.8` | Known-answer pass |
| `free/kimi-k3` | Math answer rejected |
| `free/mimo-v2.6-flash` | Known-answer pass |
| `free/mimo-v2.6-pro` | Math answer rejected |
| `free/minimax-m3` | Known-answer pass |
| `free/minimax-m3.1-flash` | Known-answer pass |
| `free/muse-spark-1.3` | Known-answer pass |
| `free/qwen-3.8-max` | Math answer rejected |
| `glm-5.3` | HTTP 429 |
| `glm-5.3-flash` | HTTP 429 |
| `gpt-6-luna` | HTTP 429 |
| `gpt-6.1-terra` | HTTP 429 |
| `gpt-6.2-astra` | HTTP 429 |
| `gpt-6.2-sol` | HTTP 429 |
| `gemini-3.8-flash` | HTTP 429 |
| `gemini-4-argon` | HTTP 429 |
| `gemini-4-carbon` | HTTP 429 |
| `gemini-4-hydrogen` | HTTP 429 |
| `grok-4.7` | HTTP 429 |
| `drex-v2.0` | HTTP 429 |
| `jev-1.13` | HTTP 429 |
| `kimi-k3.1-pro` | HTTP 429 |
| `muse-spark-1.3` | HTTP 429 |
| `hy4-preview` | HTTP 429 |

## Vision and design trials

The multimodal trial supplied a complete 640×480 synthetic drawing and two overlapping unscaled 380×360 crops with full-image origins (0,60) and (260,60). The main rectangle's known corners were (100,120), (500,120), (500,360), (100,360); an interior ridge and detached neighboring rectangle had to be excluded.

`claude-opus-5.5` and `gpt-6.2-astra` independently returned all four main corners within 2.83 pixels, identified the interior ridge, and excluded the detached neighbor. This establishes compatibility on a clean synthetic image only; it does not establish aerial-roof tracing accuracy. `gpt-6.1-terra` and `gemini-4-carbon` returned HTTP 429. The subsequent complex synthetic PDF render review requests to both successful models also returned HTTP 429; no visual-review finding from those requests was claimed.

## Follow-up adversarial review

Four capable math models received distinct new tasks concerning default-pitch dependency, equal-area wrong outlines, print-size design requirements, and canopy evidence. All four first follow-ups returned HTTP 429. A second bounded batch used different previously successful models; its outcomes are recorded separately. No model proposal was adopted without an independent local check.

Vision outputs and full/crop synthetic images are retained locally under `roof-delivery/api`. These trials do not provide numerical property accuracy or an APInex-assisted property-engine benchmark. API errors and unsuitable math answers are coverage gaps, not passes.

The second follow-up batch returned four responses:

- `free/glm-5.3`: noticed pitch dependencies but changed the premise to an explicitly pitched edge. Its proposed expected behavior was not adopted. The actual absent-edge-pitch case was independently reproduced locally and fixed by binding inherited facet/default-pitch dependencies into evidence revisions.
- `free/gemini-3.1-pro`: supplied an 8-square-unit rectangle and triangle. Their equal areas were independently verified; its triangle-perimeter expression omitted one 2-unit side and was rejected. The equal-area-outline rejection regression already existed and passed.
- `free/gpt-6-luna`: correctly rejected same-image model consensus as independent evidence, but proposed withholding all exports and unnecessary professional/arborist requirements. Those recommendations were rejected: a usable REVIEW REQUIRED report remains available, and calibrated alternate imagery or field measurements can resolve the missing boundary.
- `free/hy4`: accepted the synthetic PDF image payload but gave an imprecise clipping claim without requested pixel coordinates. No layout change was based on it. Local visual inspection and automated layout checks remain the basis of the deliverable.

These responses contributed adversarial review coverage. They are not independently verified property measurements, and no external proposal was automatically trusted.

## Supplement: information parity, original layout retained

A later review compared information categories from a public sample, read locally. Only generic category headings and a newly constructed synthetic fixture were sent externally; the sample's address, contacts, and file were not sent. Two previously oracle-passing models received distinct assignments in one batch of two, with no retries. Both responded.

The category review covered total, pitched, flat, unknown-pitch, two-story and two-layer areas; facet count; predominant pitch and its area; pitch-area distribution; all ten edge types; hips plus ridges and eaves plus rakes; facet facing; net versus waste scenarios; optional material units. The request explicitly retained the application's original design and prohibited imitation of competitor styling.

`free/deepseek-v4.1-flash` correctly calculated the mixed fixture: 1,000 projected square feet at 6/12 gives 1,118.03398875 sloped square feet; 200 flat square feet gives a supported sloped subtotal of 1,318.03398875. A third facet has 150 projected square feet and unknown pitch, so its sloped area and the complete roof's sloped total remain blank. Predominant known pitch is 6/12 over 1,118.03 sloped square feet. Story/layer flags are overlapping subsets (1,118.03 and 200 respectively), not extra area. Ten line lengths sum to 241 feet; hips plus ridges are 50 feet and eaves plus rakes 140 feet. A 10% estimate for the known scope is 1,449.84 square feet, explicitly not an order-ready whole-roof quantity. These numerical answers were independently checked with Python's square-root arithmetic.

`free/glm-5.3-flashx` usefully called out blank facing data, explicit unknown edge classification, and incomplete-scope ordering restrictions. However, it printed projected values as unlabeled total/pitched/predominant areas (1,350/1,000/1,000), which would misstate a sloped measurement summary; those suggestions were rejected. Its blanket implication that optional material evidence must block COMPLETE was also rejected: optional purchasing information must be distinguished from required net-roof measurements. Both models' suggestions that missing facing alone universally blocks ordering were not adopted; the gate follows explicit required evidence and scope.

The accepted information rules preserve projected-versus-sloped units, treat two-story/two-layer flags as nonadditive subsets, display unknowns separately from verified zero, leave unsupported facing blank, and withhold whole-scope order quantities while any required measurement remains unresolved. Raw sanitized responses and independent oracles are in the local `roof-delivery/api/apinex-information-parity.json` artifact.

## Supplement: trace registration and wrong-building selection

Following a reported trace displacement, the screenshot and all customer imagery stayed local. Four previously oracle-passing APInex models received separate sanitized public-code excerpts and synthetic fixtures, concurrently bounded at four, 35-second timeouts, 750-token responses. Three responded and one timed out; no retries were made. This was targeted adversarial review, not thousands of external requests or a claim that the reported property was reproduced.

- `free/deepseek-v4.1-flash`: same-size mask/DSM with differing raster origins; timed out. Independent inspection established that dimensions alone do not prove pixel registration. In the supplied 0.1 m fixture a 10 m northing-origin difference is 100 rows; the same roof is outside the second raster's extent, so index pairing cannot be valid.
- `free/gemini-3.1-pro`: correctly identified that the longitude-origin magnitude heuristic misclassifies EPSG:3857 near-zero eastings, and that forcing positive row resolution negative reverses explicit south-up imagery. Both defects were independently reproduced by executing the actual `loadTiff` function with synthetic TIFF metadata. At pixel (0,10), the projected-origin fixture returned longitude 100°, latitude 199° instead of approximately (0.000898315°,0.001787647°); the south-up fixture returned latitude 19.99° instead of 20.01°. Authoritative CRS and affine metadata must govern the conversion.
- `free/glm-5.3-flashx`: correctly reproduced component scores: target 100 m² at 1 m scores 98, neighbor 200 m² at 8 m scores 184, so the current score favors the neighbor. With the target absent, fallback permits a neighbor 12 m away. It also found valid pixel coordinate zero replaced by midpoint through `value || midpoint`. All three were independently verified locally. Its proposal to require a separately confirmed shape/ID for every possible trace was not adopted automatically; uncertainty must be handled explicitly, without silently presenting a neighboring roof as confirmed.
- `free/mimo-v2.6-flash`: exactly derived the coupled affine fixture at pixel (40,50): true east/north (105.5,195.8) m, separable approximation (104,195) m, horizontal error 1.7 m. This arithmetic was independently verified locally. Orbit-camera changes and vertical-height adjustments cannot restore omitted horizontal cross terms. Its arbitrary millimeter metadata threshold was not adopted; tolerances must be tied to raster resolution and registration evidence.

The engine owner received these verified counterexamples for targeted changes and paired regression coverage. The external review did not inspect the customer's screenshot, establish the cause of that specific failure, or validate a real property's outline. Raw sanitized assignments/responses are retained in `roof-delivery/api/apinex-registration-review.json`; the reproducible bounded client is `tools/dev/apinex-registration-review.py`.
