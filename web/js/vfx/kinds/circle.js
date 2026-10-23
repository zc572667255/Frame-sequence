import { createCanvas } from "../../core/util.js";
import { rng, rgba, smooth, drawBlurred } from "../../trails/glow/util.js";
import { star, rockShape } from "../../trails/glow/shapes.js";
import { TAU, easeOut, frac, mixRgb, at, blob, ring, jag, bolt, trail, comet } from "../common.js";

// 魔法阵: rings, a band of runes, ticks and a star, drawn straight onto the
// ground in perspective (paths laid down first, then stroked, so lines keep
// their width and stay smooth however flat it lies), every line a bright
// thread over a soft glow; highlights race round the rings. The outer parts
// turn one way, the star the other. A loop turns exactly one symmetry step,
// so it closes; a one-shot draws itself on and fades away. 太极八卦 (pattern
// "taiji"): the eight trigrams round the band instead of runes, an octagon
// instead of the star, and in the middle a 太极 turning — a whole turn per
// loop (the trigrams, all different, stay put in a loop).
export function circle(g, c) {
  const { t, R, pal } = c;
  const reveal = c.loop ? 1 : easeOut(t / 0.35, 2);
  const env = c.loop ? 1 : 1 - smooth(0.78, 1, t);
  const lw = Math.max(0.8, R * 0.022);
  // 侧面: the circle stands upright, seen edge-on — a portal: narrowed
  // sideways instead of laid flat (lines keep their width, motes stay round)
  const side = c.view === "side", kx = side ? 0.32 : 1;
  const k = side ? 1 : c.squash, ox = c.cx, oy = side ? c.cy : c.gy;
  // a loop turns each part by exactly one of its symmetry steps, so the last
  // frame leads back into the first: the runes alternate two glyphs (a step
  // of two runes), the star by its own symmetry
  const taiji = c.pattern === "taiji";
  const sym = c.pattern === "penta" ? 5 : c.pattern === "square" ? 8 : 6;
  const rotOut = taiji && c.loop ? 0 : TAU / 6 * t * (c.loop ? 1 : 0.75), rotIn = -TAU / sym * t * (c.loop ? 1 : 1.5);
  const lay = createCanvas(c.w, c.h), L = lay.getContext("2d");
  L.lineCap = "round"; L.lineJoin = "round";
  // a point drawn flat at (x, y), turned by rot, laid on the ground
  const to = (x, y, rot = 0) => {
    const cs = Math.cos(rot), sn = Math.sin(rot);
    return [ox + (x * cs - y * sn) * kx, oy + (x * sn + y * cs) * k];
  };
  const poly = (pts, rot) => pts.forEach(([x, y], i) => { const [X, Y] = to(x, y, rot); if (i) L.lineTo(X, Y); else L.moveTo(X, Y); });
  const circ = (r) => {
    const n = Math.max(8, Math.ceil(120 * reveal));
    poly(Array.from({ length: n + 1 }, (_, i) => { const a = -Math.PI / 2 + TAU * reveal * i / n; return [Math.cos(a) * r, Math.sin(a) * r]; }));
  };
  // one group of lines: a soft glow under a bright thread
  const ink = (build, col, wd, a = 1) => {
    L.beginPath(); build();
    L.strokeStyle = rgba(pal.rim, 0.22 * a); L.lineWidth = wd * 3.4; L.stroke();
    L.strokeStyle = rgba(col, a); L.lineWidth = wd; L.stroke();
  };
  // the main rings in the bright core colour, the finer work in the rim colour
  ink(() => { circ(R * 0.98); circ(R * 0.9); }, pal.core, lw);
  const P = rng(c.seed * 37 + 9);
  if (taiji) {
    bagua(L, ink, poly, c, R, lw, rotOut, reveal, t);
  } else {
  // runes: 12 glyphs between the outer rings, each a few seeded strokes
  const glyphs = Array.from({ length: 12 }, () => Array.from({ length: 2 + Math.floor(P() * 3) }, () => [P(), P(), P(), P()]));
  const band = R * 0.075 * 1.6, shown = Math.floor(12 * reveal + 1e-6);
  ink(() => {
    for (let n = 0; n < shown; n++) {
      for (const [a, b, cc, d] of glyphs[c.loop ? n % 2 : n]) poly([[(a - 0.5) * band, (b - 0.5) * band - R * 0.82], [(cc - 0.5) * band, (d - 0.5) * band - R * 0.82]], rotOut + n * TAU / 12);
    }
  }, pal.rim, lw * 0.8);
  // ticks
  ink(() => {
    for (let n = 0; n < 48 * reveal; n++) poly([[0, -R * 0.72], [0, -R * (n % 4 ? 0.69 : 0.66)]], rotOut + n * TAU / 48);
  }, pal.rim, lw * 0.7);
  ink(() => { circ(R * 0.72); circ(R * 0.34); }, pal.rim, lw);
  // the star
  const r = R * 0.68;
  const figure = (n, step, off) => poly(Array.from({ length: n + 1 }, (_, i) => { const a = off + (i * step % n) * TAU / n - Math.PI / 2; return [Math.cos(a) * r, Math.sin(a) * r]; }), rotIn);
  ink(() => {
    if (c.pattern === "penta") figure(5, 2, 0);
    else if (c.pattern === "square") { figure(4, 1, 0); figure(4, 1, Math.PI / 4); }
    else { figure(3, 1, 0); figure(3, 1, Math.PI / 3); }
  }, pal.rim, lw, smooth(0.2, 0.9, reveal));
  ink(() => circ(R * 0.12), pal.core, lw);
  }
  // lay it on the ground, glow it
  g.globalCompositeOperation = "lighter";
  // a faint light pooled on the ground under it, and in the band of runes
  // (高清 only: in pixels it would fill the circle with a solid plate)
  if (!c.pixel) {
    g.save(); g.translate(ox, oy); g.scale(kx, k);
    blob(g, 0, 0, R, [[0, pal.rim, 0.12 * env * reveal], [0.85, pal.rim, 0.07 * env * reveal], [1, pal.rim, 0]]);
    g.restore();
    ring(g, ox, oy, R * 0.94, R * 0.05, k, pal.rim, 0.18 * env * reveal, kx);
  }
  g.globalAlpha = Math.min(1, env * (c.pixel ? 0.35 : 0.9) * c.glow);
  drawBlurred(g, [lay], Math.max(2, R * 0.06));
  g.globalAlpha = env;
  g.drawImage(lay, 0, 0);
  g.globalAlpha = 1;
  // highlights racing round the rings (whole turns per loop)
  const lit = env * smooth(0.6, 1, reveal);
  for (const [rad, dir, turns] of [[R * 0.94, 1, 1], [R * 0.72, -1, 1], [R * (taiji ? 0.5 : 0.34), 1, 2]]) {
    for (let j = 0; j < 2; j++) {
      const head = -Math.PI / 2 + dir * (TAU * turns * t + j * Math.PI), pts = [];
      for (let i = 0; i <= 24; i++) { const a = head - dir * 1.3 * (1 - i / 24); pts.push(to(Math.cos(a) * rad, Math.sin(a) * rad)); }
      trail(g, pal, pts, lw * 1.3, lit, true);
    }
  }
  // motes rising off it, swaying, trailing light (whole cycles per loop,
  // so the loop closes)
  const M = Math.round(14 * c.amount);
  for (let i = 0; i < M; i++) {
    const th = P() * TAU, rr = Math.sqrt(P()) * R * 0.9, ph = P(), sp = 1 + Math.floor(P() * 2);
    const p = frac(ph + t * sp), a = Math.sin(Math.PI * p) * env * reveal;
    const at = (q) => [ox + Math.cos(th) * rr * kx + R * 0.06 * Math.sin(TAU * q * 1.5 + th), oy + Math.sin(th) * rr * k - R * 0.9 * q];
    comet(g, pal, at, p, 0.22, Math.max(0.6, R * 0.014) * (c.pixel ? 1.8 : 1), a);
  }
  // the element of the palette (or the one asked for) round the rim
  const el = c.edge === "auto" ? pal.element : c.edge;
  if (el && el !== "none") circleEdge(g, c, el, (th, r) => to(Math.cos(th) * r, Math.sin(th) * r), env * reveal);
}

