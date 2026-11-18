import { rgba, rng, smooth } from "../../trails/glow/util.js";
import { TAU, at, blob, mixRgb, field, fieldScale } from "../common.js";

// 火球, drawn after pixelfx's fireball and explosion
// (https://github.com/patch-gg/pixelfx, MIT License, Copyright (c) 2026
// patch-gg; their flame, puff, smoke, ember and spark recipes follow Sprite
// Fusion's fire and explosion, MIT License, Copyright (c) 2026 Hugo Duprez):
// - flying: a churning white-hot head swept back, whose heat swirls; tongues
//   of flame rooted in it streaming back and a corona licking round it, each a
//   red rim round orange round yellow round a white heart with crackling
//   edges; a torn tail of flame puffs the head leaves behind, cooling and
//   swelling, some burning out into smoke; motes flicked off the head; embers
//   and sparks shed behind; its light;
// - striking: a white flash, a ball of fire puffs bursting out that cool
//   into rolling smoke, dark smoke, a fan of sparks falling, embers carried
//   up, its light. No rings, no ground.
// Sizes are in the fireball's own pixels (its head is R0 = 5 of them, as in
// pixelfx), times in pixelfx's seconds: the flight loops every D = 1.2 s,
// fitted to a whole number of loops of the sequence. Everything is a
// function of time, so any frame can be sought and loops close.
// godot/fire.js draws exactly the same.

export const FIRE_R0 = 5, FIRE_D = 1.2;

// the fire ramp hot-first (pixelfx hotFirst): H[0] the core … H[8] the darkest
export const fireRamp = (pal) => Array.from({ length: 9 }, (_, i) => at(pal.flame, 1 - i / 8));
const WHITE = [255, 255, 255];
export const fireGlowColour = (H) => mixRgb(mixRgb(H[3], H[4], 0.5), WHITE, 0.25);
const SMOKE1 = [91, 85, 102];
export const SMOKE_RAMP = [[123, 111, 114], [93, 86, 96], [67, 61, 72], [43, 38, 48], [26, 23, 30]];
const rampAt = (r, t) => r[Math.min(r.length - 1, Math.max(0, Math.floor(t * r.length)))];

// the loop: the seconds into pixelfx's 1.2 s loop at t (0..1 over a loop of
// n frames, played at about 12 frames a second)
export const fireLoops = (n) => Math.max(1, Math.round((n || 14) / 14.4));
export const fireTime = (t, n) => (((t * fireLoops(n)) % 1) + 1) % 1 * FIRE_D;

// a whole-number hash (the same in the shader: lh) → 0..1
export function fireHash(x, y, s) {
  let v = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ s;
  v = Math.imul(v ^ (v >>> 13), 1274126177);
  return ((v ^ (v >>> 16)) >>> 0) / 4294967295;
}
const wrap = (x, m) => ((x % m) + m) % m;
// smooth value noise in [-1, 1] repeating every `period` cells (pixelfx pnoise)
export function pnoise(x, period, seed = 0) {
  const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f);
  const a = fireHash(wrap(i, period), 0, seed), b = fireHash(wrap(i + 1, period), 0, seed);
  return (a + (b - a) * u) * 2 - 1;
}
// noise wobbling about `rate` times a second, the same at tt and tt + D (pixelfx noiseFor)
export const loopN = (tt, rate, seed = 0, off = 0, D = FIRE_D) => {
  const P = Math.max(1, Math.round(rate * D));
  return pnoise((tt / D) * P + off, P, seed);
};
// count particles each born at its own moment of the loop and reborn every D; make(r) builds one from its
// own random numbers (the same every frame) with a .life (may be longer than D); draw(q, age) every live copy
export function looped(tt, D, count, seed, make, draw) {
  for (let i = 0; i < count; i++) {
    const r = rng(seed * 7919 + i * 104729 + 17), born = r() * D, q = make(r, i);
    for (let age = wrap(tt - born, D); age < q.life; age += D) draw(q, age, i);
  }
}
const range = (r, a, b) => a + (b - a) * r();
function along(x, v, a, k, t) {
  if (k <= 0) return [x + v * t + 0.5 * a * t * t, v + a * t];
  const e = Math.exp(-k * t), vt = a / k;
  return [x + vt * t + ((v - vt) * (1 - e)) / k, vt + (v - vt) * e];
}
// where something is t seconds after it set off from (x, y) at (vx, vy), pushed by (ax, ay), slowed by drag kx, ky
export function drift(x, y, vx, vy, t, ax, ay, kx, ky) {
  const X = along(x, vx, ax, kx, t), Y = along(y, vy, ay, ky, t);
  return [X[0], Y[0], X[1], Y[1]];
}

