# Roof AI runtime

The existing GitHub Pages deployment is static and cannot hold an APINEX credential.
This Node service serves the same frontend and the server-side agent API for a preview.
It leaves the production Pages deployment unchanged.

Requires Node 24 and `npm ci --prefix bench` for deterministic geometry dependencies.
Set `APINEX_API_KEY` in the process environment, then run `npm start`.
For an authenticated cloud preview use `HOST=0.0.0.0 PORT=3000 npm start` and the
configured HTTP preview URL. Do not expose an unauthenticated public port with a
shared API key. Production hosting needs account authentication and durable job storage.

The preview uses owner-bound in-memory jobs, same-origin CSRF protection, a maximum
of two simultaneous roof jobs, request/token/dollar ceilings, and 15-minute job expiry.
Images are sent externally only when explicitly authorized for that uploaded image.
Existing customer jobs are never submitted automatically. Jobs are transient; download
the correction/provenance JSON to preserve your work.

AI geometry is a proposal and always remains REVIEW REQUIRED. Agreement between two
models is a disagreement check, not independent evidence or calibrated confidence.
Unknown/oblique images have pixel measurements only. Physical measurements require
explicit verified calibration or georeferencing; sloped area additionally needs
supported pitch. The editor retains original agent output and a correction log.

Official provider docs: https://apinex.bond/developers/models/chat.md,
https://apinex.bond/developers/errors.md and https://apinex.bond/pricing.md.
JSON mode compatibility is tested empirically; local response schemas remain authoritative.

Client-generated processing IDs support owner-bound cancellation before a job ID
is returned. Identical retries recover the same job; changed image/revision inputs
reject. Cancellation records expire after 15 minutes and remain bounded. Closing
the runtime aborts remaining provider work. Calls already sent may still be billed.

The review editor can trace a missing outline manually, remove false facets/edges,
and undo corrections. It never substitutes an inferred facet union for an omitted
exterior boundary. Compact correction records retain source metadata and raw AI
evidence once, so large editing sessions remain reopenable.
