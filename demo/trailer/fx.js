// Croak trailer: every graphic on top of the footage, drawn per frame from absolute time.
// Footage shots pass {scene, key} through fx.croak; graphic-only scenes are SPECIALS of type "scene".
(function () {
  const U = RRC.util;
  const W = 1920, H = 1080;
  const C = { pond: '#0E1F17', moss: '#18342A', frog: '#8FE04E', lily: '#F2F7E9', mist: '#9DB3A6', tongue: '#FF5C8A', amber: '#FFB547', link: '#00A8FC', ink: '#07110C' };
  const BRIC = 'CBric', MONO = 'CJBM';
  const px = () => (U && U.px ? U.px() : 1);

  // ---------- timeline (seconds) ----------
  const MONT = ['btc', 'rep', 'stm', 'typo', 'air', 'cyr'];
  const MONT_T0 = 6.5;
  const VANISH = { img: 5.5833, qr: 13.825 };
  MONT.forEach((k, i) => (VANISH[k] = MONT_T0 + i + 0.592));
  const VANISH_TIMES = Object.values(VANISH).sort((a, b) => a - b);
  const CUTS = [[4.0, C.tongue], [6.5, '#ffffff'], [12.5, '#ffffff'], [15.0, C.frog], [17.5, '#ffffff'], [23.0, C.tongue], [25.0, C.frog]];

  // plates are full source frames (3342x2160), so plate px = source px
  const OX = 0, OY = 0;
  const P = (sx, sy) => [sx - OX, sy - OY];

  // the last frame before each message vanished, used for the "yank"
  const YANK = { img: 'plates/img/00062.jpg', btc: 'plates/btc/00104.jpg', rep: 'plates/rep/00132.jpg', stm: 'plates/stm/00097.jpg', typo: 'plates/typo/00102.jpg', air: 'plates/air/00071.jpg', cyr: 'plates/cyr/00091.jpg', qr: 'plates/qr/00094.jpg' };
  // message strips in source px [x0, y0, x1, y1]
  const STRIP = {
    btc: [944, 1668, 2560, 1802], rep: [944, 1668, 2530, 1802], stm: [944, 1668, 2230, 1802],
    typo: [944, 1712, 2200, 1802], air: [944, 1712, 1900, 1802], cyr: [944, 1712, 1950, 1802],
    img: [1061, 1105, 2147, 1792], qr: [1058, 1095, 1632, 1796],
  };
  const IMGS = {};

  // ---------- assets ----------
  let READY = null;
  let GRAIN = [];
  function loadAll() {
    if (READY) return READY;
    READY = (async () => {
      const f1 = new FontFace(BRIC, 'url(/comp/fonts/Bricolage.ttf)', { weight: '200 800', stretch: '75% 100%' });
      const f2 = new FontFace(MONO, 'url(/comp/fonts/JetBrainsMono.ttf)', { weight: '100 800' });
      await Promise.all([f1.load(), f2.load()]);
      document.fonts.add(f1);
      document.fonts.add(f2);
      await Promise.all([document.fonts.load(`800 80px ${BRIC}`), document.fonts.load(`700 40px ${MONO}`), document.fonts.load(`40px 'Noto Color Emoji'`)]);
      await Promise.all(
        Object.entries(YANK).map(async ([k, src]) => {
          const im = new Image();
          im.src = '/' + src;
          try { await im.decode(); IMGS[k] = im; } catch (e) { /* missing frame: skip the yank */ }
        }),
      );
      for (let k = 0; k < 4; k++) {
        const c = document.createElement('canvas');
        c.width = c.height = 256;
        const g = c.getContext('2d');
        const im = g.createImageData(256, 256);
        let s = (1234567 + k * 99991) >>> 0;
        for (let i = 0; i < im.data.length; i += 4) {
          s = (Math.imul(s, 1103515245) + 12345) >>> 0;
          const v = s >>> 24;
          im.data[i] = im.data[i + 1] = im.data[i + 2] = v;
          im.data[i + 3] = 255;
        }
        g.putImageData(im, 0, 0);
        GRAIN.push(c);
      }
    })();
    return READY;
  }
  RRC.hook('init', () => loadAll());
  RRC.hook('beforeFrame', async () => { await loadAll(); });

  // ---------- maths ----------
  const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const seg = (t, a, b) => clamp((t - a) / (b - a));
  const eOut3 = (t) => 1 - Math.pow(1 - t, 3);
  const eOut5 = (t) => 1 - Math.pow(1 - t, 5);
  const eIn3 = (t) => t * t * t;
  const eIO3 = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const eBack = (t, s = 1.9) => 1 + (s + 1) * Math.pow(t - 1, 3) + s * Math.pow(t - 1, 2);
  function rng(seed) {
    let s = seed >>> 0 || 1;
    return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
  }
  function rrect(x, X, Y, w, h, r) { x.beginPath(); x.roundRect(X, Y, w, h, r); }
  function setFont(x, w, s, fam = BRIC, ls = 0) {
    x.font = `${w} ${s}px ${fam}, 'Noto Color Emoji', sans-serif`;
    x.letterSpacing = `${ls}px`;
  }
  function shakeAt(t, times, amp = 16) {
    let dx = 0, dy = 0;
    for (const v of times) {
      const d = t - v;
      if (d < 0 || d > 0.35) continue;
      const k = amp * Math.exp(-d * 14);
      dx += k * Math.sin(d * 97 + v * 13);
      dy += k * Math.cos(d * 83 + v * 7);
    }
    return [dx, dy];
  }

  // ---------- backdrop ----------
  function backdrop(x, t, base = C.pond) {
    x.fillStyle = base;
    x.fillRect(0, 0, W, H);
    const blobs = [[0.18, 0.22, 'rgba(36,82,58,0.75)', 760], [0.82, 0.78, 'rgba(30,70,48,0.7)', 820], [0.62, 0.1, 'rgba(143,224,78,0.10)', 560]];
    blobs.forEach(([bx, by, col, r], i) => {
      const cx = W * (bx + 0.05 * Math.sin(t * 0.55 + i * 2.1)), cy = H * (by + 0.06 * Math.cos(t * 0.45 + i));
      const g = x.createRadialGradient(cx, cy, 0, cx, cy, r);
      g.addColorStop(0, col);
      g.addColorStop(1, 'rgba(14,31,23,0)');
      x.fillStyle = g;
      x.fillRect(0, 0, W, H);
    });
    x.save();
    x.fillStyle = 'rgba(242,247,233,0.07)';
    const off = (t * 14) % 48;
    for (let yy = -48 + off; yy < H + 48; yy += 48) for (let xx = 24; xx < W; xx += 48) x.fillRect(xx, yy, 2, 2);
    x.restore();
  }
  function vignette(x, a = 0.6) {
    const g = x.createRadialGradient(W / 2, H / 2, H * 0.32, W / 2, H / 2, H * 1.0);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, `rgba(0,0,0,${a})`);
    x.fillStyle = g;
    x.fillRect(0, 0, W, H);
  }
  function grain(x, f, amt = 0.07) {
    if (!GRAIN.length) return;
    x.save();
    x.globalAlpha = amt;
    x.globalCompositeOperation = 'overlay';
    x.fillStyle = x.createPattern(GRAIN[f % 4], 'repeat');
    x.translate(-((f * 37) % 256), -((f * 61) % 256));
    x.fillRect(0, 0, W + 512, H + 512);
    x.restore();
  }

  // ---------- type ----------
  // words: [{t, c}]; slides each word up through a mask, staggered; `out` slides them away
  function words(x, list, X, Y, size, t, o = {}) {
    const { start = 0, stagger = 0.055, dur = 0.38, align = 'left', weight = 800, fam = BRIC, ls = -0.035, out = null, color = C.lily, gap = 0.26 } = o;
    setFont(x, weight, size, fam, ls * size);
    const g = size * gap;
    const widths = list.map((w) => x.measureText(w.t).width);
    const total = widths.reduce((a, b) => a + b, 0) + g * (list.length - 1);
    let cx = align === 'center' ? X - total / 2 : align === 'right' ? X - total : X;
    x.save();
    x.textAlign = 'left';
    x.textBaseline = 'alphabetic';
    list.forEach((w, i) => {
      const ip = eOut5(seg(t, start + i * stagger, start + i * stagger + dur));
      const oq = out == null ? 0 : eIn3(seg(t, out + i * 0.03, out + i * 0.03 + 0.2));
      if (ip > 0.001 && oq < 0.999) {
        x.save();
        x.beginPath();
        x.rect(cx - size * 0.25, Y - size * 1.08, widths[i] + size * 0.5, size * 1.42);
        x.clip();
        x.fillStyle = w.c || color;
        x.fillText(w.t, cx, Y + (1 - ip) * size * 1.1 - oq * size * 1.15);
        x.restore();
      }
      cx += widths[i] + g;
    });
    x.restore();
    return total;
  }
  function typed(x, text, X, Y, size, t, { start = 0, cps = 38, color = C.mist, weight = 700, caret = true } = {}) {
    const n = Math.floor(Math.max(0, t - start) * cps);
    if (t < start) return;
    setFont(x, weight, size, MONO, 0);
    x.fillStyle = color;
    x.textAlign = 'left';
    const s = text.slice(0, n);
    x.fillText(s, X, Y);
    if (caret && n < text.length + 8 && Math.floor(t * 4) % 2 === 0) x.fillRect(X + x.measureText(s).width + 4, Y - size * 0.8, size * 0.55, size * 0.95);
  }

  // ---------- frog (geometry from brand/mark.svg, origin at its centre 500,555) ----------
  function frog(x, cx, cy, s, o = {}) {
    const { pupil = -50, look = 0, lid = 0, squash = 0, rot = 0 } = o;
    x.save();
    x.translate(cx, cy);
    x.rotate(rot);
    x.scale(s * (1 + squash * 0.07), s * (1 - squash * 0.09));
    x.translate(-500, -555);
    x.fillStyle = C.frog;
    x.beginPath(); x.ellipse(500, 618, 392, 252, 0, 0, Math.PI * 2); x.fill();
    for (const ex of [300, 700]) { x.beginPath(); x.arc(ex, 395, 158, 0, Math.PI * 2); x.fill(); }
    const lidY = 373 + clamp(lid, -0.6, 1) * 130;
    for (const ex of [300, 700]) {
      x.save();
      x.beginPath(); x.arc(ex, 395, 108, 0, Math.PI * 2); x.clip();
      if (lidY < 500) {
        x.fillStyle = C.lily;
        x.fillRect(ex - 120, lidY, 240, 540 - lidY);
        x.save();
        x.beginPath(); x.rect(ex - 120, lidY, 240, 300); x.clip();
        x.fillStyle = C.pond;
        x.beginPath(); x.arc(ex + pupil, 425 + look, 50, 0, Math.PI * 2); x.fill();
        x.restore();
      }
      x.fillStyle = C.pond;
      x.fillRect(ex - 120, Math.min(lidY, 489), 240, 14);
      x.restore();
    }
    x.strokeStyle = C.pond;
    x.lineWidth = 30;
    x.lineCap = 'round';
    x.beginPath(); x.moveTo(236, 650); x.bezierCurveTo(400, 702, 620, 696, 766, 612); x.stroke();
    x.fillStyle = C.pond;
    x.beginPath(); x.arc(452, 548, 13, 0, Math.PI * 2); x.fill();
    x.beginPath(); x.arc(548, 548, 13, 0, Math.PI * 2); x.fill();
    x.restore();
  }
  const mouthOf = (cx, cy, s) => [cx + 10 * s, cy + 128 * s];
  // tongue reach: 0..1 over a lash that starts at t=0
  function reach(t, out = 0.07, hold = 0.03, back = 0.15) {
    if (t < 0) return 0;
    if (t < out) return eOut3(t / out);
    if (t < out + hold) return 1;
    if (t < out + hold + back) return 1 - eIn3((t - out - hold) / back);
    return 0;
  }
  function tongue(x, ox, oy, tx, ty, k, width) {
    if (k <= 0.002) return [ox, oy];
    const ex = lerp(ox, tx, k), ey = lerp(oy, ty, k);
    const mx = (ox + ex) / 2 + (ey - oy) * 0.12, my = (oy + ey) / 2 - Math.abs(ex - ox) * 0.08;
    x.save();
    x.strokeStyle = C.tongue;
    x.lineCap = 'round';
    x.lineWidth = width;
    x.beginPath(); x.moveTo(ox, oy); x.quadraticCurveTo(mx, my, ex, ey); x.stroke();
    x.fillStyle = C.tongue;
    x.beginPath(); x.arc(ex, ey, width * 1.15, 0, Math.PI * 2); x.fill();
    x.fillStyle = 'rgba(255,255,255,0.28)';
    x.beginPath(); x.arc(ex - width * 0.35, ey - width * 0.4, width * 0.38, 0, Math.PI * 2); x.fill();
    x.restore();
    return [ex, ey];
  }

  // ---------- stamp + burst ----------
  function stamp(x, cx, cy, t, { text = 'CROAKED', size = 66, sub = null, rot = -0.11 } = {}) {
    if (t < 0) return;
    const p = seg(t, 0, 0.15);
    const sc = t < 0.15 ? lerp(2.7, 1, eOut3(p)) : 1 + 0.05 * Math.exp(-(t - 0.15) * 16) * Math.sin((t - 0.15) * 46);
    x.save();
    x.translate(cx, cy);
    x.rotate(rot);
    x.scale(sc, sc);
    x.globalAlpha = clamp(t / 0.05);
    setFont(x, 800, size, MONO, size * 0.1);
    const tw = x.measureText(text).width;
    const bw = tw + size * 0.95, bh = size * 1.62;
    x.shadowColor = 'rgba(255,92,138,0.6)';
    x.shadowBlur = 46 * px();
    x.fillStyle = 'rgba(30,8,16,0.72)';
    rrect(x, -bw / 2, -bh / 2, bw, bh, size * 0.24);
    x.fill();
    x.shadowBlur = 0;
    x.shadowColor = 'transparent';
    x.lineWidth = size * 0.09;
    x.strokeStyle = C.tongue;
    x.stroke();
    x.fillStyle = C.tongue;
    x.textAlign = 'center';
    x.textBaseline = 'middle';
    x.fillText(text, size * 0.05, size * 0.05);
    if (sub) {
      x.globalAlpha = clamp((t - 0.18) / 0.15);
      setFont(x, 700, size * 0.32, MONO, size * 0.03);
      x.fillStyle = C.lily;
      x.fillText(sub, 0, bh / 2 + size * 0.45);
    }
    x.restore();
  }
  function burst(x, cx, cy, t, seed = 1) {
    if (t < 0 || t > 0.9) return;
    const p = eOut3(seg(t, 0, 0.5));
    x.save();
    x.globalAlpha = (1 - p) * 0.9;
    x.strokeStyle = C.tongue;
    x.lineWidth = lerp(16, 1, p);
    x.beginPath(); x.arc(cx, cy, lerp(30, 420, p), 0, Math.PI * 2); x.stroke();
    const p2 = eOut3(seg(t, 0.04, 0.45));
    x.globalAlpha = (1 - p2) * 0.6;
    x.strokeStyle = C.lily;
    x.lineWidth = lerp(6, 0.5, p2);
    x.beginPath(); x.arc(cx, cy, lerp(10, 280, p2), 0, Math.PI * 2); x.stroke();
    const R = rng(seed * 7919 + 17);
    const cols = [C.tongue, C.frog, C.lily, C.tongue, C.amber];
    for (let i = 0; i < 26; i++) {
      const ang = R() * Math.PI * 2, sp = 380 + R() * 950, life = 0.35 + R() * 0.5, sz = 5 + R() * 12;
      const q = t / life;
      if (q >= 1) continue;
      const d = sp * t * (1 - 0.45 * q);
      x.globalAlpha = 1 - q;
      x.fillStyle = cols[i % cols.length];
      x.save();
      x.translate(cx + Math.cos(ang) * d, cy + Math.sin(ang) * d + 520 * t * t);
      x.rotate(ang + t * 9);
      x.fillRect(-sz / 2, -sz / 4, sz, sz / 2);
      x.restore();
    }
    x.restore();
  }

  // ---------- footage card ----------
  function camAt(keys, t) {
    if (t <= keys[0].t) return keys[0];
    for (let i = 1; i < keys.length; i++) {
      if (t <= keys[i].t) {
        const a = keys[i - 1], b = keys[i];
        const e = (b.e || eIO3)(seg(t, a.t, b.t));
        const o = {};
        for (const k of Object.keys(b)) if (typeof b[k] === 'number' && k !== 't') o[k] = lerp(a[k] ?? b[k], b[k], e);
        return o;
      }
    }
    return keys[keys.length - 1];
  }
  function card(x, plate, cam, { glow = 0, dx = 0, dy = 0, ghosts = 0, ghostDx = 0 } = {}) {
    if (!plate) return null;
    const vw = cam.vw, vh = (vw * cam.h) / cam.w;
    const sx = clamp(cam.vx - vw / 2, 0, plate.width - vw), sy = clamp(cam.vy - vh / 2, 0, plate.height - vh);
    const cx = cam.x + dx, cy = cam.y + dy, rot = cam.rot || 0, R = 26;
    const paint = (ox, alpha) => {
      x.save();
      x.translate(cx + ox, cy);
      x.rotate(rot);
      x.globalAlpha *= alpha;
      if (alpha === 1) {
        x.save();
        x.shadowColor = 'rgba(0,0,0,0.65)';
        x.shadowBlur = 90 * px();
        x.shadowOffsetY = 34 * px();
        x.fillStyle = '#111214';
        rrect(x, -cam.w / 2, -cam.h / 2, cam.w, cam.h, R);
        x.fill();
        x.restore();
      }
      x.save();
      rrect(x, -cam.w / 2, -cam.h / 2, cam.w, cam.h, R);
      x.clip();
      x.drawImage(plate, sx, sy, vw, vh, -cam.w / 2, -cam.h / 2, cam.w, cam.h);
      x.restore();
      x.lineWidth = 2;
      x.strokeStyle = 'rgba(242,247,233,0.12)';
      rrect(x, -cam.w / 2, -cam.h / 2, cam.w, cam.h, R);
      x.stroke();
      if (glow > 0.01 && alpha === 1) {
        x.shadowColor = `rgba(255,92,138,${0.8 * glow})`;
        x.shadowBlur = 60 * px();
        x.lineWidth = 4;
        x.strokeStyle = `rgba(255,92,138,${glow})`;
        x.stroke();
      }
      x.restore();
    };
    for (let g = ghosts; g >= 1; g--) paint(-ghostDx * g * 0.35, 0.22);
    paint(0, 1);
    const k = cam.w / vw, cs = Math.cos(rot), sn = Math.sin(rot);
    const map = (pxx, pyy) => {
      const lx = (pxx - sx - vw / 2) * k, ly = (pyy - sy - vh / 2) * k;
      return [cx + lx * cs - ly * sn, cy + lx * sn + ly * cs];
    };
    return { map, k, rot };
  }
  // the message as it was a frame before it vanished, flung away
  function yank(x, key, m, t, dir = 1) {
    const im = IMGS[key];
    if (!im || !m || t < 0 || t > 0.5) return;
    const [sx0, sy0, sx1, sy1] = STRIP[key];
    const [px0, py0] = P(sx0, sy0), [px1, py1] = P(sx1, sy1);
    const [cx, cy] = m.map((px0 + px1) / 2, (py0 + py1) / 2);
    const w = (px1 - px0) * m.k, h = (py1 - py0) * m.k;
    const p = eIn3(seg(t, 0, 0.42));
    x.save();
    x.translate(cx + dir * p * 900, cy - p * 160 + p * p * 300);
    x.rotate(m.rot + dir * p * 0.35);
    x.scale(1 + p * 0.15, 1 - p * 0.25);
    x.globalAlpha = 1 - seg(t, 0.25, 0.45);
    x.drawImage(im, px0, py0, px1 - px0, py1 - py0, -w / 2, -h / 2, w, h);
    x.globalCompositeOperation = 'source-atop';
    x.fillStyle = `rgba(255,92,138,${0.15 + 0.45 * p})`;
    x.fillRect(-w / 2, -h / 2, w, h);
    x.globalCompositeOperation = 'source-over';
    const sl = eOut3(seg(t, 0, 0.09));
    x.strokeStyle = C.tongue;
    x.lineWidth = 7;
    x.lineCap = 'round';
    x.beginPath(); x.moveTo(-w / 2 - 10, 4); x.lineTo(-w / 2 - 10 + (w + 20) * sl, 4); x.stroke();
    x.restore();
  }
  function headline(x, list, t, o = {}) { return words(x, list, 120, 168, 82, t, o); }
  function hud(x, t) {
    if (t < 4.05 || t >= 15.0) return;
    const a = clamp((t - 4.05) / 0.2) * (1 - seg(t, 14.75, 15.0));
    const passed = VANISH_TIMES.filter((v) => t >= v);
    const n = passed.length;
    const last = passed[passed.length - 1];
    const bump = last == null ? 0 : Math.exp(-(t - last) * 9);
    x.save();
    x.globalAlpha = a;
    x.textAlign = 'right';
    setFont(x, 700, 22, MONO, 5);
    x.fillStyle = C.mist;
    x.fillText('CROAKED', 1800, 104);
    x.translate(1800, 178);
    x.scale(1 + bump * 0.3, 1 + bump * 0.3);
    setFont(x, 800, 74, MONO, 0);
    x.fillStyle = bump > 0.25 ? C.tongue : C.lily;
    x.fillText(String(n).padStart(2, '0'), 0, 0);
    x.restore();
  }

  // ---------- scenes ----------
  const SCAMS = [
    { n: 'nitro_drops', av: '#5865F2', l1: 'FREE NITRO for everyone rn 🎁', l2: 'dlscord-gift.com/claim', x: 470, y: 250, r: -0.09, t: 0.12 },
    { n: 'MrBeast Official', av: '#FF5C8A', l1: 'Giving away 5 BTC for 400M subs 🎉', l2: 'mrbeast-btc-giveaway.com', x: 1450, y: 205, r: 0.07, t: 0.38 },
    { n: 'Discord Safety', av: '#FFB547', l1: '⚠️ Your account was reported. Verify:', l2: 'discord-safety-verify.com/login', x: 1460, y: 850, r: -0.05, t: 0.64 },
    { n: 'steam_admin', av: '#00A8FC', l1: 'sorry bro i reported ur steam 😭', l2: 'steamcommunity-support.ru', x: 470, y: 860, r: 0.06, t: 0.9 },
    { n: 'airdrop_bot', av: '#8FE04E', l1: 'airdrop is LIVE, claim before it ends 👉', l2: 'dlscord-airdrop[.]com', x: 960, y: 118, r: -0.03, t: 1.16 },
  ];
  const EAT = [[3, 2.7], [2, 2.93], [0, 3.16], [1, 3.38], [4, 3.58]]; // [card, time the tongue leaves]
  function scamCard(x, c, cx, cy, sc, a, rot) {
    x.save();
    x.translate(cx, cy);
    x.rotate(rot);
    x.scale(sc, sc);
    x.globalAlpha *= a;
    const w = 720, h = 132;
    x.save();
    x.shadowColor = 'rgba(0,0,0,0.6)';
    x.shadowBlur = 50 * px();
    x.shadowOffsetY = 18 * px();
    x.fillStyle = '#232428';
    rrect(x, -w / 2, -h / 2, w, h, 22);
    x.fill();
    x.restore();
    x.lineWidth = 2;
    x.strokeStyle = 'rgba(255,92,138,0.5)';
    rrect(x, -w / 2, -h / 2, w, h, 22);
    x.stroke();
    x.fillStyle = c.av;
    x.beginPath(); x.arc(-w / 2 + 58, -h / 2 + 54, 31, 0, Math.PI * 2); x.fill();
    x.textAlign = 'left';
    x.textBaseline = 'alphabetic';
    setFont(x, 700, 26, BRIC);
    x.fillStyle = C.lily;
    x.fillText(c.n, -w / 2 + 106, -h / 2 + 46);
    setFont(x, 400, 25, BRIC);
    x.fillStyle = '#DBDEE1';
    x.fillText(c.l1, -w / 2 + 106, -h / 2 + 84);
    x.fillStyle = C.link;
    x.fillText(c.l2, -w / 2 + 106, -h / 2 + 116);
    x.restore();
  }
  function sceneOpen(x, t, f) {
    backdrop(x, t);
    const fs = 0.56;
    const rise = eBack(seg(t, 2.22, 2.6), 1.4);
    const sink = eIn3(seg(t, 3.78, 4.0));
    const fy = lerp(1330, 950, rise) + sink * 300;
    const [mx, my] = mouthOf(960, fy, fs);
    const [sdx, sdy] = shakeAt(t, SCAMS.map((c) => c.t + 0.1), 10);
    // which card is being eaten now, and where the tongue tip is
    let tip = null, target = null, active = -1;
    for (const [ci, te] of EAT) {
      const k = reach(t - te);
      if (t >= te && t < te + 0.26) { const c = SCAMS[ci]; active = ci; target = [c.x, c.y]; tip = [lerp(mx, c.x, k), lerp(my, c.y, k)]; }
    }
    // headline scrim
    const sa = seg(t, 1.3, 1.6) * (1 - seg(t, 3.7, 3.95));
    if (sa > 0) {
      const g = x.createRadialGradient(W / 2, 520, 0, W / 2, 520, 820);
      g.addColorStop(0, `rgba(7,17,12,${0.85 * sa})`);
      g.addColorStop(1, 'rgba(7,17,12,0)');
      x.fillStyle = g;
      x.fillRect(0, 0, W, H);
    }
    SCAMS.forEach((c, i) => {
      const lt = t - c.t;
      if (lt < 0) return;
      let sc = lerp(1.75, 1, eBack(seg(lt, 0, 0.2))), a = clamp(lt / 0.06);
      let cx = c.x + Math.sin(t * 7 + i) * 3, cy = c.y + Math.cos(t * 6 + i * 2) * 3, rot = c.r;
      const eat = EAT.find((e) => e[0] === i)[1];
      if (t >= eat + 0.1) {
        const back = seg(t, eat + 0.1, eat + 0.25);
        const k = 1 - eIn3(back);
        cx = lerp(mx, c.x, k);
        cy = lerp(my, c.y, k);
        sc *= lerp(0.05, 1, k);
        rot += (1 - k) * 0.8;
        if (back >= 1) return;
      }
      if (t > 1.6 && t < 2.3) { // glitch the scams before Croak shows up
        const gl = Math.sin(t * 40 + i * 3) > 0.7 ? 1 : 0;
        if (gl) { x.save(); x.globalAlpha = 0.5; x.globalCompositeOperation = 'lighter'; scamCard(x, c, cx + 14, cy, sc, a * 0.5, rot); x.restore(); }
      }
      scamCard(x, c, cx + sdx, cy + sdy, sc, a, rot);
    });
    // headline
    words(x, [{ t: 'Scams' }, { t: 'post' }, { t: 'fast.', c: C.tongue }], W / 2, 590, 158, t, { start: 1.3, align: 'center', out: 2.12 });
    words(x, [{ t: 'Croak' , c: C.frog }, { t: 'is' }, { t: 'faster.' }], W / 2, 590, 158, t, { start: 2.25, align: 'center', out: 3.72 });
    // frog + tongue
    if (t > 2.2) {
      let pupil = -50, look = 0;
      if (target) { pupil = clamp(((target[0] - 960) / 520) * 50, -55, 55); look = clamp(((target[1] - fy) / 500) * 40, -45, 10); }
      const gulp = EAT.some(([, te]) => t > te + 0.2 && t < te + 0.3);
      const blink = t > 3.82 ? 1 : 0;
      if (tip) tongue(x, mx, my, target[0], target[1], reach(t - EAT.find((e) => e[0] === active)[1]), 26);
      frog(x, 960, fy, fs, { pupil, look, lid: blink ? 1 : 0, squash: gulp ? 1 : 0 });
    }
  }

  function sceneImg(x, S, t) {
    backdrop(x, t);
    const st = t - 4.0, v = VANISH.img - 4.0;
    const cam = camAt([
      { t: 0, x: 960, y: 640, w: 1400, h: 840, rot: -0.03, vx: 1672, vy: 1078, vw: 2960 },
      { t: 0.9, x: 960, y: 628, w: 1480, h: 830, rot: 0, vx: 1604, vy: 1450, vw: 1560 },
      { t: 1.55, x: 960, y: 628, w: 1480, h: 830, rot: 0, vx: 1604, vy: 1450, vw: 1500 },
      { t: 2.5, x: 960, y: 628, w: 1480, h: 830, rot: 0.006, vx: 1604, vy: 1450, vw: 1460 },
    ], st);
    const [dx, dy] = shakeAt(st, [v], 18);
    const m = card(x, S.plate, cam, { dx, dy, glow: Math.exp(-Math.max(0, st - v) * 4) * (st >= v ? 1 : 0) });
    const hw = headline(x, [{ t: 'Scam' }, { t: 'images?' }], st, { start: 0.15 });
    words(x, [{ t: 'Croaked.', c: C.tongue }], 120 + hw + 82 * 0.26, 168, 82, st, { start: v });
    // frog peeks in from the bottom left and grabs the images
    const fs = 0.4, rise = eBack(seg(st, 1.05, 1.35), 1.5), sink = eIn3(seg(st, 2.05, 2.4));
    const fx = 250, fy = lerp(1280, 985, rise) + sink * 320;
    const [mx, my] = mouthOf(fx, fy, fs);
    if (m) {
      const [tx, ty] = m.map(...P(1604, 1450));
      const k = reach(st - (v - 0.075), 0.075, 0.03, 0.16);
      const tip = tongue(x, mx, my, tx, ty, k, 22);
      if (st >= v && st < v + 0.26 && IMGS.img) { // a shrinking bite of the images rides the tongue home
        const s = 0.22 * k;
        x.save(); x.translate(tip[0], tip[1]); x.rotate(-0.2);
        const [a0, b0] = P(STRIP.img[0], STRIP.img[1]), [a1, b1] = P(STRIP.img[2], STRIP.img[3]);
        x.drawImage(IMGS.img, a0, b0, a1 - a0, b1 - b0, -((a1 - a0) * s) / 2, -((b1 - b0) * s) / 2, (a1 - a0) * s, (b1 - b0) * s);
        x.restore();
      }
      if (st > 1.0) frog(x, fx, fy, fs, { pupil: 48, look: -30, lid: st > 2.0 && st < 2.1 ? 1 : 0, squash: st > v + 0.2 && st < v + 0.3 ? 1 : 0 });
      const [sx, sy] = m.map(...P(1650, 1430));
      burst(x, sx, sy, st - v, 3);
      stamp(x, sx + 40, sy - 20, st - v - 0.04, { sub: 'scam image · AI image check', size: 74 });
    }
  }

  const MONT_COPY = {
    btc: [[{ t: 'Fake' }, { t: 'giveaways.', c: C.frog }], 'scam link'],
    rep: [[{ t: 'Phishing' }, { t: 'bait.', c: C.frog }], 'phishing link'],
    stm: [[{ t: 'Steam' }, { t: 'scams.', c: C.frog }], 'scam link'],
    typo: [[{ t: 'No' }, { t: 'https://?', c: C.mist }, { t: 'Still' }, { t: 'caught.', c: C.frog }], 'look-alike domain'],
    air: [[{ t: 'Sneaky' }, { t: '[.]', c: C.tongue }, { t: 'dots.', c: C.frog }], 'disguised link'],
    cyr: [[{ t: 'Fake' }, { t: 'letters.', c: C.frog }], 'look-alike letters'],
  };
  function sceneMont(x, S, t, key) {
    backdrop(x, t);
    const i = MONT.indexOf(key), T0 = MONT_T0 + i, st = t - T0, v = VANISH[key] - T0;
    const dir = i % 2 ? -1 : 1;
    const cam = camAt([
      { t: 0, x: 960, y: 620, w: 1760, h: 820, rot: dir * 0.012, vx: 1725, vy: 1590, vw: 1640 },
      { t: 0.55, x: 960, y: 620, w: 1760, h: 820, rot: dir * 0.004, vx: 1725, vy: 1590, vw: 1560, e: eOut3 },
      { t: 1.0, x: 960, y: 620, w: 1760, h: 820, rot: 0, vx: 1725, vy: 1590, vw: 1540 },
    ], st);
    const whip = 1 - eOut3(seg(st, 0, 0.11));
    const [sdx, sdy] = shakeAt(st, [v], 16);
    const punch = st >= v ? 1 + 0.03 * Math.exp(-(st - v) * 12) : 1;
    cam.w *= punch;
    cam.h *= punch;
    const m = card(x, S.plate, cam, { dx: dir * 420 * whip + sdx, dy: sdy, ghosts: whip > 0.05 ? 3 : 0, ghostDx: dir * 420 * whip, glow: st >= v ? Math.exp(-(st - v) * 5) : 0 });
    headline(x, MONT_COPY[key][0], st, { start: 0.02, stagger: 0.045, dur: 0.3, out: 0.93 });
    if (m) {
      const [a0, b0, a1, b1] = STRIP[key];
      const [cx, cy] = m.map(...P((a0 + a1) / 2, (b0 + b1) / 2));
      yank(x, key, m, st - v, dir);
      burst(x, cx, cy, st - v, i + 5);
      stamp(x, Math.min(cx + 160, 1500), cy - 40, st - v - 0.03, { sub: MONT_COPY[key][1], size: 66, rot: -0.1 * dir });
    }
  }

  function sceneQr(x, S, t) {
    backdrop(x, t);
    const st = t - 12.5, v = VANISH.qr - 12.5;
    const cam = camAt([
      { t: 0, x: 960, y: 640, w: 1400, h: 840, rot: 0.03, vx: 1672, vy: 1078, vw: 2960 },
      { t: 0.55, x: 960, y: 628, w: 1480, h: 830, rot: 0, vx: 1532, vy: 1445, vw: 1500 },
      { t: 2.5, x: 960, y: 628, w: 1480, h: 830, rot: -0.006, vx: 1532, vy: 1445, vw: 1440 },
    ], st);
    const [dx, dy] = shakeAt(st, [v], 18);
    const m = card(x, S.plate, cam, { dx, dy, glow: st >= v ? Math.exp(-(st - v) * 4) : 0 });
    headline(x, [{ t: 'QR' }, { t: 'login' }, { t: 'scams.', c: C.frog }], st, { start: 0.1 });
    if (!m) return;
    const [q0x, q0y] = m.map(...P(1164, 1258)), [q1x, q1y] = m.map(...P(1528, 1618));
    if (st > 0.62 && st < v) {
      const a = seg(st, 0.62, 0.75);
      x.save();
      x.globalAlpha = a;
      x.strokeStyle = C.frog;
      x.lineWidth = 6;
      x.lineCap = 'round';
      const L = 46, pad = 18;
      const corners = [[q0x - pad, q0y - pad, 1, 1], [q1x + pad, q0y - pad, -1, 1], [q0x - pad, q1y + pad, 1, -1], [q1x + pad, q1y + pad, -1, -1]];
      for (const [cx, cy, sx, sy] of corners) { x.beginPath(); x.moveTo(cx + sx * L, cy); x.lineTo(cx, cy); x.lineTo(cx, cy + sy * L); x.stroke(); }
      const sweep = (st - 0.68) / 0.32;
      const ph = sweep - Math.floor(sweep), dn = Math.floor(sweep) % 2 === 0;
      const ly = lerp(q0y, q1y, dn ? ph : 1 - ph);
      x.shadowColor = 'rgba(143,224,78,0.9)';
      x.shadowBlur = 30 * px();
      x.fillStyle = 'rgba(143,224,78,0.95)';
      x.fillRect(q0x - 8, ly - 3, q1x - q0x + 16, 6);
      x.restore();
    }
    const rx = Math.max(q1x + 110, 1180);
    typed(x, '> reading QR code…', rx, 520, 30, st, { start: 0.66, color: C.mist, cps: 48 });
    typed(x, '> discord.com/ra/•••••', rx, 572, 30, st, { start: 0.92, color: C.lily, cps: 48 });
    typed(x, '> Discord login hijack', rx, 624, 30, st, { start: 1.12, color: C.tongue, caret: false, cps: 52 });
    const fs = 0.4, rise = eBack(seg(st, 0.95, 1.2), 1.5), sink = eIn3(seg(st, 2.1, 2.45));
    const fx = 1700, fy = lerp(1280, 985, rise) + sink * 320;
    const [mx, my] = mouthOf(fx, fy, fs);
    const tx = (q0x + q1x) / 2, ty = (q0y + q1y) / 2;
    const k = reach(st - (v - 0.075), 0.075, 0.03, 0.16);
    const tip = tongue(x, mx, my, tx, ty, k, 22);
    if (st >= v && st < v + 0.26 && IMGS.qr) {
      const s = 0.3 * k;
      const [a0, b0] = P(STRIP.qr[0], STRIP.qr[1]), [a1, b1] = P(STRIP.qr[2], STRIP.qr[3]);
      x.save(); x.translate(tip[0], tip[1]); x.rotate(0.25);
      x.drawImage(IMGS.qr, a0, b0, a1 - a0, b1 - b0, -((a1 - a0) * s) / 2, -((b1 - b0) * s) / 2, (a1 - a0) * s, (b1 - b0) * s);
      x.restore();
    }
    if (st > 0.9) frog(x, fx, fy, fs, { pupil: -52, look: -35, squash: st > v + 0.2 && st < v + 0.3 ? 1 : 0, lid: st > 1.9 && st < 2.0 ? 1 : 0 });
    burst(x, tx, ty, st - v, 11);
    stamp(x, tx + 60, ty, st - v - 0.04, { sub: 'Discord login QR', size: 74, rot: 0.09 });
  }

  function sceneDm(x, S, t) {
    backdrop(x, t);
    const st = t - 15.0;
    const cam = camAt([
      { t: 0, x: 960, y: 640, w: 1400, h: 840, rot: -0.02, vx: 1672, vy: 1078, vw: 2960 },
      { t: 0.85, x: 960, y: 640, w: 1640, h: 770, rot: 0, vx: 1700, vy: 1610, vw: 1560 },
      { t: 2.5, x: 960, y: 640, w: 1640, h: 770, rot: 0.004, vx: 1700, vy: 1610, vw: 1500 },
    ], st);
    const m = card(x, S.plate, cam, {});
    headline(x, [{ t: 'Kind' }, { t: 'to' }, { t: 'hacked' }, { t: 'members.', c: C.frog }], st, { start: 0.1, out: 2.3 });
    if (!m) return;
    const hl = eOut3(seg(st, 1.0, 1.35));
    if (hl > 0) {
      const [a0x, a0y] = m.map(...P(1050, 1590)), [a1x, a1y] = m.map(...P(2410, 1712));
      x.save();
      x.strokeStyle = C.frog;
      x.lineWidth = 4;
      x.shadowColor = 'rgba(143,224,78,0.7)';
      x.shadowBlur = 24 * px();
      x.setLineDash([(a1x - a0x + a1y - a0y) * 2 * hl, 99999]);
      rrect(x, a0x - 12, a0y - 10, a1x - a0x + 24, a1y - a0y + 20, 14);
      x.stroke();
      x.restore();
      x.save();
      x.globalAlpha = seg(st, 1.2, 1.4);
      setFont(x, 700, 26, MONO, 1);
      x.fillStyle = C.frog;
      x.fillText('how to lock their account', a0x - 8, a0y - 26);
      x.restore();
    }
    const bt = st - 1.55;
    if (bt > 0) {
      const [b0x, b0y] = m.map(...P(1063, 1738)), [b1x, b1y] = m.map(...P(1331, 1792));
      const cx = (b0x + b1x) / 2, cy = (b0y + b1y) / 2;
      const pulse = (bt % 0.6) / 0.6;
      x.save();
      x.strokeStyle = C.tongue;
      x.lineWidth = 4;
      x.globalAlpha = 1 - pulse;
      rrect(x, b0x - 10 - pulse * 30, b0y - 8 - pulse * 18, b1x - b0x + 20 + pulse * 60, b1y - b0y + 16 + pulse * 36, 14);
      x.stroke();
      x.globalAlpha = seg(bt, 0, 0.2);
      x.lineWidth = 4;
      rrect(x, b0x - 10, b0y - 8, b1x - b0x + 20, b1y - b0y + 16, 12);
      x.stroke();
      words(x, [{ t: 'One' }, { t: 'tap' }, { t: 'to' }, { t: 'appeal.', c: C.tongue }], b1x + 40, cy + 18, 48, bt, { start: 0.05 });
      x.restore();
    }
  }

  const FEATS = [
    ['AI image checks', 'frog'], ['Look-alike domains', 'pond'], ['QR login scams', 'tongue'], ['Raid lockdown', 'lily'],
    ['Reply to appeals', 'pond'], ['Right-click reports', 'frog'], ['Watch & trust', 'pond'], ['AutoMod sync', 'tongue'],
    ['Weekly digests', 'lily'], ['Remembers every verdict', 'pond'], ['+ loads more', 'frog'],
  ];
  const SCHEME = { frog: [C.frog, C.pond, C.pond], pond: [C.pond, C.lily, C.frog], tongue: [C.tongue, C.pond, C.lily], lily: [C.lily, C.pond, C.tongue] };
  function sceneFeat(x, t, f) {
    const st = t - 17.5;
    const i = Math.min(FEATS.length - 1, Math.floor(st / 0.5));
    const lt = st - i * 0.5;
    const [bgc, fg] = SCHEME[FEATS[i][1]];
    const prev = i > 0 ? SCHEME[FEATS[i - 1][1]][0] : C.pond;
    x.fillStyle = prev;
    x.fillRect(0, 0, W, H);
    x.save();
    x.beginPath();
    x.arc(W / 2, H / 2, eOut3(seg(lt, 0, 0.16)) * 1150 + 1, 0, Math.PI * 2);
    x.clip();
    x.fillStyle = bgc;
    x.fillRect(0, 0, W, H);
    const mq = FEATS.map((e) => e[0].toUpperCase()).join('   ✦   ') + '   ✦   ';
    setFont(x, 800, 110, MONO, 4);
    x.fillStyle = fg;
    x.globalAlpha = 0.055;
    const mw = x.measureText(mq).width;
    for (let r = 0; r < 5; r++) {
      const sp = r % 2 ? -360 : 480;
      let off = (t * sp + r * 700) % mw;
      if (off > 0) off -= mw;
      x.fillText(mq + mq, off, 120 + r * 225);
    }
    x.globalAlpha = 1;
    const txt = FEATS[i][0];
    setFont(x, 800, 100, BRIC, -3);
    const size = Math.min(210, (100 * 1640) / x.measureText(txt).width);
    const p = eOut5(seg(lt, 0, 0.22));
    x.save();
    x.translate(W / 2, H / 2 + size * 0.34 + (1 - p) * 40);
    x.rotate((1 - p) * 0.05 * (i % 2 ? -1 : 1));
    x.scale(lerp(1.28, 1, p), lerp(1.28, 1, p));
    setFont(x, 800, size, BRIC, -size * 0.035);
    x.textAlign = 'center';
    x.fillStyle = fg;
    x.globalAlpha = clamp(lt / 0.04);
    x.fillText(txt, 0, 0);
    x.restore();
    setFont(x, 700, 26, MONO, 3);
    x.fillStyle = fg;
    x.globalAlpha = 0.85;
    x.textAlign = 'left';
    x.fillText(i < 10 ? `${String(i + 1).padStart(2, '0')} / 10` : 'AND MORE', 90, H - 74);
    x.fillRect(90, H - 52, (Math.min(i + lt / 0.5, 10) / 10) * 300, 4);
    x.textAlign = 'right';
    x.fillText('CROAK', W - 90, H - 74);
    x.restore();
    frog(x, W - 150, 140, 0.13, { pupil: [-50, 50, 0][i % 3], lid: lt < 0.06 ? 1 : 0 });
  }

  function sceneEvery(x, t) {
    backdrop(x, t);
    const st = t - 23.0;
    const lines = [['link.'], ['invite.'], ['image.']];
    lines.forEach((l, i) => words(x, [{ t: 'Every' }, { t: l[0], c: C.frog }], 190, 330 + i * 175, 160, st, { start: i * 0.26, stagger: 0.07, out: 1.75 }));
    words(x, [{ t: 'Checked' }, { t: 'in' }, { t: '0.2s.', c: C.tongue }], 196, 900, 84, st, { start: 0.95, out: 1.78 });
    const slide = eOut5(seg(st, 0.15, 0.6)) - eIn3(seg(st, 1.7, 1.95));
    frog(x, lerp(2300, 1640, slide), 600, 0.62, { pupil: -55, look: 10, lid: st > 1.2 && st < 1.3 ? 1 : 0, rot: -0.08 });
  }

  function sceneEnd(x, t, f) {
    backdrop(x, t);
    const st = t - 25.0;
    const glow = 0.5 + 0.12 * Math.sin(st * 2.4);
    const g = x.createRadialGradient(640, 470, 0, 640, 470, 520);
    g.addColorStop(0, `rgba(143,224,78,${0.22 * glow * seg(st, 0, 0.6)})`);
    g.addColorStop(1, 'rgba(143,224,78,0)');
    x.fillStyle = g;
    x.fillRect(0, 0, W, H);
    // lockup: mark + wordmark
    setFont(x, 800, 236, BRIC, -236 * 0.04);
    const tw = x.measureText('Croak').width;
    const ms = 0.38, mw = 800 * ms, gap = 46;
    const total = mw + gap + tw, X0 = W / 2 - total / 2;
    const mcx = X0 + mw / 2, mcy = 452;
    const pop = eBack(seg(st, 0.05, 0.55), 2.2);
    const lid = st < 0.55 ? 1 : st < 0.8 ? 1 - eOut3(seg(st, 0.55, 0.8)) : (st > 3.0 && st < 3.16) ? 1 : 0;
    let pupil = st < 0.9 ? 0 : lerp(0, -50, eBack(seg(st, 0.9, 1.15), 2.5));
    if (st > 3.9 && st < 4.4) pupil = lerp(-50, 0, eOut3(seg(st, 3.9, 4.0))) * (1 - seg(st, 4.3, 4.4)) + -50 * seg(st, 4.3, 4.4);
    const [mx, my] = mouthOf(mcx, mcy, ms * pop);
    const flick = reach(st - 3.45, 0.08, 0.05, 0.16);
    tongue(x, mx, my, mx + 130, my + 90, flick, 16);
    if (pop > 0.01) frog(x, mcx, mcy, ms * pop, { lid, pupil, rot: (1 - pop) * -0.4 });
    // wordmark letters
    const letters = 'Croak'.split('');
    let lx = X0 + mw + gap;
    setFont(x, 800, 236, BRIC, -236 * 0.04);
    letters.forEach((ch, i) => {
      const w = x.measureText(ch).width;
      const p = eOut5(seg(st, 0.35 + i * 0.05, 0.75 + i * 0.05));
      x.save();
      x.beginPath();
      x.rect(lx - 20, 260, w + 40, 300);
      x.clip();
      x.fillStyle = C.lily;
      x.textAlign = 'left';
      x.fillText(ch, lx, 535 + (1 - p) * 260);
      x.restore();
      lx += w;
    });
    words(x, [{ t: 'Spam' }, { t: 'croaks', c: C.frog }, { t: 'here.' }], W / 2, 690, 76, st, { start: 0.95, align: 'center', weight: 700, ls: -0.02 });
    // CTA
    const cp = eBack(seg(st, 1.4, 1.75), 2);
    if (cp > 0.001) {
      x.save();
      x.translate(W / 2, 820);
      x.scale(cp, cp);
      setFont(x, 800, 40, BRIC, -0.5);
      const label = 'Add Croak to Discord';
      const lw = x.measureText(label).width;
      const bw = lw + 120, bh = 92;
      x.shadowColor = 'rgba(143,224,78,0.45)';
      x.shadowBlur = 40 * px();
      x.fillStyle = C.frog;
      rrect(x, -bw / 2, -bh / 2, bw, bh, bh / 2);
      x.fill();
      x.shadowBlur = 0;
      x.fillStyle = C.pond;
      x.textAlign = 'center';
      x.textBaseline = 'middle';
      x.fillText(label, -14, 3);
      x.lineWidth = 6;
      x.lineCap = 'round';
      x.strokeStyle = C.pond;
      const ax = lw / 2 + 18 + Math.sin(st * 6) * 3;
      x.beginPath(); x.moveTo(ax - 4, -12); x.lineTo(ax + 10, 1); x.lineTo(ax - 4, 14); x.stroke();
      x.restore();
    }
    typed(x, 'croakbot.base44.app', W / 2 - 205, 935, 34, st, { start: 1.8, cps: 30, color: C.mist, caret: st < 3.2 });
  }

  // ---------- frame ----------
  function overlays(x, S) {
    const t = S.t;
    hud(x, t);
    for (const [ct, col] of CUTS) {
      const d = t - ct;
      if (d < 0 || d > 0.18) continue;
      x.save();
      x.globalAlpha = 0.55 * (1 - eOut3(d / 0.18));
      x.fillStyle = col;
      x.fillRect(0, 0, W, H);
      x.restore();
    }
    vignette(x, 0.55);
    grain(x, S.f, 0.075);
    // fade in from black, and out on the last frames
    const fi = 1 - seg(t, 0, 0.25);
    if (fi > 0) { x.fillStyle = `rgba(0,0,0,${fi})`; x.fillRect(0, 0, W, H); }
  }
  function draw(S, p, x) {
    const t = S.t;
    x.save();
    switch (p.scene) {
      case 'open': sceneOpen(x, t, S.f); break;
      case 'img': sceneImg(x, S, t); break;
      case 'mont': sceneMont(x, S, t, p.key); break;
      case 'qr': sceneQr(x, S, t); break;
      case 'dm': sceneDm(x, S, t); break;
      case 'feat': sceneFeat(x, t, S.f); break;
      case 'every': sceneEvery(x, t); break;
      case 'end': sceneEnd(x, t, S.f); break;
    }
    x.restore();
    x.save();
    overlays(x, S);
    x.restore();
  }
  RRC.register('LAYERS', 'croak', { phase: 'final', order: 999, draw(S, p, x) { if (S.kind === 'special') return; draw(S, p, x); } });
  RRC.register('SPECIALS', 'scene', { allow: [], draw(S, p, x) { draw(S, p, x); } });
})();
