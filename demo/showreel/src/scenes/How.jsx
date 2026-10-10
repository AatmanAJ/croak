import React from 'react';
import { AbsoluteFill, random } from 'remotion';
import { evolvePath, getPointAtLength, getLength } from '@remotion/paths';
import { C, FONT, MONO } from '../brand';
import { E, EyesMark, FlatGrid, Flash, Label, Message, Pill, display, mono, pulse, shake, sp, tw, useT } from '../lib';

// 12 to 16 s: a link, an invite and an image land in #general, get scanned and scored,
// the tongue licks all three away, CROAKED, 0.19 s.

const MSGS = [
  { at: 12.05, name: 'nitro_drops', text: 'Free Nitro for 3 months 🎁', link: 'dlscord-gift.com/nitro', kind: 'link', score: 'scam 0.99', avatar: 0 },
  { at: 12.55, name: 'hotsingles', text: '18+ server 🔥 join now', link: 'discord.gg/h0t-s1ngles', kind: 'invite', score: 'nsfw 0.97', avatar: 3 },
  { at: 13.05, name: 'mrbeast_official', text: 'giveaway, first 100 only 💸', kind: 'image', score: 'scam 1.00', avatar: 2, image: true },
];

const PANEL = { x: 250, y: 120, w: 1420, h: 840 };
const ROW_Y = [250, 420, 590]; // message tops, relative to the panel
const MOUTH = { x: 150, y: 560 }; // where the tongue comes from (absolute)
const TONGUE_OUT = 14.0;
const TONGUE_BACK = 14.16;
const GULP = 14.36;

