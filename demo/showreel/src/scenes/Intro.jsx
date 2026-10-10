import React from 'react';
import { AbsoluteFill, random } from 'remotion';
import { C, FONT, MONO } from '../brand';
import { E, Flash, Grain, GridFloor, Message, Rise, Vignette, display, mono, pulse, rgb, shake, sp, tw, useT } from '../lib';

// 0 to 8 s: one scam link, then a storm of them, then the threats slam in one by one.

const PINGS = [0.25, 2.0, 2.25, 2.5, 2.75, 3.0, 3.125, 3.25, 3.375, 3.5, 3.5625, 3.625, 3.6875, 3.75, 3.8125, 3.875, 3.9375];

const SCAMS = [
  { name: 'nitro_drops', text: 'Free Nitro for 3 months 🎁 claim fast', link: 'dlscord-gift.com/nitro' },
  { name: 'steam_support', text: 'your trade is on hold, verify here', link: 'steamcommunlty.com/verify' },
  { name: 'mrbeast_official', text: '$5,000 giveaway 💸 first 100 only', link: 'mrbeast-gift.live' },
  { name: 'hotsingles', text: '18+ server 🔥 join now', link: 'discord.gg/h0t-s1ngles' },
  { name: 'crypto_whale', text: '1000% gains, DM me for signals 🚀' },
  { name: 'mod_team', text: 'scan this QR to keep your account' },
  { name: 'robux_gen', text: 'free robux generator, still works', link: 'rob1ox.com' },
  { name: 'discord_staff', text: 'your account will be disabled', link: 'discord-verify.gg' },
  { name: 'gift_bot', text: 'you won a gift 🎉 claim in 10 min', link: 'nitro-claim.xyz' },
  { name: 'ana_xo', text: 'hey cutie, check my pics 😘', link: 'discord.gg/xo-pics' },
  { name: 'csgo_trader', text: 'free skins, just log in', link: 'csgo-skinz.ru' },
  { name: 'airdrop', text: 'official airdrop is live, connect wallet', link: 'dlscord-airdrop.com' },
  { name: 'nitro_drops', text: 'last chance 🎁 nitro for everyone', link: 'dlscord.gift' },
  { name: 'support', text: 'urgent: confirm your login', link: 'discordapp-login.co' },
  { name: 'giveaway_bot', text: 'iPhone 17 giveaway, click to enter', link: 'bit.ly/3xG1ft' },
  { name: 'steam_support', text: 'gift from a friend: $50 card', link: 'steamcommunity.gift' },
  { name: 'mrbeast_official', text: 'react to win 🎁', link: 'mrbeast-gift.live' },
];

// the storm: every ping adds a card, then extra cards machine-gun in before the first slam
const EXTRA = 34;
const CARDS = [
  ...SCAMS.map((s, i) => ({ s, i, at: PINGS[i] })),
  ...Array.from({ length: EXTRA }, (_, k) => ({ s: SCAMS[(k * 7 + 3) % SCAMS.length], i: SCAMS.length + k, at: 3.0 + (k / EXTRA) * 0.98 })),
];

// a deterministic cloud of card positions around the first card
const SLOTS = CARDS.map((_, i) => {
  if (i === 0) return { x: 0, y: 0, z: 0, r: 0 };
  const a = random(`a${i}`) * Math.PI * 2;
  const d = 380 + random(`d${i}`) * 760;
  return {
    x: Math.cos(a) * d * 1.5,
    y: Math.sin(a) * d * 0.7,
    z: -150 - random(`z${i}`) * 1100,
    r: (random(`r${i}`) - 0.5) * 18,
  };
});

