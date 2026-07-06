# Docker development preview

Audiobook Forge uses one `linux/amd64` image containing independent CPU and NVIDIA CUDA builds of `whisper.cpp`. The application selects CUDA when the container can access a compatible NVIDIA device and otherwise uses the CPU executable.

The image currently pins Ubuntu 22.04, CUDA 12.4.1 runtime libraries, FFmpeg from Ubuntu, and whisper.cpp v1.8.3 at immutable commit `2eeeba56e9edd762b4b38467bab96c2517163158`. NVIDIA lists driver 550.54.14 as the toolkit-paired Linux driver for CUDA 12.4; CUDA 12.x minor-version compatibility begins at Linux driver 525.60.13. Driver 550.54.14 or newer is the recommended deployment floor for this image.

Create `secrets/web_password.txt`, then start the CPU-compatible configuration:

```sh
docker compose up --build
```

To expose an NVIDIA GPU through NVIDIA Container Toolkit while using the same image:

```sh
docker compose -f compose.yml -f compose.gpu.yml up --build
```

Open `http://localhost:3000` and sign in with the configured password. Durable application data and uploaded files are kept in the `audiobookforge-data` volume.

This branch is still under development. Authenticated browser uploads now feed the persistent single-worker transcription queue, results can be downloaded with range support, managed cleanup APIs are available, and Docker ABS login/browsing uses private token storage and pinned network requests.

The remaining release blockers are browser end-to-end coverage, real NVIDIA image qualification, vulnerability/SBOM review, coordinated release publishing, and final acceptance documentation. Do not treat this image as a stable release yet.
