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
- `free/hy4`: accepted the synthetic PDF image payload but gave an imprecise clipping claim without requested pixel coordinates. No layout change was based on it. Human inspection and automated layout checks remain the basis of the deliverable.

These responses contributed adversarial review coverage. They are not independently verified property measurements, and no external proposal was automatically trusted.
