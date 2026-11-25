# Regional roof benchmark

Properties across Jacksonville, Middleburg, Orange Park, Fleming Island, St. Johns and St. Augustine, each run through
the real app (address -> imagery -> structure selection -> roof geometry -> dimensions -> PDF) with the same code and the
same settings. Nothing in the app or in these scripts is specific to an address.

Everything property-level (addresses, reference documents, run outputs, PDFs, per-property scores) is private:
`bench/private/regional/` and `.devcache/regional/` are git-ignored. Only aggregates with benchmark ids (R01...) are
committed.

## Files

| Script | Does |
|---|---|
| `conditions.mjs` | Logs each property's input conditions from the raw Google Solar layers only (imagery date and quality, selected building, height above ground, other buildings within 30 m, canopy beside the roof, shadow). The trace engine is not run, so blind properties are not looked at through the code being tuned. |
| `run.mjs` | Runs every property through the UI with `tools/dev/run-app.mjs` (optionally with the reviewer's second look, `--alt`), stamps each run with the code version (commit + hash of the served app files) and writes a hash list of everything generated before anything is compared with a reference. |
| `score.mjs` | Scores accuracy and coverage together: per property and per roof type / obstruction level. |

## Rules used in scoring

- No approved tolerances exist, so differences are shown and nothing is called a pass.
- A value the reference does not print is "not scored", never zero. A value the run did not produce is counted as
  missing.
- Two references that disagree by more than 5% are listed as a discrepancy to investigate, not averaged.
- Automatic output (before any correction) and reviewed output (after the second look) are scored separately.
- Release blockers: an unsupported value shown as measured, or an incomplete report exported as complete.

## Test set and blind split

43 properties in the six areas with a same-property measurement report and, where usable, an adjuster sketch from the
company's job files, plus two without a reference (numerical accuracy unverified). Mayflower and Woodhaven are kept as
regression cases.

The blind set (15 properties, about one third) was frozen on 2026-11-25 before any code change. It holds only properties
never run through the app before, stratified by roof type and obstruction level; properties within 700 m of each other
(same subdivision, likely the same house plans) are kept in the same group. Properties used earlier to tune the engine are
in the development or regression groups.

Frozen split, sha256 of the salted blind list (the list and salt are in the private folder):
`bfb396f9bfb53627f28fc7c7d6a81a516a3ced7cfa3f241d08d14eb96fbab018`
