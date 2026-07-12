# Cross-platform release acceptance

Stable publication requires every row below to pass from the exact immutable release tag. Windows and Docker artifacts must be staged together; a partial stable release is not allowed.

| Area            | Required evidence                                                       | Current automation                               |
| --------------- | ----------------------------------------------------------------------- | ------------------------------------------------ |
| Shared behavior | Unit/integration suite, typechecks, lint                                | `Validate` Windows and Linux jobs                |
| Windows         | Production renderer/main/preload build and regression suite             | `Validate` and coordinated release `windows` job |
| Web UI          | Chromium login, upload, queue, download, retry, cleanup flows           | `npm run test:e2e` in Linux server job           |
| Server boundary | Production bundle contains only Node built-in imports                   | `npm run build:server`                           |
| Docker CPU      | Universal image builds and starts without NVIDIA runtime                | `Validate` Docker CPU job                        |
| Docker security | High/critical image scan                                                | coordinated release `docker-cpu-security` job    |
| Supply chain    | SBOM, provenance, immutable version/SHA tags, licenses                  | coordinated release publish job                  |
| Docker CUDA     | Real NVIDIA container runs CUDA Whisper and creates SRT                 | self-hosted `linux, x64, nvidia` runner          |
| Recovery        | Persistence, upload, checkpoint, cleanup, ENOSPC tests                  | unit/integration and browser suites              |
| Documentation   | Install, backup, upgrade, networking, cleanup, troubleshooting reviewed | manual release review                            |

## Release-candidate sequence

1. Confirm the feature branch is clean and all `Validate` jobs pass.
2. Run Windows local-file and Audiobookshelf smoke tests on the packaged candidate.
3. Run Docker CPU login, upload, transcription, download, restart/resume, and cleanup acceptance.
4. Run Docker ABS private-network and public-HTTPS acceptance.
5. Run the real NVIDIA smoke job and confirm diagnostics report CUDA.
6. Review vulnerability, SBOM, provenance, and third-party license output.
7. Bump `package.json` only after acceptance passes, commit the candidate, and push the matching immutable `v<version>` tag. Tag pushes validate but never publish stable artifacts automatically.
8. If another candidate run is needed, dispatch the coordinated workflow for that existing tag with stable publishing disabled.
9. Review all validation evidence, then manually dispatch the same immutable tag with `publish_stable=true`. This is the only path that runs the required NVIDIA gate and publishes Windows/Docker artifacts. Never reuse a tag or overwrite a versioned image.

## Rollback

- Before merge, revert the isolated milestone commit on `codex/docker-web-platform`.
- After merge, revert the single merge commit to withdraw the complete enhancement while retaining milestone history.
- Restore Docker `/data` only from a backup taken before the incompatible upgrade.
- Never force-push shared history, delete migration backups, reuse a published version tag, or overwrite an immutable Docker tag.

The only hardware-specific gate that cannot be completed on a CPU-only workstation is the real NVIDIA CUDA smoke test. Stable publication remains blocked until that runner succeeds.
