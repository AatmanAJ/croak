import React from 'react';
import { AbsoluteFill, Easing, interpolate, random, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { noise2D } from '@remotion/noise';
import { C, FONT, MONO } from './brand';

// ---------- time ----------

/** Absolute time in seconds for a scene that starts at `start` (frames inside a Sequence are local). */
export function useT(start = 0) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return start + frame / fps;
}

export const E = {
  outExpo: Easing.bezier(0.16, 1, 0.3, 1),
  outQuint: Easing.bezier(0.22, 1, 0.36, 1),
  inOut: Easing.bezier(0.65, 0, 0.35, 1),
  inExpo: Easing.bezier(0.7, 0, 0.84, 0),
  outBack: Easing.bezier(0.34, 1.56, 0.64, 1),
  linear: (x) => x,
};

/** Tween a value between two times, clamped. */
export function tw(t, t0, t1, from, to, easing = E.outExpo) {
  return interpolate(t, [t0, t1], [from, to], { easing, extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
}

/** Spring progress (0 before t0) at 60fps. */
export function sp(t, t0, config = {}, fps = 60) {
  if (t < t0) return 0;
  return spring({ frame: (t - t0) * fps, fps, config: { damping: 14, stiffness: 160, mass: 0.9, ...config } });
}

/** 1 for a decaying window after t0 (for shakes / flashes). */
export function pulse(t, t0, dur = 0.3) {
  if (t < t0 || t > t0 + dur) return 0;
  return 1 - (t - t0) / dur;
}

/** Shake offset (px) that decays after each hit time. */
export function shake(t, hits, amp = 18, dur = 0.35, seed = 's') {
  let a = 0;
  for (const h of hits) a = Math.max(a, pulse(t, h, dur) ** 2);
  if (!a) return { x: 0, y: 0, r: 0 };
  return {
    x: noise2D(seed + 'x', t * 30, 0) * amp * a,
    y: noise2D(seed + 'y', 0, t * 30) * amp * a,
    r: noise2D(seed + 'r', t * 20, 1) * amp * 0.06 * a,
  };
}

export const rnd = (seed) => random(seed);

// ---------- global looks ----------

export function Grain({ opacity = 0.07 }) {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill style={{ pointerEvents: 'none', mixBlendMode: 'overlay', opacity }}>
      <svg width="100%" height="100%">
        <filter id={`g${frame % 8}`}>
          <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" seed={frame % 8} stitchTiles="stitch" />
          <feColorMatrix type="saturate" values="0" />
        </filter>
        <rect width="100%" height="100%" filter={`url(#g${frame % 8})`} />
      </svg>
    </AbsoluteFill>
  );
}

export function Vignette({ strength = 0.45, color = '0,0,0' }) {
  return (
    <AbsoluteFill
      style={{
        pointerEvents: 'none',
        background: `radial-gradient(ellipse 75% 70% at 50% 50%, rgba(${color},0) 55%, rgba(${color},${strength}) 100%)`,
      }}
    />
  );
}

export function Flash({ t, at, color = '#fff', dur = 0.25, max = 1 }) {
  const o = pulse(t, at, dur) ** 1.6 * max;
  if (!o) return null;
  return <AbsoluteFill style={{ background: color, opacity: o, pointerEvents: 'none' }} />;
}

/** Expanding ring from a point. */
export function Shockwave({ t, at, x = 960, y = 540, color = C.lime, dur = 0.8, max = 1400, width = 40 }) {
  if (t < at || t > at + dur) return null;
  const p = E.outExpo((t - at) / dur);
  const r = p * max;
  return (
    <AbsoluteFill style={{ pointerEvents: 'none' }}>
      <div
        style={{
          position: 'absolute',
          left: x - r,
          top: y - r,
          width: r * 2,
          height: r * 2,
          borderRadius: '50%',
          border: `${Math.max(1, width * (1 - p))}px solid ${color}`,
          opacity: 1 - p,
        }}
      />
    </AbsoluteFill>
  );
}

/** Perspective grid floor, scrolling toward camera. */
export function GridFloor({ t, color = 'rgba(218,243,107,0.18)', speed = 120, tilt = 68, top = 52 }) {
  const off = (t * speed) % 80;
  return (
    <AbsoluteFill style={{ perspective: 900, overflow: 'hidden', pointerEvents: 'none' }}>
      <div
        style={{
          position: 'absolute',
          left: '-50%',
          width: '200%',
          top: `${top}%`,
          height: '140%',
          transform: `rotateX(${tilt}deg)`,
          transformOrigin: 'top center',
          backgroundImage: `linear-gradient(${color} 2px, transparent 2px), linear-gradient(90deg, ${color} 2px, transparent 2px)`,
          backgroundSize: '80px 80px',
          backgroundPosition: `0 ${off}px`,
          maskImage: 'linear-gradient(to bottom, transparent, black 30%, black 60%, transparent)',
          WebkitMaskImage: 'linear-gradient(to bottom, transparent, black 20%, black 70%, transparent)',
        }}
      />
    </AbsoluteFill>
  );
}

/** Flat grid like the website hero. */
export function FlatGrid({ color = 'rgba(85,99,44,0.12)', size = 64, offset = 0 }) {
  return (
    <AbsoluteFill
      style={{
        pointerEvents: 'none',
        backgroundImage: `linear-gradient(${color} 1px, transparent 1px), linear-gradient(90deg, ${color} 1px, transparent 1px)`,
        backgroundSize: `${size}px ${size}px`,
        backgroundPosition: `${offset}px ${offset}px`,
      }}
    />
  );
}

// ---------- brand pieces ----------

/**
 * The eyes mark. `lid` is where the upper lid sits in mark units: 16.2 is the brand's
 * half-lidded "watching" look, 22 is shut, 12 is wide awake. `look` moves the pupils (-1..1).
 */
export function EyesMark({ size = 200, tile = C.olive, eye = C.lime, radius = 9, lid = 16.2, lookX = 0, lookY = 0, id = 'eyes', style }) {
  const eyes = [11, 21];
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" style={{ display: 'block', overflow: 'visible', ...style }}>
      <defs>
        {eyes.map((cx, i) => (
          <clipPath key={cx} id={`${id}-c${i}`}>
            <circle cx={cx} cy={17} r={5} />
          </clipPath>
        ))}
      </defs>
      <rect width="32" height="32" rx={radius} fill={tile} />
      {eyes.map((cx, i) => (
        <g key={cx} clipPath={`url(#${id}-c${i})`}>
          <rect x={cx - 6} y={lid} width="12" height={24 - lid} fill={eye} />
          {lid < 21.6 && <circle cx={cx - 1.3 + lookX * 1.9} cy={18.5 + lookY * 1.2} r="1.95" fill={tile} />}
        </g>
      ))}
    </svg>
  );
}

