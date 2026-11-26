# Private preview deployment

The public GitHub Pages site serves the legacy static app. It cannot execute the
Node API or keep an APINEX credential secret. This preview serves the existing
frontend and API from one long-running Node 24 process. It does not promote or
modify the Pages production deployment.

Run **one Node instance** behind authenticated HTTPS ingress. Its SQLite journal
commits the owner binding, request nonce and job identity before dispatch. A restart
recovers completed results. A job interrupted after dispatch returns a terminal
failure with potentially unknown billing. The server never automatically repeats it.
Request receipts and results expire after 15 minutes, sessions after one hour.
Download a reviewed revision and its source bundle for retention beyond this window.
The gateway uses shared preview credentials and separate owner cookies. Commercial
multi-user operation still requires individual accounts and a retention policy.

## Prepared hosting path

`Dockerfile` builds a single-instance private-preview service. Its base is pinned
by digest. `.dockerignore` allow-lists source and dependency manifests; uploaded
images, job exports, benchmarks, `.env` files and credentials are not build inputs.
The container runs as the non-root Node user. The geometry dependencies install
from the existing lockfile. No APINEX or Google value is embedded in an image.

The preview gateway (`server/preview.mjs`) authenticates both UI and API before
forwarding to a loopback-only runtime. Preview credentials and the APINEX key come
from runtime environment secrets:

| Variable | Purpose |
|---|---|
| `APINEX_API_KEY` | Server-side APINEX calls; never a frontend environment variable |
| `PREVIEW_AUTH_USERNAME` | Private preview login |
| `PREVIEW_AUTH_PASSWORD` | At least 24 characters, supplied through a secret store |
| `PUBLIC_ORIGIN` | Exact HTTPS origin returned by the hosting provider |
| `PREVIEW_TRUST_PROXY` | Set to `1` only behind a trusted TLS ingress that overwrites `X-Forwarded-Proto`; otherwise forwarded headers are ignored |
| `HOST`, `PORT` | Usually `0.0.0.0` and provider-assigned port; default port 3000 |
| `ROOF_STATE_DB` | SQLite database on the persistent private volume. The local default is `.devcache/runtime/jobs.sqlite`. The container default is `/var/lib/roof-measure/jobs.sqlite`. |
| `ROOF_REVISION` | Full Git commit bound to the image at build time and reported by the health check. |

The container must sit behind the provider's HTTPS ingress. Keep its raw port
private. Explicitly set `PREVIEW_TRUST_PROXY=1` only when that ingress overwrites the forwarded-protocol header. Health
checks at `/healthz` report readiness, storage mode and revision. All other
routes require authentication. TLS session cookies receive `Secure` at the gateway.

For a local container check, keep its published port on loopback and inherit
already-configured environment variables without putting values in command args:

```sh
docker build --build-arg ROOF_REVISION="$(git rev-parse HEAD)" -t roof-measure-private-preview .
docker run --rm --init --read-only --tmpfs /tmp --cap-drop ALL \
  --security-opt no-new-privileges --pids-limit 128 --memory 768m \
  -p 127.0.0.1:3000:3000 \
  --mount type=volume,src=roof-measure-preview-state,dst=/var/lib/roof-measure \
  -e APINEX_API_KEY -e PREVIEW_AUTH_USERNAME -e PREVIEW_AUTH_PASSWORD \
  -e PUBLIC_ORIGIN roof-measure-private-preview
```

Record the built image digest and the current preview revision before replacing an
instance. Stop accepting new work, wait for active requests to finish, and snapshot
the volume after the process stops. Reuse the volume when replacing the instance.
Verify that the reported revision matches the deployed digest's commit, the storage
mode is SQLite, unauthenticated application access returns 401, and an authorized
synthetic upload downloads a revision-matched PDF.

To roll back, drain and stop the candidate, keep its volume snapshot, and start the
previous recorded digest with its compatible volume snapshot and the same HTTPS ingress.
Verify its revision, private routes and synthetic review again. Bookkeeping for
interrupted provider calls must be reconciled before requesting another analysis.

Nonloopback listeners refuse to start without `PUBLIC_ORIGIN`. The raw backend port must remain private to the trusted TLS ingress. Never expose it directly or trust client-controlled forwarded headers.

A loopback-only local test may use `http://127.0.0.1:3000` as `PUBLIC_ORIGIN`.
Public origins must use HTTPS. Browser login uses the preview credentials; no
APINEX value is entered into the page. The existing owner-bound job IDs, CSRF and
runtime admission limits still apply behind the gateway.

## Vercel preview option and current access blocker

An ordinary Vercel serverless deployment is not compatible with this single-process
background-job lifecycle. A **Vercel Sandbox session** is a viable ephemeral
preview: run the same Node service continuously, expose port 3000, and set
`PUBLIC_ORIGIN` to the session's HTTPS route. The process must bind `0.0.0.0`.
The link lasts only while that session and process are running; a sandbox resume
restores files, not jobs or running processes. Do not describe it as durable hosting.

The connector currently returns HTTP 403 when listing projects under the verified
team scope. It specifically requires `authorize_team_access`, not reconnecting the
whole app. The single-use consent link expires after ten minutes. After the user
approves it, retry project discovery with the same connection, verify the preview
project/team, provision secrets through existing secret-management bindings, then
create the ephemeral preview. Do not print keys or pass them through command lines,
public source, browser JavaScript or chat. A missing grant is not a build failure.

Before returning a public preview URL, verify authenticated page load, API config,
synthetic-image upload consent, processing/progress, correction recalculation,
download, cancellation, and cross-owner isolation. Record the exact source commit
and session lifetime. No checked public preview URL is claimed while access or
remote secret provisioning is incomplete.

Verified locally: six gateway tests pass. The nonroot read-only Docker container passed authentication, key-free configuration, private-path denial, local PDF JavaScript MIME, and synthetic measurement review-gate checks. Repeat with `node --test server/preview.test.mjs` and `node tools/dev/preview-container-test.mjs` after building the `roof-measure-private-preview:review` image. No external inference or customer upload is used. These checks establish local readiness; they do not establish a reachable public preview.

Integrated runtime verification used exactly one generated synthetic-image job through the authenticated Docker preview: five upstream requests completed, provider-reported cost $0.007834, no unknown billing. The resulting proposal had two facets and seven edges but lacked a valid outline; deterministic validation correctly withheld quantities. The initial PDF attempt exposed an unavailable CDN dependency; jsPDF 2.5.1 is now vendored locally. A separate key-free replay of the saved result, using the real measurement endpoint and blocking jsDelivr/cdnjs, successfully downloaded and independently parsed the three-page review PDF. This replay verifies the repaired export path without spending on another inference job. It does not establish roof-measurement accuracy or a public deployment URL.

A subsequent key-free replay verified human recovery of that saved proposal: tracing the four independently known source corners through the editor produced 960.00 ft² projected area; assigning independently known synthetic 6/12 pitches to both facets produced 1,073.31 ft² sloped area. The real measurement endpoint validated the repaired geometry, and the downloaded three-page PDF independently parsed with those same figures and correction history. After export, a locally generated two-page PDF imported through the authenticated preview; selecting page two changed the image fingerprint, produced the expected portrait dimensions, and reset consent/calibration. These are synthetic integration oracles, not a claim of real-property accuracy.