// tongue layers [width share, length share, step of the ramp]: red rim, orange, yellow, white heart
export const LAYERS = [[1, 1, 6], [0.76, 0.86, 4], [0.54, 0.68, 2], [0.3, 0.42, 0]];

// a tongue of flame from its root (x, y) along (ux, uy): len long, w its half width at the root, its tip swept
// `bend` sideways; a layer at a time, its rows half a pixel apart, every row's width and centre jittered by
// the noise so the edges crackle. N(rate, seed, off): the effect's noise now; n seeds this tongue.
// → [{ pts, tone }] (tone: a step of the ramp), back to front
export function flameBlade(x, y, ux, uy, len, w, bend, N, n, jit = 0.5, wob = 1.1) {
  const out = [];
  if (len < 1) return out;
  const nx = -uy, ny = ux;
  for (const [lw, lh, ri] of LAYERS) {
    const L = len * lh, left = [], right = [];
    for (let r = 0; r <= L; r += 0.5) {
      const u = r / Math.max(1, L);
      const half = w * lw * Math.pow(1 - u, 0.85) * Math.min(1, (r + 1.5) / 3.5) + N(9, n, r * 0.45) * jit;
      const off = bend * u * u * lh + N(4, n + 7, r * 0.2) * u * wob, cx = x + ux * r + nx * off, cy = y + uy * r + ny * off, h = Math.max(0, half);
      left.push([cx + nx * h, cy + ny * h]); right.push([cx - nx * h, cy - ny * h]);
    }
    if (left.length > 1) out.push({ pts: [...left, ...right.reverse()], tone: ri });
  }
  return out;
}

// a ball of flame with life left k cooling down the ramp H as it ages (pixelfx firePuff): a darker rim, a lit
// core up and to the left, a little tongue towards (tx, ty), a hot heart while young, its light.
// → { discs: [{ at, r, c, a }], glow }
export function firePuff(x, y, k, size, frac, H, glowK = 0.18, tx = 0, ty = -1) {
  const age = 1 - k, n = H.length, heat = Math.min(0.999, Math.pow(age, 0.62) + frac * 0.1), idx = Math.min(n - 2, Math.floor(heat * (n - 1)));
  const r = size * (0.55 + 0.45 * Math.min(1, age * 7)) * (1 - age * 0.55), c = H[idx], discs = [];
  if (idx >= n - 2) return { discs: [{ at: [x, y], r, c, a: Math.min(1, k * 3) * 0.85 }], glow: null };
  discs.push({ at: [x, y], r, c: H[Math.min(n - 1, idx + 2)], a: 1 });
  if (r > 1.6 && ty > -0.99) discs.push({ at: [x + tx * r * 1.5, y + ty * r * 1.5], r: r * 0.3, c: H[Math.min(n - 1, idx + 1)], a: 1 });
  discs.push({ at: [x - r * 0.16, y - r * 0.22], r: r * 0.78, c, a: 1 });
  if (r > 1.6) discs.push({ at: [x + tx * r * 0.9, y + ty * r * 0.9], r: r * 0.42, c, a: 1 });
  if (idx <= 3 && r > 1.8) discs.push({ at: [x - r * 0.28, y - r * 0.34], r: r * 0.36, c: H[Math.max(0, idx - 1)], a: 1 });
  return { discs, glow: idx < 6 ? { at: [x, y], r: r * 2.4 + 2, c, a: glowK * k } : null };
}

