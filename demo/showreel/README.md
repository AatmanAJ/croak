# Croak showreel

The 36-second film on the website, built from code: Remotion for the picture, Fish Audio for the voice, and a synthesiser in `audio/synth.mjs` for the music and sound effects. No stock footage, samples or screen recordings.

`timeline.json` is the source of truth. It sets 120 BPM and 60 fps, and lists the scene boundaries, music sections, sound effects and voiceover cues. Change it first, then rebuild whatever depends on it.

```bash
npm install
node vo/fish.mjs build      # voiceover -> public/vo/vo.wav (needs FISH_AUDIO_API_KEY in .env)
node audio/synth.mjs        # music + sfx -> public/audio/*.wav (about 4 s, deterministic)
./render.sh                 # picture + mix -> out/croak-showreel.mp4 and out/croak-showreel-small.mp4
./render.sh mix             # re-mix the audio onto the last render
node stills.mjs 4.2 14.5    # contact sheet of stills -> out/stills/sheet.jpg
npm run studio              # live preview in Remotion Studio
```

Scenes are in `src/scenes/`: Intro 0–8, Meet 8–12, How 12–16, Montage 16–22, Mods 22–28, Setup 28–32, End 32–36. Shared motion helpers are in `src/lib.jsx` and the brand palette is in `src/brand.js`.

Notes:
- Remotion runs with `--chrome-mode=chrome-for-testing`, because the default headless shell crashes on this Mac.
- Concurrency above 8 fails to open its pages.
- The voice is Fish Audio's "Conversational Narrator", read with the free `s2.1-pro-free` model. Other candidate voices are in `public/vo/samples/`, and `node vo/fish.mjs build tech-male` swaps the voice. Takes are cached in `public/vo/cache` so rebuilds are stable.
- Lines are checked with local whisper.cpp; Fish's own transcription needs paid API credit.
