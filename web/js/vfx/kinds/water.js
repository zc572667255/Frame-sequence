import { rgba, rng, smooth } from "../../trails/glow/util.js";
import { TAU, at, blob, field, fieldScale } from "../common.js";
import { pathAt, pathProgress } from "../remote.js";

// 水球, a ball of water, drawn after pixelfx's water orb and splash
// (https://github.com/patch-gg/pixelfx, MIT License, Copyright (c) 2026
// patch-gg; its orb follows Sprite Fusion's energy orb and its drops Sprite
// Fusion's blood, MIT License, Copyright (c) 2026 Hugo Duprez):
// - the body: see-through water whose skin wobbles, a lit rim (white on the
//   side the light comes from, upper left), deeper inside, the light
//   gathering low on the far side; a current of dashes circling inside on
//   tilted rings, bright where they pass in front; bubbles drifting up; a
//   shine up on the left; a bright fleck where the light comes to a point,
//   low on the right; glows; motes of spray on tilted orbits round it;
// - flying, it sheds beads of water with tails that fall, puffs of mist and
//   fine spray, each left where it came off;
// - striking, it splashes: a flash, its skin bursting into a lip of water
//   that spreads and breaks up, fingers off the lip that each throw a bead,
//   spray and heavy drops flung out that fall, flecks, glints and mist.
// Sizes are in the orb's pixels (its radius is 19 of them, as in pixelfx).
// Everything is a function of time, so any frame can be sought and loops
// close. godot/water.js draws exactly the same.

// the 8-step water ramp (deep → white), along the palette's flame ramp (its
// darkest colour … its core): C[0..7]
export const WATER_V = [0.02, 0.1, 0.25, 0.42, 0.58, 0.7, 0.84, 1];
export const waterRamp = (pal) => WATER_V.map((v) => at(pal.flame, v));

// how many times something that happens k times in pixelfx's 3 s loop (90
// frames at 30 fps; 36 here) happens over a loop of n frames: a whole number
export const waterCycles = (k, n) => Math.max(1, Math.round(k * (n || 36) / 36));

const SQ2 = Math.SQRT2;

// the body's skin: its radius at angle a
export const orbSkin = (a, R, w1, w2) => R * (1 + 0.032 * Math.sin(a * 3 + w1) + 0.018 * Math.sin(a * 5 - w2));

// the body at (ex, ey) from its centre (on screen, unstretched): [ramp step,
// alpha] or null outside. The rim is about 2 orb pixels.
export function orbShade(ex, ey, R, w1, w2) {
  const d = Math.hypot(ex, ey), r = orbSkin(Math.atan2(ey, ex), R, w1, w2);
  if (d > r) return null;
  const q = d / r, lit = (-ex - ey) / SQ2 / Math.max(0.5, d);
  if (q > 0.9) return [lit > 0.35 ? 7 : lit > -0.2 ? 5 : 3, 1];
  // a lens of water: dark on the side the light comes from, the light gathering low on the far side inside
  const gather = Math.max(0, (ex + ey) / SQ2 / r) * q;
  return [gather > 0.45 ? 4 : gather > 0.25 ? 3 : q > 0.7 ? 2 : 1, gather > 0.25 ? 0.7 : 0.35 + 0.3 * q];
}

// flying, the orb is drawn out a little along its way: a point on screen
// (from its centre) → where it falls on the round, unstretched orb
export const ORB_STRETCH = [1.07, 0.95];
export function unstretch(dx, dy, ang, k = ORB_STRETCH) {
  const c = Math.cos(ang), s = Math.sin(ang), lx = (dx * c + dy * s) / k[0], ly = (-dx * s + dy * c) / k[1];
  return [lx * c - ly * s, lx * s + ly * c];
}