// The 太极八卦 inside the outer rings (drawn into the circle's own lines with
// ink and poly, flat coordinates turned and laid on the ground): the eight
// trigrams of 先天八卦 round the band — 乾 at the top, then clockwise 巽 坎 艮
// 坤 震 离 兑, each three bars (solid 阳, broken 阴), the bottom line innermost
// — an octagon and a ring inside them, and the 太极 in the middle, one half lit,
// the dot in each half the other way round.
const TRIGRAMS = [[1, 1, 1], [0, 1, 1], [0, 1, 0], [0, 0, 1], [0, 0, 0], [1, 0, 0], [1, 0, 1], [1, 1, 0]];
function bagua(L, ink, poly, c, R, lw, rotOut, reveal, t) {
  const { pal } = c, TAU2 = Math.PI * 2;
  const arc = (cx, cy, r, a0, a1, n = 40) => Array.from({ length: n + 1 }, (_, i) => { const a = a0 + (a1 - a0) * i / n; return [cx + Math.cos(a) * r, cy + Math.sin(a) * r]; });
  const ring = (r) => poly(arc(0, 0, r, -Math.PI / 2, -Math.PI / 2 + TAU2 * reveal, Math.max(8, Math.ceil(120 * reveal))), 0);
  // the trigrams: bars across the band, the first line (the bottom one) innermost
  const hl = R * 0.105, gap = hl * 0.32, shown = Math.floor(8 * reveal + 1e-6);
  ink(() => {
    for (let n = 0; n < shown; n++) {
      TRIGRAMS[n].forEach((yang, k) => {
        const y = -R * (0.762 + 0.048 * k);
        if (yang) poly([[-hl, y], [hl, y]], rotOut + n * TAU2 / 8);
        else { poly([[-hl, y], [-gap, y]], rotOut + n * TAU2 / 8); poly([[gap, y], [hl, y]], rotOut + n * TAU2 / 8); }
      });
    }
  }, pal.core, lw * 1.05);
  // the ring under them, an octagon, the 太极's own ring
  ink(() => {
    ring(R * 0.72);
    poly(Array.from({ length: 9 }, (_, i) => { const a = -Math.PI / 2 + Math.PI / 8 + i * TAU2 / 8; return [Math.cos(a) * R * 0.66, Math.sin(a) * R * 0.66]; }), rotOut);
    ring(R * 0.5);
  }, pal.rim, lw);
  // the 太极: turning (a whole turn per loop), the lit half filled, its outline
  const rt = R * 0.46, rotT = -TAU2 * t * (c.loop ? 1 : 0.6), a = Math.min(1, reveal * 1.5);
  if (a <= 0.01) return;
  const lit = [...arc(0, 0, rt, -Math.PI / 2, Math.PI / 2), ...arc(0, rt / 2, rt / 2, Math.PI / 2, -Math.PI / 2), ...arc(0, -rt / 2, rt / 2, Math.PI / 2, Math.PI * 1.5)];
  L.save();
  L.beginPath(); poly(lit, rotT); L.closePath();
  L.fillStyle = rgba(pal.core, 0.55 * a); L.fill();
  // the dark dot in the lit half, the lit dot in the dark half
  L.globalCompositeOperation = "destination-out";
  L.beginPath(); poly(arc(0, -rt / 2, rt * 0.13, 0, TAU2, 24), rotT); L.closePath(); L.fill();
  L.globalCompositeOperation = "source-over";
  L.beginPath(); poly(arc(0, rt / 2, rt * 0.13, 0, TAU2, 24), rotT); L.closePath(); L.fillStyle = rgba(pal.core, 0.55 * a); L.fill();
  L.restore();
  ink(() => {
    poly(arc(0, 0, rt, 0, TAU2, 96), rotT);
    // the S between the halves: round the upper small circle's left, the lower one's right
    poly([...arc(0, -rt / 2, rt / 2, -Math.PI / 2, -Math.PI * 1.5, 30), ...arc(0, rt / 2, rt / 2, -Math.PI / 2, Math.PI / 2, 30)], rotT);
    poly(arc(0, -rt / 2, rt * 0.13, 0, TAU2, 24), rotT);
    poly(arc(0, rt / 2, rt * 0.13, 0, TAU2, 24), rotT);
  }, pal.core, lw, a);
}

