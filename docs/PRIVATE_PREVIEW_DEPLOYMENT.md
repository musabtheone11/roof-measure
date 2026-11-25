# Private preview deployment

The public GitHub Pages site serves the legacy static app. It cannot execute the
Node API or keep an APINEX credential secret. This preview serves the existing
frontend and API from one long-running Node 24 process. It does not promote or
modify the Pages production deployment.

The current API owns jobs and sessions in memory. Use **one running instance**:
a serverless function, autoscaling replicas, or a restart can lose the owner/job
association or stop processing after the 202 response. Jobs are intentionally
transient; download corrections/provenance before stopping the preview. Durable
production deployment needs durable queue/state and account authentication.

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

The container must sit behind the provider's HTTPS ingress. Keep its raw port
private. Explicitly set `PREVIEW_TRUST_PROXY=1` only when that ingress overwrites the forwarded-protocol header. Health
checks at `/healthz` expose readiness and transient-storage mode only. All other
routes require authentication. TLS session cookies receive `Secure` at the gateway.

For a local container check, keep its published port on loopback and inherit
already-configured environment variables without putting values in command args:

```sh
docker build -t roof-measure-private-preview .
docker run --rm --init --read-only --tmpfs /tmp --cap-drop ALL \
  --security-opt no-new-privileges --pids-limit 128 --memory 768m \
  -p 127.0.0.1:3000:3000 \
  -e APINEX_API_KEY -e PREVIEW_AUTH_USERNAME -e PREVIEW_AUTH_PASSWORD \
  -e PUBLIC_ORIGIN roof-measure-private-preview
```

Nonloopback listeners refuse to start without `PUBLIC_ORIGIN`. The raw backend port must remain private to the trusted TLS ingress. Never expose it directly or trust client-controlled forwarded headers.

A loopback-only local test may use `http://127.0.0.1:3000` as `PUBLIC_ORIGIN`.
Public origins must use HTTPS. Browser login uses the preview credentials; no
APINEX value is entered into the page. The existing owner-bound job IDs, CSRF and
runtime admission limits still apply behind the gateway.

## Vercel preview option and current access blocker

An ordinary Vercel serverless deployment is not compatible with the in-memory
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
