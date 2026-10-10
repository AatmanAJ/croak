# Croak showreel audio

Original score and sound design, synthesised from scratch in dependency-free Node (no samples). Every time comes from `../timeline.json`.

- Render: `node demo/showreel/audio/synth.mjs` (about 4 s; seeded, so re-runs are bit-identical). `SYNTH_DEBUG=1` prints per-stem loudness, momentary loudness and limiter activity.
- Verify: `node demo/showreel/audio/analyze.mjs` (gap silence, <120 Hz share, onset alignment, croak formants, SFX audibility).
- Output in `demo/showreel/public/audio/`: `music.wav` (score), `sfx.wav` (effects), `score.wav` (both). All are 48 kHz, 24-bit stereo, exactly 1,728,000 frames (36.000 s).
- `music.wav + sfx.wav == score.wav`: the master makeup and limiter gain curve is shared, so the stems re-sum exactly.
- Spectrogram of `score.wav`: `spec.png`.

Measured with `ffmpeg ebur128=peak=true` and `astats`:

| file | integrated | true peak | LRA |
|---|---|---|---|
| score.wav | -16.0 LUFS | -1.9 dBTP | 3.6 LU |
| music.wav | -16.8 LUFS | -2.0 dBTP | 4.8 LU |
| sfx.wav | -21.8 LUFS | -4.3 dBTP | 5.8 LU |

- DC offset is at most 0.000004 and there are no clipped (flat) runs. The limiter applies at most 0.9 dB of gain reduction, on 2.4% of samples.
- The gaps at 7.75-8.00 and 31.75-32.00 and the tail at 35.90-36.00 are digital silence (-inf) in all three files.
- Onsets of slam, impact and stamp in `sfx.wav` land within 0.3 ms of their timeline times. The hits at 4-8 s and 32 s in `music.wav` land within 1.7 ms.
- Energy below 120 Hz is about 45-51% of total power in the groove sections and 2% in the breakdown.