export function Wordmark({ size = 120, color = C.ink, style }) {
  return (
    <span style={{ fontFamily: FONT, fontWeight: 600, fontSize: size, letterSpacing: '-0.06em', color, lineHeight: 1, ...style }}>croak</span>
  );
}

/** Words that rise out of a mask one by one. */
export function Rise({ t, at, text, stagger = 0.06, dur = 0.55, style, wordStyle, highlight = {}, y = 1.35 }) {
  const words = text.split(' ');
  return (
    <span style={{ display: 'inline-flex', flexWrap: 'wrap', columnGap: '0.24em', ...style }}>
      {words.map((w, i) => {
        const p = tw(t, at + i * stagger, at + i * stagger + dur, 0, 1, E.outExpo);
        const hl = highlight[w];
        return (
          <span key={i} style={{ display: 'inline-block', overflow: 'hidden', paddingBottom: '0.08em', marginBottom: '-0.08em' }}>
            <span
              style={{
                display: 'inline-block',
                transform: `translateY(${(1 - p) * y * 100}%) rotate(${(1 - p) * 6}deg)`,
                transformOrigin: 'left bottom',
                ...(hl || {}),
                ...wordStyle,
              }}
            >
              {w}
            </span>
          </span>
        );
      })}
    </span>
  );
}

/** Characters dropping in with a spring, one by one. */
export function Drop({ t, at, text, stagger = 0.025, style, charStyle, from = -1.2 }) {
  return (
    <span style={{ display: 'inline-flex', whiteSpace: 'pre', ...style }}>
      {[...text].map((ch, i) => {
        const p = sp(t, at + i * stagger, { damping: 11, stiffness: 220 });
        return (
          <span key={i} style={{ display: 'inline-block', transform: `translateY(${(1 - p) * from * 100}%) scale(${0.6 + p * 0.4})`, opacity: Math.min(1, p * 3), ...charStyle }}>
            {ch}
          </span>
        );
      })}
    </span>
  );
}

