# Building AudiobookForge for Apple Silicon (M-series)

Three modes are available on M-series Macs:

| Mode | GPU | Use case |
|---|---|---|
| Docker (arm64) | CPU only | Simple self-contained deployment |
| Native server | Metal (M-series GPU) | Best transcription performance |
| Electron DMG | Metal (auto) | Desktop app, unsigned/ad-hoc release by default |

---

## Prerequisites

```bash
xcode-select --install        # Xcode CLI tools (required for all modes)
node --version                # must be 22+; use https://nodejs.org or nvm
npm ci                        # install dependencies
```

Mode 2 (native server) additionally requires CMake and FFmpeg via Homebrew:

```bash
brew install cmake ffmpeg
```

---

## Mode 1 — Docker (arm64, CPU-only)

Linux containers on macOS run inside a VM with no Metal/GPU passthrough.
Transcription uses CPU only. Suitable for testing or low-volume use.

### Build the image

```bash
docker buildx build \
  --platform linux/arm64 \
  -f Dockerfile.arm64 \
  -t audiobookforge:arm64 \
  .
```

### Create secrets file

```bash
mkdir -p secrets
echo "yourpassword" > secrets/web_password.txt
```

### Run

```bash
docker compose -f compose.arm64.yml up
```

Open http://localhost:3000.

### Stop

```bash
docker compose -f compose.arm64.yml down
```

---

## Mode 2 — Native Server with Metal GPU

Runs the Node.js server directly on macOS. whisper-cli uses Metal for
GPU-accelerated transcription on M-series hardware.

### Step 1 — Build whisper-cli with Metal support

```bash
git clone https://github.com/ggml-org/whisper.cpp /tmp/whisper-src
cd /tmp/whisper-src
git checkout 2eeeba56e9edd762b4b38467bab96c2517163158

cmake -B build \
  -DCMAKE_BUILD_TYPE=Release \
  -DBUILD_SHARED_LIBS=OFF \
  -DGGML_NATIVE=OFF \
  -DGGML_METAL=ON \
  -DGGML_METAL_EMBED_LIBRARY=ON

cmake --build build --target whisper-cli -j"$(sysctl -n hw.physicalcpu)"
```

Install the binary:

```bash
install -Dm755 build/bin/whisper-cli /usr/local/bin/whisper-cli
```

### Step 2 — Build the server

```bash
npm ci
npm run build:web && npm run build:server
```

### Step 3 — Run

```bash
export ABF_WHISPER_CPU_PATH=/usr/local/bin/whisper-cli
export ABF_WHISPER_ALLOW_GPU=true
export ABF_DATA_DIR="${HOME}/.local/share/audiobookforge"
export ABF_WEB_PASSWORD="yourpassword"
export ABF_PORT=3000
export ABF_FFMPEG_PATH="$(which ffmpeg)"
export ABF_FFPROBE_PATH="$(which ffprobe)"

node dist/server/index.mjs
```

`ABF_FFMPEG_PATH` and `ABF_FFPROBE_PATH` default to `/usr/bin/ffmpeg` and `/usr/bin/ffprobe`
which do not exist on stock macOS. The `brew install ffmpeg` step above installs them to
`/opt/homebrew/bin/` — setting the env vars points the server at the Homebrew binaries.

Open http://localhost:3000.

Models are downloaded automatically to `$ABF_DATA_DIR/whisper/models/` on first use.

### Verify Metal is active

After submitting a transcription job, confirm Metal loaded:

```bash
# whisper-cli writes to stderr — visible in server output
# Look for a line containing:
ggml_metal_init
```

---

## Mode 3 — Electron Desktop App (unsigned DMG)

### Embedded web server

The macOS Electron app automatically starts the web server when it launches.
The server listens on port 3000 and is accessible from other devices on your network.

**Desktop window vs. server runtime:** The Electron desktop window and the embedded
web server are independent runtimes with separate state. The desktop window uses a
local IPC queue stored in:
```
~/Library/Application Support/Audiobook Forge/
```
The embedded server stores its own queue, models, and settings under:
```
~/Library/Application Support/Audiobook Forge/server-data/
```
LAN clients connect to the embedded server; their session is independent of the
desktop window. Jobs submitted via the desktop window are not visible to LAN clients
and vice versa.

**Port conflicts:** If port 3000 is already in use the embedded server will fail to
start. The desktop window continues to work via IPC. Free the port before
launching, or override the server port with `ABF_PORT`:
```bash
ABF_PORT=3001 open -a "Audiobook Forge"
```

On first launch, a random password is generated and saved to:
```
~/Library/Application Support/Audiobook Forge/server-password.txt
```

Read it any time:
```bash
cat ~/Library/Application\ Support/Audiobook\ Forge/server-password.txt
```

Override the whisper binary path before launching (useful if installed elsewhere):
```bash
ABF_WHISPER_CPU_PATH=/path/to/whisper-cli open -a "Audiobook Forge"
```

`ABF_WHISPER_ALLOW_GPU=true` is set automatically by the embedded server on macOS.
Metal is used whenever whisper-cli was compiled with `-DGGML_METAL=ON`.

### Local one-off build (unsigned)

Requires Xcode CLI tools and CMake — install once if not already present:

```bash
xcode-select --install
brew install cmake
```

The build automatically compiles whisper-cli with Metal support and bundles it
inside the DMG. No separate whisper installation needed.

First build takes ~5–10 min (cmake compile). Subsequent builds are instant —
`build/whisper-macos/whisper-cli` is cached and reused.

Then build:

```bash
npm ci
npm run build:mac:arm64
# Output: dist/audiobookforge-<version>-mac-arm64-unsigned.dmg (and ZIP)
```

This command explicitly uses the unsigned configuration, disables notarization, and applies an ad-hoc signature for Apple Silicon execution. It does not need an Apple account or certificates. Follow [the Mac installation guide](docs/macos.md) for System Settings → Privacy & Security → Open Anyway if Gatekeeper blocks first launch. Run `bash scripts/smoke-macos.sh` and `npm run test:mac:app` to validate the packaged build on Apple Silicon.

### Optional Developer ID build (outside the default release workflow)

Requires an Apple Developer ID Application certificate in the login Keychain.

```bash
# Find your identity name (copy the full quoted string):
security find-identity -v -p codesigning | grep "Developer ID Application"
```

Copy `.env.mac.example` to `.env.mac` and replace the placeholder with your identity:

```bash
cp .env.mac.example .env.mac
# Edit .env.mac — set CSC_NAME="Developer ID Application: Your Name (TEAMID)"
```

Verify the file sources correctly before building:

```bash
source .env.mac && echo "CSC_NAME=$CSC_NAME"
# Expected: CSC_NAME=Developer ID Application: Your Name (TEAMID)
```

Then build:

```bash
npm run build:mac:signed
# Output: dist/audiobookforge-<version>.dmg
```

The resulting DMG is Developer ID signed. On macOS 12 and later, Gatekeeper still requires right-click → Open on first launch unless the build is also notarized. To enable notarization, add `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, and `APPLE_TEAM_ID` to `.env.mac` and set `notarize: true` in `electron-builder.yml`.

