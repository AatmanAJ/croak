import React from 'react';
import { AbsoluteFill } from 'remotion';
import { noise2D } from '@remotion/noise';
import { C, FONT, MONO } from '../brand';
import { E, EyesMark, FlatGrid, Flash, Shockwave, display, mono, pulse, shake, sp, tw, useT } from '../lib';

// 32 to 36 s: the end card. A fly buzzes about, the frog croaks (34.0) and eats it (34.45).

const MARK = { x: 960, y: 300, size: 260 };
const FLY_EATEN = 34.6;

function flyPos(t) {
  // wanders around the mark, then hovers just right of it before the lick
  const wander = {
    x: 1290 + noise2D('fx', t * 0.9, 0) * 260,
    y: 250 + noise2D('fy', 0, t * 0.9) * 120,
  };
  const hover = { x: 1180 + Math.sin(t * 40) * 3, y: 230 + Math.cos(t * 33) * 3 };
  const k = tw(t, 33.7, 34.05, 0, 1, E.inOut);
  return { x: wander.x + (hover.x - wander.x) * k, y: wander.y + (hover.y - wander.y) * k };
}

function Fly({ t }) {
  if (t < 32.5 || t >= FLY_EATEN) return null;
  const caught = t >= 34.5;
  const { x, y } = caught ? { x: 1180 + (MARK.x - 1180) * tw(t, 34.5, FLY_EATEN, 0, 1, E.inExpo), y: 230 + (MARK.y + 40 - 230) * tw(t, 34.5, FLY_EATEN, 0, 1, E.inExpo) } : flyPos(t);
  const flap = Math.sin(t * 160) * 0.5 + 0.5;
  const appear = tw(t, 32.5, 32.7, 0, 1);
  return (
    <div style={{ position: 'absolute', left: x - 30, top: y - 30, width: 40, height: 40, opacity: appear, transform: 'scale(1.6)' }}>
      <div style={{ position: 'absolute', left: 4, top: 2 + flap * 4, width: 18, height: 12, borderRadius: '50%', background: 'rgba(255,255,255,0.75)', transform: 'rotate(-25deg)', filter: 'blur(0.6px)' }} />
      <div style={{ position: 'absolute', left: 18, top: 2 + flap * 4, width: 18, height: 12, borderRadius: '50%', background: 'rgba(255,255,255,0.75)', transform: 'rotate(25deg)', filter: 'blur(0.6px)' }} />
      <div style={{ position: 'absolute', left: 12, top: 12, width: 16, height: 18, borderRadius: '50%', background: C.ink }} />
    </div>
  );
}

