import React from 'react';
import { AbsoluteFill, random } from 'remotion';
import { C, FONT, MONO } from '../brand';
import { E, EyesMark, Flash, Pill, display, mono, pulse, shake, sp, tw, useT } from '../lib';

// 16 to 22 s: one cut per second. QR scams, look-alikes, scam images, spam blasts, raids, all handled.

function Cross({ t, at, size = 420 }) {
  const a = tw(t, at, at + 0.12, 0, 1, E.outQuint);
  const b = tw(t, at + 0.08, at + 0.2, 0, 1, E.outQuint);
  const bar = (p, r) => (
    <div style={{ position: 'absolute', left: '50%', top: '50%', width: size * 1.25 * p, height: 34, marginTop: -17, borderRadius: 99, background: C.tongue, transform: `translateX(-50%) rotate(${r}deg)`, boxShadow: '0 10px 30px rgba(255,92,138,0.5)' }} />
  );
  return (
    <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
      {bar(a, 45)}
      {bar(b, -45)}
    </div>
  );
}

function QR({ t }) {
  const cells = [];
  let s = 7;
  for (let y = 0; y < 21; y++) {
    for (let x = 0; x < 21; x++) {
      s = (s * 9301 + 49297) % 233280;
      const finder = (x < 7 && y < 7) || (x > 13 && y < 7) || (x < 7 && y > 13);
      if (finder) {
        const fx = x > 13 ? x - 14 : x;
        const fy = y > 13 ? y - 14 : y;
        if (fx === 0 || fx === 6 || fy === 0 || fy === 6 || (fx > 1 && fx < 5 && fy > 1 && fy < 5)) cells.push([x, y]);
      } else if (s / 233280 > 0.52) cells.push([x, y]);
    }
  }
  const scan = tw(t, 16.35, 16.7, 0, 1, E.inOut);
  return (
    <div style={{ position: 'relative', width: 460, height: 460, padding: 30, borderRadius: 40, background: '#fff', boxShadow: '0 40px 90px rgba(28,37,15,0.18)' }}>
      <svg viewBox="0 0 21 21" width="400" height="400" shapeRendering="crispEdges">
        {cells.map(([x, y]) => {
          const d = random(`qr${x}-${y}`) * 0.3;
          const p = sp(t, 16.02 + d, { damping: 14, stiffness: 260 });
          return <rect key={`${x}-${y}`} x={x + 0.5 - p / 2} y={y + 0.5 - p / 2} width={p} height={p} fill={C.ink} />;
        })}
      </svg>
      {t > 16.35 && t < 16.75 && <div style={{ position: 'absolute', left: 20, right: 20, top: 30 + scan * 400, height: 8, borderRadius: 9, background: C.tongue, boxShadow: '0 0 30px 8px rgba(255,92,138,0.6)' }} />}
      {t >= 16.7 && <Cross t={t} at={16.7} size={460} />}
    </div>
  );
}

const LOOKS = [
  ['steamcommun', 'l', 'ty.com'],
  ['rob', '1', 'ox.com'],
  ['disc', 'о', 'rd.gift'],
];

