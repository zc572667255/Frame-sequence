import { rng, clamp01, smooth, fbmNoise, drawBlurred } from "../../trails/glow/util.js";
import { TAU, easeOut, easeIn, mixRgb, at, blob, ring, sparks, volume, drawSoft, field, fieldScale } from "../common.js";

// 爆炸: a fireball of noisy puffs that swells, cools from white through the
// palette to smoke and drifts up, with a flash, a shock ring and sparks
export function explosion(g, c) {
  if (c.pal.dark) return explosionInk(g, c);
  const { t, R, cx, cy, pal, w, h } = c;
  const k = 1.6 / R, sc = fieldScale(c, R);
  const N = fbmNoise(c.seed * 19 + 3), F = fbmNoise(c.seed * 23 + 5), W = fbmNoise(c.seed * 29 + 7);
  // the fireball swells fast and rises a little; the smoke after it grows on
  // and drifts higher
  const e = easeOut(t / 0.42, 2.2), rise = R * 0.32 * easeIn(t, 1.5);
  const rb = R * (0.16 + 0.66 * e), fy = cy - rise * 0.5;
  const rs = R * (0.24 + 0.42 * e + 0.12 * t), sy = cy - rise * 0.9;
  const cool = 1 - smooth(0.1, 0.72, t), flash = 0.5 * (1 - smooth(0, 0.16, t));
  // smoke: soft billows lit from above, thickening as the fire dies down,
  // then thinning away
  const smokeA = smooth(0.12, 0.5, t) * (1 - smooth(0.55, 1.05, t));
  const smokeHi = mixRgb(pal.smoke, [176, 168, 160], 0.5);
  if (smokeA > 0.01) {
    g.globalCompositeOperation = "source-over";
    field(g, Math.max(0, Math.floor(cx - rs * 1.6)), Math.max(0, Math.floor(sy - rs * 1.6)), Math.min(w, Math.ceil(cx + rs * 1.6)), Math.min(h, Math.ceil(sy + rs * 1.5)), sc, (x, y, px) => {
      const dx = x + 0.5 - cx, dy = y + 0.5 - sy;
      // past the farthest a billow can reach, whatever the noise and the drift
      if (1 - Math.hypot(Math.max(0, Math.abs(dx) - rs * 0.25), dy * 1.1) / rs + 0.65 <= 0) return false;
      const wx = (W(dx * k * 0.6, dy * k * 0.6 + t) - 0.5) * rs * 0.5;
      const n = N((dx + wx) * k, (dy * 1.1) * k + t * 1.3), b = F((dx + wx) * k * 2.4 + 5, dy * k * 2.4 + t * 2);
      // billows: big lumps from n, smaller puffs on them from b
      const d = 1 - Math.hypot(dx + wx, dy * 1.1) / rs + (n - 0.5) * 0.95 + (b - 0.5) * 0.35;
      if (d <= 0) return false;
      const a = smooth(0, 0.3, d) * smokeA * (0.65 + 0.35 * b) * 0.9;
      if (a <= 0.004) return false;
      // lit from above, each puff brighter on its top
      const lit = clamp01(0.5 - dy / rs * 0.55 + (b - 0.5) * 0.9), col = mixRgb(pal.smoke, smokeHi, lit * lit);
      px[0] = col[0]; px[1] = col[1]; px[2] = col[2]; px[3] = a;
    });
  }
  // fire: tongues rolling out from a white-hot middle, fine strands running
  // outward through them, the whole cooling through the palette
  if (cool + flash > 0.02) {
    g.globalCompositeOperation = "lighter";
    field(g, Math.max(0, Math.floor(cx - rb * 1.7)), Math.max(0, Math.floor(fy - rb * 1.7)), Math.min(w, Math.ceil(cx + rb * 1.7)), Math.min(h, Math.ceil(fy + rb * 1.7)), sc, (x, y, px) => {
      const dx = x + 0.5 - cx, dy = y + 0.5 - fy, dist = Math.hypot(dx, dy);
      // past the farthest a tongue can reach, whatever the noise
      if (1.575 - dist / rb <= -0.12) return false;
      const wx = (W(dx * k * 0.7 + 3, dy * k * 0.7 - t * 0.8) - 0.5) * rb * 0.6;
      const wy = (W(dx * k * 0.7 - 9, dy * k * 0.7 + 4) - 0.5) * rb * 0.4;
      // rolling lumps of flame (n), churning smaller ones on them (b), the
      // edge licking out in tongues
      const n = N((dx + wx) * k * 1.2 + 11, (dy + wy) * k * 1.2 - t * 1.6);
      const b = F((dx + wx) * k * 2.8 - 7, (dy + wy) * k * 2.8 - t * 2.6);
      const d = 1 - dist / rb + (n - 0.5) * 0.85 + (b - 0.5) * 0.3;
      if (d <= -0.12) return false;
      const body = smooth(-0.04, 0.25, d), tongue = smooth(-0.12, 0.02, d) * (1 - body) * smooth(0.55, 0.8, b) * 0.8;
      const heat = clamp01((d * 1.2 + (b - 0.5) * 0.55) * cool + flash * body);
      const a = body * smooth(0.04, 0.35, heat) + tongue * cool;
      if (a <= 0.004) return false;
      const col = at(pal.flame, heat);
      px[0] = col[0]; px[1] = col[1]; px[2] = col[2]; px[3] = a;
    });
  }
  g.globalCompositeOperation = "lighter";
  const fl = 1 - smooth(0, 0.18, t);
  blob(g, cx, cy, R * 0.7, [[0, pal.core, fl], [0.35, pal.rim, 0.6 * fl], [1, pal.rim, 0]]);
  const sr = R * (0.3 + 0.95 * easeOut(t / 0.45, 2)), sa = 1 - smooth(0, 0.5, t);
  ring(g, cx, cy, sr, R * 0.12 * (1 - t) + 1, 1, pal.rim, 0.25 * sa);
  ring(g, cx, cy, sr, R * 0.03 + 0.6, 1, pal.core, 0.5 * sa);
  sparks(g, c, cx, cy, Math.round(22 * c.amount), R * 1.1, 0.02, 7, 0.45);
}

