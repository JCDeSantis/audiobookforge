# Docker development preview

Audiobook Forge uses one `linux/amd64` image containing independent CPU and NVIDIA CUDA builds of `whisper.cpp`. The application selects CUDA when the container can access a compatible NVIDIA device and otherwise uses the CPU executable.

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

The remaining release blockers are Docker ABS audio retrieval/subtitle upload parity, remote EPUB context, resumable upload recovery after a browser restart, streamed Download All, browser end-to-end coverage, real CPU/NVIDIA image qualification, recovery/ENOSPC hardening, and coordinated release publishing. Do not treat this image as a stable release yet.
