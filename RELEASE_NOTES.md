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