function Lookalike({ t }) {
  const hl = tw(t, 17.22, 17.36, 0, 1, E.outQuint);
  const lens = sp(t, 17.38, { damping: 12, stiffness: 200 });
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <div style={{ ...mono(200, { fontWeight: 500, color: C.ink, letterSpacing: '-0.04em' }), position: 'relative' }}>
        d
        <span style={{ position: 'relative', display: 'inline-block' }}>
          <span style={{ position: 'absolute', inset: '8% -8%', borderRadius: 18, background: C.tongueSoft, transform: `scaleY(${hl})`, zIndex: -1 }} />
          <span style={{ color: hl > 0.5 ? C.tongueInk : C.ink }}>l</span>
          {lens > 0.01 && (
            <span
              style={{
                position: 'absolute',
                left: '50%',
                top: -250,
                width: 220,
                height: 220,
                marginLeft: -110,
                borderRadius: 999,
                background: '#fff',
                border: `8px solid ${C.ink}`,
                transform: `scale(${lens})`,
                display: 'grid',
                placeItems: 'center',
                boxShadow: '0 30px 60px rgba(28,37,15,0.2)',
                ...mono(64, { fontWeight: 700, color: C.ink }),
              }}
            >
              <span>
                <span style={{ color: C.tongueInk }}>l</span>
                <span style={{ color: 'rgba(28,37,15,0.3)', margin: '0 8px' }}>≠</span>i
              </span>
            </span>
          )}
        </span>
        scord.com
      </div>
      <div style={{ display: 'flex', gap: 18, marginTop: 36 }}>
        {LOOKS.map(([a, bad, c], i) => {
          const p = sp(t, 17.3 + i * 0.08, { damping: 14 });
          return (
            <span key={a} style={{ transform: `translateY(${(1 - p) * 40}px)`, opacity: p, padding: '14px 24px', borderRadius: 18, background: '#F1F2EC', ...mono(30, { color: C.ink }) }}>
              {a}
              <span style={{ color: C.tongueInk, background: C.tongueSoft, borderRadius: 6, padding: '0 3px' }}>{bad}</span>
              {c}
            </span>
          );
        })}
      </div>
    </div>
  );
}

function ImageMatch({ t }) {
  const grid = Array.from({ length: 6 * 4 }, (_, i) => i);
  const scan = tw(t, 18.42, 18.78, 0, grid.length, E.linear);
  const match = sp(t, 18.8, { damping: 11, stiffness: 240 });
  return (
    <div style={{ position: 'relative', transform: 'scale(1.3)' }}>
      <div style={{ width: 640, height: 380, borderRadius: 34, background: 'linear-gradient(135deg,#1A1A2E,#3A1D5C 55%,#B8892B)', padding: 48, display: 'flex', flexDirection: 'column', justifyContent: 'center', boxShadow: '0 50px 100px rgba(28,37,15,0.25)', position: 'relative', overflow: 'hidden' }}>
        <div style={{ fontFamily: FONT, fontWeight: 600, fontSize: 110, color: '#FFD86B', letterSpacing: '-0.05em', lineHeight: 0.9 }}>$5,000</div>
        <div style={{ fontFamily: FONT, fontWeight: 600, fontSize: 54, color: '#fff' }}>GIVEAWAY 🎁</div>
        <div style={{ ...mono(22, { color: 'rgba(255,255,255,0.6)', marginTop: 10 }) }}>MRBEAST_GIVEAWAY.png</div>
        <div style={{ position: 'absolute', inset: 0, display: 'grid', gridTemplateColumns: 'repeat(6,1fr)', gridTemplateRows: 'repeat(4,1fr)' }}>
          {grid.map((i) => (
            <div key={i} style={{ border: '1px solid rgba(218,243,107,0.35)', background: i < scan ? `rgba(218,243,107,${0.15 + random(`h${i}`) * 0.35})` : 'transparent' }} />
          ))}
        </div>
      </div>
      <div style={{ position: 'absolute', right: -60, bottom: -40, transform: `scale(${match}) rotate(${(1 - match) * 20 - 4}deg)` }}>
        <Pill bg={C.tongue} color="#fff" style={{ fontFamily: MONO, fontWeight: 700, fontSize: 32, padding: '16px 28px', boxShadow: '0 20px 40px rgba(255,92,138,0.45)' }}>
          98% match · known scam
        </Pill>
      </div>
    </div>
  );
}

