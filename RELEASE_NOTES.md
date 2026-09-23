# Audiobook Forge v1.2.0

Version 1.2 adds an authenticated Docker web runtime alongside Windows, clearer Audiobookshelf series information, and coordinated releases for both platforms.

## Highlights

- Run one Linux amd64 Docker image on CPU or NVIDIA hosts, with resumable browser uploads, persistent queues, result downloads, and restart recovery.
- See series names and book positions on Audiobookshelf library cards. Book numbers remain visible beside long series names, rows stay aligned, and hovering reveals full titles and series names.
- Preserve completed transcription segments when classified CUDA failures trigger CPU fallback.
- Manage upload expiry, retention, storage cleanup, and encrypted Audiobookshelf sessions in the web runtime.

## Installation and release delivery

- Windows releases include an installer and portable ZIP.
- Docker releases include Compose files, a pinned version file, deployment instructions, and an exact image digest.
- The release workflow tests and scans the same Docker image that it publishes, retaining SBOM and provenance. Downloads include checksums and dependency license records.
- The main README now covers Windows installation, Docker deployment, GPU setup, upgrades, and the maintainer release process.

## Validation scope

Windows, browser, CPU container transcription, and security checks are required before publication. Real NVIDIA testing is optional because no GPU runner is currently available; each release records whether it passed or was skipped. When skipped, CUDA is bundled but not hardware-qualified for that release.

Back up Docker `/data` before upgrading. SRT remains the stable subtitle format; VTT and LRC remain experimental.

---

# Audiobook Forge v1.1

Version 1.1 makes Audiobook Forge easier to connect, calmer to use, and more flexible when exporting transcripts.

## Highlights

- Sign in to Audiobookshelf with your username and password instead of manually managing an API key.
- Keep session tokens in protected main-process storage and out of renderer settings and logs.
- Export WebVTT (`.vtt`) and LRC (`.lrc`) companion files alongside the standard SRT output. These additional formats are currently marked experimental.
- Upload selected subtitle formats to Audiobookshelf, including correctly split files for multi-part books.
- Use a denser, more consistent interface designed to prevent panels and controls from shifting as job content changes.

## Interface improvements

- Moved the server/library selector into the Source Browser toolbar to leave more room for book results.
- Added compact batch-selection and refresh controls.
- Only shows Continue after a local file or Audiobookshelf book has been selected.
- Aligned Queue and Settings controls and added a compact v1.1 indicator.
- Moved Sign In next to the Audiobookshelf login fields.
- Tightened typography, spacing, progress displays, confirmation dialogs, and queue cards across the app.

## Reliability and security

- Added stricter validation for Audiobookshelf URLs, IPC payloads, queue jobs, and subtitle-format selections.
- Restricts authenticated requests and redirects to the configured Audiobookshelf origin.
- Preserves older queued jobs by defaulting them safely to SRT output.
- Adds coverage for authentication, queue behavior, UI flows, and subtitle conversion.

SRT remains the stable default. VTT and LRC can be enabled per job from Processing Options.