export function End() {
  const t = useT(32);
  const iris = tw(t, 32, 32.18, 0, 1, E.outQuint);
  const sh = shake(t, [32, 34.0], 22, 0.4, 'end');
  const markIn = sp(t, 32.02, { damping: 10, stiffness: 160 });
  // the croak: two throaty pulses
  const croak = pulse(t, 34.0, 0.18) + pulse(t, 34.2, 0.2) * 0.8;
  // eyes: watching, track the fly, wide for the lick, happy squint after
  const fly = flyPos(t);
  const look = { x: Math.max(-1, Math.min(1, (fly.x - MARK.x) / 300)), y: Math.max(-1, Math.min(1, (fly.y - MARK.y) / 200)) };
  let lid = 16.2;
  if (t > 34.35 && t < 34.62) lid = 12;
  if (t >= 34.7) lid = tw(t, 34.7, 34.85, 16.2, 19.5, E.inOut);
  if (t >= 35.35) lid = tw(t, 35.35, 35.5, 19.5, 16.2, E.inOut);

  // tongue to the fly
  const tongueOut = tw(t, 34.45, 34.52, 0, 1, E.outQuint);
  const tongueBack = tw(t, 34.5, FLY_EATEN, 0, 1, E.inExpo);
  const reach = t < 34.5 ? tongueOut : 1 - tongueBack;
  const mouth = { x: MARK.x + 20, y: MARK.y + 70 };
  const target = { x: 1180, y: 230 };
  const tip = { x: mouth.x + (target.x - mouth.x) * reach, y: mouth.y + (target.y - mouth.y) * reach };
  const push = tw(t, 32, 36, 1.0, 1.06, E.linear);

  return (
    <AbsoluteFill style={{ background: '#000', overflow: 'hidden' }}>
      <AbsoluteFill style={{ clipPath: `circle(${iris * 120}% at 50% 40%)`, background: C.lime }}>
        <AbsoluteFill style={{ background: 'radial-gradient(circle at 50% 30%, rgba(255,255,255,0.7), rgba(255,255,255,0) 55%)' }} />
        <FlatGrid color="rgba(85,99,44,0.12)" size={80} offset={(t - 32) * 14} />
        <AbsoluteFill style={{ transform: `translate(${sh.x}px, ${sh.y}px) scale(${push})` }}>
          {/* mark */}
          <div
            style={{
              position: 'absolute',
              left: MARK.x - MARK.size / 2,
              top: MARK.y - MARK.size / 2,
              transform: `scale(${markIn * (1 + croak * 0.1)}, ${markIn * (1 - croak * 0.07)}) rotate(${(1 - markIn) * 40}deg)`,
              transformOrigin: '50% 100%',
              zIndex: 3,
            }}
          >
            <EyesMark size={MARK.size} lid={lid} lookX={look.x} lookY={look.y} id="end" style={{ filter: 'drop-shadow(0 40px 50px rgba(34,47,14,0.3))' }} />
            {/* throat pouch on the croak */}
            {croak > 0.02 && <div style={{ position: 'absolute', left: '50%', bottom: -30 * croak, width: 120 * croak, height: 70 * croak, marginLeft: -60 * croak, borderRadius: '50%', background: C.limeDeep, border: `6px solid ${C.olive}`, zIndex: -1 }} />}
          </div>
          {reach > 0.01 && (
            <svg width="1920" height="1080" style={{ position: 'absolute', inset: 0, zIndex: 2 }}>
              <line x1={mouth.x} y1={mouth.y} x2={tip.x} y2={tip.y} stroke={C.tongue} strokeWidth={22} strokeLinecap="round" />
              <circle cx={tip.x} cy={tip.y} r={20} fill={C.tongue} />
            </svg>
          )}
          <Fly t={t} />

          {/* headline */}
          <div style={{ position: 'absolute', left: 0, right: 0, top: 500, display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 40 }}>
            {['Spam', 'croaks', 'here.'].map((w, i) => {
              const p = sp(t, 32.22 + i * 0.14, { damping: 11, stiffness: 200 });
              const box = w === 'croaks';
              return (
                <div key={w} style={{ position: 'relative', transform: `translateY(${(1 - p) * 140}px) scale(${0.7 + p * 0.3})`, opacity: Math.min(1, p * 2) }}>
                  {box && <div style={{ position: 'absolute', inset: '-4px -30px -22px', background: C.olive, borderRadius: 36, transform: `scaleX(${tw(t, 32.4, 32.7, 0, 1, E.outQuint)})`, transformOrigin: 'left' }} />}
                  <span style={{ ...display(200, { color: box ? C.lime : C.ink, fontWeight: 500 }), position: 'relative' }}>{w}</span>
                </div>
              );
            })}
          </div>

          {/* CTA */}
          <div style={{ position: 'absolute', left: 0, right: 0, top: 790, display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 34, opacity: tw(t, 33.0, 33.2, 0, 1), transform: `translateY(${(1 - sp(t, 33.0, { damping: 14 })) * 60}px)` }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 22, padding: '18px 18px 18px 40px', borderRadius: 99, background: C.olive, boxShadow: `0 20px 50px rgba(34,47,14,0.35), 0 0 0 ${pulse(t, 33.6, 0.6) * 18}px rgba(34,47,14,${pulse(t, 33.6, 0.6) * 0.25})` }}>
              <span style={{ fontFamily: FONT, fontWeight: 500, fontSize: 40, color: C.limeSoft, letterSpacing: '-0.02em' }}>Add Croak to Discord</span>
              <span style={{ width: 70, height: 70, borderRadius: 99, background: C.lime, display: 'grid', placeItems: 'center' }}>
                <svg width="34" height="34" viewBox="0 0 24 24">
                  <path d="M4 12h15M13 6l6 6-6 6" stroke={C.olive} strokeWidth="2.8" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span>
            </div>
            <span style={mono(40, { color: C.ink, fontWeight: 500 })}>croakbot.base44.app</span>
          </div>
          <div style={{ position: 'absolute', left: 0, right: 0, bottom: 56, textAlign: 'center', fontFamily: FONT, fontSize: 26, color: C.limeInk, opacity: tw(t, 33.4, 33.8, 0, 0.9) }}>
            Free during early access · Open source · Set up in one command
          </div>
        </AbsoluteFill>
        <Shockwave t={t} at={32.02} x={960} y={430} color={C.olive} width={60} max={1500} dur={0.9} />
        <Shockwave t={t} at={34.0} x={MARK.x} y={MARK.y + 60} color={C.olive} width={14} max={260} dur={0.5} />
        <Shockwave t={t} at={34.2} x={MARK.x} y={MARK.y + 60} color={C.olive} width={10} max={220} dur={0.5} />
      </AbsoluteFill>
      <Flash t={t} at={32} color="#fff" dur={0.3} max={0.9} />
    </AbsoluteFill>
  );
}