function ScamCard({ s, i, t, appear }) {
  const p = sp(t, appear, { damping: 12, stiffness: 200 });
  const ring = pulse(t, appear, 0.5);
  return (
    <div
      style={{
        width: 900,
        padding: '30px 34px',
        borderRadius: 28,
        background: '#141A0B',
        border: '1.5px solid rgba(255,255,255,0.07)',
        boxShadow: `0 30px 80px rgba(0,0,0,0.55), 0 0 0 ${ring * 14}px rgba(255,92,138,${ring * 0.35})`,
        transform: `scale(${0.4 + p * 0.6})`,
        opacity: Math.min(1, p * 2.5),
        position: 'relative',
      }}
    >
      <Message dark name={s.name} text={s.text} link={s.link} avatar={i} />
      {i === 0 && (
        <div style={{ marginTop: 22, marginLeft: 86, padding: '22px 26px', borderRadius: 18, background: '#1C2410', borderLeft: `6px solid ${C.tongue}`, display: 'flex', alignItems: 'center', gap: 22 }}>
          <div style={{ width: 70, height: 70, borderRadius: 16, background: 'linear-gradient(135deg,#B49BFF,#6E7BFF)', display: 'grid', placeItems: 'center', fontSize: 38 }}>🎁</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontFamily: FONT, fontWeight: 600, fontSize: 26, color: '#EDEFE6', letterSpacing: '-0.02em' }}>You've been gifted Nitro!</div>
            <div style={{ fontFamily: FONT, fontSize: 20, color: 'rgba(237,239,230,0.5)', marginTop: 4 }}>Expires in 09:59</div>
          </div>
          <div style={{ padding: '12px 26px', borderRadius: 12, background: '#3BA55D', color: '#fff', fontFamily: FONT, fontWeight: 600, fontSize: 22 }}>Claim</div>
        </div>
      )}
      <div style={{ position: 'absolute', top: -12, right: -12, width: 26, height: 26, borderRadius: 99, background: C.tongue, transform: `scale(${p})`, boxShadow: '0 0 20px rgba(255,92,138,0.8)' }} />
    </div>
  );
}

function Badge({ t }) {
  const shown = PINGS.filter((p) => t >= p).length;
  const fast = tw(t, 3.4, 3.95, 0, 1, E.linear);
  const n = t < 3.4 ? shown : Math.round(shown + fast * (99 - shown));
  const label = t >= 3.95 ? '99+' : String(n);
  const bump = pulse(t, PINGS.filter((p) => t >= p).pop() ?? -1, 0.18);
  const o = tw(t, 1.9, 2.1, 0, 1);
  return (
    <div style={{ position: 'absolute', right: 90, top: 80, display: 'flex', alignItems: 'center', gap: 18, opacity: o }}>
      <span style={mono(24, { color: 'rgba(237,239,230,0.55)' })}># general</span>
      <span
        style={{
          minWidth: 64,
          padding: '8px 18px',
          borderRadius: 99,
          background: C.tongue,
          color: '#fff',
          fontFamily: MONO,
          fontWeight: 700,
          fontSize: 30,
          textAlign: 'center',
          transform: `scale(${1 + bump * 0.35})`,
          boxShadow: `0 0 ${30 + bump * 40}px rgba(255,92,138,0.6)`,
        }}
      >
        {label}
      </span>
    </div>
  );
}

const SLAMS = [
  { at: 4, word: 'FAKE NITRO', sub: 'dlscord-gift.com/nitro' },
  { at: 5, word: 'PHISHING', sub: 'steamcommunlty.com/verify' },
  { at: 6, word: 'NSFW INVITES', sub: 'discord.gg/h0t-s1ngles' },
  { at: 7, word: 'HACKED ACCOUNTS', sub: 'same link · 14 channels · 40 seconds' },
];

function SlamWord({ t, s, idx }) {
  if (t < s.at || t >= s.at + 1 || t >= 7.75) return null;
  const k = t - s.at;
  const split = Math.max(0, 1 - k * 4) * 26;
  const zoom = 1 + k * 0.06;
  const base = display(idx === 3 ? 196 : idx === 2 ? 250 : 300, { color: '#F4F6EE', fontWeight: 600, letterSpacing: '-0.06em', whiteSpace: 'nowrap', textShadow: rgb(split) });
  let word;
  if (idx === 0) {
    word = (
      <span style={base}>
        {[...s.word].map((ch, i) => {
          const p = sp(t, s.at + i * 0.018, { damping: 10, stiffness: 260 });
          return (
            <span key={i} style={{ display: 'inline-block', whiteSpace: 'pre', transform: `translateY(${(1 - p) * -140}%)` }}>
              {ch}
            </span>
          );
        })}
      </span>
    );
  } else if (idx === 1) {
    const z = 1 + Math.max(0, 1 - E.outExpo(Math.min(1, k / 0.22))) * 3;
    word = <span style={{ ...base, display: 'inline-block', transform: `scale(${z})`, filter: `blur(${(z - 1) * 6}px)` }}>{s.word}</span>;
  } else if (idx === 2) {
    const rows = [-1, 0, 1];
    word = (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0 }}>
        {rows.map((r) => (
          <span
            key={r}
            style={{
              ...base,
              transform: `translateX(${r * (k * 260 - 130)}px)`,
              color: r === 0 ? '#F4F6EE' : 'transparent',
              WebkitTextStroke: r === 0 ? 0 : '3px rgba(244,246,238,0.5)',
              textShadow: r === 0 ? rgb(split) : 'none',
            }}
          >
            {s.word}
          </span>
        ))}
      </div>
    );
  } else {
    const bands = 7;
    word = (
      <div style={{ position: 'relative' }}>
        {Array.from({ length: bands }, (_, b) => {
          const settle = Math.max(0, 1 - k * 2.6);
          const off = (random(`gl${b}${Math.floor(t * 30)}`) - 0.5) * 260 * settle;
          return (
            <span
              key={b}
              style={{
                ...base,
                position: b === 0 ? 'relative' : 'absolute',
                left: 0,
                top: 0,
                display: 'block',
                clipPath: `inset(${(b / bands) * 100}% 0 ${100 - ((b + 1) / bands) * 100}% 0)`,
                transform: `translateX(${off}px)`,
                color: b % 3 === 1 && settle > 0.2 ? C.tongue : base.color,
              }}
            >
              {s.word}
            </span>
          );
        })}
      </div>
    );
  }
  return (
    <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', transform: `scale(${zoom})` }}>
      {word}
      <div style={mono(34, { color: 'rgba(244,246,238,0.6)', marginTop: idx === 2 ? 10 : 40, opacity: tw(t, s.at + 0.12, s.at + 0.3, 0, 1) })}>{s.sub}</div>
    </AbsoluteFill>
  );
}

