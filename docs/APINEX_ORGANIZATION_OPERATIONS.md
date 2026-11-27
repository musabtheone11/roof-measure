# Organization operations and truthful readiness

The design is [APINEX_ORGANIZATION_DESIGN.md](APINEX_ORGANIZATION_DESIGN.md).
Node 24 is required. Run `npm ci --ignore-scripts` first. This additive worker does
not alter the existing measurement algorithms. It is **not a fully operational
continuous improvement organization**: trusted reference, baseline, isolated code
application/verifier and deployment adapters still block those stages. No local
Windows service has been installed from this cloud session.

## Local access and start

The connected project listing exposes a Windows Desktop project, not a filesystem
mount or local terminal. Only the actual local machine can read its Downloads.
Use a local Codex/Claude terminal in the updated repository. Do not assume that
granting cloud permission mounts Windows files. The cloud browser Downloads is
empty and is a different directory.

On Windows, discover the actual known folder rather than assume its path:

```powershell
$f = Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\User Shell Folders'
$downloads = [Environment]::ExpandEnvironmentVariables($f.'{374DE290-123F-4565-9164-39C4925E467B}')
node --use-env-proxy organization/cli.mjs discover --downloads "$downloads" --state "$env:LOCALAPPDATA\DiversityRoof\organization"
node --use-env-proxy organization/cli.mjs start --downloads "$downloads" --state "$env:LOCALAPPDATA\DiversityRoof\organization"
```

Discovery recursively inventories PDF/TXT/JSON whose path suggests roof reports.
Uncertain filenames are counted and excluded for operator classification. For a
dedicated folder containing only authorized roof reports, `--roof-only-folder`
accepts otherwise uncertain filenames. Never use that flag for a mixed personal
Downloads collection. ZIP, image-only OCR, documents with unknown identifiers and
unsupported formats need explicit adapters/review. Depth >8 or >10,000 directory
entries is visibly truncated; split a larger collection into explicit roots.
Sources are read-only. Stable hashes deduplicate extraction; filenames stay local.

Text and PDF extraction is real local PDF.js work in a cancellable memory-bounded
worker thread. Literal area/length/pitch/provider/date candidates retain page/hash
and PDF transform. These are **source claims**, not verified truth. Property IDs,
OCR ambiguities and source/reference equivalence require curation. First validate
a representative batch before classifying a whole folder as eligible. There is no
claim that thousands of reports have already been read or that all formats work.

## Controls

Use the same `--state ABSOLUTE_PRIVATE_DIRECTORY` on every command:

```text
npm run org -- status --state STATE
npm run org -- pause --state STATE
npm run org -- resume --state STATE
npm run org -- stop --state STATE
npm run org -- once --state STATE
npm run org -- cancel TASK_ID --state STATE
npm run org -- retry TASK_ID --reason "Evidence/action resolving failure" --state STATE
npm run org -- roster --state STATE
```

`resume` changes admission state; it does not start a process. `start` runs a
worker. Stop/Ctrl-C aborts active work; dispatched uncertainty remains charged.
One globally leased task per DB is enforced transactionally across processes.
Retries cannot reset two-attempt limits or unknown billing. A rollback command
currently fails with the precise missing deployment adapter; it never claims to
have reverted a deployment. Existing application rollback remains Git/deployment
operator-controlled. Do not use two state directories to evade shared budget caps.
The old image-review runtime has separate limits: organization caps do not cover
other API keys/processes/account activity. Production combined accounting remains
a required shared gateway adapter.

## Budget authorized by owner

The owner specified "$20 per week". Interpret this as a hard rolling-seven-day
organization cap, not unlimited spending. Defaults: $1/workflow, $1/rolling hour,
$3/rolling day, $20/rolling seven days, $80/UTC calendar month; max16 requests per
workflow and max2 per stage. Preserve explicit lower/zero limits in adapters.
Unknown debit retains conservative full-context reservation. Actual over-reserve
usage triggers a persistent incident and blocks further admission; no client cap
can reverse a provider's already-incurred debit. Never purchase credit automatically.

The CLI currently performs local extraction only. It intentionally has no generic
source-consent switch or arbitrary model context loader. API tasks require trusted
per-source authorization and a role-aware resolver that denies holdout leakage.
No private customer report is submitted automatically. Model routing remains
provisional; qualification results do not establish roof accuracy.

## Automatic startup and recovery

Windows local installation (requires actual local terminal):

```powershell
.\organization\Install-RoofWorker.ps1 -RepoPath (Get-Location).Path
Get-ScheduledTask -TaskName DiversityRoofOrganization
```

This registers limited-user startup at **user logon**, plus up to3 task restarts;
it is not a Windows boot service. Verify after logoff/logon and actual process
failure. Do not claim automatic restart verified from registration alone.
Linux: edit `organization/roof-organization.service.example`, install as a user
service and enable it with systemctl; user lingering/boot behavior is an explicit
host choice. macOS: create a user LaunchAgent with the same explicit Node/CLI/root/
state arguments and KeepAlive, then verify logon/restart. No host installation is
claimed here. The user's computer must remain powered on and logged in under the
configured startup mode; external inference needs network/API availability.

SQLite WAL and private blobs require durable local disk, no NFS shared DB. The
application does not encrypt SQLite: private use requires an OS-encrypted volume
and encrypted owner-managed backups. Back up a stopped worker/cleanly closed DB,
or use SQLite's backup API; verify integrity, source hashes and event counts on
restore. Do not delete prior state to reset billing. No schema downgrade automation.

## Reports and releases

Customer application preview/export defaults to measurement tables and evidence
notes, without roof segmentation/source imagery. Private internal review can opt
into `internalReview:true`. Existing numeric and stale-export gates remain.
`organization/customer-report.mjs` is a strict separate JSON→PDF projection; unknown
values remain unknown and geometry/image fields reject. Both paths remain REVIEW
REQUIRED; no field certification is implied.

No CLI/model can mint trusted passing release evidence. Staging and production
require fixed harness receipts, matching original source/candidate/dataset/policy,
distinct identities and scoped human approval. CEO cannot override a failed gate.
Missing adapters are needs-human, not successful jobs. No customer collection,
real-field accuracy improvement, production URL or installed 24/7 service is claimed.
