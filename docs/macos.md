# Mac installation — Apple Silicon

The coordinated release includes an **unsigned, non-notarized Apple Silicon app**. It uses an ad-hoc signature so ARM executables can run; it does not carry an Apple Developer ID. No Apple account is needed to build or use it. Intel Macs are not covered by these downloads.

1. Download `audiobookforge-<version>-mac-arm64-unsigned.dmg` or the matching ZIP from the project's release.
2. Open the DMG and copy **Audiobook Forge.app** to Applications, or extract the ZIP and move the app to Applications.
3. Try opening the app once. If macOS blocks it because the developer cannot be verified, open **System Settings → Privacy & Security** and use **Open Anyway** for Audiobook Forge, then confirm the prompt. See [Apple's instructions](https://support.apple.com/102445). Only allow the app after verifying its source and checksum; do not disable Gatekeeper globally.
4. Choose audio files or connect Audiobookshelf, select a Whisper model, and add a job to the queue. Models download when needed.

The app bundles its native tools; users do not need Homebrew, Docker, FFmpeg, or a separate Whisper installation for the desktop workflow. Release downloads include SHA-256 checksums and the Mac validation log.

## Desktop and LAN sessions

The desktop window uses a local queue and settings. The embedded web interface uses a separate queue and models under `~/Library/Application Support/Audiobook Forge/server-data/`. Desktop jobs do not appear in the browser session, or vice versa.

The web server listens on port 3000 by default. Its generated password is stored in `~/Library/Application Support/Audiobook Forge/server-password.txt`. If another application uses that port, set `ABF_PORT` before launching as described in `BUILD_MACOS.md`. Desktop operation continues independently if the web server cannot start.

## Validation scope

The hosted Apple Silicon job verifies the ad-hoc signature and native architecture, launches the packaged desktop app, checks its IPC interface and embedded server, and transcribes a real speech sample using CPU. The bundled engine includes Metal support, but a passing CPU check does not establish GPU hardware qualification. The app is not notarized; a successful CI run does not remove the macOS first-launch prompt.
