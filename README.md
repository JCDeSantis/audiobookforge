# Audiobook Forge

![Version](https://img.shields.io/badge/version-v1.1-d92a3d?style=for-the-badge)
![Platform](https://img.shields.io/badge/platform-Windows%20%2B%20Docker-fff4f4?style=for-the-badge&labelColor=2a0d0d&color=8c3131)
![License](https://img.shields.io/badge/license-MIT-fff4f4?style=for-the-badge&labelColor=2a0d0d&color=8c3131)

![Audiobook Forge logo](docs/readme-assets/audiobook-forge-logo.png)

Audiobook Forge is a Windows desktop and single-user Docker web application for generating audiobook subtitle files with [Audiobookshelf](https://github.com/advplyr/audiobookshelf) integration.

It is built for users who want a focused workflow for selecting books, choosing a Whisper model, queueing subtitle jobs, and generating `.srt` files that can be saved locally or uploaded back into Audiobookshelf automatically.

## Built With AI

Audiobook Forge was built almost entirely through AI-assisted development.

I am not a professional developer, and this project exists because modern AI tools made it possible to design, build, and iterate on an idea that otherwise would have been out of reach.

## Why Audiobook Forge Exists

Audiobookshelf already does the hard work of organizing, hosting, and serving audiobook libraries. Audiobook Forge does not try to replace it.

Instead, Audiobook Forge helps create subtitle files for workflows such as:

- subtitle generation for books that do not already include `.srt` files
- accessibility-focused listening workflows
- read-along playback with subtitle-capable companion apps
- subtitle prep before sending books into a subtitle-first player experience
- library cleanup for books missing subtitle support

## Features

- Generate `.srt` subtitle files from local audiobook files
- Browse and queue books directly from an Audiobookshelf library
- Automatically upload generated subtitles back to Audiobookshelf when possible
- Save subtitles locally for standalone or fallback workflows
- Pick Whisper models from a streamlined desktop UI
- Keep queued, running, completed, failed, and cancelled jobs in one place
- Show whole-run progress, current task progress, elapsed time, and live transcription text
- Split subtitle output across multi-file audiobooks
- Add optional EPUB context to improve vocabulary and proper-name recognition
- Run one universal Docker image on CPU-only or NVIDIA CUDA hosts
- Upload audiobook files through the authenticated web interface with resumable chunks
- Automatically fall back from classified CUDA failures to CPU without discarding completed segments
- Download and safely clean up application-managed uploads, checkpoints, and results

## Interface Preview

![Audiobook Forge interface preview](docs/readme-assets/interface-preview.png)

## Quick Start

### Windows Release

Each release is intended to publish two Windows assets to GitHub Releases:

- a Windows installer
- a portable `win-unpacked.zip` build that can be extracted and run from a folder

Recommended install flow:

1. Download the latest release from [GitHub Releases](https://github.com/JCDeSantis/audiobookforge/releases).
2. Choose either:
   - the installer if you want a normal Windows install
   - the unpacked zip if you want a portable folder-based run
3. Launch Audiobook Forge.
4. Open `Settings`.
5. Enter your Audiobookshelf server URL, username, and password, then sign in.
6. Pick a default Whisper model.
7. Select either local audiobook files or a book from Audiobookshelf.
8. Queue the job and let Audiobook Forge generate the subtitles.

Model guidance:

- `Large V3 Turbo` (`large-v3-turbo-q5_0`, about 547 MB) is the practical default for most users because it keeps the current Whisper Turbo quality/speed profile with a much smaller download.
- `Large V3 Turbo (Full)` (`large-v3-turbo`, about 1.51 GB) is available when maximum full-precision output matters more than disk, memory, and CPU/GPU time.
- Smaller models (`tiny`, `base`, `small`, `medium`) can be useful for quick tests or slower machines, but should be checked against audiobook narration quality before batch processing a library.

Portable build note:

- after extracting the portable zip, run `Audiobook Forge.exe` from the unpacked folder

### Docker Web Runtime

The Docker runtime uses the same product and queue workflow through an authenticated browser interface. It supports browser uploads and Audiobookshelf sources, one processing worker, automatic CUDA selection, CPU fallback, result downloads, retention, and managed cleanup.

See the [Docker deployment guide](docs/docker.md) for CPU/GPU Compose commands, NVIDIA requirements, HTTPS and Audiobookshelf networking, backups, upgrades, and troubleshooting.

## How To Use It

### Audiobookshelf Workflow

1. Open `Settings`.
2. Enter your Audiobookshelf URL.
3. Sign in with your Audiobookshelf username and password.
4. Open the Audiobookshelf browser from the source picker.
5. Filter or sort books, especially with `No SRT first`.
6. Select the book you want.
7. Confirm the Whisper model and optional EPUB context.
8. Add the book to the queue.
9. Let Audiobook Forge transcribe and upload the subtitles back to Audiobookshelf.

### Local File Workflow

1. Choose `Browse Files`.
2. Pick one or more `.m4b` or `.mp3` files.
3. Choose an output folder.
4. Pick a Whisper model.
5. Optionally attach an EPUB.
6. Add the job to the queue.
7. Collect the generated `.srt` files from the selected output folder.

## Security And Privacy Notes

- Your Audiobookshelf password is sent to your server only during sign-in and is never stored
- Windows stores returned access and refresh tokens through the OS credential store using `keytar`
- Docker encrypts returned Audiobookshelf session tokens at rest with AES-256-GCM and a persistent server secret
- Authentication tokens are not written into the app settings JSON file as plaintext
- Public Audiobookshelf URLs require HTTPS; validated private/LAN and Docker-network HTTP destinations show a warning
- Docker requires a single-user web password and uses signed HTTP-only sessions, CSRF/origin checks, request limits, and login throttling
- Generated subtitles may be saved locally as a fallback if an Audiobookshelf upload fails

## AI Transcription Disclaimer

Audiobook Forge generates subtitles using Whisper-based speech-to-text tooling.

That means subtitle output can include mistakes such as:

- incorrect words
- punctuation errors
- timing drift
- missed speaker changes
- misheard names, places, or invented terms

Generated subtitles should be reviewed before being treated as authoritative, especially for accessibility-sensitive, educational, archival, or public-facing use.

## Companion App

If you want a subtitle-first listening surface after generating subtitle files, see [Spoken Page](https://github.com/JCDeSantis/spoken-page).

Spoken Page is the playback-side companion app for Audiobookshelf users who want synced subtitle-aware listening, while Audiobook Forge focuses on creating the subtitle files themselves.

## How It Works

Audiobook Forge uses one React renderer with Electron and authenticated HTTP adapters. Windows packages it as an Electron desktop app; Docker serves the same interface from a Node web runtime. Shared persistence, artifacts, subtitle formats, uploads, queue behavior, and compute fallback rules keep the two runtimes aligned.

That pipeline is responsible for:

- storing the Audiobookshelf session tokens in the OS credential manager
- browsing Audiobookshelf libraries through Electron IPC
- downloading Whisper binaries and model files when needed
- preparing, segmenting, and transcribing audiobook audio
- splitting subtitles across multi-part books
- uploading generated subtitles back into Audiobookshelf when supported

## Benchmarking Subtitle Accuracy

Use the lightweight SRT scorer when comparing models or backend changes:

```sh
npm run score:srt -- --reference path/to/reference.txt --srt path/to/transcript.srt
```

The script prints word error rate, edit count, and word counts as JSON so model tests can be compared consistently across audiobook samples.

## Release Automation

This repo includes coordinated GitHub Actions automation for Windows and Docker builds:

- validation workflow: [.github/workflows/ci.yml](.github/workflows/ci.yml)
- release workflow: [.github/workflows/release.yml](.github/workflows/release.yml)

Release behavior:

- Pushes and pull requests run validation
- An exact `v<package version>` tag stages Windows installer/portable assets and the universal Docker image
- Stable publication requires CPU image validation, security scanning, and a real NVIDIA CUDA smoke test
- The workflow publishes immutable version/SHA image tags, SBOM, provenance, licenses, and Windows assets together
- See the [release acceptance matrix](docs/release-acceptance.md) for required evidence and rollback rules

## Credits

Audiobook Forge is built specifically to work with Audiobookshelf, and this project would not exist without it.

- Audiobookshelf GitHub: [advplyr/audiobookshelf](https://github.com/advplyr/audiobookshelf)
- Audiobookshelf site: [audiobookshelf.org](https://www.audiobookshelf.org/)
- whisper.cpp GitHub: [ggml-org/whisper.cpp](https://github.com/ggml-org/whisper.cpp)
- OpenAI Whisper GitHub: [openai/whisper](https://github.com/openai/whisper)

Audiobookshelf provides the library, media, and subtitle attachment infrastructure that Audiobook Forge builds on top of.

whisper.cpp provides the local transcription engine and downloadable runtime used for subtitle generation inside the app.

OpenAI Whisper provides the original Whisper model family and model weights that whisper.cpp-compatible workflows are based on.

## Notes

- Audiobook Forge expects an existing Audiobookshelf server when using ABS integration
- Local file transcription works without Audiobookshelf upload
- Audiobook Forge is a companion tool for Audiobookshelf, not a replacement for it
- Audiobook Forge is not affiliated with or endorsed by the Audiobookshelf project

## License

MIT License. See [LICENSE](LICENSE).

For third-party attribution notes, see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
