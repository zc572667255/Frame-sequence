import { rng, rgba, smooth } from "../../trails/glow/util.js";
import { TAU, blob, ring, streak } from "../common.js";

// A fixed, forked discharge; only its energy flickers. Random access to any
// frame must keep the channels and the outgoing spark trajectories together.
export function electricChannel(from, to, seed) {
  const P = rng(seed), dx = to[0] - from[0], dy = to[1] - from[1];
  let points = [from, to];
  for (let level = 0; level < 4; level++) {
    const next = [points[0]], amplitude = 0.24 / 2 ** level;
    for (let k = 1; k < points.length; k++) {
      const a = points[k - 1], b = points[k], offset = (P() * 2 - 1) * amplitude;
      next.push([(a[0] + b[0]) / 2 - dy * offset, (a[1] + b[1]) / 2 + dx * offset], b);
    }
    points = next;
  }
  return points;
}

export function thunderDischarge(r, amount, seed, t) {
  const P = rng(seed * 263 + 19), arcs = [], scars = [], sparks = [];
  let pulse = 0;
  for (const start of [0, 0.08, 0.19, 0.32]) if (t >= start) pulse = Math.max(pulse, Math.exp(-(t - start) / 0.045));
  const energy = Math.max(pulse, 0.14) * (1 - smooth(0.18, 0.52, t));
  const count = Math.round(5 + Math.min(2, amount) * 4);
  for (let j = 0; j < count; j++) {
    const a = j * TAU / count + (P() - 0.5) * 0.7, reach = r * (0.7 + P() * 0.8);
    const points = electricChannel([0, 0], [Math.cos(a) * reach, Math.sin(a) * reach * 0.8], seed * 13 + j * 67);
    const flicker = rng(seed * 271 + Math.floor(t * 24) * 97 + j)();
    const alpha = energy * (0.55 + flicker * 0.45);
    arcs.push({ points, width: r * 0.026, alpha });
    const branch = a + (P() > 0.5 ? 1 : -1) * (0.65 + P() * 0.6), from = points[9];
    arcs.push({ points: electricChannel(from, [from[0] + Math.cos(branch) * reach * 0.4, from[1] + Math.sin(branch) * reach * 0.32], seed * 17 + j * 73), width: r * 0.014, alpha: alpha * 0.65 });
  }
  const C = rng(seed * 283 + 23), growth = smooth(0, 0.12, t);
  for (let j = 0; j < 7; j++) {
    const a = j * TAU / 7 + (C() - 0.5) * 0.5, reach = r * (0.7 + C() * 0.65);
    const points = electricChannel([0, 0], [Math.cos(a) * reach, Math.sin(a) * reach], seed * 19 + j * 83).map(p => [p[0], p[1] * 0.23]);
    const stop = growth * (points.length - 1), end = Math.floor(stop), clipped = points.slice(0, end + 1);
    if (end < points.length - 1) clipped.push(points[end].map((v, k) => v + (points[end + 1][k] - v) * (stop - end)));
    scars.push({ points: clipped, width: r * 0.012, alpha: (1 - smooth(0.22, 0.92, t)) * 0.38 });
  }
  const S = rng(seed * 293 + 29);
  for (let j = 0; j < Math.round(30 * Math.min(2, amount)); j++) {
    const a = -Math.PI / 2 + (S() - 0.5) * 4.6, speed = r * (2.2 + S() * 3), life = 0.4 + S() * 0.6, width = r * (0.008 + S() * 0.012);
    const position = q => [Math.cos(a) * speed * q, Math.sin(a) * speed * q + r * q * q * 1.7];
    sparks.push({ at: position(t), back: position(Math.max(0, t - 0.025)), width, alpha: Math.max(0, 1 - t / life) ** 1.5 });
  }
  return { arcs, scars, sparks, flash: Math.exp(-t / 0.055), halo: Math.exp(-t / 0.18), wave: 1 - (1 - Math.min(1, t / 0.28)) ** 2.5, waveAlpha: Math.max(0, 1 - t / 0.28) * 0.3 };
}

function channel(g, pal, path) {
  const { points, width, alpha } = path;
  if (points.length < 2 || alpha < 0.005) return;
  const from = points[0], to = points.at(-1);
  if (Math.hypot(to[0] - from[0], to[1] - from[1]) < 0.1) return;
  for (const [scale, color, opacity] of [[6, pal.rim, 0.12], [2.6, pal.rim, 0.38], [1, pal.core, 1]]) {
    const left = [], right = [];
    points.forEach((p, i) => {
      const a = points[Math.max(0, i - 1)], b = points[Math.min(points.length - 1, i + 1)], len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      const half = Math.max(0.15, width) * scale * (1 - i / (points.length - 1) * 0.92) / 2;
      const nx = -(b[1] - a[1]) / len * half, ny = (b[0] - a[0]) / len * half;
      left.push([p[0] + nx, p[1] + ny]); right.push([p[0] - nx, p[1] - ny]);
    });
    const gradient = g.createLinearGradient(...from, ...to);
    gradient.addColorStop(0, rgba(color, alpha * opacity)); gradient.addColorStop(1, rgba(pal.rim, 0));
    g.fillStyle = gradient; g.beginPath();
    [...left, ...right.reverse()].forEach(([x, y], i) => i ? g.lineTo(x, y) : g.moveTo(x, y)); g.closePath(); g.fill();
  }
}

export function drawThunderImpact(g, c, radius) {
  const { pal, t } = c, hit = thunderDischarge(radius, c.amount, c.seed, t);
  g.save(); g.translate(c.cx, c.cy); g.globalCompositeOperation = pal.dark ? "source-over" : "lighter";
  blob(g, 0, 0, radius * 1.65, [[0, pal.rim, hit.halo * 0.42], [0.5, pal.rim, hit.halo * 0.13], [1, pal.rim, 0]]);
  for (const p of [...hit.scars, ...hit.arcs]) channel(g, pal, p);
  ring(g, 0, 0, Math.max(0.1, hit.wave * radius * 1.6), radius * 0.026, 0.8, pal.rim, hit.waveAlpha);
  for (const p of hit.sparks) if (p.alpha > 0.005) streak(g, p.back, p.at, pal.rim, pal.core, p.alpha, Math.max(0.45, p.width));
  // A short white core and horizontal lens flare leave room for the branches.
  g.save(); g.scale(1, 0.055);
  blob(g, 0, 0, radius * 1.6, [[0, pal.core, hit.flash * 0.9], [0.25, pal.rim, hit.flash * 0.4], [1, pal.rim, 0]]); g.restore();
  blob(g, 0, 0, radius * (0.12 + hit.flash * 0.42), [[0, pal.core, hit.flash], [0.35, pal.core, hit.flash * 0.8], [1, pal.rim, 0]]);
  g.restore();
}