// everything drawn on top of the body, for radius R at time t (0..1 over
// the loop) of n frames: the current's dashes { pts, tone, w }, bubbles
// { at, r, tone }, the shine, specks, the fleck, glows { at, r, tone, a }
// and the motes { at, front, i }. Points from the centre, on screen.
export function waterOrb(R, t, n, seed) {
  const u = R / 19, T = t * TAU, P = rng(seed * 113 + 9), dashes = [], bubbles = [], motes = [];
  // the current: three streaks circling on tilted planes, in dashes
  for (let k = 0; k < 3; k++) {
    const rr = R * (0.38 + 0.2 * k), tilt = -0.5 + k * 0.35, spin = T * (k % 2 ? -waterCycles(2, n) : waterCycles(3, n)) + k * 2;
    let run = null;
    for (let i = 0; i < 84; i++) {
      const s = i * 0.012, a = spin + s * TAU, x = Math.cos(a) * rr, z = Math.sin(a), dash = (s * 3 + k * 0.3) % 1;
      const tone = dash > 0.62 ? -1 : z > 0 ? (dash < 0.1 ? 7 : dash < 0.4 ? 6 : 5) : 3;
      const p = [x * Math.cos(tilt), x * Math.sin(tilt) * 0.6 + z * rr * 0.62];
      if (run && run.tone === tone) { run.pts.push(p); continue; }
      if (run) { run.pts.push(p); if (run.tone >= 0) dashes.push(run); }
      run = { pts: [p], tone, w: u };
    }
    if (run && run.tone >= 0 && run.pts.length > 1) dashes.push(run);
  }
  // bubbles drift up inside it
  for (let k = 0; k < 8; k++) {
    const life = 1 + 0.8 * P(), m = waterCycles(3 / life, n), ph = P(), x0 = (P() - 0.5) * R, wob = P() * TAU, two = P() < 0.35;
    const f = (t * m + ph) % 1, x = x0 + Math.sin(f * life * 4 + wob) * 1.5 * u, y = R * 0.6 - f * R * 1.2;
    if (Math.hypot(x, y) > R * 0.8) continue;
    bubbles.push({ at: [x, y], r: u * 0.6, tone: f < 0.8 ? 6 : 7 });
    if (two) bubbles.push({ at: [x + u, y], r: u * 0.55, tone: 5 });
  }
  const pulse = 0.8 + 0.2 * Math.sin(T * waterCycles(4, n));
  const glows = [
    { at: [R * 0.36, R * 0.4], r: 9 * u, tone: 5, a: 0.45 * pulse },
    { at: [0, 0], r: R * 1.4, tone: 5, a: 0.22 },
    { at: [-R * 0.4, -R * 0.5], r: 6 * u, tone: 7, a: 0.25 },
  ];
  // motes of spray on tilted orbits round it, behind and in front
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * TAU + T * waterCycles(1, n) * (i % 2 ? 1 : -1), r = R + 5 * u + (i % 3) * 3 * u, tilt = (i - 3) * 0.22, x = Math.cos(a) * r, z = Math.sin(a);
    motes.push({ at: [x * Math.cos(tilt), x * Math.sin(tilt) + z * r * 0.28], front: z >= 0, i });
  }
  return {
    u, w1: T * waterCycles(2, n), w2: T * waterCycles(3, n), dashes, bubbles, glows, motes,
    back: { r: R * 3.2, a: 0.3 + 0.05 * Math.sin(T * waterCycles(2, n)) },
    // the shine: a bright crescent up on the left; specks; the fleck where the light comes to a point
    shine: { r: R * 0.74, w: 1.8 * u, a0: Math.PI * 1.12, a1: Math.PI * 1.4 },
    specks: [{ at: [-R * 0.45, -R * 0.62], tone: 7 }, { at: [R * 0.48, R * 0.5], tone: 6 }, { at: [R * 0.48 + u, R * 0.5], tone: 5 }],
    fleck: { at: [R * 0.36, R * 0.4], r: 1.6 * u },
  };
}

// in 像素 (pixel) style the big soft glows (wider than WATER_PIXEL_GLOW orb
// pixels) are left out: snapped to blocks they would turn into flat discs
export const WATER_PIXEL_GLOW = 20;

// a soft glow (pixelfx: light falling off as (1 - d)²), added
export function glow(g, x, y, r, c, a) {
  if (r < 0.5 || a <= 0.004) return;
  blob(g, x, y, r, [[0, c, a], [0.25, c, a * 0.5625], [0.5, c, a * 0.25], [0.75, c, a * 0.0625], [1, c, 0]]);
}
const dot = (g, x, y, r, c, a = 1) => { g.fillStyle = rgba(c, a); g.beginPath(); g.arc(x, y, Math.max(0.35, r), 0, TAU); g.fill(); };
function polyline(g, pts, c, w, a = 1) {
  g.strokeStyle = rgba(c, a); g.lineWidth = Math.max(0.6, w); g.lineCap = "round"; g.lineJoin = "round";
  g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.stroke();
}
function band(g, r, w, a0, a1, c, a = 1) {
  g.fillStyle = rgba(c, a); g.beginPath(); g.arc(0, 0, r, a0, a1); g.arc(0, 0, Math.max(0, r - w), a1, a0, true); g.closePath(); g.fill();
}

