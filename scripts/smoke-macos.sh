#!/usr/bin/env bash
set -euo pipefail

app=${1:-"dist/mac-arm64/Audiobook Forge.app"}
resources="${app}/Contents/Resources"
whisper="${resources}/whisper/whisper-cli"
ffmpeg="${resources}/ffmpeg/ffmpeg"
ffprobe="${resources}/ffmpeg/ffprobe"
smoke_dir=$(mktemp -d)
trap 'rm -rf -- "${smoke_dir}"' EXIT

test "$(uname -m)" = arm64
lipo -verify_arch arm64 "$whisper" "$ffmpeg" "$ffprobe"
codesign --verify --deep --strict --verbose=2 "$app"
codesign --display --verbose=4 "$app" 2> "${smoke_dir}/signature.txt"
grep -q 'Signature=adhoc' "${smoke_dir}/signature.txt"

curl --fail --location --retry 3 --output "${smoke_dir}/model.bin" \
  https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.en.bin
curl --fail --location --retry 3 --output "${smoke_dir}/input.wav" \
  https://raw.githubusercontent.com/ggml-org/whisper.cpp/2eeeba56e9edd762b4b38467bab96c2517163158/samples/jfk.wav

"$ffmpeg" -hide_banner -y -i "${smoke_dir}/input.wav" -ar 16000 -ac 1 \
  -c:a pcm_s16le "${smoke_dir}/prepared.wav"
"$ffprobe" -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 \
  "${smoke_dir}/prepared.wav" > "${smoke_dir}/duration.txt"
awk '$1 > 0 {valid=1} END {exit !valid}' "${smoke_dir}/duration.txt"
"$whisper" -m "${smoke_dir}/model.bin" -f "${smoke_dir}/prepared.wav" \
  --no-gpu -l en -osrt -of "${smoke_dir}/output" 2>&1 | tee "${smoke_dir}/whisper.log"
test -s "${smoke_dir}/output.srt"
grep -q -- '-->' "${smoke_dir}/output.srt"
grep -qi 'country' "${smoke_dir}/output.srt"

echo 'Unsigned/ad-hoc arm64 signatures and packaged CPU transcription passed.'
echo 'Metal acceleration is included but not hardware-qualified by this CPU smoke check.'