/** Text typed out over a time window, with a blinking caret. */
export function Typed({ t, at, end, text, caret = true, caretColor = C.ink, style }) {
  const n = Math.round(tw(t, at, end, 0, text.length, E.linear));
  const on = caret && Math.floor(t * 2.4) % 2 === 0;
  return (
    <span style={{ whiteSpace: 'pre', ...style }}>
      {text.slice(0, n)}
      {caret && <span style={{ display: 'inline-block', width: '0.08em', height: '1em', marginLeft: '0.04em', verticalAlign: '-0.12em', background: caretColor, opacity: on ? 1 : 0 }} />}
    </span>
  );
}

export function Pill({ children, bg = C.lime, color = C.ink, style }) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 10,
        padding: '10px 20px',
        borderRadius: 999,
        background: bg,
        color,
        fontFamily: FONT,
        fontWeight: 500,
        fontSize: 26,
        letterSpacing: '-0.02em',
        whiteSpace: 'nowrap',
        ...style,
      }}
    >
      {children}
    </span>
  );
}

export function Label({ children, color = C.limeInk, dot = C.lime, size = 24, style }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 12, fontFamily: FONT, fontWeight: 500, fontSize: size, color, letterSpacing: '-0.01em', ...style }}>
      <span style={{ width: size * 0.42, height: size * 0.42, borderRadius: 99, background: dot }} />
      {children}
    </span>
  );
}

const AVATARS = [C.tongueSoft, '#C9DDF2', '#D9D2F5', '#F6E2B8', '#CFEFD8', '#F4D3E4'];
export const avatarColor = (i) => AVATARS[i % AVATARS.length];

/** A chat message in the brand's Discord-like style. */
export function Message({ name, text, link, time = 'Today at 19:20', avatar = 0, dark = false, scale = 1, children, style, nameColor }) {
  const fg = dark ? '#EDEFE6' : C.ink;
  const sub = dark ? 'rgba(237,239,230,0.45)' : 'rgba(28,37,15,0.45)';
  return (
    <div style={{ display: 'flex', gap: 22 * scale, alignItems: 'flex-start', fontFamily: FONT, ...style }}>
      <div style={{ width: 64 * scale, height: 64 * scale, borderRadius: 99, background: avatarColor(avatar), flexShrink: 0 }} />
      <div style={{ minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 14 * scale }}>
          <span style={{ fontWeight: 600, fontSize: 27 * scale, color: nameColor || fg, letterSpacing: '-0.02em' }}>{name}</span>
          <span style={{ fontSize: 20 * scale, color: sub }}>{time}</span>
        </div>
        <div style={{ fontSize: 30 * scale, color: fg, letterSpacing: '-0.02em', lineHeight: 1.3, marginTop: 4 * scale }}>
          {text}
          {link && (
            <>
              {' '}
              <span style={{ color: dark ? '#8FB4FF' : C.link }}>{link}</span>
            </>
          )}
        </div>
        {children}
      </div>
    </div>
  );
}

export function Cursor({ x, y, press = 0, color = C.ink }) {
  const s = 1 - press * 0.18;
  return (
    <svg
      width="54"
      height="54"
      viewBox="0 0 24 24"
      style={{ position: 'absolute', left: x, top: y, transform: `scale(${s})`, transformOrigin: '4px 3px', filter: 'drop-shadow(0 6px 10px rgba(0,0,0,0.25))', zIndex: 50 }}
    >
      <path d="M4 3l15 7.5-6.2 1.6L10 18.5z" fill={color} stroke="#fff" strokeWidth="1.4" strokeLinejoin="round" />
    </svg>
  );
}

/** RGB split text shadow for glitchy type. */
export const rgb = (a) => (a ? `${a}px 0 rgba(255,92,138,0.85), ${-a}px 0 rgba(90,200,255,0.75)` : 'none');

export const display = (size, extra = {}) => ({
  fontFamily: FONT,
  fontWeight: 500,
  fontSize: size,
  letterSpacing: '-0.055em',
  lineHeight: 0.92,
  ...extra,
});

export const mono = (size, extra = {}) => ({ fontFamily: MONO, fontSize: size, letterSpacing: '-0.01em', ...extra });
