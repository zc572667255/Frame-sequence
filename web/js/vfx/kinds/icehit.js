import { rng, rgba, smooth } from "../../trails/glow/util.js";
import { TAU, mixRgb, blob, streak, ring, easeOut } from "../common.js";
import { frostColors, twinkle } from "./ice.js";

// The frost bolt bursting: a white flash, a breath of frost mist spreading,
// a ring of cold light, ice shards flung out and fading, twinkles and a few
// snowflakes drifting down. Everything is a function of t (0..1 over the
// hit), so any frame can be sought; all is gone by t = 1. godot/icehit.js
// draws exactly the same.
//
// R: the hit's radius; angle: the direction the bolt flew.
export function iceBurst(R, amount, seed, t, angle = 0) {
  const P = rng(seed * 227 + 61), q = Math.max(0.25, Math.min(2, amount)), e = easeOut(t);
  const mist = [], shards = [], sparkles = [], flakes = [];
  for (let j = 0; j < 6; j++) {
    const a = j * TAU / 6 + P() * 0.8, reach = R * (0.25 + 0.3 * P());
    mist.push({ at: [Math.cos(a) * reach * e, Math.sin(a) * reach * e], r: R * (0.25 + 0.45 * e) * (0.8 + 0.4 * P()), alpha: Math.pow(1 - t, 1.5) * 0.25 * smooth(0, 0.08, t) });
  }
  for (let j = 0, n = Math.round(10 * q); j < n; j++) {
    const a = j * TAU / n + (P() - 0.5) * 0.5, len = R * (0.25 + 0.3 * P()), dist = R * (0.15 + 0.75 * e) * (0.75 + 0.35 * P());
    const k = 1 - 0.35 * t;
    shards.push({ angle: a, at: [Math.cos(a) * dist, Math.sin(a) * dist], len: len * k, width: len * k * 0.14, alpha: 1 - smooth(0.35, 0.85, t) });
  }
  for (let j = 0, n = Math.round(12 * q); j < n; j++) {
    const a = P() * TAU, reach = R * (0.3 + 0.8 * P()), born = 0.04 + 0.35 * P(), size = R * (0.05 + 0.05 * P()), k = Math.max(0, Math.min(1, (t - born) / 0.45));
    sparkles.push({ at: [Math.cos(a) * reach * e, Math.sin(a) * reach * e * 0.8 + R * 0.25 * t * t], size, alpha: t < born || k >= 1 ? 0 : Math.sin(Math.PI * k) });
  }
  for (let j = 0; j < 5; j++) {
    const a = P() * TAU, reach = R * (0.4 + 0.5 * P()), size = R * (0.07 + 0.05 * P()), spin = P() * TAU + t * 2;
    flakes.push({ at: [Math.cos(a) * reach * e, Math.sin(a) * reach * e * 0.7 + R * 0.4 * t], size, spin, alpha: smooth(0.05, 0.2, t) * (1 - smooth(0.6, 1, t)) * 0.8 });
  }
  return {
    flash: 1 - smooth(0, 0.18, t), mist, shards, sparkles, flakes,
    ring: { radius: R * (0.2 + 0.9 * e), alpha: 0.6 * (1 - smooth(0.1, 0.6, t)) },
  };
}

// a shard pointing out from the middle: a thin two-tone diamond
export function shardPoints(sh) {
  const d = [Math.cos(sh.angle), Math.sin(sh.angle)], nv = [-d[1] * sh.width, d[0] * sh.width];
  const b = [sh.at[0] - d[0] * sh.len * 0.4, sh.at[1] - d[1] * sh.len * 0.4], tip = [sh.at[0] + d[0] * sh.len * 0.6, sh.at[1] + d[1] * sh.len * 0.6];
  return { base: b, tip, lit: [b, [sh.at[0] + nv[0], sh.at[1] + nv[1]], tip], dark: [b, tip, [sh.at[0] - nv[0], sh.at[1] - nv[1]]] };
}

function fill(g, pts, col, a) { g.fillStyle = rgba(col, a); g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.closePath(); g.fill(); }

export function drawIceImpact(g, c, radius, angle) {
  const { t, pal } = c, hit = iceBurst(radius, c.amount, c.seed, t, angle), col = frostColors(pal), light = pal.dark ? "source-over" : "lighter";
  g.save(); g.translate(c.cx, c.cy);
  g.globalCompositeOperation = light;
  for (const m of hit.mist) blob(g, m.at[0], m.at[1], m.r, [[0, col.mist, m.alpha], [1, col.mist, 0]]);
  ring(g, 0, 0, hit.ring.radius, Math.max(0.6, radius * 0.04), 1, col.rim, hit.ring.alpha);
  g.globalCompositeOperation = "source-over";
  for (const sh of hit.shards) {
    if (sh.alpha <= 0.005) continue;
    const s = shardPoints(sh);
    fill(g, s.lit, mixRgb(col.blue, col.core, 0.7), 0.92 * sh.alpha); fill(g, s.dark, mixRgb(col.deep, col.blue, 0.55), 0.8 * sh.alpha);
  }
  g.globalCompositeOperation = light;
  for (const sh of hit.shards) {
    if (sh.alpha <= 0.005) continue;
    const s = shardPoints(sh);
    streak(g, s.base, s.tip, col.rim, col.core, 0.55 * sh.alpha, Math.max(0.5, sh.width * 0.5));
  }
  for (const k of hit.sparkles) twinkle(g, k.at[0], k.at[1], k.size, pal, k.alpha);
  for (const f of hit.flakes) {
    if (f.alpha <= 0.01) continue;
    g.strokeStyle = rgba(col.core, f.alpha); g.lineWidth = Math.max(0.5, f.size * 0.18); g.lineCap = "round";
    for (let arm = 0; arm < 6; arm++) {
      const a = f.spin + arm * Math.PI / 3;
      g.beginPath(); g.moveTo(...f.at); g.lineTo(f.at[0] + Math.cos(a) * f.size, f.at[1] + Math.sin(a) * f.size); g.stroke();
    }
  }
  blob(g, 0, 0, radius * 0.9, [[0, col.rim, 0.4 * hit.flash], [1, col.mist, 0]]);
  blob(g, 0, 0, radius * 0.5, [[0, col.core, 0.95 * hit.flash], [0.4, col.core, 0.5 * hit.flash], [1, col.rim, 0]]);
  g.restore();
}