// a puff of smoke with life left k (pixelfx smokePuff): a body, a denser core sitting low, a lit cap while young
export function smokePuff(x, y, k, size, col = null, big = false, aMul = 1) {
  const age = 1 - k, r = size * (0.65 + Math.min(1, age * 2.5) * 0.45 + age * (big ? 0.5 : 0.4));
  const a = Math.min(1, age * 12) * Math.min(1, k * 2.4) * (big ? 0.7 : 0.58) * aMul;
  const c = col ? mixRgb(col, rampAt(SMOKE_RAMP, age), age) : rampAt(SMOKE_RAMP, age * 1.05), discs = [{ at: [x, y], r, c, a: a * 0.45 }, { at: [x + r * 0.05, y + r * 0.06], r: r * 0.74, c, a: a * 0.62 }];
  if (age < 0.5) discs.push({ at: [x - r * 0.22, y - r * 0.3], r: r * 0.5, c: mixRgb(c, WHITE, 0.12), a: a * 0.4 * (1 - age * 2) });
  return discs;
}

// the head (pixelfx fireball head): at (dx, dy) from its centre, the ramp step there, or -1 outside
export function headShade(dx, dy, R0, ph, S) {
  const d = Math.hypot(dx, dy), th = Math.atan2(dy, dx), back = Math.max(0, -Math.cos(th)), a = th / TAU;
  const bump = 0.55 * pnoise(a * 9 + ph * 9, 9, S) + 0.35 * pnoise(a * 5 - ph * 10, 5, S + 1);
  const rim = R0 * (1 + 0.55 * back * back) + bump;
  if (d > rim) return -1;
  const swirl = pnoise(a * 5 - ph * 10 + d * 0.45, 5, S + 2), h = 1 - d / rim + 0.26 * swirl + 0.1 * (1 - back);
  // the leading edge: a crisp hot rim where it cuts the air
  if (rim - d < 1 && back < 0.3) return h > 0.3 ? 3 : 5;
  return h > 0.74 ? 0 : h > 0.58 ? 1 : h > 0.42 ? 2 : h > 0.27 ? 4 : h > 0.13 ? 5 : 6;
}

// the comet body: tongues rooted in the head streaming back [length, half width, y offset]; the corona: licks
// peeling back off the head [angle on it (0 the nose), length, half width]
export const BODY = [[30, 4.2, 0], [23, 4.4, -1.6], [22, 4.4, 1.6], [15, 4.6, 0]];
export const CORONA = [[-1.3, 6, 1.1], [-1.8, 8, 1.2], [-2.3, 7, 1.1], [1.3, 6, 1.1], [1.8, 8, 1.2], [2.3, 7, 1.1]];