export function Intro() {
  const t = useT(0);
  if (t >= 7.75) return <AbsoluteFill style={{ background: '#000' }} />;

  // camera: push in on the first card, then pull back through the storm
  const push = tw(t, 0, 2, 0, 260, E.inOut);
  const pull = tw(t, 2, 4, 0, -760, E.inOut);
  const drift = t > 4 ? -(t - 4) * 120 : 0;
  const camZ = push + pull + drift;
  const camR = tw(t, 2, 4, 0, -6, E.inOut) + (t > 4 ? Math.sin(t * 2) * 2 : 0);
  const sh = shake(t, [4, 5, 6, 7, 7.5], 26, 0.35);
  const chaos = t >= 4;
  const wallDim = chaos ? 0.28 + pulse(t, Math.floor(t), 0.25) * 0.2 : 1;
  const wallBlur = chaos ? 6 : 0;

  return (
    <AbsoluteFill style={{ background: C.night, overflow: 'hidden' }}>
      <GridFloor t={t} color="rgba(218,243,107,0.08)" />
      <AbsoluteFill style={{ transform: `translate(${sh.x}px, ${sh.y}px) rotate(${sh.r}deg)` }}>
        <AbsoluteFill style={{ perspective: 1400, opacity: wallDim, filter: `blur(${wallBlur}px)` }}>
          <AbsoluteFill style={{ transformStyle: 'preserve-3d', transform: `translateZ(${camZ}px) rotateZ(${camR}deg)` }}>
            {CARDS.map(({ s, i, at }) => {
              if (t < at) return null;
              const sl = SLOTS[i];
              const bob = Math.sin(t * 1.3 + i) * 10;
              return (
                <div
                  key={i}
                  style={{
                    position: 'absolute',
                    left: 960 - 450,
                    top: i === 0 ? 540 - 190 : 540 - 90,
                    transform: `translate3d(${sl.x}px, ${sl.y + bob}px, ${sl.z}px) rotate(${sl.r}deg)`,
                  }}
                >
                  <ScamCard s={s} i={i} t={t} appear={at} />
                </div>
              );
            })}
          </AbsoluteFill>
        </AbsoluteFill>

        {/* captions */}
        {t < 2 && (
          <div style={{ position: 'absolute', left: 0, right: 0, bottom: 120, display: 'flex', justifyContent: 'center' }}>
            <Rise t={t} at={0.45} text="It starts with one link." style={display(76, { color: '#F4F6EE' })} />
          </div>
        )}
        {t >= 2 && t < 4 && (
          <div style={{ position: 'absolute', left: 0, right: 0, bottom: 110, display: 'flex', justifyContent: 'center' }}>
            <Rise t={t} at={2.2} text="Then it's everywhere." style={display(110, { color: '#F4F6EE', textShadow: '0 10px 60px rgba(0,0,0,0.9)' })} />
          </div>
        )}

        {SLAMS.map((s, i) => (
          <SlamWord key={s.word} t={t} s={s} idx={i} />
        ))}
      </AbsoluteFill>

      <Badge t={t} />
      {[4, 5, 6, 7].map((a) => (
        <Flash key={a} t={t} at={a} color="#F4F6EE" dur={0.16} max={0.55} />
      ))}
      <Vignette strength={0.75} />
    </AbsoluteFill>
  );
}