// a tongue of flame standing at (x, y): a curved point up to height h leaning
// by sway, hot at the root and fading toward the tip, a brighter core inside
function tongue(g, pal, x, y, wb, h, sway, a) {
  if (a <= 0.01 || h <= 1) return;
  for (const [k, kh, col0, col1, ka] of [[1, 1, pal.rim, pal.cols[1] || pal.rim, 0.75], [0.45, 0.6, pal.core, pal.rim, 1]]) {
    const w = wb * k, H = h * kh, tx = x + sway * kh, ty = y - H;
    const gr = g.createLinearGradient(x, y, tx, ty);
    gr.addColorStop(0, rgba(col0, a * ka));
    gr.addColorStop(0.55, rgba(col1, a * ka * 0.6));
    gr.addColorStop(1, rgba(col1, 0));
    g.fillStyle = gr;
    g.beginPath(); g.moveTo(x - w, y);
    g.quadraticCurveTo(x - w * 0.5 + sway * 0.25, y - H * 0.6, tx, ty);
    g.quadraticCurveTo(x + w * 0.6 + sway * 0.5, y - H * 0.45, x + w, y);
    g.closePath(); g.fill();
  }
}

// 魔法阵 edges: the circle's element playing round its rim. place(th, r) is a
// point on the circle's own plane (angle th, radius r) on the screen — it
// follows the ground's perspective and the side view — and "up" is up the
// screen. Everything moves in whole cycles per loop, so a loop closes; the
// lightning is new every frame. a: strength (the circle's own fade).
function circleEdge(g, c, el, place, a) {
  if (a <= 0.01) return;
  const { t, R, pal } = c, amt = Math.max(0.2, c.amount), P = rng(c.seed * 131 + 17);
  const px = c.pixel ? 1.7 : 1, cyc = (ph, sp) => frac(ph + t * sp);
  g.globalCompositeOperation = "lighter";
  if (el === "fire") {
    // tongues of flame standing round the rim, each flickering and swaying
    const n = Math.round(24 * amt);
    for (let i = 0; i < n; i++) {
      const th = (i + P() * 0.6) / n * TAU, j = P(), ph = P(), sp = 1 + Math.floor(P() * 3), ph2 = P();
      const [bx, by] = place(th, R * 0.97), fl = 0.7 + 0.3 * Math.sin(TAU * (t * sp + ph));
      const sway = R * 0.05 * Math.sin(TAU * (t * (1 + sp % 2) + ph2));
      tongue(g, pal, bx, by, R * (0.055 + 0.05 * j), R * (0.22 + 0.3 * j) * fl, sway, a * (0.6 + 0.4 * fl));
    }
    // embers drifting up off it
    for (let i = 0; i < Math.round(14 * amt); i++) {
      const th = P() * TAU, ph = P(), sp = 1 + Math.floor(P() * 2), sw = P() * TAU;
      const [bx, by] = place(th, R * 0.97), p = cyc(ph, sp);
      const at = (q) => [bx + R * 0.08 * Math.sin(sw + q * TAU), by - R * (0.1 + 0.7 * q)];
      comet(g, pal, at, p, 0.15, Math.max(0.6, R * 0.012) * px, a * Math.sin(Math.PI * p));
    }
  } else if (el === "earth") {
    // a ring of rocks lifted off the ground, bobbing and slowly turning, each
    // over its shadow; grit hopping up off the rim and falling back
    g.globalCompositeOperation = "source-over";
    const cols = pal.cols.length >= 4 ? pal.cols : [...pal.cols, pal.rim, pal.core].slice(0, 4);
    const rocks = [];
    for (let i = 0, n = Math.round(13 * amt); i < n; i++) {
      const th = (i + P() * 0.5) / n * TAU, j = P(), ph = P(), spin = P() * TAU, dir = P() < 0.5 ? -1 : 1, sd = Math.floor(P() * 1e6);
      const [bx, by] = place(th, R * (0.98 + 0.08 * P()));
      const lift = R * (0.14 + 0.22 * j + 0.06 * Math.sin(TAU * (t + ph))) * a;
      rocks.push([by, () => {
        blob(g, bx, by, R * 0.06 * (0.6 + j), [[0, [0, 0, 0], 0.35 * a], [1, [0, 0, 0], 0]]);
        rockShape(g, [bx, by - lift], Math.max(2, R * (0.05 + 0.065 * j)), spin + dir * TAU * t, rng(sd), cols, a);
      }]);
    }
    rocks.sort((p, q) => p[0] - q[0]).forEach(([, draw]) => draw());   // the far ones first
    for (let i = 0; i < Math.round(16 * amt); i++) {
      const th = P() * TAU, ph = P(), sp = 1 + Math.floor(P() * 2), hgt = R * (0.08 + 0.15 * P()), out = (P() - 0.3) * R * 0.15, sz = Math.max(1, R * 0.012 * (1 + P()));
      const p = cyc(ph, sp), [bx, by] = place(th, R * 0.98);
      g.fillStyle = rgba(cols[1], a * Math.sin(Math.PI * p));
      g.fillRect(bx + out * p - sz / 2, by - hgt * Math.sin(Math.PI * p) - sz / 2, sz, sz);
    }
  } else if (el === "wind") {
    // bands of wind spiralling up round the circle, drawing in as they rise
    for (let i = 0, n = Math.max(3, Math.round(5 * amt)); i < n; i++) {
      const q = cyc(i / n + P() * 0.1, 1), spin = TAU * (t * 2 + P()), span = 1.6 + P() * 1.2, w = Math.max(0.8, R * 0.02) * px;
      const pts = [];
      for (let s = 0; s <= 24; s++) {
        const [x, y] = place(spin + span * s / 24, R * (1.05 - 0.3 * q));
        pts.push([x, y - R * (0.05 + 0.7 * q)]);
      }
      trail(g, pal, pts, w * 3, a * 0.25 * Math.sin(Math.PI * q), false);
      trail(g, pal, pts, w, a * Math.sin(Math.PI * q), false);
    }
    // gusts: quick streaks skimming round the rim
    for (let i = 0; i < Math.round(10 * amt); i++) {
      const th0 = P() * TAU, ph = P(), sp = 2 + Math.floor(P() * 2), r = R * (1 + 0.15 * P()), up = R * 0.3 * P();
      const p = cyc(ph, sp), at = (q) => { const [x, y] = place(th0 + q * 1.4, r); return [x, y - up]; };
      comet(g, pal, at, p, 0.35, Math.max(0.5, R * 0.01) * px, a * 0.8 * Math.sin(Math.PI * p));
    }
  } else if (el === "water") {
    // a wave running round the rim — crests travelling round, a bright line
    // along the top — ripples spreading on the ground, drops leaping off it
    const M = 72, base = [], crest = [];
    for (let i = 0; i <= M; i++) {
      const th = i / M * TAU, hgt = R * 0.06 * (1.2 + Math.sin(th * 5 - TAU * t * 2) + 0.4 * Math.sin(th * 9 + TAU * t * 3));
      const [x, y] = place(th, R * 0.99);
      base.push([x, y]); crest.push([x, y - Math.max(0, hgt) * a]);
    }
    const water = mixRgb(pal.rim, pal.cols[1] || pal.rim, 0.4);
    // the band between the ground and the crest: the crest round one way, the
    // ground back the other, so only what lies between them fills
    g.fillStyle = rgba(water, 0.3 * a);
    g.beginPath();
    crest.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
    for (let i = M; i >= 0; i--) g.lineTo(base[i][0], base[i][1]);
    g.closePath(); g.fill();
    g.strokeStyle = rgba(pal.core, 0.8 * a); g.lineWidth = Math.max(0.8, R * 0.012) * px; g.lineJoin = "round";
    g.beginPath(); crest.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.stroke();
    for (let i = 0; i < 2; i++) {
      const q = cyc(i / 2, 1);
      g.strokeStyle = rgba(pal.rim, 0.5 * a * (1 - q)); g.lineWidth = Math.max(0.7, R * 0.012) * px;
      g.beginPath();
      for (let s = 0; s <= M; s++) { const [x, y] = place(s / M * TAU, R * (1.02 + 0.32 * q)); if (s) g.lineTo(x, y); else g.moveTo(x, y); }
      g.stroke();
    }
    for (let i = 0; i < Math.round(14 * amt); i++) {
      const th = P() * TAU, ph = P(), sp = 1 + Math.floor(P() * 2), hgt = R * (0.12 + 0.2 * P()), out = 0.1 + 0.2 * P();
      const p = cyc(ph, sp), at = (q) => { const [x, y] = place(th, R * (0.99 + out * q)); return [x, y - hgt * Math.sin(Math.PI * q)]; };
      comet(g, pal, at, p, 0.25, Math.max(0.6, R * 0.013) * px, a * Math.sin(Math.PI * p));
    }
  } else if (el === "bolt") {
    // arcs jumping along the rim and a bolt or two leaping up off it, new
    // every frame (the frame number within the sequence, so a loop closes)
    const B = rng(c.seed * 151 + (c.i % c.n) * 7919);
    for (let k = 0; k < Math.round(4 * amt); k++) {
      const th = B() * TAU, span = 0.35 + 0.6 * B(), pts = [];
      for (let s = 0; s <= 6; s++) {
        const [x, y] = place(th + span * s / 6, R * (0.97 + 0.06 * (B() - 0.5)));
        pts.push([x, y - R * 0.12 * Math.sin(Math.PI * s / 6)]);
      }
      bolt(g, pal, jag(pts, B, R * 0.035), Math.max(0.7, R * 0.012) * px, a);
    }
    for (let k = 0; k < Math.round(2 * amt); k++) {
      if (B() < 0.4) continue;
      const [x, y] = place(B() * TAU, R * 0.97), hgt = R * (0.3 + 0.4 * B());
      bolt(g, pal, jag([[x, y], [x + (B() - 0.5) * R * 0.2, y - hgt]], B, R * 0.05), Math.max(0.6, R * 0.009) * px, a * 0.85);
    }
  }
}
