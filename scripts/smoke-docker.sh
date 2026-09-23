#!/usr/bin/env bash
set -euo pipefail

image=${1:?An image digest is required}
backend=${2:?Choose cpu or cuda}
case "${backend}" in
  cpu) gpu_args=() ;;
  cuda) gpu_args=(--gpus all) ;;
  *) echo 'Backend must be cpu or cuda' >&2; exit 1 ;;
esac

smoke_dir=$(mktemp -d)
trap 'rm -rf -- "${smoke_dir}"' EXIT
curl --fail --location --retry 3 --output "${smoke_dir}/model.bin" \
  https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.en.bin
curl --fail --location --retry 3 --output "${smoke_dir}/input.wav" \
  https://raw.githubusercontent.com/ggml-org/whisper.cpp/2eeeba56e9edd762b4b38467bab96c2517163158/samples/jfk.wav
docker run --rm "${gpu_args[@]}" --user "$(id -u):$(id -g)" \
  --entrypoint "/opt/audiobookforge/whisper/${backend}/whisper-cli" \
  --volume "${smoke_dir}:/smoke" "${image}" \
  -m /smoke/model.bin -f /smoke/input.wav -l en -osrt -of /smoke/output 2>&1 | tee "${smoke_dir}/whisper.log"
test -s "${smoke_dir}/output.srt"
grep -q -- '-->' "${smoke_dir}/output.srt"
grep -qi 'country' "${smoke_dir}/output.srt"
if [[ "${backend}" == cuda ]]; then
  grep -Eq 'using CUDA[0-9]+ backend' "${smoke_dir}/whisper.log"
  if grep -Eq 'failed to initialize CUDA[0-9]+ backend' "${smoke_dir}/whisper.log"; then exit 1; fi
fi
