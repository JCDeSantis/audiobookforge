# Docker deployment guide

Audiobook Forge ships one `linux/amd64` image containing independent CPU and NVIDIA CUDA builds of `whisper.cpp`. The same image starts on CPU-only hosts and automatically uses CUDA when a compatible NVIDIA device is exposed. A classified CUDA failure retries only the current unfinished segment on CPU and preserves completed checkpoints.

The web runtime is intentionally single-user and processes one transcription job at a time.

## Requirements

- Docker Engine with Compose v2
- An `amd64` Linux host
- Enough persistent storage for uploads, decoded working audio, models, checkpoints, and results
- For GPU use: an NVIDIA GPU, NVIDIA Container Toolkit, and a compatible Linux driver

The image pins Ubuntu 22.04, CUDA 12.4.1 runtime libraries, Ubuntu FFmpeg, and whisper.cpp v1.8.3 at commit `2eeeba56e9edd762b4b38467bab96c2517163158`. NVIDIA driver 550.54.14 or newer is recommended. CUDA 12.x minor-version compatibility begins at Linux driver 525.60.13, but the paired 550.54.14 floor is the supported target for this release.

## Install and start

Create the password secret before starting the container:

```sh
mkdir -p secrets
printf '%s' 'replace-with-a-long-unique-password' > secrets/web_password.txt
chmod 600 secrets/web_password.txt
```

CPU or automatic CPU fallback:

```sh
ABF_VERSION=latest docker compose pull
ABF_VERSION=latest docker compose up -d
```

For reproducible deployments, replace `latest` with the immutable version shown on the GitHub release and keep that value in a local `.env` file as `ABF_VERSION=<version>`.

When building the development branch locally, replace `pull` with:

```sh
docker compose build
docker compose up -d
```

Open `http://localhost:3000` and sign in with the configured password. Application state is stored in the `audiobookforge-data` volume mounted at `/data`.

## NVIDIA GPU

Install and validate NVIDIA Container Toolkit on the host first. Then start the same image with the GPU override:

```sh
docker compose -f compose.yml -f compose.gpu.yml up -d
```

Confirm the host can expose the GPU:

```sh
docker compose -f compose.yml -f compose.gpu.yml exec audiobookforge nvidia-smi
```

The application reports the selected backend and any CPU fallback in job details and diagnostics. Choose **Force CPU** in Settings when GPU use is not desired. CPU-only startup never requires NVIDIA Container Toolkit.

## Upload and result workflow

- Use **Upload Files** for one or more `.m4b`/`.mp3` files and one optional `.epub`.
- Uploads use checksummed 16 MiB chunks and acknowledged offsets.
- After a browser restart, reselect the identical files to resume an unfinished upload.
- Download individual results or stream **Download All** from completed jobs.
- Remove finished jobs before cleanup to release their managed result references.
- Use **Settings → Preview Cleanup** to review and confirm deletion of unreferenced app-managed data.

The app never treats a browser path or an Audiobookshelf host filesystem path as a Docker path.

## Audiobookshelf networking

Public Audiobookshelf destinations require HTTPS. Private/LAN addresses and Docker service names may use HTTP, with an in-app warning. Redirects, embedded URL credentials, cloud-metadata/link-local destinations, public-to-private DNS rebinding, and unexpected origin changes are rejected.

For Docker-to-Docker access, place both services on a shared Docker network and use the Audiobookshelf service name, for example `http://audiobookshelf:80`. Do not use `localhost` unless Audiobookshelf runs in the same container.

The Audiobookshelf password is used only for login. Returned session tokens are AES-256-GCM encrypted at rest using the persistent server session secret.

## Reverse proxy and HTTPS

Terminate HTTPS at a trusted reverse proxy and proxy to port 3000. Preserve the original `Host` and forwarding headers. Set `ABF_TRUST_PROXY=true` only when the container is reachable exclusively through that trusted proxy; never enable it for an directly exposed untrusted proxy chain.

Do not expose port 3000 publicly without HTTPS. The default Compose mapping is suitable for a trusted LAN; bind it to loopback in an override when the reverse proxy runs on the same host.

## Storage and retention

`/data` contains configuration, the persistent queue, encrypted ABS session, uploads, models, checkpoints, temporary work, and results.

- Abandoned unfinished upload sessions expire after 24 hours.
- Finalized uploaded sources become eligible for deletion seven days after their job references are released.
- Generated results and checkpoints become eligible after 30 days and reference release.
- Models are removed only through explicit model cleanup and are protected while in use.
- Automatic retention sweeps run at startup and every six hours.

