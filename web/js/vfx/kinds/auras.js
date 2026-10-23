import { rng, rgba, smooth, drawBlurred } from "../../trails/glow/util.js";
import { createCanvas } from "../../core/util.js";
import { TAU, easeOut, frac, mixRgb, blob, ring, spike, trail, comet, field, fieldScale, loopNoise } from "../common.js";

// 魔法阵's ground auras (法阵图案), in the palette's colours, laid on the
// ground in perspective like the circle (or stood up, 侧面):
//   burst    能量爆发 — clouds of energy rolling out over the ground from the
//            middle, brightest part way out
//   holy     圣光光环 — a soft ring with a band of runes turning in it
//   whirl    旋风光环 — three streaks of light chasing round the ring
//   stars    星辉光环 — four-pointed stars twinkling on the ground and rising
//   wisp     幽魂光环 — a band of churning smoke, wisps swaying up off it
//   arrows   箭阵光环 — rows of arrowheads pulsing outward
// Everything turns or cycles a whole step per loop, so a loop closes; a
// one-shot spreads out from the middle and fades away at the end.
export const GROUND_AURAS = [["burst", "能量爆发"], ["holy", "圣光光环"], ["whirl", "旋风光环"], ["stars", "星辉光环"], ["wisp", "幽魂光环"], ["arrows", "箭阵光环"]];
const IDS = new Set(GROUND_AURAS.map(([id]) => id));
export const isGroundAura = (pattern) => IDS.has(pattern);

