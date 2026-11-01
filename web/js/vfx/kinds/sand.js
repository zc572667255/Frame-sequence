import { rng, smooth } from "../../trails/glow/util.js";
import { TAU, frac, at, blob, streak, ring } from "../common.js";
import { drawPuff } from "../remotetrail.js";

// Grains attached to the projectile, not its path history. Each grain streams
// away from the bright tip and fades before recycling, with varied reach and
// spread so the short body never has a straight, solid rear edge.
export function sandGrains(r, amount, seed, t) {
  const P = rng(seed * 131 + 17), grains = [];
  for (let i = 0, count = Math.round(48 * Math.max(0.25, Math.min(2, amount))); i < count; i++) {
    const phase = P(), side = P() + P() - 1, reach = 0.6 + P() * 1.0;
    const cycles = 3 + Math.floor(P() * 3), width = Math.max(1.1, r * (0.07 + P() * 0.06));
    const strength = 0.45 + P() * 0.5, flicker = P() * TAU, age = frac(phase + t * cycles);
    const x = -r * (0.06 + reach * age), y = r * (side * (0.07 + age * 0.35) + Math.sin(age * 2 + flicker) * 0.035 * age);
    const alpha = smooth(0, 0.08, age) * (1 - smooth(0.22, 1, age)) * strength * (0.7 + Math.sin(t * TAU * cycles * 2 + flicker) * 0.3);
    grains.push({ at: [x, y], back: [x + width * (1.2 + age * 0.8), y], width, alpha, heat: 0.5 + (1 - age) * 0.35 });
  }
  return grains;
}

export function drawSandBody(g, c, r) {
  const { pal } = c;
  g.globalCompositeOperation = pal.dark ? "source-over" : "lighter";
  // 头部一圈紧凑的柔光（不再沿朝向往后排一串光团：那串光是直的，不跟随弯曲的路径，会拉成一条光条）
  blob(g, -r * 0.1, 0, r * 1.1, [[0, pal.rim, 0.45], [0.5, pal.rim, 0.16], [1, pal.rim, 0]]);
  blob(g, r * 0.08, 0, r * 0.62, [[0, pal.core, 0.95], [0.22, pal.rim, 0.6], [1, pal.rim, 0]]);
  for (const grain of sandGrains(r, c.amount, c.seed, c.t)) {
    if (grain.alpha < 0.005) continue;
    streak(g, grain.back, grain.at, pal.rim, at(pal.flame, grain.heat), grain.alpha, grain.width);
  }
}

export function drawSandImpact(g, c, radius) {
  const { pal, t } = c, fade = (1 - t) ** 1.1, wave = 1 - (1 - Math.min(1, t / 0.4)) ** 2;
  g.save();
  g.translate(c.cx, c.cy);
  g.globalCompositeOperation = pal.dark ? "source-over" : "lighter";
  blob(g, 0, -t * radius * 0.2, radius * (0.35 + t * 1.05), [[0, pal.core, fade * 0.7], [0.45, pal.rim, fade * 0.28], [1, pal.rim, 0]]);
  ring(g, 0, 0, Math.max(0.5, wave * radius), Math.max(0.6, radius * 0.04), 0.5, pal.rim, fade * 0.6);
  const P = rng(c.seed * 157 + 11);
  for (let j = 0, n = Math.round(40 * Math.max(0.25, Math.min(2, c.amount))); j < n; j++) {
    const th = P() * TAU, speed = radius * (0.35 + P() * 1.05), life = 0.5 + P() * 0.5, w = Math.max(0.7, radius * (0.012 + P() * 0.016));
    const q = Math.min(1, t / (0.35 + P() * 0.2));
    const x = Math.cos(th) * speed * q, y = Math.sin(th) * speed * q * 0.62 + radius * q * q * 0.4;
    const alpha = Math.max(0, 1 - t / life) ** 1.35 * (0.4 + P() * 0.55);
    streak(g, [x - Math.cos(th) * w * 4, y - Math.sin(th) * w * 2], [x, y], pal.rim, at(pal.flame, 0.75), alpha, w);
  }
  for (let j = 0; j < 4; j++) {
    const a = j * TAU / 4 + 0.4;
    drawPuff(g, Math.cos(a) * radius * t * 0.45, Math.sin(a) * radius * t * 0.2 - t * radius * 0.1, radius * (0.18 + t * 0.35), a, pal.rim, smooth(0, 0.08, t) * fade * 0.28, c.seed + j, 1.5);
  }
  g.restore();
}