// a bead of water at (x, y) moving along v (px a frame), pixelfx's sizes: 1 a
// fleck, 2 a small bead, 3 a round bead with a highlight; a tail trails back
// along its way, longer the faster it goes. u: px per orb pixel
export function drawBead(g, x, y, v, s, C, u, a = 1, light = "lighter") {
  if (a <= 0.01) return;
  const sp = Math.hypot(v[0], v[1]) || 1, ux = v[0] / sp, uy = v[1] / sp, tail = Math.min(5 * u, sp * 0.9);
  g.globalCompositeOperation = "source-over";
  if (tail >= u) {
    const p0 = [x - ux * (tail + u), y - uy * (tail + u)], p1 = [x - ux * 1.2 * u, y - uy * 1.2 * u], pm = [p0[0] + (p1[0] - p0[0]) * 0.45, p0[1] + (p1[1] - p0[1]) * 0.45];
    polyline(g, [p0, pm], C[3], u * 0.9, a);
    polyline(g, [pm, p1], s > 1 ? C[5] : C[4], u * 0.9, a);
  }
  if (s >= 3) { dot(g, x, y, 1.75 * u, C[4], a); dot(g, x - 0.25 * u, y - 0.25 * u, 1.15 * u, C[6], a); dot(g, x - 0.7 * u, y - 0.7 * u, 0.5 * u, C[7], a); }
  else if (s >= 2) { dot(g, x, y, 1.1 * u, C[5], a); dot(g, x - 0.35 * u, y - 0.35 * u, 0.5 * u, C[7], a); }
  else dot(g, x, y, 0.55 * u, sp > 2.4 * u ? C[6] : C[5], a);
  g.globalCompositeOperation = light;
  glow(g, x, y, (2.5 + s) * u, C[5], (0.1 + 0.05 * s) * a);
}

// a puff of mist (pixelfx Mist): a soft disc, lit on top, glowing a little
export function drawMist(g, x, y, r, c, a, C, light = "lighter") {
  if (a < 0.01 || r < 0.3) return;
  g.globalCompositeOperation = "source-over";
  blob(g, x, y, r, [[0, c, a * 0.75], [0.5, c, a * 0.56], [1, c, 0]]);
  blob(g, x - r * 0.2, y - r * 0.32, r * 0.55, [[0, C[7], a * 0.25], [1, C[7], 0]]);
  g.globalCompositeOperation = light;
  glow(g, x, y, r * 1.5, C[5], 0.16 * a);
}

// a glint (pixelfx sparkle): a cross of arms n orb pixels long, the tips in
// the lighter colour, diagonals once it is big enough, a white centre, a glow
export function drawSparkle(g, x, y, arm, c, tip, u, a = 1, light = "lighter") {
  const n = Math.round(arm);
  if (n < 1 || a <= 0.01) return;
  g.globalCompositeOperation = "source-over";
  for (let d = 1; d <= n; d++) for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) dot(g, x + dx * d * u, y + dy * d * u, 0.55 * u, d > n * 0.6 ? tip : c, a);
  if (n >= 3) for (const [dx, dy] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) dot(g, x + dx * u, y + dy * u, 0.55 * u, c, a);
  dot(g, x, y, 0.6 * u, [255, 255, 255], a);
  g.globalCompositeOperation = light;
  glow(g, x, y, (4 + n * 2) * u, c, 0.6 * a);
}