// 爆炸 in a dark preset (黑炎), not a kind of its own: a churning ink cloud of
// noisy puffs, painted rather than added as light
function explosionInk(g, c) {
  const { t, R, cx, cy, pal } = c;
  const P = rng(c.seed * 19 + 2);
  const K = Math.round(10 + 6 * c.amount);
  const e = easeOut(t / 0.55, 2.5), rise = R * 0.4 * easeIn(t, 1.6);
  const blobs = [];
  for (let k = 0; k < K; k++) {
    const th = P() * TAU, d0 = Math.pow(P(), 0.7), s = 0.32 + 0.3 * P(), late = P();
    blobs.push({
      x: cx + Math.cos(th) * R * 0.55 * d0 * e,
      y: cy + Math.sin(th) * R * 0.42 * d0 * e - rise * (0.6 + 0.8 * late),
      r: R * s * (0.3 + 0.7 * e) * (1 + 0.3 * t),
      heat: (1.05 - d0 * 0.45) * Math.pow(1 - smooth(0, 0.8, t), 0.9) + (t < 0.12 ? 0.4 : 0),
    });
  }
  const v = volume(c, blobs, {
    cell: Math.max(4, R * 0.16), drift: [0, t * R * 0.6], rough: c.pixel ? 0.8 : 0.65, soft: c.pixel ? 0.3 : 0.42, heat: 1.35,
    thr: 0.3 + 0.5 * smooth(0.35, 1, t), fade: 1 - 0.85 * smooth(0.45, 1.05, t), color: pal.fire, glowAt: 0.45,
  });
  // a dark preset (黑炎) is its own glow-less ink
  if (v.hot && !pal.dark) { g.globalCompositeOperation = "lighter"; g.globalAlpha = 0.8 * c.glow; drawBlurred(g, [v.hot], Math.max(2, R * 0.12)); g.globalAlpha = 1; }
  g.globalCompositeOperation = "source-over";
  if (v.body) drawSoft(g, c, v.body);
  g.globalCompositeOperation = "lighter";
  const fl = 1 - smooth(0, 0.18, t);
  blob(g, cx, cy, R * 0.6, [[0, pal.core, fl], [0.4, pal.rim, 0.6 * fl], [1, pal.rim, 0]]);
  ring(g, cx, cy, R * (0.3 + 0.9 * easeOut(t / 0.4, 2)), R * 0.04 + 0.6, 1, pal.rim, 0.35 * (1 - smooth(0, 0.4, t)));
  sparks(g, c, cx, cy, Math.round(18 * c.amount), R * 1.1, 0.03, 7, 0.45);
}
