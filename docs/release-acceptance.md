# Cross-platform release acceptance

Stable publication requires the mandatory rows below to pass from the exact immutable release tag. NVIDIA qualification is optional and recorded in the release notes. Windows assets are staged in a draft before the tested Docker image is promoted; the public release then exposes both platforms. GHCR and GitHub Releases are separate services, so publication is not an atomic transaction.

| Area                   | Required evidence                                                       | Current automation                                              |
| ---------------------- | ----------------------------------------------------------------------- | --------------------------------------------------------------- |
| Shared behavior        | Unit/integration suite, typechecks, lint                                | `Validate` Windows and Linux jobs                               |
| Windows                | Production renderer/main/preload build and regression suite             | `Validate` and coordinated release `windows` job                |
| Web UI                 | Chromium login, upload, queue, download, retry, cleanup flows           | `npm run test:e2e` in Linux server job                          |
| Server boundary        | Production bundle contains only Node built-in imports                   | `npm run build:server`                                          |
| Docker CPU             | Image starts without NVIDIA and transcribes speech into a nonempty SRT  | coordinated release `docker-cpu-security` job                   |
| Docker security        | High/critical image scan                                                | coordinated release `docker-cpu-security` job                   |
| Supply chain           | SBOM, provenance, immutable version/SHA tags, licenses                  | coordinated release publish job                                 |
| Docker CUDA (optional) | Same image digest runs CUDA Whisper and transcribes speech into SRT     | `validate_nvidia=true`; self-hosted `linux, x64, nvidia` runner |
| Recovery               | Persistence, upload, checkpoint, cleanup, ENOSPC tests                  | unit/integration and browser suites                             |
| Documentation          | Install, backup, upgrade, networking, cleanup, troubleshooting reviewed | manual release review                                           |

## Release-candidate sequence

1. Confirm the feature branch is clean and all `Validate` jobs pass.
2. Run Windows local-file and Audiobookshelf smoke tests on the packaged candidate.
3. Run Docker CPU login, upload, transcription, download, restart/resume, and cleanup acceptance.
4. Run Docker ABS private-network and public-HTTPS acceptance.
5. If an NVIDIA runner is available, enable `validate_nvidia` and require its smoke job to pass. Otherwise leave it disabled; CPU-qualified releases explicitly mark CUDA hardware qualification as skipped.
6. Review vulnerability, SBOM, provenance, and third-party license output.
7. Bump `package.json` and `package-lock.json` only after acceptance passes, commit the candidate, and push the matching immutable `v<version>` tag. Tag pushes validate but never publish stable artifacts automatically.
8. If another candidate run is needed, dispatch the coordinated workflow for that existing tag with stable publishing disabled.
9. Review all validation evidence, then manually dispatch the same immutable tag with `publish_stable=true`. Keep `validate_nvidia=false` without a GPU runner. If selected, GPU validation becomes mandatory for that run. Never reuse a published tag or overwrite a versioned image.
10. Confirm the GHCR package is public for anonymous downloads, Windows downloads are present, and Compose can pull the published version. The `update-latest` job runs only after the public release exists; rerun that failed job if updating the convenience tag fails.

## Release artifacts and retries

- Both runtime tests and the scanner use the candidate image by digest. Publication promotes that digest without rebuilding, retaining SBOM/provenance.
- The Windows job provides the installer, portable zip, and dependency license records. Release downloads also include the security report, Compose files, pinned `release.env`, `DOCKER.md`, image digest, and SHA-256 checksums.
- Validation runs push `candidate-<run>-<attempt>` image tags to GHCR, not stable channels. These can be cleaned up later; preserve digests referenced by published version tags.
- If publication fails after creating the versioned image but before publishing the draft, rerun only failed jobs in the same run. A complete rebuild may produce a different digest and will be refused rather than overwrite an existing version/SHA tag.
- The workflow must exist on `master` for manual dispatch. Actions needs write access to repository contents and packages. No Docker Hub credentials are needed for scanning.

## Rollback

- Before merge, revert the isolated milestone commit on `codex/docker-web-platform`.
- After merge, revert the single merge commit to withdraw the complete enhancement while retaining milestone history.
- Restore Docker `/data` only from a backup taken before the incompatible upgrade.
- Never force-push shared history, delete migration backups, reuse a published version tag, or overwrite an immutable Docker tag.

Without an NVIDIA runner, CUDA support must not be described as hardware-qualified. CPU-only releases remain possible with all mandatory gates passing.
