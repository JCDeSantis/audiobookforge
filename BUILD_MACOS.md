# Building AudiobookForge for Apple Silicon (M-series)

Three modes are available on M-series Macs:

| Mode | GPU | Use case |
|---|---|---|
| Docker (arm64) | CPU only | Simple self-contained deployment |
| Native server | Metal (M-series GPU) | Best transcription performance |
| Electron DMG | Metal (auto) | Desktop app, signed for distribution |

---

## Prerequisites

```bash
xcode-select --install        # Xcode CLI tools
node --version                # must be 22+; use https://nodejs.org or nvm
npm ci                        # install dependencies
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

node dist/server/index.mjs
```

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

## Mode 3 — Electron Desktop App (signed DMG)

### Embedded web server

The macOS Electron app automatically starts the web server when it launches.
The server listens on port 3000 and is accessible from other devices on your network.

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

Requires Xcode CLI tools — install once if not already present:

```bash
xcode-select --install
```

The build automatically compiles whisper-cli with Metal support and bundles it
inside the DMG. No separate whisper installation needed.

First build takes ~5–10 min (cmake compile). Subsequent builds are instant —
`build/whisper-macos/whisper-cli` is cached and reused.

Then build:

```bash
npm ci
npm run build:mac:arm64
# Output: dist/Audiobook Forge-<version>-arm64.dmg
```

Unsigned builds trigger a Gatekeeper warning. Right-click → Open to bypass.

### Signed build

Requires an Apple Developer ID Application certificate in the login Keychain.
Copy `.env.mac.example` to `.env.mac` and set `CSC_NAME` to your identity:

```bash
# Find your identity name:
security find-identity -v -p codesigning | grep "Developer ID Application"

npm run build:mac:signed
# Output: dist/audiobookforge-<version>.dmg
```

The resulting DMG installs without Gatekeeper warnings.

### Universal binary (Intel + Apple Silicon)

```bash
npm run build:mac:universal
```

Produces a fat binary that runs natively on both x64 and arm64 Macs.