// the orb at (0, 0) of the current transform, which may be turned to its way
// of flight: it is drawn upright on screen (lit from the upper left), and
// drawn out a little along that way unless it stands still
export function drawWaterBody(g, c, R) {
  const m = g.getTransform(), ang = Math.atan2(m.b, m.a), C = waterRamp(c.pal), o = waterOrb(R, c.t, c.n, c.seed), light = c.pal.dark ? "source-over" : "lighter";
  const k = c.still ? [1, 1] : ORB_STRETCH, u = o.u;
  g.save(); g.rotate(-ang);
  g.globalCompositeOperation = light;
  if (!c.pixel) glow(g, 0, 0, o.back.r, C[4], o.back.a);
  g.globalCompositeOperation = "source-over";
  for (const q of o.motes) if (!q.front) dot(g, q.at[0], q.at[1], 0.6 * u, C[4]);
  const E = R * 1.15;
  field(g, -E, -E, E, E, fieldScale(c, R), (x, y, px) => {
    const [ex, ey] = unstretch(x + 0.5, y + 0.5, ang, k), sh = orbShade(ex, ey, R, o.w1, o.w2);
    if (!sh) return false;
    const col = C[sh[0]];
    px[0] = col[0]; px[1] = col[1]; px[2] = col[2]; px[3] = sh[1];
  });
  for (const d of o.dashes) polyline(g, d.pts, C[d.tone], d.w);
  for (const b of o.bubbles) dot(g, b.at[0], b.at[1], b.r, C[b.tone]);
  band(g, o.shine.r, o.shine.w, o.shine.a0, o.shine.a1, C[6]);
  const s0 = o.shine.a0 + (o.shine.a1 - o.shine.a0) * 0.25, s1 = o.shine.a0 + (o.shine.a1 - o.shine.a0) * 0.75;
  band(g, o.shine.r, o.shine.w * 0.6, s0, s1, C[7]);
  for (const sp of o.specks) dot(g, sp.at[0], sp.at[1], 0.6 * u, C[sp.tone]);
  dot(g, o.fleck.at[0], o.fleck.at[1], o.fleck.r, C[6]);
  dot(g, o.fleck.at[0], o.fleck.at[1], 0.6 * u, C[7]);
  g.globalCompositeOperation = light;
  for (const gl of o.glows) if (!c.pixel || gl.r <= WATER_PIXEL_GLOW * u) glow(g, gl.at[0], gl.at[1], gl.r, C[gl.tone], gl.a);
  for (const q of o.motes) if (q.front) {
    g.globalCompositeOperation = "source-over";
    dot(g, q.at[0], q.at[1], 0.6 * u, C[7]);
    dot(g, q.at[0] - (q.i % 2 ? -1 : 1) * u, q.at[1], 0.6 * u, C[5]);
    g.globalCompositeOperation = light;
    glow(g, q.at[0], q.at[1], 4 * u, C[5], 0.35);
  }
  g.globalCompositeOperation = "source-over";
  g.restore();
}

// what comes off the orb as it flies, each left where it came off (like the
// shed motes, remotetrail.js shed): beads of water from its back that fall,
// every third with a puff of mist, every other with a fleck of spray;
// 拖尾保留 how long they last, 粒子 how many. → { beads: [{ at, v, s, a }],
// mists: [{ at, r, tone, a }], flecks: [{ at, tone, a }] }, in the scene
export function waterTrail(s, w, h, state, index, R, seed, amount) {
  const out = { beads: [], mists: [], flecks: [] };
  if (amount <= 0 || s.trailFrames <= 0) return out;
  const u = R / 19, life = Math.min(14, Math.max(4, s.trailFrames)), rate = Math.max(0.3, Math.min(3, amount * 1.5)), G = u * 0.09;
  const postFade = 1 - smooth(0, Math.max(1, Math.min(life, s.impactFrames)), Math.max(0, state.time - s.chargeFrames - s.travelFrames));
  const oldest = Math.max(s.chargeFrames, state.time - life), newest = Math.min(state.time, s.chargeFrames + s.travelFrames);
  for (let j = Math.ceil(oldest * rate); j <= Math.floor(newest * rate); j++) {
    const P = rng(seed * 211 + j * 577 + index * 41), born = j / rate, age = state.time - born, span = life * (0.6 + 0.4 * P());
    if (age < 0 || age >= span) continue;
    const pu = pathProgress(s, (born - s.chargeFrames) / s.travelFrames), p = pathAt(s, w, h, pu, index), q = pathAt(s, w, h, Math.min(1, pu + 0.005), index);
    const a = Math.atan2(q[1] - p[1], q[0] - p[0]), dir = [Math.cos(a), Math.sin(a)], nrm = [-dir[1], dir[0]], side = P() * 2 - 1, f = age / span;
    const at0 = [p[0] - dir[0] * R * 0.75 + nrm[0] * side * R * 0.55, p[1] - dir[1] * R * 0.75 + nrm[1] * side * R * 0.55];
    const back = u * (0.6 + 1.2 * P()), up = u * 1.2 * P(), v0 = [-dir[0] * back + nrm[0] * side * u * 0.8, -dir[1] * back + nrm[1] * side * u * 0.8 - up];
    const sz = P(), size = sz < 0.15 ? 3 : sz < 0.55 ? 2 : 1, fade = Math.min(1, (span - age) / 2) * postFade;
    out.beads.push({ at: [at0[0] + v0[0] * age, at0[1] + v0[1] * age + 0.5 * G * age * age], v: [v0[0], v0[1] + G * age], s: size, a: fade });
    if (j % 3 === 0) {
      const r0 = (2.5 + 1.5 * P()) * u, r1 = (7 + 4 * P()) * u, e = 1 - Math.pow(1 - f, 2.2);
      out.mists.push({ at: [at0[0] - dir[0] * u * 2 * age * 0.3, at0[1] - dir[1] * u * 2 * age * 0.3 - u * 0.25 * age], r: r0 + (r1 - r0) * e, tone: P() < 0.5 ? 6 : 5, a: 0.3 * Math.min(1, f / 0.12) * Math.pow(1 - f, 1.4) * postFade });
    }
    if (j % 2 === 0) {
      const sx = (P() - 0.5) * u * 3, sy = -u * (1 + 2 * P());
      out.flecks.push({ at: [at0[0] + sx * age, at0[1] + sy * age + 0.5 * G * 0.6 * age * age], tone: P() < 0.5 ? 7 : 6, a: (1 - f) * postFade });
    }
  }
  return out;
}

