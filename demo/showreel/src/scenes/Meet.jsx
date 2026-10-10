import React from 'react';
import { AbsoluteFill } from 'remotion';
import { C, FONT } from '../brand';
import { E, EyesMark, FlatGrid, Flash, Pill, Shockwave, display, pulse, shake, sp, tw, useT } from '../lib';

// 8 to 12 s: the drop. Lime floods in, the eyes open, the wordmark lands, then the tagline.

const CHIPS = ['links', 'invites', 'images', 'QR codes', 'raids', 'look-alikes', 'hacked accounts', 'short links'];

/** lid position over time: shut, a surprised pop open, then the half-lidded watching look */
function lidAt(t) {
  if (t < 8.3) return 22;
  if (t < 8.42) return tw(t, 8.3, 8.42, 22, 11.5, E.outQuint);
  if (t < 8.9) return tw(t, 8.6, 8.9, 11.5, 16.2, E.inOut);
  // a quick blink at 9.7
  if (t > 9.7 && t < 9.86) return t < 9.78 ? tw(t, 9.7, 9.78, 16.2, 22, E.inOut) : tw(t, 9.78, 9.86, 22, 16.2, E.inOut);
  return 16.2;
}

function lookAt(t) {
  const x = tw(t, 8.55, 8.7, 0, -1, E.outQuint) + tw(t, 8.95, 9.1, 0, 2, E.outQuint) + tw(t, 9.35, 9.5, 0, -1, E.outQuint) + tw(t, 10.0, 10.3, 0, 0.6, E.inOut);
  const y = tw(t, 9.35, 9.5, 0, -0.4, E.outQuint) + tw(t, 10.0, 10.3, 0, 0.9, E.inOut);
  return { x, y };
}

export function Meet() {
  const t = useT(8);
  const iris = tw(t, 8, 8.22, 0, 1, E.outQuint);
  const sh = shake(t, [8, 10], 22, 0.4, 'meet');
  const cam = 1.08 - sp(t, 8, { damping: 20, stiffness: 90 }) * 0.08;

  const markIn = sp(t, 8.02, { damping: 9, stiffness: 150, mass: 0.8 });
  const lift = sp(t, 10, { damping: 16, stiffness: 120 });
  const look = lookAt(t);
  const breathe = 1 + Math.sin(t * 5) * 0.008;

  return (
    <AbsoluteFill style={{ background: '#000', overflow: 'hidden' }}>
      <AbsoluteFill style={{ clipPath: `circle(${iris * 120}% at 50% 50%)`, background: C.lime }}>
        <AbsoluteFill style={{ background: 'radial-gradient(circle at 75% 20%, rgba(255,255,255,0.65), rgba(255,255,255,0) 50%)' }} />
        <FlatGrid color="rgba(85,99,44,0.13)" size={80} offset={-(t - 8) * 20} />
        <AbsoluteFill style={{ transform: `translate(${sh.x}px, ${sh.y}px) scale(${cam})` }}>
          {/* lockup */}
          <AbsoluteFill
            style={{
              alignItems: 'center',
              justifyContent: 'center',
              transform: `translateY(${lift * -250}px) scale(${1 - lift * 0.42})`,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 56 }}>
              <div style={{ transform: `scale(${markIn * breathe}) rotate(${(1 - markIn) * -40}deg)` }}>
                <EyesMark size={360} lid={lidAt(t)} lookX={look.x} lookY={look.y} id="meet" style={{ filter: 'drop-shadow(0 40px 60px rgba(34,47,14,0.35))' }} />
              </div>
              <div style={{ display: 'flex', overflow: 'hidden', paddingBottom: 30, marginBottom: -30 }}>
                {[...'croak'].map((ch, i) => {
                  const p = sp(t, 8.45 + i * 0.05, { damping: 12, stiffness: 180 });
                  return (
                    <span key={i} style={{ ...display(330, { fontWeight: 600, letterSpacing: '-0.065em', color: C.ink }), display: 'inline-block', transform: `translateY(${(1 - p) * 110}%) rotate(${(1 - p) * 12}deg)` }}>
                      {ch}
                    </span>
                  );
                })}
              </div>
            </div>
          </AbsoluteFill>

          {/* tagline */}
          {t >= 10 && (
            <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', paddingTop: 300 }}>
              <div style={{ textAlign: 'center' }}>
                <div style={{ overflow: 'hidden', paddingBottom: 14 }}>
                  <div style={{ ...display(150, { color: C.ink }), transform: `translateY(${(1 - tw(t, 10.08, 10.6, 0, 1)) * 105}%)` }}>AI moderation</div>
                </div>
                <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 34, marginTop: 6 }}>
                  <div style={{ overflow: 'hidden', paddingBottom: 14 }}>
                    <div style={{ ...display(150, { color: C.ink }), transform: `translateY(${(1 - tw(t, 10.22, 10.74, 0, 1)) * 105}%)` }}>for</div>
                  </div>
                  <div style={{ position: 'relative', padding: '4px 34px 18px', overflow: 'hidden', borderRadius: 30 }}>
                    <div style={{ position: 'absolute', inset: 0, background: C.olive, borderRadius: 30, transform: `scaleX(${tw(t, 10.3, 10.75, 0, 1, E.outQuint)})`, transformOrigin: 'left' }} />
                    <div style={{ ...display(150, { color: C.lime }), position: 'relative', transform: `translateY(${(1 - tw(t, 10.45, 10.95, 0, 1)) * 110}%)` }}>Discord.</div>
                  </div>
                </div>
              </div>
            </AbsoluteFill>
          )}

          {/* orbiting chips */}
          {t >= 10.3 &&
            CHIPS.map((c, i) => {
              // a conveyor arc under the tagline: only the front half of the orbit is shown
              const a = (i / CHIPS.length) * Math.PI * 2 + (t - 10) * 0.75;
              const z = Math.sin(a);
              const appear = sp(t, 10.3 + i * 0.05, { damping: 13 });
              const x = 960 + Math.cos(a) * 900;
              const y = 600 + z * 380;
              const s = (0.7 + Math.max(0, z) * 0.45) * appear;
              if (z < -0.05) return null;
              return (
                <div key={c} style={{ position: 'absolute', left: x, top: y, transform: `translate(-50%,-50%) scale(${s})`, zIndex: 5, opacity: Math.min(1, (z + 0.05) * 5) }}>
                  <Pill bg={i % 2 ? C.olive : '#fff'} color={i % 2 ? C.limeSoft : C.ink} style={{ fontSize: 30, padding: '14px 26px', boxShadow: '0 16px 40px rgba(34,47,14,0.18)' }}>
                    <span style={{ width: 12, height: 12, borderRadius: 99, background: C.tongue }} />
                    {c}
                  </Pill>
                </div>
              );
            })}
        </AbsoluteFill>
        <Shockwave t={t} at={8.02} color={C.olive} width={60} max={1500} dur={0.9} />
        <Shockwave t={t} at={8.12} color="#fff" width={30} max={1300} dur={0.9} />
      </AbsoluteFill>
      <Flash t={t} at={8} color="#fff" dur={0.3} max={0.9} />
      <Flash t={t} at={10} color="#fff" dur={0.15} max={0.25} />
      <div style={{ position: 'absolute', left: 80, bottom: 70, fontFamily: FONT, fontSize: 26, color: C.limeInk, opacity: tw(t, 8.8, 9.2, 0, 0.9) * (1 - pulse(t, 11.9, 0.1)) }}>
        Spam croaks here.
      </div>
    </AbsoluteFill>
  );
}
