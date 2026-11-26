# Roof report release criteria

## Decision rules fixed before the candidate run

The supported preview is a single-instance, session-isolated review workspace. A dated orthographic source with an independently justified scale may support projected dimensions. Sloped areas also require sourced pitch for each included facet. An unlocated sketch stays in source coordinates. Complete human review of building identity, geometry, openings, scale and pitch before external delivery.

| Gate | Acceptance evidence |
|---|---|
| Model and source scope | Reject wrong building, displaced frame, unresolved scale, pitch, boundaries and exclusions as appropriate to each quantity. A single unsupported final quantity blocks the affected path. |
| Deterministic geometry | All existing fixture contracts and seeded invariants pass. Compare exact analytic examples within the numerical tolerances in their tests. These test floating-point conversion and rounding only. |
| Reports and saved work | Browser upload, correction, save, reopen and export agree on revision and unrounded quantities. Real downloads open in an independent reader. Inspect plan and schedule renderings at page size. |
| Automatic accuracy | Retain all 120 pre-existing development seeds 1–120, exact-slope mode and existing eligibility rules. Compare baseline and candidate on identical eligible roofs, including median, 95th percentile and worst absolute errors. Report each regression. |
| Field accuracy | Require independently confirmed structure, scope, acquisition date and per-edge references. Establish customer tolerances against measurement uncertainty and the intended estimating decision before a new blinded evaluation. No commercial tolerance has been supplied. Field release stays blocked. |
| Runtime and hosting | Validate owner isolation and bounded interruption recovery. Require green CI on the remote head and an authenticated end-to-end review on that revision at the external Node preview. Static hosting and local checks cannot satisfy that gate. |

The historical regional holdout and 3,000-seed study remain separate. Their aggregate regressions stay visible. Development uses new analytic fixtures and diagnosed control-flow defects. A case inspected to select a fix must be retired from any future blind score.

For a fresh synthetic comparison freeze seeds 1100001–1100120 inclusive, with the same generator, exact-slope scorer and pre-existing ground-truth exclusions as development. Run both immutable engines. Publish the full paired aggregate including errors and missing outputs. No tuning on this range. This is a synthetic holdout only.

## Owner review of delivery terms

These draft terms require owner approval before publication.

- Each order identifies the buildings, scope, source dates, units and requested report format. Supply a review draft if any source or dimension is unresolved. The assigned reviewer signs the reviewed revision and records exclusions before sending it.
- Quote a turnaround only after checking source availability, roof complexity and reviewer capacity. Record the agreed due date on the order and contact the customer if additional evidence is needed.
- Tie corrections to the order and report revision. Recheck the affected quantities, retain the previous revision and provide the corrected revision with its change summary.
- If available evidence cannot support the agreed scope, offer the customer an explicitly reduced scope or cancellation. An owner determines any fee adjustment or refund against the order terms before communicating it.