// the splash, round the point it hit (angle: the way the orb flew), over t
// 0..1 of the hit (about a second of pixelfx's splash); sizes in the hit's
// pixels (its radius is 25 of them). → { glows, flash, lip: [{ a0, a1, r,
// w, tone }], fingers: [{ from, to, tone }], beads, flecks, stars, mists }.
// Everything is gone by t = 1.
// the lip and its fingers only on the side it flew towards (± SPLASH_ARC), so
// the splash never closes into a ring round the point it hit
export const SPLASH_LANES = 14, SPLASH_FINGERS = 9, SPLASH_TEAR = 0.11, SPLASH_ARC = 1.35;
// how far something thrown at speed 1 has gone after dt, slowed by the air (pixelfx drops: drag)
export const SPLASH_DRAG = 1.2;
const flown = (dt) => (1 - Math.exp(-SPLASH_DRAG * dt)) / SPLASH_DRAG;
const eoc = (x) => 1 - Math.pow(1 - Math.max(0, Math.min(1, x)), 3), eiq = (x) => Math.pow(Math.max(0, Math.min(1, x)), 2);
export function waterSplash(Rh, amount, seed, t, angle = 0) {
  const P = rng(seed * 229 + 71), u = Rh / 25, q = Math.max(0.25, Math.min(2, amount)), end = 1 - smooth(0.75, 1, t), G = 150 * u;
  const height = (x) => 19 * u * eoc(x / 0.09) * (1 - eiq((x - 0.12) / 0.3));
  const lipR = (x) => (3 + 7.5 * eoc(x / 0.45)) * u + height(x) * 0.42 + 3 * u * eoc(x / 0.25);
  const fwd = (a) => 1 + 0.35 * Math.cos(a - angle);
  const out = { glows: [], flash: null, lip: [], fingers: [], beads: [], flecks: [], stars: [], mists: [] };
  out.glows.push({ at: [0, -u], r: 52 * u, tone: 5, a: 0.6 * (1 - smooth(0, 0.45, t)) });
  out.glows.push({ at: [0, 0], r: 16 * u, tone: 7, a: 0.5 * (1 - smooth(0, 0.08, t)) });
  out.glows.push({ at: [0, 0], r: 34 * u, tone: 4, a: 0.2 * (1 - smooth(0, 1, t)) });
  if (t < 0.07) out.flash = { r: 7 * u * (1 - t / 0.07 * 0.4), arm: 5 * (1 - t / 0.07) };
  // the orb's skin bursts into a lip of water thrown out onward that spreads,
  // a little uneven, white where the light falls on it, thinning to its two
  // ends; each lane gives way at its own moment
  const rt = lipR(t), white = t < 0.045, span = 2 * SPLASH_ARC / SPLASH_LANES;
  for (let k = 0; k < SPLASH_LANES; k++) {
    const a0 = angle - SPLASH_ARC + k * span, a1 = a0 + span, am = (a0 + a1) / 2, thin = Math.sin(Math.PI * (k + 0.5) / SPLASH_LANES), keep = 1 - smooth(0.13 + 0.14 * P(), 0.23 + 0.14 * P(), t), sc = 0.86 + 0.28 * P();
    if (keep <= 0.02 || t <= 0) continue;
    const lit = (-Math.cos(am) - Math.sin(am)) / SQ2;
    out.lip.push({ a0, a1, r: rt * sc * fwd(am), w: 1.6 * u * keep * (0.4 + 0.6 * thin), tone: white ? 7 : lit > 0.35 ? 7 : lit > -0.2 ? 6 : 5, a: keep });
  }
  // fingers running on out from the lip, a bead on each until it tears off and flies
  for (let k = 0; k < SPLASH_FINGERS; k++) {
    const a = angle - SPLASH_ARC + (k + 0.5) / SPLASH_FINGERS * 2 * SPLASH_ARC, L = 0.2 + 0.16 * P(), va = a + (P() - 0.5) * 0.16, v = (32 + 56 * P()) * u * fwd(a), vh = (60 + 70 * P()) * u, big = P() < 0.3;
    const d = [Math.cos(a), Math.sin(a)], reach = 1 - smooth(SPLASH_TEAR, SPLASH_TEAR + 0.1, t), r0 = rt * fwd(a), len = height(t) * L * reach;
    const from = [d[0] * r0, d[1] * r0], to = [from[0] + d[0] * len, from[1] + d[1] * len - len * 0.3];
    if (len >= u) out.fingers.push({ from, to, tone: white ? 7 : 6 });
    if (t > 0.04 && t < SPLASH_TEAR) out.beads.push({ at: to, v: [0, -u], s: 2, a: 1 });
    if (t >= SPLASH_TEAR) {
      const dt = t - SPLASH_TEAR, h0 = lipR(SPLASH_TEAR) * fwd(a), L0 = height(SPLASH_TEAR) * L, o = [d[0] * (h0 + L0), d[1] * (h0 + L0) - L0 * 0.3];
      const vv = [Math.cos(va) * v, Math.sin(va) * v - vh];
      out.beads.push({ at: [o[0] + vv[0] * flown(dt), o[1] + vv[1] * flown(dt) + 0.5 * G * dt * dt], v: [vv[0] / 30, (vv[1] + G * dt) / 30], s: big ? 3 : 2, a: end });
    }
  }
  // the first sheet of spray, thrown up fast and fine
  for (let i = 0, n = Math.round(20 * q); i < n; i++) {
    const a = P() * TAU, v = (50 + 75 * P()) * u * fwd(a), vh = (90 + 80 * P()) * u, h = (1 + 5 * P()) * u, s = P() < 0.25 ? 2 : 1, delay = 0.04 * P(), dt = t - delay;
    if (dt <= 0) continue;
    const vv = [Math.cos(a) * v, Math.sin(a) * v * 0.6 - vh];
    out.beads.push({ at: [Math.cos(a) * 3 * u + vv[0] * flown(dt), Math.sin(a) * 3 * u - h + vv[1] * flown(dt) + 0.5 * G * dt * dt], v: [vv[0] / 30, (vv[1] + G * dt) / 30], s, a: end });
  }
  // flecks of spray, and glints
  for (let i = 0, n = Math.round(20 * q); i < n; i++) {
    const a = P() * TAU, x0 = Math.cos(a) * 9 * u, y0 = Math.sin(a) * 9 * u * 0.6 - (6 + 9 * P()) * u, vx = Math.cos(a) * (25 + 65 * P()) * u * fwd(a), vy = -(30 + 70 * P()) * u, life = 0.6 + 0.9 * P(), white = P() < 0.5, dt = t - 0.04;
    if (dt <= 0 || dt >= life) continue;
    const drag = (1 - Math.exp(-1.5 * dt)) / 1.5;
    out.flecks.push({ at: [x0 + vx * drag, y0 + vy * drag + 0.5 * G * 0.4 * dt * dt], tone: white ? 7 : 6, a: (1 - dt / life) * end });
  }
  for (let i = 0; i < 5; i++) {
    const x = (P() - 0.5) * 26 * u, y = -(6 + 14 * P()) * u, life = 0.25 + 0.3 * P(), arm = 1 + 1.4 * P(), delay = 0.04 + 0.15 * P(), k = (t - delay) / life;
    if (k > 0 && k < 1) out.stars.push({ at: [x, y - 4 * u * k * life], arm: arm * Math.sin(Math.PI * k) * 2, a: end });
  }
  // the lip falls back as heavy drops close in
  for (let i = 0; i < 8; i++) {
    const a = P() * TAU, v = (15 + 25 * P()) * u, vh = (30 + 50 * P()) * u, s = P() < 0.4 ? 3 : 2, dt = t - 0.3, r = lipR(0.3) * fwd(a);
    if (dt <= 0) continue;
    const vv = [Math.cos(a) * v, Math.sin(a) * v * 0.6 - vh];
    out.beads.push({ at: [Math.cos(a) * r + vv[0] * flown(dt), Math.sin(a) * r * 0.6 + vv[1] * flown(dt) + 0.5 * G * dt * dt], v: [vv[0] / 30, (vv[1] + G * dt) / 30], s, a: end });
  }
  // mist rolls out
  for (let i = 0; i < 9; i++) {
    const sd = i % 2 ? 1 : -1, x = sd * (4 + 8 * P()) * u, y = -(1 + 6 * P()) * u, vx = sd * (25 + 45 * P()) * u, vy = -(4 + 12 * P()) * u, r0 = (2.5 + 1.5 * P()) * u, r1 = (7 + 4 * P()) * u, life = 0.9 + 0.6 * P(), tone = P() < 0.5 ? 6 : 5, a = 0.3 + 0.12 * P(), delay = 0.1 * P(), dt = t - delay;
    if (dt <= 0 || dt >= life) continue;
    const e = 1 - Math.pow(1 - dt / life, 2.2), drag = (1 - Math.exp(-2.4 * dt)) / 2.4;
    out.mists.push({ at: [x + vx * drag, y + vy * drag - 3.5 * u * dt * dt], r: r0 + (r1 - r0) * e, tone, a: a * Math.min(1, dt / life / 0.12) * Math.pow(1 - dt / life, 1.4) * end });
  }
  return out;
}