Retention and cleanup affect only registered managed artifacts. Windows-selected output folders and Audiobookshelf-owned files remain external and are never deleted by managed cleanup.

## Backup and upgrade

Pause writes and archive the complete `/data` volume:

```sh
docker compose pause
docker run --rm --volumes-from "$(docker compose ps -q audiobookforge)" \
  -v "$PWD:/backup" ubuntu:22.04 \
  tar -C /data -czf /backup/audiobookforge-data.tgz .
docker compose unpause
```

Keep the archive private because it contains account/session material, even though ABS tokens are encrypted. A usable backup must include the session secret and encrypted session together.

Upgrade only after taking a backup and changing the pinned `ABF_VERSION` in `.env` to the reviewed target release:

```sh
docker compose pull
docker compose up -d
docker compose ps
docker compose logs --tail=100 audiobookforge
```

Persistence writes are versioned, atomic, and backed up. If migration or recovery fails, preserve `/data` and the backup archive before attempting manual repair or rollback. Never downgrade by deleting schema files.

## Troubleshooting

- **Container will not start:** verify `secrets/web_password.txt` exists, is non-empty, and is readable by Docker.
- **Health check fails:** inspect `docker compose logs audiobookforge` and confirm `/data` is writable.
- **CUDA is not selected:** run `nvidia-smi` inside the GPU Compose service, confirm Container Toolkit configuration, and inspect diagnostics for fallback classification.
- **Out of disk space:** free capacity in the Docker data root or `/data`; Audiobook Forge reserves processing space and reports ENOSPC without deleting external files.
- **Upload did not resume:** reselect the exact same files with matching names, sizes, ordering, and browser-reported modification times.
- **ABS cannot connect:** use the container-reachable address, avoid redirects, and use HTTPS for public hosts.
- **Job recovered as paused:** this is expected after an interrupted process; resume it to reuse completed segment checkpoints.
- **Result expired:** retention may remove an unreferenced result after 30 days; retranscribe from a retained source or upload the source again.

## Environment variables

| Variable                        | Default                           | Purpose                                                                      |
| ------------------------------- | --------------------------------- | ---------------------------------------------------------------------------- |
| `ABF_WEB_PASSWORD_FILE`         | none                              | Required password-file path; Compose mounts `/run/secrets/abf_web_password`. |
| `ABF_WEB_PASSWORD`              | none                              | Less-preferred direct environment fallback.                                  |
| `ABF_HOST`                      | `0.0.0.0`                         | HTTP listen address.                                                         |
| `ABF_PORT`                      | `3000`                            | Internal HTTP port.                                                          |
| `ABF_DATA_DIR`                  | `/data`                           | Persistent application storage root.                                         |
| `ABF_TRUST_PROXY`               | `false`                           | Trust proxy forwarding information when behind a controlled proxy.           |
| `ABF_SESSION_SECRET_FILE`       | `/data/config/session-secret.key` | Persistent signing and ABS-session encryption secret.                        |
| `ABF_WEB_ROOT`                  | `/app/out/renderer`               | Compiled web application directory.                                          |
| `ABF_FFMPEG_PATH`               | `/usr/bin/ffmpeg`                 | FFmpeg executable override.                                                  |
| `ABF_FFPROBE_PATH`              | `/usr/bin/ffprobe`                | FFprobe executable override.                                                 |
| `ABF_WHISPER_CPU_PATH`          | image CPU binary                  | CPU Whisper executable override.                                             |
| `ABF_WHISPER_CUDA_PATH`         | image CUDA binary                 | CUDA Whisper executable override.                                            |
| `ABF_MAX_UPLOAD_BYTES`          | `107374182400`                    | Maximum aggregate upload-session bytes.                                      |
| `ABF_FREE_SPACE_RESERVE_BYTES`  | `5368709120`                      | Free-space reserve required while accepting uploads.                         |
| `ABF_UPLOAD_RETENTION_DAYS`     | `7`                               | Days before finalized uploaded sources become eligible for cleanup.          |
| `ABF_RESULT_RETENTION_DAYS`     | `30`                              | Days before generated results become eligible for cleanup.                   |
| `ABF_CHECKPOINT_RETENTION_DAYS` | `30`                              | Days before completed checkpoints become eligible for cleanup.               |
| `ABF_RETENTION_SWEEP_HOURS`     | `6`                               | Interval between retention sweeps.                                           |

Internal binary/path overrides are primarily for diagnostics and development; normal Compose deployments should leave them unchanged.