export function groundAura(g, c) {
  const { t, R, pal } = c;
  const reveal = c.loop ? 1 : easeOut(t / 0.3, 2);
  const env = c.loop ? 1 : 1 - smooth(0.75, 1, t);
  // 侧面: stood up, turned away by 地面倾斜 (narrowed sideways)
  const side = c.view === "side", kx = side ? c.squash : 1;
  const k = side ? 1 : c.squash, ox = c.cx, oy = side ? c.cy : c.gy;
  // a flat point (x, y) round the centre, turned by rot, on the ground
  const to = (x, y, rot = 0) => {
    const cs = Math.cos(rot), sn = Math.sin(rot);
    return [ox + (x * cs - y * sn) * kx, oy + (x * sn + y * cs) * k];
  };
  const lw = Math.max(0.8, R * 0.02), px = c.pixel ? 1.7 : 1;
  const P = rng(c.seed * 53 + 11);
  const a = env * reveal;
  // lines laid on the ground into their own layer, then given a glow
  const lay = createCanvas(c.w, c.h), L = lay.getContext("2d");
  L.lineCap = "round"; L.lineJoin = "round";
  const poly = (pts, rot = 0, close = false) => {
    pts.forEach(([x, y], i) => { const [X, Y] = to(x, y, rot); if (i) L.lineTo(X, Y); else L.moveTo(X, Y); });
    if (close) L.closePath();
  };
  const ink = (build, col, wd, al = 1) => {
    L.beginPath(); build();
    L.strokeStyle = rgba(pal.rim, 0.25 * al); L.lineWidth = wd * 3.4; L.stroke();
    L.strokeStyle = rgba(col, al); L.lineWidth = wd; L.stroke();
  };
  const circ = (r, n = 96) => poly(Array.from({ length: n + 1 }, (_, i) => { const q = i / n * TAU; return [Math.cos(q) * r, Math.sin(q) * r]; }));
  const glowRing = (r, wd, col, al) => ring(g, ox, oy, r, wd, k, col, al, kx);
  const pool = (r, al) => {
    if (c.pixel) return;
    g.save(); g.translate(ox, oy); g.scale(kx, k);
    blob(g, 0, 0, r, [[0, pal.rim, al], [0.75, pal.rim, al * 0.5], [1, pal.rim, 0]]);
    g.restore();
  };
  // motes rising off the ground inside radius rr, swaying (whole cycles per loop)
  const motes = (n, rr, rise, wd = 1) => {
    for (let i = 0; i < n; i++) {
      const th = P() * TAU, r = Math.sqrt(P()) * rr, ph = P(), sp = 1 + Math.floor(P() * 2), sw = P() * TAU;
      const p = frac(ph + t * sp), al = Math.sin(Math.PI * p) * a;
      const [bx, by] = to(Math.cos(th) * r, Math.sin(th) * r);
      comet(g, pal, (q) => [bx + R * 0.05 * Math.sin(sw + q * TAU), by - rise * q], p, 0.25, Math.max(0.6, R * 0.013 * wd) * px, al);
    }
  };
  g.globalCompositeOperation = "lighter";
  const kind = c.pattern;
  if (kind === "burst") burst();
  else if (kind === "holy") holy();
  else if (kind === "whirl") whirl();
  else if (kind === "stars") stars();
  else if (kind === "wisp") wisp();
  else arrows();
  // the lines with their bloom
  g.globalCompositeOperation = "lighter";
  g.globalAlpha = Math.min(1, env * (c.pixel ? 0.35 : 0.9) * c.glow);
  drawBlurred(g, [lay], Math.max(2, R * 0.05));
  g.globalAlpha = env;
  g.drawImage(lay, 0, 0);
  g.globalAlpha = 1;

  // ---- 能量爆发 ----
  // Clouds of energy rolling out over the ground from the middle: each puff
  // rises small and hot near the centre, swells as it rolls out, cools to the
  // deep colour and thins away, and another follows (whole cycles per loop; a
  // one-shot sends them all out at once). Billowed by noise, coloured by heat.
  function burst() {
    const C = rng(c.seed * 89 + 7), puffs = [];
    const M = Math.round(44 * Math.max(0.4, c.amount));
    for (let i = 0; i < M; i++) {
      const th = (i + C() * 0.8) / M * TAU, ph = C(), sp = 1 + Math.floor(C() * 2), far = 0.72 + 0.32 * C(), sz = 0.7 + 0.6 * C();
      const p = c.loop ? frac(ph + t * sp) : Math.max(0, Math.min(1, (t - ph * 0.25) / 0.75));
      // faint as it leaves the middle, brightest part way out, thinning away
      const s = smooth(0.04, 0.32, p) * (1 - smooth(0.6, 1, p)) * (c.loop ? 1 : 1 - smooth(0.8, 1, t));
      if (s <= 0.01) continue;
      const r = R * far * (0.06 + 0.94 * easeOut(p, 1.7)), rb = R * (0.16 + 0.3 * p) * sz;
      const [x, y] = to(Math.cos(th) * r, Math.sin(th) * r);
      // hugging the ground (flatter the flatter it lies), heaped up a little
      const rx = rb * (side ? Math.max(0.5, kx) : 1), ry = rb * (side ? 1 : Math.max(0.5, k));
      puffs.push({ x, y: y - ry * 0.3, rx, ry, s, heat: smooth(0.12, 0.35, p) * (1 - smooth(0.45, 0.95, p)) });
    }
    if (puffs.length) {
      let x0 = c.w, y0 = c.h, x1 = 0, y1 = 0;
      for (const q of puffs) { x0 = Math.min(x0, q.x - q.rx); x1 = Math.max(x1, q.x + q.rx); y0 = Math.min(y0, q.y - q.ry); y1 = Math.max(y1, q.y + q.ry); }
      x0 = Math.max(0, Math.floor(x0)); y0 = Math.max(0, Math.floor(y0)); x1 = Math.min(c.w, Math.ceil(x1)); y1 = Math.min(c.h, Math.ceil(y1));
      // fine billows, and streaks stretched along the radius flowing outward
      // (the angle wraps: two samples a turn apart, blended, so there's no seam)
      const N = loopNoise(c, 23, 3.2 / R, 1, 2), Ns = loopNoise(c, 29, 1, 1, -2.5);
      const deep = mixRgb(pal.rim, pal.cols[0] || pal.rim, 0.6);
      const cloud = createCanvas(c.w, c.h);
      field(cloud.getContext("2d"), x0, y0, x1, y1, fieldScale(c, R), (x, y, out) => {
        let D = 0, H = 0;
        for (const q of puffs) {
          const dx = (x - q.x) / q.rx, dy = (y - q.y) / q.ry, d2 = dx * dx + dy * dy;
          if (d2 >= 1) continue;
          const f = (1 - d2) * (1 - d2) * q.s;
          D += f; if (f * q.heat > H) H = f * q.heat;
        }
        if (D <= 0.003) return false;
        const u = (x - ox) / kx / R, w = (y - oy) / k / R, r = Math.hypot(u, w), ang = Math.atan2(w, u), m = (ang + Math.PI) / TAU;
        const ns = Ns(ang * 5, r * 3) * (1 - m) + Ns((ang - TAU) * 5, r * 3) * m;
        const dens = (1 - Math.exp(-D * 1.3)) * (0.3 + 1.15 * ns) + (N(x, y) - 0.5) * 0.3;
        if (dens <= 0.04) return false;
        // mostly the rim colour, white only where it is thickest and hottest
        const light = Math.max(0, Math.min(1, H * 0.95 + (ns - 0.5) * 0.6 + dens * 0.15));
        const col = light < 0.7 ? mixRgb(deep, pal.rim, light / 0.7) : mixRgb(pal.rim, pal.core, (light - 0.7) / 0.3);
        out[0] = col[0]; out[1] = col[1]; out[2] = col[2]; out[3] = smooth(0.04, 0.8, dens) * 0.8 * env;
      });
      // a haze round it, then the mist itself
      g.globalAlpha = Math.min(1, 0.7 * c.glow);
      drawBlurred(g, [cloud], Math.max(2, R * 0.07));
      g.globalAlpha = 1;
      g.drawImage(cloud, 0, 0);
    }
    pool(R * 0.95, 0.08 * a);
    motes(Math.round(10 * c.amount), R * 0.9, R * 0.8);
  }

  // ---- 圣光光环 ----
  function holy() {
    pool(R * 0.9, 0.14 * a);
    glowRing(R * 0.86, R * 0.13, pal.rim, 0.45 * a);
    glowRing(R * 0.86, R * 0.04, pal.core, 0.6 * a);
    // a band of runes turning: 16 glyphs, two alternating, a two-glyph step per loop
    const G = rng(c.seed * 37 + 9), glyphs = [0, 1].map(() => Array.from({ length: 3 }, () => [G(), G(), G(), G()]));
    const band = R * 0.13, rot = TAU / 8 * t * (c.loop ? 1 : 0.6);
    ink(() => {
      for (let n = 0; n < 16; n++) for (const [p, q, r, s] of glyphs[n % 2]) poly([[(p - 0.5) * band, (q - 0.5) * band - R * 0.86], [(r - 0.5) * band, (s - 0.5) * band - R * 0.86]], rot + n * TAU / 16);
    }, pal.core, lw * 0.7, a);
    ink(() => { circ(R * 0.98); circ(R * 0.74); }, pal.rim, lw * 0.7, a);
    // the whole ring breathes: twice per loop
    glowRing(R * 0.5, R * 0.45, pal.rim, (0.08 + 0.06 * Math.sin(TAU * t * 2)) * a);
    motes(Math.round(12 * c.amount), R * 0.85, R * 1.1, 0.8);
  }

  // ---- 旋风光环 ----
  function whirl() {
    pool(R * 0.85, 0.1 * a);
    glowRing(R * 0.8, R * 0.2, pal.rim, 0.22 * a);
    // three streaks chasing round: each a third of a turn per loop
    for (let j = 0; j < 3; j++) {
      for (const [rr, span, wd, al] of [[0.84, 2.3, 2.6, 1], [0.64, 1.6, 1.8, 0.8]]) {
        const head = TAU * (t / 3 + j / 3) * (rr > 0.7 ? 1 : -1), pts = [];
        const dir = rr > 0.7 ? 1 : -1;
        for (let i = 0; i <= 28; i++) { const q = head - dir * span * (1 - i / 28); pts.push(to(Math.cos(q) * R * rr, Math.sin(q) * R * rr)); }
        trail(g, pal, pts, lw * wd * px, a * al, true);
      }
    }
    // dust swept round with them
    const D = rng(c.seed * 61 + 3);
    for (let i = 0, n = Math.round(18 * c.amount); i < n; i++) {
      const th0 = D() * TAU, rr = R * (0.55 + 0.4 * D()), ph = D();
      const p = frac(ph + t), up = R * 0.25 * D();
      comet(g, pal, (q) => { const [x, y] = to(Math.cos(th0 + q * 2.2) * rr, Math.sin(th0 + q * 2.2) * rr); return [x, y - up * q]; }, p, 0.3, Math.max(0.5, R * 0.01) * px, a * Math.sin(Math.PI * p) * 0.8);
    }
  }

  // ---- 星辉光环 ----
  function stars() {
    pool(R * 0.9, 0.12 * a);
    glowRing(R * 0.9, R * 0.06, pal.core, 0.35 * a);
    glowRing(R * 0.9, R * 0.2, pal.rim, 0.15 * a);
    ink(() => circ(R * 0.9), pal.rim, lw * 0.6, a * 0.8);
    // stars: born on the ground, twinkling as they drift up (whole cycles per loop)
    const S = rng(c.seed * 83 + 7);
    for (let i = 0, n = Math.round(22 * Math.max(0.3, c.amount)); i < n; i++) {
      const th = S() * TAU, r = Math.sqrt(S()) * R * 0.88, ph = S(), sp = 1 + Math.floor(S() * 2), sz = 0.5 + S();
      const p = frac(ph + t * sp), [bx, by] = to(Math.cos(th) * r, Math.sin(th) * r);
      const tw = Math.sin(Math.PI * p) * (0.6 + 0.4 * Math.sin(TAU * (p * 3 + ph))), y = by - R * 0.7 * p;
      const s = Math.max(2, R * 0.1 * sz) * px;
      for (const th2 of [0, Math.PI / 2, Math.PI, Math.PI * 1.5]) spike(g, bx, y, th2, s, s * 0.16, pal.core, pal.rim, a * tw);
      blob(g, bx, y, s * 0.5, [[0, pal.core, a * tw], [1, pal.rim, 0]]);
    }
  }

  // ---- 幽魂光环 ----
  function wisp() {
    const N = loopNoise(c, 41, 3 / R, 1, 3);
    const x0 = Math.max(0, Math.floor(ox - R * 1.05 * kx)), x1 = Math.min(c.w, Math.ceil(ox + R * 1.05 * kx));
    const y0 = Math.max(0, Math.floor(oy - R * 1.05 * k)), y1 = Math.min(c.h, Math.ceil(oy + R * 1.05 * k));
    const deep = mixRgb(pal.rim, pal.smoke || [20, 20, 30], 0.5);
    field(g, x0, y0, x1, y1, fieldScale(c, R), (x, y, out) => {
      const u = (x - ox) / kx / R, v = (y - oy) / k / R, r = Math.hypot(u, v);
      if (r > 1.02 * reveal + 0.02) return false;
      const th = Math.atan2(v, u) - r * 2.2, n = N(Math.cos(th) * r * R + R * 2, Math.sin(th) * r * R + R * 2);
      const band = smooth(0.45, 0.72, r) * (1 - smooth(0.86, 1.02, r));
      const d = band * (n * 1.4 - 0.35);
      if (d <= 0.02) return false;
      const col = mixRgb(deep, pal.rim, Math.min(1, d * 1.6));
      out[0] = col[0]; out[1] = col[1]; out[2] = col[2]; out[3] = Math.min(1, d * 1.4) * env;
    });
    ink(() => circ(R * 0.6), pal.rim, lw * 0.6, a * 0.7);
    // wisps curling up off the band
    const W = rng(c.seed * 97 + 13);
    for (let i = 0, n = Math.round(9 * Math.max(0.3, c.amount)); i < n; i++) {
      const th = W() * TAU, r = R * (0.7 + 0.25 * W()), ph = W(), sw = W() * TAU, h = R * (0.6 + 0.6 * W());
      const p = frac(ph + t), [bx, by] = to(Math.cos(th) * r, Math.sin(th) * r);
      comet(g, pal, (q) => [bx + R * 0.12 * Math.sin(sw + q * TAU * 1.5) * q, by - h * q], p, 0.45, Math.max(0.8, R * 0.025) * px, a * Math.sin(Math.PI * p) * 0.7);
    }
  }

  // ---- 箭阵光环 ----
  function arrows() {
    pool(R * 0.8, 0.1 * a);
    ink(() => { circ(R * 0.98); circ(R * 0.42); }, pal.rim, lw * 0.8, a);
    // eight rows of arrowheads pointing out, each moving out a step per loop
    const rows = 8, per = 3, step = 1 / per;
    for (let i = 0; i < rows; i++) {
      for (let j = 0; j < per; j++) {
        const q = frac(j * step + t), r = R * (0.45 + 0.48 * q);
        const al = a * Math.sin(Math.PI * q), s = R * 0.08;
        ink(() => poly([[-s, -r + s * 0.7], [0, -r - s * 0.3], [s, -r + s * 0.7]], i * TAU / rows), pal.core, lw * 1.1, al);
      }
    }
    glowRing(R * 0.98, R * 0.08, pal.rim, 0.3 * a);
    motes(Math.round(8 * c.amount), R * 0.9, R * 0.7);
  }
}