function drawLot(g, lot, C, u, light) {
  for (const m of lot.mists) drawMist(g, m.at[0], m.at[1], m.r, C[m.tone], m.a, C, light);
  for (const b of lot.beads) drawBead(g, b.at[0], b.at[1], b.v, b.s, C, u, b.a, light);
  g.globalCompositeOperation = "source-over";
  for (const f of lot.flecks) dot(g, f.at[0], f.at[1], 0.55 * u, C[f.tone], f.a);
}

export function drawWaterImpact(g, c, radius, angle = 0) {
  const C = waterRamp(c.pal), o = waterSplash(radius, c.amount, c.seed, c.t, angle), u = radius / 25, light = c.pal.dark ? "source-over" : "lighter";
  g.save(); g.translate(c.cx, c.cy);
  g.globalCompositeOperation = light;
  for (const gl of o.glows) if (!c.pixel || gl.r <= WATER_PIXEL_GLOW * u) glow(g, gl.at[0], gl.at[1], gl.r, C[gl.tone], gl.a);
  g.globalCompositeOperation = "source-over";
  for (const l of o.lip) band(g, l.r + l.w / 2, l.w, l.a0, l.a1, C[l.tone], l.a);
  for (const f of o.fingers) polyline(g, [f.from, f.to], C[f.tone], u);
  drawLot(g, o, C, u, light);
  for (const s of o.stars) drawSparkle(g, s.at[0], s.at[1], s.arm, C[6], C[5], u, s.a, light);
  if (o.flash) {
    g.globalCompositeOperation = "source-over";
    dot(g, 0, 0, o.flash.r, C[7]);
    drawSparkle(g, 0, -3 * u, o.flash.arm, C[6], C[5], u, 1, light);
  }
  g.globalCompositeOperation = "source-over";
  g.restore();
}

export function drawWaterTrail(g, c, s, state, index, R) {
  const lot = waterTrail(s, c.w, c.h, state, index, R, c.seed, c.amount);
  drawLot(g, lot, waterRamp(c.pal), R / 19, c.pal.dark ? "source-over" : "lighter");
  g.globalCompositeOperation = "source-over";
}