// everything of the flying fireball at tt seconds into its loop, in its own pixels round the head (x
// forward, y down), seed S; tail: how long its tail is (1 as in pixelfx, 0 none), spread: how wide.
// → { head: { at, ph }, smokes, puffs, blades, motes, embers, sparks, glows, glowLine }
export function fireball(tt, S, tail = 1, spread = 1) {
  const D = FIRE_D, R0 = FIRE_R0, V = 120 * tail, N = (rate, seed = 0, off = 0) => loopN(tt, rate, seed, off);
  const hx = N(3, S + 50) * 0.5, hy = N(2.5, S + 51) * 0.7, out = { smokes: [], puffs: [], blades: [], motes: [], embers: [], sparks: [], glows: [] };
  out.head = { at: [hx, hy], ph: tt / D };
  if (tail > 0) {
    // the tail: flame puffs thrown off the back that the head leaves behind; they cool, swell, rise and some
    // burn out into smoke. Positions are relative to the head, which outruns them.
    const fire = [];
    looped(tt, D, 130, S + 100, (r) => {
      const fl = range(r, 0.22, 0.55), sm = r() < 0.55, x = -range(r, 2, 24);
      return { x, y: range(r, -1, 1) * (R0 - 0.1 * -x) * spread, v: V * range(r, 0.3, 0.6), vy: range(r, -16, 16) * spread, fl, sm, sl: range(r, 0.25, 0.45), s: range(r, 1.3, 2.9), f: r() * 0.5 + 0.5 * (-x / 24), life: fl + (sm ? 0.45 : 0) };
    }, (q, age) => {
      const ta = Math.min(age, q.fl), [wx, y, wvx, vy] = drift(0, q.y, q.v, q.vy, ta, 0, -70, 4.5, 3), x = q.x + wx - V * ta;
      if (age < q.fl) return fire.push([age, x, y, q]);
      if (!q.sm || age - q.fl > q.sl) return;
      const sa = age - q.fl, [sx, sy] = drift(x, y, wvx - V, vy * 0.6 - 6, sa, V * 2, -30, 2, 1.2);
      out.smokes.push({ at: [sx, sy], k: 1 - sa / q.sl, size: q.s * 0.9 });
    });
    fire.sort((a, b) => b[0] - a[0]);
    for (const [age, x, y, q] of fire) { const u = age / q.fl; out.puffs.push({ at: [x, y], k: 1 - u, size: q.s * (1 + 1.3 * u), f: q.f }); }
  }
  // the body: tongues of flame rooted in the head streaming back, and a corona licking round it
  BODY.forEach(([len, w, dy], i) => {
    const n = (S * 5 + i) * 17, L = len * (0.82 + 0.25 * N(4, n)) * (1 + 0.3 * Math.max(0, N(2.4, n + 3))) * (0.4 + 0.6 * Math.min(1, tail));
    out.blades.push(...flameBlade(hx + 1, hy + dy * 0.5, -1, dy * 0.02, L, w, N(3, n + 5) * 3 + dy, N, n, 0.5, 1.1 + L * 0.05));
  });
  CORONA.forEach(([a, len, w], i) => {
    const n = (S * 5 + i + 20) * 17, L = len * (0.7 + 0.4 * (0.5 + 0.5 * N(6, n))), ox = Math.cos(a) * R0 * 0.85, oy = Math.sin(a) * R0 * 0.85;
    const dx = Math.cos(a) * 0.55 - 1, dy = Math.sin(a) * 0.55, l = Math.hypot(dx, dy);
    out.blades.push(...flameBlade(hx + ox, hy + oy, dx / l, dy / l, L, w, -Math.sign(a) * 1.5, N, n));
  });
  // motes flicked off the head's skin: short hot streaks that die at once
  looped(tt, D, 26, S + 200, (r) => ({ a: range(r, -2.4, 2.4), v: range(r, 30, 70), life: range(r, 0.08, 0.18) }), (q, age) => {
    const ca = Math.cos(q.a), sa = Math.sin(q.a), d = R0 * 0.9 + q.v * age, x = hx + ca * d - V * 0.4 * age, y = hy + sa * d, k = 1 - age / q.life, L = 1 + 2 * k;
    out.motes.push({ from: [x - ca * L + V * 0.02, y - sa * L], to: [x, y], tone: k > 0.5 ? 1 : 3, k });
  });
  if (tail > 0) {
    // embers left behind: streaks that the head outruns, falling as they cool
    looped(tt, D, 30, S + 300, (r) => ({ x: -range(r, 2, 16), y: range(r, -3, 3), v: V * range(r, 0.3, 0.8), vy: range(r, -20, 20), life: range(r, 0.25, 0.55), big: r() < 0.25, ph: range(r, 0, 6.3) }), (q, age) => {
      const [wx, y, wvx, vy] = drift(0, q.y, q.v, q.vy, age, 0, 50, 3, 2), x = q.x + wx - V * age, k = 1 - age / q.life;
      if (q.big) out.embers.push({ at: [x, y], k, size: 2, ph: age * 40 + q.ph });
      else out.sparks.push({ at: [x, y], v: [wvx - V, vy], k });
    });
  }
  // light: a hot heart, a warm halo, light running down the tail
  const fl = 0.85 + 0.15 * N(9, S + 7);
  out.glowLine = tail > 0 ? { from: [hx - 6, hy], to: [-50 * tail, -2], r: 12, a: 0.2 * fl } : null;
  out.glows.push({ at: [hx - 2, hy], r: 42, tone: -1, a: 0.42 * fl }, { at: [hx, hy], r: 13, tone: 1, a: 0.3 * fl });
  return out;
}

