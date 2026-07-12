# syntax=docker/dockerfile:1.7

ARG WHISPER_VERSION=v1.8.3
ARG WHISPER_COMMIT=2eeeba56e9edd762b4b38467bab96c2517163158

FROM ubuntu:22.04 AS whisper-cpu
ARG WHISPER_VERSION
ARG WHISPER_COMMIT
RUN apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
    build-essential ca-certificates cmake git \
    && rm -rf /var/lib/apt/lists/*
RUN git init /src/whisper.cpp \
    && git -C /src/whisper.cpp remote add origin https://github.com/ggml-org/whisper.cpp.git \
    && git -C /src/whisper.cpp fetch --depth 1 origin "${WHISPER_COMMIT}" \
    && git -C /src/whisper.cpp checkout --detach FETCH_HEAD \
    && test "$(git -C /src/whisper.cpp rev-parse HEAD)" = "${WHISPER_COMMIT}" \
    && cmake -S /src/whisper.cpp -B /src/whisper.cpp/build \
      -DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=OFF -DGGML_CUDA=OFF \
    && cmake --build /src/whisper.cpp/build --config Release --target whisper-cli -j"$(nproc)" \
    && install -Dm755 /src/whisper.cpp/build/bin/whisper-cli /artifacts/cpu/whisper-cli

FROM nvidia/cuda:12.4.1-devel-ubuntu22.04 AS whisper-cuda
ARG WHISPER_VERSION
ARG WHISPER_COMMIT
RUN apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
    build-essential ca-certificates cmake git \
    && rm -rf /var/lib/apt/lists/*
RUN git init /src/whisper.cpp \
    && git -C /src/whisper.cpp remote add origin https://github.com/ggml-org/whisper.cpp.git \
    && git -C /src/whisper.cpp fetch --depth 1 origin "${WHISPER_COMMIT}" \
    && git -C /src/whisper.cpp checkout --detach FETCH_HEAD \
    && test "$(git -C /src/whisper.cpp rev-parse HEAD)" = "${WHISPER_COMMIT}" \
    && cmake -S /src/whisper.cpp -B /src/whisper.cpp/build \
      -DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=OFF -DGGML_CUDA=ON \
    && cmake --build /src/whisper.cpp/build --config Release --target whisper-cli -j"$(nproc)" \
    && install -Dm755 /src/whisper.cpp/build/bin/whisper-cli /artifacts/cuda/whisper-cli

FROM node:22-bullseye AS application-build
WORKDIR /build
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY . .
RUN npm run build:web && npm run build:server

FROM nvidia/cuda:12.4.1-runtime-ubuntu22.04 AS runtime
LABEL org.opencontainers.image.source="https://github.com/JCDeSantis/audiobookforge"
LABEL org.opencontainers.image.description="Audiobook Forge single-user CPU/CUDA web runtime"

RUN apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
    ca-certificates curl dumb-init ffmpeg \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --gid 10001 audiobookforge \
    && useradd --uid 10001 --gid audiobookforge --create-home --shell /usr/sbin/nologin audiobookforge \
    && mkdir -p /app/out /data /opt/audiobookforge/whisper/cpu /opt/audiobookforge/whisper/cuda \
    && chown -R audiobookforge:audiobookforge /app /data

# The Bullseye Node build is compatible with the Ubuntu 22.04 runtime glibc and avoids
# adding a package repository to the final image.
COPY --from=application-build /usr/local/ /usr/local/
COPY --from=application-build --chown=audiobookforge:audiobookforge /build/dist/server /app/server
COPY --from=application-build --chown=audiobookforge:audiobookforge /build/out/renderer /app/out/renderer
COPY --from=whisper-cpu /artifacts/cpu/whisper-cli /opt/audiobookforge/whisper/cpu/whisper-cli
COPY --from=whisper-cuda /artifacts/cuda/whisper-cli /opt/audiobookforge/whisper/cuda/whisper-cli

ENV NODE_ENV=production \
    ABF_HOST=0.0.0.0 \
    ABF_PORT=3000 \
    ABF_DATA_DIR=/data \
    ABF_WEB_ROOT=/app/out/renderer \
    ABF_WHISPER_CPU_PATH=/opt/audiobookforge/whisper/cpu/whisper-cli \
    ABF_WHISPER_CUDA_PATH=/opt/audiobookforge/whisper/cuda/whisper-cli

WORKDIR /app
VOLUME ["/data"]
EXPOSE 3000
USER audiobookforge
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD curl --fail --silent http://127.0.0.1:3000/healthz >/dev/null || exit 1
ENTRYPOINT ["/usr/bin/dumb-init", "--"]
CMD ["node", "/app/server/index.mjs"]
