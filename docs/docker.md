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

This branch is still under development. Browser upload-to-transcription wiring, Docker ABS credentials, hardware qualification, retention controls, and coordinated release publishing must pass their milestone gates before this image is considered a stable release.