// ---- the strike: pixelfx's explosion as a burst in the air, at tt seconds after it hit (t 0..1 of the hit
// is FIRE_HIT seconds), in the burst's own pixels (its radius RAD is 18 of them). Everything fades out over the
// last quarter of the hit, so it is all gone by its end. power: 粒子
export const FIRE_HIT = 1.6, FIRE_RAD = 18;
// the particle kinds' motion (pixelfx Particles): [ax, ay, drag x, drag y]
const FIRE_M = [0, -95, 5, 3.2], SMOKE_M = [0, -16, 1.6, 1.2], BIG_M = [0, -23, 1.6, 1.2], SPARK_M = [0, 427, 2.2, 2.2], EMBER_M = [0, -30, 1.6, 1.6];
export function fireBurst(t, seed, power = 1, angle = 0) {
  const tt = t * FIRE_HIT, RAD = FIRE_RAD, P = rng(seed * 233 + 19), Y = -RAD * 0.3, POW = 0.9 * Math.max(0.25, Math.min(2, power)), end = 1 - smooth(0.75, 1, t);
  const out = { flash: null, glows: [], puffs: [], smokes: [], sparks: [], embers: [] }, fwd = [Math.cos(angle) * 40, Math.sin(angle) * 40];
  const R = (a, b) => a + (b - a) * P();
  if (tt < 0.06) out.flash = { at: [0, Y], r: RAD * 1.05 * (0.8 + 0.2 * (1 - tt / 0.06)), k: 1 - tt / 0.06 };
  out.glows.push({ at: [0, Y], r: RAD * 3.4, tone: -2, a: 0.6 * POW * Math.max(0, 1 - tt / 0.7) * end }, { at: [0, Y], r: RAD * 1.6, tone: -3, a: 0.6 * Math.max(0, 1 - tt / 0.08) });
  // a fire puff: where it is, and once it has burnt out (SMOKES) the smoke it leaves
  const fire = (x, y, vx, vy, life, size, delay, smokes, big) => {
    const sd = P() * 100, sl = big ? R(1.3, 2.3) : R(0.8, 1.4), a = tt - delay;
    if (a < 0) return;
    if (a < life) {
      const [px, py] = drift(x, y, vx, vy, a, ...FIRE_M);
      out.puffs.push({ at: [px, py], k: 1 - a / life, size, f: sd % 1, a: end });
    } else if (smokes && a - life < sl) {
      const [px, py, pvx, pvy] = drift(x, y, vx, vy, life, ...FIRE_M), b = a - life, M = big ? BIG_M : SMOKE_M, [sx, sy] = drift(px, py, pvx * 0.6, pvy * 0.6 - 6, b, ...M);
      out.smokes.push({ at: [sx, sy], k: 1 - b / sl, size: size * (big ? 0.85 : 0.7), big, a: end });
    }
  };
  const smoke = (x, y, vx, vy, life, col, size, delay, big) => {
    const a = tt - delay;
    if (a < 0 || a >= life) return;
    const [sx, sy] = drift(x, y, vx, vy, a, ...(big ? BIG_M : SMOKE_M));
    out.smokes.push({ at: [sx, sy], k: 1 - a / life, size, big, col, a: end });
  };
  for (let i = 0; i < 5; i++) fire(R(-2.5, 2.5), Y + R(-2.5, 2.5), R(-20, 20), R(-40, -10), R(0.18, 0.3), R(RAD * 0.4, RAD * 0.55), 0, false, false);
  for (let i = 0, n = Math.round(28 * POW); i < n; i++) {
    const a = R(0, TAU), d = R(0, RAD * 0.55), sp = R(40, 210) * POW, life = R(0.55, 1.15), size = R(RAD * 0.22, RAD * 0.46), sm = P() < 0.45;
    fire(Math.cos(a) * d, Y + Math.sin(a) * d, Math.cos(a) * sp + fwd[0], Math.sin(a) * sp * 0.8 - 40 + fwd[1], life, size, 0, sm, sm);
  }
  for (let i = 0; i < 5; i++) {
    const a = R(0, TAU), d = R(RAD * 0.1, RAD * 0.5), life = R(0.9, 1.5), size = R(RAD * 0.15, RAD * 0.26), delay = R(0.06, 0.2);
    smoke(Math.cos(a) * d, Y + Math.sin(a) * d, Math.cos(a) * 30, Math.sin(a) * 20 - 30, life, [34, 29, 38], size, delay, true);
  }
  for (let i = 0; i < 5; i++) {
    const x = R(-RAD * 0.25, RAD * 0.25), vx = R(-12, 12), vy = R(-180, -100), life = R(0.8, 1.3), size = R(RAD * 0.24, RAD * 0.36), delay = R(0, 0.1), sm = P() < 0.6;
    fire(x, Y, vx, vy, life, size, delay, sm, sm);
  }
  for (let i = 0, n = Math.round(10 * POW); i < n; i++) {
    const a = R(0, TAU), d = R(0, RAD * 0.7), sp = R(15, 100), life = R(1.8, 2.8), size = R(RAD * 0.26, RAD * 0.44), delay = R(0.12, 0.45);
    smoke(Math.cos(a) * d, Y + Math.sin(a) * d, Math.cos(a) * sp, Math.sin(a) * sp * 0.6 - 35, life, null, size, delay, true);
  }
  for (let i = 0, n = Math.round(80 * POW); i < n; i++) {
    const a = R(0, TAU), sp = R(140, 380) * POW, life = R(0.18, 0.6);
    if (tt >= life) continue;
    const [x, y, vx, vy] = drift(0, Y, Math.cos(a) * sp + fwd[0] * 2, Math.sin(a) * sp - 70 + fwd[1] * 2, tt, ...SPARK_M);
    out.sparks.push({ at: [x, y], v: [vx, vy], k: 1 - tt / life, a: end });
  }
  for (let i = 0, n = Math.round(40 * POW); i < n; i++) {
    const a = R(0, TAU), sp = R(30, 150), life = R(1.2, 2.6), sd = P() * 100;
    if (tt >= life) continue;
    const [x, y] = drift(Math.cos(a) * RAD * 0.4, Y + Math.sin(a) * RAD * 0.4, Math.cos(a) * sp, Math.sin(a) * sp - 75, tt, ...EMBER_M);
    out.embers.push({ at: [x, y], k: 1 - tt / life, size: 1, ph: tt * 40 + sd, a: end });
  }
  out.smokes.sort((p, q) => q.k - p.k);
  return out;
}