function Blast({ t }) {
  const chans = ['#general', '#memes', '#trading'];
  return (
    <div style={{ width: 1120, display: 'flex', flexDirection: 'column', gap: 18 }}>
      {chans.map((ch, i) => {
        const p = sp(t, 19.04 + i * 0.1, { damping: 14, stiffness: 220 });
        const strike = tw(t, 19.5 + i * 0.04, 19.62 + i * 0.04, 0, 1, E.outQuint);
        return (
          <div key={ch} style={{ display: 'flex', alignItems: 'center', gap: 30, padding: '26px 34px', borderRadius: 24, background: 'rgba(255,255,255,0.06)', border: '1.5px solid rgba(255,255,255,0.1)', transform: `translateX(${(1 - p) * 300}px)`, opacity: p }}>
            <span style={mono(30, { color: C.oliveMist, width: 170 })}>{ch}</span>
            <span style={{ position: 'relative', fontFamily: FONT, fontSize: 40, color: C.limeSoft, letterSpacing: '-0.02em', opacity: 1 - strike * 0.5 }}>
              JOIN NOW 🚀 crypto signals, 1000% gains, DM me
              <span style={{ position: 'absolute', left: -10, right: -10, top: '52%', height: 8, borderRadius: 9, background: C.tongue, transform: `scaleX(${strike})`, transformOrigin: 'left' }} />
            </span>
          </div>
        );
      })}
      <div style={{ marginTop: 14, opacity: tw(t, 19.6, 19.75, 0, 1), transform: `translateY(${(1 - tw(t, 19.6, 19.8, 0, 1)) * 20}px)` }}>
        <Pill bg={C.lime} color={C.ink} style={{ fontSize: 30 }}>
          Same post, 3 channels, 40 s · every copy removed
        </Pill>
      </div>
    </div>
  );
}

function Raid({ t }) {
  const locked = t >= 20.5;
  const knob = sp(t, 20.5, { damping: 13, stiffness: 300 });
  const freeze = locked ? 20.5 : t;
  return (
    <div style={{ position: 'relative', width: 1400, height: 640 }}>
      {Array.from({ length: 70 }, (_, i) => {
        const at = 20 + random(`ra${i}`) * 0.5;
        if (t < at) return null;
        const v = 900 + random(`rv${i}`) * 900;
        const k = Math.min(freeze, t) - at;
        const x = 1500 - k * v;
        const y = 40 + random(`ry${i}`) * 560;
        const size = 40 + random(`rs${i}`) * 34;
        return (
          <div
            key={i}
            style={{
              position: 'absolute',
              left: Math.max(560 + random(`rx${i}`) * 820, x),
              top: y,
              width: size,
              height: size,
              borderRadius: 99,
              background: locked ? '#5B6152' : ['#FFE3EB', '#C9DDF2', '#D9D2F5', '#F6E2B8', '#CFEFD8'][i % 5],
              opacity: locked ? 0.45 : 0.95,
              transition: 'none',
            }}
          />
        );
      })}
      <div style={{ position: 'absolute', left: 0, top: 150, width: 500, padding: 40, borderRadius: 36, background: '#fff', boxShadow: '0 40px 90px rgba(0,0,0,0.35)' }}>
        <div style={{ fontFamily: FONT, fontWeight: 600, fontSize: 40, color: C.ink, letterSpacing: '-0.03em' }}>Lockdown</div>
        <div style={{ ...mono(24, { color: C.body, marginTop: 6 }) }}>{locked ? 'slowmode 30s · invites paused' : '+47 joins in 30 s'}</div>
        <div style={{ marginTop: 30, width: 200, height: 100, borderRadius: 99, background: locked ? C.olive : '#E3E5DC', position: 'relative' }}>
          <div style={{ position: 'absolute', top: 10, left: 10 + knob * 100, width: 80, height: 80, borderRadius: 99, background: locked ? C.lime : '#fff', boxShadow: '0 6px 14px rgba(0,0,0,0.2)' }} />
        </div>
      </div>
    </div>
  );
}

const TILES = [
  { bg: C.sky, label: 'QR scams' },
  { bg: '#fff', label: 'Look-alikes' },
  { bg: C.lav, label: 'Scam images' },
  { bg: C.olive, label: 'Spam blasts', dark: true },
  { bg: '#1C250F', label: 'Raids', dark: true },
];

