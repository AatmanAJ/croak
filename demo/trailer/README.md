# Croak trailer (v1)

A 30-second, 1920x1080, 60fps trailer built from a raw screen recording of Croak deleting scams,
with every graphic drawn in code. It was rendered with Higgsfield's Katana compositor (`render.py`
plus a canvas engine) in the Higgsfield sandbox.

- `edl.json`: the timeline. Each shot names a source clip with its in-point and speed, or names a
  graphic-only scene.
- `fx.js`: all the graphics. This covers the frog, tongue lashes, CROAKED stamps, the counter, the
  headlines, the feature blitz and the end card. Times are absolute seconds; the `MONT_T0`,
  `VANISH` and `CUTS` tables drive the beats.
- `../qr-nitro-scam.png`: the fake QR poster used in the recording (its code is not a real login).

Source clips are full 3342x2160 frames from the recording, cut at these frame numbers:
img 715+95 (casino username blurred), btc 1690+125, rep 2175+150, stm 2660+115, typo 3105+120,
air 3660+90, cyr 4045+110, qr 4685+110, dm 935+110.

The Katana project state, including the source recording, is saved privately in AJ's Higgsfield
account. The rendered `croak-trailer-v1.mp4` is gitignored because it is about 90MB.