function ScamImage() {
  return (
    <div
      style={{
        marginTop: 14,
        width: 300,
        height: 150,
        borderRadius: 16,
        background: 'linear-gradient(135deg,#1A1A2E,#3A1D5C 55%,#B8892B)',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        padding: '0 24px',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      <div style={{ fontFamily: FONT, fontWeight: 600, fontSize: 40, color: '#FFD86B', letterSpacing: '-0.04em', lineHeight: 1 }}>$5,000</div>
      <div style={{ fontFamily: FONT, fontWeight: 600, fontSize: 24, color: '#fff', letterSpacing: '0.02em' }}>GIVEAWAY</div>
      <div style={{ ...mono(14, { color: 'rgba(255,255,255,0.6)', marginTop: 6 }) }}>MRBEAST_GIVEAWAY.png</div>
    </div>
  );
}

function Verdict({ t, m }) {
  const scanned = t >= 13.5;
  const checking = t >= 13.1 && !scanned;
  const pop = sp(t, 13.5 + MSGS.indexOf(m) * 0.06, { damping: 9, stiffness: 260 });
  if (scanned) {
    return (
      <span style={{ transform: `scale(${0.4 + pop * 0.6})`, display: 'inline-block' }}>
        <Pill bg={C.tongue} color="#fff" style={{ fontFamily: MONO, fontWeight: 700, fontSize: 26, padding: '10px 22px', boxShadow: `0 0 ${pulse(t, 13.5, 0.5) * 40}px rgba(255,92,138,0.8)` }}>
          {m.score}
        </Pill>
      </span>
    );
  }
  const dots = '.'.repeat(1 + (Math.floor(t * 10) % 3));
  return (
    <Pill bg={checking ? C.olive : '#F1F2EC'} color={checking ? C.lime : C.body} style={{ fontSize: 24, padding: '10px 22px', border: checking ? 'none' : `2px dashed rgba(28,37,15,0.18)` }}>
      {checking ? `checking ${m.kind}${dots}` : m.kind}
    </Pill>
  );
}

export function How() {
  const t = useT(12);
  const enter = sp(t, 12, { damping: 18, stiffness: 120 });
  const sh = shake(t, [14.5], 28, 0.45, 'how');
  const lean = tw(t, 12, 13.6, 7, 0, E.inOut);

  // tongue path from the mark's mouth to the middle message
  const tip = { x: PANEL.x + 900, y: PANEL.y + ROW_Y[1] + 60 };
  const d = `M ${MOUTH.x} ${MOUTH.y} C ${MOUTH.x + 300} ${MOUTH.y + 140}, ${tip.x - 420} ${tip.y + 160}, ${tip.x} ${tip.y}`;
  const len = getLength(d);
  const out = tw(t, TONGUE_OUT, TONGUE_OUT + 0.11, 0, 1, E.outQuint);
  const back = tw(t, TONGUE_BACK, GULP, 0, 1, E.inExpo);
  const reach = t < TONGUE_BACK ? out : 1 - back;
  const tongueOn = t >= TONGUE_OUT && t < GULP + 0.02;
  const tipPt = getPointAtLength(d, Math.max(1, reach * len));

  const markIn = sp(t, 13.62, { damping: 13, stiffness: 170 });
  const markOut = tw(t, 14.7, 15.05, 0, 1, E.inExpo);
  const gulp = pulse(t, GULP, 0.3);

  const stampP = sp(t, 14.5, { damping: 11, stiffness: 300, mass: 0.7 });
  const count = tw(t, 14.6, 15.2, 0, 0.19, E.outQuint);

  return (
    <AbsoluteFill style={{ background: C.canvas, overflow: 'hidden' }}>
      <FlatGrid color="rgba(28,37,15,0.06)" size={72} offset={(t - 12) * -14} />
      <AbsoluteFill style={{ transform: `translate(${sh.x}px, ${sh.y}px)` }}>
        {/* the channel */}
        <AbsoluteFill style={{ perspective: 2000 }}>
          <div
            style={{
              position: 'absolute',
              left: PANEL.x,
              top: PANEL.y,
              width: PANEL.w,
              height: PANEL.h,
              borderRadius: 44,
              background: '#fff',
              boxShadow: '0 50px 120px rgba(28,37,15,0.16)',
              transform: `translateY(${(1 - enter) * 300}px) rotateX(${lean}deg) scale(${0.92 + enter * 0.08})`,
              transformOrigin: '50% 100%',
              overflow: 'hidden',
            }}
          >
            <div style={{ height: 104, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 48px', borderBottom: '2px solid #EEF0E8' }}>
              <span style={{ fontFamily: FONT, fontWeight: 600, fontSize: 34, color: C.ink, letterSpacing: '-0.03em' }}>
                <span style={{ color: 'rgba(28,37,15,0.35)', marginRight: 14 }}>#</span>general
              </span>
              <Pill bg={C.limeSoft} color={C.ink} style={{ fontSize: 24, gap: 12 }}>
                <EyesMark size={34} radius={9} id="how-badge" lookX={Math.sin(t * 3) * 0.6} />
                Croak is watching
              </Pill>
            </div>
            <div style={{ position: 'absolute', left: 48, top: 130, fontFamily: FONT, fontSize: 24, color: 'rgba(28,37,15,0.4)' }}>
              <Message name="maya" text="anyone up for ranked tonight?" avatar={1} scale={0.85} />
            </div>

            {/* scan beam */}
            {t >= 13.1 && t < 13.62 && (
              <div
                style={{
                  position: 'absolute',
                  left: 0,
                  right: 0,
                  top: tw(t, 13.1, 13.5, 210, 790, E.inOut),
                  height: 140,
                  background: 'linear-gradient(180deg, rgba(218,243,107,0) 0%, rgba(218,243,107,0.55) 80%, #B4CF4E 100%)',
                  opacity: tw(t, 13.5, 13.62, 1, 0, E.linear),
                }}
              />
            )}

            {MSGS.map((m, i) => {
              const p = sp(t, m.at, { damping: 15, stiffness: 190 });
              // licked: pulled along the tongue back to the mouth
              const lick = back;
              const px = (MOUTH.x - PANEL.x - 48) * lick;
              const py = (MOUTH.y - PANEL.y - ROW_Y[i] - 40) * lick;
              const gone = t >= GULP;
              if (t < m.at || gone) return null;
              return (
                <div
                  key={m.name}
                  style={{
                    position: 'absolute',
                    left: 48,
                    right: 48,
                    top: ROW_Y[i],
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'flex-start',
                    transform: `translate(${px}px, ${py + (1 - p) * 60}px) scale(${1 - lick * 0.85}) rotate(${lick * (i - 1) * 25}deg)`,
                    transformOrigin: 'left center',
                    opacity: Math.min(1, p * 2),
                    filter: `blur(${(1 - p) * 8 + lick * 3}px)`,
                  }}
                >
                  <Message name={m.name} text={m.text} link={m.link} avatar={m.avatar}>
                    {m.image && <ScamImage />}
                  </Message>
                  <div style={{ paddingTop: 10 }}>
                    <Verdict t={t} m={m} />
                  </div>
                </div>
              );
            })}

            {/* CROAKED + timer, once the channel is clean */}
            {t >= 14.5 && (
              <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 90, paddingTop: 80 }}>
                <div
                  style={{
                    transform: `rotate(-9deg) scale(${2.4 - stampP * 1.4})`,
                    opacity: Math.min(1, stampP * 3),
                    border: `12px solid ${C.tongue}`,
                    borderRadius: 26,
                    padding: '20px 44px',
                    ...mono(150, { fontWeight: 700, color: C.tongueInk, letterSpacing: '0.06em', lineHeight: 1 }),
                    mixBlendMode: 'multiply',
                  }}
                >
                  CROAKED
                </div>
                <div style={{ opacity: tw(t, 14.6, 14.8, 0, 1), transform: `translateY(${(1 - tw(t, 14.6, 14.9, 0, 1)) * 40}px)` }}>
                  <Label size={30}>AI check took</Label>
                  <div style={{ ...display(220, { color: C.ink, fontWeight: 500 }), display: 'flex', alignItems: 'baseline' }}>
                    <span style={{ fontFamily: MONO, fontWeight: 500, letterSpacing: '-0.06em' }}>{count.toFixed(2)}</span>
                    <span style={{ fontSize: 90, marginLeft: 10 }}>s</span>
                  </div>
                  <div style={{ fontFamily: FONT, fontSize: 32, color: C.body, letterSpacing: '-0.02em' }}>before anyone clicks</div>
                </div>
              </div>
            )}
            {/* stamp dust */}
            {t >= 14.5 &&
              t < 15.3 &&
              Array.from({ length: 26 }, (_, k) => {
                const a = random(`dust${k}`) * Math.PI * 2;
                const v = 200 + random(`dv${k}`) * 520;
                const q = tw(t, 14.5, 15.3, 0, 1, E.outExpo);
                return (
                  <div
                    key={k}
                    style={{
                      position: 'absolute',
                      left: 470 + Math.cos(a) * v * q,
                      top: 470 + Math.sin(a) * v * q * 0.6,
                      width: 14,
                      height: 14,
                      borderRadius: 3,
                      background: k % 3 ? C.tongue : C.lime,
                      opacity: 1 - q,
                      transform: `rotate(${a * 90}deg)`,
                    }}
                  />
                );
              })}
          </div>
        </AbsoluteFill>

        {/* the frog: peeks in from the left, licks, gulps, leaves */}
        <div
          style={{
            position: 'absolute',
            left: -300 + markIn * 380 - markOut * 400,
            top: MOUTH.y - 250,
            transform: `scale(${1 + gulp * 0.12}, ${1 - gulp * 0.08}) rotate(${(1 - markIn) * -30 + 8}deg)`,
            zIndex: 4,
          }}
        >
          <EyesMark size={240} lid={t > 13.95 && t < 14.4 ? 12.5 : 16.2} lookX={0.9} lookY={0.2} id="how-frog" style={{ filter: 'drop-shadow(0 30px 40px rgba(28,37,15,0.3))' }} />
        </div>
        {tongueOn && (
          <svg width="1920" height="1080" style={{ position: 'absolute', inset: 0, zIndex: 3 }}>
            <path d={d} {...evolvePath(reach, d)} stroke={C.tongue} strokeWidth={34} strokeLinecap="round" fill="none" />
            <circle cx={tipPt.x} cy={tipPt.y} r={30} fill={C.tongue} />
            <circle cx={tipPt.x - 8} cy={tipPt.y - 10} r={9} fill="rgba(255,255,255,0.45)" />
          </svg>
        )}
      </AbsoluteFill>
      <Flash t={t} at={14.5} color={C.tongueSoft} dur={0.2} max={0.6} />
      <Flash t={t} at={12} color="#fff" dur={0.12} max={0.5} />
    </AbsoluteFill>
  );
}