// ---- drawing (in the effect's own pixels: the caller scales by u, canvas px per pixel)
const disc = (g, x, y, r, c, a = 1) => { if (a <= 0.004 || r <= 0.05) return; g.fillStyle = rgba(c, a); g.beginPath(); g.arc(x, y, Math.max(0.3, r), 0, TAU); g.fill(); };
function poly(g, pts, c, a = 1) { g.fillStyle = rgba(c, a); g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.closePath(); g.fill(); }
function seg(g, p, q, c, w, a = 1) { g.strokeStyle = rgba(c, a); g.lineWidth = w; g.lineCap = "round"; g.beginPath(); g.moveTo(p[0], p[1]); g.lineTo(q[0], q[1]); g.stroke(); }
// a glow (pixelfx: light falling off as (1 - d)²), added
export function fireGlow(g, x, y, r, c, a, light) {
  if (r < 0.5 || a <= 0.004) return;
  g.globalCompositeOperation = light;
  blob(g, x, y, r, [[0, c, a], [0.25, c, a * 0.5625], [0.5, c, a * 0.25], [0.75, c, a * 0.0625], [1, c, 0]]);
  g.globalCompositeOperation = "source-over";
}
// light along a segment (pixelfx glowLine): soft glows strung along it
function glowLine(g, p, q, r, c, a, light) {
  const L = Math.hypot(q[0] - p[0], q[1] - p[1]), n = Math.max(2, Math.ceil(L / (r * 0.5)));
  for (let i = 0; i <= n; i++) fireGlow(g, p[0] + (q[0] - p[0]) * i / n, p[1] + (q[1] - p[1]) * i / n, r, c, a * 0.5 / Math.sqrt(n / 4 + 1), light);
}
const drawDiscs = (g, ds, fade = 1) => { for (const d of ds) disc(g, d.at[0], d.at[1], d.r, d.c, d.a * fade); };
function drawPuff(g, q, H, light, fade = 1) {
  const p = firePuff(q.at[0], q.at[1], q.k, q.size, q.f, H, q.glowK ?? 0.18, q.tx ?? 0, q.ty ?? -1);
  drawDiscs(g, p.discs, fade);
  if (p.glow) fireGlow(g, p.glow.at[0], p.glow.at[1], p.glow.r, p.glow.c, p.glow.a * fade, light);
}
function drawSpark(g, q, cols, light, fade = 1) {
  const sp = Math.hypot(q.v[0], q.v[1]) || 1, ux = q.v[0] / sp, uy = q.v[1] / sp, len = Math.min(9, 1 + sp * 0.022), k = q.k, [x, y] = q.at;
  const head = k > 0.6 ? cols[0] : k > 0.3 ? cols[1] : cols[2];
  seg(g, [x - ux * len, y - uy * len], [x - ux * len * 0.4, y - uy * len * 0.4], k > 0.5 ? head : cols[cols.length - 1], 1, fade);
  seg(g, [x - ux * len * 0.45, y - uy * len * 0.45], [x, y], head, 1, fade);
  fireGlow(g, x, y, 3, head, 0.45 * k * fade, light);
}
function drawEmber(g, q, cols, light, fade = 1) {
  const { k } = q, [x, y] = q.at;
  if (k < 0.25 && Math.sin(q.ph) < 0) return;
  const c = k > 0.6 ? cols[0] : k > 0.3 ? cols[1] : cols[2];
  if (q.size >= 2) {
    const rim = k > 0.45 ? cols[2] : cols[3];
    for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) disc(g, x + dx, y + dy, 0.6, rim, fade);
    disc(g, x, y, 0.6, c, fade);
    return fireGlow(g, x, y, 8, c, 0.4 * k * fade, light);
  }
  disc(g, x, y, 0.6, c, fade);
  fireGlow(g, x, y, 4, c, 0.35 * k * fade, light);
}

