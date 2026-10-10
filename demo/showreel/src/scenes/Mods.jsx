import React from 'react';
import { AbsoluteFill } from 'remotion';
import { C, FONT, MONO } from '../brand';
import { Cursor, E, EyesMark, FlatGrid, Label, Pill, Rise, Typed, avatarColor, display, mono, pulse, shake, sp, tw, useT } from '../lib';

// 22 to 28 s: mods stay in charge. A case card, then Cases / Appeals / Lockdowns on the beat.

const CARD = { x: 1010, y: 290, w: 800 };

function Btn({ children, tone = 'dark', hot = 0, style }) {
  const bg = tone === 'lime' ? C.lime : 'rgba(255,255,255,0.1)';
  const fg = tone === 'lime' ? C.ink : C.limeSoft;
  return (
    <span style={{ display: 'inline-flex', padding: '16px 28px', borderRadius: 99, background: bg, color: fg, fontFamily: FONT, fontWeight: 500, fontSize: 28, letterSpacing: '-0.02em', transform: `scale(${1 - hot * 0.08})`, boxShadow: hot ? `0 0 0 ${hot * 10}px rgba(218,243,107,0.35)` : 'none', ...style }}>
      {children}
    </span>
  );
}

function CaseCard({ t }) {
  const restored = t >= 24.5;
  const menu = t >= 22.82 && t < 24.3;
  const menuP = sp(t, 22.82, { damping: 16, stiffness: 300 });
  const pick = t >= 23.5;
  return (
    <div style={{ width: CARD.w, borderRadius: 40, background: restored ? '#fff' : C.olive, padding: 46, position: 'relative', boxShadow: '0 60px 120px rgba(28,37,15,0.35)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', ...mono(24, { color: restored ? C.body : C.oliveMist }) }}>
        <span>#mod-log · Croak</span>
        <span>Case #142</span>
      </div>
      <div style={{ ...display(62, { color: restored ? C.ink : C.lime, marginTop: 22 }) }}>{restored ? 'Restored: not spam' : 'Croaked: scam link'}</div>
      <div style={{ fontFamily: FONT, fontSize: 28, color: restored ? C.body : C.oliveMist, marginTop: 14, letterSpacing: '-0.01em' }}>
        {restored ? 'Message reposted · member un-timed-out' : 'Looks like a misspelling of discord · scam 0.99 · 190 ms'}
      </div>
      <div style={{ display: 'flex', gap: 16, marginTop: 34, flexWrap: 'wrap' }}>
        {restored ? (
          <Btn tone="lime">Undo</Btn>
        ) : (
          <>
            <Btn hot={pulse(t, 24.45, 0.2)}>Not spam</Btn>
            <Btn tone="lime" hot={pulse(t, 22.8, 0.2)}>
              More actions…
            </Btn>
            <Btn>Reply to appeal</Btn>
          </>
        )}
      </div>
      {menu && (
        <div style={{ position: 'absolute', left: 300, top: 330, width: 360, borderRadius: 26, background: '#fff', padding: 12, boxShadow: '0 30px 70px rgba(0,0,0,0.3)', transform: `scale(${0.85 + menuP * 0.15})`, opacity: menuP, transformOrigin: 'top left', zIndex: 5 }}>
          {['Timeout 1 hour', 'Ban', 'Watch member', 'Reply to appeal'].map((m, i) => (
            <div key={m} style={{ padding: '16px 20px', borderRadius: 16, background: pick && i === 3 ? C.lime : t > 23.1 && i === 3 ? '#F1F2EC' : 'transparent', fontFamily: FONT, fontSize: 28, color: C.ink, letterSpacing: '-0.02em' }}>
              {m}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Bubble({ who, text, mine, p, avatar }) {
  return (
    <div style={{ display: 'flex', gap: 18, alignItems: 'flex-end', flexDirection: mine ? 'row-reverse' : 'row', transform: `translateY(${(1 - p) * 30}px) scale(${0.8 + p * 0.2})`, opacity: p, transformOrigin: mine ? 'right bottom' : 'left bottom' }}>
      {mine ? <EyesMark size={56} id="appeal-me" tile={C.lime} eye={C.olive} /> : <div style={{ width: 56, height: 56, borderRadius: 99, background: avatarColor(avatar) }} />}
      <div style={{ maxWidth: 540, padding: '20px 26px', borderRadius: 28, background: mine ? C.lime : 'rgba(255,255,255,0.08)', color: mine ? C.ink : C.limeSoft, fontFamily: FONT, fontSize: 30, letterSpacing: '-0.02em', lineHeight: 1.3 }}>
        <div style={mono(18, { opacity: 0.6, marginBottom: 6 })}>{who}</div>
        {text}
      </div>
    </div>
  );
}

function AppealCard({ t }) {
  const reply = 'All good, unmuted. Turn on 2FA 👍';
  const typing = t >= 25.55 && t < 26.0;
  return (
    <div style={{ width: CARD.w, borderRadius: 40, background: C.olive, padding: 46, display: 'flex', flexDirection: 'column', gap: 24, boxShadow: '0 60px 120px rgba(28,37,15,0.35)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', ...mono(24, { color: C.oliveMist }) }}>
        <span>Appeal · Case #142</span>
        <span>DM</span>
      </div>
      <Bubble who="nitro_drops" text="that was my little brother, sorry!! changed my password" p={sp(t, 25.42, { damping: 14 })} avatar={0} />
      {t >= 26.0 ? (
        <Bubble mine who="mods (via Croak)" text={reply} p={sp(t, 26.0, { damping: 13, stiffness: 220 })} />
      ) : (
        <div style={{ alignSelf: 'flex-end', padding: '18px 26px', borderRadius: 26, background: 'rgba(255,255,255,0.08)', fontFamily: FONT, fontSize: 28, color: C.limeSoft, opacity: typing ? 1 : 0 }}>
          <Typed t={t} at={25.6} end={25.95} text={reply} caretColor={C.lime} />
        </div>
      )}
    </div>
  );
}

function LockCard({ t }) {
  const on = sp(t, 26.6, { damping: 12, stiffness: 300 });
  const chans = ['#general', '#memes', '#trading', '#clips'];
  return (
    <div style={{ width: CARD.w, borderRadius: 40, background: '#fff', padding: 46, boxShadow: '0 60px 120px rgba(28,37,15,0.25)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <div style={{ ...display(62, { color: C.ink }) }}>Lockdown</div>
          <div style={mono(24, { color: C.body, marginTop: 8 })}>{t >= 26.6 ? 'on · ends in 30 min' : 'off'}</div>
        </div>
        <div style={{ width: 220, height: 110, borderRadius: 99, background: t >= 26.6 ? C.olive : '#E3E5DC', position: 'relative' }}>
          <div style={{ position: 'absolute', top: 11, left: 11 + on * 110, width: 88, height: 88, borderRadius: 99, background: t >= 26.6 ? C.lime : '#fff', boxShadow: '0 6px 14px rgba(0,0,0,0.2)' }} />
        </div>
      </div>
      <div style={{ marginTop: 34, display: 'flex', flexDirection: 'column', gap: 14 }}>
        {chans.map((ch, i) => {
          const p = sp(t, 26.68 + i * 0.07, { damping: 13, stiffness: 260 });
          return (
            <div key={ch} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 24px', borderRadius: 20, background: '#F1F2EC' }}>
              <span style={mono(28, { color: C.ink })}>{ch}</span>
              <span style={{ transform: `scale(${p})`, display: 'inline-block' }}>
                <Pill bg={C.olive} color={C.lime} style={{ fontSize: 22, padding: '8px 16px', fontFamily: MONO }}>
                  slowmode 30s
                </Pill>
              </span>
            </div>
          );
        })}
        <div style={{ opacity: tw(t, 27.0, 27.2, 0, 1), marginTop: 6 }}>
          <Label size={26}>Invites paused until it's over</Label>
        </div>
      </div>
    </div>
  );
}

const WORDS = [
  { at: 24.5, word: 'Cases.' },
  { at: 25.5, word: 'Appeals.' },
  { at: 26.5, word: 'Lockdowns.' },
];

export function Mods() {
  const t = useT(22);
  const enter = sp(t, 22, { damping: 16, stiffness: 120 });
  const sh = shake(t, [24.5, 25.5, 26.5], 14, 0.25, 'mods');
  const phase = t < 25.4 ? 0 : t < 26.4 ? 1 : 2;
  const flip = phase === 0 ? 0 : tw(t, phase === 1 ? 25.4 : 26.4, (phase === 1 ? 25.4 : 26.4) + 0.22, 1, 0, E.outQuint);

  // the cursor's path: in from the corner, to More actions, to Reply to appeal, to Not spam, then away
  const cx = tw(t, 22.25, 22.75, 1900, 1343, E.inOut) + tw(t, 23.0, 23.45, 0, 140, E.inOut) + tw(t, 24.0, 24.4, 0, -348, E.inOut) + tw(t, 24.7, 25.2, 0, 600, E.inExpo);
  const cy = tw(t, 22.25, 22.75, 1100, 553, E.inOut) + tw(t, 23.0, 23.45, 0, 303, E.inOut) + tw(t, 24.0, 24.4, 0, -303, E.inOut) + tw(t, 24.7, 25.2, 0, 400, E.inExpo);
  const press = Math.max(pulse(t, 22.8, 0.15), pulse(t, 23.5, 0.15), pulse(t, 24.45, 0.15));

  const word = [...WORDS].reverse().find((w) => t >= w.at);

  return (
    <AbsoluteFill style={{ background: C.canvas, overflow: 'hidden' }}>
      <FlatGrid color="rgba(28,37,15,0.06)" size={72} offset={(t - 22) * 10} />
      <AbsoluteFill style={{ transform: `translate(${sh.x}px, ${sh.y}px)` }}>
        {/* left: the line, then the beat words */}
        <div style={{ position: 'absolute', left: 120, top: 340, width: 860 }}>
          <Label size={28}>For the mod team</Label>
          {!word ? (
            <div style={{ marginTop: 30 }}>
              <Rise t={t} at={22.1} stagger={0.13} text="Your mods always get the last word." style={display(118, { color: C.ink })} highlight={{ 'last': { background: C.lime, borderRadius: 18, padding: '0 14px' } }} />
            </div>
          ) : (
            <div key={word.word} style={{ marginTop: 30, overflow: 'hidden', paddingBottom: 20 }}>
              <div style={{ ...display(word.word.length > 8 ? 168 : 200, { color: C.ink }), transform: `translateY(${(1 - tw(t, word.at, word.at + 0.22, 0, 1)) * 105}%) scale(${1 + pulse(t, word.at, 0.3) * 0.06})`, transformOrigin: 'left bottom' }}>{word.word}</div>
              <div style={{ display: 'flex', gap: 14, marginTop: 34 }}>
                {WORDS.map((w) => (
                  <div key={w.word} style={{ width: 120, height: 10, borderRadius: 9, background: t >= w.at ? C.olive : 'rgba(28,37,15,0.15)' }} />
                ))}
              </div>
            </div>
          )}
        </div>

        {/* right: the card for the current beat */}
        <div style={{ position: 'absolute', left: CARD.x, top: CARD.y, perspective: 1800 }}>
          <div style={{ transform: `translateX(${(1 - enter) * 800}px) rotateY(${(1 - enter) * -40 + flip * 90}deg)`, transformOrigin: 'left center' }}>
            {phase === 0 && <CaseCard t={t} />}
            {phase === 1 && <AppealCard t={t} />}
            {phase === 2 && <LockCard t={t} />}
          </div>
        </div>
        {t > 22.25 && t < 25.2 && <Cursor x={cx} y={cy} press={press} />}
      </AbsoluteFill>
    </AbsoluteFill>
  );
}
