#!/bin/zsh
# Render the showreel and mix the audio.
#   ./render.sh          -> out/croak-showreel.mp4 (1080p60) and out/croak-showreel-small.mp4
#   ./render.sh mix      -> re-mix the audio onto the last render only
set -e
cd "$(dirname "$0")"
[ "$1" = "mix" ] || npx remotion render src/index.jsx Showreel out/video-raw.mp4 --chrome-mode=chrome-for-testing --concurrency=8 --muted --crf=14 --x264-preset=slow --log=error
# music + sfx under the voiceover: duck the score while the VO talks, then master to -14 LUFS
SCORE=public/audio/score.wav
[ -f $SCORE ] || SCORE=""
if [ -n "$SCORE" ]; then
  ffmpeg -y -loglevel error -i public/vo/vo.wav -i $SCORE -filter_complex \
    "[0:a]highpass=f=90,equalizer=f=3200:t=q:w=1.2:g=3,acompressor=threshold=0.12:ratio=3:attack=5:release=120:makeup=1.4,volume=1.35,aformat=channel_layouts=stereo,asplit=2[vo][key];[1:a]volume=0.9[mus];[mus][key]sidechaincompress=threshold=0.02:ratio=6:attack=10:release=300:makeup=1[duck];[duck][vo]amix=inputs=2:normalize=0,loudnorm=I=-14:TP=-1.2:LRA=9,aresample=48000[out]" \
    -map "[out]" -c:a pcm_s24le out/mix.wav
else
  ffmpeg -y -loglevel error -i public/vo/vo.wav -af "aformat=channel_layouts=stereo,loudnorm=I=-14:TP=-1.2" -c:a pcm_s24le out/mix.wav
fi
ffmpeg -y -loglevel error -i out/video-raw.mp4 -i out/mix.wav -map 0:v -map 1:a -c:v copy -c:a aac -b:a 320k -shortest -movflags +faststart out/croak-showreel.mp4
# a light copy for phones, chat apps and the website
ffmpeg -y -loglevel error -i out/croak-showreel.mp4 -vf scale=1280:-2 -r 30 -c:v libx264 -crf 24 -preset slow -pix_fmt yuv420p -c:a aac -b:a 160k -movflags +faststart out/croak-showreel-small.mp4
ls -lh out/croak-showreel*.mp4
