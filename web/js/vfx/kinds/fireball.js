import { clamp01, rng, smooth } from "../../trails/glow/util.js";
import { frac, at, blob, streak, field, fieldScale, loopNoise, mixRgb } from "../common.js";

// A burning volume with a rolling head, a torn cooling wake and embers.
// Everything uses sequence time: seeking is deterministic and loops close.
export function fireballLayout(c) {
  if (c.bodyOnly) return { r: c.bodyRadius, x: c.cx, y: c.cy, life: 1 };
  const r = c.R * 0.29;
  const fly = c.loop ? 0 : smooth(0, 0.78, c.t);
  return {
    r, x: c.loop ? c.cx + c.R * 0.47 : c.cx - c.R * 1.4 + c.R * 3.05 * fly,
    y: c.cy, life: c.loop ? 1 : 1 - smooth(0.72, 1, c.t),
  };
}

export function fireball(g, c) {
  const { r, x: head, y: mid, life } = fireballLayout(c);
  const { pal, t, R, w, h } = c;
  if (r < 0.1 || life <= 0) return;
  const coarse = loopNoise(c, 101, 1.75, 0.7, 5);
  const fine = loopNoise(c, 107, 4.4, 0.65, 9);
  const curl = loopNoise(c, 109, 1.1, 1, 3);
  const noiseAt = (u, v) => coarse(v, u);
  const x0 = Math.max(0, Math.floor(head - r * (c.bodyOnly ? 1.8 : 5.7))), x1 = Math.min(w, Math.ceil(head + r * 1.55));
  const y0 = Math.max(0, Math.floor(mid - r * 2.1)), y1 = Math.min(h, Math.ceil(mid + r * 1.8));
  const sc = fieldScale(c, R);
  const smokeHi = mixRgb(pal.smoke, [118, 99, 91], 0.4);
  const smokeAmount = c.bodyOnly ? 0 : Math.min(1.5, c.amount);
  g.globalCompositeOperation = "source-over";
  if (smokeAmount > 0) field(g, x0, y0, x1, y1, sc, (x, y, px) => {
    const u = (x + 0.5 - head) / r, v = (y + 0.5 - mid) / r;
    const age = clamp01((-u - 0.3) / 5);
    const n = noiseAt(u * 0.65 + 3, v * 0.7 - 4);
    const centre = -age * 0.65 + (n - 0.5) * 0.45;
    const width = 0.4 + age * 0.85;
    const d = 1 - Math.abs(v - centre) / width + (n - 0.5) * 1.1;
    const a = smooth(0, 0.55, d) * smooth(0, 0.22, age) * (1 - smooth(0.45, 1, age)) * 0.3 * life * smokeAmount;
    if (a < 0.004 || u > -0.3) return false;
    const col = mixRgb(pal.smoke, smokeHi, clamp01(0.5 - v * 0.25 + (n - 0.5) * 0.5));
    px[0] = col[0]; px[1] = col[1]; px[2] = col[2]; px[3] = a;
  });
  // Keep the body saturated; bloom is added after this pass.
  field(g, x0, y0, x1, y1, sc, (x, y, px) => {
    const u = (x + 0.5 - head) / r, v = (y + 0.5 - mid) / r;
    const age = clamp01(-u / 5);
    const bend = (curl(v, u) - 0.5) * (c.bodyOnly ? 0.08 + age * 0.22 : 0.16 + age * 0.9);
    const n = noiseAt(u, v + bend), f = fine(v + n * 0.2, u);
    const back = clamp01(-u / 1.5);
    const body = 1 - Math.hypot(u / (u < 0 ? 1.7 : 1), v + bend) + (n - 0.5) * (c.bodyOnly ? 0.32 + back * 0.3 : 0.5 + back * 0.55) + (f - 0.5) * (c.bodyOnly ? 0.15 : 0.2);
    const width = Math.max(0.04, 0.76 * Math.pow(1 - age, 0.65));
    const wake = u < 0 ? (1 - Math.abs(v + bend) / width + (n - 0.5) * (1.15 + age) + (f - 0.5) * 0.45) * (1 - smooth(0.65, 1, age)) : -1;
    const d = c.bodyOnly ? body : Math.max(body, wake * 0.62);
    if (d < -0.04 || u < -5) return false;
    const heat = clamp01(0.13 + d * 0.66 + (f - 0.5) * 0.25 - age * 0.24);
    const a = smooth(-0.04, 0.22, d) * (1 - smooth(0.7, 1, age)) * life;
    if (a < 0.004) return false;
    const col = at(pal.flame, heat);
    px[0] = col[0]; px[1] = col[1]; px[2] = col[2]; px[3] = a;
  });
  g.globalCompositeOperation = pal.dark ? "source-over" : "lighter";
  blob(g, head + r * 0.12, mid, r * 0.58, [[0, pal.core, 0.65 * life], [0.35, pal.core, 0.4 * life], [1, pal.rim, 0]]);
  const P = rng(c.seed * 127 + 9);
  for (let k = 0, count = Math.round(26 * c.amount); k < count; k++) {
    const ph = P(), side = P() * 2 - 1, speed = 1 + Math.floor(P() * 2), size = 0.6 + P() * 0.8;
    const age = frac(ph + t * speed), behind = age * R * 1.45;
    const x = head - r * 0.45 - behind, y = mid + side * r * (0.5 + age * 2.2) - age * age * r * 0.4;
    const a = Math.sin(Math.PI * age) * (1 - age) * life;
    streak(g, [x + r * (0.1 + age * 0.24), y - side * r * 0.06], [x, y], pal.rim, at(pal.flame, 0.9 - age * 0.65), a, Math.max(0.6, r * 0.055 * size));
  }
  g.globalCompositeOperation = "source-over";
}