// the fireball at (0, 0) of the current transform, which may be turned to its way of flight; lit and rising
// as on screen, so flying leftwards (upside down) it is mirrored. r: its head's radius in canvas px
export function drawFireball(g, c, r, tail = 1, spread = 1) {
  const H = fireRamp(c.pal), light = c.pal.dark ? "source-over" : "lighter", u = r / FIRE_R0, tt = fireTime(c.t, c.n), S = c.seed | 0;
  const o = fireball(tt, S, tail, spread), GLOW = fireGlowColour(H), SMOKE = mixRgb(SMOKE1, H[6], 0.3), SPARKS = [H[1], H[2], H[4], H[5]], EMB = [H[1], H[2], H[4], H[6]];
  g.save();
  if (g.getTransform().d < 0) g.scale(1, -1);
  g.scale(u, u);
  g.globalCompositeOperation = "source-over";
  for (const s of o.smokes) drawDiscs(g, smokePuff(s.at[0], s.at[1], s.k, s.size, SMOKE));
  for (const p of o.puffs) drawPuff(g, { ...p, glowK: 0.07, tx: -0.86, ty: -0.5 }, H, light);
  for (const b of o.blades) poly(g, b.pts, H[b.tone]);
  // the head, a pixel at a time (worked out a little finer than the canvas)
  const [hx, hy] = o.head.at, R0 = FIRE_R0, sc = u * fieldScale(c, r * 4);
  field(g, hx - R0 * 2.4, hy - R0 * 1.7, hx + R0 * 1.5, hy + R0 * 1.7, sc, (x, y, px) => {
    const k = headShade(x + 0.5 / sc - hx, y + 0.5 / sc - hy, R0, o.head.ph, S);
    if (k < 0) return false;
    const col = H[k];
    px[0] = col[0]; px[1] = col[1]; px[2] = col[2]; px[3] = 1;
  });
  for (const m of o.motes) { seg(g, m.from, m.to, H[m.tone], 1); fireGlow(g, m.to[0], m.to[1], 3, H[2], 0.4 * m.k, light); }
  for (const e of o.embers) drawEmber(g, e, EMB, light);
  for (const s of o.sparks) drawSpark(g, s, SPARKS, light);
  if (o.glowLine && !c.pixel) glowLine(g, o.glowLine.from, o.glowLine.to, o.glowLine.r, GLOW, o.glowLine.a, light);
  for (const gl of o.glows) if (!c.pixel || gl.r < 20) fireGlow(g, gl.at[0], gl.at[1], gl.r, gl.tone < 0 ? GLOW : H[gl.tone], gl.a, light);
  g.globalCompositeOperation = "source-over";
  g.restore();
}

