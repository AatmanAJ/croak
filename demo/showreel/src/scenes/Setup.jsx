import React from 'react';
import { AbsoluteFill } from 'remotion';
import { C, FONT, MONO } from '../brand';
import { E, EyesMark, FlatGrid, Flash, Pill, Typed, display, mono, pulse, shake, sp, tw, useT } from '../lib';

// 28 to 32 s: /croak setup, enter, Croak is watching. ONE COMMAND. Free during early access.

const SUGGEST = [
  ['setup', 'channel  timeout_minutes'],
  ['settings', ''],
  ['status', ''],
  ['lockdown', 'action  minutes'],
];

export function Setup() {
  const t = useT(28);
  const enter = sp(t, 28, { damping: 18, stiffness: 140 });
  const sent = t >= 29.5;
  const sh = shake(t, [29.5, 30.5], 20, 0.3, 'setup');
  const ok = sp(t, 29.7, { damping: 12, stiffness: 220 });
  const big = sp(t, 30.5, { damping: 12, stiffness: 170 });
  const shrink = tw(t, 30.5, 30.9, 0, 1, E.outExpo);
  const typedLen = t < 28.2 ? 0 : '/croak setup'.length;
  const suggest = t >= 28.55 && !sent;
  const opt = sp(t, 29.05, { damping: 14, stiffness: 260 });
  const exit = tw(t, 31.55, 31.75, 0, 1, E.inExpo);

  return (
    <AbsoluteFill style={{ background: C.olive, overflow: 'hidden' }}>
      <FlatGrid color="rgba(218,243,107,0.06)" size={72} offset={(t - 28) * -12} />
      <AbsoluteFill style={{ transform: `translate(${sh.x}px, ${sh.y}px) scale(${1 + exit * 0.4})`, opacity: 1 - exit }}>
        <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', transform: `translateY(${(1 - enter) * 200 + shrink * 230}px) scale(${1 - shrink * 0.42})`, opacity: 1 - shrink * 0.35 }}>
          <div style={{ width: 1360, position: 'relative' }}>
            {/* success embed */}
            {t >= 29.7 && (
              <div style={{ position: 'absolute', bottom: 170, left: 0, right: 0, display: 'flex', gap: 26, alignItems: 'flex-start', transform: `translateY(${(1 - ok) * 60}px) scale(${0.9 + ok * 0.1})`, opacity: ok, transformOrigin: 'left bottom' }}>
                <EyesMark size={84} id="setup-av" lookX={0.6} />
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
                    <span style={{ fontFamily: FONT, fontWeight: 600, fontSize: 32, color: C.lime }}>Croak</span>
                    <span style={{ ...mono(18, { color: C.ink, background: C.lime, padding: '3px 10px', borderRadius: 8, fontWeight: 700 }) }}>APP</span>
                  </div>
                  <div style={{ marginTop: 12, borderRadius: 24, padding: '28px 34px', background: 'rgba(255,255,255,0.06)', borderLeft: `8px solid ${C.lime}` }}>
                    <div style={{ ...display(54, { color: '#F4F6EE' }) }}>Croak is watching.</div>
                    <div style={{ display: 'flex', gap: 14, marginTop: 18, flexWrap: 'wrap' }}>
                      {['mod log: #mod-log', '14 channels', 'sensitivity: standard'].map((x, i) => (
                        <span key={x} style={{ transform: `scale(${sp(t, 29.85 + i * 0.07, { damping: 12 })})`, display: 'inline-block' }}>
                          <Pill bg={C.olive2} color={C.limeSoft} style={{ fontFamily: MONO, fontSize: 22, border: `1.5px solid ${C.oliveLine}` }}>
                            {x}
                          </Pill>
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* suggestions */}
            {suggest && (
              <div style={{ position: 'absolute', bottom: 150, left: 0, right: 0, borderRadius: 28, background: '#2A3816', padding: 14, transform: `translateY(${(1 - sp(t, 28.55, { damping: 16, stiffness: 300 })) * 30}px)`, boxShadow: '0 30px 60px rgba(0,0,0,0.3)' }}>
                {SUGGEST.map(([cmd, args], i) => (
                  <div key={cmd} style={{ display: 'flex', alignItems: 'center', gap: 20, padding: '16px 22px', borderRadius: 18, background: i === 0 ? 'rgba(218,243,107,0.14)' : 'transparent' }}>
                    <EyesMark size={40} radius={10} id={`sg${i}`} />
                    <span style={{ fontFamily: FONT, fontSize: 32, color: '#F4F6EE', letterSpacing: '-0.02em' }}>
                      /croak <b style={{ fontWeight: 600 }}>{cmd}</b>
                    </span>
                    <span style={mono(24, { color: C.oliveMist })}>{args}</span>
                  </div>
                ))}
              </div>
            )}

            {/* composer */}
            <div style={{ height: 130, borderRadius: 34, background: sent ? `rgba(218,243,107,${0.2 * pulse(t, 29.5, 0.4)})` : '#2A3816', border: `2px solid ${t >= 28.15 && !sent ? C.limeDeep : C.oliveLine}`, display: 'flex', alignItems: 'center', padding: '0 40px', gap: 20, boxShadow: '0 30px 80px rgba(0,0,0,0.3)' }}>
              <span style={{ width: 56, height: 56, borderRadius: 99, background: 'rgba(255,255,255,0.08)', display: 'grid', placeItems: 'center', fontSize: 34, color: C.oliveMist }}>+</span>
              {sent ? (
                <span style={{ fontFamily: FONT, fontSize: 40, color: 'rgba(244,246,238,0.3)' }}>Message #mod-log</span>
              ) : typedLen === 0 ? (
                <span style={{ fontFamily: FONT, fontSize: 40, color: 'rgba(244,246,238,0.3)' }}>Message #mod-log</span>
              ) : (
                <span style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                  <Typed t={t} at={28.2} end={28.9} text="/croak setup" caret={t < 29.05} caretColor={C.lime} style={{ fontFamily: FONT, fontSize: 42, color: '#F4F6EE', letterSpacing: '-0.02em' }} />
                  {t >= 29.05 && (
                    <span style={{ transform: `scale(${opt})`, display: 'inline-block' }}>
                      <Pill bg="rgba(218,243,107,0.18)" color={C.lime} style={{ fontSize: 32, fontFamily: MONO, padding: '8px 18px' }}>
                        channel: #mod-log
                      </Pill>
                    </span>
                  )}
                </span>
              )}
              <span style={{ marginLeft: 'auto', ...mono(26, { color: C.oliveMist, opacity: t > 29.1 && !sent ? 1 : 0.4 }) }}>↵ enter</span>
            </div>
          </div>
        </AbsoluteFill>

        {/* ONE COMMAND */}
        {t >= 30.5 && (
          <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'flex-start', paddingTop: 150 }}>
            <div style={{ ...display(250, { color: C.lime, fontWeight: 600 }), transform: `scale(${2.2 - big * 1.2})`, opacity: Math.min(1, big * 2), textShadow: '0 30px 80px rgba(0,0,0,0.35)' }}>One command.</div>
            <div style={{ marginTop: 30, transform: `translateY(${(1 - sp(t, 30.62, { damping: 13 })) * 60}px)`, opacity: tw(t, 30.62, 30.8, 0, 1) }}>
              <Pill bg={C.lime} color={C.ink} style={{ fontSize: 38, padding: '16px 34px' }}>
                Free during early access
              </Pill>
            </div>
          </AbsoluteFill>
        )}
      </AbsoluteFill>
      <Flash t={t} at={29.5} color={C.lime} dur={0.15} max={0.35} />
      <Flash t={t} at={30.5} color="#fff" dur={0.14} max={0.4} />
      {t >= 31.75 && <AbsoluteFill style={{ background: '#000' }} />}
    </AbsoluteFill>
  );
}
