import { rng, rgba, smooth, clamp01 } from "../../trails/glow/util.js";
import { TAU, mixRgb, blob, streak, ring, easeOut } from "../common.js";
import { drawPuff } from "../remotetrail.js";

// 冰矛 hitting: a flash, crystal spikes bursting out of the point and then
// shattering, the lance's own shards and the spikes' shards flying off and
// falling, a frost ring, twinkles and a breath of mist. Everything is a
// function of t (0..1 over the hit), so any frame can be sought; all is gone by
// t = 1. godot/icehit.js draws exactly the same.
//
// R: the hit's radius; angle: the direction the lance flew.
export function iceBurst(R, amount, seed, t, angle = 0) {
  const P = rng(seed * 227 + 61), q = Math.max(0.25, Math.min(2, amount));
  const grow = easeOut(smooth(0, 0.14, t)), fade = 1 - smooth(0.42, 0.62, t);
  const spikes = [], shards = [], sparkles = [];
  for (let j = 0; j < 7; j++) {
    const a = angle + j * TAU / 7 + (P() - 0.5) * 0.35, len = R * (0.38 + 0.18 * P()) * (j % 2 ? 0.75 : 1);
    spikes.push({ angle: a, len: len * grow, full: len, width: len * grow * 0.2, alpha: fade });
  }
  const shard = (origin, dir, speed, size, born, life) => {
    const rot = P() * TAU, spin = (P() - 0.5) * 14, age = t - born;
    if (age < 0) { shards.push({ at: origin, rot, size, alpha: 0 }); return; }
    const d = speed * age * (1 - 0.45 * age);
    shards.push({ at: [origin[0] + Math.cos(dir) * d, origin[1] + Math.sin(dir) * d + R * 0.9 * age * age], rot: rot + spin * age, size, alpha: 1 - smooth(life * 0.55, life, age) });
  };
  // the lance breaking up, mostly carried on forward
  for (let j = 0, n = Math.round(8 * q); j < n; j++) {
    const dir = angle + (P() - 0.5) * 2.4 + (P() < 0.35 ? Math.PI : 0);
    shard([0, 0], dir, R * (0.9 + 1.2 * P()), R * (0.07 + 0.09 * P()), 0, 0.5 + 0.3 * P());
  }
  // each spike breaking in two
  for (const s of spikes) for (let k = 0; k < 2; k++) {
    const along = s.full * (0.3 + 0.5 * P());
    shard([Math.cos(s.angle) * along, Math.sin(s.angle) * along], s.angle + (P() - 0.5) * 0.8, R * (0.5 + 0.8 * P()), R * (0.05 + 0.06 * P()), 0.45, 0.4 + 0.15 * P());
  }
  for (let j = 0, n = Math.round(10 * q); j < n; j++) {
    const a = P() * TAU, reach = R * (0.3 + 0.7 * P()), born = 0.05 + 0.3 * P(), size = R * (0.06 + 0.05 * P());
    const e = easeOut(t), k = clamp01((t - born) / 0.4);
    sparkles.push({ at: [Math.cos(a) * reach * e, Math.sin(a) * reach * e], size, alpha: t < born || k >= 1 ? 0 : Math.sin(Math.PI * k) });
  }
  const ringFade = 1 - smooth(0.2, 0.75, t);
  return {
    flash: 1 - smooth(0, 0.16, t), spikes, shards, sparkles,
    ring: { radius: R * (0.25 + 0.75 * easeOut(smooth(0, 0.5, t))), alpha: 0.2 * ringFade },
  };
}

// a shard: a thin two-tone diamond of length `size` along `rot`
export function shardPoints(at, rot, s) {
  const c = Math.cos(rot), n = Math.sin(rot), pt = (x, y) => [at[0] + x * c - y * n, at[1] + x * n + y * c];
  return { lit: [pt(-0.6 * s, 0), pt(0, -0.35 * s), pt(s, 0)], dark: [pt(-0.6 * s, 0), pt(s, 0), pt(0, 0.3 * s)] };
}