function Handled({ t }) {
  return (
    <div style={{ display: 'flex', gap: 26 }}>
      {TILES.map((tl, i) => {
        const p = sp(t, 21.02 + i * 0.05, { damping: 13, stiffness: 210 });
        const ok = sp(t, 21.28 + i * 0.05, { damping: 9, stiffness: 300 });
        return (
          <div key={tl.label} style={{ position: 'relative', width: 300, height: 360, borderRadius: 34, background: tl.bg, padding: 30, display: 'flex', alignItems: 'flex-end', transform: `translateY(${(1 - p) * 500}px) rotate(${(1 - p) * (i - 2) * 10}deg)`, boxShadow: '0 30px 70px rgba(34,47,14,0.2)' }}>
            <span style={{ fontFamily: FONT, fontWeight: 500, fontSize: 40, letterSpacing: '-0.04em', color: tl.dark ? C.limeSoft : C.ink, lineHeight: 1 }}>{tl.label}</span>
            <div style={{ position: 'absolute', top: 24, right: 24, width: 74, height: 74, borderRadius: 99, background: C.olive, display: 'grid', placeItems: 'center', transform: `scale(${ok})` }}>
              <svg width="40" height="40" viewBox="0 0 24 24">
                <path d="M5 12.5l4.2 4.2L19 7" stroke={C.lime} strokeWidth="3.2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
          </div>
        );
      })}
    </div>
  );
}

const CUTS = [
  { at: 16, bg: C.sky, label: 'QR login scams', ink: C.ink, body: QR },
  { at: 17, bg: '#FFFFFF', label: 'Look-alike domains', ink: C.ink, body: Lookalike },
  { at: 18, bg: C.lav, label: 'Scam images', ink: C.ink, body: ImageMatch },
  { at: 19, bg: C.olive, label: 'Hacked-account blasts', ink: C.lime, body: Blast },
  { at: 20, bg: '#10160A', label: 'Raids', ink: C.lime, body: Raid },
  { at: 21, bg: C.lime, label: 'All handled.', ink: C.ink, body: Handled },
];

export function Montage() {
  const t = useT(16);
  const idx = Math.min(CUTS.length - 1, Math.floor(t - 16));
  const cut = CUTS[idx];
  const k = t - cut.at;
  const Body = cut.body;
  const sh = shake(t, [16, 17, 18, 19, 20, 21, 19.5, 20.5], 16, 0.25, 'mont');
  const punch = 1 + (1 - E.outExpo(Math.min(1, k / 0.3))) * 0.14;
  const whip = idx < CUTS.length - 1 ? tw(t, cut.at + 0.9, cut.at + 1, 0, 1, E.inExpo) : 0;
  // the last cut stutters and zooms through into the next scene
  const stutter = idx === 5 && t > 21.5 ? Math.floor((t - 21.5) * 16) % 2 : 0;
  const thru = idx === 5 ? tw(t, 21.62, 22, 1, 5, E.inExpo) : 1;

  return (
    <AbsoluteFill style={{ background: cut.bg, overflow: 'hidden' }}>
      <AbsoluteFill
        style={{
          transform: `translate(${sh.x - whip * 380}px, ${sh.y}px) scale(${punch * thru}) rotate(${(1 - E.outExpo(Math.min(1, k / 0.3))) * (idx % 2 ? 2 : -2)}deg)`,
          filter: whip > 0.05 || thru > 1.2 ? `blur(${whip * 18 + (thru - 1) * 4}px)` : 'none',
          opacity: stutter ? 0.75 : 1,
        }}
      >
        <div style={{ position: 'absolute', left: 110, top: 90, display: 'flex', alignItems: 'baseline', gap: 26 }}>
          <span style={mono(30, { color: cut.ink, opacity: 0.6 })}>{idx < 5 ? `0${idx + 1}/05` : ''}</span>
        </div>
        <div style={{ position: 'absolute', left: 110, top: 140, overflow: 'hidden', paddingBottom: 16 }}>
          <div style={{ ...display(idx === 5 ? 170 : 128, { color: cut.ink }), transform: `translateY(${(1 - tw(t, cut.at, cut.at + 0.28, 0, 1)) * 110}%)` }}>{cut.label}</div>
        </div>
        <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', paddingTop: idx === 5 ? 260 : idx === 1 ? 330 : 180 }}>
          <Body t={t} />
        </AbsoluteFill>
        {idx === 5 && (
          <div style={{ position: 'absolute', right: 110, top: 110, transform: `scale(${sp(t, 21.1, { damping: 10 })})` }}>
            <EyesMark size={150} id="handled" lookX={-0.8} />
          </div>
        )}
      </AbsoluteFill>
      {CUTS.map((c) => (
        <Flash key={c.at} t={t} at={c.at} color="#fff" dur={0.1} max={0.35} />
      ))}
    </AbsoluteFill>
  );
}
