# Windows and Docker Platform Enhancement

## Objective

Evolve Audiobook Forge into one product with Windows Electron and authenticated Docker web runtimes. Both runtimes share queue, transcription, Audiobookshelf, subtitle, persistence, artifact, and cleanup services. A single `linux/amd64` Docker image contains independent CPU and CUDA Whisper executables, selects CUDA automatically, and falls back safely to CPU.

Development occurs on `codex/docker-web-platform`. The application version remains unchanged until release-candidate validation. Stable Windows and Docker artifacts publish together only after all required validation passes.

## Delivery order

1. Capture baseline Windows behavior and v1.1 migration fixtures.
2. Separate shared, desktop, renderer, and server dependency boundaries without changing Windows behavior.
3. Add versioned atomic persistence, backups, recovery, and idempotent v1.1 migrations.
4. Introduce first-class managed artifact ownership, references, leases, and tombstone deletion.
5. Extract the single-worker queue and transcription pipeline into injected shared services.
6. Route the renderer through a shared `AppClient` with Electron and HTTP implementations.
7. Separate CPU/CUDA runtime management and add classified segment-level CPU fallback.
8. Add cleanup previews, retention, startup reconciliation, and active-resource locks.
9. Add the authenticated single-user web server, versioned API, and resumable SSE events.
10. Make ABS services portable, including private-network HTTP policy and remote EPUB handling.
11. Add checksummed resumable uploads backed by opaque managed assets.
12. Complete Docker upload, download, storage, compute, and cleanup UI behavior.
13. Build one universal CPU/CUDA Docker image with base and optional GPU Compose configurations.
14. Harden restart recovery, disk exhaustion, security, streaming, and diagnostics.
15. Coordinate Windows and Docker release automation so stable releases cannot publish partially.
16. Complete deployment documentation, hardware acceptance, and release-candidate preparation.

Every milestone must leave Windows tests, typechecks, and the production build passing. Commits remain independently revertible and are never force-pushed.

## Architecture

- Internal package/entrypoint boundaries: shared core, renderer, desktop adapter, and server adapter. These are one repository, product, lockfile, version, and Docker image.
- Docker production dependencies must not install or load Electron, keytar, or Windows binaries.
- Core services receive `DataPaths`, `SecretStore`, `ComputeRuntime`, `MediaTools`, `ArtifactStore`, `EventSink`, filesystem, and clock dependencies.
- Electron IPC and HTTP endpoints perform transport validation and delegate to the same services.
- The renderer uses an `AppClient` interface and runtime capabilities rather than direct Electron calls.
- The queue remains intentionally single-user and single-worker.

## Persistence and artifact safety

- Store settings, queue, uploads, artifacts, and sessions in versioned envelopes.
- Persist with temporary write, flush, atomic rename, and backup. Failed migrations retain originals and surface recovery errors rather than silently resetting.
- Migrate unversioned v1.1 settings and queue files idempotently.
- Treat application `srt`, `temp`, `checkpoints`, and `whisper/output` paths as managed. Treat Windows-selected output paths and ABS files as external.
- Managed artifacts have opaque IDs, category, size, timestamps, references, leases, retention state, and deletion tombstones.
- Cleanup uses revision-bound previews, locks active resources, and reconciles interrupted tombstones at startup.
- Uploaded sources expire seven days after terminal state; generated results expire after 30 days; unfinished uploads expire after 24 hours. All are configurable. Models require explicit deletion and cannot be deleted while active.
- Cleanup never deletes Windows external output files or ABS-managed files.

## Compute runtime

- Keep distinct CPU and CUDA executables on both platforms. The Docker CPU executable has no CUDA linkage.
- Probe NVIDIA hardware, driver/runtime accessibility, and a CUDA Whisper self-test before selection.
- Fall back only for classified CUDA initialization, missing-library/driver, device loss, OOM, or execution failures.
- Retry only the current uncommitted segment on CPU, preserve completed checkpoints, and use CPU for the rest of that job.
- Invalid media, corrupt models, storage failures, and general Whisper errors do not trigger GPU fallback.
- Expose Automatic and Force CPU modes plus backend/fallback diagnostics.
- A compatibility spike pins the CUDA runtime/base image, Whisper revision, minimum driver, FFmpeg, and redistribution requirements before final Docker packaging.

## Docker web runtime

- Serve the compiled SPA and `/api/v1` from port 3000 by default.
- Persist config, queue, uploads, results, models, checkpoints, and logs under `/data`.
- Require `ABF_WEB_PASSWORD_FILE`; allow an environment fallback with a warning and refuse insecure startup without either.
- Use rate-limited login, signed HTTP-only same-site cookies, origin/CSRF enforcement, authenticated body limits, explicit proxy trust, and secret redaction.
- Use a separately mounted secret for session signing and ABS token encryption when available.
- SSE sends an authenticated snapshot and monotonically increasing revisions, supports last-event reconnect, and resynchronizes gaps.
- Interrupted running jobs recover as paused.

### Uploads and results

- Accept multiple `.m4b`/`.mp3` files and one optional `.epub` as opaque per-file assets.
- Use sequential 16 MiB chunks with acknowledged offsets, checksums, idempotent retry, and atomic whole-file finalization.
- Browser restart requires local file reselection and identity verification before resuming.
- Jobs reference finalized asset IDs, never filesystem paths or unfinished sessions.
- Reference counts and leases protect assets shared by jobs, retries, transcription, cleanup, downloads, and streamed archives.
- Default maximum upload session is 100 GiB, with a configurable 5 GiB reserve plus estimated decoded-audio working space.
- Results support authenticated individual downloads, ranges, and a backpressure-aware streamed archive.

## Audiobookshelf compatibility

- Preserve login/refresh, browsing, multi-book queueing, audio download, linked context, subtitle upload, multipart splitting, and local fallback.
- Windows may use a genuinely accessible local linked EPUB path. Docker must retrieve an EPUB through a validated authenticated ABS capability or accept manual EPUB upload; an ABS host path is never treated as a Docker path.
- Permit HTTP only for validated private/LAN addresses and Docker DNS services with a visible warning. Public destinations require HTTPS.
- Reject redirects and link-local/cloud-metadata targets and protect against DNS rebinding while retaining intentional private-network support.

## Release and validation

- A single tag workflow validates the tag/version, runs all tests, builds Windows assets and the Docker image, performs CPU and required NVIDIA smoke validation, generates SBOM/provenance/licenses/scans, pushes immutable image tags, and only then publishes the GitHub release and `latest`.
- Test shared core and both client transports, v1.1 migration/recovery, Windows local/ABS behavior, CPU/CUDA/fallback behavior, Docker CPU and NVIDIA operation, remote ABS/EPUB behavior, upload interruption and corruption, cleanup races, abrupt termination, ENOSPC, authentication, streaming, and browser flows.
- Initial Docker scope is `linux/amd64`, one image, one user, one worker, browser uploads, and no mounted-folder browser. ARM/Jetson, ROCm, Intel acceleration, and multi-user support are future work.