// the strike round (c.cx, c.cy): 命中范围 (radius, canvas px) is twice the burst's RAD
export function drawFireImpact(g, c, radius, angle = 0) {
  const H = fireRamp(c.pal), light = c.pal.dark ? "source-over" : "lighter", u = radius / (FIRE_RAD * 2), o = fireBurst(c.t, c.seed | 0, c.amount, angle);
  const SPARKS = [H[1], H[2], H[4], H[5]], EMB = [H[1], H[2], H[4], H[6]], WARM = fireGlowColour(H);
  g.save(); g.translate(c.cx, c.cy); g.scale(u, u);
  g.globalCompositeOperation = "source-over";
  for (const s of o.smokes) drawDiscs(g, smokePuff(s.at[0], s.at[1], s.k, s.size, s.col, s.big), s.a);
  for (const p of o.puffs) drawPuff(g, p, H, light, p.a);
  for (const s of o.sparks) drawSpark(g, s, SPARKS, light, s.a);
  for (const e of o.embers) drawEmber(g, e, EMB, light, e.a);
  if (o.flash) { disc(g, o.flash.at[0], o.flash.at[1], o.flash.r + 1.2, H[6]); disc(g, o.flash.at[0], o.flash.at[1], o.flash.r, o.flash.k > 0.45 ? H[1] : H[2]); }
  for (const gl of o.glows) if (!c.pixel || gl.r < 20) fireGlow(g, gl.at[0], gl.at[1], gl.r, gl.tone === -2 ? WARM : H[0], gl.a, light);
  g.globalCompositeOperation = "source-over";
  g.restore();
}