// a spike: from near the point out to its tip, lit on one side
export function spikePoints(sp, R) {
  const d = [Math.cos(sp.angle), Math.sin(sp.angle)], nv = [-d[1] * sp.width, d[0] * sp.width];
  const b = [d[0] * R * 0.05, d[1] * R * 0.05], tip = [d[0] * sp.len, d[1] * sp.len], m = [d[0] * sp.len * 0.35, d[1] * sp.len * 0.35];
  return { base: b, tip, lit: [b, [m[0] + nv[0], m[1] + nv[1]], tip], dark: [b, tip, [m[0] - nv[0], m[1] - nv[1]]] };
}

function fill(g, pts, col, a) { g.fillStyle = rgba(col, a); g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.closePath(); g.fill(); }

export function drawIceImpact(g, c, radius, angle) {
  const { t, pal } = c, P = rng(c.seed * 331 + 19), hit = iceBurst(radius, c.amount, c.seed, t, angle);
  const deep = mixRgb(pal.cols[0], [6, 14, 40], 0.45), blue = pal.cols[0], cyan = pal.cols[1] || pal.rim;
  const litCol = mixRgb(cyan, pal.core, 0.4), darkCol = mixRgb(deep, blue, 0.6), light = pal.dark ? "source-over" : "lighter";
  g.save(); g.translate(c.cx, c.cy);
  for (let j = 0; j < 3; j++) {
    const a = P() * TAU;
    drawPuff(g, Math.cos(a) * radius * t * 0.6, Math.sin(a) * radius * t * 0.3, radius * (0.18 + t * 0.3), a, pal.rim, smooth(0, 0.1, t) * (1 - t) ** 2 * 0.14 * Math.min(1.5, c.amount), j + c.seed, 1.6);
  }
  g.globalCompositeOperation = light;
  ring(g, 0, 0, hit.ring.radius, Math.max(0.6, radius * 0.05), 0.6, pal.rim, hit.ring.alpha);
  g.globalCompositeOperation = "source-over";
  for (const sp of hit.spikes) {
    if (sp.alpha <= 0.005 || sp.len < 0.5) continue;
    const s = spikePoints(sp, radius);
    fill(g, s.lit, litCol, 0.92 * sp.alpha); fill(g, s.dark, darkCol, 0.9 * sp.alpha);
  }
  for (const sh of hit.shards) {
    if (sh.alpha <= 0.005) continue;
    const s = shardPoints(sh.at, sh.rot, sh.size);
    fill(g, s.lit, litCol, 0.95 * sh.alpha); fill(g, s.dark, darkCol, 0.9 * sh.alpha);
  }
  g.globalCompositeOperation = light;
  for (const sp of hit.spikes) {
    if (sp.alpha <= 0.005 || sp.len < 0.5) continue;
    const s = spikePoints(sp, radius);
    streak(g, s.base, s.tip, pal.rim, pal.core, 0.6 * sp.alpha, Math.max(0.5, sp.width * 0.35));
  }
  for (const k of hit.sparkles) {
    if (k.alpha <= 0.01) continue;
    const [x, y] = k.at;
    blob(g, x, y, k.size, [[0, pal.core, 0.8 * k.alpha], [1, pal.rim, 0]]);
    for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) streak(g, [x + dx * k.size * 1.6, y + dy * k.size * 1.6], k.at, pal.rim, pal.core, 0.7 * k.alpha, Math.max(0.4, k.size * 0.25));
  }
  blob(g, 0, 0, radius * 0.9, [[0, pal.rim, 0.35 * hit.flash], [1, pal.rim, 0]]);
  blob(g, 0, 0, radius * 0.55, [[0, pal.core, 0.85 * hit.flash], [0.4, pal.core, 0.4 * hit.flash], [1, pal.rim, 0]]);
  g.restore();
}
